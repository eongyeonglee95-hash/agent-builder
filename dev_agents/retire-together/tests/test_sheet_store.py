"""SHEET-01: 시트가 원천일 때의 자산 장부 — 메모리 시트로 같은 규칙(버전 충돌·세부 자산·계좌 교체·이관)을 검증한다."""
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend import ledger, storage
from backend.main import app
from tools.sheets import ASSET_TAB, HOLDING_TAB, MemorySheets, parse_spreadsheet_id, SheetsError

HEADERS = {"Origin": "http://127.0.0.1", "X-Retire-Local": "1"}


@pytest.fixture
def sheet(monkeypatch, tmp_path):
    mem = MemorySheets()
    mem.ensure_tabs()
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "ledger.sqlite3")
    monkeypatch.setattr(ledger, "open_sheets", lambda: mem)
    return mem


@pytest.fixture
def client(sheet):
    with TestClient(app, base_url="http://127.0.0.1", headers=HEADERS) as c:
        yield c


def asset(**kw):
    return {"name": "내 연금저축", "account": "미래에셋 연금저축", "owner": "me", "pocket": "retirement", "assetClass": "stock",
            "amount": 1_000_000, "as_of": "2026-10-27", "request_id": str(uuid4()), **kw}


def test_assets_live_in_the_sheet_not_sqlite(client, sheet):
    r = client.post("/api/assets", json=asset())
    assert r.status_code == 201, r.text
    created = r.json()
    assert sheet.tabs[ASSET_TAB][0]["id"] == created["id"] and sheet.tabs[ASSET_TAB][0]["amount"] == 1_000_000
    assert storage.list_local_assets() == []
    assert client.get("/api/dashboard").json()["total"] == 1_000_000
    # 시트에서 직접 고친 값이 앱에 보인다
    sheet.tabs[ASSET_TAB][0]["amount"] = "2,000,000".replace(",", "")
    ledger._STORE_CACHE = None
    assert client.get("/api/dashboard").json()["total"] == 2_000_000


def test_version_conflict_and_delete_rules(client, sheet):
    a = client.post("/api/assets", json=asset()).json()
    body = {k: a[k] for k in ("name", "account", "owner", "pocket", "assetClass", "amount", "as_of")}
    assert client.put(f"/api/assets/{a['id']}", json={**body, "amount": 5, "version": 99}).status_code == 409
    ok = client.put(f"/api/assets/{a['id']}", json={**body, "amount": 5, "version": 1})
    assert ok.status_code == 200 and ok.json()["version"] == 2
    child = client.post("/api/assets", json=asset(name="KODEX 200", parent_id=a["id"]))
    assert child.status_code == 201, child.text
    assert client.delete(f"/api/assets/{a['id']}?version=2").status_code == 409   # 세부 자산이 달려 있음
    assert client.delete(f"/api/assets/{child.json()['id']}?version=1").status_code == 204
    assert client.delete(f"/api/assets/{a['id']}?version=2").status_code == 204
    assert sheet.tabs[ASSET_TAB] == []


def test_duplicate_account_rejected_on_sheet_too(client):
    assert client.post("/api/assets", json=asset()).status_code == 201
    assert client.post("/api/assets", json=asset(account="미래에셋  연금저축")).status_code == 409


def test_replace_account_assets_keeps_manual_rows(client, sheet):
    manual = client.post("/api/assets", json=asset(name="직접 입력", account="키움 일반")).json()
    store = ledger.sheet_store()
    first = store.replace_account_assets("me_mirae_pension_new", "capture", [
        {"name": "연금저축(신) · 주식", "account": "연금저축(신)", "owner": "me", "pocket": "retirement", "assetClass": "stock", "amount": 100, "as_of": "2026-10-27"},
        {"name": "연금저축(신) · 금", "account": "연금저축(신)", "owner": "me", "pocket": "retirement", "assetClass": "gold", "amount": 50, "as_of": "2026-10-27"},
    ])
    assert len(first) == 2 and all(r["source"] == "capture" for r in first)
    second = store.replace_account_assets("me_mirae_pension_new", "file", [
        {"name": "연금저축(신) · 주식", "account": "연금저축(신)", "owner": "me", "pocket": "retirement", "assetClass": "stock", "amount": 70, "as_of": "2026-10-28"},
    ])
    names = sorted(r["name"] for r in store.list_assets())
    assert names == ["연금저축(신)", "연금저축(신) · 주식", "직접 입력"]
    assert next(r for r in store.list_assets() if r["id"] == manual["id"])["amount"] == 1_000_000
    assert second[0]["amount"] == 70


def test_holdings_tab_replaced_per_account(sheet):
    store = ledger.sheet_store()
    store.replace_holdings("acct_a", [{"ticker_name": "A", "ticker": "000001", "qty": 1, "price": 10}], "2026-10-27")
    store.replace_holdings("acct_b", [{"ticker_name": "B", "ticker": None, "qty": 2, "price": 20}], "2026-10-27")
    store.replace_holdings("acct_a", [{"ticker_name": "A2", "ticker": "000002", "qty": 3, "price": 30}], "2026-10-28")
    rows = store.list_holdings()
    assert [(r["account_id"], r["ticker_name"]) for r in rows] == [("acct_b", "B"), ("acct_a", "A2")]
    assert store.list_holdings(["acct_a"])[0]["as_of"] == "2026-10-28"


def test_import_local_ledger_into_empty_sheet(client, sheet, monkeypatch):
    monkeypatch.setattr(ledger, "open_sheets", lambda: None)
    local = client.post("/api/assets", json=asset()).json()
    assert storage.list_local_assets()
    monkeypatch.setattr(ledger, "open_sheets", lambda: sheet)
    store = ledger.sheet_store()
    assert store.import_assets(storage.list_local_assets()) == 1
    assert store.import_assets(storage.list_local_assets()) == 0
    assert store.list_assets()[0]["id"] == local["id"]


def test_sheet_errors_become_503_not_crash(client, sheet, monkeypatch):
    def boom(tab):
        raise SheetsError("권한이 없어요")
    monkeypatch.setattr(sheet, "read", boom)
    r = client.get("/api/assets")
    assert r.status_code == 503 and "권한" in r.json()["detail"]


def test_wrong_header_in_sheet_is_reported(sheet):
    class Bad(MemorySheets):
        def read(self, tab):
            raise SheetsError("'자산' 탭의 머리글이 앱 양식과 달라요")
    store = ledger.SheetStore(Bad())
    with pytest.raises(HTTPException) as e:
        store.list_assets()
    assert e.value.status_code == 503 and "머리글" in e.value.detail


@pytest.mark.parametrize("text,expected", [
    ("https://docs.google.com/spreadsheets/d/1AbC-xyz_0123456789abcdefghij/edit#gid=0", "1AbC-xyz_0123456789abcdefghij"),
    ("1AbC-xyz_0123456789abcdefghij", "1AbC-xyz_0123456789abcdefghij"),
])
def test_parse_spreadsheet_id(text, expected):
    assert parse_spreadsheet_id(text) == expected


def test_parse_spreadsheet_id_rejects_other_urls():
    with pytest.raises(SheetsError):
        parse_spreadsheet_id("https://example.com/not-a-sheet")


def test_tests_never_touch_real_sheets(client):
    """conftest가 RETIRE_SHEETS=off 를 켠다 — 연결 설정 API는 테스트 모드를 알린다."""
    status = client.get("/api/google/status").json()
    assert status["disabled"] is True
