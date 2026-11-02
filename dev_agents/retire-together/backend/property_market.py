"""부동산뱅크 공개 매물 조회. 읽기 전용·15분 캐시·출처와 확인일 유지."""
from __future__ import annotations

import datetime as dt
import time
from threading import Lock
from typing import Annotated
from urllib.parse import urlencode

import requests
from fastapi import APIRouter, HTTPException, Query

from tools.property import asking_summary
from tools.property_market import BASE, area_options, find_complexes, last_page, parse_listings

router = APIRouter(prefix="/market")
_cache: dict[tuple, tuple[float, dict]] = {}
_lock = Lock()
MAX_PAGES = 10


def _html(page: str, params: dict) -> str:
    try:
        r = requests.get(BASE + page, params=params, timeout=12)
        r.raise_for_status()
        r.encoding = "cp949"
        if "nc_list" not in r.text and "offer_contents" not in r.text:
            raise ValueError("unrecognized provider page")
        return r.text
    except (requests.RequestException, ValueError):
        raise HTTPException(503, "공개 매물 정보를 불러오지 못했어요. 출처에서 직접 확인하거나 나중에 다시 조회해 주세요.") from None


def _public_complex(bcode: str, name: str, jibun: str | None) -> dict:
    # 이름 변경은 공식 거래의 같은 주소로 확인한 이름만 추가한다.
    from backend import property as prop
    names = [name]
    directories = {}
    matches = []
    for category in ("AT", "BU"):
        params = {"region_cd": bcode, "offer_gbn": "P", "offerings_gbn": category}
        directories[category] = _html("OfferingsComplexList.neo", params)
        matches.extend(find_complexes(directories[category], names, bcode, category))
    if not matches and jibun and prop.market_key():
        rows = prop.recent_trades(bcode[:5], name, None, 12, jibun=jibun)
        names += list({r["name"] for r in rows})
        for category, html in directories.items():
            matches.extend(find_complexes(html, names, bcode, category))
    base = {"source": "부동산뱅크", "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(), "listings": [], "partial": False}
    if len(matches) != 1:
        return {**base, "status": "unmatched", "source_url": BASE + "OfferingsComplexList.neo?" + urlencode({"region_cd": bcode, "offer_gbn": "P", "offerings_gbn": "AT"})}
    match = matches[0]
    params = {"region_cd": bcode, "offer_gbn": "P", "offerings_gbn": match["category"], "complex_cd": match["code"]}
    html = _html("OfferingsList.neo", params)
    rows = parse_listings(html)
    if "offer_contents" in html and not rows:
        raise HTTPException(503, "매물 페이지의 형식이 바뀌어 가격을 확인하지 못했어요. 출처에서 직접 확인해 주세요.")
    pages = last_page(html)
    partial = pages > MAX_PAGES
    for page in range(2, MAX_PAGES + 1):
        if page > pages:
            break
        try:
            next_html = _html("OfferingsList.neo", {**params, "page": page})
            next_rows = parse_listings(next_html)
            pages = max(pages, last_page(next_html))
            partial = partial or pages > MAX_PAGES
            if "offer_contents" in next_html and not next_rows:
                partial = True
            rows.extend(next_rows)
        except HTTPException:
            partial = True
            break
    rows = list({r["id"]: r for r in rows}.values())
    return {**base, "status": "matched", "complex_name": match["name"], "source_url": BASE + "OfferingsList.neo?" + urlencode(params),
            "partial": partial, "listings": sorted(rows, key=lambda r: (r["price"], r["id"]))}


def public_complex(bcode: str, name: str, jibun: str | None) -> dict:
    key = (bcode, name, jibun)
    with _lock:
        hit = _cache.get(key)
    if hit and time.time() - hit[0] < 900:
        return hit[1]
    data = _public_complex(bcode, name, jibun)
    with _lock:
        if len(_cache) >= 128:
            _cache.clear()
        _cache[key] = (time.time(), data)
    return data


Bcode = Annotated[str, Query(pattern=r"^\d{10}$")]
Name = Annotated[str, Query(min_length=1, max_length=100)]
Jibun = Annotated[str | None, Query(max_length=200)]


@router.get("/listings")
def listings(bcode: Bcode, name: Name, area: Annotated[float, Query(gt=0, le=2000)], jibun: Jibun = None):
    data = public_complex(bcode, name, jibun)
    rows = [r for r in data["listings"] if abs(r["area"] - area) <= 2]
    return {**data, "listings": rows, "summary": asking_summary(rows)}


@router.get("/areas")
def areas(bcode: Bcode, name: Name, jibun: Jibun = None):
    from backend import property as prop
    rows, ads, sources, warnings = [], [], [], []
    try:
        data = public_complex(bcode, name, jibun)
        ads = data["listings"]
        if ads:
            sources.append("부동산뱅크 매물")
    except HTTPException:
        warnings.append("공개 매물 조회 실패")
    if prop.market_key():
        try:
            rows = prop.recent_trades(bcode[:5], name, None, 12, jibun=jibun)
            if rows:
                sources.append("국토교통부 최근 12개월 거래")
        except HTTPException:
            warnings.append("실거래 조회 실패")
    return {"areas": area_options(rows, ads), "sources": sources, "warnings": warnings}
