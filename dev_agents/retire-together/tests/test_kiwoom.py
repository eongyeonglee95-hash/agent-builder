"""키움 일반계좌 잔고 불러오기: kt00018 응답 → 확인 표 → 저장. 실제 키움 서버는 부르지 않는다."""
from datetime import date

import pytest

from tools import kiwoom
from tests.test_registration_api import client, env  # noqa: F401 — 같은 임시 계좌·장부 픽스처

BALANCE = {
    "tot_evlt_amt": "000000000540000", "tot_pur_amt": "000000000600000", "return_code": 0,
    "acnt_evlt_remn_indv_tot": [
        {"stk_cd": "A005930", "stk_nm": "삼성전자", "rmnd_qty": "000000000000003", "cur_prc": "+000000059000", "pur_amt": "000000000373500"},
        {"stk_cd": "A005930", "stk_nm": "삼성전자", "rmnd_qty": "000000000000002", "cur_prc": "-000000059000", "pur_amt": "000000000100000"},
        {"stk_cd": "A069500", "stk_nm": "KODEX 200", "rmnd_qty": "000000000000007", "cur_prc": "000000035000", "pur_amt": "000000000126500"},
        {"stk_cd": "A000660", "stk_nm": "판 종목", "rmnd_qty": "000000000000000", "cur_prc": "000000010000", "pur_amt": "000000000000000"},
    ],
}


US = {"tot_evlt_amt_krw": "000000004621939", "result_list": [
    {"stk_cd": "AMZN", "frgn_stk_nm": "아마존닷컴", "poss_qty": "000000000013", "now_pric_krw": "000000355533", "frgn_stk_book_amt_krw": "000004482370"}]}


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """테스트는 실제 키움 서버를 절대 부르지 않는다(.env에 진짜 키가 있어도). 필요한 응답은 각 테스트가 다시 넣는다."""
    def blocked(*a, **k):
        raise AssertionError("테스트에서 키움 서버 호출")
    monkeypatch.setattr(kiwoom, "_post", blocked)
    monkeypatch.setattr(kiwoom, "fetch_us_balance", lambda: {})
    monkeypatch.setattr(kiwoom, "fetch_deposit", lambda: 0)
    monkeypatch.setattr(kiwoom, "fetch_us_cash", lambda: 0)
    monkeypatch.setattr("time.sleep", lambda *_: None)


def test_us_rows_use_krw_and_add_to_total():
    df, meta = kiwoom.holdings_from_balance(BALANCE, "acct", us=US)
    us = df[df["stock_group"] == "us"].iloc[0]
    assert (us["ticker_name"], us["ticker"], us["qty"], us["price"], us["buy_value"]) == ("아마존닷컴 (AMZN)", None, 13, 355533, 4482370)
    assert meta["screen_total_value"] == 540_000 + 4_621_939 and meta["reconciled"]   # 13×355,533=4,621,929 — 원 단위 반올림 차이만


@pytest.mark.parametrize("raw, want", [("000000000177000", 177000), ("-00000000196888", -196888), ("+59000", 59000), ("", 0), ("46.25", 46)])
def test_num(raw, want):
    assert kiwoom.num(raw) == want


def test_holdings_merge_lots_and_drop_sold():
    df, meta = kiwoom.holdings_from_balance(BALANCE, "acct")
    assert df[["ticker_name", "ticker", "qty", "price", "buy_value"]].values.tolist() == [
        ["삼성전자", "005930", 5, 59000, 473500], ["KODEX 200", "069500", 7, 35000, 126500]]
    assert meta["verified"] and meta["reconciled"] and meta["screen_total_value"] == 540_000


def test_token_needs_keys(monkeypatch):
    monkeypatch.setattr(kiwoom, "_env", lambda: {})
    with pytest.raises(kiwoom.KiwoomError, match="KIWOOM_APPKEY"):
        kiwoom.token()


def test_import_preview_then_commit_as_api(client, monkeypatch):  # noqa: F811
    monkeypatch.setattr(kiwoom, "fetch_balance", lambda: BALANCE)
    r = client.post("/api/register/kiwoom?owner=partner")
    assert r.status_code == 200, r.text
    g = r.json()["groups"][0]
    assert g["source"] == "api" and g["account_id"] == "spouse_test_general" and g["screen_total"] == 540_000
    assert [(x["ticker"], x["qty"], x["asset_class"]) for x in g["rows"]] == [("005930", 5, "stock"), ("069500", 7, "stock")]   # 키움은 전부 주식
    # 나(me)에게는 키움 일반계좌가 없어 새 계좌를 제안한다
    mine = client.post("/api/register/kiwoom?owner=me").json()["groups"][0]
    assert mine["account_id"] is None and mine["suggested"]["broker"] == "kiwoom"
    body = {"account_id": "spouse_test_general", "source": "api", "as_of": date.today().isoformat(), "screen_total": 540_000,
            "rows": [{"ticker_name": x["ticker_name"], "ticker": x["ticker"], "qty": x["qty"], "price": x["price"], "asset_class": "stock",
                      "buy_value": x["buy_value"]} for x in g["rows"]]}
    for _ in range(2):   # 다시 불러와 저장해도 쌓이지 않고 바뀐다
        res = client.post("/api/register/commit", json=body); assert res.status_code == 200, res.text
    kids = [a for a in client.get("/api/assets").json() if a["parent_id"]]
    assert [(a["source"], a["amount"]) for a in kids] == [("api", 540_000)]


def test_import_reports_kiwoom_error(client, monkeypatch):  # noqa: F811
    def boom():
        raise kiwoom.KiwoomError("키움 API 오류: 허용되지 않은 IP")
    monkeypatch.setattr(kiwoom, "fetch_balance", boom)
    r = client.post("/api/register/kiwoom")
    assert r.status_code == 502 and "IP" in r.json()["detail"]


def test_auto_sync_saves_known_holdings_with_cash(client, env, monkeypatch):  # noqa: F811
    from backend import registration
    registration._last_sync.clear()
    monkeypatch.setattr(kiwoom, "fetch_balance", lambda: BALANCE)
    monkeypatch.setattr(kiwoom, "fetch_deposit", lambda: 69_974)
    monkeypatch.setattr(kiwoom, "fetch_us_cash", lambda: 26)   # 외화 예수금(원화 환산)도 예수금에 더한다
    monkeypatch.setattr(kiwoom, "configured", lambda: True)
    assert client.post("/api/register/sync").json()["status"] == "none"   # 태그 없으면 아무것도 안 한다
    put = client.put("/api/register/accounts/spouse_test_general/auto-sync", json={"auto_sync": True})
    assert put.status_code == 200 and put.json()["auto_sync"] is True
    assert client.put("/api/register/accounts/me_test_pension/auto-sync", json={"auto_sync": True}).status_code == 422
    # 처음 보는 종목(삼성전자)도 키움이면 주식으로 바로 저장. 합계가 다를 때만 확인 표
    monkeypatch.setattr(kiwoom, "fetch_balance", lambda: {**BALANCE, "tot_evlt_amt": "000000000600000"})
    r = client.post("/api/register/sync").json()
    assert r["status"] == "review" and r["groups"][0]["cash"] == 70_000 and not [a for a in client.get("/api/assets").json() if a["parent_id"]]
    monkeypatch.setattr(kiwoom, "fetch_balance", lambda: BALANCE)
    r = client.post("/api/register/sync").json()
    assert r["status"] == "updated" and r["total"] == 610_000 and r["cash"] == 70_000, r
    kids = sorted((a["name"], a["amount"]) for a in client.get("/api/assets").json() if a["parent_id"])
    assert kids == [("배우자 일반계좌 · 예수금", 70_000), ("배우자 일반계좌 · 주식", 540_000)]
    root = next(a for a in client.get("/api/assets").json() if a.get("account_id") == "spouse_test_general" and not a["parent_id"])
    assert root["amount"] == 610_000   # 계좌 줄도 새 합계
    assert client.post("/api/register/sync").json()["status"] == "fresh"   # 10분 안에는 다시 안 부른다
