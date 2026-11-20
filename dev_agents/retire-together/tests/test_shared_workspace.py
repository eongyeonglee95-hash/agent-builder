from copy import deepcopy
from uuid import uuid4

from backend import storage
from tests.test_web_auth import signing_material, setup, client
from tests.test_household_invites import invited
from tests.test_shared_data import data_env, partner, migrate, find


def headers(env, response):
    return {**env.headers, 'X-Retire-Sheet': response.headers['x-retire-sheet'],
            'X-Retire-Revision': response.headers['x-retire-revision'], 'X-Retire-Operation': str(uuid4())}


def test_existing_financial_views_use_current_sheet_and_leave_local_untouched(client, data_env):
    initial, _ = migrate(client, data_env)
    original = storage.DB_PATH.read_bytes()
    for path in ['/api/family', '/api/assets', '/api/dashboard', '/api/holdings', '/api/retirement', '/api/property', '/api/property-move', '/api/register/accounts', '/api/workbook/portfolios', '/api/rebalance/options']:
        response = client.get(path)
        assert response.status_code == 200, (path, response.text)
        assert response.headers['x-retire-revision'] == initial['revision']
    assert storage.DB_PATH.read_bytes() == original
    assert not list((data_env.config.db_path.parent / 'shared-workspaces').iterdir())


def test_retirement_save_roundtrip_replay_and_stale_draft(client, data_env):
    initial, _ = migrate(client, data_env)
    original = storage.DB_PATH.read_bytes()
    view = client.get('/api/retirement')
    assert view.status_code == 200, view.text
    # The legacy response exposes the editable plan under plan.
    plan = deepcopy(view.json()['plan'])
    plan['me']['national_monthly'] = 12345
    request_headers = headers(data_env, view)
    saved = client.put('/api/retirement/plan', json=plan, headers=request_headers)
    assert saved.status_code == 200, saved.text
    current = client.get('/api/shared-data').json()
    assert find(current['state'], 'pension', initial['viewer']['me'])['payload']['national_monthly'] == 12345
    assert client.get('/api/retirement').json()['plan']['me']['national_monthly'] == 12345
    writes = data_env.fake.writes
    replay = client.put('/api/retirement/plan', json=plan, headers=request_headers)
    assert replay.status_code == 200 and replay.json() == saved.json()
    assert data_env.fake.writes == writes
    stale = client.put('/api/retirement/plan', json=plan, headers={**request_headers, 'X-Retire-Operation': str(uuid4())})
    assert stale.status_code == 409
    assert storage.DB_PATH.read_bytes() == original


def test_property_edit_and_failed_write_do_not_change_local_ledger(client, data_env):
    migrate(client, data_env)
    original = storage.DB_PATH.read_bytes()
    view = client.get('/api/assets')
    asset = next(a for a in view.json() if a['id'] == data_env.asset_id)
    body = {k: v for k, v in asset.items() if k in storage.AssetUpdate.model_fields}
    body['amount'] = 987
    data_env.fake.write_failure = 'before'
    response = client.put('/api/assets/' + data_env.asset_id, headers=headers(data_env, view), json=body)
    assert response.status_code in (409, 503), response.text
    assert storage.DB_PATH.read_bytes() == original
    assert find(client.get('/api/shared-data').json()['state'], 'asset', data_env.asset_id)['payload']['amount'] == 600


def test_owner_legacy_forms_do_not_bypass_partner_permissions(client, data_env, partner):
    migrate(client, data_env)
    view = client.get('/api/retirement')
    plan = deepcopy(view.json()['plan'])
    plan['partner']['national_monthly'] = 12345
    response = client.put('/api/retirement/plan', headers=headers(data_env, view), json=plan)
    assert response.status_code == 403, response.text
    assert partner.get('/api/retirement').status_code == 403


def test_read_cache_coalesces_reads_and_is_invalidated_after_save(client, data_env, monkeypatch):
    monkeypatch.setenv('RETIRE_SHARED_READ_CACHE_SECONDS', '30')
    migrate(client, data_env)
    view = client.get('/api/family')
    before = len(data_env.fake.actors)
    for path in ['/api/family', '/api/dashboard', '/api/retirement', '/api/google/shared/status']:
        assert client.get(path).status_code == 200
    assert len(data_env.fake.actors) == before
    body = {k: v for k, v in view.json().items() if k in storage.FamilyInput.model_fields}
    body['me']['age'] = 45
    saved = client.put('/api/family', headers=headers(data_env, view), json=body)
    assert saved.status_code == 200, saved.text
    assert client.get('/api/family').json()['me']['age'] == 45


def test_additional_pension_plan_is_saved_in_sheet(client, data_env):
    from backend.shared_data import Save
    initial, _ = migrate(client, data_env)
    record = deepcopy(find(initial['state'], 'asset', data_env.asset_id))
    record['payload'].update(pocket='retirement', pension_layer=4)
    from tests.test_shared_data import save_request
    saved = client.post('/api/shared-data/save', headers=data_env.headers, json=save_request(initial, record))
    assert saved.status_code == 200
    path = '/api/workbook/additional-pensions/' + data_env.asset_id
    view = client.get(path)
    assert view.status_code == 200, view.text
    body = {**view.json()['plan'], 'monthly': 10000, 'day': 10}
    response = client.put(path, headers=headers(data_env, view), json=body)
    assert response.status_code == 200, response.text
    assert client.get(path).json()['plan']['monthly'] == 10000
    assert find(client.get('/api/shared-data').json()['state'], 'additional_plan', data_env.asset_id)['payload']['monthly'] == 10000


def test_hold_record_roundtrip_is_shared_and_does_not_write_local_journal(client, data_env):
    from backend import trade_journal
    migrate(client, data_env)
    view = client.get('/api/workbook/journal?pool_id=shared')
    assert view.status_code == 200
    body = dict(request_id=str(uuid4()), pool_id='shared', kind='hold', event_date='2026-01-01', note='이번 달 보류')
    response = client.post('/api/workbook/journal', headers=headers(data_env, view), json=body)
    assert response.status_code == 200, response.text
    assert client.get('/api/workbook/journal?pool_id=shared').json()['entries'][0]['note'] == body['note']
    assert not trade_journal.DB_PATH.exists()


def test_household_book_month_is_saved_in_sheet_not_local(client, data_env):
    from tests.test_household_book import entry
    initial, _ = migrate(client, data_env)
    original = storage.DB_PATH.read_bytes()
    view = client.get('/api/household-book', params={'year': 2026, 'month': 10})
    assert view.status_code == 200, view.text
    assert view.json()['selected']['recorded'] is False
    saved = client.put('/api/household-book/2026-10', json=entry() | {'version': 0}, headers=headers(data_env, view))
    assert saved.status_code == 200, saved.text
    record = find(client.get('/api/shared-data').json()['state'], 'household_month', '2026-10')
    assert record['member_id'] == 'household' and record['payload']['version'] == 1
    assert record['payload']['spend']['groceries'] == 1_180_000
    again = client.get('/api/household-book', params={'year': 2026, 'month': 10}).json()
    assert again['selected']['recorded'] and again['selected']['summary']['income'] == 9_850_000
    stale = client.put('/api/household-book/2026-10', json=entry() | {'version': 0}, headers=headers(data_env, view))
    assert stale.status_code == 409
    assert storage.DB_PATH.read_bytes() == original
