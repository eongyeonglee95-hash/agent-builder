"""Private control plane: people mapping, permissions, durable receipts, backups.

Financial truth is in Sheets. These files are explicit backups/recovery records,
never a fallback ledger. They contain no Google tokens or authentication DB copy.
"""
from contextlib import contextmanager
from hashlib import sha256
import json
import os
from uuid import UUID, uuid4, uuid5

from fastapi import HTTPException

from backend.shared_data_schema import encoded, fail
from backend.shared_sheets_store import SheetStore

SCHEMA = """
CREATE TABLE IF NOT EXISTS shared_people (
 household_id INTEGER NOT NULL, role TEXT NOT NULL,
 member_id TEXT NOT NULL UNIQUE, user_id TEXT, allow_other INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(household_id,role)
);
CREATE TRIGGER IF NOT EXISTS fixed_shared_person BEFORE UPDATE OF member_id,role,household_id ON shared_people
BEGIN SELECT RAISE(ABORT, 'financial person is immutable'); END;
CREATE TRIGGER IF NOT EXISTS fixed_shared_user BEFORE UPDATE OF user_id ON shared_people
WHEN OLD.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id
BEGIN SELECT RAISE(ABORT, 'financial identity cannot be reassigned'); END;
CREATE TRIGGER IF NOT EXISTS keep_shared_person BEFORE DELETE ON shared_people
BEGIN SELECT RAISE(ABORT, 'financial person must be retained'); END;
CREATE TABLE IF NOT EXISTS shared_data_operations (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, request_hash TEXT NOT NULL,
 backup_id TEXT NOT NULL, status TEXT NOT NULL, result_hash TEXT
);
CREATE TABLE IF NOT EXISTS shared_data_backups (
 id TEXT PRIMARY KEY, checksum TEXT NOT NULL, kind TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shared_data_control (
 household_id INTEGER PRIMARY KEY, active INTEGER NOT NULL DEFAULT 0
);
"""


class DataStore(SheetStore):
    @contextmanager
    def connection(self):
        with super().connection() as db:
            db.executescript(SCHEMA)
            yield db

    def people(self, identity):
        self.member(identity)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            owner = db.execute("SELECT owner_user_id FROM households WHERE id=?", (identity["household_id"],)).fetchone()[0]
            for role, alias in (("owner", "me"), ("partner", "partner")):
                member = str(uuid5(UUID(owner), "financial-person:" + role))
                db.execute("INSERT OR IGNORE INTO shared_people(household_id,role,member_id,user_id) VALUES (?,?,?,?)",
                           (identity["household_id"], role, member, owner if role == "owner" else None))
            current = db.execute("SELECT * FROM shared_people WHERE household_id=? AND role=?", (identity["household_id"], identity["role"])).fetchone()
            if current["user_id"] not in (None, identity["user_id"]):
                raise HTTPException(403, "다른 배우자의 기존 자료를 새 계정에 자동 배정하지 않습니다. 사람 연결을 확인해 주세요.")
            db.execute("UPDATE shared_people SET user_id=? WHERE member_id=? AND user_id IS NULL", (identity["user_id"], current["member_id"]))
            # Bind an already invited spouse during owner migration as well.
            partner = db.execute("SELECT user_id FROM memberships WHERE household_id=? AND role='partner' AND active=1", (identity["household_id"],)).fetchone()
            if partner:
                db.execute("UPDATE shared_people SET user_id=? WHERE household_id=? AND role='partner' AND user_id IS NULL", (partner[0], identity["household_id"]))
            rows = db.execute("SELECT * FROM shared_people WHERE household_id=?", (identity["household_id"],)).fetchall()
        return {"me" if r["role"] == "owner" else "partner": r["member_id"] for r in rows}

    def permissions(self, household_id):
        with self.connection() as db:
            return {r["member_id"]: bool(r["allow_other"]) for r in db.execute("SELECT * FROM shared_people WHERE household_id=?", (household_id,))}

    def set_permission(self, identity, allow_other):
        members = self.people(identity)
        member = members["me" if identity["role"] == "owner" else "partner"]
        with self.connection() as db:
            db.execute("UPDATE shared_people SET allow_other=? WHERE member_id=? AND user_id=?", (int(allow_other), member, identity["user_id"]))

    def started(self, household_id):
        with self.connection() as db:
            return db.execute("SELECT 1 FROM shared_data_control WHERE household_id=?", (household_id,)).fetchone() is not None

    def activate(self, household_id, *, ready=False):
        with self.connection() as db:
            db.execute("INSERT INTO shared_data_control VALUES (?,?) ON CONFLICT(household_id) DO UPDATE SET active=max(active,excluded.active)", (household_id, int(ready)))

    def receipt(self, op):
        with self.connection() as db:
            r = db.execute("SELECT * FROM shared_data_operations WHERE id=?", (op,)).fetchone()
        return dict(r) if r else None

    def begin(self, op, identity, kind, request_hash, backup):
        with self.connection() as db:
            db.execute("INSERT INTO shared_data_operations VALUES (?,?,?,?,?,'pending',NULL)", (op, identity["user_id"], kind, request_hash, backup))

    def finish(self, op, result_hash):
        with self.connection() as db:
            db.execute("UPDATE shared_data_operations SET status='complete',result_hash=? WHERE id=?", (result_hash, op))

    def latest_proposed(self):
        """Permission baseline when the remote journal itself is unreadable."""
        with self.connection() as db:
            row = db.execute("SELECT backup_id FROM shared_data_operations ORDER BY rowid DESC LIMIT 1").fetchone()
        return self.load_backup(row[0])["proposed"] if row else None

    @property
    def backup_dir(self):
        return self.path.parent / "shared-data-backups"

    def backup(self, kind, body):
        self.backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.backup_dir.is_symlink():
            fail()
        self.backup_dir.chmod(0o700)
        bid, raw = str(uuid4()), encoded(body).encode()
        path = self.backup_dir / (bid + ".json")
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "wb") as file:
            file.write(raw)
            file.flush()
            os.fsync(file.fileno())
        directory_fd = os.open(self.backup_dir, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        with self.connection() as db:
            db.execute("INSERT INTO shared_data_backups VALUES (?,?,?)", (bid, sha256(raw).hexdigest(), kind))
        return bid

    def load_backup(self, bid, *, kind=None):
        try:
            UUID(bid)
        except (ValueError, TypeError):
            fail()
        with self.connection() as db:
            row = db.execute("SELECT * FROM shared_data_backups WHERE id=?", (bid,)).fetchone()
        if row is None or (kind and row["kind"] != kind):
            raise HTTPException(404, "복구 자료를 찾을 수 없습니다.")
        path = self.backup_dir / (bid + ".json")
        try:
            if path.is_symlink():
                fail()
            raw = path.read_bytes()
            if sha256(raw).hexdigest() != row["checksum"]:
                fail("백업 무결성 검사에 실패했습니다. 원본을 덮어쓰지 않았습니다.")
            return json.loads(raw)
        except (OSError, ValueError):
            fail("백업을 읽을 수 없습니다. 원본을 덮어쓰지 않았습니다.")

    def backup_list(self):
        with self.connection() as db:
            return [dict(r) for r in db.execute("SELECT id,kind FROM shared_data_backups ORDER BY rowid DESC LIMIT 100")]
