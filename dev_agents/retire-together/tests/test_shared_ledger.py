from copy import deepcopy
from uuid import uuid4
import pytest
from fastapi import HTTPException
from backend import storage
from backend.shared_ledger import tables, native_rows, reconcile
from backend.shared_data_google import head, TAB
from tests.test_web_auth import signing_material, setup, client
from tests.test_household_invites import invited
from tests.test_shared_data import data_env, migrate, find, save_request, partner
from tests.test_shared_sheets import SID


def context(view):
    return dict(operation_id=str(uuid4()), expected_revision=view['revision'], expected_spreadsheet_id=view['spreadsheet_id'])


def test_native_asset_edit_syncs_all_views_and_preserves_local(client, data_env):
    initial, _ = migrate(client, data_env)
    local = storage.DB_PATH.read_bytes()
    cells = data_env.fake.files[SID]['tabs']['자산 내역']
    row = next(r for r in cells[2:] if r[11] == 'asset:' + data_env.asset_id)
    row[7] = 900
    # An ordinary app save cannot silently replace unsynced native edits.
    record = deepcopy(find(initial['state'], 'asset', data_env.asset_id)); record['payload']['amount'] = 800
    blocked = client.post('/api/shared-data/save', headers=data_env.headers, json=save_request(initial, record))
    assert blocked.status_code == 409 and '시트 변경 불러오기' in blocked.text
    view = client.get('/api/shared-data/ledger').json()
    assert len(view['pending']) == 1 and not view['issue']
    body = context(view)
    result = client.post('/api/shared-data/ledger/sync', headers=data_env.headers, json=body)
    assert result.status_code == 200, result.text
    assert result.json()['changed'] == 1
    assert find(result.json()['state'], 'asset', data_env.asset_id)['payload']['amount'] == 900
    assert client.get('/api/dashboard').json()['cash'] == 900
    assert storage.DB_PATH.read_bytes() == local
    writes = data_env.fake.writes
    assert client.post('/api/shared-data/ledger/sync', headers=data_env.headers, json=body).status_code == 200
    assert data_env.fake.writes == writes
    assert client.get('/api/shared-data/ledger').json()['pending'] == []


def test_app_cell_edit_updates_native_table_and_rejects_stale(client, data_env):
    initial, _ = migrate(client, data_env)
    body = {**context(initial), 'tab':'자산 내역', 'row_id':'asset:'+data_env.asset_id, 'column':7, 'value':1234}
    result = client.post('/api/shared-data/ledger/edit', headers=data_env.headers, json=body)
    assert result.status_code == 200, result.text
    assert next(r for r in data_env.fake.files[SID]['tabs']['자산 내역'][2:] if r[11] == body['row_id'])[7] == 1234
    result = client.post('/api/shared-data/ledger/edit', headers=data_env.headers, json={**body,'operation_id':str(uuid4()), 'value':7})
    assert result.status_code == 409


@pytest.mark.parametrize('change', ['missing','duplicate','formula','readonly','negative','generated'])
def test_invalid_native_edits_never_write(client, data_env, change):
    initial, _ = migrate(client, data_env)
    tabs = data_env.fake.files[SID]['tabs']; rows = tabs['자산 내역']
    row = next(r for r in rows[2:] if r[11] == 'asset:'+data_env.asset_id)
    if change == 'missing': rows.remove(row)
    elif change == 'duplicate': rows.append(deepcopy(row))
    elif change == 'formula': row[7] = '=1+2'
    elif change == 'readonly': row[2] = '배우자'
    elif change == 'negative': row[7] = -1
    else: tabs['우리 자산'][2][5] = 77
    before = deepcopy(tabs); writes = data_env.fake.writes
    result = client.post('/api/shared-data/ledger/sync', headers=data_env.headers, json=context(initial))
    assert result.status_code == 409, result.text
    assert tabs == before and data_env.fake.writes == writes


def test_sort_rows_and_holding_delta_preserve_ids_and_deposit():
    aid, asset_id, hid = 'a1', str(uuid4()), str(uuid4())
    members = {'me':str(uuid4()),'partner':str(uuid4())}
    state = {'schema':1,'members':members,'records':[
        {'kind':'profile','id':members['me'],'member_id':members['me'],'payload':{'name':'테스트'}},
        {'kind':'account','id':aid,'member_id':members['me'],'payload':{'broker':'테스트','account_type':'general','pocket':'cash'}},
        {'kind':'holding','id':hid,'member_id':members['me'],'payload':{'account_id':aid,'ticker_name':'테스트','ticker':'123456','qty':2,'price':100,'buy_value':150,'as_of':'2026-01-01'}},
        {'kind':'asset','id':asset_id,'member_id':members['me'],'payload':{'name':'테스트','account':'테스트','account_id':aid,'pocket':'cash','assetClass':'mixed','amount':200,'source':'file','as_of':'2026-01-01'}},
    ]}
    cells = {title:[[title], t['headers'],*native_rows(t)] for title,t in tables(state).items()}
    cells['보유 종목'][2][3] = 3
    after, changes = reconcile(state,cells)
    assert len(changes) == 1
    assert find(after,'asset',asset_id)['payload']['amount'] == 300
    assert find(after,'holding',hid)['payload']['qty'] == 3
    assert find(after,'holding',hid)['payload']['buy_value'] == 150


def test_sorted_rows_sync_by_identity(client, data_env):
    initial,_ = migrate(client,data_env)
    rows = data_env.fake.files[SID]['tabs']['자산 내역']
    rows[2:] = list(reversed(rows[2:]))
    next(r for r in rows[2:] if r[11]=='asset:'+data_env.asset_id)[7] = 456
    result = client.post('/api/shared-data/ledger/sync',headers=data_env.headers,json=context(initial))
    assert result.status_code == 200, result.text
    assert find(result.json()['state'],'asset',data_env.asset_id)['payload']['amount']==456


def test_partner_cannot_import_other_peoples_native_changes(client,data_env,partner):
    initial,_ = migrate(client,data_env)
    assert partner.post('/api/shared-data/ledger/sync',json=context(initial)).status_code==403


def test_download_uses_same_tabs_and_values(client, data_env):
    from io import BytesIO
    from openpyxl import load_workbook
    migrate(client, data_env)
    view = client.get('/api/shared-data/ledger').json()
    response = client.get('/api/shared-data/ledger.xlsx')
    assert response.status_code == 200, response.text
    book = load_workbook(BytesIO(response.content))
    assert book.sheetnames == ['우리 자산','보유 종목','자산 내역','연금','주식','부동산','현금·기타']
    assert [c.value for c in book['자산 내역'][2]] == view['tabs']['자산 내역']['rows'][1]
    assert book['우리 자산']['K3'].value == view['tabs']['우리 자산']['summary'][1][1]
    assert book['자산 내역'].freeze_panes == 'B3'
