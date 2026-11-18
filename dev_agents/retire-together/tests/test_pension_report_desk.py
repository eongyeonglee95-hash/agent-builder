from types import SimpleNamespace
import pandas as pd
from tools.pension_report_desk import account_exhibits


def test_candidates_use_only_account_holdings_and_designated_instruments():
    ctx = {'accts': {'a': {'label': '연금'}}, 'amap': {'보유': {'ticker': '000001', 'asset_class': 'stock'}},
           'df': pd.DataFrame([{'account_id': aid, 'ticker_name': name, 'ticker': ticker}
                              for aid, name, ticker in [('a', '보유', '000001'), ('a', '보유', '000001'), ('other', '제외', '999999')]])}
    strategy = {'targets': {'stock': 1}, 'instruments': {'stock': {'ticker': '000002', 'name': '지정'}}, 'source': '등록 규칙'}
    order = SimpleNamespace(side='매수', ticker_name='지정', asset_class='stock', ticker='000002', account_id='a', qty=None, amount=100, note='가격 없음')
    result = SimpleNamespace(orders=[order], blocked_reason=None, total_value=1000, new_cash=0)
    exhibit = account_exhibits('p', {'accounts': ['a']}, ctx, result, strategy)
    assert [p['ticker'] for p in exhibit['products']] == ['000001', '000002']
    assert all('계좌 편입 가능 여부 확인' in p['check'] for p in exhibit['products'])
    assert exhibit['orders'][0]['status'] == '검토 보류'
    assert exhibit['orders'][0]['qty'] is None
    assert exhibit['orders'][0]['account'] == '연금'
    assert exhibit['total_value'] == result.total_value
    result.blocked_reason = '계좌 제약'
    order.qty = 1
    assert account_exhibits('p', {'accounts': ['a']}, ctx, result, strategy)['orders'][0]['note'] == '계좌 제약'


def test_portfolio_uses_weighted_account_values_not_average_percentages():
    from tools.pension_report_desk import portfolio_exhibit
    accounts = [{'total_value': 100, 'as_of': '2026-11-01', 'classes': [{'asset_class': 'stock', 'label': '주식', 'value': 80, 'target': .6}]},
                {'total_value': 300, 'as_of': '2026-10-01', 'classes': [{'asset_class': 'stock', 'label': '주식', 'value': 120, 'target': .4}]},
                {'total_value': 0, 'classes': []}]
    result = portfolio_exhibit(accounts)
    assert result['total_value'] == 400
    assert result['mix'][0]['current_pct'] == 50
    assert result['mix'][0]['target_pct'] == 45
    assert result['account_count'] == 2
    assert len(result['dates']) == 2
    assert portfolio_exhibit([])['mix'] == []
