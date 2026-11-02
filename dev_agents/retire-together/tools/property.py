"""보유 집 지표 — 순수 함수 (CALCULATION_RULES §6-0).

금액은 모두 원 단위 정수. 지분·소유자 나누기는 호출하는 쪽(backend.property)이 장부의 scoped_asset으로 한다.
"""
from __future__ import annotations

import datetime as dt
import re
import unicodedata
import xml.etree.ElementTree as ET

SQM_PER_PYEONG = 3.305785   # 1평 = 400/121 ㎡


def pyeong(area_m2: float | None) -> float | None:
    """전용면적 ㎡ → 평 (소수 첫째 자리)."""
    if not area_m2:
        return None
    return round(area_m2 / SQM_PER_PYEONG, 1)


def held_months(purchase_month: str | None, as_of: dt.date) -> int | None:
    """산 달(YYYY-MM)부터 기준일까지 꽉 찬 개월 수. 모르면 None."""
    if not purchase_month:
        return None
    y, m = (int(x) for x in purchase_month.split("-"))
    months = (as_of.year - y) * 12 + (as_of.month - m)
    return max(months, 0)


def home_metrics(value: int, purchase_price: int | None, purchase_month: str | None, as_of: dt.date,
                 loans: int = 0, deposit: int = 0) -> dict:
    """집 한 채의 지표 (전체 금액 기준).

    - 오른 금액 G = 시세 − 산 가격, 오른 비율 G / 산 가격. 산 가격을 모르면 None (추정하지 않는다)
    - 남는 돈(순자산) E = 시세 − 연결 대출 − 돌려줄 보증금
    - 대출 비율(LTV) = 연결 대출 / 시세, 보증금 비율 = 보증금 / 시세. 시세가 0이면 None
    """
    if value < 0 or loans < 0 or deposit < 0 or (purchase_price is not None and purchase_price < 0):
        raise ValueError("금액은 0 이상이어야 합니다")
    gain = value - purchase_price if purchase_price else None
    return {
        "gain": gain,
        "gain_rate": gain / purchase_price if purchase_price else None,
        "held_months": held_months(purchase_month, as_of),
        "equity": value - loans - deposit,
        "ltv": loans / value if value else None,
        "deposit_ratio": deposit / value if value else None,
    }


# ── 국토부 아파트 매매 실거래가 (공공데이터포털) 응답 읽기 — 네트워크 없이 테스트한다 ──

# 2024년 개편 뒤 영문 필드와 예전 한글 필드를 함께 받는다
_FIELDS = {
    "name": ("aptNm", "아파트"), "price": ("dealAmount", "거래금액"), "area": ("excluUseAr", "전용면적"),
    "year": ("dealYear", "년"), "month": ("dealMonth", "월"), "day": ("dealDay", "일"), "floor": ("floor", "층"),
    "dong": ("umdNm", "법정동"), "cancel": ("cdealType", "해제여부"), "kind": ("dealingGbn", "거래유형"),
}


def _norm(text: str) -> str:
    return re.sub(r"[\s()·\-_.,]", "", unicodedata.normalize("NFKC", text or "")).casefold()


def parse_trades(xml_text: str) -> list[dict]:
    """응답 XML → 거래 목록. 해제(취소)된 거래는 뺀다. 금액은 원."""
    root = ET.fromstring(xml_text)
    code = (root.findtext(".//resultCode") or "").strip()
    if code and code not in ("00", "000"):
        raise ValueError(root.findtext(".//resultMsg") or f"실거래가 조회 오류 {code}")
    rows = []
    for item in root.iter("item"):
        get = lambda key: next(((item.findtext(t) or "").strip() for t in _FIELDS[key] if item.find(t) is not None), "")
        if get("cancel") in ("O", "o"):
            continue
        try:
            price = int(get("price").replace(",", "")) * 10_000
            date = f"{int(get('year')):04d}-{int(get('month')):02d}-{int(get('day')):02d}"
            area = float(get("area"))
        except ValueError:
            continue
        floor = get("floor")
        rows.append({"name": get("name"), "dong": get("dong"), "area": area, "price": price, "date": date,
                     "floor": int(floor) if floor.lstrip("-").isdigit() else None, "kind": get("kind")})
    return rows


def dong_of(jibun: str | None) -> str | None:
    """지번 주소에서 법정동 이름. '서울 마포구 염리동 520' → '염리동'."""
    words = (jibun or "").split()
    return next((w for w in reversed(words) if re.fullmatch(r"\S+(동|가|리|로\d*가)", w)), None)


def match_trades(rows: list[dict], name: str, area_m2: float | None = None, tolerance: float = 2.0,
                 dong: str | None = None) -> list[dict]:
    """같은 동·같은 단지(이름 포함 관계)·같은 면적(±tolerance㎡) 거래만, 최근 것부터.

    거래 쪽 이름이 더 짧을 때(예: 단지명 '삼성')는 4글자 이상일 때만 포함으로 본다 — 옆 동네 '삼성'이 섞이지 않게.
    """
    key = _norm(name)

    def same(r):
        other = _norm(r["name"])
        return bool(key) and (key in other or (len(other) >= 4 and other in key))
    hits = [r for r in rows if same(r) and (not dong or not r.get("dong") or r["dong"] == dong)]
    if area_m2:
        hits = [r for r in hits if abs(r["area"] - area_m2) <= tolerance]
    return sorted(hits, key=lambda r: (r["date"], r["floor"] or 0), reverse=True)


def asking_summary(listings: list[dict]) -> dict | None:
    """직접 적어 둔 매물 호가 → 최저·최고·건수. 호가는 시세(순자산)에 쓰지 않는다."""
    prices = [l["price"] for l in listings if l.get("price")]
    if not prices:
        return None
    return {"low": min(prices), "high": max(prices), "count": len(prices)}
