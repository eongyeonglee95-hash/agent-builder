"""Run existing financial features against an isolated, current Sheets snapshot.

The local ledger is never a fallback. Successful mutations are validated and
committed to the same journal before returning success; temporary files vanish.
"""
from collections import defaultdict
from copy import deepcopy
import csv
import json
from pathlib import Path
import tempfile
from uuid import UUID

from fastapi import HTTPException
import yaml

from backend.shared_data import Service
from backend.shared_data_google import events
from backend.shared_data_schema import fingerprint, key, validate
from backend.shared_data_source import local_sources
from tools.data_context import workspace

PREFIXES = ('/api/assets', '/api/retirement', '/api/property', '/api/property-move', '/api/household-book',
            '/api/register', '/api/workbook', '/api/portfolio', '/api/rebalance')
EXACT = {'/api/family', '/api/dashboard', '/api/strategies', '/api/portfolios', '/api/holdings'}
PREVIEWS = {'/api/property-move/sentiment', '/api/property-move/discover', '/api/property-move/expert-news', '/api/rebalance/preview', '/api/workbook/rebalance', '/api/retirement/preview',
            '/api/workbook/portfolio/preview', '/api/workbook/portfolio/alternatives', '/api/register/capture', '/api/household-book/capture',
            '/api/register/file', '/api/register/kiwoom'}


def supported(path):
    return path in EXACT or any(path == p or path.startswith(p + '/') for p in PREFIXES)


def mutates(method, path):
    return method not in {'GET', 'HEAD', 'OPTIONS'} and path not in PREVIEWS


class SharedWorkspace:
    def __init__(self, config, identity, path, method, headers, request_hash):
        self.service = Service(config, identity)
        self.path, self.method, self.request_hash = path, method, request_hash
        self.writing = mutates(method, path)
        self.temp = None
        self.replayed_response = None
        self.service.store.owner(identity)  # Fixed owner-relative UI contracts.
        if self.writing:
            self.service.access(owner=True)
            self.raw, self.state = self.service.current()
        else:
            from backend.shared_read_cache import current
            self.raw, self.state = current(self.service)
        self.revision = fingerprint(self.raw)
        self.version = len(events(self.raw))
        self.operation_id = headers.get('x-retire-operation', '')
        if self.writing:
            try:
                UUID(self.operation_id)
            except ValueError:
                raise HTTPException(409, '저장할 화면을 새로고침해 주세요. 자료 확인 정보가 없습니다.') from None
            receipt = self.service.store.receipt(self.operation_id)
            if receipt:
                self.service.replay(self.operation_id, request_hash)
                self.replayed_response = self.service.store.load_backup(receipt['backup_id'])['http_response']
                return
            if headers.get('x-retire-sheet') != self.service.sid or headers.get('x-retire-revision') != self.revision:
                raise HTTPException(409, '연결된 시트나 자료가 바뀌었습니다. 입력 내용을 보관하고 새로고침 후 다시 저장해 주세요.')
        root = config.db_path.parent / 'shared-workspaces'
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.root = Path(self.temp.name)
        token = workspace.set(self.root)
        try:
            self.seed()
            self.baseline, _ = local_sources(self.service.members)
        except BaseException:
            self.close()
            raise
        finally:
            workspace.reset(token)

    def seed(self):
        from backend import storage, retirement, property as homes, property_move, household_book
        from tools.decisions import SECTION
        records, members = self.state['records'], self.service.members
        aliases = {v: k for k, v in members.items()}
        grouped = defaultdict(list)
        for r in records:
            grouped[r['kind']].append(r)
        family = {aliases[r['member_id']]: r['payload'] for r in grouped['profile']}
        goal = next(iter(grouped['family_goal']), {}).get('payload', {})
        family.update({k: goal.get(k) for k in ('retirement_age', 'target_amount')})
        with storage.connection() as db:
            from backend.additional_pensions import tables as additional_tables
            additional_tables(db)
            retirement._table(db)
            homes._table(db)
            property_move._table(db)
            household_book._table(db)
            db.execute('INSERT INTO family VALUES (1,?,?)', (json.dumps(family), self.version))
            if grouped['retirement'] or grouped['pension']:
                plan = dict(next(iter(grouped['retirement']), {}).get('payload', {}))
                plan.update({aliases[r['member_id']]: r['payload'] for r in grouped['pension']})
                db.execute('INSERT INTO retirement_plan VALUES (1,?,?)', (json.dumps(plan), self.version))
            for r in grouped['asset']:
                p = deepcopy(r['payload'])
                owner = 'joint' if r['member_id'] == 'joint' else aliases[r['member_id']]
                request_id = p.pop('request_id', None) or r['id']
                version, stamp = p.pop('version', 1), p.pop('updated_at', '')
                db.execute('INSERT INTO assets VALUES (?,?,?,?,?,?)', (r['id'], request_id, json.dumps({**p, 'owner': owner}), version, stamp, stamp))
            for r in grouped['additional_plan']:
                p = deepcopy(r['payload'])
                version = p.pop('version', 0)
                db.execute('INSERT INTO additional_pension_plans VALUES (?,?,?)', (r['id'], json.dumps(p), version))
            for r in grouped['additional_payment']:
                p = deepcopy(r['payload'])
                aid, stamp = p.pop('asset_id'), p.pop('recorded_at')
                db.execute('INSERT INTO additional_pension_payments VALUES (?,?,?,?)', (r['id'], aid, json.dumps(p, sort_keys=True, ensure_ascii=False), stamp))
            for r in grouped['property_detail']:
                p = deepcopy(r['payload'])
                version, stamp = p.pop('version', 0), p.pop('updated_at', '')
                db.execute('INSERT INTO property_detail VALUES (?,?,?,?)', (r['id'], json.dumps(p), version, stamp))
            for r in grouped['property_plan']:
                p = deepcopy(r['payload'])
                version = p.pop('version', 0)
                owner = 'together' if r['member_id'] == 'household' else aliases[r['member_id']]
                db.execute('INSERT INTO property_move VALUES (?,?,?,?)', (owner, json.dumps(p), version, ''))
            for r in grouped['household_month']:
                p = deepcopy(r['payload'])
                version = p.pop('version')
                db.execute('INSERT INTO household_book VALUES (?,?,?,?)', (r['id'], json.dumps(p, ensure_ascii=False), version, ''))
            for r in grouped['property_track']:
                p = r['payload']
                owner = 'together' if r['member_id'] == 'household' else aliases[r['member_id']]
                db.execute('INSERT INTO property_track VALUES (?,?,?,?)', (owner, p['candidate_id'], p['day'], json.dumps(p['entry'])))
        accounts = [{**r['payload'], 'id': r['id'], 'owner': 'me' if r['member_id'] == members['me'] else 'spouse'} for r in grouped['account']]
        (self.root / 'accounts.yaml').write_text(yaml.safe_dump({'accounts': accounts, 'pools': {r['id']: r['payload'] for r in grouped['pool']}}, allow_unicode=True))
        for r in grouped['rules']:
            (self.root / (r['id'] + '.yaml')).write_text(r['payload']['text'])
        holdings = defaultdict(list)
        for r in grouped['holding']:
            holdings[r['payload']['account_id']].append(r['payload'])
        for aid, rows in holdings.items():
            folder = self.root / 'snapshots' / aid
            folder.mkdir(parents=True)
            day = max((r.get('as_of') or '1900-01-01' for r in rows))
            cols = ['account_id', 'ticker_name', 'ticker', 'qty', 'price', 'buy_value', 'as_of', 'updated_at']
            with (folder / (day + '.csv')).open('w') as f:
                writer = csv.DictWriter(f, fieldnames=cols)
                writer.writeheader()
                writer.writerows({k: r.get(k, '') for k in cols} for r in rows)
        from backend.trade_journal import database
        with database() as trades:
            for r in grouped['trade_record']:
                p, entry = r['payload'], r['payload']['input']
                trades.execute('INSERT INTO entries VALUES (?,?,?,?,?,?)', (r['id'], entry['pool_id'], entry['event_date'], p['record']['recorded_at'], json.dumps(entry, sort_keys=True, ensure_ascii=False), json.dumps(p['record'], ensure_ascii=False)))
        self.decisions = grouped['decision']
        lines = ['- {date} | {who} | {decision} | {reason}'.format(**r['payload']) for r in self.decisions]
        (self.root / 'decisions.md').write_text(SECTION + '\n' + '\n'.join(lines) + '\n')

    def finish(self, response):
        """Called in the scoped worker after the endpoint has finished successfully."""
        if not self.writing:
            return
        after, _ = local_sources(self.service.members)
        old = {key(r): r for r in self.baseline['records']}
        new = {key(r): r for r in after['records']}
        current = {key(r): r for r in self.state['records']}
        # Round-trip defaults/normalization never turn an untouched record into an edit.
        for k in old.keys() | new.keys():
            if k[0] == 'decision' or old.get(k) == new.get(k):
                continue
            if k in new:
                current[k] = new[k]
            else:
                current.pop(k, None)
        from tools.decisions import read_decisions
        decisions = read_decisions(self.root / 'decisions.md')
        if decisions[:len(self.decisions)] != [r['payload'] for r in self.decisions]:
            raise HTTPException(409, '기존 결정 기록을 변경할 수 없습니다.')
        for index, p in enumerate(decisions[len(self.decisions):]):
            rid = fingerprint([self.operation_id, index, p])
            current['decision', rid] = {'kind': 'decision', 'id': rid, 'member_id': 'household', 'payload': p}
        proposed = validate({**self.state, 'records': list(current.values())}, self.service.members)
        original_trades = {key(r): r for r in self.state['records'] if r['kind'] == 'trade_record'}
        if any(current.get(k) != r for k, r in original_trades.items()):
            raise HTTPException(403, '기존 체결·보류 기록은 변경할 수 없습니다.')
        allowed_rules = {'/api/workbook/portfolio/custom': {'strategies'}, '/api/register/commit': {'asset_map'}, '/api/register/sync': {'asset_map'}}.get(self.path, set())
        for r in proposed['records']:
            if r['kind'] == 'rules' and r != next((x for x in self.state['records'] if key(x) == key(r)), None) and r['id'] not in allowed_rules:
                raise HTTPException(403, '이 작업에서 투자 규칙을 바꿀 수 없습니다.')
        without_rules = lambda state: {**state, 'records': [r for r in state['records'] if r['kind'] not in {'rules', 'decision'}]}
        self.service.authorize_changes(without_rules(self.state), without_rules(proposed))
        if fingerprint(proposed) == fingerprint(self.state):
            return
        with self.service.store.operation():
            self.service.access(owner=True)
            if self.service.journal.raw() != self.raw:
                raise HTTPException(409, '저장 중 시트 자료가 변경됐습니다. 새로 불러온 뒤 다시 저장해 주세요.')
            result = self.service.commit(self.operation_id, 'save', self.request_hash, self.raw, self.state, proposed, {'http_response': response})
            self.revision = result['revision']
            self.changed = True

    def close(self):
        if self.temp:
            self.temp.cleanup()
