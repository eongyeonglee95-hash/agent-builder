from copy import deepcopy
from datetime import date
import pytest
from backend.retirement import build
from tools.pension import load_pension_rules
from tools.retirement_report import build_outlook


def make(plan=None, family=None):
    plan = plan or {'version': 1, 'monthly_need': 1000000, 'return_rate': 0, 'inflation': 0,
                    'me': {'retire_age': 60, 'private_start_age': 60, 'savings_annual': 0}}
    return build_outlook(plan, family or {'me': {'age': 40}}, {'me': {3: 0}}, 2026,
                         load_pension_rules(), date(2026, 11, 18), build)


def test_extra_savings_are_calculated_and_inputs_unchanged():
    plan = {'version': 1, 'monthly_need': 1000000, 'return_rate': 0, 'inflation': 0,
            'me': {'retire_age': 60, 'private_start_age': 60, 'savings_annual': 0}}
    original = deepcopy(plan)
    report = make(plan)
    assert plan == original
    assert report['available']
    first = report['scenarios'][0]
    # 100,000/month × 12 × 20 years, paid out over 30 years with no growth/inflation.
    assert first['increase'] == pytest.approx(100000 * 20 / 30, abs=1)
    assert first['shortfall'] == 1000000 - first['income']
    assert report['milestones'][0]['shortfall'] == 1000000


def test_missing_inputs_and_unsaved_plan_do_not_claim_readiness():
    assert not make(family={'me': {}})['available']
    assert not make(plan={'version': 0})['available']


def test_no_remaining_contribution_years_produces_no_scenarios():
    report = make(plan={'version': 1, 'me': {'retire_age': 60, 'private_start_age': 60}}, family={'me': {'age': 60}})
    assert report['available'] and not report['scenarios']
    assert '남은 기간' in report['scenario_note']
