from copy import deepcopy
from types import SimpleNamespace
import pytest
import requests
from fastapi import HTTPException
from backend import workbook
from tools import telegram

@pytest.fixture
def pool():
    return {'pool_id': 'p', 'label': '테스트 연금', 'strategy_id': 'test', 'strategy': '테스트',
            'as_of': '2026-11-18', 'accounts': [{'id': 'a', 'label': '테스트 계좌'}],
            'orders': [
                {'side': '매수', 'account_id': 'a', 'ticker_name': '채권', 'ticker': '123456', 'qty': 2, 'amount': 20000},
                {'side': '매도', 'account_id': 'a', 'ticker_name': '주식', 'ticker': '654321', 'qty': 3, 'amount': 30000}]}

def test_format_sells_first_and_separates_unconfirmed(pool):
    pool['orders'].append({'side': '매수', 'account_id': 'a', 'ticker_name': None, 'ticker': None, 'qty': None, 'amount': 10000})
    text = telegram.format_orders(pool)
    assert text.index('주식 (654321) 3주') < text.index('채권 (123456) 2주')
    assert '확인 필요' in text and '실시간 아님' in text and '2026-11-18' in text
    assert '테스트 계좌' in text

@pytest.mark.parametrize('change', [{'blocked_reason': '미확인'}, {'orders': []}])
def test_unusable_plan_rejected(pool, change):
    pool.update(change)
    with pytest.raises(telegram.TelegramError): telegram.format_orders(pool)

def test_timeout_does_not_leak_token_or_retry(monkeypatch):
    monkeypatch.setattr(telegram, 'settings', lambda: {'TELEGRAM_BOT_TOKEN': 'secret-token', 'TELEGRAM_CHAT_ID': '123'})
    calls = []
    def fail(*args, **kwargs):
        calls.append(1)
        raise requests.Timeout('https://api.telegram.org/botsecret-token/sendMessage')
    monkeypatch.setattr(telegram.requests, 'post', fail)
    with pytest.raises(telegram.TelegramError) as error: telegram.send_message('test')
    assert 'secret-token' not in str(error.value) and len(calls) == 1

def test_endpoint_recalculates_and_does_not_record_decision(monkeypatch, pool):
    monkeypatch.setenv('RETIRE_AUTH_MODE', 'local')
    sent = []
    monkeypatch.setattr(workbook, 'rebalance_all', lambda data: {'pools': [deepcopy(pool)]})
    monkeypatch.setattr(telegram, 'send_orders', lambda data: sent.append(data) or 42)
    monkeypatch.setattr(workbook, 'record_decision', lambda *a, **k: pytest.fail('must not record a trade'))
    result = workbook.telegram_orders(workbook.TelegramInput(pool_id='p'), SimpleNamespace(state=SimpleNamespace()))
    assert result['message_id'] == 42 and sent[0]['orders'][1]['qty'] == 3
    with pytest.raises(HTTPException) as error:
        workbook.telegram_orders(workbook.TelegramInput(pool_id='missing'), SimpleNamespace(state=SimpleNamespace()))
    assert error.value.status_code == 404

def test_other_user_cannot_send(monkeypatch):
    monkeypatch.setenv('RETIRE_AUTH_MODE', 'web')
    monkeypatch.setattr(telegram, 'settings', lambda: {'TELEGRAM_OWNER_USER_ID': 'owner'})
    request = SimpleNamespace(state=SimpleNamespace(identity={'user_id': 'other'}))
    with pytest.raises(HTTPException) as error:
        workbook.telegram_orders(workbook.TelegramInput(pool_id='p'), request)
    assert error.value.status_code == 403


def test_photo_is_valid_and_caption_has_codes(pool):
    from io import BytesIO
    from PIL import Image
    from tools.telegram_table import order_photo
    pool['orders'][0]['ticker_name'] = '아주 긴 한글 종목명 ' * 8
    photo, caption = order_photo(pool)
    image = Image.open(BytesIO(photo))
    assert image.format == 'PNG' and image.width == 1080
    assert image.width + image.height <= 10000
    assert '654321' in caption and '123456' in caption
    assert caption.index('매도') < caption.index('매수')


def test_photo_sent_in_one_request(monkeypatch, pool):
    monkeypatch.setattr(telegram, 'settings', lambda: {'TELEGRAM_BOT_TOKEN': 'secret', 'TELEGRAM_CHAT_ID': '123'})
    calls = []
    def post(url, **kwargs):
        calls.append((url, kwargs))
        return SimpleNamespace(ok=True, json=lambda: {'ok': True, 'result': {'message_id': 7}})
    monkeypatch.setattr(telegram.requests, 'post', post)
    assert telegram.send_orders(pool) == 7
    assert len(calls) == 1 and calls[0][0].endswith('/sendPhoto')
    assert calls[0][1]['files']['photo'][1].startswith(b'\x89PNG')
    assert calls[0][1]['data']['chat_id'] == '123'


def test_caption_limit_prevents_any_send(monkeypatch, pool):
    monkeypatch.setattr(telegram, 'settings', lambda: {'TELEGRAM_BOT_TOKEN': 'test-only', 'TELEGRAM_CHAT_ID': '123'})
    pool['orders'] = [{**pool['orders'][0], 'ticker_name': '가' * 100, 'ticker': str(i)} for i in range(12)]
    monkeypatch.setattr(telegram.requests, 'post', lambda *a, **k: pytest.fail('must not send'))
    with pytest.raises(telegram.TelegramError):
        telegram.send_orders(pool)
