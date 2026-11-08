"""국토부 매매·전월세 원자료 — 응답의 모든 필드를 보존하고, 화면·계산용 보기로 바꾼다. 외부 조회·저장 없음.
CALCULATION_RULES §6-O."""
from __future__ import annotations

import hashlib
import xml.etree.ElementTree as ET

from tools.property_watch import _median


def parse_items(xml_text: str) -> list[dict]:
    """<item>의 자식 태그를 모두 문자열로. 해제 거래도 버리지 않는다."""
    root = ET.fromstring(xml_text)
    code = (root.findtext(".//resultCode") or "").strip()
    if code and code not in ("00", "000"):
        raise ValueError(root.findtext(".//resultMsg") or f"조회 오류 {code}")
    return [{c.tag: (c.text or "").strip() for c in item} for item in root.iter("item")]


def _won(v: str) -> int | None:
    v = (v or "").replace(",", "").strip()
    return int(v) * 10_000 if v.lstrip("-").isdigit() else None


def _day(v: str) -> str | None:
    """'26.10.02' → '2026-10-02'. 비어 있으면 None."""
    parts = (v or "").strip().split(".")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return None
    y, m, d = (int(p) for p in parts)
    return f"{2000 + y if y < 100 else y:04d}-{m:02d}-{d:02d}"


def _date(r: dict) -> str:
    return f"{int(r['dealYear']):04d}-{int(r['dealMonth']):02d}-{int(r['dealDay']):02d}"


def _floor(r: dict) -> int | None:
    f = r.get("floor", "")
    return int(f) if f.lstrip("-").isdigit() else None


def trade_uid(r: dict) -> str:
    """계약 자체를 가리키는 키 — 나중에 바뀌는 해제·등기·중개사 정보는 넣지 않는다."""
    key = "|".join(r.get(k, "") for k in ("aptSeq", "aptNm", "jibun", "aptDong", "dealYear", "dealMonth", "dealDay", "floor", "excluUseAr", "dealAmount"))
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:20]


def rent_uid(r: dict) -> str:
    key = "|".join(r.get(k, "") for k in ("aptSeq", "aptNm", "jibun", "dealYear", "dealMonth", "dealDay", "floor", "excluUseAr", "deposit", "monthlyRent", "contractType", "contractTerm"))
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:20]


def trade_view(r: dict) -> dict:
    return {"name": r.get("aptNm", ""), "dong": r.get("umdNm", ""), "jibun": r.get("jibun", ""), "apt_seq": r.get("aptSeq", ""),
            "building": r.get("aptDong", ""), "area": float(r["excluUseAr"]), "price": _won(r.get("dealAmount")), "date": _date(r),
            "floor": _floor(r), "cancel": r.get("cdealType", "").upper() == "O", "cancel_day": _day(r.get("cdealDay", "")),
            "direct": r.get("dealingGbn", "") == "직거래", "buyer": r.get("buyerGbn") or None, "seller": r.get("slerGbn") or None,
            "registered": _day(r.get("rgstDate", ""))}


def rent_view(r: dict) -> dict:
    monthly = _won(r.get("monthlyRent")) or 0
    return {"name": r.get("aptNm", ""), "dong": r.get("umdNm", ""), "jibun": r.get("jibun", ""), "apt_seq": r.get("aptSeq", ""),
            "area": float(r["excluUseAr"]), "date": _date(r), "floor": _floor(r), "deposit": _won(r.get("deposit")), "monthly": monthly,
            "kind": "전세" if monthly == 0 else "월세", "new": r.get("contractType", "") == "신규",
            "renewal": r.get("contractType", "") == "갱신", "pre_deposit": _won(r.get("preDeposit")),
            "pre_monthly": _won(r.get("preMonthlyRent")), "renewal_right": r.get("useRRRight", "") == "사용", "term": r.get("contractTerm") or None}


def rent_summary(rows: list[dict], *, large_area_m2: float) -> dict:
    """평형별: 신규 전세 보증금 중간값(전세가율의 분자), 갱신 전세 보증금 인상률 중간값(%), 월세 건수. 갱신·월세는 신규 전세 수준에 섞지 않는다."""
    groups: dict[int, list[dict]] = {}
    for r in rows:
        if r["area"] <= large_area_m2:
            groups.setdefault(int(r["area"]), []).append(r)
    areas = []
    for area, rs in sorted(groups.items()):
        new = [r["deposit"] for r in rs if r["kind"] == "전세" and r["new"] and r["deposit"]]
        ups = [round((r["deposit"] - r["pre_deposit"]) / r["pre_deposit"] * 100, 1)
               for r in rs if r["kind"] == "전세" and r["renewal"] and r["deposit"] and r["pre_deposit"] and not r["pre_monthly"]]
        areas.append({"area": area, "new_jeonse_count": len(new), "new_jeonse_median": _median(new) if new else None,
                      "renewal_count": len(ups), "renewal_increase_median_pct": sorted(ups)[len(ups) // 2] if ups else None,
                      "monthly_count": sum(r["kind"] == "월세" for r in rs)})
    return {"count": len(rows), "areas": areas}
