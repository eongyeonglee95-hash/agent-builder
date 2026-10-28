"""resolve_ticker / fetch_prices — 공개 시세(네이버 금융)로 종목코드와 현재가를 가져온다.

증권사 API 없이 동작한다. 국내 상장 ETF만 대상.
네트워크가 없으면 예외를 올리고, 호출자는 스냅샷 가격으로 폴백한다.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request

_HEADERS = {"User-Agent": "Mozilla/5.0 (retire-together PoC)"}
_SEARCH = "https://ac.stock.naver.com/ac?q={q}&target=stock"
_PRICE = "https://polling.finance.naver.com/api/realtime/domestic/stock/{code}"


def _get_json(url: str, timeout: float = 10) -> dict:
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def search_candidates(name: str) -> list[tuple[str, str]]:
    """종목명으로 검색 → [(code, name)] 국내 종목만."""
    data = _get_json(_SEARCH.format(q=urllib.parse.quote(name)))
    return [(i["code"], i["name"]) for i in data.get("items", []) if i.get("nationCode") == "KOR"]


def pick_exact(name: str, candidates: list[tuple[str, str]]) -> str | None:
    """이름이 정확히 같은 후보 하나만 고른다. 없거나 여럿이면 None (사용자 확인 대상)."""
    norm = lambda s: s.replace(" ", "").lower()
    exact = [c for c, n in candidates if norm(n) == norm(name)]
    if len(exact) == 1:
        return exact[0]
    # 캡처는 긴 이름을 잘라서 보여줄 수 있다 ("KODEX 차이나휴머노이" → "KODEX 차이나휴머노이드로봇")
    prefix = [c for c, n in candidates if norm(n).startswith(norm(name))]
    return prefix[0] if len(prefix) == 1 else None


def resolve_ticker(name: str) -> tuple[str | None, list[tuple[str, str]]]:
    cands = search_candidates(name)
    return pick_exact(name, cands), cands


def fetch_price(code: str) -> int:
    data = _get_json(_PRICE.format(code=code))
    item = data["datas"][0]
    return int(str(item["closePrice"]).replace(",", ""))


def fetch_prices(codes: list[str], pause: float = 0.2) -> dict[str, int]:
    out: dict[str, int] = {}
    for c in codes:
        out[c] = fetch_price(c)
        time.sleep(pause)
    return out


_UP_CODES, _DOWN_CODES = {"1", "2"}, {"4", "5"}   # 상한·상승 / 하한·하락 (네이버 compareToPreviousPrice.code)


def parse_quote(item: dict) -> dict:
    """네이버 실시간 시세 한 건 → {price, prev_close, change, change_rate, market_status, traded_at}. 계산 없이 받은 값만 정리한다."""
    num = lambda v: int(str(v).replace(",", "")) if v not in (None, "") else None
    price = num(item.get("closePrice"))
    diff = num(item.get("compareToPreviousClosePrice")) or 0
    code = str((item.get("compareToPreviousPrice") or {}).get("code", "3"))
    change = abs(diff) if code in _UP_CODES else -abs(diff) if code in _DOWN_CODES else 0
    return {"price": price, "prev_close": price - change if price is not None else None, "change": change,
            "market_status": item.get("marketStatus"), "traded_at": item.get("localTradedAt")}


def fetch_quote(code: str) -> dict:
    data = _get_json(_PRICE.format(code=code))
    return parse_quote(data["datas"][0])

