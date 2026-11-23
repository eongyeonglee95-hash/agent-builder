"""Public market context. One-day range: chartPreviousClose is the prior close,
not the beginning of a multi-day chart. Failed data is never replaced by examples.
"""
import datetime as dt
import json
import math
import urllib.parse
import urllib.request


def parse_indicator(meta: dict, spec: dict) -> dict:
    def number(value):
        if isinstance(value, bool):
            return None
        try:
            value = float(value)
            return value if math.isfinite(value) else None
        except (TypeError, ValueError):
            return None
    price = number(meta.get('regularMarketPrice'))
    previous = number(meta.get('chartPreviousClose'))
    stamp = number(meta.get('regularMarketTime'))
    if price is None or price <= 0 or stamp is None:
        raise ValueError('Missing market price or timestamp')
    change = price - previous if previous is not None and previous > 0 else None
    return {**spec, 'value': price, 'as_of': dt.datetime.fromtimestamp(stamp, dt.timezone.utc).isoformat(),
            'change': round(change, 4) if change is not None else None,
            'change_rate': round(change / previous * 100, 2) if change is not None else None,
            'change_bp': round(change * 100, 2) if change is not None and spec['kind'] == 'yield' else None,
            'status': 'ok', 'source_url': 'https://finance.yahoo.com/quote/' + urllib.parse.quote(spec['symbol'], safe='') + '/'}


def fetch_indicator(spec: dict, timeout: float = 8) -> dict:
    url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + urllib.parse.quote(spec['symbol'], safe='') + '?interval=1d&range=1d'
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.load(response)
    return parse_indicator(payload['chart']['result'][0]['meta'], spec)
