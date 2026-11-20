"""User-reported fills and holds; append-only journal, never broker execution or balances."""
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
import json
import sqlite3
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo
from fastapi import APIRouter, HTTPException, Query
from pydantic import Field, model_validator
from backend.storage import InputModel
from backend import registration
from tools.assets import load_accounts, load_pools

router = APIRouter(prefix='/api/workbook/journal', tags=['trade-journal'])
DB_PATH = Path(__file__).resolve().parents[1] / 'data/local/trade-journal.sqlite3'
TZ = ZoneInfo('Asia/Seoul')

class Entry(InputModel):
    request_id: UUID
    pool_id: str = Field(min_length=1,max_length=80)
    kind: Literal['trade','hold']
    event_date: date
    account_id: str | None = None
    side: Literal['매수','매도'] | None = None
    ticker: str = Field(default='',max_length=30)
    name: str = Field(default='',max_length=100)
    qty: int | None = Field(default=None,strict=True,ge=1,le=100000000)
    price: int | None = Field(default=None,strict=True,ge=1,le=1000000000)
    note: str = Field(default='',max_length=500)

    @model_validator(mode='after')
    def validate_entry(self):
        if self.event_date > datetime.now(TZ).date():
            raise ValueError('미래 날짜로 기록할 수 없어요.')
        if self.kind == 'trade' and not all((self.account_id,self.side,self.ticker,self.name,self.qty,self.price)):
            raise ValueError('실제 체결 계좌·종목·수량·가격을 입력해 주세요.')
        if self.kind == 'hold' and (not self.note or any((self.account_id,self.side,self.ticker,self.name,self.qty,self.price))):
            raise ValueError('보류는 사유만 입력해 주세요.')
        return self

@contextmanager
def database():
    from tools.data_context import resolve
    path = resolve("trade-journal.sqlite3", DB_PATH)
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    with sqlite3.connect(path,timeout=10) as db:
        path.chmod(0o600)
        db.execute('CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, pool_id TEXT NOT NULL, event_date TEXT NOT NULL, recorded_at TEXT NOT NULL, input TEXT NOT NULL, body TEXT NOT NULL)')
        yield db

def pool_config(pool_id):
    pools=load_pools(registration.accounts_path())
    if pool_id not in pools: raise HTTPException(404,'이 계좌 묶음을 찾지 못했어요.')
    return pools[pool_id]

@router.post('')
def create(data: Entry):
    pool=pool_config(data.pool_id)
    payload=data.model_dump(mode='json')
    fingerprint=json.dumps(payload,sort_keys=True,ensure_ascii=False)
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        existing=db.execute('SELECT input,body FROM entries WHERE id=?',(str(data.request_id),)).fetchone()
        if existing:
            if existing[0]!=fingerprint: raise HTTPException(409,'이 요청은 다른 내용으로 이미 저장됐어요. 기록을 확인해 주세요.')
            return json.loads(existing[1])
        accounts=load_accounts(registration.accounts_path())
        if data.kind=='trade' and (data.account_id not in pool.get('accounts',[]) or data.account_id not in accounts):
            raise HTTPException(422,'이 묶음에 포함된 계좌를 선택해 주세요.')
        record={**payload,'id':str(data.request_id),'pool_label':pool.get('label',data.pool_id),
                'account_label':accounts[data.account_id].get('label',data.account_id) if data.account_id else None,
                'amount':data.qty*data.price if data.kind=='trade' else None,
                'recorded_at':datetime.now(TZ).isoformat(), 'status':'체결 기록' if data.kind=='trade' else '보류'}
        db.execute('INSERT INTO entries VALUES (?,?,?,?,?,?)',(record['id'],data.pool_id,data.event_date.isoformat(),record['recorded_at'],fingerprint,json.dumps(record,ensure_ascii=False)))
    return record

@router.get('')
def history(pool_id: str, offset: Annotated[int,Query(ge=0)]=0):
    pool_config(pool_id)
    with database() as db:
        rows=db.execute('SELECT body FROM entries WHERE pool_id=? ORDER BY event_date DESC,recorded_at DESC,id DESC LIMIT 51 OFFSET ?',(pool_id,offset)).fetchall()
    return {'entries':[json.loads(r[0]) for r in rows[:50]],'next_offset':offset+50 if len(rows)>50 else None}
