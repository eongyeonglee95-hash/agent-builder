"""관심 단지 추적 — 여러 차수 묶음의 실거래 모으기와 평형별 기준 요약. 외부 조회·저장 없음."""
from __future__ import annotations

from pathlib import Path

import yaml

from tools.property import _norm, dong_of, parcel_of

RULES_PATH = Path(__file__).resolve().parents[1] / "rules" / "property_watch.yaml"


def load_watch_rules(path: Path | None = None) -> dict:
    return yaml.safe_load((path or RULES_PATH).read_text(encoding="utf-8"))


def group_trades(rows: list[dict], members: list[dict]) -> list[dict]:
    """members: [{name, jibun}] — 동·필지가 같은 거래. 이름이 있으면 같은 이름만(같은 필지에 단지가 둘인 경우)."""
    keys = [(dong_of(m["jibun"]), parcel_of(m["jibun"]), _norm(m.get("name") or "")) for m in members]

    def hit(r):
        return any(r.get("dong") == d and parcel_of(r.get("jibun")) == p and (not n or _norm(r["name"]) == n) for d, p, n in keys)
    return sorted((r for r in rows if hit(r)), key=lambda r: (r["date"], r["floor"] or 0), reverse=True)


def _median(xs: list[int]) -> int:
    xs, n = sorted(xs), len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) // 2


def summarize(rows: list[dict], *, large_area_m2: float) -> dict:
    """평형(전용 ㎡ 정수)별 거래 수·중간값·최근 거래. large_area_m2 초과 거래는 기준에서 빼고 건수만 센다."""
    kept = [r for r in rows if r["area"] <= large_area_m2]
    groups: dict[int, list[dict]] = {}
    for r in kept:
        groups.setdefault(int(r["area"]), []).append(r)
    areas = []
    for area, rs in sorted(groups.items()):
        last = max(rs, key=lambda r: (r["date"], r["floor"] or 0))
        areas.append({"area": area, "count": len(rs), "median": _median([r["price"] for r in rs]),
                      "latest": {"price": last["price"], "date": last["date"], "area": last["area"], "floor": last["floor"]}})
    return {"count": len(kept), "excluded_large": len(rows) - len(kept), "areas": areas}
