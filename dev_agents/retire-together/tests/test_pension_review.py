from datetime import date, datetime
from types import SimpleNamespace
import asyncio
import pytest
from fastapi import HTTPException
from backend import pension_review as review


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(review, 'DB_PATH', tmp_path / 'review.sqlite3')
    monkeypatch.setattr(review, 'now', lambda: datetime(2026, 11, 18, 10, tzinfo=review.TZ))
    monkeypatch.setenv('RETIRE_AUTH_MODE', 'local')


def req():
    return SimpleNamespace(state=SimpleNamespace())


def test_calendar_month_end_and_leap_year():
    config = {'period': 'month', 'first_date': '2028-01-31'}
    assert review.advance(date(2028, 1, 31), config) == date(2028, 2, 29)
    assert review.advance(date(2028, 2, 29), config) == date(2028, 3, 31)
    assert review.advance(date(2028, 1, 31), {'period': 'custom', 'days': 7}) == date(2028, 2, 7)


def test_disabled_default_and_past_date():
    assert review.claim(True) is None
    with pytest.raises(HTTPException):
        review.save_schedule(review.Schedule(enabled=True, first_date='2026-11-17'), req())


def test_due_claim_once_and_skip_missed_cycles():
    review.save_schedule(review.Schedule(enabled=True, first_date='2026-11-18'), req())
    claimed = review.claim(True)
    assert claimed['next_date'] == '2026-12-18'
    assert review.claim(True) is None
    with review.database() as db:
        state = review.read(db)
        state['running'] = None
        state['next_date'] = '2026-01-18'
        review.write(db, state)
    assert review.claim(True)['next_date'] == '2026-12-18'


def test_read_only_ai_failure_keeps_facts(monkeypatch):
    facts = {'accounts': [], 'scope': 'test', 'source': 'test'}
    monkeypatch.setattr(review, 'evidence', lambda: facts)
    async def fail(facts):
        raise RuntimeError('secret must not persist')
    monkeypatch.setattr(review, 'explain', fail)
    claimed = review.claim()
    review.execute(claimed, False)
    state = review.status(req())
    assert not state['running'] and state['report']['ai_status'] == 'unavailable'
    assert 'secret' not in str(state)


def test_manual_run_never_sends_and_keeps_schedule(monkeypatch):
    from tools import telegram
    monkeypatch.setattr(review, 'evidence', lambda: {'accounts': [], 'scope': 'test'})
    async def explain(facts): return '점검 결과'
    monkeypatch.setattr(review, 'explain', explain)
    monkeypatch.setattr(telegram, 'send_message', lambda text: pytest.fail('manual must not send'))
    review.execute(review.claim(), False)
    assert review.status(req())['report']['ai_text'] == '점검 결과'


def test_partner_cannot_read_or_run(monkeypatch):
    monkeypatch.setenv('RETIRE_AUTH_MODE', 'web')
    request = SimpleNamespace(state=SimpleNamespace(identity={'user_id': 'partner', 'owner_user_id': 'owner'}))
    with pytest.raises(HTTPException) as err:
        review.status(request)
    assert err.value.status_code == 403


def test_scheduled_notification_failure_not_retried(monkeypatch):
    from tools import telegram
    monkeypatch.setattr(review, 'evidence', lambda: {'accounts': [], 'scope': 'test'})
    async def explain(facts): return '점검 결과'
    monkeypatch.setattr(review, 'explain', explain)
    calls = []
    def fail(text):
        calls.append(text)
        raise telegram.TelegramError('timeout')
    monkeypatch.setattr(telegram, 'send_message', fail)
    with review.database() as db:
        state = review.read(db)
        state.update(config={'enabled': True, 'period': 'month', 'first_date': '2026-11-18', 'notify': True}, next_date='2026-11-18')
        review.write(db, state)
    review.execute(review.claim(True), True)
    assert len(calls) == 1 and review.claim(True) is None
    assert '자동 재전송' in review.status(req())['report']['notification']


def test_monetary_evidence_adds_won_only_to_money_fields():
    lines = review.numeric_evidence([{'label': '연금', 'orders': [{'amount': 5160000, 'qty': 3}], 'plan': {'mix': []}}], {'retirement_plan': {'monthly_need': 8200000}})
    assert any('5,160,000원' in line for line in lines)
    assert any('8,200,000원' in line for line in lines)
    assert not any('3원' in line for line in lines)
