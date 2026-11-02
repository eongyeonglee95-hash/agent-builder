"""갈아타기 계산/저장 회귀. 실제 장부·인증키·외부 시세를 사용하지 않는다."""
import datetime as dt
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend import storage, property as prop
from backend.main import app
from tools.property_move import move_budget, price_gap


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


# ── 추적 기록 ───────────────────────────────────────────────
def test_price_gap_is_target_minus_home_value():
    assert price_gap(home_value=800_000_000, target_price=1_000_000_000) == 200_000_000
    assert price_gap(home_value=1_000_000_000, target_price=900_000_000) == -100_000_000
    with pytest.raises(ValueError):
        price_gap(home_value=-1, target_price=1)


def test_saving_plan_records_today_once_and_only_when_numbers_change(client):
    h = home(client)
    c = candidate()
    base = dict(version=0, source_home_ids=[h["asset"]["id"]], cash=100_000_000, sale_costs=0, new_loan=0, monthly_saving=0, target_month=None, target_id=c["id"])
    r = save(client, base | dict(candidates=[c]))
    assert r.status_code == 200, r.text
    rows = r.json()["track"][c["id"]]
    assert len(rows) == 1 and rows[0]["day"] == dt.date.today().isoformat()
    # 격차 = 목표 10억 − 집 전체 8억. 더 필요한 돈 = 10.3억 − (8억 − 2억 대출 − 1억 보증금 + 1억 현금) = 4.3억
    assert rows[0]["gap"] == 200_000_000 and rows[0]["needed"] == 430_000_000 and rows[0]["price_basis"] == "manual"
    assert r.json()["comparisons"][0]["price_gap"] == 200_000_000
    # 메모만 바꾼 저장은 기록을 더하지 않는다
    r = save(client, base | dict(version=1, candidates=[c | dict(memo="메모만")]))
    assert len(r.json()["track"][c["id"]]) == 1
    # 가격이 바뀌면 오늘 기록을 덮어쓴다 (하루 한 줄)
    r = save(client, base | dict(version=2, candidates=[c | dict(price=950_000_000)]))
    rows = r.json()["track"][c["id"]]
    assert len(rows) == 1 and rows[0]["price"] == 950_000_000 and rows[0]["gap"] == 150_000_000
    # 후보를 지우면 기록도 사라진다
    r = save(client, base | dict(version=3, candidates=[], target_id=None))
    assert r.json()["track"] == {}
    with storage.connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM property_track").fetchone()[0] == 0


def test_manual_track_uses_sent_price_and_can_be_deleted(client):
    h = home(client)
    c = candidate()
    save(client, dict(version=0, source_home_ids=[h["asset"]["id"]], cash=100_000_000, sale_costs=0, new_loan=0, monthly_saving=0, target_month=None, target_id=c["id"], candidates=[c]))
    r = client.post("/api/property-move/track?owner=together", json=dict(candidate_id=c["id"], price=1_020_000_000, price_basis="trade", price_date="2026-10-15", note="실거래 반영"))
    assert r.status_code == 201, r.text
    row = r.json()["track"][c["id"]][0]
    assert row["price"] == 1_020_000_000 and row["price_basis"] == "trade" and row["note"] == "실거래 반영" and row["gap"] == 220_000_000 and row["needed"] == 450_000_000
    assert len(r.json()["track"][c["id"]]) == 1   # 같은 날은 덮어쓴다
    assert client.post("/api/property-move/track?owner=together", json=dict(candidate_id=str(uuid4()), price=1)).status_code == 404
    assert client.post("/api/property-move/track?owner=together", json=dict(candidate_id=c["id"], price=1, price_date="2999-01-01")).status_code == 422
    # 소유자 범위가 다르면 보이지 않는다
    assert client.get("/api/property-move?owner=me").json()["track"] == {}
    r = client.delete(f"/api/property-move/track/{c['id']}/{row['day']}?owner=together")
    assert r.status_code == 200 and r.json()["track"][c["id"]] == []
