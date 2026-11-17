"""공개 매물의 가격·동일 단지·면적·페이지 누락을 검증. 외부 통신 없음."""
import pytest
from fastapi import HTTPException

from backend import property_market as market
from tools.property_market import BASE, area_options, find_complexes, last_page, parse_listings


@pytest.fixture(autouse=True)
def temporary_cache(tmp_path, monkeypatch):
    from backend import storage
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "property.sqlite3")


def directory(name="검증아파트", code="A1234567", bcode="2714010200"):
    return f'<div class="nc_list"><a href="{BASE}OfferingsList.neo?complex_cd={code}&region_cd={bcode}&offerings_gbn=AT&offer_gbn=P">{name} <font>(3)</font></a></div>'


def listing(code="1234", price="62,000", area="84.99", checked="26.10.17."):
    return f'''<a href="{BASE}OfferingsDetail.neo?offerings_cd={code}&offer_gbn=P&region_cd=2714010200">
      <table class="offer_contents"><p>검증아파트 104동</p><p>매매 {price}만 / 최초분양가 60,000만 / 프리미엄 -5,000만 / 옵션가 7,000만</p>
      <p>115.22 / {area}㎡, 8층/35층, 남서향</p><div>확인 {checked}</div></table></a>'''


def test_directory_exact_name_dong_and_safe_source_url():
    html = directory() + directory("검증아파트2차", "A7654321") + directory(bcode="1111010100")
    assert find_complexes(html, ["검증 아파트"], "2714010200", "AT") == [{"code": "A1234567", "name": "검증아파트", "category": "AT"}]
    assert find_complexes(directory().replace(BASE, "https://example.org/"), ["검증아파트"], "2714010200", "AT") == []


def test_parse_total_price_deduplicates_ads_and_preserves_source_date():
    html = listing() + listing() + listing(code="5678", price="65,000")
    rows = parse_listings(html)
    assert len(rows) == 2 and rows[0]["price"] == 620_000_000
    assert rows[0]["area"] == 84.99 and rows[0]["supply_area"] == 115.22
    assert rows[0]["checked_on"] == "2026-10-17"
    assert rows[0]["floor_direction"] == "8층/35층 · 남서향"
    assert "region_cd=2714010200" in rows[0]["url"]
    assert parse_listings(listing(checked="26.15.32.")) == []
    assert parse_listings(listing().replace("offer_gbn=P", "offer_gbn=J")) == []
    assert last_page(f'<a href="{BASE}OfferingsList.neo?page=3&amp;offer_gbn=P">3</a>') == 3


def test_area_picker_uses_supply_only_when_verified():
    choices = area_options([{"area": 59.98}, {"area": 84.9921}], parse_listings(listing()))
    assert choices[0]["supply_pyeong"] == []
    assert len(choices) == 2 and choices[1]["supply_pyeong"] == [35]


def test_bounded_pagination_partial_failure_and_area_filter(monkeypatch):
    calls = []
    def html(page, params):
        calls.append((page, params))
        if page == "OfferingsComplexList.neo":
            return directory() if params["offerings_gbn"] == "AT" else '<div class="nc_list"></div>'
        if params.get("page") == 2:
            raise HTTPException(503, "source unavailable")
        return listing() + listing("1235", area="106.17") + f'<a href="{BASE}OfferingsList.neo?page=2">2</a>'
    monkeypatch.setattr(market, "_html", html)
    data = market.listings("2714010200", "검증아파트", 84)
    assert data["partial"] and data["summary"] == {"low": 620_000_000, "high": 620_000_000, "count": 1}
    assert len(calls) == 4
    assert market.listings("2714010200", "검증아파트", 106)["summary"]["count"] == 1
    assert len(calls) == 4  # 같은 단지의 다른 평형은 캐시를 다시 사용


def test_changed_markup_is_failure_not_zero_ads(monkeypatch):
    monkeypatch.setattr(market, "_html", lambda page, params: directory() if page == "OfferingsComplexList.neo" and params["offerings_gbn"] == "AT" else '<table class="offer_contents">changed</table>')
    with pytest.raises(HTTPException) as e:
        market._public_complex("2714010200", "검증아파트", None)
    assert e.value.status_code == 503


def test_rent_types_preserve_deposit_monthly_pairs_and_do_not_mix_sale():
    lease = listing().replace('offer_gbn=P', 'offer_gbn=L').replace('매매 62,000만', '전세 45,000만')
    monthly = listing().replace('offer_gbn=P', 'offer_gbn=M').replace('매매 62,000만', '월세 10,000 / 120만')
    assert parse_listings(lease, 'L')[0]['price'] == 450_000_000
    row = parse_listings(monthly, 'M')[0]
    assert row['price'] == 100_000_000 and row['monthly'] == 1_200_000
    assert parse_listings(monthly, 'P') == []
    assert parse_listings(monthly.replace('월세 10,000 / 120만', '월세 0 / 120만'), 'M')[0]['price'] == 0


def test_weekly_cache_survives_process_memory_and_expiry_failure_keeps_old_date(monkeypatch):
    now = [1_000_000.0]
    calls = []
    monkeypatch.setattr(market.time, 'time', lambda: now[0])
    def fetch(bcode, name, jibun, kind):
        calls.append(kind)
        return {'status': 'matched', 'fetched_at': '2026-11-17T00:00:00Z', 'listings': [], 'partial': False}
    monkeypatch.setattr(market, '_public_complex', fetch)
    first = market.public_complex('2714010200', '검증', None)
    now[0] += 6 * 86400
    market._locks.clear()
    assert market.public_complex('2714010200', '검증', None) == first
    assert calls == ['P']
    market.public_complex('2714010200', '검증', None, 'L')
    assert calls == ['P', 'L']
    now[0] += 86400
    market.public_complex('2714010200', '검증', None)
    assert calls == ['P', 'L', 'P']
    now[0] += 7 * 86400
    def fail(*args):
        raise HTTPException(503, 'failed')
    monkeypatch.setattr(market, '_public_complex', fail)
    stale = market.public_complex('2714010200', '검증', None)
    assert stale['stale'] is True and stale['fetched_at'] == first['fetched_at']


def test_monthly_summary_uses_one_actual_listing_not_independent_minima(monkeypatch):
    monkeypatch.setattr(market, 'public_complex', lambda *args: {'listings': [
        {'price': 100_000_000, 'monthly': 1_200_000, 'area': 84},
        {'price': 300_000_000, 'monthly': 800_000, 'area': 84},
    ]})
    assert market.listings('2714010200', '검증', 84, kind='M')['rent_offer'] == {'deposit': 300_000_000, 'monthly': 800_000}
