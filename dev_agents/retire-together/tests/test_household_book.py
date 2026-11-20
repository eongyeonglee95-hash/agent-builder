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
