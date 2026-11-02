"""REG-01 파일 경로: CSV·엑셀의 느슨한 머리글을 읽고, 못 읽는 행은 바꾸지 않고 오류로 돌려준다."""
import io

import pandas as pd
import pytest

from tools.import_file import holdings_from_file, read_table


def test_korean_headers_with_title_rows_and_commas():
    csv = ("보유 종목 현황\n기준일: 2026-10-27\n\n종목명,종목코드,보유수량,현재가,평가금액\n"
           "KODEX 200,069500,\"1,000\",\"35,000원\",\"35,000,000\"\nACE 미국30년국채액티브(H),453850,500,10000,5000000\n합계,,,,40000000\n").encode("utf-8-sig")
    df, meta = holdings_from_file(csv, "잔고.csv", "acct_a")
    assert list(df["ticker_name"]) == ["KODEX 200", "ACE 미국30년국채액티브(H)"]
    assert list(df["ticker"]) == ["069500", "453850"]
    assert list(df["qty"]) == [1000, 500] and list(df["price"]) == [35000, 10000]
    assert meta["verified"] and meta["reconciled"] and meta["errors"] == []
    assert meta["screen_total_value"] == 40_000_000


def test_cp949_csv_and_price_from_value():
    csv = "종목명,수량,평가금액\n삼성전자,10,700000\n".encode("cp949")
    df, meta = holdings_from_file(csv, "a.csv", "acct_a")
    assert df.iloc[0]["price"] == 70_000 and df.iloc[0]["qty"] == 10


def test_excel_numeric_ticker_keeps_leading_zero(tmp_path):
    buf = io.BytesIO()
    pd.DataFrame({"ticker_name": ["KODEX 200"], "ticker": [69500], "qty": [3], "price": [35000]}).to_excel(buf, index=False)
    df, meta = holdings_from_file(buf.getvalue(), "h.xlsx", "acct_a")
    assert df.iloc[0]["ticker"] == "069500"
    assert not meta["verified"]   # 평가금액 열이 없으면 대조 불가 — '일치'가 아니다


def test_bad_rows_are_reported_not_fixed():
    csv = "종목명,수량,현재가\n좋은종목,10,1000\n소수수량,1.5,1000\n가격없음,3,\n".encode("utf-8")
    df, meta = holdings_from_file(csv, "a.csv", "acct_a")
    assert list(df["ticker_name"]) == ["좋은종목"]
    assert len(meta["errors"]) == 2 and "소수수량" in meta["errors"][0] and "가격없음" in meta["errors"][1]


@pytest.mark.parametrize("data,name,msg", [
    (b"a,b\n1,2\n", "x.csv", "종목명과 수량"),
    (b"", "x.csv", "비어"),
    (b"hello", "x.txt", "CSV 또는 엑셀"),
])
def test_unreadable_files_raise(data, name, msg):
    with pytest.raises(ValueError, match=msg):
        read_table(data, name) if name.endswith(".txt") or not data else holdings_from_file(data, name, "acct_a")
