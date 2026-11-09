"""SHARE-06 isolated browser server: synthetic IdP, real routes, fake Google HTTP.

Fixture controls exist only in this process. Never loads real credentials, SQLite,
YAML, CSV, or tokens. All filesystem writes live inside TemporaryDirectory.
"""
import html
import json
import os
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory
from threading import Thread
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import requests
import uvicorn
from fastapi import Request
from backend import auth_google, storage, retirement
from tests.test_shared_data import FakeData
from tests.test_household_invites import FakeSharing
from tests.test_shared_sheets import SID
from tools import sheets

port = int(os.environ.get('RETIRE_E2E_PORT', '8786'))
origin = f'http://127.0.0.1:{port}'

class Provider(BaseHTTPRequestHandler):
    def log_message(self, *_args): pass
    def do_GET(self):
        q = parse_qs(urlsplit(self.path).query)
        if q.get('redirect_uri') != [origin + '/api/auth/google/callback']:
            self.send_error(400); return
        links = []
        for account, label in [('owner', '테스트 오너'), ('partner', '테스트 배우자'), ('stranger', '테스트 외부 계정'), ('cancel', '취소')]:
            args = {'state': q['state'][0], **({'error': 'access_denied'} if account == 'cancel' else {'code': account})}
            links.append(f'<p><a href="{html.escape(origin + "/api/auth/google/callback?" + urlencode(args), quote=True)}">{label}</a></p>')
        body = ('<!doctype html><meta charset="utf-8"><title>합성 Google</title>' + ''.join(links)).encode()
        self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)

self_check = '--check' in sys.argv
provider = None if self_check else ThreadingHTTPServer(('127.0.0.1', 0), Provider)
if provider:
    Thread(target=provider.serve_forever, daemon=True).start()
original_url = auth_google.authorization_url
def local_url(*args, **kwargs): return f'http://localhost:{(provider.server_port if provider else 9)}/?' + urlsplit(original_url(*args, **kwargs)).query
def identity(config, code, nonce, verifier):
    assert code in {'owner', 'partner', 'stranger'}
    return f'{code}-sub', f'{code}@example.test'
def verified(config, code, nonce, verifier):
    return *identity(config, code, nonce, verifier), {'access_token': f'synthetic-{code}-token', 'refresh_token': f'synthetic-{code}-refresh', 'expires_in': 3600, 'token_type': 'Bearer', 'scope': 'openid email https://www.googleapis.com/auth/drive.file'}
auth_google.authorization_url = local_url
auth_google.exchange_identity = identity
auth_google.exchange_verified = verified

def forbid(*args, **kwargs): raise AssertionError('External transport is forbidden in SHARE-06 browser tests')
requests.post = requests.get = forbid
sheets.open_sheets = forbid
fake = FakeData()
def fake_request(method, url, **kwargs):
    if url.startswith(sheets.API + '/') and (method == 'PUT' or (url.endswith(':batchUpdate') and all('addSheet' in r for r in kwargs.get('json', {}).get('requests', [])))):
        result = FakeSharing.request(fake, method, url, **kwargs)
        fake.ids = {t: i for i, t in enumerate(fake.files[SID]['tabs'])}
        return result
    return fake.request(method, url, **kwargs)
requests.request = fake_request

with TemporaryDirectory(prefix='retire-share06-browser-') as folder:
    root = Path(folder)
    os.environ.update({
        'RETIRE_AUTH_MODE': 'web', 'RETIRE_AUTH_ORIGIN': origin, 'RETIRE_AUTH_BOOTSTRAP': '1', 'RETIRE_AUTH_ALLOW_HTTP': '1',
        'RETIRE_GOOGLE_WEB_CLIENT': str(root / 'client.json'), 'RETIRE_AUTH_DB': str(root / 'auth.sqlite3'), 'RETIRE_SHEETS': 'on',
        'RETIRE_UPLOAD_DIR': str(root / 'uploads'), 'RETIRE_SNAPSHOT_DIR': str(root / 'snapshots'),
        'RETIRE_ACCOUNTS_PATH': str(root / 'accounts.yaml'), 'RETIRE_ASSET_MAP_PATH': str(root / 'asset_map.yaml'),
        'RETIRE_STRATEGIES_PATH': str(root / 'strategies.yaml'), 'RETIRE_DECISIONS_PATH': str(root / 'DECISIONS.md'),
    })
    storage.DB_PATH = root / 'financial.sqlite3'
    (root / 'client.json').write_text(json.dumps({'web': {'client_id': 'synthetic.apps.googleusercontent.com', 'client_secret': 'synthetic', 'redirect_uris': [origin + '/api/auth/google/callback']}}))
    (root / 'client.json').chmod(0o600)
    (root / 'accounts.yaml').write_text('accounts: []\npools: {}\n')
    (root / 'asset_map.yaml').write_text('assets: {}\nclass_defaults: {}\n')
    (root / 'strategies.yaml').write_text('strategies: {}\n')
    (root / 'DECISIONS.md').write_text('# Synthetic decisions\n')
    from backend.main import app
    from backend.auth_config import load_config
    from backend.household_invites_store import InviteStore

    @app.post('/__share_fixture')
    async def fixture(request: Request):
        global fake
        body = await request.json()
        if body.get('reset'):
            for file in root.glob('*.sqlite3*'): file.unlink()
            shutil.rmtree(root / 'shared-data-backups', ignore_errors=True)
            fake = FakeData()
            if body.get('empty', True): fake.files.clear()
            with storage.connection() as db:
                family = storage.FamilyInput(me=storage.Person(name='오너 이름', age=40), partner=storage.Person(name='배우자 이름', age=37), retirement_age=60, target_amount=100000000, version=0).model_dump(exclude={'version'})
                db.execute('INSERT INTO family VALUES (1,?,1)', (json.dumps(family),))
                for who, pocket, amount, label in [('me', 'cash', 1000000, '오너 예금'), ('partner', 'retirement', 2000000, '배우자 연금'), ('joint', 'property', 10000000, '공동 집')]:
                    p = storage.AssetInput(name=label, account=label, owner=who, pocket=pocket, assetClass='cash' if pocket != 'property' else 'property', amount=amount, as_of='2026-01-01', share_percent=40 if who == 'joint' else None).model_dump(mode='json')
                    db.execute("INSERT INTO assets VALUES (?,?,?,1,'2026-01-01','2026-01-01')", (str(uuid4()), str(uuid4()), json.dumps(p)))
                retirement._table(db)
                plan = retirement.PlanInput(version=0, me=retirement.PersonPlan(national_monthly=100000), partner=retirement.PersonPlan(national_monthly=200000), monthly_need=3000000).model_dump(exclude={'version'})
                db.execute('INSERT INTO retirement_plan VALUES (1,?,1)', (json.dumps(plan),))
        if 'picker' in body:
            if body['picker']:
                os.environ['RETIRE_GOOGLE_PICKER_API_KEY'] = 'synthetic-picker-key'
                os.environ['RETIRE_GOOGLE_PROJECT_NUMBER'] = '1234567890'
            else:
                os.environ.pop('RETIRE_GOOGLE_PICKER_API_KEY', None); os.environ.pop('RETIRE_GOOGLE_PROJECT_NUMBER', None)
        for key in ['member_access', 'fail_delete', 'status', 'create_failure', 'hidden']:
            if key in body: setattr(fake, key, body[key])
        if 'owned' in body: fake.files[SID]['meta']['ownedByMe'] = body['owned']
        if 'headers_valid' in body: fake.files[SID]['tabs'][sheets.ASSET_TAB] = [list(sheets.TABS[sheets.ASSET_TAB])] if body['headers_valid'] else [['broken']]
        if body.get('legacy_conflict'):
            with storage.connection() as db:
                row = next(storage.asset_from(r) for r in db.execute('SELECT * FROM assets') if json.loads(r['payload'])['owner'] == 'me')
            row['amount'] = 1500000
            fake.files[SID]['tabs'][sheets.ASSET_TAB].append([row.get(k, '') if row.get(k) is not None else '' for k in sheets.ASSET_COLUMNS])
        if body.get('expire'):
            with InviteStore(load_config().db_path).connection() as db: db.execute('UPDATE household_invites SET expires_at=0 WHERE status="pending"')
        return {'creates': fake.creates, 'shares': fake.shares, 'files': len(fake.files)}
    app.router.routes.insert(0, app.router.routes.pop())
    try:
        if self_check:
            from fastapi.testclient import TestClient
            with TestClient(app, base_url=origin, follow_redirects=False, client=('127.0.0.1', 50000)) as owner:
                assert owner.post('/__share_fixture', json={'reset': True, 'picker': False}).status_code == 200
                def complete(client, url, account):
                    state = parse_qs(urlsplit(url).query)['state'][0]
                    r = client.get('/api/auth/google/callback', params={'state': state, 'code': account})
                    assert r.status_code == 303, r.text
                    return r
                complete(owner, owner.get('/api/auth/google/login').headers['location'], 'owner')
                session = owner.get('/api/auth/session').json()
                owner.headers.update({'Origin': origin, 'X-Retire-CSRF': session['csrf_token']})
                complete(owner, owner.post('/api/google/shared/connect').json()['authorization_url'], 'owner')
                r = owner.post('/api/google/shared/spreadsheet'); assert r.status_code == 200, r.text
                assert owner.post('/api/google/shared/spreadsheet').status_code == 200
                assert fake.creates == 1
                preview = owner.post('/api/shared-data/migration/preview'); assert preview.status_code == 200, preview.text
                r = owner.post('/api/shared-data/migration/commit', json={'operation_id': str(uuid4()), 'preview_id': preview.json()['preview_id'], 'choices': {}})
                assert r.status_code == 200, r.text
                assert owner.get('/api/shared-data/dashboard?owner=me').json()['snapshot']['total'] == 5000000
                issued = owner.post('/api/auth/invitations', json={'email': 'partner@example.test'}); assert issued.status_code == 200, issued.text
                with TestClient(app, base_url=origin, follow_redirects=False, client=('127.0.0.1', 50001)) as partner:
                    partner.headers.update({'Origin': origin, 'X-Retire-Invite': '1'})
                    accepted = partner.post('/api/auth/invitations/accept', json={'code': issued.json()['code']})
                    assert accepted.status_code == 200, accepted.text
                    fake.member_access = False
                    assert complete(partner, accepted.json()['authorization_url'], 'partner').headers['location'].endswith('invitation=pending')
                    join = partner.get('/api/auth/invitations/join'); assert join.status_code == 200, join.text
                    partner.headers['X-Retire-CSRF'] = join.json()['csrf_token']
                    assert partner.post('/api/auth/invitations/picker').status_code == 503
                    owner.post('/__share_fixture', json={'picker': True, 'member_access': True})
                    assert partner.post('/api/auth/invitations/picker').json()['spreadsheet_id'] == SID
                    assert partner.post('/api/auth/invitations/resume').status_code == 200
                    partner.headers['X-Retire-CSRF'] = partner.get('/api/auth/session').json()['csrf_token']
                    projected = partner.get('/api/shared-data/dashboard?owner=me'); assert projected.status_code == 200, projected.text
                    assert projected.json()['snapshot']['total'] == 8000000
                    assert projected.json()['family']['me']['name'] == '배우자 이름'
                    assert projected.json()['family']['goal_reference_label'] == '배우자'
                    revoked = owner.post('/api/auth/invitations/' + issued.json()['invitation']['id'] + '/revoke')
                    assert revoked.status_code == 200, revoked.text
                    assert partner.get('/api/shared-data').status_code == 401
                print('SHARE-06 fixture self-check passed: creation/retry, migration, two identities, pending join/Picker, fixed dashboard, revoke; no browser or external network')
        else:
            uvicorn.run(app, host='127.0.0.1', port=port, log_level='warning')
    finally:
        if provider: provider.shutdown()
