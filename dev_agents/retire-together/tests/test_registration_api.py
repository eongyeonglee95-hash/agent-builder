"""REG-01 등록 API: 파일·캡처 → 확인 표 → 저장. 실제 규칙 파일·구글 시트·Claude 비전은 쓰지 않는다."""
from datetime import date
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend import ledger, registration, storage
from backend.main import app
from tools import store as snapshots
from tools.sheets import ASSET_TAB, HOLDING_TAB, MemorySheets

HEADERS = {"Origin": "http://127.0.0.1", "X-Retire-Local": "1"}
ACCOUNTS_YAML = """accounts:
  - id: me_test_pension
    label: 테스트 연금저축
    owner: me
    broker: mirae
    account_type: pension_savings
    pocket: pension
    active: true
  - id: spouse_test_general
    label: 배우자 일반계좌
    owner: spouse
    broker: kiwoom
    account_type: general
    pocket: cash
    active: true
  - id: me_old
    label: 안 쓰는 계좌
    owner: me
    broker: mirae
    account_type: isa
    pocket: cash
    active: false
pools: {}
"""


@pytest.fixture
def env(tmp_path, monkeypatch):
    (tmp_path / "accounts.yaml").write_text(ACCOUNTS_YAML, encoding="utf-8")
    (tmp_path / "asset_map.yaml").write_text("assets:\n  KODEX 200:\n    ticker: '069500'\n    asset_class: stock\n    status: confirmed\nclass_defaults: {}\n", encoding="utf-8")
    monkeypatch.setenv("RETIRE_ACCOUNTS_PATH", str(tmp_path / "accounts.yaml"))
    monkeypatch.setenv("RETIRE_ASSET_MAP_PATH", str(tmp_path / "asset_map.yaml"))
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "ledger.sqlite3")
    return tmp_path


@pytest.fixture
def client(env):
    with TestClient(app, base_url="http://127.0.0.1", headers=HEADERS) as c:
        c.put("/api/family", json={"me": {"name": "나", "age": 40, "gender": "unspecified", "role": "wife"}, "partner": None, "retirement_age": 62, "target_amount": 3_000_000_000, "version": 0})
        yield c


CSV = "종목명,종목코드,수량,현재가,평가금액\nKODEX 200,069500,10,35000,350000\n새로운 채권 ETF,453850,20,10000,200000\n".encode("utf-8-sig")


def test_accounts_list_hides_inactive_and_maps_owner(client):
    rows = client.get("/api/register/accounts").json()
    assert [r["id"] for r in rows] == ["me_test_pension", "spouse_test_general"]
    assert rows[1]["owner"] == "partner" and rows[0]["pocket"] == "retirement" and rows[0]["has_holdings"] is False


def test_create_account_writes_yaml_with_generated_id(client, env):
    r = client.post("/api/register/accounts", json={"label": "내 IRP", "owner": "me", "broker": "mirae", "account_type": "irp"})
    assert r.status_code == 201 and r.json()["id"] == "me_mirae_irp" and r.json()["pocket"] == "retirement"
    r2 = client.post("/api/register/accounts", json={"label": "내 IRP 2", "owner": "me", "broker": "mirae", "account_type": "irp"})
    assert r2.json()["id"] == "me_mirae_irp_2"
    text = (env / "accounts.yaml").read_text(encoding="utf-8")
    assert "me_mirae_irp_2" in text and "me_test_pension" in text


def test_file_preview_suggests_classes_and_does_not_save(client, env):
    r = client.post("/api/register/file", data={"account_id": "me_test_pension"}, files={"file": ("잔고.csv", CSV, "text/csv")})
    assert r.status_code == 200, r.text
    p = r.json()["groups"][0]
    assert p["account_label"] == "테스트 연금저축" and p["source"] == "file" and p["account_id"] == "me_test_pension"
    assert p["rows"][0]["asset_class"] == "stock" and p["rows"][0]["confirmed"] is True
    assert p["rows"][1]["asset_class"] is None and p["rows"][1]["ticker"] == "453850"
    assert p["computed_total"] == 550_000 and p["reconciled"] is True
    assert client.get("/api/assets").json() == []
    assert not (env / "snapshots").exists()


def test_file_without_account_matches_by_filename_or_suggests(client):
    r = client.post("/api/register/file", data={"owner": "partner"}, files={"file": ("테스트 연금저축.csv", CSV, "text/csv")})
    assert r.status_code == 200, r.text
    g = r.json()["groups"][0]
    assert g["account_id"] == "me_test_pension" and g["matched_label"] == "테스트 연금저축"
    r2 = client.post("/api/register/file", data={"owner": "partner"}, files={"file": ("키움 ISA 잔고.csv", CSV, "text/csv")})
    g2 = r2.json()["groups"][0]
    assert g2["account_id"] is None
    assert g2["suggested"] == {"label": "키움 ISA 잔고", "owner": "partner", "broker": "kiwoom", "account_type": "isa"}


def test_file_preview_rejects_unknown_or_inactive_account(client):
    assert client.post("/api/register/file", data={"account_id": "me_old"}, files={"file": ("a.csv", CSV, "text/csv")}).status_code == 422
    assert client.post("/api/register/file", data={"account_id": "../x"}, files={"file": ("a.csv", CSV, "text/csv")}).status_code == 422
    bad = client.post("/api/register/file", data={"account_id": "me_test_pension"}, files={"file": ("a.csv", b"a,b\n1,2\n", "text/csv")})
    assert bad.status_code == 422 and "종목명" in bad.json()["detail"]


def commit_body(**kw):
    return {"account_id": "me_test_pension", "source": "file", "as_of": date.today().isoformat(), "screen_total": 550_000,
            "rows": [{"ticker_name": "KODEX 200", "ticker": "069500", "qty": 10, "price": 35000, "asset_class": "stock"},
                     {"ticker_name": "새로운 채권 ETF", "ticker": "453850", "qty": 20, "price": 10000, "asset_class": "long_bond"}], **kw}


def test_commit_saves_snapshot_tags_and_class_rows(client, env):
    r = client.post("/api/register/commit", json=commit_body())
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["total"] == 550_000 and out["holdings"] == 2 and out["tags_confirmed"] >= 1 and out["sheet"] is False
    assets = client.get("/api/assets").json()
    assert sorted((a["assetClass"], a["amount"]) for a in assets if a["parent_id"]) == [("long_bond", 200_000), ("stock", 350_000)]
    assert all(a["account"] == "테스트 연금저축" and a["owner"] == "me" and a["pocket"] == "retirement" and a["source"] == "file" for a in assets)
    snap = pd.read_csv(env / "snapshots" / "me_test_pension" / f"{date.today().isoformat()}.csv", dtype={"ticker": str})
    assert list(snap["ticker"]) == ["069500", "453850"]
    assert "새로운 채권 ETF" in (env / "asset_map.yaml").read_text(encoding="utf-8")
    assert client.get("/api/dashboard").json()["retirement"] == 550_000
    # 같은 계좌를 다시 등록하면 그 계좌의 캡처·파일 행만 바뀐다
    again = client.post("/api/register/commit", json=commit_body(rows=[{"ticker_name": "KODEX 200", "ticker": "069500", "qty": 1, "price": 35000, "asset_class": "stock"}], screen_total=35000))
    assert again.status_code == 200
    assets = client.get("/api/assets").json()
    assert [(a["assetClass"], a["amount"]) for a in assets if a["parent_id"]] == [("stock", 35_000)]


def test_commit_blocks_total_mismatch_unless_accepted(client):
    r = client.post("/api/register/commit", json=commit_body(screen_total=999_999))
    assert r.status_code == 422 and "차이" in r.json()["detail"]
    assert client.post("/api/register/commit", json=commit_body(screen_total=999_999, accept_diff=True)).status_code == 200


@pytest.mark.parametrize("change,code", [
    ({"account_id": "me_old"}, 422),
    ({"as_of": "2999-01-01"}, 422),
    ({"rows": [{"ticker_name": "A", "ticker": "12", "qty": 1, "price": 1, "asset_class": "stock"}]}, 422),
    ({"rows": [{"ticker_name": "A", "qty": 0, "price": 1, "asset_class": "stock"}]}, 422),
    ({"rows": [{"ticker_name": "A", "qty": 1, "price": 1, "asset_class": "property"}]}, 422),
    ({"rows": [{"ticker_name": "A", "qty": 1, "price": 1, "asset_class": "stock"}, {"ticker_name": "A", "qty": 2, "price": 1, "asset_class": "stock"}]}, 422),
])
def test_commit_rejects_bad_rows(client, change, code):
    assert client.post("/api/register/commit", json=commit_body(**change)).status_code == code


def test_commit_partner_account_requires_partner_profile(client):
    body = commit_body(account_id="spouse_test_general", rows=[{"ticker_name": "KODEX 200", "ticker": "069500", "qty": 1, "price": 100, "asset_class": "stock"}], screen_total=None)
    r = client.post("/api/register/commit", json=body)
    assert r.status_code == 200   # 자산 우선 등록: 배우자 자리를 중립 이름으로 만든다 (Codex UX-01 require_person)
    assets = client.get("/api/assets").json()
    assert assets[0]["owner"] == "partner" and assets[0]["pocket"] == "cash"


def test_commit_writes_sheet_when_connected(client, monkeypatch):
    mem = MemorySheets(); mem.ensure_tabs()
    monkeypatch.setattr(ledger, "open_sheets", lambda: mem)
    r = client.post("/api/register/commit", json=commit_body())
    assert r.status_code == 200 and r.json()["sheet"] is True
    assert [h["ticker_name"] for h in mem.tabs[HOLDING_TAB]] == ["KODEX 200", "새로운 채권 ETF"]
    assert sorted(a["assetClass"] for a in mem.tabs[ASSET_TAB] if a.get("parent_id")) == ["long_bond", "stock"]
    assert storage.list_local_assets() == []


def test_capture_uses_parser_and_stores_images(client, env, monkeypatch):
    def fake_parse(paths, account_id, label):
        assert len(paths) == 2 and all(Path(p).exists() for p in paths)
        df = pd.DataFrame([{"account_id": account_id, "ticker_name": "KODEX 200", "ticker": "069500", "qty": 5, "price": 35000, "value": 175000, "buy_value": 0}])
        return df, {"account_label": "연금저축", "screen_total_value": 175000, "reconciled": True, "verified": True, "diff": 0, "value_diff": 0, "errors": [], "unresolved": []}
    monkeypatch.setattr(registration, "parse_images", fake_parse)
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    r = client.post("/api/register/capture", data={"account_id": "me_test_pension"},
                    files=[("images", ("a.png", png, "image/png")), ("images", ("b.png", png, "image/png"))])
    assert r.status_code == 200, r.text
    g = r.json()["groups"][0]
    assert g["rows"][0]["qty"] == 5 and g["reconciled"] is True and g["source"] == "capture" and g["account_id"] == "me_test_pension"
    saved = list((env / "uploads" / "me_test_pension").rglob("*.png"))
    assert len(saved) == 2
    assert client.post("/api/register/capture", data={"account_id": "me_test_pension"}, files=[("images", ("a.txt", b"x", "text/plain"))]).status_code == 422


def test_capture_parser_failure_is_502(client, monkeypatch):
    def fail(paths, account_id, label):
        raise RuntimeError("Claude 응답 없음")
    monkeypatch.setattr(registration, "parse_images", fail)
    r = client.post("/api/register/capture", data={"account_id": "me_test_pension"}, files=[("images", ("a.png", b"\x89PNG" + b"0" * 50, "image/png"))])
    assert r.status_code == 502 and "읽지 못했어요" in r.json()["detail"]


def test_manual_details_conflict_is_checked_before_snapshot_writes(client, env):
    from uuid import uuid4
    body = {"name": "테스트 연금저축", "account": "테스트 연금저축", "owner": "me", "pocket": "retirement", "assetClass": "mixed", "amount": 700000, "as_of": date.today().isoformat()}
    root = client.post('/api/assets', json={**body, 'request_id': str(uuid4())}).json()
    child = client.post('/api/assets', json={**body, 'name': '수동 상세', 'parent_id': root['id'], 'request_id': str(uuid4())})
    assert child.status_code == 201
    before = (env / 'asset_map.yaml').read_text()
    response = client.post('/api/register/commit', json=commit_body())
    assert response.status_code == 409
    assert not (env / 'snapshots').exists()
    assert (env / 'asset_map.yaml').read_text() == before
    assert client.get('/api/dashboard').json()['total'] == 700000



def test_capture_without_account_splits_by_label_and_matches(client, env, monkeypatch):
    """'전체' 등록: 계좌를 고르지 않고 캡처 전부 → 캡처 상단 이름으로 계좌별 묶음. 아는 계좌는 맞추고 모르는 계좌는 추가 제안."""
    def fake_multi(paths):
        assert len(paths) == 3
        mk = lambda label, name, qty, price: (pd.DataFrame([{"account_id": "", "ticker_name": name, "ticker": None, "qty": qty, "price": price, "value": qty * price, "buy_value": 0}]),
                                              {"account_label": label, "screen_total_value": qty * price, "reconciled": True, "verified": True, "diff": 0, "value_diff": 0, "errors": [], "unresolved": [(name, [["069500", name]])]})
        return [mk("테스트 연금저축", "KODEX 200", 5, 35000), mk("미래에셋 IRP", "ACE 미국30년국채", 2, 10000)]
    monkeypatch.setattr(registration, "parse_images_multi", fake_multi)
    png = b"\x89PNG" + b"0" * 50
    r = client.post("/api/register/capture", data={"owner": "me"}, files=[("images", (f"{i}.png", png, "image/png")) for i in range(3)])
    assert r.status_code == 200, r.text
    groups = r.json()["groups"]
    assert [g["account_label"] for g in groups] == ["테스트 연금저축", "미래에셋 IRP"]
    assert groups[0]["account_id"] == "me_test_pension" and groups[0]["matched_label"] == "테스트 연금저축"
    assert groups[1]["account_id"] is None
    assert groups[1]["suggested"] == {"label": "미래에셋 IRP", "owner": "me", "broker": "mirae", "account_type": "irp"}
    assert groups[0]["rows"][0]["candidates"] == [["069500", "KODEX 200"]]
    assert list((env / "uploads" / "_batch").rglob("*.png")).__len__() == 3


@pytest.mark.parametrize("label,expected", [
    ("연금저축계좌(신)", "me_new"), ("연금저축계좌 (신)", "me_new"), ("IRP", "me_irp"), ("연금저축", None), ("몰라", None),
])
def test_match_account(label, expected):
    accts = {"me_new": {"label": "연금저축계좌(신)"}, "me_old": {"label": "연금저축계좌(구)"}, "me_irp": {"label": "미래에셋 IRP"}, "gone": {"label": "IRP 옛날", "active": False}}
    assert registration.match_account(label, accts) == expected


def test_multi_capture_rows_without_account_are_not_errors():
    """계좌를 고르기 전 캡처 행에 'account_id 비어 있음' 오류를 띄우지 않는다 (2026-10-28 사용자 화면에서 발견)."""
    from tools.parse_balance import _frame_from
    df, meta = _frame_from({"account_label": "연금저축계좌(신)", "screen_total_value": 70000,
                            "rows": [{"ticker_name": "KODEX 200", "qty": 2, "price": 35000, "value": 70000, "buy_value": 0}]}, "")
    assert meta["errors"] == [] and meta["reconciled"] is True
    _, bad = _frame_from({"account_label": "x", "screen_total_value": 0,
                          "rows": [{"ticker_name": "A", "qty": 0, "price": 1, "value": 0, "buy_value": 0}]}, "")
    assert len(bad["errors"]) == 1 and "qty" in bad["errors"][0]



def test_commit_keeps_existing_role_and_saves_stock_group_and_buy_value(client, env):
    """역할을 보내지 않으면 매핑의 기존 역할(위성)을 지킨다 — 2026-10-28 위성→핵심 덮어쓰기 버그. 주식 구분·매입금액은 저장한다."""
    import yaml
    (env / "asset_map.yaml").write_text("assets:\n  테마 ETF:\n    ticker: '0053L0'\n    asset_class: stock\n    role: satellite\n    status: confirmed\nclass_defaults: {}\n", encoding="utf-8")
    body = commit_body(screen_total=None, rows=[
        {"ticker_name": "테마 ETF", "ticker": "0053L0", "qty": 2, "price": 1000, "asset_class": "stock", "stock_group": "em", "buy_value": 3000},
        {"ticker_name": "새 채권 ETF", "ticker": "453850", "qty": 1, "price": 500, "asset_class": "long_bond", "stock_group": "us"},
    ])
    r = client.post("/api/register/commit", json=body)
    assert r.status_code == 200, r.text
    amap = yaml.safe_load((env / "asset_map.yaml").read_text(encoding="utf-8"))["assets"]
    assert amap["테마 ETF"]["role"] == "satellite" and amap["테마 ETF"]["stock_group"] == "em"
    assert "stock_group" not in amap["새 채권 ETF"]   # 주식이 아니면 주식 구분을 남기지 않는다
    snap = pd.read_csv(env / "snapshots" / "me_test_pension" / f"{date.today().isoformat()}.csv", dtype={"ticker": str})
    assert snap.loc[snap["ticker_name"] == "테마 ETF", "buy_value"].iloc[0] == 3000


def test_preview_suggests_stock_group(client):
    csv = "종목명,수량,현재가\nTIGER 미국S&P500,1,10\nKODEX 200,1,10\nKODEX 인도타타그룹,1,10\nSOL 미국배당다우존스,1,10\n알 수 없는 종목,1,10\n".encode("utf-8")
    g = client.post("/api/register/file", data={"account_id": "me_test_pension"}, files={"file": ("a.csv", csv, "text/csv")}).json()["groups"][0]
    assert [r["stock_group"] for r in g["rows"]] == ["us", "kr", "em", "income", None]
    assert g["stock_groups"]["em"] == "신흥국·테마"


def test_sheet_holdings_tab_accepts_old_header_without_buy_value():
    from tools.sheets import HOLDING_COLUMNS, GoogleSheets
    old = HOLDING_COLUMNS[:-1]
    class FakeSession:
        def request(self, method, url, **kw):
            class R:
                status_code = 200; content = b"x"
                def json(self_inner):
                    return {"values": [old, ["a", "KODEX 200", "069500", 1, 100, "2026-10-28", "t"]]}
            return R()
    rows = GoogleSheets(FakeSession(), "sid").read("보유종목")
    assert rows[0]["ticker_name"] == "KODEX 200" and rows[0]["buy_value"] == ""


def test_holdings_api_after_commit_offline_and_live(client, monkeypatch):
    from backend import holdings as hapi
    body = commit_body(rows=[{"ticker_name": "KODEX 200", "ticker": "069500", "qty": 10, "price": 35000, "asset_class": "stock", "stock_group": "kr", "buy_value": 300000},
                             {"ticker_name": "새로운 채권 ETF", "ticker": "453850", "qty": 20, "price": 10000, "asset_class": "long_bond"}])
    assert client.post("/api/register/commit", json=body).status_code == 200
    off = client.get("/api/holdings").json()
    assert off["accounts"][0]["value"] == 550_000 and off["accounts"][0]["cost_known"] == 1
    assert off["total"]["total_return"] == 50_000 and off["live"] is False
    k200 = next(h for h in off["holdings"] if h["ticker"] == "069500")
    assert k200["stock_group"] == "kr" and k200["asset_class"] == "stock" and k200["avg_cost"] == 30000
    assert client.get("/api/holdings?owner=partner").json()["accounts"] == []
    hapi._quote_cache.clear()
    monkeypatch.setattr(hapi, "fetch_quote", lambda c: {"price": 36000, "prev_close": 35500} if c == "069500" else (_ for _ in ()).throw(OSError("x")))
    on = client.get("/api/holdings?live=1").json()
    assert on["live"] is True and on["quote_failed"] == ["453850"]
    k = next(h for h in on["holdings"] if h["ticker"] == "069500")
    assert k["price"] == 36000 and k["today_return"] == 5000 and k["total_return"] == 60_000


def test_holdings_fills_missing_buy_value_from_earlier_registration_only_when_qty_matches(client, env):
    snap = env / "snapshots" / "me_test_pension"; snap.mkdir(parents=True)
    (snap / "2026-10-20.csv").write_text("account_id,ticker_name,ticker,qty,price,buy_value\nme_test_pension,A,000001,10,100,800\nme_test_pension,B,000002,5,100,400\n", encoding="utf-8")
    (snap / "2026-10-27.csv").write_text("account_id,ticker_name,ticker,qty,price\nme_test_pension,A,000001,10,120\nme_test_pension,B,000002,7,100\n", encoding="utf-8")
    rows = {h["ticker_name"]: h for h in client.get("/api/holdings").json()["holdings"]}
    assert rows["A"]["buy_value"] == 800 and rows["A"]["buy_source"] == "2026-10-20" and rows["A"]["total_return"] == 400
    assert rows["B"]["buy_value"] is None   # 수량이 바뀌었으면 쓰지 않는다



def test_excel_template_round_trip_splits_by_account(client, env):
    """진짜 엑셀: 지금 잔고를 채운 양식을 받아 그대로 다시 올리면 계좌별로 나뉘고 자산군·주식 구분이 유지된다."""
    import io
    from openpyxl import load_workbook
    assert client.post("/api/register/commit", json=commit_body(screen_total=None, rows=[
        {"ticker_name": "KODEX 200", "ticker": "069500", "qty": 10, "price": 35000, "asset_class": "stock", "stock_group": "kr", "buy_value": 300000}])).status_code == 200
    r = client.get("/api/register/template.xlsx?prefill=1")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/vnd.openxmlformats")
    wb = load_workbook(io.BytesIO(r.content))
    ws = wb["보유종목"]
    assert [c.value for c in ws[1]] == ["계좌", "종목명", "종목코드", "보유수량", "현재가", "매입금액", "자산군", "주식 구분"]
    assert [c.value for c in ws[2]] == ["테스트 연금저축", "KODEX 200", "069500", 10, 35000, 300000, "주식", "국내"]
    assert wb["목록"].sheet_state == "hidden" and ws.data_validations.dataValidation
    ws.append(["배우자 일반계좌", "새 금 ETF", "411060", 3, 20000, None, "금", None])
    buf = io.BytesIO(); wb.save(buf)
    up = client.post("/api/register/file", files={"file": ("고친 잔고.xlsx", buf.getvalue(), "application/octet-stream")})
    assert up.status_code == 200, up.text
    groups = up.json()["groups"]
    assert [(g["account_label"], g["account_id"]) for g in groups] == [("테스트 연금저축", "me_test_pension"), ("배우자 일반계좌", "spouse_test_general")]
    assert groups[0]["rows"][0]["asset_class"] == "stock" and groups[0]["rows"][0]["stock_group"] == "kr" and groups[0]["rows"][0]["buy_value"] == 300000
    assert groups[1]["rows"][0]["asset_class"] == "gold"


def test_sheet_rows_endpoint(client):
    assert client.post("/api/register/commit", json=commit_body(screen_total=None, rows=[
        {"ticker_name": "KODEX 200", "ticker": "069500", "qty": 10, "price": 35000, "asset_class": "stock"}])).status_code == 200
    d = client.get("/api/register/sheet").json()
    assert [a["id"] for a in d["accounts"]] == ["me_test_pension", "spouse_test_general"]
    assert d["rows"][0]["ticker_name"] == "KODEX 200" and d["rows"][0]["account_id"] == "me_test_pension"
