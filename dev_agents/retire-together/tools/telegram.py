"""Private Telegram delivery. No model, orders, or automatic retries."""
import os
from pathlib import Path
import requests

ENV_PATH = Path(__file__).resolve().parents[1] / '.env'


class TelegramError(ValueError):
    pass


def settings():
    values = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            key, sep, value = line.partition('=')
            if sep and not key.strip().startswith('#'):
                values[key.strip()] = value.strip().strip('\"').strip("'")
    return {key: os.environ.get(key, values.get(key, '')) for key in
            ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_OWNER_USER_ID')}


def format_orders(pool):
    accounts = {a['id']: a['label'] for a in pool['accounts']}
    clean = lambda value: ' '.join(str(value or '').split())
    lines = ['둘이서은퇴 · 검토용 주문표', clean(pool['label']),
             f"원칙: {clean(pool.get('strategy', pool['strategy_id']))}",
             f"잔고 기준: {pool.get('as_of') or '미확인'}",
             '가격: 등록한 가격 기준 (실시간 아님)',
             f"추가 납입: {pool.get('new_cash', 0):,}원"]
    trades = [o for o in pool.get('orders', []) if o['side'] in ('매도', '매수')]
    if not trades:
        raise TelegramError('보낼 주문 항목이 없어요.')
    if pool.get('blocked_reason') or pool.get('error'):
        raise TelegramError('확인할 항목이 있어 주문표를 보내지 않았어요. 화면에서 보류 사유를 확인해 주세요.')
    pending = []
    for side, heading in [('매도', '① 먼저 팔기'), ('매수', '② 매도 체결·매수 가능 금액 확인 후 사기')]:
        lines.extend(['', heading])
        ready = []
        for o in trades:
            if o['side'] != side:
                continue
            account = accounts.get(o.get('account_id'))
            name = clean(o.get('ticker_name') or o.get('asset_class'))
            if not account or not o.get('ticker') or not o.get('qty'):
                pending.append(f"{side} · {clean(account or '계좌 확인 필요')} · {name} · 예상 {o['amount']:,}원 (종목·수량 확인 필요)")
                continue
            ready.append(f"• {clean(account)}\n  {name} ({clean(o['ticker'])}) {o['qty']:,}주 · 예상 {o['amount']:,}원")
        lines.extend(ready or ['해당 없음'])
    if pending:
        lines.extend(['', '확인 필요 — 아래 항목은 주문 수량이 확정되지 않았어요.', *pending])
    if pending:
        lines.extend(['', '일부 항목이 미확정이에요. 전체 계획을 확인한 뒤 거래하세요.'])
    lines.extend(['', '주문 전 현재가와 매수 가능 금액을 확인하세요.',
                  '실제 주문은 증권사 앱에서 직접 진행하세요.', '거래 후 둘이서은퇴에서 잔고를 업데이트해 주세요.',
                  '이 알림 전송은 주문 실행이나 거래 완료 기록이 아니에요.'])
    text = '\n'.join(lines)
    if len(text.encode('utf-16-le')) // 2 > 4000:
        raise TelegramError('주문표가 너무 길어 보내지 않았어요. 화면의 종목별 주문을 확인해 주세요.')
    return text


def send_orders(pool):
    from tools.telegram_table import order_photo
    photo, caption = order_photo(pool)
    return _send('sendPhoto', data={'caption': caption},
                 files={'photo': ('rebalance.png', photo, 'image/png')})


def send_message(text):
    return _send('sendMessage', json={'text': text})


def _send(method, **payload):
    config = settings()
    if not config['TELEGRAM_BOT_TOKEN'] or not config['TELEGRAM_CHAT_ID']:
        raise TelegramError('텔레그램 연결 설정이 없어요. 봇 토큰과 수신 채팅을 설정해 주세요.')
    try:
        payload.setdefault('data' if 'files' in payload else 'json', {})['chat_id'] = config['TELEGRAM_CHAT_ID']
        response = requests.post('https://api.telegram.org/bot' + config['TELEGRAM_BOT_TOKEN'] + '/' + method,
                                 **payload, timeout=(5, 15))
        result = response.json()
        if not response.ok or not result.get('ok'):
            raise TelegramError('텔레그램이 전송을 거절했어요. 봇 연결과 수신 채팅을 확인해 주세요.')
        return result['result']['message_id']
    except (requests.RequestException, ValueError, KeyError) as exc:
        if isinstance(exc, TelegramError):
            raise
        raise TelegramError('전송 결과를 확인하지 못했어요. 중복 발송을 피하려면 텔레그램을 먼저 확인해 주세요.') from None
