from datetime import date
from uuid import uuid4
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend import additional_pensions as module, storage


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, 'DB_PATH', tmp_path / 'ledger.sqlite3')
    monkeypatch.setattr(module, 'asset', lambda aid: {'id': aid})
    monkeypatch.setattr(module, 'today', lambda: date(2026, 11, 19))
    app = FastAPI()
    app.include_router(module.router)
    with TestClient(app) as c:
        yield c


def test_schedule_month_end_and_status():
    p = {'day': 31, 'status': 'active', 'end_date': None}
    assert module.next_date(p, date(2026, 2, 10)) == '2026-02-28'
    assert module.next_date({'day': 15}, date(2026, 12, 20)) == '2027-01-15'
    assert module.next_date({**p, 'end_date': '2026-02-27'}, date(2026, 2, 1)) is None
    assert module.next_date({**p, 'status': 'complete'}, date(2026, 2, 1)) is None


def test_plan_roundtrip_conflict_and_validation(client):
    url = f'/additional-pensions/{uuid4()}'
    initial = client.get(url).json()
    assert initial['plan']['monthly'] is None and not initial['entries']
    plan = {**initial['plan'], 'monthly': 300000, 'day': 25, 'end_date': '2030-01-01'}
    assert client.put(url, json=plan).status_code == 200
    stored = client.get(url).json()
    assert stored['plan']['version'] == 1 and stored['next_date'] == '2026-11-25'
    assert client.put(url, json=plan).status_code == 409
    assert client.put(url, json={**plan, 'version': 1, 'day': 32}).status_code == 422


def test_payment_retry_and_no_asset_change(client):
    url = f'/additional-pensions/{uuid4()}'
    body = {'request_id': str(uuid4()), 'event_date': '2026-11-18', 'amount': 300000, 'note': '직접 확인'}
    assert client.post(url + '/payments', json=body).status_code == 200
    assert client.post(url + '/payments', json=body).status_code == 200
    assert len(client.get(url).json()['entries']) == 1
    assert client.post(url + '/payments', json={**body, 'amount': 1}).status_code == 409
    assert client.post(url + '/payments', json={**body, 'event_date': '2026-11-20'}).status_code == 422
    with storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM assets').fetchone()[0] == 0


def test_only_registered_fourth_layer_assets(monkeypatch):
    monkeypatch.setattr(module, 'load_accounts', lambda path: {})
    monkeypatch.setattr(storage, 'dashboard', lambda owner: {'assets': [{'id': 'a', 'pocket': 'retirement', 'account': '연금저축'}]})
    with pytest.raises(module.HTTPException) as exc:
        module.asset('a')
    assert exc.value.status_code == 404
