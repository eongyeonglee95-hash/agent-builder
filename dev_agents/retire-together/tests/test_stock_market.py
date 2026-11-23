import pytest
from tools.stock_market import parse_indicator


def test_yield_change_is_basis_points_not_relative_percentage():
    r = parse_indicator({'regularMarketPrice': 4.3, 'chartPreviousClose': 4.24, 'regularMarketTime': 1700000000}, {'symbol': '^TNX', 'kind': 'yield'})
    assert r['change_bp'] == 6
    assert r['value'] == 4.3


def test_missing_previous_close_does_not_show_zero_change():
    r = parse_indicator({'regularMarketPrice': 100, 'regularMarketTime': 1700000000}, {'symbol': '^GSPC', 'kind': 'index'})
    assert r['change_rate'] is None


@pytest.mark.parametrize('price', [None, float('nan'), float('inf'), -1])
def test_invalid_values_are_not_quotes(price):
    with pytest.raises(ValueError):
        parse_indicator({'regularMarketPrice': price, 'regularMarketTime': 1700000000}, {'symbol': '^GSPC', 'kind': 'index'})
