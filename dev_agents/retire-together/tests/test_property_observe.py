"""관측 원자료: 국토부 응답 전체 필드 보존, 거래 식별, 보기 변환, 전세 요약. 외부 조회 없음."""
from tools.property_observe import parse_items, rent_summary, rent_view, trade_uid, trade_view

TRADE_XML = """<response><header><resultCode>000</resultCode></header><body><items>
<item><aptNm>장미2</aptNm><aptSeq>11710-177</aptSeq><aptDong>12</aptDong><umdNm>신천동</umdNm><jibun>11</jibun>
<dealAmount>340,000</dealAmount><dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>10</dealDay><excluUseAr>82.45</excluUseAr>
<floor>7</floor><cdealType>O</cdealType><cdealDay>26.10.02</cdealDay><dealingGbn>직거래</dealingGbn><buyerGbn>개인</buyerGbn><slerGbn>법인</slerGbn><rgstDate> </rgstDate></item>
<item><aptNm>장미1</aptNm><aptSeq>11710-170</aptSeq><umdNm>신천동</umdNm><jibun>7</jibun><dealAmount>347,500</dealAmount>
<dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>29</dealDay><excluUseAr>82.45</excluUseAr><floor>3</floor><dealingGbn>중개거래</dealingGbn><rgstDate>26.10.15</rgstDate></item>
</items><totalCount>2</totalCount></body></response>"""

RENT_XML = """<response><body><items>
<item><aptNm>장미1</aptNm><aptSeq>11710-170</aptSeq><umdNm>신천동</umdNm><jibun>7</jibun><deposit>120,000</deposit><monthlyRent>0</monthlyRent>
<dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>3</dealDay><excluUseAr>82.45</excluUseAr><floor>5</floor><contractType>신규</contractType></item>
<item><aptNm>장미1</aptNm><aptSeq>11710-170</aptSeq><umdNm>신천동</umdNm><jibun>7</jibun><deposit>110,000</deposit><monthlyRent>0</monthlyRent>
<dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>4</dealDay><excluUseAr>82.45</excluUseAr><floor>6</floor><contractType>갱신</contractType>
<preDeposit>100,000</preDeposit><preMonthlyRent>0</preMonthlyRent><useRRRight>사용</useRRRight></item>
<item><aptNm>장미1</aptNm><aptSeq>11710-170</aptSeq><umdNm>신천동</umdNm><jibun>7</jibun><deposit>50,000</deposit><monthlyRent>200</monthlyRent>
<dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>5</dealDay><excluUseAr>82.45</excluUseAr><floor>2</floor><contractType>신규</contractType></item>
</items></body></response>"""


def test_parse_keeps_every_field_and_view_reads_cancel_direct_parties():
    raw = parse_items(TRADE_XML)
    assert raw[0]["aptDong"] == "12" and raw[0]["slerGbn"] == "법인" and "rgstDate" in raw[0]
    v = trade_view(raw[0])
    assert v["price"] == 3_400_000_000 and v["date"] == "2026-09-10" and v["area"] == 82.45
    assert v["cancel"] is True and v["cancel_day"] == "2026-10-02" and v["direct"] is True
    assert v["buyer"] == "개인" and v["seller"] == "법인" and v["registered"] is None
    w = trade_view(raw[1])
    assert w["cancel"] is False and w["direct"] is False and w["registered"] == "2026-10-15"


def test_uid_ignores_later_changes_like_cancel_or_registration():
    a, b = parse_items(TRADE_XML)
    changed = {**a, "cdealType": "", "rgstDate": "26.11.01"}
    assert trade_uid(a) == trade_uid(changed) and trade_uid(a) != trade_uid(b)


def test_rent_view_and_summary_use_new_jeonse_only_for_level():
    rows = [rent_view(r) for r in parse_items(RENT_XML)]
    assert rows[0]["kind"] == "전세" and rows[0]["deposit"] == 1_200_000_000 and rows[0]["new"] is True
    assert rows[2]["kind"] == "월세" and rows[2]["monthly"] == 2_000_000
    assert rows[1]["pre_deposit"] == 1_000_000_000 and rows[1]["renewal_right"] is True
    s = rent_summary(rows, large_area_m2=135)
    a = s["areas"][0]
    assert a["area"] == 82 and a["new_jeonse_count"] == 1 and a["new_jeonse_median"] == 1_200_000_000
    assert a["renewal_count"] == 1 and a["renewal_increase_median_pct"] == 10.0     # 10억 → 11억
    assert a["monthly_count"] == 1


def test_collect_keeps_identical_looking_contracts_separate_and_versions_changes(tmp_path, monkeypatch):
    from backend import storage, property_observe as po
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "obs.sqlite3")
    a, b = parse_items(TRADE_XML)
    twin = dict(b)                                   # 같은 날·층·면적·금액의 다른 계약
    monkeypatch.setattr(po, "_fetch", lambda kind, sgg, ym: [a, b, twin])
    assert po.collect_month("trade", "11710", "202609") == {"count": 3, "new": 3, "changed": 0}
    monkeypatch.setattr(po, "_fetch", lambda kind, sgg, ym: [{**a, "rgstDate": "26.11.01"}, b, twin])   # 등기 반영
    assert po.collect_month("trade", "11710", "202609") == {"count": 3, "new": 0, "changed": 1}
    rows = po.latest("trade", "11710")
    assert len(rows) == 3 and sum(r.get("rgstDate") == "26.11.01" for r in rows) == 1
