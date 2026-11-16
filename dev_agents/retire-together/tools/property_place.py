"""관심 단지 생활 입지 — 직선거리, 가장 가까운 시설, 반경 안 개수. 외부 조회·저장 없음. CALCULATION_RULES §6-P."""
from __future__ import annotations

import math
from pathlib import Path

import yaml

RULES_PATH = Path(__file__).resolve().parents[1] / "rules" / "property_places.yaml"
EARTH_M = 6_371_008.8


def load_place_rules(path: Path | None = None) -> dict:
    return yaml.safe_load((path or RULES_PATH).read_text(encoding="utf-8"))


def distance_m(a: dict, b: dict) -> float:
    """두 점({lat, lng}, WGS84)의 대원 거리(m)."""
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp, dl = p2 - p1, math.radians(b["lng"] - a["lng"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_M * math.asin(math.sqrt(h))


def _xy(lat: float, lng: float, lat0: float) -> tuple[float, float]:
    """작은 범위(수 km)의 평면 근사: 기준 위도 lat0에서 m 단위."""
    return EARTH_M * math.radians(lng) * math.cos(math.radians(lat0)), EARTH_M * math.radians(lat)


def ring_area_m2(ring: list) -> float:
    lat0 = sum(p[0] for p in ring) / len(ring)
    pts = [_xy(p[0], p[1], lat0) for p in ring]
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]))) / 2


def _inside(x: float, y: float, pts: list) -> bool:
    hit = False
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def _segment(px, py, x1, y1, x2, y2) -> float:
    dx, dy = x2 - x1, y2 - y1
    t = 0 if dx == dy == 0 else max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - x1 - t * dx, py - y1 - t * dy)


def boundary_distance_m(point: dict, rings: list, holes: int = 0) -> float:
    """점에서 공원 경계까지 거리(m). 공원 안이면 0. rings = 바깥 고리들 + 마지막 holes개는 안쪽 구멍(호수 등)."""
    lat0 = point["lat"]
    px, py = _xy(point["lat"], point["lng"], lat0)
    xy = [[_xy(a, b, lat0) for a, b in ring] for ring in rings]
    outer, inner = xy[:len(xy) - holes], xy[len(xy) - holes:]
    if any(_inside(px, py, r) for r in outer) and not any(_inside(px, py, r) for r in inner):
        return 0.0
    return min(_segment(px, py, *a, *b) for r in xy for a, b in zip(r, r[1:] + r[:1]))


def _dist(home: dict, place: dict) -> float:
    return boundary_distance_m(home, place["rings"], place.get("holes", 0)) if "rings" in place else distance_m(home, place)


def nearest(home: dict, places: list[dict]) -> dict | None:
    if not places:
        return None
    best = min(places, key=lambda p: _dist(home, p))
    return {**{k: v for k, v in best.items() if k not in ("rings", "holes")}, "distance_m": round(_dist(home, best))}


def park_summary(home: dict, parks: list[dict] | None, *, radius_m: float, park_min_area_m2: float) -> dict:
    """가장 가까운 큰 공원(면적 기준 이상)과 반경 안 공원 수. 경계가 있으면 경계까지, 없으면 대표점까지."""
    if not parks:
        return {"park_large": None, "parks_within": None}
    return {"park_large": nearest(home, [p for p in parks if (p.get("area_m2") or 0) >= park_min_area_m2]),
            "parks_within": sum(_dist(home, p) <= radius_m for p in parks)}


def place_summary(home: dict, places: dict, *, radius_m: float, park_min_area_m2: float) -> dict:
    """places: {department: [...], park: [{area_m2, rings?}], hospital: [{class: 상급종합|종합병원}]}. 자료가 없으면 None(0으로 채우지 않음)."""
    hospitals = places.get("hospital") or []
    return {
        "department": nearest(home, places.get("department") or []),
        **park_summary(home, places.get("park"), radius_m=radius_m, park_min_area_m2=park_min_area_m2),
        "hospital_tertiary": nearest(home, [h for h in hospitals if h.get("class") == "상급종합"]),
        "hospital_general": nearest(home, [h for h in hospitals if h.get("class") == "종합병원"]),
    }
