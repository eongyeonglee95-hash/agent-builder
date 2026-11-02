"""Account replacement shared by SQLite and Sheets; never add total and details together."""
from uuid import uuid4
import unicodedata

from fastapi import HTTPException


def normalized(value):
    return ''.join(unicodedata.normalize('NFKC', value).casefold().split())


def replace_group(rows, account_id, source, payloads, timestamp):
    if not payloads:
        raise HTTPException(422, '등록할 세부 자산이 없습니다.')
    first = payloads[0]
    scope = lambda a: (a['owner'], a['pocket'], normalized(a['account']))
    if any(scope(p) != scope(first) for p in payloads):
        raise HTTPException(422, '한 계좌의 세부 자산만 함께 등록할 수 있습니다.')
    roots = [a for a in rows if not a.get('parent_id') and
             (a.get('account_id') == account_id or scope(a) == scope(first))]
    grouped = [a for a in roots if any(r.get('parent_id') == a['id'] for r in rows)]
    manual = [a for a in roots if a.get('source', 'manual') not in ('file', 'capture')]
    candidates = manual or grouped
    if len(candidates) > 1 or any(a.get('account_id') not in (None, '', account_id) for a in roots):
        raise HTTPException(409, '같은 이름의 계좌가 여러 개입니다. 계좌 이름을 구분한 뒤 다시 등록해 주세요.')
    root = candidates[0] if candidates else None
    legacy = [a for a in roots if not root or a['id'] != root['id']]
    if any(a.get('source') not in ('file', 'capture') for a in legacy):
        raise HTTPException(409, '중복 계좌를 먼저 정리해 주세요.')
    old_children = [a for a in rows if root and a.get('parent_id') == root['id']]
    retained = [a for a in old_children if a.get('source') not in ('file', 'capture')]
    if retained:
        raise HTTPException(409, '직접 입력한 세부 자산이 연결되어 있습니다. 중복을 막기 위해 기존 세부 자산을 정리한 뒤 가져와 주세요.')
    names = [normalized(a['name']) for a in payloads + retained]
    if len(names) != len(set(names)):
        raise HTTPException(409, '직접 입력한 세부 자산과 이름이 겹칩니다. 기존 세부 자산을 확인해 주세요.')
    defaults = dict(parent_id=None, valuation_source='total', share_percent=None)
    if root:
        root = {**defaults, **root, 'account_id': account_id,
                'version': root['version'] + 1, 'updated_at': timestamp}
    else:
        root = {**defaults, **first, 'id': str(uuid4()), 'name': first['account'],
                'assetClass': 'mixed', 'amount': sum(p['amount'] for p in payloads),
                'valuation_source': 'details', 'version': 1, 'updated_at': timestamp,
                'account_id': account_id, 'source': source}
    removed = {a['id'] for a in legacy + old_children if a not in retained}
    keep = [a for a in rows if a['id'] not in removed and a['id'] != root['id']]
    children = []
    for p in payloads:
        old = next((a for a in old_children if a.get('source') in ('file', 'capture') and normalized(a['name']) == normalized(p['name'])), None)
        children.append({**defaults, **p, 'id': old['id'] if old else str(uuid4()),
                         'parent_id': root['id'], 'account_id': account_id, 'source': source,
                         'version': old['version'] + 1 if old else 1, 'updated_at': timestamp})
    return keep + [root] + children, children
