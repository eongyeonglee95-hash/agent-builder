"""은퇴 시트 API — 계획 저장·버전 검사, 장부 적립금의 층 나누기, 빠진 입력 안내. 임시 DB·규칙, 네트워크 없음."""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from backend import retirement, storage
from backend.main import app

ACCOUNTS = """accounts:
  - id: me_ps
    label: 나 연금저축
    owner: me
    broker: mirae
    account_type: pension_savings
    pocket: pension
    layer: 3
    active: true
pools: {}
"""


@pytest.fixture
def client(tmp_path, monkeypatch):
    (tmp_path / "accounts.yaml").write_text(ACCOUNTS, encoding="utf-8")
    monkeypatch.setenv("RETIRE_ACCOUNTS_PATH", str(tmp_path / "accounts.yaml"))
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "ledger.sqlite3")
    with TestClient(app, base_url="http://127.0.0.1", headers={"Origin": "http://127.0.0.1", "X-Retire-Local": "1"}) as c:
        yield c


def _asset(c, name, account, owner, amount):
    import uuid
    r = c.post("/api/assets", json={"request_id": str(uuid.uuid4()), "name": name, "account": account, "owner": owner, "pocket": "retirement",
                                    "assetClass": "mixed", "amount": amount, "as_of": date.today().isoformat()})
    assert r.status_code in (200, 201), r.text


def _family(c, partner=True):
    body = {"me": {"name": "나", "age": 40}, "partner": {"name": "짝", "age": 42} if partner else None,
            "retirement_age": 60, "target_amount": None, "version": c.get("/api/family").json()["version"] if c.get("/api/family").json() else 0}
    assert c.put("/api/family", json=body).status_code == 200


def test_missing_inputs_are_named_without_calculation(client):
    d = client.get("/api/retirement").json()
    assert d["projection"] is None and "나 나이" in d["line"]


def test_layers_from_ledger_and_defaults(client):
    _family(client)
    _asset(client, "연금저축", "나 연금저축", "me", 60_000_000)
    _asset(client, "IRP", "배우자 IRP", "partner", 30_000_000)
    d = client.get("/api/retirement").json()
    assert d["used"]["me"]["balances"] == {"3": 60_000_000}
    assert d["used"]["partner"]["balances"] == {"2": 30_000_000}
    # 배우자 은퇴 나이 기본값 = 나와 같은 해 (42 + 20)
    assert d["used"]["partner"]["retire_age"] == 62
    assert d["used"]["me"]["national_start_age"] == 65 and d["used"]["me"]["private_start_age"] == 60
    assert d["projection"]["summary"]["retire_year"] == date.today().year + 20
    assert "세전·오늘 돈 기준" in d["line"]


def test_plan_save_recomputes_and_checks_version(client):
    _family(client)
    _asset(client, "연금저축", "나 연금저축", "me", 60_000_000)
    body = {"me": {"national_monthly": 1_200_000, "savings_annual": 6_000_000}, "partner": {"national_monthly": 900_000},
            "monthly_need": 3_500_000, "version": 0}
    d = client.put("/api/retirement/plan", json=body).json()
    assert d["plan"]["version"] == 1 and d["plan"]["monthly_need"] == 3_500_000
    s = d["projection"]["summary"]
    assert "short_years" in s and ("부족한 해" in d["line"] or "생활비를 채워요" in d["line"])
    assert client.put("/api/retirement/plan", json=body).status_code == 409   # 옛 버전
    assert client.get("/api/retirement").json()["plan"]["me"]["national_monthly"] == 1_200_000


def test_invalid_input_rejected_and_rule_errors_reported(client):
    _family(client, partner=False)
    assert client.put("/api/retirement/plan", json={"me": {"national_monthly": -1}, "version": 0}).status_code == 422
    assert client.put("/api/retirement/plan", json={"me": {}, "hack": 1, "version": 0}).status_code == 422
    d = client.put("/api/retirement/plan", json={"me": {"private_start_age": 50}, "version": 0}).json()
    assert d["projection"] is None and "55세 이상" in d["error"]


def test_layer_of_uses_account_registry_then_name():
    accts = {"x": {"layer": 2}}
    assert retirement.layer_of({"account_id": "x", "account": "아무거나"}, accts) == 2
    assert retirement.layer_of({"account": "미래에셋 IRP"}, {}) == 2
    assert retirement.layer_of({"account": "중개형 ISA"}, {}) == 4
    assert retirement.layer_of({"account": "연금저축계좌(신)"}, {}) == 3
    assert retirement.layer_of({"account": "한화생명보험 · 무배당 연금보험 Enterprise"}, {}) == 4   # 세제비적격 → 추가연금
    assert retirement.layer_of({"account": "삼성생명 연금저축보험"}, {}) == 3   # 연금저축은 세제적격 → 개인연금


def test_db_from_reported_accrual_and_wage(client):
    _family(client)
    body = {"me": {"db_monthly_wage": 5_000_000, "db_accrued": 50_000_000}, "partner": {"db_monthly_wage": 6_000_000, "db_accrued": 90_000_000}, "version": 0}
    d = client.put("/api/retirement/plan", json=body).json()
    me, pa = d["used"]["me"]["db"], d["used"]["partner"]["db"]
    assert me == {"years_left": 20, "lump_at_retire": 150_000_000}
    assert pa == {"years_left": 20, "lump_at_retire": 210_000_000}     # 배우자도 같은 해(62세) 은퇴
    streams = d["projection"]["summary"]["streams"]
    assert {(s["person"], s["label"]) for s in streams} >= {("me", "퇴직연금(DB)"), ("partner", "퇴직연금(DB)")}
    assert next(s for s in streams if s["person"] == "me")["principal"] == round(150_000_000 * 1.02**20)
    assert client.put("/api/retirement/plan", json={"me": {"db_accrued": -1}, "version": 1}).status_code == 422


def test_db_preview_matches_save_without_writing_or_double_counting(client):
    _family(client)
    _asset(client, "IRP", "나 IRP", "me", 30_000_000)
    payload = {"me": {"db_method": "tenure", "db_start_date": "2020-01-01", "db_monthly_wage": 3_650_000,
                      "db_accrued": 90_000_000}, "partner": {"db_accrued": 50_000_000}, "version": 0}
    preview = client.post("/api/retirement/preview", json=payload)
    assert preview.status_code == 200, preview.text
    d = preview.json()
    assert client.get("/api/retirement").json()["plan"]["version"] == 0
    expected = (date.today() - date(2020, 1, 1)).days * 10_000
    assert d["db_estimates"]["me"]["accrued_now"] == expected
    assert d["capital"]["me"] == {"balances": {"2": 30_000_000}, "db_accrued": expected}
    assert d["capital"]["partner"]["db_accrued"] == 50_000_000
    saved = client.put("/api/retirement/plan", json=payload).json()
    for key in ("db_estimates", "capital", "used", "projection"):
        assert saved[key] == d[key]
    assert client.get("/api/retirement").json()["db_estimates"] == saved["db_estimates"]
    assert client.put("/api/retirement/plan", json=payload).status_code == 409
    # Switching back restores the original company amount; no conversion overwrites it.
    payload["me"]["db_method"] = "reported"
    payload["version"] = 1
    manual = client.put("/api/retirement/plan", json=payload).json()
    assert manual["capital"]["me"]["db_accrued"] == 90_000_000


@pytest.mark.parametrize("start", ["2026-02-30", "2999-01-01", "2020/01/01", 1577836800])
def test_db_invalid_start_date_rejected(client, start):
    body = {"me": {"db_start_date": start}, "version": 0}
    assert client.post("/api/retirement/preview", json=body).status_code == 422
    assert client.put("/api/retirement/plan", json=body).status_code == 422
    assert client.get("/api/retirement").json()["plan"]["version"] == 0


def test_db_incomplete_preview_and_capital_without_family(client):
    body = {"me": {"db_method": "tenure"}, "version": 0}
    preview = client.post("/api/retirement/preview", json=body).json()
    assert preview["db_estimates"]["me"]["accrued_now"] is None
    assert client.put("/api/retirement/plan", json=body).status_code == 422
    body["me"].update(db_start_date="2020-01-01", db_monthly_wage=3_650_000)
    d = client.put("/api/retirement/plan", json=body).json()
    assert d["capital"]["me"]["db_accrued"] > 0
    assert d["db_estimates"]["me"]["lump_at_retire"] is None
    assert d["projection"] is None


def test_spending_target_recomputes_with_saved_goal_inflation_and_retirement(client):
    _family(client)
    d = client.put("/api/retirement/plan", json={"monthly_need": 5_000_000, "inflation": .02, "version": 0}).json()
    assert d["spending_target"]["monthly_nominal"] == 7_429_737
    assert d["spending_target"]["target_year"] == date.today().year + 20
    # Goal card does not require any pension streams to exist.
    assert not d["projection"]["summary"]["streams"]
    d = client.put("/api/retirement/plan", json={"me": {"retire_age": 50}, "monthly_need": 5_000_000, "inflation": .03, "version": 1}).json()
    assert d["spending_target"]["years"] == 10 and d["spending_target"]["monthly_nominal"] == 6_719_582
    assert client.get("/api/retirement").json()["spending_target"] == d["spending_target"]
    # Invalid payout conditions must not silently change the independently valid lifestyle goal.
    d = client.put("/api/retirement/plan", json={"me": {"private_start_age": 50}, "monthly_need": 5_000_000, "version": 2}).json()
    assert d["projection"] is None and d["error"]
    assert d["spending_target"]["monthly_nominal"] == 7_429_737


def test_capital_survives_missing_ages_and_excludes_future_money(client):
    _asset(client, "개인연금", "연금저축", "me", 60_000_000)
    _asset(client, "추가", "중개형 ISA", "partner", 10_000_000)
    d = client.put("/api/retirement/plan", json={"me": {"savings_annual": 12_000_000, "db_accrued": 20_000_000, "db_monthly_wage": 5_000_000}, "version": 0}).json()
    assert d["projection"] is None
    assert d["capital"] == {"me": {"balances": {"3": 60_000_000}, "db_accrued": 20_000_000},
                            "partner": {"balances": {"4": 10_000_000}, "db_accrued": 0}}
    assert d["spending_target"] is None
