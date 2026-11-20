from threading import Event
from types import SimpleNamespace

import pytest
from backend import shared_read_cache as cache


@pytest.fixture
def service(monkeypatch, tmp_path):
    monkeypatch.setenv('RETIRE_SHARED_READ_CACHE_SECONDS', '30')
    monkeypatch.setenv('RETIRE_SHARED_READ_CACHE_MAX_SECONDS', '300')
    cache.clear(tmp_path)
    s = SimpleNamespace(config=SimpleNamespace(db_path=tmp_path), sid='sheet-a',
                        identity={'user_id': 'user-a', 'household_id': 'home'})
    s.store = SimpleNamespace(member=lambda _: None, grant=lambda _: True,
        binding=lambda _: {'ready': True, 'spreadsheet_id': s.sid})
    s.access = lambda: None
    s.current = lambda: (['revision-1'], {'value': 1})
    yield s
    cache.clear(tmp_path)


def age(service, seconds):
    key = (str(service.config.db_path), service.sid, service.identity['user_id'])
    with cache._lock:
        stamp, data = cache._cache[key]
        cache._cache[key] = stamp - seconds, data
    return key


def test_recent_read_isolated_and_no_network(service):
    result = cache.current(service)
    result[1]['value'] = 99
    service.current = lambda: pytest.fail('unexpected network read')
    assert cache.current(service)[1]['value'] == 1
    service.sid = 'sheet-b'
    service.current = lambda: ([], {'value': 2})
    assert cache.current(service)[1]['value'] == 2


def test_stale_returns_immediately_coalesces_and_refreshes(service):
    cache.current(service)
    key = age(service, 31)
    started, release = Event(), Event()
    calls = []
    def read():
        calls.append(1)
        started.set()
        assert release.wait(5)
        return ([], {'value': 2})
    service.current = read
    try:
        assert cache.current(service)[1]['value'] == 1
        assert started.wait(2)
        assert cache.current(service)[1]['value'] == 1
        with cache._lock:
            future = cache._pending[key][0]
    finally:
        release.set()
    future.result(timeout=2)
    assert calls == [1]
    assert cache.current(service)[1]['value'] == 2


def test_clear_during_refresh_prevents_old_result_reappearing(service):
    cache.current(service)
    key = age(service, 31)
    release = Event()
    service.current = lambda: (release.wait(5), {'value': 2})
    try:
        cache.current(service)
        with cache._lock:
            future = cache._pending[key][0]
        cache.clear(service.config.db_path)
    finally:
        release.set()
    future.result(timeout=2)
    assert key not in cache._cache


def test_expired_cache_waits_and_failed_refresh_evicts(service):
    cache.current(service)
    key = age(service, 301)
    def fail():
        raise RuntimeError('disconnected')
    service.current = fail
    with pytest.raises(RuntimeError):
        cache.current(service)
    assert key not in cache._cache


def test_local_revocation_checked_on_hit(service):
    cache.current(service)
    def revoked(_):
        raise PermissionError('removed member')
    service.store.member = revoked
    with pytest.raises(PermissionError):
        cache.current(service)


def test_failed_background_check_does_not_keep_serving_stale(service):
    cache.current(service)
    key = age(service, 31)
    release = Event()
    def fail():
        assert release.wait(5)
        raise RuntimeError('remote permission revoked')
    service.current = fail
    try:
        assert cache.current(service)[1]['value'] == 1
        with cache._lock:
            future = cache._pending[key][0]
    finally:
        release.set()
    with pytest.raises(RuntimeError):
        future.result(timeout=2)
    assert key not in cache._cache
    with pytest.raises(RuntimeError):
        cache.current(service)
