"""관심 단지 생활 입지 자료 수집·보관. 브이월드(좌표)·도시공원 표준데이터·심평원 병원정보. 읽기 전용 외부 조회, 결과는 로컬 SQLite에 보관."""
from __future__ import annotations

import json
import os
from pathlib import Path

import requests

from backend import storage
from backend import property as prop
from tools.property_place import load_place_rules, place_summary, ring_area_m2

VWORLD_URL = "https://api.vworld.kr/req/address"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
HIRA_URL = "https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList"
HOSPITAL_CLASSES = {"01": "상급종합", "11": "종합병원"}   # 심평원 종별코드
ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
LOCAL_ENV = Path(__file__).resolve().parents[1] / ".env"


def vworld_key() -> str | None:
    if os.environ.get("RETIRE_VWORLD_KEY"):
        return os.environ["RETIRE_VWORLD_KEY"].strip()
    for path in (LOCAL_ENV, ROOT_ENV):
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                name, _, value = line.strip().removeprefix("export ").partition("=")
                if name.strip() == "RETIRE_VWORLD_KEY" and value.strip():
                    return value.strip().strip("'\"")
        except OSError:
            continue
    return None


def _table(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS property_geo (address TEXT PRIMARY KEY, lat REAL, lng REAL, approx INTEGER NOT NULL DEFAULT 0, fetched_at TEXT NOT NULL)")
    conn.execute("CREATE TABLE IF NOT EXISTS property_place (kind TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at TEXT NOT NULL)")


def _vworld_point(address: str, kind: str) -> dict | None:
    r = requests.get(VWORLD_URL, params={"service": "address", "request": "getcoord", "version": "2.0", "crs": "epsg:4326", "address": address,
                                         "refine": "true", "simple": "false", "format": "json", "type": kind, "key": vworld_key()}, timeout=15)
    res = r.json()["response"]
    if res["status"] not in ("OK", "NOT_FOUND"):
        raise RuntimeError(res.get("error", {}).get("text") or res["status"])
    return {"lat": float(res["result"]["point"]["y"]), "lng": float(res["result"]["point"]["x"])} if res["status"] == "OK" else None


def geocode(address: str, kind: str = "parcel") -> dict | None:
    """주소 → {lat, lng, approx}. 한 번 찾은 주소는 저장해 다시 묻지 않는다.
    새로 나뉜 필지(예: 재건축 후 60-3)가 아직 없으면 본번(60)으로 다시 찾고 approx=True로 표시한다. 그래도 없으면 None."""
    with storage.connection() as conn:
        _table(conn)
        row = conn.execute("SELECT lat, lng, approx FROM property_geo WHERE address=?", (address,)).fetchone()
    if row:
        return {"lat": row["lat"], "lng": row["lng"], "approx": bool(row["approx"])} if row["lat"] is not None else None
    point, approx = _vworld_point(address, kind), False
    if point is None and kind == "parcel" and "-" in address.rsplit(" ", 1)[-1]:
        point, approx = _vworld_point(address.rsplit("-", 1)[0], kind), True
    with storage.connection() as conn:
        _table(conn)
        conn.execute("INSERT OR REPLACE INTO property_geo VALUES (?, ?, ?, ?, ?)", (address, point and point["lat"], point and point["lng"], int(approx), storage.now()))
    return {**point, "approx": approx} if point else None


def _pages(url: str, params: dict, items_of) -> list[dict]:
    out, page = [], 1
    while True:
        r = requests.get(url, params={**params, "pageNo": page, "numOfRows": 1000}, timeout=30)
        if r.status_code != 200 or "SERVICE_KEY_IS_NOT_REGISTERED" in r.text:
            raise RuntimeError("공공데이터포털에서 활용 신청이 승인되지 않았거나 아직 반영 전이에요.")
        items, total = items_of(r.json())
        out += items
        if not items or len(out) >= total:
            return out
        page += 1


def _num(v) -> float | None:
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _join(ways: list[list]) -> list[list]:
    """관계(relation)의 조각난 경계선을 끝점끼리 이어 닫힌 고리로 만든다. 닫히지 않는 조각은 그대로 둔다(거리 계산에는 사용)."""
    rings, open_ = [], [w[:] for w in ways if len(w) >= 2]
    while open_:
        ring = open_.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, w in enumerate(open_):
                if w[0] == ring[-1]:
                    ring += w[1:]
                elif w[-1] == ring[-1]:
                    ring += w[::-1][1:]
                elif w[-1] == ring[0]:
                    ring = w[:-1] + ring
                elif w[0] == ring[0]:
                    ring = w[::-1][:-1] + ring
                else:
                    continue
                open_.pop(i)
                changed = True
                break
        rings.append(ring)
    return rings


def fetch_parks(bbox: tuple[float, float, float, float]) -> list[dict]:
    """오픈스트리트맵의 이름 있는 공원(leisure=park) 경계. 같은 이름의 여러 조각(한강공원 등)은 한 공원으로 합친다.
    면적 = 바깥 고리 면적 합 − 안쪽 구멍. 출처 표기 필요: © OpenStreetMap contributors (ODbL)."""
    s, w, n, e = bbox
    query = f'[out:json][timeout:90];(way["leisure"="park"]["name"]({s},{w},{n},{e});relation["leisure"="park"]["name"]({s},{w},{n},{e}););out geom;'
    r = requests.post(OVERPASS_URL, data={"data": query}, headers={"User-Agent": "retire-together-local/0.1"}, timeout=120)
    r.raise_for_status()
    parks: dict[str, dict] = {}
    for el in r.json()["elements"]:
        if el["type"] == "way":
            outer, inner = [[(g["lat"], g["lon"]) for g in el.get("geometry", [])]], []
        else:
            parts = lambda role: [[(g["lat"], g["lon"]) for g in m.get("geometry", [])] for m in el.get("members", []) if m["type"] == "way" and m.get("role", "outer") == role]
            outer, inner = _join(parts("outer")), _join(parts("inner"))
        outer = [o for o in outer if len(o) >= 3]
        if not outer:
            continue
        name = el["tags"]["name"].strip()
        area = sum(ring_area_m2(o) for o in outer if o[0] == o[-1]) - sum(ring_area_m2(i) for i in inner if len(i) >= 3 and i[0] == i[-1])
        p = parks.setdefault(name, {"name": name, "area_m2": 0.0, "outer": [], "inner": []})
        p["area_m2"] += max(0.0, area)
        p["outer"] += outer
        p["inner"] += [i for i in inner if len(i) >= 3]
    return [{"name": p["name"], "area_m2": round(p["area_m2"]), "rings": p["outer"] + p["inner"], "holes": len(p["inner"])} for p in parks.values()]


def fetch_hospitals() -> list[dict]:
    """서울 상급종합·종합병원(이름·좌표·종별)."""
    def items_of(j):
        body = j.get("response", j)["body"]
        items = (body.get("items") or {}).get("item") or []
        return (items if isinstance(items, list) else [items]), int(body.get("totalCount") or 0)
    out = []
    for code, label in HOSPITAL_CLASSES.items():
        for r in _pages(HIRA_URL, {"serviceKey": prop.market_key(), "sidoCd": "110000", "clCd": code, "_type": "json"}, items_of):
            lat, lng = _num(r.get("YPos")), _num(r.get("XPos"))
            if lat and lng:
                out.append({"name": r.get("yadmNm", ""), "class": label, "lat": lat, "lng": lng, "address": r.get("addr", "")})
    return out


def fetch_departments() -> list[dict]:
    out = []
    for s in load_place_rules()["department_stores"]:
        point = geocode(s["address"], "road")
        if point:
            out.append({"name": s["name"], "address": s["address"], **point})
    return out


def refresh(points: list[dict] | None = None) -> dict:
    """세 출처를 각각 받아 보관. 한 출처가 실패해도 나머지는 저장하고, 실패는 이전 자료를 유지한 채 이유를 돌려준다.
    공원은 관심 단지 좌표를 감싸는 범위 + 약 3km에서 받는다."""
    status = {}
    pts = [p for p in points or [] if p]
    bbox = (min(p["lat"] for p in pts) - 0.03, min(p["lng"] for p in pts) - 0.03, max(p["lat"] for p in pts) + 0.03, max(p["lng"] for p in pts) + 0.03) if pts else None
    parks = (lambda: fetch_parks(bbox)) if bbox else (lambda: (_ for _ in ()).throw(RuntimeError("관심 단지 좌표가 없어 공원 범위를 정할 수 없어요.")))
    for kind, fetch in (("department", fetch_departments), ("park", parks), ("hospital", fetch_hospitals)):
        try:
            rows = fetch()
            with storage.connection() as conn:
                _table(conn)
                conn.execute("INSERT OR REPLACE INTO property_place VALUES (?, ?, ?)", (kind, json.dumps(rows, ensure_ascii=False), storage.now()))
            status[kind] = {"ok": True, "count": len(rows)}
        except (requests.RequestException, RuntimeError, KeyError, ValueError) as e:
            status[kind] = {"ok": False, "error": str(e)[:200]}
    return status


def stored() -> tuple[dict, dict]:
    with storage.connection() as conn:
        _table(conn)
        rows = conn.execute("SELECT * FROM property_place").fetchall()
    return {r["kind"]: json.loads(r["payload"]) for r in rows}, {r["kind"]: r["fetched_at"] for r in rows}


def summaries(candidates: list[dict]) -> dict:
    rules = load_place_rules()
    places, fetched = stored()
    items = []
    for c in candidates:
        jibun = (c.get("address") or {}).get("jibun")
        point = geocode(jibun) if jibun and vworld_key() else None
        items.append({"id": c["id"], "name": c["name"], "point": point,
                      "places": place_summary(point, places, radius_m=rules["radius_m"], park_min_area_m2=rules["park_min_area_m2"]) if point else None})
    return {"configured": bool(vworld_key()), "radius_m": rules["radius_m"], "park_min_area_m2": rules["park_min_area_m2"],
            "fetched_at": fetched, "items": items}
