"""Deterministic PNG order table; never places orders or changes balances."""
from io import BytesIO
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

from tools.telegram import TelegramError, format_orders


def order_photo(pool):
    format_orders(pool)  # Same blocked/empty plan validation as text delivery.
    candidates = [os.environ.get('TELEGRAM_FONT_PATH', ''),
                  '/System/Library/Fonts/AppleSDGothicNeo.ttc',
                  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc']
    font_path = next((p for p in candidates if p and Path(p).is_file()), None)
    if not font_path:
        raise TelegramError('주문표용 한글 글꼴이 없어요. 서버의 TELEGRAM_FONT_PATH를 설정해 주세요.')
    fonts = {n: ImageFont.truetype(font_path, n) for n in (24, 28, 32, 44)}
    # Palette mirrors the app's white, slate, account green and trade colors.
    ink, muted, line = '#243145', '#647084', '#e2e6ec'
    canvas = Image.new('RGB', (1080, 8900), 'white')
    draw = ImageDraw.Draw(canvas)
    y = 40

    def clean(value):
        return ' '.join(str(value or '').split())

    def wrapped(value, width, size):
        lines, current = [], ''
        for c in clean(value):
            if current and draw.textlength(current + c, font=fonts[size]) > width:
                lines.append(current)
                current = ''
            current += c
        return lines + [current]

    def text(value, size=28, color=ink):
        nonlocal y
        for row in wrapped(value, 984, size):
            if y > 8500:
                raise TelegramError('주문표가 너무 길어 보내지 않았어요. 계좌 묶음을 나눠 주세요.')
            draw.text((48, y), row, font=fonts[size], fill=color)
            y += size + 12

    text('둘이서은퇴 · 검토용 주문표', 24, muted)
    text(pool['label'], 44)
    text(f"{pool.get('strategy') or pool['strategy_id']} · 잔고 기준 {pool.get('as_of') or '미확인'}", 28, muted)
    text('등록 가격 기준 · 실시간 아님', 24, muted)
    if pool.get('new_cash'):
        text(f"추가 납입 {pool['new_cash']:,}원", 24, muted)
    y += 24
    accounts = {a['id']: a['label'] for a in pool['accounts']}
    groups = {'매도': [], '매수': [], '확인 필요': []}
    codes = []
    for order in pool['orders']:
        if order['side'] not in ('매도', '매수'):
            continue
        ready = accounts.get(order.get('account_id')) and order.get('ticker') and order.get('qty')
        groups[order['side'] if ready else '확인 필요'].append(order)
        if ready:
            codes.append(f"{order['side']} {clean(order.get('ticker_name'))} · {clean(order['ticker'])}")
    for side, title, color in [('매도', '1  먼저 팔기', '#2166d9'),
                                ('매수', '2  체결·매수 가능 금액 확인 후 사기', '#d9233a'),
                                ('확인 필요', '확인 필요 · 아래 항목은 주문 전 확인', muted)]:
        orders = groups[side]
        if not orders and side == '확인 필요':
            continue
        text(title, 32, color)
        if not orders:
            text('해당 없음', 28, muted)
            y += 24
            continue
        draw.rectangle((48, y, 1032, y + 48), fill='#f3f5f7')
        for x, label, anchor in [(64, '종목 / 계좌', 'la'), (766, '수량', 'ra'), (1016, '예상 금액', 'ra')]:
            draw.text((x, y + 8), label, font=fonts[24], fill=muted, anchor=anchor)
        y += 60
        for o in orders:
            name = o.get('ticker_name') or o.get('asset_class') or '종목 확인 필요'
            if side == '확인 필요':
                name = f"{o['side']} · {name}"
            names = wrapped(name, 510, 32)
            details = wrapped(f"{accounts.get(o.get('account_id'), '계좌 확인 필요')} · {o.get('ticker') or '코드 미확인'}", 510, 24)
            height = len(names) * 44 + len(details) * 36 + 28
            if y + height > 8300:
                raise TelegramError('주문표가 너무 길어 보내지 않았어요. 계좌 묶음을 나눠 주세요.')
            row_y = y
            for name_line in names:
                draw.text((64, row_y), name_line, font=fonts[32], fill=ink)
                row_y += 44
            for detail in details:
                draw.text((64, row_y), detail, font=fonts[24], fill=muted)
                row_y += 36
            qty = f"{o['qty']:,}주" if side != '확인 필요' else '미확정'
            amount = f"{o['amount']:,}원"
            for right, value, width in [(766, qty, 170), (1016, amount, 230)]:
                size = 32 if draw.textlength(value, font=fonts[32]) <= width else 24
                if draw.textlength(value, font=fonts[size]) > width:
                    raise TelegramError('수량 또는 금액이 표 너비를 넘어요. 화면에서 주문표를 확인해 주세요.')
                draw.text((right, y), value, font=fonts[size], fill=color, anchor='ra')
            y += height
            draw.line((48, y - 12, 1032, y - 12), fill=line, width=1)
        y += 24
    if groups['확인 필요']:
        text('일부 항목이 미확정이에요. 전체 계획을 확인한 뒤 거래하세요.', 24, muted)
    text('현재가·매수 가능 금액 확인 → 증권사 앱에서 직접 주문', 24, muted)
    text('거래 후 잔고를 업데이트해 주세요. 알림은 주문 실행이 아니에요.', 24, muted)
    caption = '\n'.join(['둘이서은퇴 · 검토용 주문표', clean(pool['label']), '', '복사용 종목코드', *sorted(dict.fromkeys(codes), key=lambda code: not code.startswith('매도'))])
    if len(caption.encode('utf-16-le')) // 2 > 1024:
        raise TelegramError('종목코드 메시지가 너무 길어 보내지 않았어요. 계좌 묶음을 나눠 주세요.')
    output = BytesIO()
    canvas.crop((0, 0, 1080, y + 32)).save(output, format='PNG')
    return output.getvalue(), caption
