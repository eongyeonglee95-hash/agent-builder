"""세금 확인 안내: 개인별·명목·초과 경계와 API 연결. 실제 자료/세액 계산 없음."""
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from backend import retirement, storage
from backend.main import app
from tools.pension import load_pension_rules
from tools.pension_tax_notice import load_tax_notice_rules, private_pension_tax_checks


def item(person='me', monthly=1_250_001, layer=3, real=800_000):
    return {'person': person, 'layer': layer, 'nominal': monthly, 'real': real, 'label': '검수'}


@pytest.mark.parametrize('monthly,shows', [(0, False), (1_249_999, False), (1_250_000, False), (1_250_001, True)])
def test_only_strictly_above_the_annual_threshold(monthly, shows):
    result = private_pension_tax_checks([item(monthly=monthly)], load_tax_notice_rules())
    assert bool(result) is shows
    if shows:
        assert result == [{'person': 'me', 'annual_nominal': monthly * 12}]


def test_no_household_aggregation_but_multiple_streams_of_the_same_person_sum():
    rules = load_tax_notice_rules()
    assert private_pension_tax_checks([item(monthly=1_000_000), item('partner', 1_000_000)], rules) == []
    assert private_pension_tax_checks([item(monthly=700_000), item(monthly=600_000), item('partner', 2_000_000)], rules) == [
        {'person': 'me', 'annual_nominal': 15_600_000}, {'person': 'partner', 'annual_nominal': 24_000_000}]


def test_nominal_amount_and_third_layer_only_without_mutation():
    items = [item(layer=1, monthly=3_000_000), item(layer=2, monthly=4_000_000), item(layer=4, monthly=5_000_000), item()]
    before = deepcopy(items)
    assert private_pension_tax_checks(items, load_tax_notice_rules()) == [{'person': 'me', 'annual_nominal': 15_000_012}]
    assert items == before
    assert private_pension_tax_checks(items[:-1], load_tax_notice_rules()) == []


def test_threshold_is_read_from_rules():
    rules = {**load_tax_notice_rules(), 'annual_threshold': 24_000_000}
    assert private_pension_tax_checks([item(monthly=2_000_000)], rules) == []
    assert private_pension_tax_checks([item(monthly=2_000_001)], rules)


def test_projection_connects_only_paying_years_and_uses_nominal_not_display_amount():
    result = retirement.build({'me': {'private_start_age': 60}, 'partner': {'private_start_age': 60}, 'return_rate': 0, 'inflation': .02},
                              {'me': {'age': 40}, 'partner': {'age': 43}, 'retirement_age': 60},
                              {'me': {3: 450_000_360}, 'partner': {3: 360_000_000}}, 2026, load_pension_rules())
    rows = {row['year']: row for row in result['projection']['rows']}
    assert rows[2045]['pension_tax_checks'] == []  # 배우자는 이미 수령하지만 기준 이하
    assert rows[2046]['pension_tax_checks'] == [{'person': 'me', 'annual_nominal': 15_000_012}]
    own = next(i for i in rows[2046]['items'] if i['person'] == 'me' and i['layer'] == 3)
    assert own['real'] * 12 < 15_000_000
    assert result['pension_tax_rule'] == load_tax_notice_rules()


def test_preview_and_get_have_the_same_notices_without_saving(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, 'DB_PATH', tmp_path / 'ledger.sqlite3')
    monkeypatch.setattr(retirement, 'balances', lambda: {'me': {3: 600_000_000}})
    with TestClient(app, base_url='http://127.0.0.1', headers={'Origin': 'http://127.0.0.1', 'X-Retire-Local': '1'}) as client:
        assert client.put('/api/family', json={'me': {'name': '검수', 'age': 60}, 'retirement_age': 60, 'version': 0}).status_code == 200
        before = client.get('/api/retirement').json()
        preview = client.post('/api/retirement/preview', json=before['plan']).json()
        assert preview['projection']['rows'][0]['pension_tax_checks'] == before['projection']['rows'][0]['pension_tax_checks']
        assert preview['projection']['rows'][0]['pension_tax_checks']
        assert client.get('/api/retirement').json()['plan'] == before['plan']
