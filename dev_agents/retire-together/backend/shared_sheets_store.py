"""SHARE-03 server-only grants and durable household file binding.

Uses the private auth DB (0600), never the financial DB or legacy token.json.
The operation lock is process-safe on the local SQLite deployment. An uncertain
Google create is never reissued: its durable appProperties marker is reconciled.
"""
from contextlib import contextmanager
import fcntl
import os
import secrets
import time
from uuid import uuid4

from fastapi import HTTPException

from backend.auth_store import AuthStore, digest, FLOW_SECONDS

SCHEMA = """
CREATE TABLE IF NOT EXISTS sheet_grants (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    access_token TEXT NOT NULL, refresh_token TEXT NOT NULL,
    expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sheet_flows (
    state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL,
    session_hash TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
    nonce TEXT NOT NULL, verifier TEXT NOT NULL, expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS household_sheets (
    household_id INTEGER PRIMARY KEY REFERENCES households(id),
    operation_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('create','select')),
    spreadsheet_id TEXT UNIQUE,
    ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1)),
    retryable INTEGER NOT NULL DEFAULT 0 CHECK(retryable IN (0,1))
);
CREATE TRIGGER IF NOT EXISTS fixed_sheet_binding
BEFORE UPDATE OF spreadsheet_id ON household_sheets
WHEN OLD.spreadsheet_id IS NOT NULL AND NEW.spreadsheet_id IS NOT OLD.spreadsheet_id
BEGIN SELECT RAISE(ABORT, 'sheet binding is immutable'); END;
CREATE TRIGGER IF NOT EXISTS keep_sheet_binding BEFORE DELETE ON household_sheets
BEGIN SELECT RAISE(ABORT, 'sheet binding must be retained'); END;
"""


class SheetStore(AuthStore):
    @contextmanager
    def connection(self):
        with super().connection() as db:
            db.executescript(SCHEMA)
            # Also tolerate a DB opened by an earlier live-reload of SHARE-03.
            # Additive only: never recreate owner, grants, or file reservations.
            if "retryable" not in {row[1] for row in db.execute("PRAGMA table_info(household_sheets)")}:
                db.execute("BEGIN IMMEDIATE")
                if "retryable" not in {row[1] for row in db.execute("PRAGMA table_info(household_sheets)")}:
                    db.execute("ALTER TABLE household_sheets ADD COLUMN retryable INTEGER NOT NULL DEFAULT 0 CHECK(retryable IN (0,1))")
                db.commit()
            yield db

    @contextmanager
    def operation(self):
        # One household in this deployment. Keep the inode; deleting lock files
        # could let a second process lock a different inode during a request.
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(str(self.path) + ".sheets.lock", os.O_CREAT | os.O_RDWR, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise HTTPException(409, "공통 시트 연결을 처리 중입니다. 잠시 후 상태를 확인해 주세요.") from None
            yield
        finally:
            os.close(fd)

    def owner(self, identity: dict) -> dict:
        with self.connection() as db:
            row = db.execute("""SELECT u.* FROM users u JOIN households h ON h.owner_user_id=u.id
                JOIN memberships m ON m.user_id=u.id AND m.household_id=h.id
                WHERE u.id=? AND h.id=? AND m.active=1 AND m.role='owner'""",
                (identity["user_id"], identity["household_id"])).fetchone()
        if row is None:
            raise HTTPException(403, "고정 오너만 공통 시트를 연결할 수 있습니다.")
        return dict(row)

    def member(self, identity: dict) -> dict:
        with self.connection() as db:
            row = db.execute("""SELECT u.* FROM users u JOIN memberships m ON m.user_id=u.id
                WHERE u.id=? AND m.id=? AND m.household_id=? AND m.active=1""",
                (identity["user_id"], identity["member_id"], identity["household_id"])).fetchone()
        if row is None:
            raise HTTPException(403, "활성 가구 구성원만 공통 파일에 접근할 수 있습니다.")
        return dict(row)

    def new_sheet_flow(self, user_id: str, session: str):
        state = "files." + secrets.token_urlsafe(32)
        browser, nonce, verifier = [secrets.token_urlsafe(32) for _ in range(3)]
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM sheet_flows WHERE expires_at<=? OR user_id=?", (time.time(), user_id))
            db.execute("INSERT INTO sheet_flows VALUES (?,?,?,?,?,?,?)",
                       (digest(state), digest(browser), digest(session), user_id, nonce, verifier, time.time() + FLOW_SECONDS))
        return state, browser, nonce, verifier

    def consume_sheet_flow(self, state: str, browser: str, session: str) -> dict:
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("DELETE FROM sheet_flows WHERE state_hash=? AND browser_hash=? AND session_hash=? RETURNING *",
                             (digest(state), digest(browser), digest(session))).fetchone()
        if row is None or row["expires_at"] <= time.time():
            raise HTTPException(400, "시트 연결 요청이 만료되었거나 일치하지 않습니다.")
        return dict(row)

    def grant(self, user_id: str) -> dict | None:
        with self.connection() as db:
            row = db.execute("SELECT * FROM sheet_grants WHERE user_id=?", (user_id,)).fetchone()
        return dict(row) if row else None

    def save_grant(self, user_id: str, access: str, refresh: str, expires_at: float):
        with self.connection() as db:
            db.execute("""INSERT INTO sheet_grants VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
                access_token=excluded.access_token,
                refresh_token=CASE WHEN excluded.refresh_token='' THEN sheet_grants.refresh_token ELSE excluded.refresh_token END,
                expires_at=excluded.expires_at""", (user_id, access, refresh, expires_at))

    def disconnect(self, user_id: str):
        with self.connection() as db:
            db.execute("DELETE FROM sheet_grants WHERE user_id=?", (user_id,))
            db.execute("DELETE FROM sheet_flows WHERE user_id=?", (user_id,))

    def binding(self, household_id: int) -> dict | None:
        with self.connection() as db:
            row = db.execute("SELECT * FROM household_sheets WHERE household_id=?", (household_id,)).fetchone()
        return dict(row) if row else None

    def reserve(self, household_id: int, kind: str, sid: str | None = None) -> dict:
        with self.connection() as db:
            db.execute("INSERT INTO household_sheets(household_id,operation_id,kind,spreadsheet_id) VALUES (?,?,?,?)",
                       (household_id, str(uuid4()), kind, sid))
        return self.binding(household_id)

    def bind(self, household_id: int, sid: str):
        with self.connection() as db:
            db.execute("UPDATE household_sheets SET spreadsheet_id=? WHERE household_id=?", (sid, household_id))

    def ready(self, household_id: int):
        with self.connection() as db:
            db.execute("UPDATE household_sheets SET ready=1 WHERE household_id=?", (household_id,))

    def retryable(self, household_id: int, value: bool):
        with self.connection() as db:
            db.execute("UPDATE household_sheets SET retryable=? WHERE household_id=? AND spreadsheet_id IS NULL",
                       (int(value), household_id))
