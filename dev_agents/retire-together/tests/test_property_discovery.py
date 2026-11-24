import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend import property_discovery as d
from tools.property_discovery import shortlist

PIR = dict(annual_me=120000000, annual_partner=120000000, lower=10, upper=15)

def trade(name='새 단지', price=2400000000, area=84.9, **kw):
    return dict(name=name, price=price, area=area, date='2026-11-01', floor=10,
                sigungu='11680', district='강남구', dong='대치동', jibun='100', **kw)

def test_shortlist_upgrades_with_income_price_range():
    rows=[trade(),trade('작은 단지',1900000000),trade('상한 초과',3700000000),trade('대형',3000000000,140)]
    items,total=shortlist(rows,[],net=2000000000,pir=PIR,area_min=50,area_max=90,limit=8,home_value=2000000000)
    assert total==1
    assert items[0]['name']=='새 단지' and items[0]['funding']['needed']==400000000
    assert items[0]['pir']['status']=='within'
    saved=[{'name':'별칭','address':{'sigungu_code':'11680','jibun':'서울특별시 강남구 대치동 100'},'members':[]}]
    assert shortlist(rows,saved,net=0,pir=PIR,area_min=50,area_max=90,limit=8)[0]==[]

@pytest.fixture
def setup(monkeypatch, tmp_path):
    monkeypatch.setattr(d.property_research_cache, "CACHE_PATH", tmp_path / "research.sqlite3")
    from backend import property_place
    monkeypatch.setattr(property_place,'vworld_key',lambda:None)
    monkeypatch.setattr(d.prop,'list_homes',lambda owner:{'homes':[{'asset':{'id':'home','name':'기준 집'},'detail':{'tenure':'live'},'full_value':2000000000,'basis':{'kind':'trade','date':'2026-10-01'}}]})
    monkeypatch.setattr(d,'web_research',lambda q:{'text':'테스트 공개 근거','sources':[{'title':'공식 자료','url':'https://www.k-apt.go.kr/complex/1'}]})
    monkeypatch.setattr(d,'read_plan',lambda owner: {'pir':PIR,'candidates':[]})
    monkeypatch.setattr(d,'_capital',lambda owner: {'net':2000000000,'valuation_missing':False})
    monkeypatch.setattr(d.prop,'market_key',lambda:'fake')
    monkeypatch.setattr(d,'load_watch_rules',lambda:{'discovery':{'districts':{'11680':'강남구'},'months':1,'area_min':50,'area_max':90,'limit':8}})
    monkeypatch.setattr(d.prop,'_month_trades',lambda *args:[trade()])
    return TestClient(app, base_url="http://127.0.0.1", headers={"Origin":"http://127.0.0.1", "X-Retire-Local":"1"})

def test_endpoint_ai_grounded_and_addable(setup,monkeypatch):
    def generate(instructions,source,schema):
        facts=json.loads(source)
        assert 'annual_me' not in source and 'OPENAI_API_KEY' not in source
        return json.dumps({'items':[{'id':i['id'],'reason':'설정한 소득 범위 안이에요.','check':'같은 면적 매물 가격을 확인하세요.'} for i in facts['candidates']]})
    monkeypatch.setattr(d.report_ai,'generate',generate)
    r=setup.post('/api/property-move/discover').json()
    assert r['ai_status']=='insufficient' and r['items'][0]['funding']['needed']==400000000
    from backend.property_move import Candidate
    Candidate(**r['items'][0]['candidate'])

def test_failure_keeps_calculated_candidates(setup,monkeypatch):
    monkeypatch.setattr(d.report_ai,'generate',lambda *args: '{"items":[{"id":"invented","reason":"x","check":"x"}]}')
    r=setup.post('/api/property-move/discover').json()
    assert r['ai_status']=='unavailable' and 'reason' not in r['items'][0]
    assert r['items'][0]['candidate']['name']=='새 단지'

def test_missing_home_blocks_external_calls(setup,monkeypatch):
    monkeypatch.setattr(d.prop,'list_homes',lambda owner:{'homes':[]})
    monkeypatch.setattr(d.prop,'_month_trades',lambda *args:pytest.fail('must not call'))
    assert setup.post('/api/property-move/discover').status_code==422

def test_all_sources_fail(setup,monkeypatch):
    def fail(*args):raise RuntimeError('private response')
    monkeypatch.setattr(d.prop,'_month_trades',fail)
    response=setup.post('/api/property-move/discover')
    assert response.status_code==503 and 'private' not in response.text


def test_district_fetch_reads_all_pages(monkeypatch):
    from backend import property as prop
    import requests
    calls=[]
    class Response:
        status_code=200
        def __init__(self,page):
            self.text=f'<response><header><resultCode>00</resultCode></header><body><totalCount>1001</totalCount><items><item><aptNm>단지{page}</aptNm><dealAmount>100,000</dealAmount><excluUseAr>84</excluUseAr><dealYear>2026</dealYear><dealMonth>1</dealMonth><dealDay>1</dealDay><umdNm>대치동</umdNm><jibun>1</jibun></item></items></body></response>'
        def raise_for_status(self):pass
    def get(url,params,timeout):
        calls.append(params['pageNo']);return Response(params['pageNo'])
    monkeypatch.setattr(requests,'get',get)
    monkeypatch.setattr(prop,'_cache',{})
    rows=prop._month_trades('11680','202601','fake')
    assert calls==[1,2] and len(rows)==2


def test_relative_value_requires_same_month_area_age_and_peer_sample():
    rows=[trade('후보',2400000000,build_year=2005),
          trade('비교1',3000000000,build_year=2006),
          trade('비교2',3100000000,build_year=2007),
          trade('비교3',3200000000,build_year=2008),
          trade('신축',4000000000,build_year=2025)]
    items,_=shortlist(rows,[],net=2000000000,pir=PIR,area_min=50,area_max=90,limit=8,home_value=2200000000)
    assert items[0]['name']=='후보'
    assert items[0]['relative']['median']==3100000000
    assert items[0]['relative']['peer_count']==3
    assert items[0]['relative']['discount_pct']==22.6
    sparse,_=shortlist(rows[:3],[],net=2000000000,pir=PIR,area_min=50,area_max=90,limit=8,home_value=2200000000)
    assert all(i['relative']['median'] is None for i in sparse)


def test_rejects_invented_citations(setup,monkeypatch):
    def generate(instructions,source,schema):
        i=json.loads(source)['candidates'][0]
        return json.dumps({'items':[{'id':i['id'],'reason':'이유','check':'확인','pros':[{'text':'최고 학군','source_url':'https://invented.invalid/','kind':'공식','date':'미확인'}],'cons':[],'popularity':[]}]})
    monkeypatch.setattr(d.report_ai,'generate',generate)
    r=setup.post('/api/property-move/discover').json()
    assert r['ai_status']=='insufficient' and r['items'][0]['pros']==[]


def test_heatmap_keeps_missing_months_unknown():
    from datetime import date
    from tools.property_watch import research_snapshot
    c={'id':'one','name':'단지','area_m2':84}
    watch={'configured':True,'watch':[{'id':'one','summary':{'areas':[{'area':84,'monthly':[{'month':'2026-08','count':2,'median':100},{'month':'2026-10','count':1,'median':130},{'month':'2026-11','count':2,'median':143}],'latest':None}]}}]}
    result=research_snapshot([c],watch,today=date(2026,11,19))
    cells={x['month']:x for x in result['heatmap']['rows'][0]['cells']}
    assert cells['2026-09']['count']==0 and cells['2026-10']['change_pct'] is None
    assert cells['2026-11']['change_pct']==10.0


def test_expert_feed_uses_selected_sources(setup,monkeypatch):
    queries=[]
    def search(query):
        queries.append(query);return {'text':'기간 내 확인된 글 없음','sources':[{'url':'https://example.org','title':'원문'}]}
    monkeypatch.setattr(d,'web_research',search)
    r=setup.post('/api/property-move/expert-news',json={'sources':['빠숑 김학렬'],'days':7,'candidate':'테스트단지'})
    assert r.status_code==200 and '빠숑 김학렬' in queries[0] and '테스트단지' in queries[0]
    assert setup.post('/api/property-move/expert-news',json={'sources':[]}).status_code==422


def test_claim_requires_matching_research_quote(setup,monkeypatch):
    monkeypatch.setattr(d,'web_research',lambda q:{'text':'테스트단지는 500세대로 구성되어 있습니다.','sources':[{'title':'단지 상세','url':'https://example.org/complex/1'}]})
    def generate(instructions,source,schema):
        i=json.loads(source)['candidates'][0]
        return json.dumps({'items':[{'id':i['id'],'reason':'비교 후보','check':'현장 확인','pros':[{'text':'500세대 규모입니다.','source_url':'https://example.org/complex/1','kind':'공식','date':'미확인','evidence_quote':'테스트단지는 500세대로 구성되어 있습니다.'}],'cons':[],'popularity':[]}]})
    monkeypatch.setattr(d.report_ai,'generate',generate)
    r=setup.post('/api/property-move/discover').json()
    assert r['ai_status']=='partial' and len(r['items'][0]['pros'])==1
    monkeypatch.setattr(d,'web_research',lambda q:{'text':'해당 내용 없음','sources':[{'title':'단지 상세','url':'https://example.org/complex/1'}]})
    assert setup.post('/api/property-move/discover?refresh=true').json()['ai_status']=='insufficient'


def test_search_failure_is_visible_and_skips_paid_summary(setup, monkeypatch):
    def fail(query):
        raise d.report_ai.ReportAIError('OpenAI 사용 한도에 도달했습니다.')
    monkeypatch.setattr(d, 'web_research', fail)
    monkeypatch.setattr(d.report_ai, 'generate', lambda *args: pytest.fail('no sources: no paid summary'))
    result = setup.post('/api/property-move/discover').json()
    assert result['ai_status'] == 'unavailable'
    assert '사용 한도' in result['ai_error']
    assert result['research_failures'][0]['name'] == '새 단지'
    assert result['items'][0]['candidate']['name'] == '새 단지'


def test_research_requests_are_read_only_in_shared_workspace():
    from backend.shared_workspace import mutates
    assert not mutates('POST', '/api/property-move/discover')
    assert not mutates('POST', '/api/property-move/expert-news')
    assert mutates('PUT', '/api/property-move')


def test_candidates_return_before_any_ai_call(setup,monkeypatch):
    monkeypatch.setattr(d,'web_research',lambda *args:pytest.fail('preview must not call paid research'))
    monkeypatch.setattr(d.report_ai,'generate',lambda *args:pytest.fail('preview must not call paid summary'))
    response=setup.post('/api/property-move/discover?analyze=false')
    assert response.status_code==200
    result=response.json()
    assert result['ai_status']=='pending'
    assert result['items'][0]['candidate']['name']=='새 단지'


def test_budget_fit_selects_three_distinct_complexes_per_district():
    rows=[]
    for code,district in [('11680','강남구'),('11650','서초구')]:
        for i in range(5):
            r=trade(name=f'{district}{i}',price=2100000000+i*100000000)
            r.update(sigungu=code,district=district,jibun=str(i))
            rows.append(r)
    items,total=shortlist(rows,[],net=2300000000,pir=dict(PIR,lower=1),area_min=50,area_max=90,limit=6,home_value=2000000000,per_district=3,ranking='budget_fit')
    assert total==10 and len(items)==6
    for district in ['강남구','서초구']:
        group=[i for i in items if i['district']==district]
        assert len(group)==3 and group[0]['price']==2300000000

def test_sentiment_is_read_only_and_requires_a_known_topic(setup,monkeypatch):
    queries=[]
    monkeypatch.setattr(d,'web_research',lambda query: queries.append(query) or {'text':'공시 확인','sources':[]})
    response=setup.post('/api/property-move/sentiment',json={'topic':'jeonse'})
    assert response.status_code==200 and '전세자금대출' in queries[0]
    assert '관측기간' in queries[0] and '신규 대출 없이' in queries[0]
    assert setup.post('/api/property-move/sentiment',json={'topic':'unknown'}).status_code==422
    from backend.shared_workspace import mutates
    assert not mutates('POST','/api/property-move/sentiment')


def test_price_first_stays_in_pir_range_beyond_current_capital():
    rows=[]
    for code,district in [('11680','강남구'),('11650','서초구')]:
        for i,price in enumerate([2280000000,2500000000,3000000000,3600000000,4200000000]):
            row=trade(name=f'{district}{i}',price=price)
            row.update(sigungu=code,district=district,jibun=str(i))
            rows.append(row)
    for net in [2190000000,2400000000]:
        items,total=shortlist(rows,[],net=net,pir=PIR,area_min=50,area_max=90,limit=6,home_value=2250000000,per_district=3,ranking='price_high')
        assert total==6
        for district in ['강남구','서초구']:
            assert [i['price'] for i in items if i['district']==district]==[3600000000,3000000000,2500000000]
        assert items[0]['pir']['status']=='within'
        assert items[0]['funding']['needed']==3600000000-net


def test_spotlight_requires_comparable_peers_positive_discount_and_trades():
    from tools.property_discovery import mark_spotlights
    def item(name,district,discount,count=3,peers=3):
        return dict(name=name,district=district,count=count,relative=dict(discount_pct=discount,peer_count=peers))
    items=[item('A','강남구',5),item('B','강남구',10),item('C','강남구',30,count=1),
           item('D','서초구',None,peers=0),item('E','송파구',-5)]
    result=mark_spotlights(items,min_trades=3,min_peers=3)
    assert [i['name'] for i in result if i['spotlight']]==['B']


def test_rules_include_songpa_and_price_first():
    from tools.property_watch import load_watch_rules
    rules=load_watch_rules()['discovery']
    assert rules['districts']['11710']=='송파구'
    assert rules['limit']==rules['per_district']*len(rules['districts'])
    assert rules['ranking']=='price_high'


def test_missing_income_rejects_before_fetch(setup,monkeypatch):
    monkeypatch.setattr(d,'read_plan',lambda owner:{'pir':dict(PIR,annual_me=None),'candidates':[]})
    monkeypatch.setattr(d.prop,'_month_trades',lambda *args:pytest.fail('must not fetch'))
    assert setup.post('/api/property-move/discover?analyze=false').status_code==422


def test_cached_public_analysis_skips_paid_calls(setup, monkeypatch):
    first = setup.post('/api/property-move/discover?analyze=false').json()['items'][0]
    first['pros'] = [{'text': '공식 자료 확인', 'source_url': 'https://example.org/complex', 'kind': '공식', 'date': '2026-11-01'}]
    d.property_research_cache.write(first)
    def forbidden(*args, **kwargs):
        raise AssertionError('cached analysis must not call AI')
    monkeypatch.setattr(d, 'web_research', forbidden)
    monkeypatch.setattr(d.report_ai, 'generate', forbidden)
    for suffix in ('', '?analyze=false'):
        response = setup.post('/api/property-move/discover' + suffix)
        assert response.status_code == 200
        data = response.json()
        assert data['ai_status'] == 'cached'
        assert data['cached_count'] == 1
        assert data['items'][0]['pros'] == first['pros']
        assert data['items'][0]['funding']['needed'] == 400000000


def test_public_analysis_cache_expiry_identity_and_private_fields(tmp_path, monkeypatch):
    import datetime as dt
    cache = d.property_research_cache
    monkeypatch.setattr(cache, 'CACHE_PATH', tmp_path / 'cache.sqlite3')
    item = {**trade(), 'pros': [{'text': '검증된 근거'}], 'funding': {'needed': 999}, 'pir': PIR}
    day = dt.date(2026, 11, 1)
    cache.write(item, today=day)
    saved = cache.read(item, 7, today=day + dt.timedelta(days=6))
    assert saved and set(saved) == {'pros', 'cons', 'popularity', 'analysis_date'}
    assert cache.read(item, 7, today=day + dt.timedelta(days=7)) is None
    assert cache.read({**item, 'area': 59}, 7, today=day) is None
    cache.write({**item, 'pros': []}, today=day)
    assert cache.read(item, 7, today=day)['pros']


def test_household_count_requires_matching_citation_and_number():
    from tools.property_research_cache import verified_households
    source = {'text': '테스트 아파트 전체 1,234세대 규모입니다.', 'sources': [{'url': 'https://example.com/complex/1'}]}
    fact = {'count': 1234, 'source_url': source['sources'][0]['url'], 'evidence_quote': source['text']}
    assert verified_households(fact, source) == fact
    assert verified_households({**fact, 'count': 123}, source) is None
    assert verified_households({**fact, 'source_url': 'https://example.com/other'}, source) is None
    assert verified_households({**fact, 'evidence_quote': '다른 단지는 1,234세대입니다.'}, source) is None


@pytest.mark.parametrize('year, expected', [(2008,18),(2026,0),(2027,None),(None,None),(0,None)])
def test_building_age(year, expected):
    from tools.property_discovery import building_age
    assert building_age(year, 2026) == expected
