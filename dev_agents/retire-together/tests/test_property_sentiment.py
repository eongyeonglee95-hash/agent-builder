import datetime as dt
import pytest
from tools import property_sentiment as s

@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv('RETIRE_SENTIMENT_DB', str(tmp_path / 'sentiment.sqlite3'))


def insert(day, value, frequency='weekly'):
    with s.connection() as db:
        db.execute('INSERT INTO observations VALUES (?,?,?,?,?,?,?,?)', ('kb_buy','서울',frequency,day,value,None,'2026-11-20T00:00:00+00:00',s.KB_PAGE))


def test_missing_period_is_not_zero_or_bridged():
    insert('2026-10-26', 70)
    insert('2026-11-09', 80)
    insert('2026-11-16', 82)
    row = s.dashboard('weekly', dt.date(2026,11,20),'서울')['items'][0]
    assert row['cells'][-1]['delta'] == 2
    assert row['cells'][-2]['delta'] is None
    assert row['cells'][-3]['value'] is None


def test_daily_does_not_turn_weekly_observations_into_daily_changes():
    insert('2026-11-16', 82)
    row = s.dashboard('daily',dt.date(2026,11,20),'서울')['items'][0]
    assert row['latest']['value'] == 82
    assert all(c['value'] is None for c in row['cells'])


def test_monthly_uses_monthly_series_and_handles_year_boundary():
    insert('2026-10-31',75,'monthly')
    insert('2026-10-26',99)
    row=s.dashboard('monthly',dt.date(2026,10,31),'서울')['items'][0]
    assert row['cells'][-1]['value']==75
    assert s.shift(dt.date(2026,1,1),'monthly',-1)==dt.date(2025,12,1)
    assert s.bounds(dt.date(2024,2,10),'monthly')[1]==dt.date(2024,2,29)


def test_kb_parser_keeps_zero_and_rejects_invalid_values():
    payload={'dataBody':{'resultCode':11000,'data':{'날짜리스트':['20261109','20261116'],'데이터리스트':[{'지역명':'서울','dataList':[{'매수우위지수':0},{'매수우위지수':None}]}]}}}
    rows=s.parse_kb(payload,s.METRICS[0],'weekly','2026-11-20T00:00:00+00:00')
    assert len(rows)==1 and rows[0][4]==0
    payload['dataBody']['data']['데이터리스트'][0]['dataList'][0]['매수우위지수']='NaN'
    with pytest.raises(ValueError): s.parse_kb(payload,s.METRICS[0],'weekly','2026-11-20T00:00:00+00:00')


def test_failed_refresh_preserves_history_and_records_failure(monkeypatch):
    insert('2026-11-16',82)
    def fail(*args,**kwargs): raise s.requests.ConnectionError('offline')
    monkeypatch.setattr(s.requests,'get',fail)
    s.refresh('weekly')
    result=s.dashboard('weekly',dt.date(2026,11,20),'서울')
    assert result['items'][0]['latest']['value']==82
    assert result['collection']['error']
    assert not s.needs_refresh('weekly')


def test_history_excludes_future_observations_and_other_regions():
    insert('2026-11-09',80)
    insert('2026-11-16',82)
    result=s.dashboard('weekly',dt.date(2026,11,9),'서울')
    assert result['items'][0]['latest']['value']==80
    assert s.dashboard('weekly',dt.date(2026,11,20),'전국')['items'][0]['latest'] is None
