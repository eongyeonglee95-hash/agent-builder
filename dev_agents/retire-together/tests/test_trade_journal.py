from datetime import date,timedelta
from uuid import uuid4
import pytest
from pydantic import ValidationError
from fastapi import HTTPException
from backend import trade_journal as journal

@pytest.fixture(autouse=True)
def isolated(tmp_path,monkeypatch):
    monkeypatch.setattr(journal,'DB_PATH',tmp_path/'journal.sqlite3')
    monkeypatch.setattr(journal,'load_pools',lambda path:{'p':{'label':'연금','accounts':['a']}})
    monkeypatch.setattr(journal,'load_accounts',lambda path:{'a':{'label':'계좌'},'other':{'label':'다른 계좌'}})


def trade(**kwargs):
    return journal.Entry(request_id=uuid4(),pool_id='p',kind='trade',event_date='2026-01-02',account_id='a',side='매수',ticker='123456',name='종목',qty=2,price=12345,**kwargs)


def test_amount_dates_and_idempotence():
    data=trade()
    result=journal.create(data)
    assert result['amount']==24690 and result['event_date']=='2026-01-02'
    assert result['recorded_at'].endswith('+09:00')
    assert journal.create(data)==result
    assert len(journal.history('p')['entries'])==1
    assert result['status']=='체결 기록'


def test_reused_id_with_other_payload_rejected():
    data=trade();journal.create(data)
    with pytest.raises(HTTPException) as error:
        journal.create(data.model_copy(update={'qty':3}))
    assert error.value.status_code==409


def test_cross_pool_account_rejected():
    with pytest.raises(HTTPException) as error:
        journal.create(trade().model_copy(update={'account_id':'other'}))
    assert error.value.status_code==422


def test_actual_fill_required_and_future_date_rejected():
    data=trade().model_dump()
    for change in [{'qty':0},{'price':None},{'qty':1.5},{'event_date':date.today()+timedelta(days=2)},{'name':''}]:
        with pytest.raises(ValidationError): journal.Entry(**{**data,**change})


def test_hold_and_trade_date_sorting():
    journal.create(trade())
    hold=journal.Entry(request_id=uuid4(),pool_id='p',kind='hold',event_date='2026-01-01',note='잔고 확인')
    journal.create(hold)
    rows=journal.history('p')['entries']
    assert [r['kind'] for r in rows]==['trade','hold']
    assert rows[1]['amount'] is None
    with pytest.raises(ValidationError): journal.Entry(**{**hold.model_dump(),'qty':1})


def test_partial_fills_remain_separate_and_no_plan_completion():
    journal.create(trade());journal.create(trade())
    rows=journal.history('p')['entries']
    assert len(rows)==2
    assert all(r['status']=='체결 기록' for r in rows)
