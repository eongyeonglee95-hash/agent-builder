"""One table contract for the workbook and native Sheets, with checked imports."""
from copy import deepcopy
from datetime import datetime, timezone
import yaml
from backend.shared_data_schema import fail, key, validate
from tools.sheets import API

EDIT_TABS = ('자산 내역', '보유 종목')
CLASS = {'stock': '주식', 'long_bond': '장기채', 'mid_bond': '중기채', 'gold': '금', 'commodity': '원자재', 'cash': '현금', 'mixed': '혼합·미분류', 'property': '부동산', 'debt': '대출'}
POCKET = {'retirement': '노후', 'cash': '현금', 'property': '부동산', 'debt': '대출'}


def tags(state):
    rule = next((r['payload']['text'] for r in state['records'] if r['kind'] == 'rules' and r['id'] == 'asset_map'), '')
    amap = (yaml.safe_load(rule) or {}).get('assets', {})
    by_code = {str(v.get('ticker')): v for v in amap.values() if v.get('ticker')}
    return lambda p: amap.get(p['ticker_name']) or by_code.get(p.get('ticker')) or {}


def tables(state):
    accounts = {r['id']: r['payload'] for r in state['records'] if r['kind'] == 'account'}
    aliases = {v: ('나' if k == 'me' else '배우자') for k, v in state['members'].items()}
    classify = tags(state)
    out = {
        '자산 내역': {'headers': ['이름', '계좌·보관처', '소유자', '나의 지분%', '종류', '연금 층', '자산군', '금액(원)', '기준일'], 'rows': [], 'keys': [], 'editable': []},
        '보유 종목': {'headers': ['계좌', '종목명', '종목코드', '보유수량', '현재가(원)', '매입금액(원)', '자산군', '주식 구분', '평가금액(원)', '손익(원)', '기준일'], 'rows': [], 'keys': [], 'editable': []}}
    for r in sorted(state['records'], key=lambda r: (r['member_id'], (r['payload'].get('account_id') or ''), r['id'])):
        p = r['payload']
        if r['kind'] == 'asset':
            tab = out['자산 내역']
            row = [p['name'], p['account'], aliases.get(r['member_id'], '공동'), p.get('share_percent') or '', POCKET[p['pocket']],
                   {2: '퇴직연금', 3: '개인연금', 4: '추가연금'}.get(p.get('pension_layer'), ''), CLASS[p['assetClass']], p['amount'], p['as_of']]
            editable = {} if p.get('source') in {'file', 'capture', 'api'} or p.get('account_id') else {0: 'name', 7: 'amount', 8: 'as_of'}
        elif r['kind'] == 'holding':
            tab = out['보유 종목']; tag = classify(p); a = accounts[p['account_id']]
            value = p['qty'] * p['price']; buy = p.get('buy_value')
            row = [a.get('label') or p['account_id'], p['ticker_name'], p.get('ticker') or '', p['qty'], p['price'], '' if buy is None else buy,
                   CLASS.get(tag.get('asset_class'), '혼합·미분류'), {'us': '미국', 'kr': '국내', 'em': '신흥국·테마', 'income': '배당·리츠'}.get(tag.get('stock_group'), ''), value, '' if buy is None else value-buy, p.get('as_of', '')]
            editable = {3: 'qty', 4: 'price', 5: 'buy_value'}
        else:
            continue
        tab['rows'].append(row); tab['keys'].append(list(key(r))); tab['editable'].append(editable)
    return out


def native_rows(tab):
    return [[*row, *([''] * (11-len(row))), ':'.join(k)] for row, k in zip(tab['rows'], tab['keys'])]


def read_tables(journal):
    meta = journal.meta()
    titles = {s['properties']['title'] for s in meta.get('sheets', [])}
    if not set(EDIT_TABS) <= titles:
        return None  # Old workbook: no editable contract has been published yet.
    from backend.shared_sheet_template import TITLES
    selected = (*EDIT_TABS, *(t for t in TITLES if t in titles))
    sizes = {s['properties']['title']: s['properties'].get('gridProperties', {}).get('rowCount', 10003 if s['properties']['title'] in EDIT_TABS else 1000) for s in meta['sheets']}
    if any(sizes[t] > 20000 for t in selected):
        fail('시트의 행 범위가 너무 큽니다. 입력 표를 확인해 주세요.')
    result = journal.api.call('GET', f'{API}/{journal.sid}/values:batchGet', params={
        'ranges': [f"'{t}'!A1:L{sizes[t]}" for t in selected],
        'valueRenderOption': 'FORMULA', 'dateTimeRenderOption': 'FORMATTED_STRING'})
    ranges = result.get('valueRanges', [])
    if len(ranges) != len(selected):
        fail('시트 입력 표를 모두 읽지 못했습니다. 다시 시도해 주세요.')
    return {t: r.get('values', []) for t, r in zip(selected, ranges)}



def reconcile(state, cells):
    """IDs survive full-row sorts. Missing/duplicate rows never imply deletion."""
    if cells is None:
        return deepcopy(state), []
    from backend.shared_sheet_template import sections
    for title, tab in sections(state).items():
        if title not in cells:
            continue
        expected = [[v if v is not None else '' for v in row] + [''] * (8-len(row)) for row in tab['rows']]
        actual = [(list(row) + [''] * 8)[:8] for row in cells[title]]
        while actual and not any(v != '' and v is not None for v in actual[-1]):
            actual.pop()
        from backend.shared_data_schema import encoded
        end = tab['asset_end']
        matches = actual[:2] == expected[:2] and sorted(actual[2:end], key=encoded) == sorted(expected[2:end], key=encoded) and actual[end:] == expected[end:]
        if not matches:
            fail(f'{title}: 계산 결과 표가 직접 변경됐습니다. 이 표의 값을 복원하고 자산 내역·보유 종목의 입력 칸에서 수정해 주세요.')
    out = deepcopy(state); records = {key(r): r for r in out['records']}; changes = []
    for title, table in tables(state).items():
        rows = cells[title]
        width = len(table['headers'])
        if len(rows) < 2 or rows[1][:width] != table['headers']:
            fail(f'{title}: 열 제목이 바뀌었습니다. 원래 제목으로 복원해 주세요.')
        expected = {':'.join(k): (k, row, editable) for k, row, editable in zip(table['keys'], table['rows'], table['editable'])}
        seen = set()
        for n, values in enumerate(rows[2:], 3):
            if not any(v != '' and v is not None for v in values):
                continue
            values = list(values) + [''] * max(0, 12-len(values))
            rid = values[11]
            if rid not in expected or rid in seen:
                fail(f'{title} {n}행: 행 연결 정보가 없거나 중복됩니다. 행 추가·삭제는 앱에서 해 주세요.')
            seen.add(rid); k, original, editable = expected[rid]
            for c, old in enumerate(original):
                new = values[c]
                if new == old:
                    continue
                location = f'{title}!{chr(65+c)}{n}'
                if c not in editable:
                    fail(f'{location}: 계산·분류 칸은 앱에서 변경해 주세요. 원래 값으로 복원하면 불러올 수 있어요.')
                field = editable[c]
                if field in {'amount', 'qty', 'price', 'buy_value'}:
                    if field == 'buy_value' and new == '':
                        new = None
                    elif isinstance(new, bool) or not isinstance(new, (int, float)) or int(new) != new or not 0 <= new <= 10**15:
                        fail(f'{location}: 0 이상의 정수만 입력해 주세요. 수식 대신 값을 입력해 주세요.')
                    else:
                        new = int(new)
                elif not isinstance(new, str) or not new.strip() or new.startswith('='):
                    fail(f'{location}: 올바른 이름 또는 YYYY-MM-DD 기준일을 입력해 주세요.')
                records[tuple(k)]['payload'][field] = new
                changes.append({'cell': location, 'before': old, 'after': new})
        if seen != set(expected):
            fail(f'{title}: 기존 행이 빠졌습니다. 삭제한 행을 복원하거나 앱에서 삭제해 주세요.')
    # Update linked ledger valuations by the exact holding delta, never guessing a group.
    classify = tags(state)
    for old in state['records']:
        if old['kind'] != 'holding':
            continue
        p = old['payload']; q = records[key(old)]['payload']
        delta = q['qty']*q['price'] - p['qty']*p['price']
        if not delta:
            continue
        cls = classify(p).get('asset_class') or 'mixed'
        candidates = [r for r in out['records'] if r['kind'] == 'asset' and r['payload'].get('account_id') == p['account_id'] and r['payload']['assetClass'] == cls and r['payload'].get('valuation_source', 'total') != 'details']
        if len(candidates) != 1:
            fail(f"{p['ticker_name']}: 연결된 자산 금액을 확정할 수 없습니다. 앱의 보유 종목 표에서 수정해 주세요.")
        asset = candidates[0]['payload']; asset['amount'] += delta
        if asset.get('parent_id'):
            records['asset', asset['parent_id']]['payload']['amount'] += delta
    if changes:
        stamp = datetime.now(timezone.utc).isoformat()
        original = {key(r): r for r in state['records']}
        for k, r in records.items():
            if r != original[k]:
                r['payload']['updated_at'] = stamp
                if r['kind'] == 'asset':
                    r['payload']['version'] = r['payload'].get('version', 0) + 1
    return validate(out, state['members']), changes


def template_requests(state, meta):
    existing = {s['properties']['title']: s['properties'] for s in meta.get('sheets', [])}
    used = {p['sheetId'] for p in existing.values()}
    requests = []
    for index, (title, tab) in enumerate(tables(state).items()):
        sid = existing.get(title, {}).get('sheetId')
        if sid is None:
            sid = next(i for i in range(1701100, 1701200) if i not in used); used.add(sid)
            requests.append({'addSheet': {'properties': {'sheetId': sid, 'title': title}}})
        rows = [[title + ' · 앱과 같은 자산 장부'], [*tab['headers'], *(['']*(11-len(tab['headers']))), '행 연결 ID'], *native_rows(tab)]
        height = max(3, len(rows)); count = max(10003, height, existing.get(title, {}).get('gridProperties', {}).get('rowCount', 0))
        requests.append({'updateSheetProperties': {'properties': {'sheetId': sid, 'index': 1, 'hidden': False, 'gridProperties': {'rowCount': count, 'columnCount': 26, 'frozenRowCount': 2, 'frozenColumnCount': 0, 'hideGridlines': False}}, 'fields': 'index,hidden,gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.hideGridlines'}})
        requests.append({'updateCells': {'range': {'sheetId': sid, 'startColumnIndex': 0, 'endColumnIndex': 12}, 'fields': 'userEnteredValue', 'rows': [{'values': [{'userEnteredValue': {'numberValue' if isinstance(v, (float,int)) else 'stringValue': v}} for v in row]} for row in rows]}})
        def area(r0, r1, c0=0, c1=12):
            return dict(sheetId=sid, startRowIndex=r0, endRowIndex=r1, startColumnIndex=c0, endColumnIndex=c1)
        requests.append({'unmergeCells': {'range': area(0,1,0,11)}})
        requests.append({'mergeCells': {'range': area(0,1,0,11), 'mergeType': 'MERGE_ALL'}})
        requests.append({'repeatCell': {'range': area(0,height), 'cell': {'userEnteredFormat': {'backgroundColor': {'red':1,'green':1,'blue':1}, 'textFormat': {'fontFamily':'Arial','fontSize':11,'foregroundColor':{'red':.1,'green':.13,'blue':.16}}, 'verticalAlignment':'MIDDLE', 'wrapStrategy':'CLIP'}}, 'fields':'userEnteredFormat'}})
        requests.append({'repeatCell': {'range':area(0,2), 'cell':{'userEnteredFormat':{'backgroundColor':{'red':.93,'green':.95,'blue':.94},'textFormat':{'bold':True},'wrapStrategy':'WRAP'}},'fields':'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold,userEnteredFormat.wrapStrategy'}})
        for n,(row,editable) in enumerate(zip(tab['rows'],tab['editable']),2):
            for c,v in enumerate(row):
                if isinstance(v,(int,float)):
                    requests.append({'repeatCell':{'range':area(n,n+1,c,c+1),'cell':{'userEnteredFormat':{'numberFormat':{'type':'NUMBER','pattern':'#,##0;[Red](#,##0);0'},'horizontalAlignment':'RIGHT'}},'fields':'userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment'}})
                if c in editable:
                    requests.append({'repeatCell':{'range':area(n,n+1,c,c+1),'cell':{'note':'앱과 연결되는 입력 칸입니다. 수정 후 앱에서 시트 변경 불러오기를 눌러 주세요.','userEnteredFormat':{'backgroundColor':{'red':1,'green':.98,'blue':.91}}},'fields':'note,userEnteredFormat.backgroundColor'}})
        date_col = 8 if title == '자산 내역' else 10
        requests.append({'repeatCell': {'range': area(2, count, date_col, date_col+1), 'cell': {'userEnteredFormat': {'numberFormat': {'type': 'TEXT'}}}, 'fields': 'userEnteredFormat.numberFormat'}})
        requests.append({'setBasicFilter':{'filter':{'range':area(1,height)}}})
        requests.append({'updateDimensionProperties':{'range':{'sheetId':sid,'dimension':'COLUMNS','startIndex':11,'endIndex':12},'properties':{'hiddenByUser':True},'fields':'hiddenByUser'}})
        widths = [190,170,100,110,120,120,110,140,120,120,120]
        widths[date_col] = 150
        for c,width in enumerate(widths):
            requests.append({'updateDimensionProperties':{'range':{'sheetId':sid,'dimension':'COLUMNS','startIndex':c,'endIndex':c+1},'properties':{'pixelSize':width},'fields':'pixelSize'}})
        requests.append({'updateDimensionProperties':{'range':{'sheetId':sid,'dimension':'ROWS','startIndex':0,'endIndex':height},'properties':{'pixelSize':36},'fields':'pixelSize'}})
    return requests
