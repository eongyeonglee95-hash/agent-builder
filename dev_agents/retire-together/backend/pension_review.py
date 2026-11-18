"""Scheduled, read-only pension reviews. Engine facts first; AI explains only."""
import asyncio
import calendar
from contextlib import contextmanager
from dataclasses import asdict
from datetime import date, datetime, timedelta
import json
from pathlib import Path
import sqlite3
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import Field
from backend.storage import InputModel

router = APIRouter(prefix='/api/workbook/review', tags=['pension-review'])
DB_PATH = Path(__file__).resolve().parents[1] / 'data/local/pension-review.sqlite3'
TZ = ZoneInfo('Asia/Seoul')


def now():
    return datetime.now(TZ)


class Schedule(InputModel):
    enabled: bool = False
    period: Literal['month', 'quarter', 'half', 'custom'] = 'month'
    days: int = Field(default=30, ge=1, le=365, strict=True)
    first_date: date
    notify: bool = False


def advance(day: date, config: dict) -> date:
    if config['period'] == 'custom':
        return day + timedelta(days=config['days'])
    months = {'month': 1, 'quarter': 3, 'half': 6}[config['period']]
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    month += 1
    anchor = date.fromisoformat(config['first_date']).day
    return date(year, month, min(anchor, calendar.monthrange(year, month)[1]))


@contextmanager
def database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with sqlite3.connect(DB_PATH, timeout=10) as db:
        DB_PATH.chmod(0o600)
        db.execute('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)')
        db.execute('INSERT OR IGNORE INTO state VALUES (1, ?)', (json.dumps({'config': None, 'next_date': None, 'running': None, 'report': None, 'error': None}),))
        db.commit()
        db.execute('BEGIN IMMEDIATE')
        yield db


def read(db):
    return json.loads(db.execute('SELECT body FROM state WHERE id=1').fetchone()[0])


def write(db, state):
    db.execute('UPDATE state SET body=? WHERE id=1', (json.dumps(state, ensure_ascii=False),))


def authorize(request):
    from backend.auth_config import mode
    identity = getattr(request.state, 'identity', None)
    if mode() == 'web' and (not identity or identity.get('user_id') != identity.get('owner_user_id')):
        raise HTTPException(403, '전체 연금 점검은 가계 소유자만 사용할 수 있어요.')


@router.get('')
def status(request: Request):
    authorize(request)
    with database() as db:
        state = read(db)
        if state['running'] and (now() - datetime.fromisoformat(state['running'])).total_seconds() > 600:
            state.update(running=None, error='점검이 중단됐어요. 지금 점검하기로 다시 실행해 주세요.')
            write(db, state)
        return state


@router.put('/schedule')
def save_schedule(data: Schedule, request: Request):
    authorize(request)
    if data.enabled and data.first_date < now().date():
        raise HTTPException(422, '첫 점검일은 오늘 이후로 선택해 주세요.')
    if data.notify:
        from tools.telegram import settings
        config = settings()
        if not config['TELEGRAM_BOT_TOKEN'] or not config['TELEGRAM_CHAT_ID']:
            raise HTTPException(409, '텔레그램을 먼저 연결해 주세요.')
        from backend.auth_config import mode
        if mode() == 'web' and request.state.identity['user_id'] != config['TELEGRAM_OWNER_USER_ID']:
            raise HTTPException(403, '텔레그램을 연결한 사용자만 알림을 설정할 수 있어요.')
    with database() as db:
        state = read(db)
        if state['running']:
            raise HTTPException(409, '점검 중이에요. 끝난 뒤 설정을 저장해 주세요.')
        state.update(config=data.model_dump(mode='json'), next_date=data.first_date.isoformat() if data.enabled else None)
        write(db, state)
    return state


def claim(scheduled=False):
    with database() as db:
        state = read(db)
        if state['running']:
            return None
        if scheduled and (not state['config'] or not state['config']['enabled'] or not state['next_date'] or state['next_date'] > now().date().isoformat()):
            return None
        state['running'] = now().isoformat()
        state['error'] = None
        if scheduled:
            day = date.fromisoformat(state['next_date'])
            while day <= now().date():
                day = advance(day, state['config'])
            state['next_date'] = day.isoformat()  # Claim before any external request: never retry notifications automatically.
        write(db, state)
        return state


@router.post('/run', status_code=202)
def run_review(request: Request, tasks: BackgroundTasks):
    authorize(request)
    state = claim()
    if state is None:
        raise HTTPException(409, '이미 점검 중이에요. 잠시 기다려 주세요.')
    tasks.add_task(execute, state, False)
    return state


def household_context():
    from backend import storage, retirement
    dash = storage.dashboard('together')
    family = storage.get_family() or {}
    plan = retirement.get_plan()
    from tools.retirement_report import current_outlook
    return {
        'retirement_outlook': current_outlook(),
        'source': '가계 장부와 은퇴 계획 설정. 연금 잔고와 중복될 수 있으므로 합산 금지.',
        'as_of': dash.get('as_of'),
        'totals': {k: dash[k] for k in ('total', 'debt', 'net', 'retirement', 'cash', 'financial', 'property', 'unclassified')},
        'assets': [{k: a.get(k) for k in ('assetClass', 'pocket', 'amount', 'as_of', 'owner')} for a in dash['assets']],
        'partner_missing': dash['partner_missing'], 'goal_missing': dash['goal_missing'],
        'family': {**{k: family.get(k) for k in ('retirement_age', 'target_amount')},
                   'ages': {k: (family.get(k) or {}).get('age') for k in ('me', 'partner')}},
        'retirement_plan': plan if plan.get('version') else None,
        'plan_caveat': '저장된 계획에도 미입력 기본값이 섞일 수 있어요. 0이나 기본 나이는 확정 사실로 간주하지 않아요.',
        'missing_context': ['손실 감내 수준과 투자 경험', '대출 금리·만기·상환 일정', '확정된 단기 목돈 지출', '실제 생활비·현금성 비상자금 확인', 'ETF 편입종목·통화·환헤지·듀레이션 원문'],
    }


def numeric_evidence(accounts, household):
    lines = []
    labels = {'total': '총자산', 'debt': '부채', 'net': '순자산', 'retirement': '연금 주머니', 'cash': '일반 금융 주머니(현금성 아님)', 'financial': '금융자산', 'property': '부동산', 'unclassified': '미분류 자산'}
    for key, value in (household.get('totals') or {}).items():
        lines.append(f'가계 장부 {labels[key]}: {value:,}원 (표시 단위 {value / 100000000:.2f}억원)')
    for account in accounts:
        for row in (account.get('plan') or {}).get('mix', []):
            lines.append(f"{account['label']} {row['label']}: 현재 {row['current_pct']:.1f}%, 목표 {row['target_pct']:.1f}%")
    # Monetary fields are won in the engine; supply explicit units for text verification.
    won_keys = {'value', 'amount', 'sell', 'buy', 'total_value', 'new_cash', 'reduce_total', 'increase_total', 'leftover', 'monthly_need', 'income', 'need', 'shortfall', 'extra_monthly', 'increase'}
    def monetary(node, path):
        if isinstance(node, dict):
            for key, value in node.items():
                if key in won_keys and isinstance(value, (int, float)) and not isinstance(value, bool):
                    lines.append(f'{path}.{key}: {value:,}원')
                elif isinstance(value, (dict, list)):
                    monetary(value, f'{path}.{key}')
        elif isinstance(node, list):
            for index, value in enumerate(node):
                monetary(value, f'{path}[{index}]')
    monetary(accounts, '계좌')
    monetary(household, '가계')
    assumptions = (household.get('retirement_outlook') or {}).get('assumptions', {})
    for key in ('return_rate', 'inflation'):
        if key in assumptions:
            lines.append(f'은퇴 계산 {key}: {assumptions[key] * 100:g}%')
    return lines


def evidence():
    from backend import workbook
    from backend.plan import build
    from backend.portfolio import SHORT_NAMES, _raw
    from tools.strategy import load_strategy
    data = workbook.RebalanceInput(owner='together', live=False)
    ctx = workbook._context(data)
    strategy_rules = _raw()
    accounts = []
    for pid, pool in ctx['pools'].items():
        ran = workbook.run_pool(data, ctx, pid)
        entry = {'label': pool.get('label', pid), 'strategy': SHORT_NAMES.get(pool.get('strategy'), pool.get('strategy')), 'mode': pool.get('mode', 'rebalance'), 'findings': [], 'comparisons': []}
        accounts.append(entry)
        if ran is None:
            entry['findings'].append('등록한 잔고가 없어 점검할 수 없어요.')
            continue
        base, result, error = ran
        entry['as_of'] = base['as_of']
        dates = [ctx['as_of'].get(a['id']) for a in base['accounts']]
        if not dates or any(not d for d in dates):
            entry['findings'].append('잔고 기준일이 확인되지 않는 계좌가 있어요.')
        elif any(date.fromisoformat(d) < now().date() for d in dates):
            entry['findings'].append('과거에 등록한 잔고예요. 실제 주문 전 최신 잔고와 가격을 확인하세요.')
        if error:
            entry['findings'].append(error)
        if result:
            plan = build(result, base['mode'])
            entry['plan'] = plan
            entry['findings'].append(plan.get('title') or ((plan.get('title_head') or '') + ' ' + (plan.get('title_tail') or '')).strip())
            entry['findings'].extend(result.notes)
            if result.blocked_reason:
                entry['findings'].append(result.blocked_reason)
            if plan['amount_only']:
                entry['findings'].append('종목이나 수량이 미확정인 항목이 있어요. 주문 전에 확인하세요.')
            entry['classes'] = asdict(result)['classes']
            from tools.pension_report_desk import account_exhibits
            entry.update(account_exhibits(pid, pool, ctx, result, strategy_rules.get(pool.get('strategy') or 'all_weather', {})))
        for sid in ('park_gomhee', 'all_weather', 'k_all_weather'):
            alt = {'id': sid, 'name': SHORT_NAMES[sid]}
            entry['comparisons'].append(alt)
            try:
                if not (strategy_rules.get(sid) or {}).get('targets'):
                    alt['error'] = '목표 비율 설정 필요 · 책 근거 확인 전'
                    continue
                load_strategy(sid)
                alt_ctx = {**ctx, 'pools': {**ctx['pools'], pid: {**pool, 'strategy': sid}}}
                _, alt_result, alt_error = workbook.run_pool(data, alt_ctx, pid)
                if alt_error:
                    alt['error'] = alt_error
                else:
                    alt['plan'] = build(alt_result, base['mode'])
            except (ValueError, KeyError):
                alt['error'] = '전략 규칙을 확인해야 해요.'
    try:
        household = household_context()
    except Exception:
        household = {'error': '가계 전체 장부·은퇴 계획을 불러오지 못했어요. 전체 적합성 판단은 보류해야 해요.'}
    from tools.pension_report_desk import RESEARCH, portfolio_exhibit
    portfolio = portfolio_exhibit(accounts)
    portfolio_numbers = [f"전체 연금 {r['label']}: 현재 {r['current_pct']:.1f}%, 목표 {r['target_pct']:.1f}%" for r in portfolio['mix']]
    return {'portfolio': portfolio, 'accounts': accounts, 'research': RESEARCH, 'household': household, 'supplied_numeric_evidence': numeric_evidence(accounts, household) + portfolio_numbers, 'source': '등록 잔고·가계 장부·저장한 은퇴 계획·프로젝트 전략 규칙. 책 원문은 미연결.',
            'scope': '전체 등록 리밸런싱 묶음 · 추가 납입 0원 · 계좌별 운용 방식 유지',
            'limitations': '현재가 조회·시장 전망·수익률 예측·책 원문 검증은 포함하지 않아요.'}


async def explain(facts):
    from tools.report_service import evaluate
    from agent.report_prompt import PROMPT, VERSION, AllocationReport
    return await asyncio.to_thread(evaluate, domain='pension', version=VERSION, prompt=PROMPT, schema=AllocationReport, facts=facts)


def execute(claimed, scheduled):
    report = None
    error = None
    try:
        facts = evidence()
        report = {**facts, 'created_at': now().isoformat(), 'ai_text': None, 'ai_status': 'unavailable', 'ai_provider': 'OpenAI', 'ai_error': None, 'notification': None}
        try:
            from agent.report_prompt import VERSION
            result = asyncio.run(asyncio.wait_for(explain(facts), timeout=120))
            if isinstance(result, tuple):
                result, metadata = result
                report['generation'] = metadata
            report['prompt_version'] = VERSION
            report['ai_report'] = result if isinstance(result, dict) else None
            report['ai_text'] = (result['headline'] + '\n\n' + result['summary']) if isinstance(result, dict) else result
            report['ai_status'] = 'ready'
        except Exception as exc:
            from tools.report_ai import ReportAIError
            report['ai_status'] = 'unavailable'
            report['ai_error'] = str(exc) if isinstance(exc, ReportAIError) else 'GPT 설명을 완료하지 못했어요. 잠시 뒤 다시 점검해 주세요.'
        if scheduled and (claimed.get('config') or {}).get('notify'):
            from tools.telegram import send_message, TelegramError
            lines = ['둘이서은퇴 · 연금 종합 점검', now().date().isoformat(), facts['scope']]
            for account in facts['accounts']:
                lines.extend(['', account['label'], *account['findings'][:2]])
            lines.extend(['', (report['ai_text'] or 'AI 설명을 완료하지 못했어요. 화면에서 계산 결과를 확인하세요.')[:1600], '', '등록 자료 기준 · 실제 주문은 실행하지 않았어요.'])
            text = '\n'.join(lines)
            try:
                if len(text.encode('utf-16-le')) // 2 > 4000:
                    text = '둘이서은퇴 · 연금 종합 점검을 완료했어요. 전체 보고서는 리밸런싱 화면에서 확인해 주세요.'
                send_message(text)
                report['notification'] = '텔레그램 요약을 보냈어요.'
            except TelegramError:
                report['notification'] = '알림 결과를 확인하지 못했어요. 텔레그램을 확인해 주세요. 자동 재전송하지 않아요.'
    except Exception:
        error = '점검 자료를 불러오지 못했어요. 잔고와 전략 설정을 확인한 뒤 다시 실행해 주세요.'
    with database() as db:
        state = read(db)
        if state['running'] != claimed['running']:
            return
        state.update(running=None, error=error)
        if report:
            state['report'] = report
        write(db, state)


async def scheduler():
    while True:
        try:
            # Reconcile interrupted work after restart; failed due dates are not replayed.
            with database() as db:
                state = read(db)
                if state['running'] and (now() - datetime.fromisoformat(state['running'])).total_seconds() > 600:
                    state.update(running=None, error='이전 점검이 중단됐어요. 지금 점검하기로 다시 실행해 주세요.')
                    write(db, state)
            claimed = claim(scheduled=True)
            if claimed:
                await asyncio.to_thread(execute, claimed, True)
        except Exception:
            pass  # Keep scheduler alive without logging financial inputs/credentials.
        await asyncio.sleep(60)
