"""가계부 계산·저장 회귀. 실제 장부를 쓰지 않는다."""
import pytest
from fastapi.testclient import TestClient

from backend import storage
from backend.main import app
from tools.household_book import compare_month, flow, load_rules, month_summary, year_view

RULES = load_rules()


def entry(**kw):
    base = {"income": [{"who": "me", "kind": "월급", "gross": 6_900_000, "net": 5_410_000},
                       {"who": "partner", "kind": "월급", "gross": None, "net": 4_260_000},
                       {"who": "joint", "kind": "기타", "gross": None, "net": 180_000}],
            "spend": {"maintenance": 280_000, "loan_interest": 1_240_000, "groceries": 1_180_000, "dining": 620_000},
            "big": [{"name": "자동차 정비", "amount": 960_000}],
            "saving": {"pension": 1_000_000, "principal": 600_000}}
    return base | kw


def test_month_totals_and_cash_pocket():
    s = month_summary(entry(), RULES)
    assert s["income"] == 9_850_000 and s["income_by_who"] == {"me": 5_410_000, "partner": 4_260_000, "joint": 180_000}
    assert s["spend_groups"] == {"fixed": 1_520_000, "life": 1_800_000, "big": 960_000}
    assert s["spend"] == 4_280_000
    assert s["cash"] == 9_850_000 - 4_280_000 - 1_600_000
    assert s["kept"] == s["income"] - s["spend"] and s["kept_rate"] == 56.5


def test_overspent_month_shows_shortfall_not_negative_band():
    s = month_summary(entry(big=[{"name": "이사", "amount": 9_000_000}]), RULES)
    f = flow(s, RULES)
    assert s["cash"] < 0 and f["shortfall"] == -s["cash"]
    assert all(u["amount"] > 0 for u in f["uses"]) and "cash" not in {u["id"] for u in f["uses"]}


def test_empty_month_has_no_rate():
    s = month_summary({"income": [], "spend": {}, "big": [], "saving": {}}, RULES)
    assert s["income"] == 0 and s["kept_rate"] is None


def test_year_averages_only_recorded_months():
    light = entry(spend={"groceries": 980_000}, big=[])
    v = year_view({1: entry(), 2: light}, RULES)
    assert v["recorded"] == 2
    assert v["category_average"]["groceries"] == 1_080_000
    assert v["category_average"]["maintenance"] == 140_000
    assert v["average"]["spend"] == round((4_280_000 + 980_000) / 2)
    rows = {r["id"]: r for r in compare_month(entry(), v, RULES)}
    assert rows["maintenance"]["over"] and rows["groceries"]["diff"] == 100_000 and not rows["groceries"]["over"]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "ledger.sqlite3")
    with TestClient(app, base_url="http://127.0.0.1", headers={"Origin": "http://127.0.0.1", "X-Retire-Local": "1"}) as c:
        yield c


def test_save_read_and_version_conflict(client):
    empty = client.get("/api/household-book", params={"year": 2026}).json()
    assert empty["months"] == {} and empty["categories"]["fixed"]["label"] == "고정비"
    body = entry() | {"version": 0}
    saved = client.put("/api/household-book/2026-10", json=body)
    assert saved.status_code == 200, saved.text
    assert client.put("/api/household-book/2026-10", json=body).status_code == 409
    nov = entry(spend={"groceries": 1_500_000}) | {"version": 0}
    assert client.put("/api/household-book/2026-11", json=nov).status_code == 200
    data = client.get("/api/household-book", params={"year": 2026, "month": 11}).json()
    assert set(data["months"]) == {"10", "11"}
    assert data["selected"]["month"] == 11 and data["selected"]["version"] == 1
    assert data["selected"]["previous"]["spend"] == month_summary(entry(), RULES)["spend"]
    assert data["year"]["recorded"] == 2


def test_rejects_unknown_category_and_future_month(client):
    bad = entry(spend={"casino": 1}) | {"version": 0}
    assert client.put("/api/household-book/2026-10", json=bad).status_code == 422
    assert client.put("/api/household-book/2999-01", json=entry() | {"version": 0}).status_code == 422


# ── HB-02 1년 표 · 매달 고정 · 캡처 분류 ──
from tools.household_book import apply_capture, classify, prefill, set_value, suggest_fixed, value_of, year_table  # noqa: E402
from tools.household_capture import normalize  # noqa: E402


def test_cell_edit_keeps_lines_and_clears_auto():
    e = entry(auto=["spend:groceries"])
    e2 = set_value(e, "spend:groceries", 900_000)
    assert e2["spend"]["groceries"] == 900_000 and e2["auto"] == []
    assert set_value(e, "spend:dining", 0)["spend"].get("dining") is None
    assert value_of(set_value(e, "income:me", 5_500_000), "income:me") == 5_500_000
    two = entry(income=[{"who": "me", "kind": "월급", "gross": None, "net": 1}, {"who": "me", "kind": "상여", "gross": None, "net": 2}])
    with pytest.raises(ValueError):
        set_value(two, "income:me", 3)


def test_prefill_copies_only_fixed_cells():
    prev = entry(fixed=["spend:loan_interest", "saving:pension", "income:me"])
    e = prefill(prev)
    assert e["spend"] == {"loan_interest": 1_240_000} and e["saving"] == {"pension": 1_000_000}
    assert value_of(e, "income:me") == 5_410_000 and value_of(e, "income:partner") == 0
    assert e["big"] == [] and set(e["auto"]) == {"spend:loan_interest", "saving:pension", "income:me"}


def test_suggest_fixed_needs_three_equal_months():
    keys = ["spend:maintenance", "spend:groceries", "big"]
    same = [entry(), entry(), entry(spend={"maintenance": 280_000, "groceries": 1})]
    assert suggest_fixed(same, keys) == ["spend:maintenance"]
    assert suggest_fixed(same[:2], keys) == []


def test_classify_learned_first_then_longest_keyword():
    assert classify("쿠팡이츠 강남", {}, RULES) == ("dining", "rule")
    assert classify("쿠팡(주)", {}, RULES) == ("shopping", "rule")
    assert classify("쿠팡 (주)", {"쿠팡": "groceries"}, RULES) == ("groceries", "learned")
    assert classify("홍길동", {}, RULES) == (None, None)


def test_apply_capture_adds_once_and_remembers():
    rows = [{"date": "2026-11-18", "merchant": "이마트 성수점", "amount": 84_320, "category": "groceries"},
            {"date": "2026-11-12", "merchant": "한진관광", "amount": 1_240_000, "category": "big"},
            {"date": "2026-11-10", "merchant": "카드대금", "amount": 500_000, "category": "skip"}]
    e, added = apply_capture(entry(), rows, RULES)
    assert added == 2 and e["spend"]["groceries"] == 1_180_000 + 84_320
    assert e["big"][-1] == {"name": "한진관광", "amount": 1_240_000}
    assert e["learned"]["이마트성수점"] == "groceries" and e["learned"]["카드대금"] == "skip"
    again, added = apply_capture(e, rows, RULES)
    assert added == 0 and again["spend"] == e["spend"]


def test_capture_normalize_drops_cancelled_and_reads_short_dates():
    rows = normalize([{"date": "11.18", "merchant": " 이마트 ", "amount": 84_320, "cancelled": False},
                      {"date": "11.17", "merchant": "쿠팡", "amount": 9_900, "cancelled": True},
                      {"date": "?", "merchant": "x", "amount": 0, "cancelled": False}], 2026)
    assert rows == [{"date": "2026-11-18", "merchant": "이마트", "amount": 84_320}]


def test_year_table_rows_and_totals():
    rows = {r["key"]: r for r in year_table({10: entry(fixed=["saving:pension"]), 11: entry(auto=["saving:pension"], fixed=["saving:pension"])}, RULES)}
    assert rows["income"]["values"] == {10: 9_850_000, 11: 9_850_000}
    assert rows["saving:pension"]["fixed"] and rows["saving:pension"]["auto"] == [11]
    assert rows["cash"]["values"][10] == month_summary(entry(), RULES)["cash"]


def test_cell_route_prefills_next_month_and_fixed_route(client, monkeypatch):
    import datetime as dt
    from backend import household_book as hb
    class Day(dt.date):
        @classmethod
        def today(cls):
            return dt.date(2026, 11, 20)
    monkeypatch.setattr(hb.dt, "date", Day)
    assert client.put("/api/household-book/2026-10", json=entry() | {"version": 0}).status_code == 200
    assert client.post("/api/household-book/fixed", json={"keys": ["saving:pension", "spend:loan_interest"], "version": 1}).status_code == 200
    data = client.get("/api/household-book", params={"year": 2026}).json()
    assert data["next_open"] == "2026-11" and data["table"]["preview"] == 11 and data["selected"]["preview"]
    assert data["selected"]["entry"]["saving"] == {"pension": 1_000_000}
    r = client.put("/api/household-book/2026-11/cell", json={"key": "spend:groceries", "value": 700_000, "version": 0})
    assert r.status_code == 200, r.text
    nov = client.get("/api/household-book", params={"year": 2026, "month": 11}).json()["selected"]
    assert nov["recorded"] and nov["entry"]["spend"] == {"loan_interest": 1_240_000, "groceries": 700_000}
    assert nov["entry"]["fixed"] == ["saving:pension", "spend:loan_interest"]
    assert client.put("/api/household-book/2026-11/cell", json={"key": "nope", "value": 1, "version": 1}).status_code == 422


def test_capture_route_classifies_and_apply_dedupes(client, monkeypatch):
    from backend import household_book as hb
    monkeypatch.setattr(hb, "transcribe", lambda paths, year: [
        {"date": "2026-10-18", "merchant": "이마트", "amount": 84_320}, {"date": "2026-10-15", "merchant": "홍길동", "amount": 50_000},
        {"date": "2026-09-30", "merchant": "스타벅스", "amount": 5_000}])
    files = [("images", ("a.png", b"\x89PNG", "image/png"))]
    got = client.post("/api/household-book/capture", data={"month": "2026-10"}, files=files).json()
    by = {r["merchant"]: r for r in got["rows"]}
    assert by["이마트"]["category"] == "groceries" and by["홍길동"]["category"] is None and not by["스타벅스"]["in_month"]
    rows = [{"date": "2026-10-18", "merchant": "이마트", "amount": 84_320, "category": "groceries"},
            {"date": "2026-10-15", "merchant": "홍길동", "amount": 50_000, "category": "gifts"}]
    r = client.post("/api/household-book/2026-10/capture", json={"rows": rows, "version": 0})
    assert r.status_code == 200 and r.json()["added"] == 2
    again = client.post("/api/household-book/capture", data={"month": "2026-10"}, files=files).json()
    by = {r["merchant"]: r for r in again["rows"]}
    assert by["이마트"]["duplicate"] and by["홍길동"]["category"] == "gifts" and by["홍길동"]["how"] == "learned"
