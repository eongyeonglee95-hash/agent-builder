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


def monthly_series(rows: list[dict]) -> list[dict]:
    """계약월별 조회 거래 수와 가격 중간값. 없는 달의 가격을 보간하지 않는다."""
    groups: dict[str, list[int]] = {}
    for row in rows:
        groups.setdefault(row["date"][:7], []).append(row["price"])
    return [{"month": month, "count": len(prices), "median": _median(prices)}
            for month, prices in sorted(groups.items())]


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
                      "monthly": monthly_series(rs),
                      "latest": {"price": last["price"], "date": last["date"], "area": last["area"], "floor": last["floor"]}})
    return {"count": len(kept), "excluded_large": len(rows) - len(kept), "areas": areas}


def research_snapshot(candidates: list[dict], watch: dict, *, today) -> dict:
    """Saved-candidate screening only; never a claim about the whole market or fair value."""
    def month(offset):
        n = today.year * 12 + today.month - 1 + offset
        return f"{n // 12}-{n % 12 + 1:02d}"
    recent, previous = [month(i) for i in (-3, -2, -1)], [month(i) for i in (-6, -5, -4)]
    rows = []
    heat_months=[month(i) for i in range(-11,1)]
    heat_rows=[]
    for c in candidates:
        found = next((w for w in watch.get("watch", []) if w["id"] == c["id"]), {})
        summary = found.get("summary")
        selected_area = int(c["area_m2"]) if c.get("area_m2") is not None else None
        area = next((a for a in (summary or {}).get("areas", []) if a["area"] == selected_area), None)
        available = bool(watch.get("configured") and summary is not None and selected_area is not None
                         and selected_area <= watch.get("large_area_m2", 135))
        monthly = {v["month"]: v for v in (area or {}).get("monthly", [])}
        available = available and (area is None or "monthly" in area)
        cells=[]
        for m in heat_months:
            n=int(m[:4])*12+int(m[5:])-2
            prev=f"{n//12}-{n%12+1:02d}"
            current=monthly.get(m) if available else None
            before=monthly.get(prev) if available else None
            change=round((current['median']/before['median']-1)*100,1) if current and before and before['median'] else None
            cells.append({'month':m,'count':current['count'] if current else (0 if available else None),
                          'price':current['median'] if current else None,'change_pct':change})
        heat_rows.append({'id':c['id'],'name':c['name'],'area':selected_area,'cells':cells})
        current_count = sum(monthly.get(m, {}).get("count", 0) for m in recent) if available else None
        previous_count = sum(monthly.get(m, {}).get("count", 0) for m in previous) if available else None
        current_price, previous_price = monthly.get(recent[-1], {}).get("median"), monthly.get(previous[-1], {}).get("median")
        latest = (area or {}).get("latest")
        asking = c.get("asking_low")
        rows.append({"id": c["id"], "name": c["name"], "area": selected_area,
                     "current_count": current_count, "previous_count": previous_count,
                     "price_change": current_price - previous_price if current_price is not None and previous_price is not None else None,
                     "latest": latest, "asking": asking, "asking_date": c.get("asking_date"),
                     "asking_difference": asking - latest["price"] if asking is not None and latest else None,
                     "missing": not available, "sparse": current_count is not None and current_count < 3})
    cells=[c for r in heat_rows for c in r['cells']]
    max_volume=max([c['count'] or 0 for c in cells]+[1])
    max_change=max([abs(c['change_pct'] or 0) for c in cells]+[1])
    for c in cells:
        c['volume_shade']=round((c['count'] or 0)/max_volume*25)
        c['change_shade']=round(abs(c['change_pct'] or 0)/max_change*25)
    return {"heatmap":{"months":heat_months,"rows":heat_rows}, "as_of": today.isoformat(), "recent": recent, "previous": previous, "rows": rows,
            "summary": {"total": len(rows), "missing": sum(r["missing"] for r in rows),
                        "volume_up": sum(r["current_count"] is not None and r["current_count"] > r["previous_count"] for r in rows),
                        "price_down": sum(r["price_change"] is not None and r["price_change"] < 0 for r in rows),
                        "asking_below_trade": sum(r["asking_difference"] is not None and r["asking_difference"] < 0 for r in rows)}}
