import pytest
from tools.stock_diagnostics import diagnose


def row(name, value, ticker=None, day=None, account='a'):
    return dict(ticker_name=name, ticker=ticker, value=value, today_return=day, account_id=account)


def test_same_security_is_combined_across_accounts():
    result = diagnose({'holdings': [row('A', 30, 'A'), row('A alias', 20, 'A', account='b'), row('B', 50, 'B')]})
    assert len(result['positions']) == 2
    assert result['top_one_weight'] == 50
    assert result['top_three_weight'] == 100


def test_partial_quotes_cannot_be_used_as_portfolio_daily_return():
    result = diagnose({'holdings': [row('A', 90, day=-10), row('B', 100)]})
    assert result['daily_rate'] is None
    assert result['daily_drivers'] == []
    assert result['quote_covered'] == 1


def test_daily_contributions_reconcile_on_previous_value():
    result = diagnose({'holdings': [row('A', 90, day=-10), row('B', 110, day=10)]})
    assert result['daily_rate'] == 0
    assert sum(r['contribution_pp'] for r in result['daily_drivers']) == pytest.approx(0)
    assert result['daily_drivers'][0]['contribution_pp'] == -5


def test_no_positions_is_unknown_not_zero_risk():
    result = diagnose({'holdings': []})
    assert result['top_one_weight'] is None
    assert result['daily_rate'] is None
