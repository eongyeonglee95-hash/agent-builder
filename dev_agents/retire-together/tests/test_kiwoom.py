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
    assert [(x["ticker"], x["qty"], x["asset_class"]) for x in g["rows"]] == [("005930", 5, None), ("069500", 7, "stock")]
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
