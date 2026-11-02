"""pension — 4층 연금 수령 시뮬레이션 (docs/CALCULATION_RULES.md §4, RETIRE-01).

순수 함수만 둔다. 기본 가정·제도 숫자는 rules/pension.yaml에서 읽는다. LLM은 이 결과를 설명만 한다.

- 1층 국민연금: 공단 예상연금액(월, 오늘 돈). 수급 개시 나이부터 받고, 명목 금액은 물가만큼 해마다 오른다(오늘 돈으로는 그대로).
- 2층 퇴직연금: DC·IRP 적립금 FV / DB 퇴직금(월 평균임금 × 은퇴까지 근속연수, 오늘 돈 — 임금은 물가만큼만 오른다고 본다)은
  퇴직 때 IRP로 옮겨 같은 방식으로 받는다.
- 3층 개인연금(연금저축): 적립금 FV.
- 사적연금 수령은 확정기간형: 개시 나이 ~ 종료 나이, 매달 같은 명목 금액.
- 납입은 은퇴 나이(또는 개시 나이 중 이른 쪽)까지만, 그 뒤는 수익률로만 불어난다.
- 세전 금액이다. 연금소득세·연금수령한도(§5)는 아직 반영하지 않는다.
- 계산 단위는 1년. 나이는 기준 연도의 만 나이 + 경과 연수.
"""
from __future__ import annotations

import os
import calendar
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import yaml

PENSION_PATH = Path(__file__).resolve().parents[1] / "rules" / "pension.yaml"
LAYER_LABELS = {1: "국민연금", 2: "퇴직연금", 3: "개인연금", 4: "추가연금"}


def load_pension_rules(path: str | Path | None = None) -> dict:
    p = Path(path or os.environ.get("RETIRE_PENSION_PATH") or PENSION_PATH)
    return yaml.safe_load(p.read_text(encoding="utf-8"))


def spending_budget_totals(budget: dict) -> dict:
    """오늘 돈 월 예산. 연 세금/12는 원 단위 반올림(0.5원 올림). 세액을 추정하지 않는다."""
    for key, value in budget.items():
        if type(value) is not int or value < 0:
            raise ValueError("생활비 항목은 0 이상의 정수로 입력해 주세요.")
    for key, maximum in (("people", 10), ("meals_per_day", 10), ("days_per_month", 31)):
        if not 1 <= budget[key] <= maximum:
            raise ValueError("식비의 인원·끼니 수·일수를 확인해 주세요.")
    food = budget["meal_cost"] * budget["people"] * budget["meals_per_day"] * budget["days_per_month"]
    tax = (budget["housing_tax_annual"] + 6) // 12
    monthly = food + tax + sum(budget[key] for key in (
        "allowance_monthly", "living_monthly", "insurance_monthly", "medical_monthly",
        "health_insurance_monthly", "irregular_monthly", "other_monthly"))
    if monthly > 10**12:
        raise ValueError("월 생활비 합계는 1조 원 이하여야 해요.")
    return {"food_monthly": food, "housing_tax_monthly": tax, "monthly_total": monthly}


def national_start_age(birth_year: int, rules: dict) -> int:
    for row in rules["national_start_age"]:
        if birth_year <= row["born_until"]:
            return int(row["age"])
    raise ValueError("국민연금 개시 나이 표에 맞는 출생연도가 없습니다")


def future_value(balance: float, annual: float, r: float, years: int, contrib_years: int | None = None) -> float:
    """적립금 FV = 잔고×(1+r)^n + 연 납입×[((1+r)^k − 1)/r]×(1+r)^(n−k). k = 납입 연수(기본 n)."""
    n = max(0, years)
    k = n if contrib_years is None else max(0, min(contrib_years, n))
    grow = (1 + r) ** n
    paid = annual * k if r == 0 else annual * ((1 + r) ** k - 1) / r
    return balance * grow + paid * (1 + r) ** (n - k)


def annuity_monthly(principal: float, r: float, months: int) -> float:
    """확정기간형 월 수령액 = FV × r_m / (1 − (1+r_m)^(−m)). r_m = (1+r)^(1/12) − 1."""
    if months <= 0:
        raise ValueError("수령 개월 수는 1 이상이어야 합니다")
    rm = (1 + r) ** (1 / 12) - 1
    return principal / months if rm == 0 else principal * rm / (1 - (1 + rm) ** (-months))


def db_at_retire(accrued_now: int, monthly_wage: int, years_left: int) -> int:
    """DB형 은퇴 때 퇴직금(오늘 돈) = 지금 쌓인 퇴직금 + 월급 × 남은 근무 연수.
    DB 퇴직금은 1년에 한 달 치 평균임금(법정식 1일 평균임금×30×근속일수/365)씩 쌓인다.
    월급 = 최근 3개월 급여 총액 ÷ 3. 임금은 물가만큼만 오른다고 본다(오늘 돈 기준 그대로)."""
    if accrued_now < 0 or monthly_wage < 0:
        raise ValueError("퇴직금·월급은 0 이상이어야 해요")
    return accrued_now + monthly_wage * max(0, years_left)


def _anniversary(day: date, years: int) -> date:
    year = day.year + years
    return day.replace(year=year, day=min(day.day, calendar.monthrange(year, day.month)[1]))


def service_period(start: date, end: date) -> dict:
    """기준일 직전까지 근속. 달력상 년·개월과 실제 일수를 함께 반환한다."""
    if start > end:
        raise ValueError("입사일은 기준일보다 늦을 수 없어요")
    months = (end.year - start.year) * 12 + end.month - start.month
    anchor = end.replace(day=min(start.day, calendar.monthrange(end.year, end.month)[1]))
    if anchor > end:
        months -= 1
    return {"years": months // 12, "months": months % 12, "days": (end - start).days}


def db_estimate(*, monthly_wage: int, accrued_now: int, start_date: date | None,
                as_of: date, years_left: int | None, method: str, rules: dict) -> dict:
    """DB형 세전·오늘 돈 추정. 회사 확인액과 입사일 추정을 더하지 않는다.

    자동 방식은 월 평균급여를 30일분 평균임금의 근사값으로 사용한다.
    법정 확정액이 아니며, 중간정산/제외기간/상여·연차/통상임금 비교는 미반영.
    """
    if min(monthly_wage, accrued_now) < 0:
        raise ValueError("퇴직금·월급은 0 이상이어야 해요")
    if method not in ("reported", "tenure"):
        raise ValueError("퇴직금 계산 방식을 확인해 주세요")
    period = service_period(start_date, as_of) if start_date else None
    missing = []
    if method == "tenure":
        if not start_date:
            missing.append("입사일")
        if not monthly_wage:
            missing.append("세전 월 평균급여")
    result = {"method": method, "as_of": as_of.isoformat(), "tenure": period,
              "missing": missing, "accrued_now": None, "lump_at_retire": None, "timeline": []}
    if missing:
        return result

    def amount_at(years: int) -> dict:
        day = _anniversary(as_of, years)
        tenure = service_period(start_date, day) if start_date else None
        if method == "tenure":
            eligible = day >= _anniversary(start_date, rules["db"]["minimum_service_years"])
            amount = round(monthly_wage * tenure["days"] / rules["db"]["service_days_per_year"]) if eligible else 0
        else:
            eligible = None
            amount = db_at_retire(accrued_now, monthly_wage, years)
        return {"year": day.year, "date": day.isoformat(), "tenure": tenure,
                "amount": amount, "eligible": eligible}

    current = amount_at(0)
    result["accrued_now"] = current["amount"]
    result["eligible_now"] = current["eligible"]
    if years_left is not None:
        result["timeline"] = [amount_at(y) for y in range(max(0, years_left) + 1)]
        result["lump_at_retire"] = result["timeline"][-1]["amount"]
    return result


def monthly_cost_at(monthly_today: int, inflation: float, years: int) -> int:
    """같은 생활 수준에 필요한 명목 월 생활비. 연 단위 복리, 마지막에 원 단위 반올림."""
    if monthly_today < 0 or inflation < 0:
        raise ValueError("생활비·물가상승률은 0 이상이어야 해요")
    return round(monthly_today * (1 + inflation) ** max(0, years))


def spending_target(monthly_today: int | None, inflation: float, base_year: int,
                    age: int, retire_age: int) -> dict | None:
    """가구 생활비의 은퇴 첫해 환산. 이미 은퇴했으면 올해, 미입력은 0원과 구분."""
    if monthly_today is None:
        return None
    years = max(0, retire_age - age)
    nominal = monthly_cost_at(monthly_today, inflation, years)
    return {"base_year": base_year, "target_year": base_year + years, "years": years,
            "monthly_today": monthly_today, "monthly_nominal": nominal,
            "monthly_increase": nominal - monthly_today, "inflation": inflation}


@dataclass(frozen=True)
class Assumptions:
    return_rate: float
    inflation: float
    end_age: int
    start_age_min: int
    min_payout_years: int
    # 국민연금 조기·연기·유족 (rules/pension.yaml national). 기본값은 공단 안내의 일반 규칙
    nat_early: float = 0.06
    nat_late: float = 0.072
    nat_shift_max: int = 5
    survivor_rates: dict = field(default_factory=lambda: {"under_10y": 0.4, "under_20y": 0.5, "over_20y": 0.6})
    survivor_overlap: float = 0.3

    @classmethod
    def from_rules(cls, rules: dict, **override) -> "Assumptions":
        a, p, n = rules["assumptions"], rules["private"], rules.get("national", {})
        base = dict(return_rate=a["return_rate"], inflation=a["inflation"], end_age=a["end_age"],
                    start_age_min=p["start_age_min"], min_payout_years=p["min_payout_years"],
                    nat_early=n.get("early_reduction_per_year", 0.06), nat_late=n.get("late_increase_per_year", 0.072),
                    nat_shift_max=n.get("shift_years_max", 5), survivor_rates=dict(n.get("survivor_rates") or {"under_10y": 0.4, "under_20y": 0.5, "over_20y": 0.6}),
                    survivor_overlap=n.get("survivor_overlap_rate", 0.3))
        base.update({k: v for k, v in override.items() if v is not None})
        return cls(**base)


@dataclass(frozen=True)
class Person:
    key: str                       # me | partner
    label: str
    age: int                       # 기준 연도의 만 나이
    retire_age: int
    national_monthly: int = 0      # 국민연금 예상 월액 (오늘 돈)
    national_start_age: int = 65
    national_normal_age: int | None = None   # 출생연도 기준 법정 개시 나이. 있으면 조기·연기 감액·증액을 적용한다
    private_start_age: int = 55
    balances: dict[int, int] = field(default_factory=dict)   # 층(2·3·4) → 현재 적립금. 4층 = 세제비적격 연금보험·ISA 등 추가 자금
    annual: dict[int, int] = field(default_factory=dict)     # 층(2·3) → 연 납입
    db_lump: int = 0               # DB 예상 퇴직금 (오늘 돈)


@dataclass(frozen=True)
class Stream:
    person: str
    layer: int
    label: str
    start_age: int
    principal: int                 # 개시 시점 적립금 (명목). 국민연금은 0
    monthly_first: int             # 개시 첫해 월 수령액 (명목)
    real: bool                     # True면 물가만큼 오르는 금액(국민연금)

    def monthly_nominal(self, years_from_start: int, inflation: float) -> float:
        return self.monthly_first * ((1 + inflation) ** years_from_start if self.real else 1)


def check_person(p: Person, a: Assumptions) -> list[str]:
    errs = []
    if p.private_start_age < a.start_age_min:
        errs.append(f"{p.label}: 연금 개시 나이는 {a.start_age_min}세 이상이어야 해요")
    if a.end_age - max(p.private_start_age, p.age) < a.min_payout_years:
        errs.append(f"{p.label}: 사적연금은 최소 {a.min_payout_years}년 나눠 받아야 해요 (종료 {a.end_age}세)")
    if p.national_start_age >= a.end_age:
        errs.append(f"{p.label}: 국민연금 개시 나이가 시뮬레이션 끝({a.end_age}세)보다 늦어요")
    if any(v < 0 for v in [*p.balances.values(), *p.annual.values(), p.national_monthly, p.db_lump]):
        errs.append(f"{p.label}: 금액은 0 이상이어야 해요")
    return errs


def person_streams(p: Person, a: Assumptions) -> list[Stream]:
    errs = check_person(p, a)
    if errs:
        raise ValueError(" / ".join(errs))
    r, pi = a.return_rate, a.inflation
    out: list[Stream] = []
    if p.national_monthly > 0:
        nat_start = max(p.national_start_age, p.age)
        # 법정 나이보다 앞당기면 감액, 늦추면 증액 (조기·연기연금). 법정 나이를 모르면 입력 월액 그대로
        monthly = p.national_monthly * national_factor(p.national_start_age - p.national_normal_age if p.national_normal_age else 0, a)
        out.append(Stream(p.key, 1, "국민연금", nat_start, 0,
                          round(monthly * (1 + pi) ** (nat_start - p.age)), True))

    def private(layer: int, label: str, start: int, principal: float) -> None:
        if principal <= 0:
            return
        months = (a.end_age - start) * 12
        out.append(Stream(p.key, layer, label, start, round(principal), round(annuity_monthly(principal, r, months)), False))

    start = max(p.private_start_age, p.age)
    contrib = min(p.retire_age, start) - p.age
    for layer, label in ((2, "퇴직연금(DC·IRP)"), (3, "개인연금")):
        fv = future_value(p.balances.get(layer, 0), p.annual.get(layer, 0), r, start - p.age, contrib)
        private(layer, label, start, fv)
    # 4층 추가연금: 3층과 같은 확정기간 방식으로 "월급으로 나눠 쓰면" 얼마인지 계산한다. 기본 합계에는 넣지 않는다 (project 참고).
    private(4, "추가연금", start, future_value(p.balances.get(4, 0), 0, r, start - p.age, contrib))
    if p.db_lump > 0:   # 퇴직 때 받은 DB 퇴직금을 IRP로 옮겨 개시 나이(퇴직 전이면 퇴직 나이)부터 받는다
        retire = max(p.retire_age, p.age)
        db_start = max(start, retire)
        if a.end_age - db_start < a.min_payout_years:
            raise ValueError(f"{p.label}: 퇴직(DB) 뒤 {a.min_payout_years}년 이상 나눠 받을 수 없어요")
        lump = p.db_lump * (1 + pi) ** (retire - p.age)
        private(2, "퇴직연금(DB)", db_start, lump * (1 + r) ** (db_start - retire))
    return out


def national_factor(shift_years: int, a: Assumptions) -> float:
    """법정 개시 나이 대비 몇 년 앞당기거나(−) 늦추는지(+) → 월액 배율. 범위 밖은 최대치로 자른다."""
    s = max(-a.nat_shift_max, min(a.nat_shift_max, int(shift_years)))
    return 1 - a.nat_early * (-s) if s < 0 else 1 + a.nat_late * s


def national_options(p: Person, a: Assumptions, base_year: int) -> list[dict]:
    """조기~연기 선택지. 월액은 오늘 돈(입력 월액 × 배율), 손익분기 나이는 정상 수령과 누적액이 같아지는 나이
    (둘 다 물가에 연동되므로 오늘 돈 기준 단순 비교, 수익률·세금 미반영). 어느 것도 추천하지 않는다."""
    if not p.national_normal_age or p.national_monthly <= 0:
        return []
    normal, out = p.national_normal_age, []
    for shift in range(-a.nat_shift_max, a.nat_shift_max + 1):
        f = national_factor(shift, a)
        start = normal + shift
        if shift > 0:
            breakeven = start + shift / (f - 1)
        elif shift < 0:
            breakeven = normal + (-shift) * f / (1 - f)
        else:
            breakeven = None
        out.append({"shift": shift, "start_age": start, "start_year": base_year + start - p.age, "factor": round(f, 4),
                    "monthly_real": round(p.national_monthly * f), "gap_years": max(0, start - p.retire_age),
                    "breakeven_age": round(breakeven, 1) if breakeven is not None else None,
                    "selected": start == p.national_start_age})
    return out


def survivor_check(people: list[Person], a: Assumptions) -> dict:
    """한 사람이 먼저 떠났을 때 남은 사람의 국민연금 — 대충 보기. 유족연금 = 사망자 월액 × 가입기간 비율.
    남은 사람도 노령연금이 있으면 택1: 본인 + 유족연금×30% / 유족연금만. 부양가족연금액·실제 가입기간·세금은 반영하지 않는다."""
    out = {}
    for s in people:
        for d in people:
            if d.key == s.key or d.national_monthly <= 0:
                continue
            tiers = {}
            for tier, rate in a.survivor_rates.items():
                survivor_only = round(d.national_monthly * rate)
                own_plus = round(s.national_monthly + d.national_monthly * rate * a.survivor_overlap)
                tiers[tier] = {"survivor_only": survivor_only, "own_plus": own_plus, "larger": "own_plus" if own_plus >= survivor_only else "survivor_only"}
            out[s.key] = {"survivor": s.key, "deceased": d.key, "own_monthly": s.national_monthly, "deceased_monthly": d.national_monthly, "tiers": tiers}
    return out


def project(people: list[Person], a: Assumptions, base_year: int, monthly_need: int | None = None) -> dict:
    """연도별 가구 월 수령액(명목·오늘 돈)과 요약. monthly_need는 은퇴 후 가구 월 생활비(오늘 돈)."""
    if not people:
        raise ValueError("나이를 입력한 사람이 없어요")
    streams = [s for p in people for s in person_streams(p, a)]
    by_key = {p.key: p for p in people}
    first = people[0]          # 가구 은퇴 기준 = 첫 사람(나)
    years = max(a.end_age - p.age for p in people)
    rows = []
    for t in range(0, max(years, 1)):   # 마지막 줄 = 가장 젊은 사람이 종료 나이 직전
        y = base_year + t
        deflate = (1 + a.inflation) ** t
        items = []
        for s in streams:
            age = by_key[s.person].age + t
            if s.start_age <= age < a.end_age:
                nom = s.monthly_nominal(age - s.start_age, a.inflation)
                items.append({"person": s.person, "layer": s.layer, "label": s.label,
                              "nominal": round(nom), "real": round(nom / deflate)})
        # 기본 합계(total_*)는 1~3층. 4층 추가연금은 '월급으로 나눠 쓰면'의 참고값(extra_*)으로 따로 둔다 —
        # 목돈으로 둘지 월급에 보탤지는 사용자가 정한다(2026-11-02). 부족액·충당률도 기본 합계 기준.
        core = [i for i in items if i["layer"] != 4]
        total_nom = sum(i["nominal"] for i in core)
        total_real = sum(i["real"] for i in core)
        extra_nom = sum(i["nominal"] for i in items if i["layer"] == 4)
        extra_real = sum(i["real"] for i in items if i["layer"] == 4)
        retired = first.age + t >= first.retire_age
        row = {"year": y, "ages": {p.key: p.age + t for p in people}, "retired": retired,
               "items": items, "total_nominal": total_nom, "total_real": total_real,
               "extra_nominal": extra_nom, "extra_real": extra_real,
               "layers_real": {k: sum(i["real"] for i in items if i["layer"] == k) for k in LAYER_LABELS}}
        if monthly_need is not None:
            row["need_real"] = monthly_need if retired else None
            row["gap_real"] = total_real - monthly_need if retired else None
            row["need_nominal"] = monthly_cost_at(monthly_need, a.inflation, t) if retired else None
            row["gap_nominal"] = total_nom - row["need_nominal"] if retired else None
        # The common denominator is household spending, never an invented maximum
        # balance or an allocation of targets to individual pension layers.
        row["coverage"] = ({"total": total_real / monthly_need * 100, "with_extra": (total_real + extra_real) / monthly_need * 100,
                            "layers": {k: v / monthly_need * 100 for k, v in row["layers_real"].items()}}
                           if retired and monthly_need is not None and monthly_need > 0 else None)
        rows.append(row)

    retired_rows = [r for r in rows if r["retired"]]
    summary: dict = {"retire_year": retired_rows[0]["year"] if retired_rows else None,
                     "at_retire_real": retired_rows[0]["total_real"] if retired_rows else None,
                     "streams": [s.__dict__ | {"start_year": base_year + s.start_age - by_key[s.person].age,
                                              "payout_years": None if s.layer == 1 else a.end_age - s.start_age,
                                              "end_age_exclusive": None if s.layer == 1 else a.end_age} for s in streams]}
    if streams:
        all_on = max(base_year + s.start_age - by_key[s.person].age for s in streams)
        row = next((r for r in rows if r["year"] == all_on), None)
        summary["all_started_year"] = all_on
        summary["all_started_real"] = row["total_real"] if row else None
    no_income = [r["year"] for r in retired_rows if r["total_real"] == 0]
    summary["no_income_years"] = len(no_income)
    if monthly_need is not None:
        short = [r for r in retired_rows if r["gap_real"] < 0]
        summary["short_years"] = len(short)
        summary["short_total_real"] = -sum(r["gap_real"] * 12 for r in short)
        summary["first_covered_year"] = next((r["year"] for r in retired_rows if r["gap_real"] >= 0), None)
    return {"rows": rows, "summary": summary,
            "assumptions": a.__dict__, "base_year": base_year, "monthly_need": monthly_need}
