"""개인연금 미래 납입 기간: 독립 현금흐름 합산, 기존 계산 호환, 미리보기/저장 경계."""
from dataclasses import replace
from datetime import date

import pytest
from fastapi.testclient import TestClient

from backend import storage
from backend.main import app
from tools.pension import Assumptions, Person, future_value, load_pension_rules, person_streams, savings_schedule

A = Assumptions.from_rules(load_pension_rules())
P = Person('me', '나', age=40, retire_age=60, private_start_age=60,
           balances={3: 60_000_000}, annual={3: 6_000_000}, savings_first_age=41, savings_end_age=55)


@pytest.mark.parametrize('first,last,rate', [(41, 55, .05), (43, 55, .05), (55, 55, .05), (41, 55, 0), (41, 60, .05)])
def test_each_payment_grows_only_from_payment_to_payout(first, last, rate):
    p = replace(P, savings_first_age=first, savings_end_age=last)
    stream = next(s for s in person_streams(p, replace(A, return_rate=rate)) if s.layer == 3)
    # Independent per-year cash-flow sum, including the last contribution year.
    expected = 60_000_000 * (1 + rate) ** 20 + sum(6_000_000 * (1 + rate) ** (60 - age) for age in range(first, last + 1))
    assert stream.principal == round(expected)
    assert savings_schedule(p)['payments'] == last - first + 1
    assert savings_schedule(p)['total_contributions'] == 6_000_000 * (last - first + 1)


@pytest.mark.parametrize('age,retire,payout', [(40, 55, 60), (40, 65, 60), (65, 60, 60)])
def test_legacy_annual_amount_keeps_previous_calculation(age, retire, payout):
    p = replace(P, age=age, retire_age=retire, private_start_age=payout, savings_first_age=None, savings_end_age=None)
    stream = next(s for s in person_streams(p, A) if s.layer == 3)
    start = max(age, payout)
    assert stream.principal == round(future_value(60_000_000, 6_000_000, A.return_rate, start-age, min(retire, start)-age))


def test_past_payments_are_not_added_again_and_balance_still_grows():
    p = replace(P, age=53, savings_first_age=41)
    assert savings_schedule(p)['payments'] == 2
    assert savings_schedule(replace(p, age=56))['payments'] == 0
    assert next(s for s in person_streams(replace(p, age=56), A) if s.layer == 3).principal == round(60_000_000 * (1+A.return_rate)**4)
    # The explicitly chosen end age is independent of an earlier retirement.
    assert savings_schedule(replace(P, retire_age=50))['payments'] == 15


@pytest.fixture
def client(tmp_path, monkeypatch):
    accounts = tmp_path / 'accounts.yaml'
    accounts.write_text('accounts: []\npools: {}\n', encoding='utf-8')
    monkeypatch.setenv('RETIRE_ACCOUNTS_PATH', str(accounts))
    monkeypatch.setattr(storage, 'DB_PATH', tmp_path / 'ledger.sqlite3')
    with TestClient(app, base_url='http://127.0.0.1', headers={'Origin': 'http://127.0.0.1', 'X-Retire-Local': '1'}) as c:
        assert c.put('/api/family', json={'me': {'name': '나', 'age': 40}, 'partner': {'name': '배우자', 'age': 43}, 'retirement_age': 60, 'version': 0}).status_code == 200
        yield c


def test_preview_is_read_only_save_roundtrip_and_partner_is_unchanged(client):
    before = client.get('/api/retirement').json()
    assets = client.get('/api/assets').json()
    plan = {**before['plan'], 'me': {**before['plan']['me'], 'savings_annual': 6_000_000, 'savings_start_year': date.today().year+1, 'savings_end_age': 55}}
    preview = client.post('/api/retirement/preview', json=plan).json()
    assert preview['error'] is None
    assert preview['savings_plans']['me']['payments'] == 15
    assert preview['savings_plans']['me']['total_contributions'] == 90_000_000
    assert preview['capital'] == before['capital']
    assert client.get('/api/retirement').json()['plan'] == before['plan']
    saved = client.put('/api/retirement/plan', json=plan)
    assert saved.status_code == 200, saved.text
    saved = saved.json()
    assert saved['savings_plans'] == preview['savings_plans']
    assert saved['projection'] == preview['projection']
    assert saved['plan']['partner'] == before['plan']['partner']
    assert client.get('/api/retirement').json()['plan'] == saved['plan']
    assert client.put('/api/retirement/plan', json=plan).status_code == 409
    assert client.get('/api/assets').json() == assets
    # An explicit zero stops future payments; it is never replaced by the new-plan template.
    stopped = client.put('/api/retirement/plan', json={**saved['plan'], 'me': {**saved['plan']['me'], 'savings_annual': 0}}).json()
    assert stopped['plan']['me']['savings_annual'] == 0
    assert stopped['savings_plans']['me']['total_contributions'] == 0
    assert stopped['savings_plans']['me']['monthly_real'] == 0


@pytest.mark.parametrize('change', [
    {'savings_start_year': None}, {'savings_end_age': None},
    {'savings_start_year': date.today().year+20}, {'savings_end_age': 61},
    {'savings_start_year': True}, {'savings_start_year': 2027.5}, {'savings_annual': -1},
])
def test_invalid_window_never_saves(client, change):
    before = client.get('/api/retirement').json()['plan']
    plan = {**before, 'me': {**before['me'], 'savings_annual': 6_000_000, 'savings_start_year': date.today().year+1, 'savings_end_age': 55, **change}}
    assert client.put('/api/retirement/plan', json=plan).status_code == 422
    assert client.get('/api/retirement').json()['plan'] == before


def test_each_person_uses_their_own_age_and_template_does_not_apply_itself(client):
    data = client.get('/api/retirement').json()
    assert data['savings_plan_template'] == load_pension_rules()['savings_plan_template']
    assert all(p['annual'] == 0 for p in data['savings_plans'].values())
    plan = data['plan']
    for who in ('me', 'partner'):
        plan[who].update(savings_annual=6_000_000, savings_start_year=date.today().year+1, savings_end_age=55)
    preview = client.post('/api/retirement/preview', json=plan).json()
    assert preview['savings_plans']['me']['payments'] == 15
    assert preview['savings_plans']['partner']['payments'] == 12
    assert preview['savings_plans']['partner']['end_year'] == date.today().year+12


def test_missing_family_cannot_save_a_contribution_window(client):
    before = client.get('/api/family').json()
    assert client.put('/api/family', json={'me': {'name': '나'}, 'retirement_age': 60, 'version': before['version']}).status_code == 200
    plan = client.get('/api/retirement').json()['plan']
    plan['me'].update(savings_annual=6_000_000, savings_start_year=date.today().year+1, savings_end_age=55)
    assert client.put('/api/retirement/plan', json=plan).status_code == 422


@pytest.mark.parametrize('balance,annual,rate,inflation', [
    (60_000_000, 6_000_000, .05, .02),
    (60_000_000, 6_000_000, 0, 0),
    (0, 6_000_000, .05, .02),
    (60_000_000, 0, .05, .02),
    (0, 0, 0, 0),
    (41, 1, .05, .02),
])
def test_single_payment_breakdown_reconciles_without_changing_current_balance(balance, annual, rate, inflation):
    from tools.pension import savings_breakdown
    p = replace(P, balances={3: balance}, annual={3: annual}, savings_end_age=41)
    a = replace(A, return_rate=rate, inflation=inflation)
    result = savings_breakdown(p, a)
    current_future = balance * (1+rate)**20
    new_future = annual * (1+rate)**19
    total_future = current_future + new_future
    monthly_rate = (1+rate)**(1/12)-1
    def monthly(principal):
        nominal = principal/360 if rate == 0 else principal*monthly_rate/(1-(1+monthly_rate)**-360)
        return round(round(nominal)/(1+inflation)**20)
    assert result['existing_principal'] == round(current_future)
    assert result['principal'] == round(total_future)
    assert result['existing_monthly_real'] == monthly(current_future)
    assert result['monthly_real'] == monthly(total_future)
    assert result['existing_principal'] + result['contribution_principal'] == result['principal']
    assert result['existing_monthly_real'] + result['contribution_monthly_real'] == result['monthly_real']
    assert abs(result['contribution_principal'] - round(new_future)) <= 1
    if annual == 0:
        assert result['contribution_principal'] == result['contribution_monthly_real'] == 0
    assert p.balances == {3: balance} and p.annual == {3: annual}


def test_preview_and_save_breakdown_preserve_existing_assets(client):
    from uuid import uuid4
    response = client.post('/api/assets', json={'request_id': str(uuid4()), 'name': '검수 개인연금',
        'account': '검수 연금저축', 'owner': 'me', 'pocket': 'retirement', 'assetClass': 'mixed',
        'amount': 60_000_000, 'as_of': date.today().isoformat(), 'pension_layer': 3})
    assert response.status_code in (200, 201), response.text
    assets = client.get('/api/assets').json()
    before = client.get('/api/retirement').json()
    plan = {**before['plan'], 'me': {**before['plan']['me'], 'savings_annual': 6_000_000,
        'savings_start_year': date.today().year+1, 'savings_end_age': 41}}
    preview = client.post('/api/retirement/preview', json=plan).json()
    parts = preview['savings_plans']['me']
    assert parts['balance_now'] == 60_000_000 and parts['total_contributions'] == 6_000_000
    assert parts['existing_principal'] == before['savings_plans']['me']['principal']
    assert parts['existing_monthly_real'] == before['savings_plans']['me']['monthly_real']
    assert parts['existing_principal'] + parts['contribution_principal'] == parts['principal']
    assert parts['existing_monthly_real'] + parts['contribution_monthly_real'] == parts['monthly_real']
    assert client.get('/api/retirement').json()['plan'] == before['plan']
    saved = client.put('/api/retirement/plan', json=plan).json()
    assert saved['savings_plans']['me'] == parts
    assert client.get('/api/assets').json() == assets
    assert saved['capital'] == before['capital']
