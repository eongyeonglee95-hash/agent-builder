from copy import deepcopy
from uuid import uuid4

import pytest

from backend.shared_data_google import ASSETS_VIEW, TAB, head
from backend.shared_data_schema import fingerprint
from backend.shared_sheets_google import DRIVE
from tests.test_web_auth import signing_material, setup, client
from tests.test_household_invites import invited
from tests.test_shared_data import data_env, partner, migrate, find, save_request
from tests.test_shared_sheets import SID, OTHER, response

ROOT = '/api/shared-data/versions'


def copy_fixture(env):
    env.fake.files[OTHER] = deepcopy(env.fake.files[SID])
    env.fake.files[OTHER]['meta'].update(id=OTHER, name='지난달 우리 자산')


def switch_request(client, env):
    current = client.get(ROOT).json()['current']
    target = client.post(ROOT + '/preview', headers=env.headers, json={'spreadsheet_id': OTHER})
    assert target.status_code == 200, target.text
    return dict(spreadsheet_id=OTHER, current_spreadsheet_id=SID,
                current_revision=current['revision'], target_revision=target.json()['revision'])


def test_preview_and_switch_preserve_files_and_reject_stale_drafts(client, data_env):
    env = data_env
    initial, _ = migrate(client, env)
    copy_fixture(env)
    record = deepcopy(find(initial['state'], 'asset', env.asset_id))
    record['payload']['amount'] = 900
    saved = client.post('/api/shared-data/save', headers=env.headers, json=save_request(initial, record)).json()
    before_files = deepcopy(env.fake.files)
    request = switch_request(client, env)
    assert env.data_store.binding(1)['spreadsheet_id'] == SID
    r = client.post(ROOT + '/activate', headers=env.headers, json=request)
    assert r.status_code == 200, r.text
    assert env.fake.files == before_files
    assert client.get('/api/google/shared/status').json()['spreadsheet']['spreadsheet_id'] == OTHER
    assert find(client.get('/api/shared-data').json()['state'], 'asset', env.asset_id)['payload']['amount'] == 600
    stale = {**save_request(saved, record), 'expected_spreadsheet_id': SID}
    assert client.post('/api/shared-data/save', headers=env.headers, json=stale).status_code == 409
    assert len(client.get(ROOT).json()['versions']) == 2
    assert env.data_store.load_backup(r.json()['backup_id'])['target_id'] == OTHER


def test_switch_conflict_foreign_members_and_partner_denied(client, data_env, partner):
    migrate(client, data_env)
    copy_fixture(data_env)
    request = switch_request(client, data_env)
    request['target_revision'] = '0' * 64
    assert client.post(ROOT + '/activate', headers=data_env.headers, json=request).status_code == 409
    assert partner.post(ROOT + '/preview', json={'spreadsheet_id': OTHER}).status_code == 403
    assert partner.post(ROOT + '/activate', json=request).status_code == 403
    assert data_env.data_store.binding(1)['spreadsheet_id'] == SID
    data_env.fake.files[OTHER]['tabs'][TAB][-1][-1] = data_env.fake.files[OTHER]['tabs'][TAB][-1][-1].replace(data_env.data_store.people(data_env.identity)['me'], str(uuid4()))
    assert client.post(ROOT + '/preview', headers=data_env.headers, json={'spreadsheet_id': OTHER}).status_code == 409


def test_copy_has_durable_idempotency_and_does_not_activate(client, data_env, monkeypatch):
    import requests
    migrate(client, data_env)
    current = client.get(ROOT).json()['current']
    transport = data_env.fake.request
    calls = []
    def request(method, url, **kw):
        if method == 'POST' and url == f'{DRIVE}/{SID}/copy':
            calls.append(url)
            copy_fixture(data_env)
            data_env.fake.files[OTHER]['meta'].update(kw['json'])
            raise requests.Timeout('lost response')
        return transport(method, url, **kw)
    monkeypatch.setattr(requests, 'request', request)
    body = dict(operation_id=str(uuid4()), current_spreadsheet_id=SID, current_revision=current['revision'], title='보관 버전')
    assert client.post(ROOT + '/copy', headers=data_env.headers, json=body).status_code == 503
    result = client.post(ROOT + '/copy', headers=data_env.headers, json=body)
    assert result.status_code == 200, result.text
    assert result.json()['spreadsheet_id'] == OTHER
    assert len(calls) == 1
    assert data_env.data_store.binding(1)['spreadsheet_id'] == SID
    assert client.post(ROOT + '/copy', headers=data_env.headers, json=body).status_code == 200
    assert len(calls) == 1


def test_asset_edit_create_delete_and_materialized_sheet(client, data_env):
    initial, _ = migrate(client, data_env)
    record = find(initial['state'], 'asset', data_env.asset_id)
    payload = {k: v for k, v in record['payload'].items() if k not in {'source','account_id','updated_at','version','request_id'}}
    body = dict(operation_id=str(uuid4()), expected_revision=initial['revision'], expected_spreadsheet_id=SID,
                asset_id=data_env.asset_id, asset={**payload, 'owner': 'me', 'name': '=not-a-formula', 'amount': 777})
    result = client.post('/api/shared-data/assets', headers=data_env.headers, json=body)
    assert result.status_code == 200, result.text
    assert result.json()['amount'] == 777
    writes = data_env.fake.writes
    assert client.post('/api/shared-data/assets', headers=data_env.headers, json=body).status_code == 200
    assert data_env.fake.writes == writes
    rows = data_env.fake.files[SID]['tabs'][ASSETS_VIEW]
    assert any(r[0] == '=not-a-formula' and r[5] == 777 for r in rows[2:])
    current = client.get('/api/shared-data').json()
    deletion = dict(operation_id=str(uuid4()), expected_revision=current['revision'], expected_spreadsheet_id=SID, asset_id=data_env.asset_id)
    assert client.post('/api/shared-data/assets', headers=data_env.headers, json=deletion).status_code == 200
    assert not any(r[0] == '=not-a-formula' for r in data_env.fake.files[SID]['tabs'][ASSETS_VIEW])
    assert client.post('/api/shared-data/assets', headers=data_env.headers, json={**body, 'operation_id': str(uuid4())}).status_code == 409


def test_template_partitions_assets_without_counting_holdings_twice(client, data_env):
    from backend.shared_sheet_template import sections, TITLES, template_requests
    initial, _ = migrate(client, data_env)
    tabs = sections(initial['state'])
    all_rows = tabs['우리 자산']['rows'][2:tabs['우리 자산']['asset_end']]
    parts = [r for t in TITLES[1:] for r in tabs[t]['rows'][2:tabs[t]['asset_end']]]
    assert sorted(all_rows) == sorted(parts)
    assert sum(tabs[t]['summary'][1][1] for t in TITLES[1:]) == tabs['우리 자산']['summary'][1][1]
    assert sum(tabs[t]['summary'][2][1] for t in TITLES[1:]) == tabs['우리 자산']['summary'][2][1]
    live = data_env.fake.files[SID]['tabs']
    assert all(t in live for t in TITLES)
    meta = {'sheets': [{'properties': {'title': t, 'sheetId': data_env.fake.ids[t]}} for t in live]}
    repeat = template_requests(initial['state'], meta)
    assert not any('addSheet' in r for r in repeat)
    written = {r['updateCells']['range']['sheetId'] for r in repeat if 'updateCells' in r}
    assert written == {data_env.fake.ids[t] for t in (*TITLES, '자산 내역', '보유 종목')}
    assert data_env.fake.ids[TAB] not in written


def test_template_renders_structured_address_as_text(client, data_env):
    from backend.shared_sheet_template import sections, template_requests
    initial, _ = migrate(client, data_env)
    state = deepcopy(initial['state'])
    asset = next(r for r in state['records'] if r['kind'] == 'asset')
    state['records'].append({'kind': 'property_detail', 'id': asset['id'], 'member_id': asset['member_id'],
                             'payload': {'address': {'road': '서울시 테스트로 12', 'jibun': '테스트동 1'}, 'area_m2': 84.5}})
    assert any('서울시 테스트로 12' in row for row in sections(state)['부동산']['rows'])
    template_requests(state, {'sheets': []})
