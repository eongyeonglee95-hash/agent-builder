"""관심 단지 생활 입지: 거리·가장 가까운 시설·반경 내 개수. 외부 조회 없음."""
from tools.property_place import distance_m, load_place_rules, nearest, place_summary

HOME = {"lat": 37.51413, "lng": 127.07933}          # 잠실엘스 근처
STORE = {"name": "A백화점", "lat": 37.51113, "lng": 127.09811}
FAR = {"name": "B백화점", "lat": 37.50449, "lng": 127.00481}


def test_distance_is_straight_line_meters():
    assert distance_m(HOME, HOME) == 0
    d = distance_m(HOME, STORE)
    assert 1600 < d < 1750            # 위도 0.003°·경도 0.0188° ≈ 1.7km
    assert distance_m(HOME, STORE) == distance_m(STORE, HOME)


def test_nearest_and_filter():
    hit = nearest(HOME, [FAR, STORE])
    assert hit["name"] == "A백화점" and hit["distance_m"] == round(distance_m(HOME, STORE))
    assert nearest(HOME, []) is None
    parks = [{"name": "작은공원", "lat": 37.5142, "lng": 127.0794, "area_m2": 3_000},
             {"name": "큰공원", "lat": 37.5206, "lng": 127.1214, "area_m2": 1_400_000}]
    assert nearest(HOME, [p for p in parks if p["area_m2"] >= 100_000])["name"] == "큰공원"


def test_place_summary_uses_rules_and_counts_radius():
    places = {
        "department": [STORE, FAR],
        "park": [{"name": "작은공원", "lat": 37.5142, "lng": 127.0794, "area_m2": 3_000},
                 {"name": "큰공원", "lat": 37.5206, "lng": 127.1214, "area_m2": 1_400_000}],
        "hospital": [{"name": "대학병원", "lat": 37.5262, "lng": 127.1083, "class": "상급종합"},
                     {"name": "동네종합", "lat": 37.5150, "lng": 127.0800, "class": "종합병원"}],
    }
    s = place_summary(HOME, places, radius_m=1000, park_min_area_m2=100_000)
    assert s["department"]["name"] == "A백화점"
    assert s["park_large"]["name"] == "큰공원" and s["park_large"]["area_m2"] == 1_400_000
    assert s["parks_within"] == 1                     # 반경 1km 안 공원 수(크기 무관)
    assert s["hospital_tertiary"]["name"] == "대학병원"
    assert s["hospital_general"]["name"] == "동네종합"
    assert place_summary(HOME, {}, radius_m=1000, park_min_area_m2=100_000) == {
        "department": None, "park_large": None, "parks_within": None, "hospital_tertiary": None, "hospital_general": None}


def test_rules_have_thresholds_and_store_list():
    r = load_place_rules()
    assert r["radius_m"] == 1000 and r["park_min_area_m2"] == 100_000
    assert all({"name", "address"} <= set(s) for s in r["department_stores"])


def test_places_endpoint_uses_stored_facilities(tmp_path, monkeypatch):
    import json
    from uuid import uuid4
    from fastapi.testclient import TestClient
    from backend import storage, property as prop, property_place as pp
    from backend.main import app
    monkeypatch.setenv("RETIRE_SHEETS", "off")
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "ledger.sqlite3")
    monkeypatch.setattr(prop, "market_key", lambda: None)
    monkeypatch.setattr(pp, "vworld_key", lambda: "k")
    monkeypatch.setattr(pp, "_vworld_point", lambda address, kind: None if address.endswith("60-3") else dict(HOME))
    with storage.connection() as conn:
        pp._table(conn)
        conn.execute("INSERT INTO property_place VALUES ('department', ?, 'now')", (json.dumps([STORE, FAR], ensure_ascii=False),))
    with TestClient(app, base_url="http://127.0.0.1", headers={"Origin": "http://127.0.0.1", "X-Retire-Local": "1"}) as c:
        addr = lambda j: {"building": "x", "sigungu_code": "11650", "jibun": f"서울특별시 서초구 잠원동 {j}", "apartment": True}
        ids = [str(uuid4()), str(uuid4())]
        r = c.put("/api/property-move?owner=together", json={"version": 0, "candidates": [
            {"id": ids[0], "name": "본번만 있는 단지", "address": addr("60-3")}, {"id": ids[1], "name": "정상 단지", "address": addr("19")}]})
        assert r.status_code == 200, r.text
        items = {i["id"]: i for i in c.get("/api/property-move/places?owner=together").json()["items"]}
    assert items[ids[0]]["point"]["approx"] is True                       # 60-3 없음 → 본번 60
    assert items[ids[1]]["point"]["approx"] is False
    assert items[ids[1]]["places"]["department"]["name"] == "A백화점"
    assert items[ids[1]]["places"]["park_large"] is None and items[ids[1]]["places"]["parks_within"] is None  # 공원 자료 없음 ≠ 0


# 공원 경계: 0.01° 정사각형(약 1.1km×0.88km) — 위도 37.5 기준
SQUARE = [[(37.50, 127.00), (37.50, 127.01), (37.51, 127.01), (37.51, 127.00), (37.50, 127.00)]]


def test_boundary_distance_zero_inside_and_edge_distance_outside():
    from tools.property_place import boundary_distance_m
    assert boundary_distance_m({"lat": 37.505, "lng": 127.005}, SQUARE) == 0
    d = boundary_distance_m({"lat": 37.505, "lng": 127.0133}, SQUARE)      # 동쪽 변에서 경도 0.0033° ≈ 291m
    assert 280 < d < 300
    hole = SQUARE + [[(37.504, 127.004), (37.504, 127.006), (37.506, 127.006), (37.506, 127.004), (37.504, 127.004)]]
    assert boundary_distance_m({"lat": 37.505, "lng": 127.005}, hole, holes=1) > 0   # 안쪽 구멍(호수 등)은 공원 밖


def test_ring_area_and_large_park_by_boundary():
    from tools.property_place import ring_area_m2, park_summary
    assert 970_000 < ring_area_m2(SQUARE[0]) < 990_000                    # 1,111m × 882m
    parks = [{"name": "큰공원", "area_m2": 980_000, "rings": SQUARE, "holes": 0},
             {"name": "작은공원", "area_m2": 3_000, "rings": [[(37.5200, 127.0200), (37.5200, 127.0203), (37.5202, 127.0203), (37.5200, 127.0200)]], "holes": 0}]
    s = park_summary({"lat": 37.505, "lng": 127.0133}, parks, radius_m=1000, park_min_area_m2=100_000)
    assert s["park_large"]["name"] == "큰공원" and 280 < s["park_large"]["distance_m"] < 300
    assert "rings" not in s["park_large"]
    assert s["parks_within"] == 1
