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
from backend.storage import InputModel, AssetInput
from tools.sheets import SheetsError

router = APIRouter(prefix="/api/shared-data", tags=["shared-data"])


class Commit(InputModel):
    operation_id: UUID
    expected_revision: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    expected_spreadsheet_id: str | None = None


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
        if self.store.binding(self.identity["household_id"])["spreadsheet_id"] != self.sid:
            fail("현재 관리 시트가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.")
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
        return {"revision": fingerprint(raw), "spreadsheet_id": self.sid, "state": state, "summary": summary(state),
                "viewer": projection(state, self.member_id), "permissions": self.store.permissions(self.identity["household_id"]), **extra}

    def authorize_changes(self, before, after):
        old, new = {key(r): r for r in before["records"]}, {key(r): r for r in after["records"]}
        permissions = self.store.permissions(self.identity["household_id"])
        for k in old.keys() | new.keys():
            previous, changed = old.get(k), new.get(k)
            if previous == changed:
                continue
            if k[0] == "trade_record" and previous:
                raise HTTPException(403, "기존 체결·보류 기록은 변경할 수 없습니다.")
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
        from backend.shared_read_cache import clear
        clear(self.config.db_path)
        self.store.activate(self.identity["household_id"], ready=True)
        return self.result(raw, state, replayed=True, backup_id=receipt["backup_id"])

    def commit(self, op, kind, request_hash, raw, before, after, extra_backup=None):
        after = validate(after, self.members)
        from backend.shared_ledger import read_tables, reconcile
        sheet_cells = read_tables(self.journal) if before else None
        if before and kind != 'recovery':
            if extra_backup and 'sheet_cells' in extra_backup:
                if sheet_cells != extra_backup['sheet_cells']:
                    fail('불러오는 동안 시트가 다시 바뀌었습니다. 다시 불러와 주세요.')
            elif reconcile(before, sheet_cells)[1]:
                fail('구글 시트에 아직 불러오지 않은 수정이 있습니다. 표로 보기에서 시트 변경 불러오기를 먼저 눌러 주세요.')
        backup = self.store.backup(kind, {"spreadsheet_id": self.sid, "members": self.members,
            "raw": raw, "before": before, "proposed": after, "sheet_cells": sheet_cells, **(extra_backup or {})})
        self.store.begin(op, self.identity, kind, request_hash, backup)
        self.store.activate(self.identity["household_id"])
        if self.journal.raw() != raw:
            fail("백업 뒤 공유 자료가 바뀌었습니다. 다시 불러온 뒤 새 요청으로 저장해 주세요.")
        if sheet_cells is not None and read_tables(self.journal) != sheet_cells:
            fail('저장 직전에 시트가 바뀌었습니다. 다시 불러와 주세요.')
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
        from backend.shared_read_cache import clear
        clear(self.config.db_path)
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
            if ((data.expected_spreadsheet_id is not None or self.store.version_selected(self.identity["household_id"]))
                    and data.expected_spreadsheet_id != self.sid):
                fail("현재 관리 시트가 바뀌었습니다. 초안을 보관하고 새로고침해 주세요.")
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
            if ((data.expected_spreadsheet_id is not None or self.store.version_selected(self.identity["household_id"]))
                    and data.expected_spreadsheet_id != self.sid):
                fail("현재 관리 시트가 바뀌었습니다. 다시 대조해 주세요.")
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
    from backend.shared_read_cache import current
    raw, state = current(s)
    return s.result(raw, state)


@router.get("/dashboard")
def dashboard(request: Request, owner: Literal["together", "me", "partner"] = "together"):
    from backend.shared_data_view import dashboard as project
    s = service(request)
    from backend.shared_read_cache import current
    raw, state = current(s)
    result = project(state, projection(state, s.member_id), owner)
    result["family"]["version"] = len(events(raw))
    return {**result, "revision": fingerprint(raw), "spreadsheet_id": s.sid}


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

# File version operations share the authenticated fixed-member boundary.
from backend.sheet_versions import router as versions_router
router.include_router(versions_router)

class AssetChange(Commit):
    asset_id: UUID
    asset: AssetInput | None = None


@router.post("/assets")
def change_asset(data: AssetChange, request: Request):
    from backend.storage import now
    s = service(request)
    s.access()
    raw, before = s.current()
    receipt = s.store.receipt(str(data.operation_id))
    stamp = now()
    if receipt:
        if receipt["user_id"] != s.identity["user_id"] or receipt["kind"] != "save":
            fail("다른 저장에 사용한 요청 ID입니다.")
        backup = s.store.load_backup(receipt["backup_id"])
        if backup["spreadsheet_id"] != s.sid:
            fail("저장 위치가 바뀌었습니다. 현재 자료를 다시 불러와 주세요.")
        raw, before = backup["raw"], backup["before"]
        proposed = next((r for r in backup["proposed"]["records"] if r["kind"] == "asset" and r["id"] == str(data.asset_id)), None)
        if proposed:
            stamp = proposed["payload"].get("updated_at", stamp)
    if data.expected_spreadsheet_id != s.sid or data.expected_revision != fingerprint(raw):
        fail("자료나 현재 관리 시트가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.")
    rid = str(data.asset_id)
    previous = next((r for r in before["records"] if r["kind"] == "asset" and r["id"] == rid), None)
    upsert, delete = [], []
    if data.asset is None:
        delete = [Deletion(kind="asset", id=rid)]
    else:
        parsed = data.asset
        values = parsed.model_dump(mode="json", exclude={"owner"})
        viewer = projection(before, s.member_id)
        member = "joint" if parsed.owner == "joint" else viewer[parsed.owner]
        if member == "joint" and viewer["me"] != s.members["me"]:
            values["share_percent"] = 100 - values["share_percent"]
        payload = {**(previous["payload"] if previous else {"source": "manual"}), **values,
                   "updated_at": stamp, "version": (previous["payload"].get("version", 0) if previous else 0) + 1}
        upsert = [Record(kind="asset", id=rid, member_id=member, payload=payload)]
    saved = s.save(Save(operation_id=data.operation_id, expected_revision=data.expected_revision,
        expected_spreadsheet_id=data.expected_spreadsheet_id, upsert=upsert, delete=delete))
    if data.asset is None:
        return saved
    from backend.shared_data_view import dashboard as project
    snap = project(saved["state"], saved["viewer"], "together")["snapshot"]
    rows = snap["assets"] + snap["debts"] + [g["account"] for g in snap["account_groups"]] + [r for g in snap["account_groups"] for r in g["details"]]
    return next(r for r in rows if r["id"] == rid)


@router.get('/ledger')
def ledger_view(request: Request):
    from backend.shared_ledger import tables, read_tables, reconcile
    from backend.shared_sheet_template import sections
    s = service(request)
    s.access()
    raw, state = s.current()
    meta = s.journal.meta()
    pending, issue = [], ''
    try:
        _, pending = reconcile(state, read_tables(s.journal))
    except HTTPException as error:
        issue = str(error.detail)
    tabs = sections(state)
    permissions = s.store.permissions(s.identity['household_id'])
    records = {key(r): r for r in state['records']}
    for title, tab in tables(state).items():
        tab['editable'] = [e if records[tuple(k)]['member_id'] in {s.member_id, 'joint', 'household'} or permissions.get(records[tuple(k)]['member_id']) else {} for k, e in zip(tab['keys'], tab['editable'])]
        tabs[title] = {**tab, 'rows': [[title + ' · 앱과 같은 자산 장부'], tab['headers'], *tab['rows']], 'headers': [1], 'summary': [], 'numbers': []}
    return {'revision': fingerprint(raw), 'spreadsheet_id': s.sid, 'tabs': tabs,
            'sheet_ids': {p['properties']['title']: p['properties']['sheetId'] for p in meta.get('sheets', [])},
            'pending': pending, 'issue': issue}


@router.post('/ledger/sync')
def sync_ledger(data: Commit, request: Request):
    from backend.shared_ledger import read_tables, reconcile
    s = service(request)
    op, rh = str(data.operation_id), fingerprint(data.model_dump(mode='json'))
    with s.store.operation():
        s.access(owner=True)
        if data.expected_spreadsheet_id != s.sid:
            fail('연결된 파일이 바뀌었습니다. 다시 불러와 주세요.')
        replay = s.replay(op, rh)
        if replay:
            return replay
        raw, before = s.current()
        if fingerprint(raw) != data.expected_revision:
            fail('앱 자료가 바뀌었습니다. 다시 불러온 뒤 시트 변경을 반영해 주세요.')
        cells = read_tables(s.journal)
        after, changes = reconcile(before, cells)
        if not changes:
            return s.result(raw, before, changed=0)
        s.authorize_changes(before, after)
        return {**s.commit(op, 'save', rh, raw, before, after, {'sheet_cells': cells}), 'changed': len(changes)}


class LedgerEdit(Commit):
    tab: Literal['자산 내역', '보유 종목']
    row_id: str
    column: Annotated[int, Field(ge=0, le=10)]
    value: str | int | None


@router.post('/ledger/edit')
def edit_ledger(data: LedgerEdit, request: Request):
    from backend.shared_ledger import tables, native_rows, reconcile
    s = service(request)
    op, rh = str(data.operation_id), fingerprint(data.model_dump(mode='json'))
    with s.store.operation():
        s.access(owner=True)
        if data.expected_spreadsheet_id != s.sid:
            fail('연결된 파일이 바뀌었습니다. 다시 불러와 주세요.')
        replay = s.replay(op, rh)
        if replay:
            return replay
        raw, before = s.current()
        if fingerprint(raw) != data.expected_revision:
            fail('다른 화면에서 자료가 바뀌었습니다. 다시 불러와 주세요.')
        cells = {title: [[title], tab['headers'], *native_rows(tab)] for title, tab in tables(before).items()}
        row = next((r for r in cells[data.tab][2:] if r[11] == data.row_id), None)
        if row is None:
            fail('수정할 행을 찾지 못했습니다. 다시 불러와 주세요.')
        row[data.column] = '' if data.value is None else data.value
        after, _ = reconcile(before, cells)
        s.authorize_changes(before, after)
        return s.commit(op, 'save', rh, raw, before, after)


@router.get('/ledger.xlsx')
def export_ledger(request: Request):
    from io import BytesIO
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter
    from fastapi.responses import Response
    from backend.shared_ledger import tables
    from backend.shared_sheet_template import sections
    s = service(request)
    s.access()
    _, state = s.current()
    views = sections(state)
    inputs = tables(state)
    order = ['우리 자산', '보유 종목', '자산 내역', '연금', '주식', '부동산', '현금·기타']
    book = Workbook(); book.remove(book.active)
    for title in order:
        sheet = book.create_sheet(title)
        rows = [[title], inputs[title]['headers'], *inputs[title]['rows']] if title in inputs else views[title]['rows']
        for row in rows:
            sheet.append(row)
        if title in views:
            for r, row in enumerate(views[title]['summary'], 2):
                for c, value in enumerate(row, 10):
                    sheet.cell(r, c, value)
        for row in sheet:
            for cell in row:
                cell.font = Font(name='Arial', size=11)
                if isinstance(cell.value, str):
                    cell.data_type = 's'  # User names are text, never executable formulas.
                elif isinstance(cell.value, (int, float)):
                    cell.number_format = '#,##0;[Red](#,##0);0'
                    cell.alignment = Alignment(horizontal='right')
                if cell.row <= 2:
                    cell.font = Font(name='Arial', size=11, bold=True)
                    cell.fill = PatternFill('solid', fgColor='EEF2F0')
        for c in range(1, sheet.max_column+1):
            sheet.column_dimensions[get_column_letter(c)].width = 24 if c <= 2 else 18
        sheet.freeze_panes = 'B3'
        if len(rows) > 2:
            sheet.auto_filter.ref = f'A2:{get_column_letter(len(rows[1]))}{len(rows)}'
    output = BytesIO(); book.save(output)
    return Response(output.getvalue(), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers={'Content-Disposition': 'attachment; filename="retire-together.xlsx"'})
