"""가계부 급여명세서 — 이름으로 사람 맞추기, 합 검사, 월급/상여, 같은 줄 바꿔 넣기, 확인 표 연결."""
import pytest
from fastapi.testclient import TestClient

from backend import storage
from backend.main import app
from tools.household_book import apply_payslips
from tools.household_payslip import check

NAMES = {"me": "김 한화", "partner": "이영희"}


def slip(**kw):
    base = {"employee_name": "김한화", "employer": "한화", "pay_date": "2026-11-25", "pay_month": "2026년 11월분", "title": "11월 급여",
            "gross": 6_900_000, "deduction_total": 1_490_000, "net": 5_410_000, "national_pension": 279_000, "health": 241_000,
            "care": 31_000, "employment": 62_000, "income_tax": 797_000, "local_tax": 80_000}
    return base | kw


def test_name_match_adds_up_and_deductions():
    r = check(slip(), NAMES, "2026-11")
    assert r["who"] == "me" and r["kind"] == "월급" and r["adds_up"] and r["in_month"]
    assert r["deductions"]["national_pension"] == 279_000 and r["month"] == "2026-11"


def test_unknown_name_bonus_mismatch_and_other_month():
    r = check(slip(employee_name="박철수", title="2026 성과급", net=5_400_000, pay_month="", pay_date="2026-10-31"), NAMES, "2026-11")
    assert r["who"] is None and r["kind"] == "상여" and not r["adds_up"]
    assert r["month"] == "2026-10" and not r["in_month"]


def test_missing_total_uses_item_sum():
    r = check(slip(deduction_total=None, gross=1_000_000, net=900_000, national_pension=45_000, health=35_000, care=None,
                   employment=8_000, income_tax=11_000, local_tax=1_000), NAMES, "2026-11")
    assert r["deduction_total"] == 100_000 and r["adds_up"]


def test_apply_replaces_same_person_and_kind_only():
    entry = {"income": [{"who": "me", "kind": "월급", "net": 5_000_000}, {"who": "partner", "kind": "월급", "net": 4_260_000}],
             "auto": ["income:me", "income:partner"]}
    e = apply_payslips(entry, [{"who": "me", "kind": "월급", "net": 5_410_000, "gross": 6_900_000, "deductions": {"national_pension": 279_000}},
                               {"who": "me", "kind": "상여", "net": 1_000_000}])
    mine = [l for l in e["income"] if l["who"] == "me"]
    assert sorted(l["net"] for l in mine) == [1_000_000, 5_410_000] and e["auto"] == ["income:partner"]
    assert next(l for l in mine if l["kind"] == "월급")["deductions"] == {"national_pension": 279_000}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "ledger.sqlite3")
    with TestClient(app, base_url="http://127.0.0.1", headers={"Origin": "http://127.0.0.1", "X-Retire-Local": "1"}) as c:
        yield c


def test_payslip_route_review_then_apply(client, monkeypatch):
    from backend import household_book as hb
    fam = client.get("/api/family").json()
    assert client.put("/api/family", json={"me": {"name": "김한화"}, "partner": {"name": "이영희"}, "version": (fam or {}).get("version", 0)}).status_code == 200
    monkeypatch.setattr(hb, "transcribe_payslips", lambda paths: [slip(), slip(employee_name="이영희", gross=None, deduction_total=None, net=4_260_000)])
    files = [("images", ("p.jpg", b"\xff\xd8", "image/jpeg"))]
    got = client.post("/api/household-book/capture", data={"month": "2026-10", "kind": "payslip"}, files=files)
    assert got.status_code == 200, got.text
    rows = got.json()["slips"]
    assert [r["who"] for r in rows] == ["me", "partner"] and rows[0]["adds_up"] and not rows[1]["adds_up"]
    body = {"slips": [{k: r[k] for k in ("who", "kind", "label", "gross", "net", "deductions", "pay_date")} for r in rows], "version": 0}
    saved = client.post("/api/household-book/2026-10/payslip", json=body)
    assert saved.status_code == 200, saved.text
    data = client.get("/api/household-book", params={"year": 2026, "month": 10}).json()
    assert data["selected"]["summary"]["income_by_who"]["me"] == 5_410_000
    assert data["selected"]["summary"]["income"] == 9_670_000
