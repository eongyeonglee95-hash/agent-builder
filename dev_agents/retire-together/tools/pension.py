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
from dataclasses import dataclass, field
from pathlib import Path

import yaml

PENSION_PATH = Path(__file__).resolve().parents[1] / "rules" / "pension.yaml"
LAYER_LABELS = {1: "국민연금", 2: "퇴직연금", 3: "개인연금"}


def load_pension_rules(path: str | Path | None = None) -> dict:
    p = Path(path or os.environ.get("RETIRE_PENSION_PATH") or PENSION_PATH)
    return yaml.safe_load(p.read_text(encoding="utf-8"))


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

    @classmethod
    def from_rules(cls, rules: dict, **override) -> "Assumptions":
        a, p = rules["assumptions"], rules["private"]
        base = dict(return_rate=a["return_rate"], inflation=a["inflation"], end_age=a["end_age"],
                    start_age_min=p["start_age_min"], min_payout_years=p["min_payout_years"])
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
    private_start_age: int = 55
    balances: dict[int, int] = field(default_factory=dict)   # 층(2·3) → 현재 적립금
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
        out.append(Stream(p.key, 1, "국민연금", nat_start, 0,
                          round(p.national_monthly * (1 + pi) ** (nat_start - p.age)), True))

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
    if p.db_lump > 0:   # 퇴직 때 받은 DB 퇴직금을 IRP로 옮겨 개시 나이(퇴직 전이면 퇴직 나이)부터 받는다
        retire = max(p.retire_age, p.age)
        db_start = max(start, retire)
        if a.end_age - db_start < a.min_payout_years:
            raise ValueError(f"{p.label}: 퇴직(DB) 뒤 {a.min_payout_years}년 이상 나눠 받을 수 없어요")
        lump = p.db_lump * (1 + pi) ** (retire - p.age)
        private(2, "퇴직연금(DB)", db_start, lump * (1 + r) ** (db_start - retire))
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
        total_nom = sum(i["nominal"] for i in items)
        total_real = sum(i["real"] for i in items)
        retired = first.age + t >= first.retire_age
        row = {"year": y, "ages": {p.key: p.age + t for p in people}, "retired": retired,
               "items": items, "total_nominal": total_nom, "total_real": total_real,
               "layers_real": {k: sum(i["real"] for i in items if i["layer"] == k) for k in LAYER_LABELS}}
        if monthly_need is not None:
            row["need_real"] = monthly_need if retired else None
            row["gap_real"] = total_real - monthly_need if retired else None
            row["need_nominal"] = monthly_cost_at(monthly_need, a.inflation, t) if retired else None
            row["gap_nominal"] = total_nom - row["need_nominal"] if retired else None
        # The common denominator is household spending, never an invented maximum
        # balance or an allocation of targets to individual pension layers.
        row["coverage"] = ({"total": total_real / monthly_need * 100,
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
