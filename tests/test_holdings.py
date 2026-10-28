"""CALCULATION_RULES §7 보유 종목 손익 — 넣은 돈/불어난 돈, 오늘 손익, 비중, 오래된 잔고, 시세 파싱."""
import datetime as dt

from tools.holdings import AccountIn, HoldingIn, summarize
from tools.market import parse_quote

TODAY = dt.date(2026, 10, 28)
ACC = [AccountIn("a", "연금저축(신)", "me", dt.date(2026, 10, 28), "snap"), AccountIn("b", "연금저축(구)", "me", dt.date(2026, 9, 1), "snap")]


def H(acct, name, qty, price, buy=None, code=None, cls="stock"):
    return HoldingIn(acct, name, code, qty, price, buy, cls)


def test_cost_known_rows_only_and_no_guessing():
    s = summarize(ACC, [H("a", "A", 10, 1000, 12000), H("a", "B", 5, 2000, None)], today=TODAY)
    a = s["accounts"][0]
    assert a["value"] == 20000 and a["buy_value"] == 12000
    assert a["total_return"] == 10000 - 12000 and a["total_rate"] == -16.67   # B는 매입금액을 몰라 빠진다
    assert a["cost_known"] == 1 and a["count"] == 2
    b_row = next(r for r in s["holdings"] if r["ticker_name"] == "B")
    assert b_row["total_return"] is None and b_row["avg_cost"] is None


def test_today_return_only_with_quotes_and_weights():
    hs = [H("a", "A", 10, 1000, 9000, "000001"), H("a", "B", 10, 3000, None, "000002")]
    quotes = {"000001": {"price": 1100, "prev_close": 1000}, "000002": {"price": 2700, "prev_close": 3000}}
    s = summarize(ACC, hs, quotes, today=TODAY)
    a = next(r for r in s["holdings"] if r["ticker_name"] == "A")
    assert a["price"] == 1100 and a["live"] and a["today_return"] == 1000 and a["today_rate"] == 10.0
    assert a["total_return"] == 11000 - 9000
    assert s["total"]["today_return"] == 1000 - 3000
    assert s["total"]["today_rate"] == round(-2000 / (10000 + 30000) * 100, 2)
    assert [r["ticker_name"] for r in s["movers"]["drivers"]] == ["B", "A"]
    assert round(sum(r["weight"] for r in s["holdings"]), 1) == 100.0
    assert summarize(ACC, hs, today=TODAY)["total"]["today_return"] is None


def test_stale_account_by_days():
    s = summarize(ACC, [H("a", "A", 1, 10), H("b", "B", 1, 10)], today=TODAY, stale_days=31)
    st = {a["id"]: (a["age_days"], a["stale"]) for a in s["accounts"]}
    assert st == {"a": (0, False), "b": (57, True)}


def test_accounts_without_holdings_are_left_out():
    assert [a["id"] for a in summarize(ACC, [H("a", "A", 1, 10)], today=TODAY)["accounts"]] == ["a"]


def test_parse_quote_sign_from_direction_code():
    up = parse_quote({"closePrice": "25,650", "compareToPreviousClosePrice": "425", "compareToPreviousPrice": {"code": "2"}})
    down = parse_quote({"closePrice": "7,300", "compareToPreviousClosePrice": "75", "compareToPreviousPrice": {"code": "5"}})
    flat = parse_quote({"closePrice": "100", "compareToPreviousClosePrice": "0", "compareToPreviousPrice": {"code": "3"}})
    assert (up["price"], up["prev_close"]) == (25650, 25225)
    assert (down["price"], down["prev_close"]) == (7300, 7375)
    assert flat["prev_close"] == 100
