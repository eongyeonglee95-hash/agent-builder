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
