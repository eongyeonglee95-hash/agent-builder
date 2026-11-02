"""갈아타기 계산/저장 회귀. 실제 장부·인증키·외부 시세를 사용하지 않는다."""
import datetime as dt
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend import storage, property as prop
from backend.main import app
from tools.property_move import move_budget


def budget(**kw):
    return move_budget(**(dict(sale_value=800_000_000, loans=200_000_000, deposit=100_000_000,
                             sale_costs=20_000_000, cash=150_000_000, new_loan=50_000_000,
                             price=1_000_000_000, purchase_costs=30_000_000, monthly=3_000_000,
                             target_month="2030-11", today=dt.date(2026, 11, 2)) | kw))


def test_costs_liabilities_and_financing_stay_separate():
    r = budget()
    assert r["sale_net"] == 480_000_000
    assert r["own_funds"] == 630_000_000  # new loan is not saved money
    assert r["total_needed"] == 1_030_000_000 and r["gap"] == 350_000_000
    assert r["coverage"] == 61.2
    assert r["months"] == 48 and r["future_savings"] == 144_000_000
    assert r["future_gap"] == 206_000_000 and r["required_monthly"] == 7_291_667


def test_negative_equity_unknown_zero_and_paid_target():
    assert budget(loans=900_000_000)["own_funds"] == -70_000_000
    assert budget(loans=900_000_000)["gap"] == 1_050_000_000
    assert budget(cash=None)["gap"] is None
    assert budget(cash=0)["gap"] == 500_000_000
    assert budget(price=None)["coverage"] is None
    assert budget(price=100_000_000)["coverage"] == 100
    assert budget(price=100_000_000)["gap"] == 0
    assert budget(price=100_000_000)["surplus"] == 550_000_000
    assert budget(sale_costs=None)["costs_complete"] is False


def test_dates_and_rounding():
    assert budget(target_month="2026-11")["required_monthly"] is None
    assert budget(target_month="2026-01")["months"] == 0
    assert budget(target_month=None)["future_gap"] is None
    assert budget(target_month="2027-01")["months"] == 2
    with pytest.raises(ValueError):
        budget(cash=-1)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("RETIRE_SHEETS", "off")
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "ledger.sqlite3")
    monkeypatch.setattr(prop, "market_key", lambda: None)
    with TestClient(app, base_url="http://127.0.0.1", headers={"Origin": "http://127.0.0.1", "X-Retire-Local": "1"}) as c:
        yield c


def home(client, **kw):
    r = client.post("/api/property", json=dict(request_id=str(uuid4()), name="검증용 현재 집", owner="joint", share_percent=40,
                                              value=800_000_000, tenure="jeonse", deposit=100_000_000,
                                              new_loans=[{"name": "주택대출", "amount": 200_000_000}]) | kw)
    assert r.status_code == 201, r.text
    return r.json()


def candidate(**kw):
    return dict(id=str(uuid4()), name="검증용 목표 아파트", price=1_000_000_000, purchase_costs=30_000_000) | kw


def save(client, payload, owner="together"):
    return client.put(f"/api/property-move?owner={owner}", json=payload)


def test_saved_goal_candidates_ledger_unchanged_and_conflict(client):
    h = home(client)
    before = client.get("/api/assets").json()
    a, b = candidate(), candidate(price=850_000_000)
    payload = dict(version=0, source_home_ids=[h["asset"]["id"]], cash=150_000_000, sale_costs=20_000_000,
                   new_loan=50_000_000, candidates=[a, b], target_id=a["id"])
    r = save(client, payload)
    assert r.status_code == 200, r.text
    result = r.json()
    assert [c["gap"] for c in result["comparisons"]] == [350_000_000, 200_000_000]
    assert result["funds"]["own_funds"] == 630_000_000
    assert client.get("/api/property-move").json()["plan"] == result["plan"]
    assert client.get("/api/assets").json() == before
    assert save(client, payload).status_code == 409
    payload = result["plan"] | {"target_id": b["id"]}
    assert save(client, payload).json()["plan"]["target_id"] == b["id"]
    assert client.get("/api/property-move?owner=me").json()["plan"]["candidates"] == []


def test_personal_scope_and_unrelated_loans(client):
    h = home(client)
    client.post("/api/assets", json=dict(request_id=str(uuid4()), name="무관한 대출", account="대출", owner="me", pocket="debt", assetClass="debt", amount=400_000_000, as_of=dt.date.today().isoformat()))
    c = candidate()
    r = save(client, dict(source_home_ids=[h["asset"]["id"]], cash=0, candidates=[c], target_id=c["id"]), "me").json()
    assert r["funds"]["sale_value"] == 320_000_000
    assert r["funds"]["loans"] == 80_000_000
    assert r["funds"]["deposit"] == 40_000_000
    assert r["funds"]["own_funds"] == 200_000_000
    assert r["comparisons"][0]["gap"] == 830_000_000  # full target, individual funding
    partner = home(client, owner="partner", share_percent=None)
    assert save(client, dict(source_home_ids=[partner["asset"]["id"]]), "me").status_code == 422


def test_deleted_source_blocks_budget_until_reselected(client):
    h = home(client)
    c = candidate()
    assert save(client, dict(source_home_ids=[h["asset"]["id"]], cash=100_000_000, candidates=[c], target_id=c["id"])).status_code == 200
    client.delete(f"/api/property/{h['asset']['id']}?version={h['asset']['version']}")
    r = client.get("/api/property-move").json()
    assert r["missing_home_ids"] == [h["asset"]["id"]]
    assert r["comparisons"][0]["gap"] is None


@pytest.mark.parametrize("payload", [
    {"cash": -1}, {"cash": 1.5}, {"target_month": "2030-13"}, {"source_home_ids": [str(uuid4())]},
    {"target_id": str(uuid4())}, {"candidates": [candidate(price=0)]},
    {"candidates": [candidate(asking_low=100, asking_high=50, asking_date="2026-01-01")]},
    {"candidates": [candidate(asking_low=100)]}, {"candidates": [candidate(price_date="2199-01-01")]},
])
def test_reject_invalid_plans(client, payload):
    assert save(client, payload).status_code == 422


def test_empty_plan_does_not_invent_saved_funds(client):
    r = client.get("/api/property-move").json()
    assert r["plan"]["cash"] is None and r["funds"]["own_funds"] is None
    assert r["comparisons"] == []
    assert client.get("/api/property-move?owner=all").status_code == 422
