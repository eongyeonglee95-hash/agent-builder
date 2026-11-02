"""Deterministic adapter checks using synthetic accounts and no network/real files."""
from datetime import date
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from backend import rebalance
from backend.main import app
from backend.strategies import StrategyDisplay
from tools.strategy import Strategy


@pytest.fixture
def client(monkeypatch):
    accounts = {key: {"active": True, "account_type": "pension_savings", "owner": "me", "label": key}
                for key in ("acct_a", "acct_b")}
    monkeypatch.setattr(rebalance, "load_accounts", lambda: accounts)
    monkeypatch.setattr(rebalance, "load_pools", lambda: {
        "test_pool": {"label": "테스트 연금", "accounts": ["acct_a", "acct_b"], "strategy": "test", "mode": "rebalance"},
    })
    monkeypatch.setattr(rebalance, "load_strategy_display", lambda: [StrategyDisplay(
        id="test", name="테스트", targets={"stock": 60, "gold": 40}, labels={}, threshold=5, examples=[],
    )])
    monkeypatch.setattr(rebalance, "load_strategy", lambda _: Strategy(
        id="test", name="테스트", targets={"stock": .6, "gold": .4}, threshold=.05, min_trade_krw=100_000,
    ))
    monkeypatch.setattr(rebalance, "defaults_with_prices", lambda *args, **kwargs: {})
    real_map = rebalance.load_asset_map()
    # Use only the fixture identities, not any household account configuration.
    names = ["TIGER 미국S&P500", "ACE 미국S&P500", "ACE 종합채권(AA-이상)", "ACE KRX금현물", "TIGER KRX금현물"]
    monkeypatch.setattr(rebalance, "load_asset_map", lambda: {n: {**real_map[n], "status": "confirmed"} for n in names})
    with TestClient(app, base_url="http://127.0.0.1", headers={"Origin": "http://127.0.0.1", "X-Retire-Local": "1"}) as client:
        yield client


def payload(**changes):
    return {"pool_id": "test_pool", "csv": (Path(__file__).parents[1] / "data/fixtures/holdings_fixture.csv").read_text(),
            "as_of": date.today().isoformat(), "new_cash": 0, **changes}


def test_preview_reuses_engine_is_deterministic_and_has_no_execution(client):
    a = client.post("/api/rebalance/preview", json=payload())
    assert a.status_code == 200, a.text
    result = a.json()
    assert client.post("/api/rebalance/preview", json=payload()).json() == result
    assert result["total_value"] == 39_050_000
    assert result["price_source"] == "uploaded_snapshot" and result["executable"] is False
    assert sum(c["current"] for c in result["classes"]) == pytest.approx(1)
    # A held asset class outside the target must remain visible (mid_bond).
    assert any(c["asset_class"] == "mid_bond" and c["target"] == 0 for c in result["classes"])
    assert result["orders"] and result["preview_id"]
    assert "../" not in a.text


def test_options_filter_owner_and_exclude_inactive_irp(client, monkeypatch):
    assert client.get("/api/rebalance/options").json()[0]["label"] == "테스트 연금"
    assert client.get("/api/rebalance/options?owner=partner").json() == []
    monkeypatch.setattr(rebalance, "load_accounts", lambda: {
        "acct_a": {"active": True, "account_type": "irp", "owner": "me"},
        "acct_b": {"active": False, "account_type": "pension_savings", "owner": "me"},
    })
    assert client.get("/api/rebalance/options").json() == []


@pytest.mark.parametrize("changes", [
    {"pool_id": "../other"}, {"new_cash": -1}, {"new_cash": True},
    {"new_cash": 300_000}, {"new_cash": 300_000, "new_cash_account": "other"},
    {"csv": "account_id,ticker_name,ticker,qty,price\n"},
    {"csv": "amount,name\n1000,example"},
])
def test_invalid_scope_and_input_rejected(client, changes):
    assert client.post("/api/rebalance/preview", json=payload(**changes)).status_code == 422


@pytest.mark.parametrize("old,new", [
    ("acct_b", "other"), ("1000,15000", "-1,15000"), ("1000,15000", "1.5,15000"),
    ("360750", "000000"), ("TIGER 미국S&P500", "알 수 없는 종목"),
])
def test_bad_csv_values_do_not_produce_orders(client, old, new):
    data = payload()
    data["csv"] = data["csv"].replace(old, new)
    response = client.post("/api/rebalance/preview", json=data)
    assert response.status_code == 422
    assert "orders" not in response.json()


def test_unconfirmed_or_prohibited_new_candidate_blocks_preview(client, monkeypatch):
    monkeypatch.setattr(rebalance, "defaults_with_prices", lambda *args, **kwargs: {
        "stock": {"name": "테스트 레버리지", "ticker": "123456", "price": 100, "source": "strategy"},
    })
    response = client.post("/api/rebalance/preview", json=payload())
    assert response.status_code == 200
    assert response.json()["orders"] == []
    assert response.json()["blocked_reason"]
    previous = rebalance.load_asset_map()
    monkeypatch.setattr(rebalance, "load_asset_map", lambda: {**previous, "테스트 레버리지": {
        "ticker": "123456", "asset_class": "stock", "status": "confirmed",
    }})
    blocked = client.post("/api/rebalance/preview", json=payload()).json()
    assert blocked["orders"] == []
    assert "연금저축/IRP 불가" in blocked["blocked_reason"]


def test_missing_or_invalid_strategy_fails_closed(client, monkeypatch):
    monkeypatch.setattr(rebalance, "load_strategy_display", lambda: [])
    assert client.post("/api/rebalance/preview", json=payload()).status_code == 422


def test_new_cash_explicit_account_changes_total_and_fingerprint(client):
    before = client.post("/api/rebalance/preview", json=payload()).json()
    response = client.post("/api/rebalance/preview", json=payload(new_cash=300_000, new_cash_account="acct_b"))
    assert response.status_code == 200, response.text
    after = response.json()
    assert after["total_after_cash"] == before["total_value"] + 300_000
    assert after["preview_id"] != before["preview_id"]
