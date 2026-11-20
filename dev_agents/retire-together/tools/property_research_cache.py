"""Reusable public apartment evidence only; never stores household finances."""
import datetime as dt
import hashlib
import json
import sqlite3
from pathlib import Path

CACHE_PATH = Path(__file__).resolve().parents[1] / 'data/local/property-research.sqlite3'
FIELDS = ('pros', 'cons', 'popularity')


def key(item):
    identity = [item.get('sigungu'), item.get('jibun'), item['name'], item['area']]
    return hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()


def connection():
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(CACHE_PATH, timeout=5)
    db.execute('CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
    return db


def read(item, days, today=None):
    try:
        with connection() as db:
            row = db.execute('SELECT payload FROM evidence WHERE id=?', (key(item),)).fetchone()
        if not row:
            return None
        data = json.loads(row[0])
        age = ((today or dt.date.today()) - dt.date.fromisoformat(data['analysis_date'])).days
        return data if 0 <= age < days else None
    except (sqlite3.Error, OSError, ValueError, KeyError, TypeError):
        return None


def write(item, today=None):
    if not any(item.get(field) for field in FIELDS) and not item.get('households'):
        return
    payload = {field: item.get(field, []) for field in FIELDS}
    if item.get('households'):
        payload['households'] = item['households']
    payload['analysis_date'] = (today or dt.date.today()).isoformat()
    try:
        with connection() as db:
            db.execute('INSERT OR REPLACE INTO evidence VALUES (?,?)', (key(item), json.dumps(payload, ensure_ascii=False)))
    except (sqlite3.Error, OSError):
        pass  # A cache write failure must not discard a successful analysis.


def verified_households(fact, source):
    """Only accept a cited integer household count present in the research quote."""
    import re
    if not isinstance(fact, dict) or type(fact.get('count')) is not int or fact['count'] <= 0:
        return None
    quote = fact.get('evidence_quote')
    if not isinstance(quote, str) or len(quote) < 8:
        return None
    if fact.get('source_url') not in {s['url'] for s in source['sources']}:
        return None
    if ''.join(quote.split()) not in ''.join(source['text'].split()):
        return None
    counts = re.findall(r'([0-9][0-9,]*)\s*세대', quote)
    if fact['count'] not in [int(n.replace(',', '')) for n in counts]:
        return None
    return {k: fact[k] for k in ('count', 'source_url', 'evidence_quote')}
