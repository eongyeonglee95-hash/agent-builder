"""Official market observations; no AI-generated numbers or forward filling."""
import calendar
import datetime as dt
import json
import math
import os
import sqlite3
import threading
from pathlib import Path

import requests

KB_URL = 'https://data-api.kbland.kr/bfmstat/weekMnthlyHuseTrnd/maktTrnd'
KB_PAGE = 'https://data.kbland.kr/kbstats/wmh'
METRICS = [
    dict(id='kb_buy', name='매수우위지수', provider='KB부동산', unit='지수', menu='01', field='매수우위지수', frequency='weekly', source_url=KB_PAGE),
    dict(id='kb_trade', name='매매거래활발지수', provider='KB부동산', unit='지수', menu='02', field='매매거래지수', frequency='weekly', source_url=KB_PAGE),
    dict(id='kb_jeonse', name='전세수급지수', provider='KB부동산', unit='지수', menu='03', field='전세수급지수', frequency='weekly', source_url=KB_PAGE),
    dict(id='mortgage', name='주담대 금리', provider='한국은행 · 신규취급액', unit='%', frequency='monthly', source_url='https://ecos.bok.or.kr/'),
    dict(id='credit', name='일반 신용대출 금리', provider='한국은행 · 신규취급액', unit='%', frequency='monthly', source_url='https://ecos.bok.or.kr/'),
    dict(id='cofix', name='신규취급액 COFIX', provider='은행연합회', unit='%', frequency='monthly', source_url='https://portal.kfb.or.kr/fingoods/cofix.php'),
]
_lock = threading.Lock()


def connection():
    path = Path(os.environ.get('RETIRE_SENTIMENT_DB', Path(__file__).resolve().parents[1] / 'data/local/property-sentiment.sqlite3'))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.executescript('''CREATE TABLE IF NOT EXISTS observations (
        metric TEXT, region TEXT, frequency TEXT, day TEXT, value REAL,
        published TEXT, collected TEXT, source_url TEXT,
        PRIMARY KEY(metric, region, frequency, day));
        CREATE TABLE IF NOT EXISTS collection (frequency TEXT PRIMARY KEY, attempted TEXT, succeeded TEXT, error TEXT);''')
    return db


def parse_kb(payload, metric, frequency, collected):
    body = payload['dataBody']
    if str(body['resultCode']) != '11000':
        raise ValueError('KB 응답 오류')
    data = body['data']
    dates = data['날짜리스트']
    rows = []
    for region in data['데이터리스트']:
        if region['지역명'] not in ('전국', '서울', '강남', '강남지역', '강북', '강북지역'):
            continue
        values = region['dataList']
        if len(values) < len(dates):
            raise ValueError('날짜와 수치 개수 불일치')
        for day, point in zip(dates, values):
            if point is None or point.get(metric['field']) in (None, '', '-'):
                continue
            raw = str(day)
            observed = dt.datetime.strptime(raw, '%Y%m%d' if frequency == 'weekly' else '%Y%m').date()
            if frequency == 'monthly':
                observed = observed.replace(day=calendar.monthrange(observed.year, observed.month)[1])
            value = float(point[metric['field']])
            if not math.isfinite(value) or not 0 <= value <= 200:
                raise ValueError('지수 범위 오류')
            if observed > dt.date.fromisoformat(collected[:10]):
                continue
            rows.append((metric['id'], region['지역명'], frequency, observed.isoformat(), value, None, collected, KB_PAGE))
    if not rows:
        raise ValueError('확인 가능한 KB 시계열 없음')
    return rows


def needs_refresh(frequency):
    if _lock.locked():
        return False
    with connection() as db:
        row = db.execute('SELECT * FROM collection WHERE frequency=?', (frequency,)).fetchone()
    # Retry failures after an hour; successful downloads once per day.
    return not row or (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(row['attempted'])).total_seconds() > (86400 if not row['error'] else 3600)


def refresh(frequency):
    if not _lock.acquire(blocking=False):
        return
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    error = None
    try:
        for metric in METRICS:
            if 'menu' not in metric:
                continue
            try:
                response = requests.get(KB_URL, params={'메뉴코드': metric['menu'], '월간주간구분코드': '02' if frequency == 'weekly' else '01'}, headers={'Referer': 'https://data.kbland.kr/', 'User-Agent': 'Mozilla/5.0'}, timeout=(3, 6))
                response.raise_for_status()
                rows = parse_kb(response.json(), metric, frequency, now)
                with connection() as db:
                    db.executemany('INSERT OR REPLACE INTO observations VALUES (?,?,?,?,?,?,?,?)', rows)
            except (requests.RequestException, ValueError, KeyError, TypeError):
                error = 'KB 공식 시계열을 불러오지 못했어요. 저장된 자료가 있으면 그대로 표시해요.'
        with connection() as db:
            old = db.execute('SELECT succeeded FROM collection WHERE frequency=?', (frequency,)).fetchone()
            db.execute('INSERT OR REPLACE INTO collection VALUES (?,?,?,?)', (frequency, now, now if error is None else (old['succeeded'] if old else None), error))
    finally:
        _lock.release()


def shift(day, mode, offset):
    if mode == 'monthly':
        month = day.year * 12 + day.month - 1 + offset
        return dt.date(month // 12, month % 12 + 1, 1)
    return day + dt.timedelta(days=offset * (7 if mode == 'weekly' else 1))


def bounds(day, mode):
    start = day.replace(day=1) if mode == 'monthly' else day - dt.timedelta(days=day.weekday()) if mode == 'weekly' else day
    return start, shift(start, mode, 1) - dt.timedelta(days=1)


def dashboard(mode, anchor, region):
    start, end = bounds(anchor, mode)
    cutoff = min(end, dt.date.today())
    periods = [bounds(shift(start, mode, n), mode) for n in range(-11, 1)]
    frequency = 'monthly' if mode == 'monthly' else 'weekly'
    with connection() as db:
        observations = [dict(r) for r in db.execute('SELECT * FROM observations WHERE region=? AND day<=? ORDER BY day', (region, cutoff.isoformat()))]
        state = db.execute('SELECT * FROM collection WHERE frequency=?', (frequency,)).fetchone()
    items = []
    for metric in METRICS:
        native = frequency if 'menu' in metric else metric['frequency']
        series = [r for r in observations if r['metric'] == metric['id'] and r['frequency'] == native]
        cells = []
        # Only compare adjacent populated periods. A weekly value never becomes a daily observation.
        for lo, hi in [bounds(shift(start, mode, -12), mode), *periods]:
            matches = [r for r in series if lo.isoformat() <= r['day'] <= hi.isoformat()] if mode == native else []
            point = matches[-1] if matches else None
            previous = cells[-1]['value'] if cells else None
            value = point['value'] if point else None
            delta = round(value - previous, 4) if value is not None and previous is not None else None
            cells.append(dict(day=lo.isoformat(), value=value, delta=delta, observed=point['day'] if point else None))
        latest = series[-1] if series else None
        items.append({**{k: v for k, v in metric.items() if k not in ('menu', 'field')}, 'frequency': native,
                      'status': 'ready' if latest else 'unavailable' if 'menu' in metric else 'not_connected',
                      'latest': latest, 'cells': cells[1:]})
    return dict(mode=mode, anchor=anchor.isoformat(), start=start.isoformat(), end=cutoff.isoformat(), region=region,
                periods=[p[0].isoformat() for p in periods], items=items, collection=dict(state) if state else None,
                refreshing=_lock.locked(), historical_note='관측기간 기준이며, 당시 공개 여부를 재현한 자료는 아니에요. 월간은 월말 기준으로 표시해요.')
