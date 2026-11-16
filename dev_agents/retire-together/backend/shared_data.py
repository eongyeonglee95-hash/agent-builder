"""SHARE-05 server API. SHARE-06 connects the UI to these fixed-member contracts."""
from copy import deepcopy
import sqlite3
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import Field

from backend import shared_sheets
from backend.household_invites_google import SharingGoogle
from backend.shared_data_google import Journal, events, head
from backend.shared_data_schema import IMMUTABLE, Record, fail, fingerprint, key, projection, summary, validate
from backend.shared_data_source import local_sources, merge, sheet_sources
from backend.shared_data_store import DataStore
from backend.storage import InputModel
from tools.sheets import SheetsError

router = APIRouter(prefix="/api/shared-data", tags=["shared-data"])


class Commit(InputModel):
    operation_id: UUID
    expected_revision: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class MigrationCommit(InputModel):
    operation_id: UUID
    preview_id: UUID
    choices: dict[str, str] = {}


class MigrationReview(InputModel):
    preview_id: UUID
    choices: dict[str, str] = {}


class Deletion(InputModel):
    kind: str
    id: str


class Save(Commit):
    upsert: Annotated[list[Record], Field(max_length=500)] = []
    delete: Annotated[list[Deletion], Field(max_length=500)] = []


class Recovery(Commit):
    backup_id: UUID
    # Explicit choice: before a failed write, or the proposed result of that write.
    version: Annotated[str, Field(pattern=r"^(before|proposed)$")] = "before"


class Permission(InputModel):
    allow_other: Annotated[bool, Field(strict=True)]


class Service:
    def __init__(self, config, identity):
        shared_sheets.enabled()
        self.identity = identity
        self.store = DataStore(config.db_path)
        self.members = self.store.people(identity)
        self.member_id = self.members["me" if identity["role"] == "owner" else "partner"]
        self.config = config
        binding = self.store.binding(identity["household_id"])
        if not binding or not binding["ready"] or not binding["spreadsheet_id"]:
            fail("공통 파일 연결을 먼저 완료해 주세요. 로컬 자료로 전환하지 않았습니다.")
        self.sid = binding["spreadsheet_id"]
        self.api = SharingGoogle(config, self.store, identity["user_id"])
        self.journal = Journal(self.api, self.sid)

    def access(self, *, owner=False):
        self.store.owner(self.identity) if owner else self.store.member(self.identity)
        # Always verify fixed owner, and read/write with the actor's own grant.
        SharingGoogle(self.config, self.store, self.identity["owner_user_id"]).owned(self.sid)
        if self.identity["role"] != "owner":
            self.api.accessible(self.sid)

    def current(self):
        raw = self.journal.raw()
        state = head(raw)
        if state is None:
            fail("공유 자료 이전을 먼저 완료하거나 기존 자료를 복구해 주세요.")
        return raw, validate(state, self.members)

    def result(self, raw, state, **extra):
        return {"revision": fingerprint(raw), "state": state, "summary": summary(state),
                "viewer": projection(state, self.member_id), "permissions": self.store.permissions(self.identity["household_id"]), **extra}

    def authorize_changes(self, before, after):
        old, new = {key(r): r for r in before["records"]}, {key(r): r for r in after["records"]}
        permissions = self.store.permissions(self.identity["household_id"])
        for k in old.keys() | new.keys():
            previous, changed = old.get(k), new.get(k)
            if previous == changed:
                continue
            if k[0] in IMMUTABLE:
                raise HTTPException(403, "공통 투자 규칙·기존 결정 이력은 이 저장 요청으로 변경할 수 없습니다.")
            if previous and changed and previous["member_id"] != changed["member_id"]:
                raise HTTPException(403, "자료의 명의를 저장 요청으로 바꿀 수 없습니다.")
            member = (previous or changed)["member_id"]
            if member not in {self.member_id, "household", "joint"} and not permissions.get(member):
                raise HTTPException(403, "상대방이 자기 자료의 앱 편집을 허용해야 합니다.")
            # A mixed pool changes investment selection for every account in it.
            if k[0] == "pool":
                owners = {r["member_id"] for r in before["records"] + after["records"] if r["kind"] == "account" and r["payload"].get("pool") == k[1]}
                if any(m != self.member_id and not permissions.get(m) for m in owners):
                    raise HTTPException(403, "묶음의 모든 명의자가 편집을 허용해야 합니다.")

    def replay(self, op, request_hash):
        receipt = self.store.receipt(op)
        if receipt is None:
            return None
        if receipt["user_id"] != self.identity["user_id"] or receipt["request_hash"] != request_hash:
            fail("이미 다른 내용에 사용된 저장 요청 ID입니다.")
        raw = self.journal.raw()
        found = next((e for e in events(raw) if e["id"] == op), None)
        if found is None:
            fail("이전 저장 결과가 불확실합니다. 자동 재전송하지 않았습니다. 백업 대조 후 복구해 주세요.")
        state = validate(head(raw), self.members)
        expected = self.store.load_backup(receipt["backup_id"])["proposed"]
        if fingerprint(found["state"]) != fingerprint(expected):
            fail("저장 결과가 직접 편집되었습니다. 백업 대조 후 복구해 주세요.")
        self.store.finish(op, fingerprint(expected))
        self.store.activate(self.identity["household_id"], ready=True)
        return self.result(raw, state, replayed=True, backup_id=receipt["backup_id"])

    def commit(self, op, kind, request_hash, raw, before, after, extra_backup=None):
        after = validate(after, self.members)
        backup = self.store.backup(kind, {"spreadsheet_id": self.sid, "members": self.members,
            "raw": raw, "before": before, "proposed": after, **(extra_backup or {})})
        self.store.begin(op, self.identity, kind, request_hash, backup)
        self.store.activate(self.identity["household_id"])
        if self.journal.raw() != raw:
            fail("백업 뒤 공유 자료가 바뀌었습니다. 다시 불러온 뒤 새 요청으로 저장해 주세요.")
        try:
            self.journal.append(op, fingerprint(raw), kind, after)
        except HTTPException:
            # An error may mean the reply was lost after an atomic Google write.
            recovered = self.replay(op, request_hash)
            if recovered:
                return recovered
            raise
        got_raw, got = self.current()
        if fingerprint(got) != fingerprint(after) or summary(got) != summary(after):
            fail("저장 후 건수·합계·명의 대조가 일치하지 않습니다. 백업을 확인해 주세요.")
        self.store.finish(op, fingerprint(after))
        self.store.activate(self.identity["household_id"], ready=True)
        return self.result(got_raw, got, backup_id=backup, replayed=False)

    def preview(self):
        with self.store.operation():
            self.access(owner=True)
            raw = self.journal.raw()
            if raw or self.store.started(self.identity["household_id"]):
                fail("이미 이전을 시작한 가구입니다. 공유 자료·복구 경로를 사용해 주세요.")
            local, archive = local_sources(self.members)
            legacy_raw = self.journal.legacy_raw()
            legacy = self.journal.legacy()
            remote = sheet_sources(legacy, local, self.members)
            proposed, conflicts = merge(local, remote)
            # Preserve both sources even when the candidate needs reconciliation.
            body = {"spreadsheet_id": self.sid, "members": self.members, "archive": archive,
                    "local": local, "remote": remote, "legacy_raw": legacy_raw, "legacy": legacy,
                    "raw": raw, "before": None, "proposed": proposed, "conflicts": conflicts}
            bid = self.store.backup("preview", body)
            return {"preview_id": bid, "source_digest": fingerprint(archive), "local": summary(local),
                    "sheet": summary(remote), "proposed": summary(proposed), "conflicts": conflicts,
                    "state": proposed, "members": self.members, "requires_confirmation": True}

    def migrate(self, data):
        op, rh = str(data.operation_id), fingerprint(data.model_dump(mode="json"))
        with self.store.operation():
            self.access(owner=True)
            replay = self.replay(op, rh)
            if replay:
                return replay
            plan = self.store.load_backup(str(data.preview_id), kind="preview")
            if plan["spreadsheet_id"] != self.sid or plan["members"] != self.members:
                fail()
            raw = self.journal.raw()
            if raw or self.store.started(self.identity["household_id"]):
                fail("이미 이전이 시작되었습니다. 같은 요청 재조회 또는 복구를 사용해 주세요.")
            _, archive = local_sources(self.members)
            if fingerprint(archive) != fingerprint(plan["archive"]) or self.journal.legacy_raw() != plan["legacy_raw"] or self.journal.legacy() != plan["legacy"]:
                fail("이전 미리보기 뒤 원본이 변경되었습니다. 다시 대조해 주세요.")
            after, conflicts = merge(plan["local"], plan["remote"], data.choices)
            if set(data.choices) != {c["key"] for c in conflicts}:
                fail("기존 시트와 로컬 자료의 모든 충돌을 먼저 선택해 주세요.")
            return self.commit(op, "migration", rh, raw, None, after, {"source_backup_id": str(data.preview_id)})

    def save(self, data):
        op, rh = str(data.operation_id), fingerprint(data.model_dump(mode="json"))
        with self.store.operation():
            self.access()
            replay = self.replay(op, rh)
            if replay:
                return replay
            raw, before = self.current()
            if fingerprint(raw) != data.expected_revision:
                fail("다른 화면이나 시트에서 자료가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.")
            records = {key(r): r for r in before["records"]}
            touched = set()
            for r in [*data.upsert, *data.delete]:
                k = r.kind, r.id
                if k in touched:
                    fail("같은 자료가 저장 요청에 두 번 있습니다.")
                touched.add(k)
            for r in data.upsert:
                records[(r.kind, r.id)] = r.model_dump()
            for r in data.delete:
                if (r.kind, r.id) not in records:
                    fail("삭제할 자료를 찾을 수 없습니다.")
                del records[(r.kind, r.id)]
            after = validate({**before, "records": list(records.values())}, self.members)
            self.authorize_changes(before, after)
            return self.commit(op, "save", rh, raw, before, after)

    def recover(self, data):
        op, rh = str(data.operation_id), fingerprint(data.model_dump(mode="json"))
        with self.store.operation():
            self.access(owner=True)
            replay = self.replay(op, rh)
            if replay:
                return replay
            raw = self.journal.raw()
            if fingerprint(raw) != data.expected_revision:
                fail("복구 대조 뒤 시트가 변경되었습니다. 다시 확인해 주세요.")
            backup = self.store.load_backup(str(data.backup_id))
            if backup["spreadsheet_id"] != self.sid or backup["members"] != self.members:
                fail()
            after = backup.get(data.version)
            if after is None:
                fail("선택한 백업 버전에는 공유 자료가 없습니다.")
            after = validate(after, self.members)
            # The last complete proposed version is used for permissions even if
            # its parent hash reports a race. Recovery never grants edit rights.
            try:
                parsed = events(raw)
                before = validate(parsed[-1]["state"], self.members) if parsed else None
            except HTTPException:
                before = None
            if before is None:
                before = self.store.latest_proposed()
                if before is not None:
                    before = validate(before, self.members)
            if before:
                self.authorize_changes(before, after)
            return self.commit(op, "recovery", rh, raw, before, after)


def service(request):
    config, identity, _ = shared_sheets.context(request, member=True)
    return Service(config, identity)


def write_result(action):
    try:
        return action()
    except (OSError, ValueError, KeyError, TypeError, AttributeError, sqlite3.Error, SheetsError):
        raise HTTPException(409, "원본 또는 백업의 형식·접근 상태를 확인해 주세요. 같은 요청의 결과를 조회할 수 있습니다.") from None


@router.get("")
def read(request: Request):
    s = service(request)
    s.access()
    raw, state = s.current()
    return s.result(raw, state)


@router.get("/dashboard")
def dashboard(request: Request, owner: Literal["together", "me", "partner"] = "together"):
    from backend.shared_data_view import dashboard as project
    s = service(request)
    s.access()
    _, state = s.current()
    return project(state, projection(state, s.member_id), owner)


@router.post("/migration/preview")
def preview(request: Request):
    try:
        return service(request).preview()
    except (OSError, ValueError, KeyError, TypeError, AttributeError, sqlite3.Error, SheetsError):
        raise HTTPException(409, "이전 원본의 형식·접근 상태를 확인해 주세요. 원본은 변경하지 않았습니다.") from None


@router.post("/migration/commit")
def migrate(data: MigrationCommit, request: Request):
    return write_result(lambda: service(request).migrate(data))


@router.post("/migration/review")
def review_migration(data: MigrationReview, request: Request):
    s = service(request)
    s.access(owner=True)
    plan = s.store.load_backup(str(data.preview_id), kind="preview")
    if plan["spreadsheet_id"] != s.sid or plan["members"] != s.members:
        fail()
    after, conflicts = merge(plan["local"], plan["remote"], data.choices)
    if set(data.choices) != {c["key"] for c in conflicts}:
        fail("기존 시트와 로컬 자료의 모든 충돌을 먼저 선택해 주세요.")
    after = validate(after, s.members)
    return {"state": after, "proposed": summary(after)}


@router.post("/save")
def save(data: Save, request: Request):
    return write_result(lambda: service(request).save(data))


@router.put("/permissions")
def permission(data: Permission, request: Request):
    s = service(request)
    with s.store.operation():
        s.access()
        s.store.set_permission(s.identity, data.allow_other)
    return s.store.permissions(s.identity["household_id"])


@router.get("/recovery")
def recovery_status(request: Request):
    s = service(request)
    s.access(owner=True)
    raw = s.journal.raw()
    return {"revision": fingerprint(raw), "backups": s.store.backup_list()}


@router.get("/recovery/{backup_id}")
def recovery_preview(backup_id: UUID, request: Request):
    s = service(request)
    s.access(owner=True)
    backup = s.store.load_backup(str(backup_id))
    # Private original bytes and the server filesystem path never leave the API.
    return {"revision": fingerprint(s.journal.raw()), "before": backup.get("before"), "proposed": backup.get("proposed"),
            "before_summary": summary(backup["before"]) if backup.get("before") else None,
            "proposed_summary": summary(backup["proposed"]) if backup.get("proposed") else None}


@router.post("/recovery")
def recover(data: Recovery, request: Request):
    return write_result(lambda: service(request).recover(data))
