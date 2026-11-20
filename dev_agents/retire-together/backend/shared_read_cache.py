"""Bounded, per-viewer memory cache; writes always use the live journal.

A recent snapshot serves navigation immediately while one worker revalidates it.
Nothing is persisted to the browser or disk. Failed checks evict the snapshot.
"""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import os
from threading import RLock
import time

_lock = RLock()
_cache = {}
_pending = {}
_workers = ThreadPoolExecutor(max_workers=4, thread_name_prefix='sheet-read')


def clear(db_path):
    with _lock:
        for mapping in (_cache, _pending):
            for key in list(mapping):
                if key[0] == str(db_path):
                    del mapping[key]


def _read(service, key, token):
    try:
        service.access()
        result = service.current()
        with _lock:
            # An intervening write/clear must not resurrect an older snapshot.
            if _pending.get(key) is token:
                if len(_cache) >= 64:
                    _cache.clear()
                _cache[key] = time.monotonic(), deepcopy(result)
        return result
    except Exception:
        with _lock:
            if _pending.get(key) is token:
                _cache.pop(key, None)
        raise
    finally:
        with _lock:
            if _pending.get(key) is token:
                del _pending[key]


def current(service):
    ttl = float(os.environ.get('RETIRE_SHARED_READ_CACHE_SECONDS', '30'))
    if ttl <= 0:
        service.access()
        return service.current()
    maximum_age = max(ttl, float(os.environ.get('RETIRE_SHARED_READ_CACHE_MAX_SECONDS', '300')))
    key = (str(service.config.db_path), service.sid, service.identity['user_id'])
    # Local revocation and binding changes take effect even on a cache hit.
    service.store.member(service.identity)
    binding = service.store.binding(service.identity['household_id'])
    if not binding or not binding['ready'] or binding['spreadsheet_id'] != service.sid or not service.store.grant(service.identity['user_id']):
        clear(service.config.db_path)
        service.access()
        return service.current()
    with _lock:
        hit = _cache.get(key)
        age = time.monotonic() - hit[0] if hit else float('inf')
        if hit and age < ttl:
            return deepcopy(hit[1])
        pending = _pending.get(key)
        if pending is None:
            pending = []
            _pending[key] = pending
            pending.append(_workers.submit(_read, service, key, pending))
        if hit and age < maximum_age:
            return deepcopy(hit[1])
    return deepcopy(pending[0].result())
