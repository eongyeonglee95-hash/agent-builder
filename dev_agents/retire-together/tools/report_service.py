"""Shared report policy, validation and exact-input cache. Provider secrets never persist."""
import hashlib
import re
from decimal import Decimal
import json
from pathlib import Path
import sqlite3
from datetime import datetime, timezone
from agent.report_policy import POLICY, VERSION as POLICY_VERSION
from tools import report_ai
from agent.guard import check_answer, numbers

DB_PATH = Path(__file__).resolve().parents[1] / 'data/local/ai-reports.sqlite3'


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def verified_answer(text, source):
    # Equivalent formatting (29.00억원 / 29억원) is not a new calculation.
    def normalize(token):
        match = re.fullmatch(r'([+−±-]?\d+(?:\.\d+)?)(.*)', token)
        if not match or match[1].startswith('±'):
            return token
        return str(Decimal(match[1]).normalize()) + match[2]
    checked = check_answer(text, source)
    known = {normalize(n) for n in numbers(source)}
    return not checked.forbidden and all(normalize(n) in known for n in checked.unverified)


def evaluate(*, domain, version, prompt, schema, facts):
    model = report_ai.settings()['RETIRE_REPORT_MODEL']
    instructions = POLICY + '\n' + prompt
    contract = schema.model_json_schema()
    key = hashlib.sha256(canonical({'domain': domain, 'version': version, 'policy': POLICY_VERSION,
        'instructions': instructions, 'schema': contract, 'model': model, 'facts': facts}).encode()).hexdigest()
    DB_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with sqlite3.connect(DB_PATH) as db:
        DB_PATH.chmod(0o600)
        db.execute('CREATE TABLE IF NOT EXISTS reports (key TEXT PRIMARY KEY, domain TEXT, created_at TEXT, facts TEXT, result TEXT, model TEXT, version TEXT)')
        previous = db.execute('SELECT facts, result FROM reports WHERE domain=? ORDER BY created_at DESC LIMIT 1', (domain,)).fetchone()
        row = db.execute('SELECT result FROM reports WHERE key=?', (key,)).fetchone()
        if row:
            return schema.model_validate_json(row[0]).model_dump(), {'cache_hit': True, 'input_hash': key, 'model': model, 'policy_version': POLICY_VERSION}
    source_changes = []
    previous_headline = None
    if previous:
        old_facts, old_result = json.loads(previous[0]), json.loads(previous[1])
        previous_headline = old_result.get('headline')
        names = {'accounts': '계좌 잔고·전략', 'household': '가계 장부·은퇴 계획', 'scope': '계산 조건'}
        source_changes = [label for key, label in names.items() if old_facts.get(key) != facts.get(key)]
    source = canonical(facts)
    text = report_ai.generate(instructions, source, contract)
    try:
        result = schema.model_validate_json(text)
        if len({a.dimension for a in result.assessments}) != 6 or len({a.name for a in result.alternatives}) != 3:
            raise ValueError('duplicate sections')
        if [a.timing for a in result.actions] != ['먼저 확인', '다음 결정', '계속 점검']:
            raise ValueError('action order')
    except ValueError:
        raise report_ai.ReportAIError('보고서 구성을 검증하지 못했어요. 계산 근거를 확인하거나 다시 점검해 주세요.') from None
    if not verified_answer(text, source):
        raise report_ai.ReportAIError('GPT 설명의 숫자나 표현을 검증하지 못했어요. 계산 근거를 확인해 주세요.')
    with sqlite3.connect(DB_PATH) as db:
        db.execute('INSERT OR IGNORE INTO reports VALUES (?,?,?,?,?,?,?)', (key, domain, datetime.now(timezone.utc).isoformat(), source, result.model_dump_json(), model, version))
        # Concurrent identical requests converge on the first validated result.
        stored = db.execute('SELECT result FROM reports WHERE key=?', (key,)).fetchone()[0]
    return schema.model_validate_json(stored).model_dump(), {'cache_hit': False, 'input_hash': key, 'model': model, 'policy_version': POLICY_VERSION, 'source_changes': source_changes, 'previous_headline': previous_headline}
