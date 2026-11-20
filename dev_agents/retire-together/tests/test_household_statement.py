"""가계부 명세서 파일(엑셀·CSV) 읽기 — 카드사·은행 양식 차이, 취소·입금 제외, 확인 표 연결."""
import io

import openpyxl
import pytest
from fastapi.testclient import TestClient

from backend import storage
from backend.main import app
from tools.household_book import load_rules
from tools.household_statement import parse_date, parse_statement

RULES = load_rules()

CARD_CSV = """신한카드 이용내역 조회
조회기간,2026.10.01 ~ 2026.10.31
이용일자,이용카드,가맹점명,이용금액,결제예정금액,취소여부
2026.10.03,본인 1234,이마트 성수점,"84,320","84,320",
2026.10.05,가족 5678,스타벅스 서울숲,"5,600","5,600",
2026.10.07,본인 1234,쿠팡,"32,000","32,000",취소
2026.10.09,본인 1234,반품 환불,"-12,000","-12,000",
,,합계,"121,920",,
"""


def test_card_csv_cp949_with_title_rows_and_cancel():
    got = parse_statement(CARD_CSV.encode("cp949"), "신한.csv", 2026, RULES)
    assert got["rows"] == [{"date": "2026-10-03", "merchant": "이마트 성수점", "amount": 84_320},
                           {"date": "2026-10-05", "merchant": "스타벅스 서울숲", "amount": 5_600}]
    assert got["skipped"] == 3  # 취소·음수·합계 줄


def test_bank_xlsx_keeps_withdrawals_only():
    wb = openpyxl.Workbook(); ws = wb.active
    ws.append(["거래내역 조회"]); ws.append([])
    ws.append(["거래일시", "적요", "기재내용", "출금액", "입금액", "잔액"])
    ws.append(["2026-10-25 09:12:00", "급여", "회사", 0, 5_410_000, 9_000_000])
    ws.append(["2026-10-26 10:00:00", "자동이체", "KT 통신요금", 54_000, 0, 8_946_000])
    ws.append(["2026-10-27 11:30:00", "체크", "GS칼텍스 주유소", 70_000, None, 8_876_000])
    buf = io.BytesIO(); wb.save(buf)
    got = parse_statement(buf.getvalue(), "국민은행.xlsx", 2026, RULES)
    assert [r["merchant"] for r in got["rows"]] == ["KT 통신요금", "GS칼텍스 주유소"]  # 기재내용이 적요보다 먼저
    assert got["rows"][0] == {"date": "2026-10-26", "merchant": "KT 통신요금", "amount": 54_000}


def test_html_xls_from_card_site():
    html = "<html><body><table><tr><th>승인일자</th><th>이용하신곳</th><th>승인금액(원)</th></tr>" \
           "<tr><td>26.10.11</td><td>올리브영 성수</td><td>23,500</td></tr></table></body></html>"
    got = parse_statement(html.encode("utf-8"), "현대카드.xls", 2026, RULES)
    assert got["rows"] == [{"date": "2026-10-11", "merchant": "올리브영 성수", "amount": 23_500}]


def test_unknown_layout_and_binary_xls_explain_what_to_do():
    with pytest.raises(ValueError, match="날짜·가맹점"):
        parse_statement("이름,수량\n삼성전자,3\n".encode(), "x.csv", 2026, RULES)
    with pytest.raises(ValueError, match=".xlsx나 CSV"):
        parse_statement(b"\xd0\xcf\x11\xe0 not really excel", "old.xls", 2026, RULES)


@pytest.mark.parametrize("raw,iso", [("2026.10.03", "2026-10-03"), ("26-10-03 12:30", "2026-10-03"), ("10/03", "2026-10-03"),
                                     (20261003, "2026-10-03"), ("2026년 10월 3일", "2026-10-03"), ("합계", "")])
def test_dates(raw, iso):
    assert parse_date(raw, 2026) == iso


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "ledger.sqlite3")
    with TestClient(app, base_url="http://127.0.0.1", headers={"Origin": "http://127.0.0.1", "X-Retire-Local": "1"}) as c:
        yield c


def test_statement_route_feeds_same_review_table(client):
    files = {"file": ("신한.csv", CARD_CSV.encode("cp949"), "text/csv")}
    got = client.post("/api/household-book/statement", data={"month": "2026-10"}, files=files)
    assert got.status_code == 200, got.text
    body = got.json()
    by = {r["merchant"]: r for r in body["rows"]}
    assert by["이마트 성수점"]["category"] == "groceries" and by["스타벅스 서울숲"]["category"] == "dining"
    assert all(r["in_month"] and not r["duplicate"] for r in body["rows"]) and body["skipped"] == 3
    bad = client.post("/api/household-book/statement", data={"month": "2026-10"}, files={"file": ("a.pdf", b"%PDF", "application/pdf")})
    assert bad.status_code == 422
