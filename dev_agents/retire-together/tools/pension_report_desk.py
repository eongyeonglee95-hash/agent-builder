"""Report exhibits from one engine snapshot. No invented prices, fees, or eligibility."""
from tools.assets import tag_holdings, candidate_confirmed
from tools.strategy import CLASS_LABELS

RESEARCH = [
    {'title':'자산의 역할부터 정하고 ETF를 비교하기', 'publisher':'삼성자산운용 · ETF 연금술사', 'published':'2026-10-06', 'reviewed':'2026-11-18',
     'url':'https://m.samsungfund.com/upload/kodex/newsroom/20261030155119262.pdf#page=20',
     'finding':'연금저축·퇴직연금의 비중과 대상 ETF를 같은 표에서 비교하고 배분 막대로 보여줘요.',
     'application':'아래 후보표는 자산 역할별로 기존 보유와 선택 전략의 지정 종목을 함께 보여줘요. 자사 상품 예시를 그대로 추천 순위로 쓰지 않아요.'},
    {'title':'은퇴 인출과 자산배분을 함께 판단하기', 'publisher':'J.P. Morgan · Guide to Retirement', 'published':'2026-02-26', 'reviewed':'2026-11-18',
     'url':'https://am.jpmorgan.com/content/dam/jpm-am-aem/global/en/insights/retirement-insights/guide-to-retirement-us.pdf#page=32',
     'finding':'인출 조건과 주식·채권 배분을 함께 비교하고 결과의 가정을 명시해요.',
     'application':'생활비를 꺼내기 시작할 시점과 금액을 확인한 뒤 배분을 결정해야 해요. 원문의 미국 기준 성공 확률을 내 계좌에 적용하지 않아요.'},
    {'title':'상품 개수보다 실제 노출과 비용 확인하기', 'publisher':'Morningstar · Portfolio X-Ray 샘플', 'published':'2011-04-01', 'reviewed':'2026-11-18',
     'url':'https://portfolio.morningstar.com/RtPort/reffiles/sample/SampleXRay.pdf',
     'finding':'자산배분·업종·지역 노출과 비용을 함께 보여줘요.',
     'application':'오래된 형식 참고 자료예요. 현재 상품 비용이나 시장 전망의 근거가 아니며, 추가 매수 전 기존 보유와의 중복을 확인하는 관점만 적용해요.'},
]


def account_exhibits(pid, pool, ctx, result, strategy):
    account_labels = {aid: ctx['accts'].get(aid, {}).get('label', aid) for aid in pool.get('accounts', [])}
    holdings = ctx['df'][ctx['df']['account_id'].isin(account_labels)]
    tagged, _ = tag_holdings(holdings, ctx['amap'])
    products = []
    for cls, target in (strategy.get('targets') or {}).items():
        if target <= 0: continue
        label = (strategy.get('labels') or {}).get(cls, CLASS_LABELS.get(cls, cls))
        instrument = (strategy.get('instruments') or {}).get(cls) or {}
        chosen = instrument.get('ticker')
        seen = set()
        for row in tagged[tagged['asset_class'] == cls].to_dict('records'):
            ticker = row.get('ticker') or ''
            key = ticker or row.get('ticker_name') or ''
            if key in seen: continue
            seen.add(key)
            products.append({'asset_class':cls,'role':label,'name':row.get('ticker_name') or '종목 미확인','ticker':ticker,
                'position':'기존 보유 · 지정 후보' if ticker and ticker == chosen else '기존 보유',
                'reason':'이미 보유한 상품이에요. 같은 자산에 투자하는지, 바꿀 때 비용이 얼마나 드는지 비교해 보세요.',
                'structure':instrument.get('type') if ticker and ticker == chosen else None,
                'mapping_confirmed':candidate_confirmed(ticker,row.get('ticker_name'),cls,ctx['amap']),
                'check':'실제 비용·거래 여건·계좌 편입 가능 여부 확인', 'source':'등록 잔고·자산 분류'})
        if chosen and chosen not in seen:
            products.append({'asset_class':cls,'role':label,'name':instrument.get('name') or chosen,'ticker':chosen,
                'position':'선택 전략의 지정 후보','reason':f'선택한 전략에서 {label} 역할에 지정한 종목이에요. 최적 상품 순위를 뜻하지 않아요.',
                'structure':instrument.get('type'), 'mapping_confirmed':candidate_confirmed(chosen,instrument.get('name'),cls,ctx['amap']),
                'check':'실제 비용·거래 여건·계좌 편입 가능 여부 확인','source':strategy.get('source') or '프로젝트 전략 설정'})
    orders = []
    for o in result.orders:
        if o.side not in ('매도','매수'): continue
        orders.append({'side':o.side,'name':o.ticker_name or CLASS_LABELS.get(o.asset_class,o.asset_class), 'ticker':o.ticker,
            'account':account_labels.get(o.account_id,o.account_id),'qty':o.qty,'amount':o.amount,
            'status':'검토 보류' if result.blocked_reason or not o.ticker or not o.qty else '주문 전 확인',
            'note':result.blocked_reason or o.note})
    orders.sort(key=lambda o: o['side']!='매도')
    return {'products':products,'orders':orders,'total_value':result.total_value,'new_cash':result.new_cash,
            'strategy_source':strategy.get('source'), 'pool_id':pid}


def portfolio_exhibit(accounts):
    """Aggregate registered class values, not ETF look-through or household balances."""
    eligible = [a for a in accounts if a.get('total_value', 0) > 0 and a.get('classes')]
    total = sum(a['total_value'] for a in eligible)
    if not total:
        return {'total_value': 0, 'mix': [], 'account_count': 0, 'dates': []}
    rows = {}
    for account in eligible:
        for c in account['classes']:
            row = rows.setdefault(c['asset_class'], {'asset_class': c['asset_class'], 'label': CLASS_LABELS.get(c['asset_class'], c['label']), 'value': 0, 'target_value': 0})
            row['value'] += c['value']
            row['target_value'] += c['target'] * account['total_value']
    mix = [{**r, 'current_pct': round(r['value']/total*100, 1), 'target_pct': round(r['target_value']/total*100, 1),
            'deviation_pp': round((r['value']-r['target_value'])/total*100, 1)} for r in rows.values()]
    return {'total_value': total, 'mix': mix, 'account_count': len(eligible),
            'dates': sorted({a['as_of'] for a in eligible if a.get('as_of')})}
