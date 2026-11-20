"""Default, rebuildable Google workbook views; the journal remains authoritative."""
from backend.shared_data_schema import projection
from backend.shared_data_view import dashboard

TITLES = ('우리 자산', '연금', '주식', '부동산', '현금·기타')
GREEN = {'red': .13, 'green': .29, 'blue': .24}
PALE = {'red': .92, 'green': .95, 'blue': .93}
WHITE = {'red': 1, 'green': 1, 'blue': 1}
INK = {'red': .16, 'green': .20, 'blue': .18}
MONEY = '#,##0;[Red](#,##0);0'


def sections(state):
    from backend.shared_data_google import asset_table
    table = asset_table(state)
    rows = table[2:]
    properties = {(r[1], r[2]) for r in rows if r[3] == '부동산'}
    def category(r):
        if r[3] == '노후':
            return '연금'
        if r[3] == '부동산' or (r[3] == '대출' and (r[1], r[2]) in properties):
            return '부동산'
        if r[3] == '현금' and r[4] == '주식':
            return '주식'
        return '현금·기타'
    grouped = {title: [] for title in TITLES[1:]}
    for row in rows:
        grouped[category(row)].append(row)
    result = {title: {'rows': [[title + '  /  둘이서은퇴'], table[1], *(rows if title == '우리 자산' else grouped[title])],
                      'asset_end': 2 + len(rows if title == '우리 자산' else grouped[title]),
                      'headers': [1], 'numbers': [(2, 2 + len(rows if title == '우리 자산' else grouped[title]), 5, 6)]}
              for title in TITLES}
    people = {r['member_id']: r['payload'].get('name') or '이름 미입력' for r in state['records'] if r['kind'] == 'profile'}
    accounts = {r['id']: r for r in state['records'] if r['kind'] == 'account'}
    def add(title, label, headers, data, number_columns=()):
        if not data:
            return
        tab = result[title]
        tab['rows'].extend([[], [label], headers])
        start = len(tab['rows'])
        tab['headers'].append(start - 1)
        tab['rows'].extend(data)
        tab['numbers'].extend((start, len(tab['rows']), c, c+1) for c in number_columns)
    for title in ('연금', '주식'):
        holdings = []
        for r in state['records']:
            if r['kind'] != 'holding':
                continue
            p = r['payload']
            a = accounts[p['account_id']]
            if ('연금' if a['payload']['pocket'] == 'pension' else '주식') != title:
                continue
            holdings.append([people.get(a['member_id'], '공동'), a['payload'].get('label') or a['payload']['broker'],
                             p['ticker_name'], p['ticker'], p['qty'], p['price'], p['qty']*p['price'], p['as_of']])
        add(title, '보유상품 상세 · 참고용 / 위 자산 금액에 다시 더하지 않습니다',
            ['소유자', '계좌', '상품명', '종목코드', '수량', '등록 단가(원)', '평가금액(원)', '기준일'], sorted(holdings), (4, 5, 6))
    pension = []
    for r in state['records']:
        if r['kind'] == 'pension':
            p = r['payload']
            pension.append([people.get(r['member_id'], '이름 미입력'), p.get('national_monthly', ''), p.get('national_start_age', ''),
                            p.get('retire_age', ''), p.get('savings_annual', ''), p.get('irp_annual', '')])
    add('연금', '연금 계획 입력값 · 현재 자산 합계에 포함하지 않습니다',
        ['소유자', '국민연금 월액(원)', '국민연금 개시(세)', '은퇴 나이(세)', '연금저축 연납입(원)', 'IRP 연납입(원)'], sorted(pension), (1, 4, 5))
    assets = {r['id']: r for r in state['records'] if r['kind'] == 'asset'}
    homes = []
    for r in state['records']:
        if r['kind'] == 'property_detail':
            p, a = r['payload'], assets[r['id']]
            address = p.get('address') or {}
            address_text = address.get('road') or address.get('jibun') or address.get('building') or ''
            homes.append([a['payload']['name'], people.get(a['member_id'], '공동'), address_text, p.get('area_m2', ''),
                          p.get('purchase_month', ''), p.get('purchase_price', ''), p.get('monthly_rent', ''), {'live': '실거주', 'jeonse': '전세', 'monthly': '월세', 'other': '기타'}.get(p.get('tenure'), '')])
    add('부동산', '부동산 상세 · 매입금액·임대료는 현재 자산 합계에 다시 더하지 않습니다',
        ['부동산', '소유자', '주소', '면적(㎡)', '매입월', '매입금액(원)', '월 임대료(원)', '점유 형태'], sorted(homes), (5, 6))
    for title, tab in result.items():
        selected = rows if title == '우리 자산' else grouped[title]
        amount = sum(r[5] for r in selected if r[3] != '대출')
        debt = sum(r[5] for r in selected if r[3] == '대출')
        tab['summary'] = [['한눈에 보기', '금액(원)'], ['자산', amount], ['부채·보증금', debt], ['순자산', amount-debt], [],
                          ['이용 안내'], ['입력: 자산 내역 · 보유 종목'], ['시트 수정 후 앱에서 불러오기'], ['상품 상세는 중복 합산 제외'], ['단가·금액은 등록 기준입니다']]
        if title == '우리 자산':
            tab['summary'] += [[], ['자산 구성', '금액(원)']] + [[t, sum(r[5] for r in grouped[t] if r[3] != '대출')] for t in TITLES[1:]]
    # The visible category tabs form an exact partition of the dashboard values.
    snap = dashboard(state, projection(state, state['members']['me']), 'together')['snapshot']
    assert result['우리 자산']['summary'][1][1] == snap['total']
    assert result['우리 자산']['summary'][2][1] == snap['debt']
    return result


def template_requests(state, meta):
    """Only generated view tabs are rewritten. Legacy and journal values are untouched."""
    tabs = {s['properties']['title']: s['properties'] for s in meta.get('sheets', [])}
    used = {p['sheetId'] for p in tabs.values()}
    requests = []
    for index, (title, tab) in enumerate(sections(state).items()):
        existing = tabs.get(title)
        sid = existing['sheetId'] if existing else next(i for i in range(1701000, 1711000) if i not in used)
        used.add(sid)
        if not existing:
            requests.append({'addSheet': {'properties': {'sheetId': sid, 'title': title}}})
        rows = tab['rows']
        height = max(len(rows), len(tab['summary'])+1)
        grid = [[''] * 11 for _ in range(height)]
        for i, row in enumerate(rows):
            grid[i][:len(row)] = [v if v is not None else '' for v in row]
        for i, row in enumerate(tab['summary'], 1):
            grid[i][9:9+len(row)] = row
        assert all(isinstance(v, (str, int, float)) for row in grid for v in row)
        def region(r0, r1, c0=0, c1=8):
            return {'sheetId': sid, 'startRowIndex': r0, 'endRowIndex': r1, 'startColumnIndex': c0, 'endColumnIndex': c1}
        def style(rng, fmt):
            requests.append({'repeatCell': {'range': rng, 'cell': {'userEnteredFormat': fmt}, 'fields': 'userEnteredFormat'}})
        requests.append({'unmergeCells': {'range': {'sheetId': sid, 'startColumnIndex': 0, 'endColumnIndex': 11}}})
        # Clear only columns owned by this generated template, including obsolete rows.
        requests.append({'updateCells': {'range': {'sheetId': sid, 'startColumnIndex': 0, 'endColumnIndex': 11},
            'fields': 'userEnteredValue', 'rows': [{'values': [{'userEnteredValue': {'numberValue' if isinstance(v, (int, float)) else 'stringValue': v}} for v in row]} for row in grid]}})
        props = {'sheetId': sid, 'index': index, 'hidden': False, 'tabColorStyle': {'rgbColor': GREEN},
                 'gridProperties': {'frozenRowCount': 2, 'hideGridlines': True}}
        fields = 'index,hidden,tabColorStyle,gridProperties.frozenRowCount,gridProperties.hideGridlines'
        old_grid = (existing or {}).get('gridProperties', {})
        if height > old_grid.get('rowCount', 1000):
            # Expansion must precede writing the view.
            requests.insert(len(requests)-2, {'updateSheetProperties': {'properties': {'sheetId': sid, 'gridProperties': {'rowCount': height+50}}, 'fields': 'gridProperties.rowCount'}})
        requests.append({'updateSheetProperties': {'properties': props, 'fields': fields}})
        base = {'textFormat': {'fontFamily': 'Arial', 'fontSize': 10, 'foregroundColor': INK}, 'verticalAlignment': 'MIDDLE', 'wrapStrategy': 'WRAP'}
        style(region(0, height, 0, 11), base)
        for start in range(2, tab['asset_end']):
            style(region(start, start+1), {**base, 'backgroundColor': PALE if start % 2 == 0 else WHITE})
        requests.append({'mergeCells': {'range': region(0, 1), 'mergeType': 'MERGE_ALL'}})
        style(region(0, 1), {**base, 'backgroundColor': GREEN, 'textFormat': {'fontSize': 19, 'bold': True, 'foregroundColor': WHITE}})
        for header in tab['headers']:
            style(region(header, header+1), {**base, 'backgroundColor': PALE, 'textFormat': {'bold': True, 'fontSize': 10, 'foregroundColor': GREEN}})
            if header > 1:
                requests.append({'mergeCells': {'range': region(header-1, header), 'mergeType': 'MERGE_ALL'}})
                style(region(header-1, header), {**base, 'backgroundColor': GREEN, 'textFormat': {'bold': True, 'foregroundColor': WHITE}})
        for r0, r1, c0, c1 in tab['numbers']:
            if r1 > r0:
                requests.append({'repeatCell': {'range': region(r0, r1, c0, c1), 'cell': {'userEnteredFormat': {'numberFormat': {'type': 'NUMBER', 'pattern': MONEY}, 'horizontalAlignment': 'RIGHT'}}, 'fields': 'userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment'}})
        style(region(1, 5, 9, 11), {**base, 'backgroundColor': PALE, 'textFormat': {'fontSize': 12, 'bold': True, 'foregroundColor': GREEN}})
        requests.append({'repeatCell': {'range': region(2, height, 10, 11), 'cell': {'userEnteredFormat': {'numberFormat': {'type': 'NUMBER', 'pattern': MONEY}, 'horizontalAlignment': 'RIGHT'}}, 'fields': 'userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment'}})
        requests.append({'setBasicFilter': {'filter': {'range': region(1, max(3, tab['asset_end']))}}})
        for col, width in enumerate((300, 120, 290, 135, 150, 160, 160, 145, 28, 230, 175)):
            requests.append({'updateDimensionProperties': {'range': {'sheetId': sid, 'dimension': 'COLUMNS', 'startIndex': col, 'endIndex': col+1}, 'properties': {'pixelSize': width}, 'fields': 'pixelSize'}})
        requests.append({'updateDimensionProperties': {'range': {'sheetId': sid, 'dimension': 'ROWS', 'startIndex': 0, 'endIndex': height}, 'properties': {'pixelSize': 42}, 'fields': 'pixelSize'}})
        requests.append({'updateDimensionProperties': {'range': {'sheetId': sid, 'dimension': 'ROWS', 'startIndex': 0, 'endIndex': 1}, 'properties': {'pixelSize': 56}, 'fields': 'pixelSize'}})
    for title in ('자산', '보유종목', '공유자료_v1'):
        if title in tabs:
            requests.append({'updateSheetProperties': {'properties': {'sheetId': tabs[title]['sheetId'], 'hidden': True}, 'fields': 'hidden'}})
    from backend.shared_ledger import template_requests as ledger_requests
    requests.extend(ledger_requests(state, meta))
    return requests
