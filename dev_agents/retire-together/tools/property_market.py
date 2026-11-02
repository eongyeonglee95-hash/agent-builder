"""공개 매물 HTML의 사실 필드만 읽는다. 네트워크·장부 쓰기 없음."""
from __future__ import annotations

import datetime as dt
import re
from html import unescape
from urllib.parse import parse_qs, urljoin, urlparse

from tools.property import SQM_PER_PYEONG, _norm

BASE = "https://neonet.co.kr/novo-mobile/view/offerings/"


def plain(html: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]*>", " ", html))).strip()


def anchors(html: str):
    for href, body in re.findall(r'<a\b[^>]*href=[\"\']([^\"\']+)[\"\'][^>]*>(.*?)</a>', html, re.S | re.I):
        # 이 출처는 &region_cd를 이스케이프하지 않는다. html.unescape 전체 적용은
        # &reg를 ®로 바꿔 쿼리를 망가뜨리므로 세미콜론으로 끝나는 엔티티만 읽는다.
        url = urljoin(BASE, re.sub(r"&(?:#\d+|#x[\da-fA-F]+|[A-Za-z]+);", lambda m: unescape(m[0]), href))
        parsed = urlparse(url)
        if parsed.scheme == "https" and parsed.netloc == "neonet.co.kr":
            yield url, parse_qs(parsed.query), body


def find_complexes(html: str, names: list[str], bcode: str, category: str) -> list[dict]:
    """같은 법정동, 같은 이름의 단지만. 브랜드 부분 일치로 옆 단지를 섞지 않는다."""
    keys = {_norm(n) for n in names if n}
    found = {}
    for url, q, body in anchors(html):
        if not urlparse(url).path.endswith("/OfferingsList.neo"):
            continue
        code = q.get("complex_cd", [""])[0]
        name = re.sub(r"\s*\(\d+\)\s*$", "", plain(body)).strip()
        if (re.fullmatch(r"A\d{7}", code) and _norm(name) in keys
                and q.get("region_cd") == [bcode] and q.get("offerings_gbn") == [category]
                and q.get("offer_gbn") == ["P"]):
            found[code] = {"code": code, "name": name, "category": category}
    return list(found.values())


def parse_listings(html: str) -> list[dict]:
    result = {}
    for url, q, body in anchors(html):
        code = q.get("offerings_cd", [""])[0]
        if not urlparse(url).path.endswith("/OfferingsDetail.neo") or not code.isdigit() or q.get("offer_gbn") != ["P"]:
            continue
        parts = [plain(p) for p in re.findall(r"<p\b[^>]*>(.*?)</p>", body, re.S | re.I)]
        price = re.search(r"매매\s+([\d,]+)만", plain(body))
        size = next((re.search(r"([\d.]+)\s*/\s*([\d.]+)㎡\s*,\s*(.*)", p) for p in parts if "㎡" in p), None)
        checked = re.search(r"확인\s+(\d{2})\.(\d{2})\.(\d{2})", plain(body))
        if not price or not size or not parts or not checked:
            continue
        try:
            checked_on = dt.date(2000 + int(checked[1]), int(checked[2]), int(checked[3])).isoformat()
            supply, area = float(size[1]), float(size[2])
            won = int(price[1].replace(",", "")) * 10_000
            if not 0 < area <= supply <= 2000 or won <= 0:
                continue
        except ValueError:
            continue
        # 매매 총액을 그대로 사용. 분양가·프리미엄·옵션을 다시 더하지 않는다.
        result[code] = {"id": code, "name": parts[0], "price": won, "area": area, "supply_area": supply,
                        "floor_direction": size[3], "checked_on": checked_on, "url": url}
    return sorted(result.values(), key=lambda r: (r["price"], r["id"]))


def last_page(html: str) -> int:
    return max([1, *[int(q["page"][0]) for url, q, _ in anchors(html)
                     if urlparse(url).path.endswith("/OfferingsList.neo") and q.get("page", [""])[0].isdigit()]])


def area_options(trades: list[dict], listings: list[dict]) -> list[dict]:
    """확인된 전용면적을 ㎡ 정수군으로 묶는다. 공급면적 없는 거래를 '34평형' 등으로 추정하지 않는다."""
    groups: dict[int, dict] = {}
    for row in [*trades, *listings]:
        area = row["area"]
        g = groups.setdefault(int(area), {"area": round(area, 2), "min": area, "max": area, "supply": set()})
        g["min"], g["max"] = min(g["min"], area), max(g["max"], area)
        if row.get("supply_area"):
            g["supply"].add(round(row["supply_area"] / SQM_PER_PYEONG))
    return [{"area": g["area"], "min": round(g["min"], 2), "max": round(g["max"], 2),
             "supply_pyeong": sorted(g["supply"])} for _, g in sorted(groups.items())]
