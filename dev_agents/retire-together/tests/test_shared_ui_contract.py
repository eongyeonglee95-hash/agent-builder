"""SHARE-06 UI contracts; real routes, synthetic identities and fake Google HTTP."""
from copy import deepcopy
from uuid import uuid4

import pytest

from backend import storage
from backend.shared_data_schema import projection
from backend.shared_data_view import dashboard
from tests.test_web_auth import signing_material, setup, client
from tests.test_household_invites import invited
from tests.test_shared_data import data_env, partner, migrate, find


def test_dashboard_two_viewers_fixed_goal_and_joint_share(client, data_env, partner, monkeypatch):
    result, _ = migrate(client, data_env)
    before = deepcopy(result['state'])
    # Successful shared reads cannot use the local ledger after migration.
    monkeypatch.setattr(storage, 'ledger_rows', lambda *_: pytest.fail('local ledger fallback'))
    owner = client.get('/api/shared-data/dashboard?owner=me').json()
    other = partner.get('/api/shared-data/dashboard?owner=me').json()
    assert owner['snapshot']['total'] == 4600
    assert other['snapshot']['total'] == 6000
    assert owner['family']['me']['name'] == '첫 사람'
    assert other['family']['me']['name'] == '둘째 사람'
    assert other['family']['goal_person']['name'] == '첫 사람'
    assert other['family']['goal_reference_label'] == '배우자'
    assert other['family']['retirement_age'] == owner['family']['retirement_age'] == 60
    joint = next(r for r in other['snapshot']['assets'] if r['owner'] == 'joint')
    assert joint['share_percent'] == 60 and joint['amount'] == 6000 and joint['full_amount'] == 10000
    assert client.get('/api/shared-data').json()['state'] == before
    assert client.get('/api/google/shared/status').json()['data_started'] is True
    assert client.get('/api/shared-data/dashboard?owner=stranger').status_code == 422
    assert partner.get('/api/dashboard').status_code == 403


def test_dashboard_before_migration_and_outage_never_uses_local(client, data_env):
    assert client.get('/api/google/shared/status').json()['data_started'] is False
    assert client.get('/api/shared-data/dashboard').status_code == 409
    migrate(client, data_env)
    data_env.fake.status = 503
    result = client.get('/api/shared-data/dashboard')
    assert result.status_code == 503 and 'snapshot' not in result.json()


def test_dashboard_details_and_joint_rounding_do_not_change_owner():
    root_id, child_id = str(uuid4()), str(uuid4())
    def asset(rid, member, **payload):
        return dict(kind='asset', id=rid, member_id=member, payload=dict(name=rid, account='a', pocket='cash', assetClass='cash', amount=100, as_of='2026-01-01', **payload))
    root = asset(root_id, 'owner-id', valuation_source='details')
    child = asset(child_id, 'owner-id', parent_id=root_id)
    joint = dict(kind='asset', id=str(uuid4()), member_id='joint', payload=dict(name='집', account='집', pocket='property', assetClass='property', amount=101, as_of='2026-01-01', share_percent=33))
    state = dict(schema=1, members=dict(me='owner-id', partner='partner-id'), records=[root, child, joint])
    before = deepcopy(state)
    owner = dashboard(state, projection(state, 'owner-id'), 'me')['snapshot']
    partner = dashboard(state, projection(state, 'partner-id'), 'me')['snapshot']
    all_data = dashboard(state, projection(state, 'partner-id'), 'together')['snapshot']
    assert owner['total'] == 133 and partner['total'] == 68 and all_data['total'] == 201
    assert owner['count'] == 2 and len(owner['assets']) == 2
    assert all_data['account_groups'][0]['account']['owner'] == 'partner'
    assert state == before


def test_recovery_summary_matches_named_original_and_permission_boundary(client, data_env, partner):
    result, _ = migrate(client, data_env)
    bid = result['backup_id']
    preview = client.get('/api/shared-data/recovery/' + bid)
    assert preview.status_code == 200
    assert preview.json()['before_summary'] is None
    assert preview.json()['proposed_summary'] == result['summary']
    assert 'archive' not in preview.json()
    assert partner.get('/api/shared-data/recovery/' + bid).status_code == 403
    record = deepcopy(find(result['state'], 'profile', result['viewer']['partner']))
    record['payload']['name'] = '본인 허용 전'
    request = dict(operation_id=str(uuid4()), expected_revision=result['revision'], upsert=[record])
    assert client.post('/api/shared-data/save', headers=data_env.headers, json=request).status_code == 403
    assert partner.put('/api/shared-data/permissions', json={'allow_other': True}).status_code == 200
    request['operation_id'] = str(uuid4())
    assert client.post('/api/shared-data/save', headers=data_env.headers, json=request).status_code == 200
    assert partner.get('/api/shared-data/dashboard').json()['family']['me']['name'] == '본인 허용 전'


def test_conflict_review_totals_follow_choice_without_mutation(client, data_env, partner):
    from tests.test_shared_data import preview, add_sheet_asset
    plan = preview(client, data_env)
    record = find(plan['state'], 'asset', data_env.asset_id)
    add_sheet_asset(data_env, {**record['payload'], 'id': record['id'], 'owner': 'me', 'amount': 987})
    plan = preview(client, data_env)
    writes = data_env.fake.writes
    request = {'preview_id': plan['preview_id'], 'choices': {}}
    assert client.post('/api/shared-data/migration/review', headers=data_env.headers, json=request).status_code == 409
    request['choices'] = {plan['conflicts'][0]['key']: 'sheet'}
    response = client.post('/api/shared-data/migration/review', headers=data_env.headers, json=request)
    assert response.status_code == 200, response.text
    owner = plan['state']['members']['me']
    assert response.json()['proposed']['totals'][owner]['assets'] == 987
    assert find(response.json()['state'], 'asset', data_env.asset_id)['payload']['amount'] == 987
    assert data_env.fake.writes == writes
    assert not data_env.data_store.started(data_env.identity['household_id'])
    assert partner.post('/api/shared-data/migration/review', json=request).status_code == 403
