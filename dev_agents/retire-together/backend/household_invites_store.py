"""Durable invitation saga, isolated from financial records and UI.

All Google side effects are serialized by SheetStore.operation. Revocation first
commits locally without that lock, so an in-flight accept cannot activate later.
"""
from contextlib import contextmanager
import re
import secrets
import time
from uuid import uuid4

from fastapi import HTTPException

from backend.auth_store import digest, FLOW_SECONDS, SESSION_SECONDS
from backend.shared_sheets_store import SheetStore

INVITE_SECONDS = 48 * 60 * 60
JOIN_SECONDS = 20 * 60
TERMINAL = {"cancelled", "expired", "revoked"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS household_invites (
    id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE,
    household_id INTEGER NOT NULL REFERENCES households(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id), email TEXT NOT NULL,
    spreadsheet_id TEXT NOT NULL, created_at REAL NOT NULL, expires_at REAL NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','joining','accepted','cancelled','expired','revoked')),
    user_id TEXT REFERENCES users(id), permission_id TEXT,
    permission_source TEXT NOT NULL DEFAULT 'none',
    permission_attempt INTEGER NOT NULL DEFAULT 0,
    cleanup TEXT NOT NULL DEFAULT 'none', residual_access INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS invite_flows (
    state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL,
    invite_id TEXT NOT NULL REFERENCES household_invites(id),
    nonce TEXT NOT NULL, verifier TEXT NOT NULL, expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS invite_joins (
    token_hash TEXT PRIMARY KEY, invite_id TEXT NOT NULL REFERENCES household_invites(id),
    user_id TEXT NOT NULL REFERENCES users(id), expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS invite_limits (
    bucket TEXT PRIMARY KEY, started_at REAL NOT NULL, attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invite_cleanup_confirmations (
    invite_id TEXT PRIMARY KEY REFERENCES household_invites(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id), confirmed_at REAL NOT NULL
);
"""


def email_key(value: str) -> str:
    value = value.strip().lower()
    # Exact verified address only: no gmail dot/plus alias guessing.
    if len(value) > 320 or not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", value):
        raise HTTPException(422, "배우자의 Google 이메일 주소를 확인해 주세요.")
    return value


def usable(row):
    if row is None or row["status"] not in {"pending", "joining"} or row["expires_at"] <= time.time():
        raise HTTPException(409, "초대가 만료·취소되었거나 이미 사용되었습니다. 오너에게 확인해 주세요.")
    return dict(row)


class InviteStore(SheetStore):
    @contextmanager
    def connection(self):
        with super().connection() as db:
            db.executescript(SCHEMA)
            yield db

    def limit(self, bucket: str, maximum: int, seconds: int):
        now = time.time()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM invite_limits WHERE bucket=? AND started_at<=?", (bucket, now - seconds))
            row = db.execute("SELECT * FROM invite_limits WHERE bucket=?", (bucket,)).fetchone()
            if row and row["attempts"] >= maximum:
                raise HTTPException(429, "초대 요청이 많습니다. 잠시 후 다시 시도해 주세요.")
            db.execute("""INSERT INTO invite_limits VALUES (?,?,1) ON CONFLICT(bucket)
                          DO UPDATE SET attempts=attempts+1""", (bucket, now))

    def get(self, invitation_id: str):
        with self.connection() as db:
            row = db.execute("SELECT * FROM household_invites WHERE id=?", (invitation_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "초대를 찾을 수 없습니다.")
        return dict(row)

    def expire(self):
        with self.connection() as db:
            db.execute("""UPDATE household_invites SET status='expired',cleanup='pending'
                          WHERE expires_at<=? AND status IN ('pending','joining')""", (time.time(),))

    def issue(self, identity: dict, email: str):
        owner = self.owner(identity)
        email = email_key(email)
        if email == email_key(owner["email"]):
            raise HTTPException(422, "오너와 다른 배우자 계정을 지정해 주세요.")
        self.limit("issue", 5, 3600)
        self.expire()
        binding = self.binding(identity["household_id"])
        if not binding or not binding["ready"] or not binding["spreadsheet_id"]:
            raise HTTPException(409, "오너의 공통 시트를 먼저 연결해 주세요.")
        code, invitation_id, now = secrets.token_urlsafe(32), str(uuid4()), time.time()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM memberships WHERE role='partner' AND active=1").fetchone():
                raise HTTPException(409, "이미 가입한 배우자가 있습니다.")
            if db.execute("""SELECT 1 FROM household_invites WHERE status IN ('pending','joining')
                             OR cleanup IN ('pending','attention')""").fetchone():
                raise HTTPException(409, "기존 초대를 취소하거나 남은 공유 권한 정리를 완료해 주세요.")
            db.execute("""INSERT INTO household_invites
                (id,code_hash,household_id,owner_user_id,email,spreadsheet_id,created_at,expires_at,status)
                VALUES (?,?,?,?,?,?,?,?,'pending')""", (invitation_id, digest(code), identity["household_id"],
                    identity["user_id"], email, binding["spreadsheet_id"], now, now + INVITE_SECONDS))
        return self.get(invitation_id), code

    def new_invite_flow(self, code: str, previous_browser: str):
        self.limit("accept", 60, 600)
        state = "invite." + secrets.token_urlsafe(32)
        browser, nonce, verifier = [secrets.token_urlsafe(32) for _ in range(3)]
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = usable(db.execute("SELECT * FROM household_invites WHERE code_hash=?", (digest(code),)).fetchone())
            db.execute("DELETE FROM invite_flows WHERE expires_at<=? OR browser_hash=?", (time.time(), digest(previous_browser)))
            db.execute("INSERT INTO invite_flows VALUES (?,?,?,?,?,?)", (digest(state), digest(browser), row["id"],
                       nonce, verifier, min(row["expires_at"], time.time() + FLOW_SECONDS)))
        return state, browser, nonce, verifier

    def consume_invite_flow(self, state: str, browser: str):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("DELETE FROM invite_flows WHERE state_hash=? AND browser_hash=? RETURNING *",
                             (digest(state), digest(browser))).fetchone()
        if row is None or row["expires_at"] <= time.time():
            raise HTTPException(400, "초대 본인 확인 요청이 만료되었거나 일치하지 않습니다.")
        return dict(row)

    def identify(self, invitation_id: str, sub: str, email: str, grant: tuple):
        token = secrets.token_urlsafe(32)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = usable(db.execute("SELECT * FROM household_invites WHERE id=?", (invitation_id,)).fetchone())
            if email_key(email) != row["email"]:
                raise HTTPException(403, "초대받은 Google 이메일로 본인 확인해 주세요.")
            user = db.execute("SELECT * FROM users WHERE google_sub=?", (sub,)).fetchone()
            user_id = user["id"] if user else str(uuid4())
            if user_id == row["owner_user_id"] or (row["user_id"] and row["user_id"] != user_id):
                raise HTTPException(403, "초대에 연결된 Google 계정과 일치하지 않습니다.")
            if not user:
                db.execute("INSERT INTO users VALUES (?,?,?)", (user_id, sub, email))
            db.execute("UPDATE household_invites SET user_id=?,status='joining' WHERE id=?", (user_id, invitation_id))
            access, refresh, expires = grant
            db.execute("""INSERT INTO sheet_grants VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
                access_token=excluded.access_token,refresh_token=CASE WHEN excluded.refresh_token=''
                THEN sheet_grants.refresh_token ELSE excluded.refresh_token END,expires_at=excluded.expires_at""",
                (user_id, access, refresh, expires))
            db.execute("DELETE FROM invite_joins WHERE expires_at<=?", (time.time(),))
            db.execute("INSERT INTO invite_joins VALUES (?,?,?,?)", (digest(token), invitation_id, user_id,
                       min(row["expires_at"], time.time() + JOIN_SECONDS)))
        return token

    def join(self, token: str):
        with self.connection() as db:
            row = db.execute("""SELECT i.* FROM invite_joins j JOIN household_invites i ON i.id=j.invite_id
                WHERE j.token_hash=? AND j.expires_at>? AND j.user_id=i.user_id""", (digest(token), time.time())).fetchone()
        if row is None:
            raise HTTPException(401, "초대 링크에서 본인 확인을 다시 시작해 주세요.")
        return usable(row)

    def update_permission(self, invitation_id, *, permission_id=None, source="none", attempt=0):
        with self.connection() as db:
            db.execute("UPDATE household_invites SET permission_id=?,permission_source=?,permission_attempt=? WHERE id=?",
                       (permission_id, source, attempt, invitation_id))

    def activate(self, token: str, previous_session: str):
        session = secrets.token_urlsafe(32)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = usable(db.execute("""SELECT i.* FROM invite_joins j JOIN household_invites i ON i.id=j.invite_id
                WHERE j.token_hash=? AND j.expires_at>? AND j.user_id=i.user_id""", (digest(token), time.time())).fetchone())
            if row["status"] != "joining" or not row["permission_id"]:
                raise HTTPException(409, "시트 공유 확인을 먼저 완료해 주세요.")
            if db.execute("SELECT 1 FROM memberships WHERE role='partner' AND active=1").fetchone():
                raise HTTPException(409, "이미 가입한 배우자가 있습니다.")
            # Old inactive partner identities stay in users/invite history; a new
            # membership ID prevents old session cookies gaining access again.
            db.execute("DELETE FROM sessions WHERE membership_id IN (SELECT id FROM memberships WHERE role='partner')")
            db.execute("DELETE FROM memberships WHERE role='partner' AND active=0")
            member_id = str(uuid4())
            db.execute("INSERT INTO memberships VALUES (?,?,?,'partner',1)", (member_id, row["household_id"], row["user_id"]))
            db.execute("UPDATE household_invites SET status='accepted' WHERE id=?", (row["id"],))
            db.execute("DELETE FROM invite_joins WHERE invite_id=?", (row["id"],))
            db.execute("DELETE FROM invite_flows WHERE invite_id=?", (row["id"],))
            db.execute("DELETE FROM sessions WHERE token_hash=? OR expires_at<=?", (digest(previous_session), time.time()))
            db.execute("INSERT INTO sessions VALUES (?,?,?)", (digest(session), member_id, time.time() + SESSION_SECONDS))
        return session

    def stop(self, invitation_id: str, *, revoke: bool = False):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM household_invites WHERE id=?", (invitation_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "초대를 찾을 수 없습니다.")
            if row["status"] == "accepted" and not revoke:
                raise HTTPException(409, "가입 후에는 배우자 접근 해제를 사용해 주세요.")
            if revoke and row["status"] not in {"accepted", "revoked"}:
                raise HTTPException(409, "가입한 배우자의 접근 해제만 가능합니다.")
            if row["status"] in TERMINAL and row["cleanup"] == "done":
                # Drive permission IDs can be reused for the same principal.
                # An old retry must not remove a later invitation's grant.
                return dict(row)
            status = "revoked" if revoke else row["status"] if row["status"] in TERMINAL else "cancelled"
            db.execute("UPDATE household_invites SET status=?,cleanup='pending' WHERE id=?", (status, invitation_id))
            db.execute("DELETE FROM invite_flows WHERE invite_id=?", (invitation_id,))
            db.execute("DELETE FROM invite_joins WHERE invite_id=?", (invitation_id,))
            if row["user_id"] and (row["status"] in {"pending", "joining", "accepted"}
                                   or (row["status"] == "expired" and row["cleanup"] != "done")):
                db.execute("UPDATE memberships SET active=0 WHERE user_id=? AND role='partner'", (row["user_id"],))
                db.execute("DELETE FROM sessions WHERE membership_id IN (SELECT id FROM memberships WHERE user_id=? AND role='partner')", (row["user_id"],))
                db.execute("DELETE FROM sheet_grants WHERE user_id=?", (row["user_id"],))
                db.execute("DELETE FROM sheet_flows WHERE user_id=?", (row["user_id"],))
        return self.get(invitation_id)

    def cleanup_result(self, invitation_id: str, state: str, residual: bool):
        with self.connection() as db:
            # A delayed failed retry cannot downgrade a committed receipt and
            # later delete a permission belonging to a newly issued invitation.
            db.execute("UPDATE household_invites SET cleanup=?,residual_access=? WHERE id=? AND cleanup!='done'",
                       (state, int(residual), invitation_id))

    def confirm_cleanup(self, invitation_id, owner_user_id, residual):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM household_invites WHERE id=?", (invitation_id,)).fetchone()
            if row is None or row["status"] not in TERMINAL or row["owner_user_id"] != owner_user_id:
                raise HTTPException(409, "취소·해제한 초대의 공유 정리만 확인할 수 있습니다.")
            db.execute("INSERT OR IGNORE INTO invite_cleanup_confirmations VALUES (?,?,?)",
                       (invitation_id, owner_user_id, time.time()))
            db.execute("UPDATE household_invites SET cleanup='done',residual_access=? WHERE id=? AND cleanup!='done'",
                       (int(residual), invitation_id))
