"""Layer-four schedules and user-confirmed payments, separate from asset valuations."""
import calendar
from datetime import date, datetime
import json
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo
from fastapi import APIRouter, HTTPException
from pydantic import Field, model_validator
from backend import storage, registration
from backend.storage import InputModel
from tools.assets import load_accounts

router = APIRouter(prefix='/additional-pensions', tags=['additional-pensions'])


def today():
    return datetime.now(ZoneInfo('Asia/Seoul')).date()


def asset(asset_id):
    from backend.retirement import layer_of
    accounts = load_accounts(registration.accounts_path())
    found = next((a for a in storage.dashboard('together')['assets'] if a['id'] == asset_id), None)
    if not found or found.get('pocket') != 'retirement' or layer_of(found, accounts) != 4:
        raise HTTPException(404, '등록된 4층 추가연금을 찾지 못했어요.')
    return found


def tables(db):
    db.executescript('''CREATE TABLE IF NOT EXISTS additional_pension_plans (asset_id TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS additional_pension_payments (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, body TEXT NOT NULL, recorded_at TEXT NOT NULL);''')


class Plan(InputModel):
    version: int = Field(ge=0, strict=True)
    monthly: int | None = Field(default=None, ge=0, le=10**10, strict=True)
    day: int | None = Field(default=None, ge=1, le=31, strict=True)
    end_date: date | None = None
    payout_date: date | None = None
    expected_monthly: int | None = Field(default=None, ge=0, le=10**10, strict=True)
    status: Literal['active', 'paused', 'complete'] = 'active'
    note: str = Field(default='', max_length=1000)


class Payment(InputModel):
    request_id: UUID
    event_date: date
    amount: int = Field(ge=1, le=10**10, strict=True)
    note: str = Field(default='', max_length=500)

    @model_validator(mode='after')
    def past_date(self):
        if self.event_date > today():
            raise ValueError('납입한 날짜는 오늘 이전으로 입력해 주세요.')
        return self


def next_date(plan, now):
    if not plan.get('day') or plan.get('status', 'active') != 'active':
        return None
    year, month = now.year, now.month
    due = date(year, month, min(plan['day'], calendar.monthrange(year, month)[1]))
    if due < now:
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        due = date(year, month, min(plan['day'], calendar.monthrange(year, month)[1]))
    if plan.get('end_date') and due.isoformat() > plan['end_date']:
        return None
    return due.isoformat()


@router.get('/{asset_id}')
def read(asset_id: UUID):
    aid = str(asset_id)
    asset(aid)
    with storage.connection() as db:
        tables(db)
        row = db.execute('SELECT body,version FROM additional_pension_plans WHERE asset_id=?', (aid,)).fetchone()
        plan = {**json.loads(row['body']), 'version': row['version']} if row else Plan(version=0).model_dump(mode='json')
        rows = db.execute('SELECT body,recorded_at FROM additional_pension_payments WHERE asset_id=? ORDER BY json_extract(body,\'$.event_date\') DESC,recorded_at DESC LIMIT 100', (aid,)).fetchall()
    return {'plan': plan, 'next_date': next_date(plan, today()),
            'entries': [{**json.loads(r['body']), 'recorded_at': r['recorded_at']} for r in rows]}


@router.put('/{asset_id}')
def save(asset_id: UUID, data: Plan):
    aid = str(asset_id)
    asset(aid)
    with storage.connection() as db:
        tables(db)
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT version FROM additional_pension_plans WHERE asset_id=?', (aid,)).fetchone()
        version = row['version'] if row else 0
        if data.version != version:
            raise HTTPException(409, '다른 곳에서 납입 정보가 변경됐어요. 닫았다가 다시 열어 주세요.')
        body = data.model_dump(mode='json', exclude={'version'})
        db.execute('INSERT INTO additional_pension_plans VALUES (?,?,?) ON CONFLICT(asset_id) DO UPDATE SET body=excluded.body,version=excluded.version', (aid, json.dumps(body, ensure_ascii=False), version + 1))
    return {'saved': True}


@router.post('/{asset_id}/payments')
def record(asset_id: UUID, data: Payment):
    aid = str(asset_id)
    asset(aid)
    body = json.dumps(data.model_dump(mode='json'), sort_keys=True, ensure_ascii=False)
    with storage.connection() as db:
        tables(db)
        db.execute('BEGIN IMMEDIATE')
        existing = db.execute('SELECT asset_id,body FROM additional_pension_payments WHERE id=?', (str(data.request_id),)).fetchone()
        if existing:
            if existing['asset_id'] != aid or existing['body'] != body:
                raise HTTPException(409, '이미 저장한 요청과 내용이 달라요. 납입 기록을 확인해 주세요.')
        else:
            db.execute('INSERT INTO additional_pension_payments VALUES (?,?,?,?)', (str(data.request_id), aid, body, datetime.now(ZoneInfo('Asia/Seoul')).isoformat()))
    return {'saved': True}
