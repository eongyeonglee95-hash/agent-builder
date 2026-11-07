"""One household, immutable owner, one-use OAuth transactions and opaque sessions.

This database is separate from financial records. Google tokens are never persisted.
"""
from contextlib import contextmanager
from hashlib import sha256
import os
from pathlib import Path
import secrets
import sqlite3
import time
from uuid import uuid4

from fastapi import HTTPException

FLOW_SECONDS = 600
SESSION_SECONDS = 12 * 60 * 60


def digest(value: str) -> str:
    return sha256(value.encode()).hexdigest()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, google_sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS households (
    id INTEGER PRIMARY KEY CHECK(id=1), owner_user_id TEXT NOT NULL UNIQUE REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS memberships (
    id TEXT PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
    role TEXT NOT NULL CHECK(role IN ('owner', 'partner')),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    UNIQUE(household_id, role)
);
CREATE TABLE IF NOT EXISTS oauth_flows (
    state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL,
    nonce TEXT NOT NULL, verifier TEXT NOT NULL, bootstrap INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, popup INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, membership_id TEXT NOT NULL REFERENCES memberships(id),
    expires_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS fixed_household_insert BEFORE INSERT ON households
WHEN EXISTS(SELECT 1 FROM households)
BEGIN SELECT RAISE(ABORT, 'household already initialized'); END;
CREATE TRIGGER IF NOT EXISTS fixed_user_insert BEFORE INSERT ON users
WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.id OR google_sub=NEW.google_sub)
BEGIN SELECT RAISE(ABORT, 'identity already exists'); END;
CREATE TRIGGER IF NOT EXISTS fixed_owner_update BEFORE UPDATE ON households
BEGIN SELECT RAISE(ABORT, 'household owner is immutable'); END;
CREATE TRIGGER IF NOT EXISTS fixed_owner_delete BEFORE DELETE ON households
BEGIN SELECT RAISE(ABORT, 'household owner is immutable'); END;
CREATE TRIGGER IF NOT EXISTS fixed_identity BEFORE UPDATE OF id, google_sub ON users
BEGIN SELECT RAISE(ABORT, 'identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS membership_owner_insert BEFORE INSERT ON memberships
WHEN (NEW.role='owner') != (NEW.user_id=(SELECT owner_user_id FROM households WHERE id=NEW.household_id))
BEGIN SELECT RAISE(ABORT, 'owner membership mismatch'); END;
CREATE TRIGGER IF NOT EXISTS fixed_membership BEFORE UPDATE OF id, household_id, user_id, role ON memberships
BEGIN SELECT RAISE(ABORT, 'membership identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS fixed_owner_membership BEFORE DELETE ON memberships WHEN OLD.role='owner'
BEGIN SELECT RAISE(ABORT, 'owner membership is immutable'); END;
"""


class AuthStore:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connection(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Create privately before SQLite opens it, including during concurrent setup.
        fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        self.path.chmod(0o600)
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA recursive_triggers=ON")
        try:
            db.executescript(SCHEMA)
            if "popup" not in {row[1] for row in db.execute("PRAGMA table_info(oauth_flows)")}:
                with db:
                    db.execute("BEGIN IMMEDIATE")
                    if "popup" not in {row[1] for row in db.execute("PRAGMA table_info(oauth_flows)")}:
                        db.execute("ALTER TABLE oauth_flows ADD COLUMN popup INTEGER NOT NULL DEFAULT 0")
            with db:
                yield db
        finally:
            db.close()

    def initialized(self) -> bool:
        with self.connection() as db:
            return db.execute("SELECT 1 FROM households").fetchone() is not None

    def new_flow(self, previous_browser: str, bootstrap: bool, popup: bool = False) -> tuple[str, str, str, str]:
        state, browser, nonce, verifier = [secrets.token_urlsafe(32) for _ in range(4)]
        now = int(time.time())
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM oauth_flows WHERE expires_at<=? OR browser_hash=?",
                       (now, digest(previous_browser)))
            # Bound anonymous pending flows without retaining IP addresses.
            if db.execute("SELECT count(*) FROM oauth_flows").fetchone()[0] >= 1000:
                raise HTTPException(429, "잠시 후 로그인을 다시 시도해 주세요.")
            db.execute("INSERT INTO oauth_flows (state_hash,browser_hash,nonce,verifier,bootstrap,expires_at,popup) VALUES (?,?,?,?,?,?,?)",
                       (digest(state), digest(browser), nonce, verifier, int(bootstrap), now + FLOW_SECONDS, int(popup)))
        return state, browser, nonce, verifier

    def consume_flow(self, state: str, browser: str) -> dict:
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("DELETE FROM oauth_flows WHERE state_hash=? AND browser_hash=? RETURNING *",
                             (digest(state), digest(browser))).fetchone()
        if row is None or row["expires_at"] <= time.time():
            raise HTTPException(400, "로그인 요청이 만료되었거나 일치하지 않습니다. 다시 시작해 주세요.")
        return dict(row)

    def login(self, sub: str, email: str, bootstrap: bool, previous_session: str) -> str:
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            household = db.execute("SELECT * FROM households").fetchone()
            if household is None:
                if not bootstrap:
                    raise HTTPException(403, "운영자의 최초 설정이 필요합니다.")
                user_id, member_id = str(uuid4()), str(uuid4())
                db.execute("INSERT INTO users VALUES (?,?,?)", (user_id, sub, email))
                db.execute("INSERT INTO households VALUES (1,?)", (user_id,))
                db.execute("INSERT INTO memberships VALUES (?,1,?,'owner',1)", (member_id, user_id))
            row = db.execute("""SELECT m.id FROM users u JOIN memberships m ON m.user_id=u.id
                                JOIN households h ON h.id=m.household_id
                                WHERE u.google_sub=? AND m.active=1""", (sub,)).fetchone()
            if row is None:
                raise HTTPException(403, "이 가구에 가입한 계정만 로그인할 수 있습니다.")
            # Email changes never re-key a user or select a new owner.
            db.execute("UPDATE users SET email=? WHERE google_sub=?", (email, sub))
            db.execute("DELETE FROM sessions WHERE token_hash=? OR expires_at<=?",
                       (digest(previous_session), now))
            db.execute("INSERT INTO sessions VALUES (?,?,?)", (digest(token), row["id"], now + SESSION_SECONDS))
        return token

    def session(self, token: str) -> dict | None:
        if not token or len(token) > 128:
            return None
        with self.connection() as db:
            row = db.execute("""SELECT u.id AS user_id, u.email, m.id AS member_id, m.role,
                                m.household_id, h.owner_user_id, s.expires_at
                                FROM sessions s JOIN memberships m ON m.id=s.membership_id
                                JOIN users u ON u.id=m.user_id JOIN households h ON h.id=m.household_id
                                WHERE s.token_hash=? AND s.expires_at>? AND m.active=1""",
                             (digest(token), time.time())).fetchone()
        return dict(row) if row else None

    def logout(self, token: str):
        with self.connection() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (digest(token),))
