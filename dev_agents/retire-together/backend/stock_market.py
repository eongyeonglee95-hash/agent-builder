"""Cache public market prices separately from any household state."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import threading
import time
import yaml
from fastapi import APIRouter
from tools.stock_market import fetch_indicator

router = APIRouter(prefix='/api/stock-market', tags=['stocks'])
_lock = threading.Lock()
_cached = None
_expires = 0.0


@router.get('')
def stock_market():
    global _cached, _expires
    with _lock:
        if _cached is not None and time.monotonic() < _expires:
            return _cached
        config = yaml.safe_load((Path(__file__).resolve().parents[1] / 'rules' / 'stock_board.yaml').read_text())
        def fetch(spec):
            try:
                return fetch_indicator(spec, timeout=config['request_timeout_seconds'])
            except Exception:
                return {**spec, 'value': None, 'as_of': None, 'status': 'unavailable'}
        with ThreadPoolExecutor(max_workers=5) as pool:
            items = list(pool.map(fetch, config['indicators']))
        _cached = {'items': items, 'source': 'Yahoo Finance', 'cache_seconds': config['cache_seconds']}
        _expires = time.monotonic() + (config['cache_seconds'] if all(x['status'] == 'ok' for x in items) else 30)
        return _cached
