"""retirement — 워크북 '은퇴' 시트의 연금 계획 저장·수령 시뮬레이션 (RETIRE-01, Claude 담당).

- GET /api/retirement      : 저장한 계획 + 가족 정보(나이·은퇴 목표) + 등록 자산의 층별 적립금 → tools.pension 계산 결과
- PUT /api/retirement/plan : 계획 저장 (버전 검사). 저장 위치는 같은 로컬 SQLite의 retirement_plan 표.

적립금은 다시 입력받지 않는다 — '자산' 시트의 노후 주머니(계좌 종류로 층을 나눔)를 그대로 쓴다.
계산·문장은 코드. 화면이 보낸 숫자를 그대로 믿지 않고 저장된 계획과 장부로 다시 계산한다.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import Field, field_validator

from backend import registration, storage
from backend.storage import InputModel
from tools.assets import load_accounts
from tools.pension import (LAYER_LABELS, Assumptions, Person, db_estimate, load_pension_rules, national_start_age, project, spending_target)

router = APIRouter(prefix="/api/retirement", tags=["retirement"])

Won = Annotated[int, Field(strict=True, ge=0, le=10**12)]
Age = Annotated[int, Field(strict=True, ge=18, le=100)]


class PersonPlan(InputModel):
    retire_age: Age | None = None           # 비우면 가족 정보의 은퇴 목표(나 기준, 배우자는 같은 해)
    national_monthly: Won = 0               # 국민연금 예상 월액 (오늘 돈) — 국민연금공단 '내 연금 알아보기'
    national_start_age: Age | None = None   # 비우면 출생연도 표
    private_start_age: Age | None = None    # 비우면 max(55, 은퇴 나이)
    irp_annual: Won = 0                     # 퇴직연금(DC 회사 적립 + IRP 본인 납입) 연 납입
    savings_annual: Won = 0                 # 연금저축 연 납입
    db_monthly_wage: Won = 0                # DB형 세전 월 평균급여 (최근 3개월 급여 총액 ÷ 3)
    db_accrued: Won = 0                     # DB형 지금 쌓인 퇴직금 (회사 '예상 퇴직금 조회')
    db_lump: Won = 0                        # 예전 입력: 회사가 알려 준 은퇴 시 예상 퇴직금
    db_method: Literal["reported", "tenure"] = "reported"
    db_start_date: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")] | None = None

    @field_validator("db_start_date")
    @classmethod
    def check_start_date(cls, value):
        if value is not None:
            day = dt.date.fromisoformat(value)
            if day > dt.date.today():
                raise ValueError("입사일은 오늘보다 늦을 수 없어요")
        return value


class PlanInput(InputModel):
    me: PersonPlan = PersonPlan()
    partner: PersonPlan = PersonPlan()
    monthly_need: Won | None = None         # 은퇴 후 부부 월 생활비 (오늘 돈)
    return_rate: Annotated[float, Field(ge=0, le=0.15)] | None = None
    inflation: Annotated[float, Field(ge=0, le=0.1)] | None = None
    version: Annotated[int, Field(strict=True, ge=0)]


def _table(conn) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS retirement_plan (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, version INTEGER NOT NULL)")


def get_plan() -> dict:
    with storage.connection() as conn:
        _table(conn)
        row = conn.execute("SELECT payload, version FROM retirement_plan WHERE id=1").fetchone()
    base = PlanInput(version=0).model_dump(exclude={"version"})
    if not row:
        return {**base, "version": 0}
    saved = json.loads(row["payload"])
    for who in ("me", "partner"):
        saved[who] = {**base[who], **{k: v for k, v in (saved.get(who) or {}).items() if k in PersonPlan.model_fields}}
    return {**base, **{k: v for k, v in saved.items() if k in base}, "version": row["version"]}


def save_plan(data: PlanInput) -> dict:
    with storage.connection() as conn:
        _table(conn)
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT version FROM retirement_plan WHERE id=1").fetchone()
        if (row["version"] if row else 0) != data.version:
            raise HTTPException(409, "다른 화면에서 은퇴 계획이 바뀌었어요. 새로고침 후 다시 입력해 주세요.")
        payload = data.model_dump(exclude={"version"})
        conn.execute("INSERT INTO retirement_plan VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, version=excluded.version",
                     (json.dumps(payload, ensure_ascii=False), data.version + 1))
    return {**payload, "version": data.version + 1}


_IRP = re.compile(r"IRP|퇴직|DC", re.IGNORECASE)
# 세제비적격(연금보험·변액연금보험)·ISA·그 밖의 은퇴 자금은 4층. 연금저축(펀드·보험·신탁)은 세제적격이라 3층 (2026-11-02 사용자 "일반연금보험은 세제비적격, 추가연금으로")
_EXTRA = re.compile(r"ISA|연금보험|추가연금|추가 자금", re.IGNORECASE)


def layer_of(asset: dict, accounts: dict[str, dict]) -> int:
    """노후 주머니 자산의 연금 층. 사용자가 고른 pension_layer → 등록 계좌의 layer → 계좌 이름(IRP·퇴직·DC → 2, 연금저축 → 3, 연금보험·ISA·추가연금 → 4, 나머지 3)."""
    if asset.get("pension_layer") in (2, 3, 4):
        return int(asset["pension_layer"])
    acct = accounts.get(asset.get("account_id") or "")
    if acct and acct.get("layer"):
        return int(acct["layer"])
    name = asset.get("account", "")
    if _IRP.search(name):
        return 2
    if "연금저축" in name:
        return 3
    return 4 if _EXTRA.search(name) else 3


def balances() -> dict[str, dict[int, int]]:
    accounts = load_accounts(registration.accounts_path())
    out: dict[str, dict[int, int]] = {"me": {}, "partner": {}}
    for a in storage.dashboard("together")["assets"]:
        if a["pocket"] != "retirement" or a["owner"] not in out:
            continue
        layer = layer_of(a, accounts)
        out[a["owner"]][layer] = out[a["owner"]].get(layer, 0) + a["amount"]
    return out


def build(plan: dict, family: dict | None, bal: dict[str, dict[int, int]], base_year: int, rules: dict,
          as_of: dt.date | None = None) -> dict:
    """계획·가족 정보·적립금 → 계산에 쓴 사람별 값(기본값 채움)과 시뮬레이션. 빠진 입력은 missing으로 알린다."""
    a = Assumptions.from_rules(rules, return_rate=plan.get("return_rate"), inflation=plan.get("inflation"))
    family = family or {}
    me_f, pa_f = family.get("me") or {}, family.get("partner") or {}
    goal = family.get("retirement_age")
    as_of = as_of or dt.date(base_year, 1, 1)
    missing, people, used, db_estimates = [], [], {}, {}
    for key, label, f in (("me", "나", me_f), ("partner", "배우자", pa_f)):
        age, pp = f.get("age"), plan.get(key) or {}
        retire = pp.get("retire_age")
        if retire is None and goal is not None and age is not None:
            retire = goal if key == "me" else (goal + age - me_f["age"] if me_f.get("age") is not None else goal)
        estimate = db_estimate(monthly_wage=pp.get("db_monthly_wage") or 0,
                               accrued_now=pp.get("db_accrued") or 0,
                               start_date=dt.date.fromisoformat(pp["db_start_date"]) if pp.get("db_start_date") else None,
                               as_of=as_of, years_left=max(retire - age, 0) if retire is not None and age is not None else None,
                               method=pp.get("db_method") or "reported", rules=rules)
        db_estimates[key] = estimate
        if key == "partner" and not pa_f:
            continue
        if age is None:
            missing.append(f"{label} 나이")
            continue
        if retire is None:
            missing.append(f"{label} 은퇴 나이")
            continue
        b = bal.get(key, {})
        wage, accrued = pp.get("db_monthly_wage") or 0, pp.get("db_accrued") or 0
        db = None
        if wage or accrued or pp.get("db_method") == "tenure":
            left = max(retire - age, 0)
            db = {"years_left": left, "lump_at_retire": estimate["lump_at_retire"] or 0}
        p = Person(key, label, age, retire,
                   national_monthly=pp.get("national_monthly") or 0,
                   national_start_age=pp.get("national_start_age") or national_start_age(base_year - age, rules),
                   private_start_age=pp.get("private_start_age") or max(a.start_age_min, min(retire, a.end_age - a.min_payout_years)),
                   balances={2: b.get(2, 0), 3: b.get(3, 0), 4: b.get(4, 0)},
                   annual={2: pp.get("irp_annual") or 0, 3: pp.get("savings_annual") or 0},
                   db_lump=db["lump_at_retire"] if db else (pp.get("db_lump") or 0))
        people.append(p)
        used[key] = {"age": age, "retire_age": retire, "national_start_age": p.national_start_age,
                     "private_start_age": p.private_start_age, "balances": {str(k): v for k, v in b.items()}, "db": db}
    result = {"plan": plan, "used": used, "missing": missing, "assumptions": a.__dict__, "base_year": base_year,
              "as_of": as_of.isoformat(), "db_estimates": db_estimates,
              "layer_labels": LAYER_LABELS, "projection": None, "error": None, "spending_target": None,
              "capital": {key: {"balances": {str(k): v for k, v in bal.get(key, {}).items() if k in (2, 3, 4)},
                                "db_accrued": db_estimates[key]["accrued_now"] or 0}
                          for key in ("me", "partner")}}
    if not people or "me" not in used:   # 가구 은퇴 기준은 나 — 내 값이 빠지면 계산하지 않는다
        return result
    result["spending_target"] = spending_target(plan.get("monthly_need"), a.inflation, base_year,
                                                 used["me"]["age"], used["me"]["retire_age"])
    try:
        result["projection"] = project(people, a, base_year, plan.get("monthly_need"))
    except ValueError as e:
        result["error"] = str(e)
    return result


def line(result: dict) -> str:
    """한 줄 요약 — 코드 템플릿. 세전·오늘 돈 기준임을 문장에 넣는다."""
    pr = result.get("projection")
    if result.get("error"):
        return f"은퇴 계산을 못 했어요: {result['error']}"
    if not pr:
        return "은퇴 계산에 필요한 값: " + ", ".join(result["missing"]) if result["missing"] else "은퇴 계산 전이에요."
    s = pr["summary"]
    man = lambda n: f"{round(n / 10_000):,}만원"
    parts = []
    if s["retire_year"]:
        parts.append(f"{s['retire_year']}년 은퇴 첫해 월 {man(s['at_retire_real'])}")
    if s.get("all_started_year") and s.get("all_started_real") is not None and s["all_started_year"] != s["retire_year"]:
        parts.append(f"{s['all_started_year']}년 모든 연금 수령 시 월 {man(s['all_started_real'])}")
    if s["no_income_years"]:
        parts.append(f"연금이 없는 은퇴 기간 {s['no_income_years']}년")
    if pr.get("monthly_need") is not None:
        parts.append(f"생활비보다 부족한 해 {s['short_years']}년, 모자란 돈 합계 {man(s['short_total_real'])}" if s["short_years"]
                     else "은퇴 뒤 모든 해에 생활비를 채워요")
    return " · ".join(parts) + " (세전·오늘 돈 기준)"


def current() -> dict:
    today = dt.date.today()
    out = build(get_plan(), storage.get_family(), balances(), today.year, load_pension_rules(), as_of=today)
    out["line"] = line(out)
    return out


@router.get("")
def retirement_api():
    return current()


@router.put("/plan")
def save_plan_api(data: PlanInput):
    for label, person in (("나", data.me), ("배우자", data.partner)):
        if person.db_method == "tenure" and (not person.db_start_date or not person.db_monthly_wage):
            raise HTTPException(422, f"{label}: 입사일로 계산하려면 입사일과 세전 월 평균급여를 입력해 주세요.")
    save_plan(data)
    return current()


@router.post("/preview")
def preview_plan_api(data: PlanInput):
    """입력 중 계산만 수행한다. 저장·버전 변경·자산 갱신 없음."""
    today = dt.date.today()
    return build(data.model_dump(), storage.get_family(), balances(), today.year, load_pension_rules(), as_of=today)
