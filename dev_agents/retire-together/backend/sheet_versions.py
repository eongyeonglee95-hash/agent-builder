"""Explicit file versions. Inspection never changes the current writing destination."""
from uuid import UUID
from typing import Annotated

from fastapi import APIRouter, Request
from pydantic import Field

from backend.shared_data_google import Journal, head
from backend.shared_data_schema import fail, fingerprint, projection, summary, validate
from backend.shared_data_view import dashboard
from backend.shared_sheets_google import DRIVE, file_id
from backend.storage import InputModel

router = APIRouter(prefix="/versions")


def service(request):
    from backend.shared_data import service as current
    return current(request)


class Selection(InputModel):
    spreadsheet_id: str


class Switch(Selection):
    current_spreadsheet_id: str
    current_revision: str
    target_revision: str


class CopyVersion(InputModel):
    operation_id: UUID
    current_spreadsheet_id: str
    current_revision: str
    title: Annotated[str, Field(min_length=1, max_length=100)]


def inspect(s, sid):
    sid = file_id(sid)
    # Versions belong to the same fixed owner and financial household.
    # Never import arbitrary foreign member ids or rewrite them to this family.
    meta = s.api.owned(sid)
    s.api.validate(sid)
    raw = Journal(s.api, sid).raw()
    state = validate(head(raw), s.members)
    return meta, raw, state


def result(s, sid, meta, raw, state):
    return {"spreadsheet_id": sid, "title": meta.get("name", "우리 자산"),
            "url": f"https://docs.google.com/spreadsheets/d/{sid}/edit",
            "revision": fingerprint(raw), "summary": summary(state), "state": state,
            **dashboard(state, projection(state, s.member_id), "together")}


@router.get("")
def listing(request: Request):
    s = service(request)
    s.access(owner=True)
    meta, raw, state = inspect(s, s.sid)
    s.store.remember_version(s.identity["household_id"], s.sid, meta.get("name", "우리 자산"))
    return {"current": result(s, s.sid, meta, raw, state), "versions": s.store.versions(s.identity["household_id"])}


@router.post("/preview")
def preview(data: Selection, request: Request):
    s = service(request)
    s.access(owner=True)
    meta, raw, state = inspect(s, data.spreadsheet_id)
    # A preview does not register or activate the file.
    return result(s, data.spreadsheet_id, meta, raw, state)


@router.post("/activate")
def activate(data: Switch, request: Request):
    s = service(request)
    with s.store.operation():
        s.access(owner=True)
        if s.sid != data.current_spreadsheet_id:
            fail("현재 관리 시트가 바뀌었습니다. 다시 확인해 주세요.")
        old_meta, raw, before = inspect(s, s.sid)
        meta, target_raw, after = inspect(s, data.spreadsheet_id)
        if fingerprint(raw) != data.current_revision or fingerprint(target_raw) != data.target_revision:
            fail("확인 후 자료가 바뀌었습니다. 두 파일을 다시 확인해 주세요.")
        # Selecting an older file must not bypass spouse edit permission.
        s.authorize_changes(before, after)
        with s.store.connection() as db:
            members = db.execute("SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.household_id=? AND m.role='partner' AND m.active=1", (s.identity["household_id"],)).fetchall()
        if members:
            from backend.household_invites_google import valid_writer
            permissions = s.api.permissions(data.spreadsheet_id)
            if any(not any(valid_writer(p, m[0]) for p in permissions) for m in members):
                fail("새 파일을 배우자에게 편집자로 공유한 뒤 다시 지정해 주세요. 현재 시트는 유지됩니다.")
        backup = s.store.backup("file_switch", {"spreadsheet_id": s.sid, "target_id": data.spreadsheet_id,
            "members": s.members, "raw": raw, "target_raw": target_raw, "before": before, "proposed": after})
        # Detect external edits during backup; neither file is overwritten.
        if Journal(s.api, s.sid).raw() != raw or Journal(s.api, data.spreadsheet_id).raw() != target_raw:
            fail("전환 준비 중 자료가 바뀌었습니다. 다시 확인해 주세요.")
        s.store.remember_version(s.identity["household_id"], s.sid, old_meta.get("name", "우리 자산"))
        s.store.remember_version(s.identity["household_id"], data.spreadsheet_id, meta.get("name", "우리 자산"))
        s.store.select_version(s.identity["household_id"], data.spreadsheet_id)
        return {"spreadsheet_id": data.spreadsheet_id, "backup_id": backup}


@router.post("/copy")
def copy_version(data: CopyVersion, request: Request):
    s = service(request)
    with s.store.operation():
        s.access(owner=True)
        if s.sid != data.current_spreadsheet_id:
            fail("현재 관리 시트가 바뀌었습니다. 다시 확인해 주세요.")
        meta, raw, state = inspect(s, s.sid)
        if fingerprint(raw) != data.current_revision:
            fail("자료가 바뀌었습니다. 최신 자료를 불러온 뒤 버전을 만들어 주세요.")
        op = str(data.operation_id)
        with s.store.connection() as db:
            receipt = db.execute("SELECT * FROM sheet_copies WHERE operation_id=?", (op,)).fetchone()
        if receipt:
            if (receipt["household_id"], receipt["source_id"], receipt["title"]) != (s.identity["household_id"], s.sid, data.title):
                fail("다른 내용에 사용한 요청 ID입니다.")
            sid = receipt["spreadsheet_id"] or s.api.recover(op)
        else:
            s.api._token()
            with s.store.connection() as db:
                db.execute("INSERT INTO sheet_copies VALUES (?,?,?,?,NULL)", (op, s.identity["household_id"], s.sid, data.title))
            # A lost response is reconciled by appProperties on retry, never by
            # another copy. Copy keeps the complete journal and all other tabs.
            copied = s.api.call("POST", f"{DRIVE}/{s.sid}/copy", params={"fields": "id"},
                json={"name": data.title, "appProperties": {"retire_operation": op}})
            sid = file_id(copied.get("id"))
        with s.store.connection() as db:
            db.execute("UPDATE sheet_copies SET spreadsheet_id=? WHERE operation_id=?", (sid, op))
        target_meta, target_raw, target = inspect(s, sid)
        if fingerprint(target) != fingerprint(state):
            fail("복사 중 원본이 변경되었습니다. 복사 파일을 다시 확인해 주세요.")
        s.store.remember_version(s.identity["household_id"], sid, target_meta.get("name", data.title))
        return result(s, sid, target_meta, target_raw, target)
