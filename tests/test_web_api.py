"""Public display boundary tests; no personal data or network calls."""
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import app
from backend.strategies import StrategyDisplay

@pytest.fixture
def client():
    with TestClient(app, base_url="http://127.0.0.1") as client:
        yield client

def test_health_does_not_claim_live_data(client):
    assert client.get("/api/health").json() == {
        "status": "ok", "mode": "local", "broker_connected": False,
    }

def test_strategy_projection_is_read_only_and_contains_only_display_fields(client):
    response = client.get("/api/strategies")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    for strategy in response.json():
        assert set(strategy) == {"id", "name", "targets", "labels", "threshold", "examples"}
        assert not strategy["targets"] or sum(strategy["targets"].values()) == pytest.approx(100)
    assert client.post("/api/strategies", json={"targets": {"stock": 100}}, headers={
        "Origin": "http://127.0.0.1", "X-Retire-Local": "1",
    }).status_code == 405

@pytest.mark.parametrize("targets", [
    {"stock": -10, "gold": 110}, {"stock": 99}, {"stock": float("nan")},
    {"stock": True}, {"unknown": 100}, {"stock": "100"},
])
def test_invalid_strategy_cannot_reach_ui(targets):
    with pytest.raises(ValidationError):
        StrategyDisplay(id="test", name="test", targets=targets, labels={}, threshold=5, examples=[])

def test_unconfirmed_strategy_is_empty_not_fabricated():
    result = StrategyDisplay(id="pending", name="pending", targets={}, labels={}, threshold=5, examples=[])
    assert result.targets == {}

def test_host_and_cross_origin_rejected(client):
    assert client.get("/api/health", headers={"Host": "attacker.example"}).status_code == 400
    assert client.get("/api/strategies", headers={"Origin": "https://attacker.example"}).status_code == 403
    assert client.get("/api/strategies", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert client.get("/api/strategies", headers={"Origin": "http://127.0.0.1"}).status_code == 200

@pytest.mark.parametrize("path", ["/data/snapshots/test.csv", "/rules/accounts.yaml", "/.env", "/api/accounts", "/%2e%2e/rules/accounts.yaml"])
def test_private_paths_not_served(client, path):
    assert client.get(path).status_code == 404

def test_invalid_configuration_fails_closed(client, monkeypatch):
    def invalid():
        raise ValueError("private-details")
    # Pydantic failures are sanitized, and are not replaced with sample weights.
    def invalid_model():
        return StrategyDisplay(id="bad", name="bad", targets={"stock": -1}, labels={}, threshold=5, examples=[])
    monkeypatch.setattr("backend.main.load_strategy_display", invalid_model)
    response = client.get("/api/strategies")
    assert response.status_code == 503
    assert "targets" not in response.text
