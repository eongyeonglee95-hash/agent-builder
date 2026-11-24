import datetime as dt

import pytest

from tools.property import held_months, home_metrics, pyeong


def test_metrics_with_purchase_loans_and_deposit():
    m = home_metrics(1_000_000_000, 800_000_000, "2019-05", dt.date(2026, 11, 2), loans=300_000_000, deposit=0)
    assert m["gain"] == 200_000_000
    assert m["gain_rate"] == pytest.approx(0.25)
    assert m["held_months"] == 90
    assert m["equity"] == 700_000_000
    assert m["ltv"] == pytest.approx(0.3)


def test_unknown_purchase_is_not_guessed():
    m = home_metrics(500_000_000, None, None, dt.date(2026, 11, 2), deposit=300_000_000)
    assert m["gain"] is None and m["gain_rate"] is None and m["held_months"] is None
    assert m["equity"] == 200_000_000
    assert m["deposit_ratio"] == pytest.approx(0.6)


def test_negative_equity_kept_and_zero_value_has_no_ratio():
    m = home_metrics(0, None, None, dt.date(2026, 1, 1), loans=10)
    assert m["equity"] == -10 and m["ltv"] is None


def test_validation_and_helpers():
    with pytest.raises(ValueError):
        home_metrics(-1, None, None, dt.date(2026, 1, 1))
    assert held_months("2026-12", dt.date(2026, 11, 2)) == 0
    assert pyeong(84) == 25.4 and pyeong(None) is None


from tools.property import asking_summary, match_trades, parse_trades

XML = """<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>
<item><aptNm>염리삼성래미안</aptNm><dealAmount>123,000</dealAmount><excluUseAr>84.92</excluUseAr><dealYear>2026</dealYear><dealMonth>10</dealMonth><dealDay>3</dealDay><floor>12</floor><umdNm>염리동</umdNm><cdealType> </cdealType></item>
<item><aptNm>염리삼성래미안</aptNm><dealAmount>118,000</dealAmount><excluUseAr>84.97</excluUseAr><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>21</dealDay><floor>5</floor><umdNm>염리동</umdNm></item>
<item><aptNm>염리삼성래미안</aptNm><dealAmount>130,000</dealAmount><excluUseAr>84.92</excluUseAr><dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>1</dealDay><floor>9</floor><umdNm>염리동</umdNm><cdealType>O</cdealType></item>
<item><aptNm>염리삼성래미안</aptNm><dealAmount>150,000</dealAmount><excluUseAr>114.5</excluUseAr><dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>9</dealDay><floor>3</floor><umdNm>염리동</umdNm></item>
<item><aptNm>마포자이</aptNm><dealAmount>140,000</dealAmount><excluUseAr>84.9</excluUseAr><dealYear>2026</dealYear><dealMonth>10</dealMonth><dealDay>9</dealDay><floor>7</floor><umdNm>염리동</umdNm></item>
</items></body></response>"""


def test_parse_skips_cancelled_and_matches_complex_and_area():
    rows = parse_trades(XML)
    assert len(rows) == 4 and rows[0]["price"] == 1_230_000_000 and rows[0]["date"] == "2026-10-03"
    hit = match_trades(rows, "염리 삼성래미안", 84.9)
    assert [r["price"] for r in hit] == [1_230_000_000, 1_180_000_000]
    assert len(match_trades(rows, "염리삼성래미안")) == 3


def test_old_korean_fields_and_error_code():
    old = "<response><header><resultCode>00</resultCode></header><body><items><item><아파트>헬리오시티</아파트><거래금액> 200,000</거래금액><전용면적>84.9</전용면적><년>2025</년><월>12</월><일>1</일><층>20</층></item></items></body></response>"
    assert parse_trades(old)[0]["price"] == 2_000_000_000
    with pytest.raises(ValueError):
        parse_trades("<response><header><resultCode>30</resultCode><resultMsg>SERVICE KEY IS NOT REGISTERED</resultMsg></header></response>")


def test_asking_summary():
    assert asking_summary([]) is None
    assert asking_summary([{"price": 12}, {"price": 15}, {"price": None}]) == {"low": 12, "high": 15, "count": 2}


def test_short_other_complex_name_and_other_dong_are_excluded():
    from tools.property import dong_of
    rows = [{"name": "삼성", "dong": "도화동", "area": 84.98, "price": 1, "date": "2026-10-01", "floor": 3},
            {"name": "염리삼성래미안", "dong": "염리동", "area": 84.96, "price": 2, "date": "2026-08-27", "floor": 5},
            {"name": "래미안", "dong": "도화동", "area": 84.9, "price": 3, "date": "2026-08-01", "floor": 1}]
    assert [r["price"] for r in match_trades(rows, "염리삼성래미안")] == [2]
    assert dong_of("서울 마포구 염리동 520") == "염리동" and dong_of("") is None
    assert [r["price"] for r in match_trades(rows, "래미안", dong="도화동")] == [3]


def test_renamed_complex_matches_exact_dong_and_parcel_not_nearby_brand():
    from tools.property import parcel_of
    row = {"name": "힐스테이트동대구센트럴", "dong": "신천동", "jibun": "1547", "apt_seq": "27140-3787",
           "area": 84.9921, "price": 660_000_000, "date": "2026-10-08", "floor": 26}
    rows = [row, {**row, "name": "힐스테이트 벤처밸리", "jibun": "1548"},
            {**row, "dong": "신암동"}, {**row, "area": 106.17}]
    hits = match_trades(rows, "힐스테이트 벤처밸리", 84, jibun="대구 동구 신천동 1547")
    assert hits == [row]
    assert match_trades(rows[:1], "힐스테이트 벤처밸리", 84) == []
    assert parcel_of("서울 마포구 염리동 0520-0") == "520"
    assert parcel_of("신천동 산 15-2") == "산15-2"
    assert parcel_of("힐스테이트 2차") is None


def test_parse_trade_preserves_identity_fields():
    xml = XML.replace('<aptNm>염리삼성래미안</aptNm>', '<aptNm>염리삼성래미안</aptNm><jibun>520</jibun><aptSeq>11440-1</aptSeq>')
    row = parse_trades(xml)[0]
    assert row["jibun"] == "520" and row["apt_seq"] == "11440-1"


# ── 기준 시세 (§6-V) ──
from tools.property import months_before, valuation_basis
from datetime import date

AS_OF = date(2026, 11, 24)
RULES = dict(trade_months=6, kb_months=3)


def test_months_before_clamps_month_end():
    assert months_before(date(2026, 8, 31), 6) == date(2026, 2, 28)
    assert months_before(AS_OF, 6) == date(2026, 5, 24)


def test_recent_trade_wins_over_kb_and_registered():
    trades = [{"price": 695_000_000, "date": "2026-10-20", "floor": 28}, {"price": 690_000_000, "date": "2026-10-20", "floor": 3}]
    kb = {"average": 700_000_000, "as_of": "2026-11-01", "area_m2": 84.9}
    b = valuation_basis(650_000_000, date(2026, 11, 2), trades, kb, 84.9, AS_OF, **RULES)
    assert b == {"value": 695_000_000, "kind": "trade", "date": "2026-10-20", "floor": 28, "needs_review": False}


def test_old_trade_falls_back_to_fresh_kb():
    trades = [{"price": 2_250_000_000, "date": "2026-02-09", "floor": 8}]       # 6개월 넘음
    kb = {"average": 2_300_000_000, "as_of": "2026-09-01", "area_m2": 114.0}
    b = valuation_basis(2_250_000_000, date(2026, 2, 9), trades, kb, 114.0, AS_OF, **RULES)
    assert (b["kind"], b["value"], b["date"]) == ("kb", 2_300_000_000, "2026-09-01")


def test_stale_or_other_area_kb_falls_back_to_registered():
    old_kb = {"average": 2_300_000_000, "as_of": "2026-08-23", "area_m2": 114.0}     # 3개월 하루 넘음
    other = {"average": 2_300_000_000, "as_of": "2026-11-01", "area_m2": 84.0}
    for kb in (old_kb, other, None):
        b = valuation_basis(2_250_000_000, date(2026, 2, 9), [], kb, 114.0, AS_OF, **RULES)
        assert b == {"value": 2_250_000_000, "kind": "registered", "date": "2026-02-09", "floor": None, "needs_review": True}


def test_boundary_dates_are_included_and_future_excluded():
    edge = [{"price": 1, "date": "2026-05-24", "floor": 1}]
    assert valuation_basis(5, AS_OF, edge, None, 84.0, AS_OF, **RULES)["kind"] == "trade"
    future = [{"price": 1, "date": "2026-11-25", "floor": 1}]
    assert valuation_basis(5, AS_OF, future, None, 84.0, AS_OF, **RULES)["kind"] == "registered"
