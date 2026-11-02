"""Exercise the local ledger through HTTP, with an isolated database per test."""
from datetime import date, timedelta
import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend import storage
from backend.main import app

ORIGIN = "http://127.0.0.1"
HEADERS = {"Origin": ORIGIN, "X-Retire-Local": "1"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("RETIRE_SHEETS", "off")
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "ledger.sqlite3")
    with TestClient(app, base_url=ORIGIN, headers=HEADERS) as client:
        yield client


def family_payload(**changes):
    return {
        "me": {"name": "테스트 나", "age": 40, "gender": "unspecified", "role": "wife"},
        "partner": {"name": "테스트 배우자", "age": 42, "gender": "male", "role": "husband"},
        "retirement_age": 62, "target_amount": 3_000_000_000, "version": 0,
        **changes,
    }


def asset_payload(**changes):
    return {
        "name": "테스트 연금", "account": "테스트 보관처", "owner": "me",
        "pocket": "retirement", "assetClass": "mixed", "amount": 1_000_000,
        "as_of": date.today().isoformat(), "request_id": str(uuid4()), **changes,
    }


def create(client, **changes):
    response = client.post("/api/assets", json=asset_payload(**changes))
    assert response.status_code == 201, response.text
    return response.json()


def test_empty_ledger_has_no_example_assets(client):
    assert client.get("/api/family").json() is None
    assert client.get("/api/assets").json() == []
    dashboard = client.get("/api/dashboard").json()
    assert dashboard["total"] == dashboard["debt"] == dashboard["count"] == 0
    assert dashboard["as_of"] is None


def test_profile_survives_new_client_and_rejects_lost_updates(client):
    saved = client.put("/api/family", json=family_payload())
    assert saved.status_code == 200
    assert saved.json()["version"] == 1
    with TestClient(app, base_url=ORIGIN, headers=HEADERS) as reopened:
        assert reopened.get("/api/family").json() == saved.json()
    assert client.put("/api/family", json=family_payload()).status_code == 409
    assert client.put("/api/family", json=family_payload(version=1, retirement_age=63)).json()["version"] == 2


def test_asset_crud_is_persistent_versioned_and_audited(client):
    client.put("/api/family", json=family_payload())
    original = asset_payload()
    first = client.post("/api/assets", json=original).json()
    assert client.post("/api/assets", json=original).json() == first
    assert len(client.get("/api/assets").json()) == 1
    assert client.post("/api/assets", json={**original, "amount": 20}).status_code == 409
    update = {key: val for key, val in original.items() if key != "request_id"}
    response = client.put(f"/api/assets/{first['id']}", json={**update, "amount": 2_000_000, "version": 1})
    assert response.status_code == 200
    assert response.json()["version"] == 2
    assert client.put(f"/api/assets/{first['id']}", json={**update, "version": 1}).status_code == 409
    with TestClient(app, base_url=ORIGIN, headers=HEADERS) as reopened:
        assert reopened.get("/api/assets").json() == [response.json()]
    assert client.delete(f"/api/assets/{first['id']}?version=1").status_code == 409
    assert client.delete(f"/api/assets/{first['id']}?version=2").status_code == 204
    assert client.get("/api/assets").json() == []
    with sqlite3.connect(storage.DB_PATH) as conn:
        assert conn.execute("SELECT operation FROM asset_history ORDER BY event_id").fetchall() == [("create",), ("update",), ("delete",)]


def test_owner_scoped_totals_keep_debt_and_property_out_of_pockets(client):
    client.put("/api/family", json=family_payload())
    create(client, amount=100, assetClass="stock")
    create(client, owner="partner", amount=200)
    create(client, pocket="cash", assetClass="cash", amount=30)
    create(client, pocket="property", assetClass="property", amount=500)
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    create(client, owner="partner", pocket="debt", assetClass="debt", amount=900, as_of=yesterday)
    total = client.get("/api/dashboard").json()
    assert {key: total[key] for key in ("total", "net", "retirement", "cash", "financial", "property", "debt", "unclassified")} == {
        "total": 830, "net": -70, "retirement": 300, "cash": 30, "financial": 330,
        "property": 500, "debt": 900, "unclassified": 200,
    }
    assert total["as_of"] == yesterday
    assert len(total["assets"]) == 4 and len(total["debts"]) == 1
    me = client.get("/api/dashboard?owner=me").json()
    partner = client.get("/api/dashboard?owner=partner").json()
    assert me["total"] + partner["total"] == total["total"]
    assert me["net"] + partner["net"] == total["net"]
    assert all(row["owner"] == "me" for row in me["assets"])
    assert client.get("/api/dashboard?owner=other").status_code == 422


def test_first_asset_initializes_minimal_owner_without_goals(client):
    assert client.post("/api/assets", json=asset_payload()).status_code == 201
    family = client.get("/api/family").json()
    assert family["me"]["age"] is None
    assert family["retirement_age"] is None and family["target_amount"] is None
    item = create(client, owner="partner")
    family = client.get("/api/family").json()
    assert family["partner"]["name"] == "배우자"
    assert client.put("/api/family", json=family_payload(partner=None, version=family["version"])).status_code == 409
    client.delete(f"/api/assets/{item['id']}?version=1")
    assert client.put("/api/family", json=family_payload(partner=None, version=family["version"])).status_code == 200


@pytest.mark.parametrize("changes", [
    {"amount": -1}, {"amount": 1.5}, {"amount": True}, {"amount": "100"},
    {"amount": 10**15 + 1}, {"name": "   "}, {"owner": "other"},
    {"pocket": "property", "assetClass": "stock"},
    {"assetClass": "debt"}, {"as_of": "invalid"},
    {"as_of": (date.today() + timedelta(days=1)).isoformat()},
    {"unexpected": "field"},
])
def test_invalid_asset_cannot_be_saved(client, changes):
    client.put("/api/family", json=family_payload())
    assert client.post("/api/assets", json=asset_payload(**changes)).status_code == 422
    assert client.get("/api/assets").json() == []


@pytest.mark.parametrize("age", [17, 111, 40.5, True, "40"])
def test_invalid_age_cannot_be_saved(client, age):
    payload = family_payload()
    payload["me"]["age"] = age
    assert client.put("/api/family", json=payload).status_code == 422
    assert client.get("/api/family").json() is None


def test_local_mutations_require_same_origin_and_explicit_app_header(client):
    for headers in ({}, {"Origin": ORIGIN}, {"X-Retire-Local": "1"}, {**HEADERS, "Origin": "http://attacker.example"}):
        with TestClient(app, base_url=ORIGIN, headers=headers) as outsider:
            assert outsider.put("/api/family", json=family_payload()).status_code == 403
    assert client.get("/api/family").json() is None


def editable(asset, **changes):
    keys = ("name", "account", "owner", "pocket", "assetClass", "amount", "as_of", "parent_id", "valuation_source", "share_percent", "version")
    return {**{key: asset[key] for key in keys if key in asset}, **changes}


def test_minimal_profile_has_no_implicit_retirement_goal(client):
    response = client.put('/api/family', json={'me': {'name': '나'}, 'version': 0})
    assert response.status_code == 200
    assert response.json()['me']['age'] is None
    assert response.json()['retirement_age'] is None
    assert response.json()['target_amount'] is None


def test_account_total_and_details_are_never_double_counted(client):
    parent = create(client, amount=1_000_000)
    child = create(client, name='연결 주식', parent_id=parent['id'], amount=400_000, assetClass='stock')
    first = client.get('/api/dashboard').json()
    assert first['total'] == 1_000_000
    assert len(first['assets']) == 1
    group = first['account_groups'][0]
    assert group['details_total'] == 400_000 and group['difference'] == -600_000
    selected = client.put(f"/api/assets/{parent['id']}", json=editable(parent, valuation_source='details'))
    assert selected.status_code == 200, selected.text
    second = client.get('/api/dashboard').json()
    assert second['total'] == 400_000 and second['assets'][0]['id'] == child['id']
    assert second['count'] == 1
    updated = client.put(f"/api/assets/{child['id']}", json=editable(child, amount=600_000))
    assert updated.status_code == 200
    assert client.get('/api/dashboard').json()['total'] == 600_000
    with TestClient(app, base_url=ORIGIN, headers=HEADERS) as reopened:
        assert reopened.get('/api/dashboard').json()['account_groups'][0]['source'] == 'details'
    assert client.delete(f"/api/assets/{child['id']}?version=2").status_code == 409
    assert client.delete(f"/api/assets/{parent['id']}?version=2").status_code == 409
    client.put(f"/api/assets/{parent['id']}", json=editable(selected.json(), valuation_source='total'))
    assert client.delete(f"/api/assets/{child['id']}?version=2").status_code == 204
    assert client.get('/api/dashboard').json()['total'] == 1_000_000


def test_duplicate_financial_account_is_rejected_without_losing_data(client):
    parent = create(client, account='My Pension')
    response = client.post('/api/assets', json=asset_payload(account='my  pension', name='다른 이름'))
    assert response.status_code == 409
    assert client.get('/api/dashboard').json()['total'] == parent['amount']


def test_detail_scope_and_empty_detail_source_cannot_be_saved(client):
    parent = create(client)
    assert client.post('/api/assets', json=asset_payload(name='자식', parent_id=parent['id'], owner='partner')).status_code == 422
    assert client.put(f"/api/assets/{parent['id']}", json=editable(parent, valuation_source='details')).status_code == 422
    child = create(client, name='자식', parent_id=parent['id'])
    assert client.put(f"/api/assets/{parent['id']}", json=editable(parent, account='다른 계좌')).status_code == 409
    assert client.post('/api/assets', json=asset_payload(name='손자', parent_id=child['id'])).status_code == 422


def test_last_detail_cannot_move_away_from_selected_source(client):
    parent = create(client)
    child = create(client, name='세부', parent_id=parent['id'])
    client.put(f"/api/assets/{parent['id']}", json=editable(parent, valuation_source='details'))
    detached = client.put(f"/api/assets/{child['id']}", json=editable(child, parent_id=None, account='새 계좌'))
    assert detached.status_code == 409
    assert client.get('/api/dashboard').json()['account_groups'][0]['details'][0]['id'] == child['id']


def test_joint_property_is_counted_once_and_split_without_rounding_loss(client):
    house = create(client, owner='joint', pocket='property', assetClass='property', amount=100_000_003, share_percent=33)
    create(client, owner='joint', pocket='debt', assetClass='debt', amount=30_000_001, share_percent=33)
    together = client.get('/api/dashboard').json()
    me = client.get('/api/dashboard?owner=me').json()
    partner = client.get('/api/dashboard?owner=partner').json()
    assert together['property'] == 100_000_003
    assert me['property'] == 33_000_000
    assert me['property'] + partner['property'] == together['property']
    assert me['debt'] + partner['debt'] == together['debt']
    assert me['assets'][0]['full_amount'] == house['amount']
    family = client.get('/api/family').json()
    assert family['partner'] is not None
    assert client.put('/api/family', json=family_payload(partner=None, version=family['version'])).status_code == 409


@pytest.mark.parametrize('changes', [
    {'owner': 'joint'}, {'share_percent': 50},
    {'owner': 'joint', 'pocket': 'property', 'assetClass': 'property', 'share_percent': 0},
    {'owner': 'joint', 'pocket': 'property', 'assetClass': 'property', 'share_percent': 100},
    {'owner': 'joint', 'share_percent': 50},
])
def test_joint_ownership_requires_valid_property_or_debt_shares(client, changes):
    assert client.post('/api/assets', json=asset_payload(**changes)).status_code == 422


def test_legacy_json_assets_remain_readable(client):
    original = asset_payload()
    original.pop('request_id')
    asset_id = str(uuid4())
    import json
    with storage.connection() as conn:
        conn.execute('INSERT INTO assets VALUES (?, ?, ?, 1, ?, ?)', (asset_id, str(uuid4()), json.dumps(original), storage.now(), storage.now()))
    assert client.get('/api/assets').json()[0]['parent_id'] is None
    assert client.get('/api/dashboard').json()['total'] == original['amount']


@pytest.mark.parametrize("sheet_backed", [False, True])
def test_import_details_reuse_manual_total_without_double_counting(client, monkeypatch, sheet_backed):
    from backend import ledger
    from tools.sheets import MemorySheets
    if sheet_backed:
        sheets = MemorySheets()
        sheets.ensure_tabs()
        monkeypatch.setattr(ledger, "open_sheets", lambda: sheets)
    payload = asset_payload(amount=1_000_000)
    root_response = client.post('/api/assets', json=payload)
    assert root_response.status_code == 201
    root = root_response.json()
    # Same registration request remains idempotent on either backend.
    assert client.post('/api/assets', json=payload).json() == root
    assert client.post('/api/assets', json={**payload, 'amount': 2}).status_code == 409
    details = [{k: v for k, v in asset_payload(name='주식 상세', amount=600_000, assetClass='stock').items() if k != 'request_id'}]
    first = storage.replace_account_assets('test_account', 'file', details)
    snap = client.get('/api/dashboard').json()
    assert snap['total'] == 1_000_000 and snap['count'] == 1
    group = snap['account_groups'][0]
    assert group['account']['id'] == root['id']
    assert group['difference'] == -400_000
    assert len(group['details']) == 1
    selected = {k: v for k, v in group['account'].items() if k in storage.AssetInput.model_fields}
    response = client.put(f"/api/assets/{root['id']}", json={**selected, 'valuation_source': 'details', 'version': group['account']['version']})
    assert response.status_code == 200, response.text
    assert client.get('/api/dashboard').json()['total'] == 600_000
    second = storage.replace_account_assets('test_account', 'capture', [{**details[0], 'amount': 700_000}])
    assert first[0]['id'] == second[0]['id']
    snap = client.get('/api/dashboard').json()
    assert snap['total'] == 700_000 and snap['count'] == 1
    assert snap['account_groups'][0]['account']['amount'] == 1_000_000
    assert snap['account_groups'][0]['source'] == 'details'
    assert snap['account_groups'][0]['difference'] == -300_000
    assert len(client.get('/api/assets').json()) == 2


def test_legacy_import_roots_are_consolidated_with_history(client):
    import json
    root = create(client, amount=100)
    # Emulate the pre-grouping file schema, with multiple asset-class roots.
    with storage.connection() as conn:
        old = {k: v for k, v in root.items() if k in storage.AssetInput.model_fields}
        old.update(account_id='legacy', source='file')
        conn.execute('UPDATE assets SET payload=? WHERE id=?', (json.dumps(old), root['id']))
    payload = {k: v for k, v in asset_payload(name='상세', amount=150).items() if k != 'request_id'}
    storage.replace_account_assets('legacy', 'file', [payload])
    snap = client.get('/api/dashboard').json()
    assert snap['total'] == 150 and snap['count'] == 1
    assert len(snap['account_groups'][0]['details']) == 1
