"""관심 단지 추적: 여러 차수 묶음 매칭과 기준 요약. 외부 조회 없음."""
from tools.property_watch import group_trades, load_watch_rules, summarize


def row(name, dong, jibun, area, price, date, floor=5):
    return {"name": name, "dong": dong, "jibun": jibun, "area": area, "price": price, "date": date, "floor": floor}


ROWS = [
    row("장미1", "신천동", "7", 82.45, 3_475_000_000, "2026-08-29"),
    row("장미2", "신천동", "11", 82.45, 3_400_000_000, "2026-09-10"),
    row("장미3", "신천동", "11", 71.0, 2_900_000_000, "2026-07-01"),
    row("장미아파트", "잠실동", "11", 84.0, 9_999, "2026-09-01"),          # 다른 동 같은 번지
    row("개포주공6단지", "개포동", "185", 60.13, 3_020_000_000, "2026-10-01"),
    row("개포주공7단지", "개포동", "185", 60.0, 3_100_000_000, "2026-10-02"),  # 같은 필지, 다른 단지
]


def test_group_unions_members_and_filters_by_name_on_shared_parcel():
    jangmi = group_trades(ROWS, [{"name": "장미1", "jibun": "서울특별시 송파구 신천동 7"},
                                 {"name": "장미2", "jibun": "서울특별시 송파구 신천동 11"},
                                 {"name": "장미3", "jibun": "서울특별시 송파구 신천동 11"}])
    assert [r["name"] for r in jangmi] == ["장미2", "장미1", "장미3"]          # 최근 것부터, 다른 동 제외
    gaepo = group_trades(ROWS, [{"name": "개포주공6단지", "jibun": "서울특별시 강남구 개포동 185"}])
    assert [r["name"] for r in gaepo] == ["개포주공6단지"]


def test_member_without_name_takes_whole_parcel():
    both = group_trades(ROWS, [{"name": "", "jibun": "서울특별시 강남구 개포동 185"}])
    assert {r["name"] for r in both} == {"개포주공6단지", "개포주공7단지"}


def test_summary_excludes_large_units_and_groups_by_area():
    rows = [row("A", "x", "1", 84.9, 3_000_000_000, "2026-10-01"), row("A", "x", "1", 84.5, 2_800_000_000, "2026-09-01"),
            row("A", "x", "1", 84.7, 2_900_000_000, "2026-08-01"), row("A", "x", "1", 59.9, 2_000_000_000, "2026-10-05"),
            row("A", "x", "1", 135.1, 7_000_000_000, "2026-10-09"), row("A", "x", "1", 135.0, 5_000_000_000, "2026-07-09")]
    s = summarize(rows, large_area_m2=135)
    assert s["count"] == 5 and s["excluded_large"] == 1                    # 135.0은 포함, 135.1은 제외
    by = {g["area"]: g for g in s["areas"]}
    assert set(by) == {59, 84, 135}
    assert by[84]["count"] == 3 and by[84]["median"] == 2_900_000_000
    assert by[84]["latest"] == {"price": 3_000_000_000, "date": "2026-10-01", "area": 84.9, "floor": 5}
    assert by[59]["median"] == 2_000_000_000


def test_summary_even_median_and_empty():
    rows = [row("A", "x", "1", 84, 10, "2026-01-01"), row("A", "x", "1", 84, 20, "2026-02-01")]
    assert summarize(rows, large_area_m2=135)["areas"][0]["median"] == 15
    assert summarize([], large_area_m2=135) == {"count": 0, "excluded_large": 0, "areas": []}


def test_rules_file_has_large_area_threshold():
    rules = load_watch_rules()
    assert rules["large_area_m2"] == 135 and rules["months"] == 12


def test_watch_failure_is_local_to_district_and_shared_requests_are_reused(monkeypatch):
    from fastapi import HTTPException
    from backend import property_move as move
    monkeypatch.setattr(move.prop, "market_key", lambda: "test-key")
    monkeypatch.setattr(move, "load_watch_rules", lambda: {"months": 2, "large_area_m2": 135})
    monkeypatch.setattr(move, "read_plan", lambda owner: {"candidates": [
        {"id": str(i), "name": str(i), "address": {"sigungu_code": code, "jibun": "서울특별시 강남구 개포동 185"}}
        for i, code in enumerate(["11680", "11680", "11710", "11710"])
    ]})
    calls = []
    def fetch(code, ym, key):
        calls.append((code, ym))
        if code == "11680":
            raise HTTPException(503, "upstream unavailable")
        return []
    monkeypatch.setattr(move.prop, "_month_trades", fetch)
    result = move.watch("together")
    assert len(calls) == 3  # one failed district request, two months for the other
    assert [r["summary"] for r in result["watch"][:2]] == [None, None]
    assert all(r["missing"] == "실거래 조회 실패" for r in result["watch"][:2])
    assert all(r["summary"]["count"] == 0 for r in result["watch"][2:])


def test_watch_endpoint_groups_members_and_reports_unconfigured(tmp_path, monkeypatch):
    from uuid import uuid4
    from fastapi.testclient import TestClient
    from backend import storage, property as prop
    from backend.main import app
    monkeypatch.setenv("RETIRE_SHEETS", "off")
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "ledger.sqlite3")
    monkeypatch.setattr(prop, "market_key", lambda: None)
    addr = {"building": "잠실장미", "sigungu_code": "11710", "jibun": "서울특별시 송파구 신천동 7", "apartment": True}
    members = [{"name": "장미1", "jibun": "서울특별시 송파구 신천동 7"}, {"name": "장미2", "jibun": "서울특별시 송파구 신천동 11"}]
    with TestClient(app, base_url="http://127.0.0.1", headers={"Origin": "http://127.0.0.1", "X-Retire-Local": "1"}) as c:
        cid = str(uuid4())
        r = c.put("/api/property-move?owner=together", json={"version": 0, "candidates": [{"id": cid, "name": "잠실장미", "address": addr, "members": members}]})
        assert r.status_code == 200, r.text
        assert r.json()["plan"]["candidates"][0]["members"] == members
        assert c.get("/api/property-move/watch?owner=together").json() == {"configured": False, "watch": []}
        monkeypatch.setattr(prop, "market_key", lambda: "k")
        monkeypatch.setattr(prop, "_month_trades", lambda sgg, ym, key: ROWS if ym.endswith("09") else [])
        w = c.get("/api/property-move/watch?owner=together").json()
        assert w["configured"] and w["large_area_m2"] == 135
        item = w["watch"][0]
        assert item["id"] == cid and item["names"] == ["장미1", "장미2"] and item["summary"]["count"] == 2   # 장미3·다른 동 제외


def test_monthly_series_uses_contract_month_and_all_transactions():
    from tools.property_watch import monthly_series
    rows = [row("A", "x", "1", 84, price, day) for price, day in
            [(100, "2026-01-03"), (300, "2026-01-20"), (700, "2026-03-01")]]
    assert monthly_series(rows) == [
        {"month": "2026-01", "count": 2, "median": 200},
        {"month": "2026-03", "count": 1, "median": 700},
    ]
    # No invented February price; all 65 transactions survive UI list truncation.
    many = [row("A", "x", "1", 84, i + 1, "2026-04-01") for i in range(65)]
    assert summarize(many, large_area_m2=135)["areas"][0]["monthly"] == [
        {"month": "2026-04", "count": 65, "median": 33}]


def test_research_uses_closed_months_and_preserves_missing():
    from datetime import date
    from tools.property_watch import research_snapshot
    candidates = [dict(id='a',name='A',area_m2=84,asking_low=280,asking_date='2026-11-01'),
                  dict(id='b',name='B',area_m2=84)]
    data = {'configured':True,'watch':[{'id':'a','summary':{'areas':[{'area':84,'latest':{'price':300,'date':'2026-10-03'},'monthly':[
        {'month':'2026-07','median':330,'count':2}, {'month':'2026-08','median':310,'count':1},
        {'month':'2026-10','median':300,'count':3}, {'month':'2026-11','median':1,'count':100}]}]}}]}
    r = research_snapshot(candidates,data,today=date(2026,11,18))
    a,b = r['rows']
    assert r['recent'] == ['2026-08','2026-09','2026-10']
    assert a['current_count'] == 4 and a['previous_count'] == 2
    assert a['price_change'] == -30 and a['asking_difference'] == -20
    assert b['current_count'] is None and b['missing']
    assert r['summary'] == {'total':2,'missing':1,'volume_up':1,'price_down':1,'asking_below_trade':1}


def test_research_no_trade_is_zero_but_unavailable_is_not():
    from datetime import date
    from tools.property_watch import research_snapshot
    c=[dict(id='a',name='A',area_m2=84)]
    watch={'configured':True,'watch':[{'id':'a','summary':{'areas':[]}}]}
    r=research_snapshot(c,watch,today=date(2026,2,1))
    assert r['previous'] == ['2025-08','2025-09','2025-10']
    assert r['rows'][0]['current_count'] == 0
    assert r['rows'][0]['price_change'] is None
    assert research_snapshot(c,{'configured':False},today=date(2026,2,1))['rows'][0]['current_count'] is None
