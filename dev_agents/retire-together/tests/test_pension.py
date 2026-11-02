"""tools/pension — CALCULATION_RULES §4 공식을 손으로 계산한 값과 대조한다."""
import pytest
from datetime import date

from tools.pension import (Assumptions, Person, annuity_monthly, db_at_retire, future_value, load_pension_rules,
                           monthly_cost_at, national_start_age, person_streams, project, spending_target, db_estimate, service_period, national_options, survivor_check, spending_budget_totals)

A = Assumptions(return_rate=0.05, inflation=0.02, end_age=90, start_age_min=55, min_payout_years=10)


def test_spending_budget_monthly_units_and_rounding():
    budget = load_pension_rules()["spending_budget_template"]
    assert spending_budget_totals(budget) == {"food_monthly": 2_700_000, "housing_tax_monthly": 700_000, "monthly_total": 7_500_000}
    changed = {**budget, "meal_cost": 12000, "days_per_month": 31, "housing_tax_annual": 4_000_002}
    totals = spending_budget_totals(changed)
    assert totals["food_monthly"] == 2_232_000
    assert totals["housing_tax_monthly"] == 333_334  # half a won rounds up
    assert totals["monthly_total"] == 6_665_334
    zeros = {key: value if key in ("people", "meals_per_day", "days_per_month") else 0 for key, value in budget.items()}
    assert spending_budget_totals(zeros)["monthly_total"] == 0


@pytest.mark.parametrize("change", [{"meal_cost": -1}, {"people": 0}, {"days_per_month": 32}, {"people": True}, {"medical_monthly": 1.5}, {"meal_cost": 10**12}])
def test_spending_budget_rejects_invalid_inputs(change):
    with pytest.raises(ValueError):
        spending_budget_totals({**load_pension_rules()["spending_budget_template"], **change})


def test_rules_file_matches_confirmed_defaults():
    rules = load_pension_rules()
    a = Assumptions.from_rules(rules)
    assert (a.return_rate, a.inflation, a.end_age, a.start_age_min, a.min_payout_years) == (0.05, 0.02, 90, 55, 10)
    assert Assumptions.from_rules(rules, return_rate=0.04, inflation=None).return_rate == 0.04


@pytest.mark.parametrize("year,age", [(1952, 60), (1953, 61), (1960, 62), (1964, 63), (1968, 64), (1969, 65), (1986, 65)])
def test_national_start_age_by_birth_year(year, age):
    assert national_start_age(year, load_pension_rules()) == age


def test_future_value_formula():
    # 1,000만 × 1.05^10 + 100만 × (1.05^10 − 1)/0.05
    assert future_value(10_000_000, 1_000_000, 0.05, 10) == pytest.approx(10_000_000 * 1.05**10 + 1_000_000 * (1.05**10 - 1) / 0.05)
    assert future_value(10_000_000, 1_000_000, 0.0, 10) == 20_000_000


def test_contributions_stop_at_retirement_then_only_grow():
    # 5년 납입 뒤 5년 더 불어남
    expect = 1_000_000 * (1.05**5 - 1) / 0.05 * 1.05**5
    assert future_value(0, 1_000_000, 0.05, 10, contrib_years=5) == pytest.approx(expect)
    assert future_value(0, 1_000_000, 0.05, 10, contrib_years=0) == 0


def test_annuity_monthly_formula_and_zero_rate():
    rm = 1.05 ** (1 / 12) - 1
    assert annuity_monthly(100_000_000, 0.05, 120) == pytest.approx(100_000_000 * rm / (1 - (1 + rm) ** -120))
    assert annuity_monthly(120_000_000, 0.0, 120) == 1_000_000
    with pytest.raises(ValueError):
        annuity_monthly(1, 0.05, 0)


def test_national_pension_is_flat_in_todays_money_and_rises_nominally():
    p = Person("me", "나", age=60, retire_age=60, national_monthly=1_000_000, national_start_age=65)
    out = project([p], A, 2026)
    y65 = next(r for r in out["rows"] if r["ages"]["me"] == 65)
    y70 = next(r for r in out["rows"] if r["ages"]["me"] == 70)
    assert y65["total_real"] == 1_000_000 and y70["total_real"] == 1_000_000
    assert y65["total_nominal"] == round(1_000_000 * 1.02**5)
    assert y70["total_nominal"] == pytest.approx(1_000_000 * 1.02**10, abs=2)
    assert next(r for r in out["rows"] if r["ages"]["me"] == 64)["total_real"] == 0


def test_private_payout_is_level_nominal_and_ends_at_end_age():
    p = Person("me", "나", age=50, retire_age=55, private_start_age=55, balances={3: 100_000_000}, annual={3: 6_000_000})
    [s] = person_streams(p, A)
    fv = future_value(100_000_000, 6_000_000, 0.05, 5, 5)
    assert s.principal == round(fv) and s.monthly_first == round(annuity_monthly(fv, 0.05, 35 * 12))
    rows = project([p], A, 2026)["rows"]
    assert {r["total_nominal"] for r in rows if 55 <= r["ages"]["me"] < 90} == {s.monthly_first}
    assert rows[-1]["ages"]["me"] == 89 and rows[-1]["total_nominal"] == s.monthly_first
    # 오늘 돈으로는 물가만큼 줄어든다
    r55, r56 = rows[5], rows[6]
    assert r56["total_real"] < r55["total_real"]


def test_household_is_staircase_and_need_gap():
    me = Person("me", "나", age=40, retire_age=60, national_monthly=1_000_000, national_start_age=65,
                private_start_age=60, balances={3: 60_000_000}, annual={3: 6_000_000})
    partner = Person("partner", "배우자", age=42, retire_age=62, national_monthly=800_000, national_start_age=65,
                     private_start_age=62, balances={2: 30_000_000})
    out = project([me, partner], A, 2026, monthly_need=3_000_000)
    s = out["summary"]
    assert s["retire_year"] == 2046
    totals = {r["year"]: r["total_real"] for r in out["rows"]}
    # 2046 나 개인연금+배우자 퇴직연금(62세) → 2049 배우자 국민연금(65세) → 2051 나 국민연금(65세)
    assert totals[2046] < totals[2049] < totals[2051]
    assert s["all_started_year"] == 2051
    row = next(r for r in out["rows"] if r["year"] == 2046)
    assert row["gap_real"] == row["total_real"] - 3_000_000
    assert s["short_years"] == sum(1 for r in out["rows"] if r["retired"] and r["gap_real"] < 0)
    assert next(r for r in out["rows"] if r["year"] == 2030)["need_real"] is None   # 은퇴 전엔 생활비 비교 안 함


def test_db_lump_moves_to_irp_at_retirement():
    p = Person("me", "나", age=50, retire_age=60, private_start_age=55, db_lump=100_000_000)
    [s] = person_streams(p, A)
    assert s.label == "퇴직연금(DB)" and s.start_age == 60
    assert s.principal == round(100_000_000 * 1.02**10)


def test_rules_are_enforced():
    with pytest.raises(ValueError, match="55세 이상"):
        person_streams(Person("me", "나", age=40, retire_age=50, private_start_age=50, balances={3: 1}), A)
    with pytest.raises(ValueError, match="최소 10년"):
        person_streams(Person("me", "나", age=40, retire_age=60, private_start_age=85, balances={3: 1}), A)
    with pytest.raises(ValueError, match="0 이상"):
        person_streams(Person("me", "나", age=40, retire_age=60, annual={3: -1}), A)


def test_already_started_person_uses_current_age():
    p = Person("me", "나", age=70, retire_age=60, national_monthly=500_000, national_start_age=65, balances={3: 50_000_000})
    rows = project([p], A, 2026)["rows"]
    assert rows[0]["total_real"] > 500_000 and rows[0]["retired"]


def test_db_at_retire_is_accrued_plus_wage_per_year_left():
    assert db_at_retire(55_000_000, 5_000_000, 20) == 155_000_000   # 지금 5,500만 + 월급 500만 × 20년
    assert db_at_retire(55_000_000, 0, 20) == 55_000_000            # 월급을 모르면 지금 퇴직금만
    assert db_at_retire(55_000_000, 5_000_000, -3) == 55_000_000    # 이미 은퇴 나이를 지났으면 더 쌓이지 않음
    with pytest.raises(ValueError, match="0 이상"):
        db_at_retire(-1, 5_000_000, 1)


def test_db_tenure_uses_actual_days_and_does_not_add_reported_amount():
    args = dict(monthly_wage=3_650_000, accrued_now=90_000_000, start_date=date(2020, 1, 1),
                as_of=date(2026, 1, 1), years_left=20, method="tenure", rules=load_pension_rules())
    result = db_estimate(**args)
    assert result["tenure"] == {"years": 6, "months": 0, "days": 2192}
    assert result["accrued_now"] == 21_920_000
    assert result["timeline"][-1]["date"] == "2046-01-01"
    assert result["lump_at_retire"] == 94_970_000  # 9,497 days, includes leap days
    later = db_estimate(**{**args, "as_of": date(2026, 1, 2)})
    assert later["accrued_now"] == 21_930_000
    reported = db_estimate(**{**args, "method": "reported"})
    assert reported["accrued_now"] == 90_000_000
    assert reported["lump_at_retire"] == 163_000_000


def test_db_tenure_partial_year_eligibility_leap_day_and_missing_input():
    args = dict(monthly_wage=3_650_000, accrued_now=0, start_date=date(2025, 1, 2),
                as_of=date(2026, 1, 1), years_left=1, method="tenure", rules=load_pension_rules())
    result = db_estimate(**args)
    assert result["accrued_now"] == 0 and result["eligible_now"] is False
    assert result["lump_at_retire"] == 7_290_000
    assert db_estimate(**{**args, "as_of": date(2026, 1, 2)})["accrued_now"] == 3_650_000
    leap = db_estimate(**{**args, "start_date": date(2020, 2, 29), "as_of": date(2024, 2, 29)})
    assert leap["timeline"][-1]["date"] == "2025-02-28"
    assert service_period(date(2020, 2, 29), date(2021, 2, 28)) == {"years": 1, "months": 0, "days": 365}
    incomplete = db_estimate(**{**args, "start_date": None, "monthly_wage": 0})
    assert len(incomplete["missing"]) == 2 and incomplete["accrued_now"] is None
    assert incomplete["timeline"] == []
    assert db_estimate(**{**args, "years_left": -2})["timeline"] == [result["timeline"][0]]
    with pytest.raises(ValueError, match="입사일"):
        db_estimate(**{**args, "start_date": date(2026, 1, 2)})


def test_spending_target_is_same_lifestyle_in_retirement_year_money():
    target = spending_target(5_000_000, .02, 2026, age=40, retire_age=60)
    assert target == {"base_year": 2026, "target_year": 2046, "years": 20, "monthly_today": 5_000_000,
                      "monthly_nominal": 7_429_737, "monthly_increase": 2_429_737, "inflation": .02}
    assert monthly_cost_at(5_000_000, 0, 20) == 5_000_000
    assert spending_target(None, .02, 2026, 40, 60) is None
    assert spending_target(0, .02, 2026, 40, 60)["monthly_nominal"] == 0
    assert spending_target(5_000_000, .02, 2026, 65, 60)["target_year"] == 2026
    assert spending_target(5_000_000, .02, 2026, 65, 60)["monthly_nominal"] == 5_000_000


def test_nominal_gap_and_layer_contribution_share_one_spending_target():
    me = Person("me", "나", 40, 60, national_monthly=6_000_000, national_start_age=65,
                private_start_age=60, balances={3: 60_000_000})
    out = project([me], A, 2026, monthly_need=5_000_000)
    r = out["rows"][25]
    assert r["need_nominal"] == 8_203_030
    assert r["gap_nominal"] == r["total_nominal"] - 8_203_030
    assert r["coverage"]["total"] > 120  # don't cap a surplus at 100% in the API
    assert r["coverage"]["layers"][1] == pytest.approx(120, abs=.001)
    assert sum(r["coverage"]["layers"].values()) == pytest.approx(r["coverage"]["total"])
    assert out["rows"][19]["coverage"] is None  # no spending comparison before retirement
    assert out["rows"][19]["need_nominal"] is None
    private = next(s for s in out["summary"]["streams"] if s["layer"] == 3)
    assert (private["start_age"], private["end_age_exclusive"], private["payout_years"]) == (60, 90, 30)
    assert next(s for s in out["summary"]["streams"] if s["layer"] == 1)["payout_years"] is None


@pytest.mark.parametrize("need", [None, 0])
def test_missing_or_zero_spending_never_produces_percentage(need):
    me = Person("me", "나", 60, 60, national_monthly=1_000_000, national_start_age=60)
    out = project([me], A, 2026, monthly_need=need)
    assert all(r["coverage"] is None for r in out["rows"])


def test_actual_private_payout_period_uses_later_db_retirement_and_person_age():
    me = Person("me", "나", 40, 60, private_start_age=55, balances={3: 60_000_000}, db_lump=30_000_000)
    partner = Person("partner", "배우자", 63, 60, private_start_age=60, balances={3: 60_000_000})
    periods = {(s["person"], s["label"]): s["payout_years"] for s in project([me, partner], A, 2026)["summary"]["streams"]}
    assert periods == {("me", "개인연금"): 35, ("me", "퇴직연금(DB)"): 30, ("partner", "개인연금"): 27}


def test_extra_layer_is_computed_like_private_but_kept_out_of_base_total():
    """4층 추가연금(세제비적격·ISA): 3층과 같은 확정기간 월액을 계산하되 기본 합계·부족액에는 넣지 않고 extra_*로 따로 돌려준다 (2026-11-02 사용자)."""
    me = Person("me", "나", age=50, retire_age=60, private_start_age=60, balances={3: 60_000_000, 4: 30_000_000})
    pr = project([me], A, 2026, monthly_need=3_000_000)
    row = next(r for r in pr["rows"] if r["ages"]["me"] == 60)
    assert row["layers_real"][4] > 0 and row["extra_real"] == row["layers_real"][4]
    assert row["total_real"] == row["layers_real"][3] and row["gap_real"] == row["total_real"] - 3_000_000
    assert row["coverage"]["with_extra"] > row["coverage"]["total"]
    s4 = [s for s in pr["summary"]["streams"] if s["layer"] == 4]
    assert len(s4) == 1 and s4[0]["start_age"] == 60 and s4[0]["payout_years"] == A.end_age - 60
    # 4층은 3층과 같은 공식이라 적립금이 같으면 월액도 같다
    same = project([Person("me", "나", age=50, retire_age=60, private_start_age=60, balances={3: 30_000_000, 4: 30_000_000})], A, 2026)
    r60 = next(r for r in same["rows"] if r["ages"]["me"] == 60)
    assert r60["layers_real"][3] == r60["layers_real"][4]


def test_national_early_late_factor_and_options_breakeven():
    """조기 1년당 6% 감액·연기 1년당 7.2% 증액(최대 5년). 손익분기: 5년 조기 ≈ 76.7세, 5년 연기 ≈ 83.9세. 추천 없음."""
    me = Person("me", "나", age=55, retire_age=60, national_monthly=1_000_000, national_start_age=65, national_normal_age=65)
    opts = national_options(me, A, 2026)
    by = {o["shift"]: o for o in opts}
    assert len(opts) == 11 and by[0]["monthly_real"] == 1_000_000 and by[0]["selected"] and by[0]["breakeven_age"] is None
    assert by[-5]["monthly_real"] == 700_000 and by[-5]["start_age"] == 60 and by[-5]["gap_years"] == 0 and abs(by[-5]["breakeven_age"] - 76.7) < 0.1
    assert by[5]["monthly_real"] == 1_360_000 and by[5]["start_age"] == 70 and by[5]["gap_years"] == 10 and abs(by[5]["breakeven_age"] - 83.9) < 0.1
    early = Person("me", "나", age=55, retire_age=60, national_monthly=1_000_000, national_start_age=60, national_normal_age=65)
    s = [x for x in person_streams(early, A) if x.layer == 1][0]
    assert s.start_age == 60 and s.monthly_first == round(700_000 * (1 + A.inflation) ** 5)
    # 법정 나이를 모르면(기존 테스트·입력) 배율 없이 입력 월액 그대로
    plain = [x for x in person_streams(Person("me", "나", age=55, retire_age=60, national_monthly=1_000_000, national_start_age=60), A) if x.layer == 1][0]
    assert plain.monthly_first == round(1_000_000 * (1 + A.inflation) ** 5)


def test_survivor_check_is_rough_pick_larger():
    me = Person("me", "나", 60, 60, national_monthly=1_200_000, national_start_age=65, national_normal_age=65)
    pa = Person("partner", "배우자", 62, 60, national_monthly=1_770_000, national_start_age=65, national_normal_age=65)
    sv = survivor_check([me, pa], A)
    t = sv["me"]["tiers"]["over_20y"]
    assert sv["me"]["deceased"] == "partner" and t["survivor_only"] == 1_062_000 and t["own_plus"] == round(1_200_000 + 1_770_000 * .6 * .3) and t["larger"] == "own_plus"
    assert sv["partner"]["tiers"]["under_10y"]["survivor_only"] == 480_000
