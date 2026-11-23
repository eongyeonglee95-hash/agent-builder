"""Registered-position diagnostics; no assumptions about missing price history or cash."""
from collections import defaultdict


def diagnose(summary: dict) -> dict:
    rows = summary['holdings']
    total = sum(r['value'] for r in rows)
    grouped = defaultdict(lambda: {'name': '', 'value': 0})
    for row in rows:
        # Same security in multiple accounts is one exposure. Missing tickers use exact names.
        key = ('ticker', row['ticker']) if row.get('ticker') else ('name', row['ticker_name'])
        grouped[key]['name'] = row['ticker_name']
        grouped[key]['value'] += row['value']
    positions = sorted(grouped.values(), key=lambda r: r['value'], reverse=True)
    weights = [{**r, 'weight': round(r['value'] / total * 100, 2)} for r in positions] if total else []
    covered = [r for r in rows if r.get('today_return') is not None]
    complete = bool(rows) and len(covered) == len(rows)
    previous = sum(r['value'] - r['today_return'] for r in covered)
    daily_return = sum(r['today_return'] for r in covered)
    return {
        'positions': weights,
        'top_one_weight': weights[0]['weight'] if weights else None,
        'top_three_weight': round(sum(r['value'] for r in positions[:3]) / total * 100, 2) if total else None,
        'quote_covered': len(covered), 'quote_total': len(rows),
        'daily_rate': round(daily_return / previous * 100, 2) if complete and previous > 0 else None,
        'daily_drivers': [
            {'name': r['ticker_name'], 'account_id': r['account_id'], 'amount': r['today_return'],
             'contribution_pp': round(r['today_return'] / previous * 100, 2)}
            for r in sorted(covered, key=lambda r: r['today_return'])[:3]
        ] if complete and previous > 0 else [],
        'basis': 'registered_stock_positions',
    }
