"""부동산 목표·비교 후보와 소유자 범위별 갈아타기 계획. 장부와 분리 저장."""
from __future__ import annotations

import datetime as dt
import json
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Path, Query
from pydantic import Field, model_validator

from backend import storage
from backend import property as prop
from backend.property import Address, list_homes
from backend.storage import InputModel, Money
from tools.property_move import asking_vs_trades, move_budget, price_gap, income_price_ratio, capital_shortfall
from tools.property_watch import group_trades, load_watch_rules, summarize

router = APIRouter(prefix="/api/property-move", tags=["property-move"])
Owner = Literal["together", "me", "partner"]


class Living(InputModel):
    """목표 집의 거주 정보 — 사용자가 직접 확인해 적는 메모. 자동 조회·평가 없음."""
    school: Annotated[str, Field(max_length=300)] = ""      # 학군·통학
    commute: Annotated[str, Field(max_length=300)] = ""     # 출퇴근·교통
    life: Annotated[str, Field(max_length=300)] = ""        # 생활·단지(연식·세대수·관리비·편의)
    concerns: Annotated[str, Field(max_length=300)] = ""    # 단점·확인할 것


class Member(InputModel):
    """여러 차수로 나뉜 단지의 한 구성원(국토부 이름·지번). 이름이 비면 그 필지 전체."""
    name: Annotated[str, Field(max_length=100)] = ""
    jibun: Annotated[str, Field(min_length=1, max_length=200)]


class Candidate(InputModel):
    id: UUID
    members: Annotated[list[Member], Field(max_length=30)] = []
    name: Annotated[str, Field(min_length=1, max_length=100)]
    address: Address | None = None
    area_m2: Annotated[float, Field(gt=0, le=2000)] | None = None
    price: Annotated[int, Field(strict=True, gt=0, le=1_000_000_000_000_000)] | None = None
    price_basis: Literal["manual", "trade", "asking"] = "manual"
    price_date: dt.date | None = None
    asking_low: Money | None = None
    asking_high: Money | None = None
    asking_date: dt.date | None = None
    purchase_costs: Money | None = None
    memo: Annotated[str, Field(max_length=300)] = ""
    living: Living = Living()

    @model_validator(mode="after")
    def consistent(self):
        if any(d and d > dt.date.today() for d in (self.price_date, self.asking_date)):
            raise ValueError("확인일은 미래일 수 없습니다")
        if self.asking_high is not None and (self.asking_low is None or self.asking_high < self.asking_low):
            raise ValueError("최저·최고 호가를 확인해 주세요")
        if (self.asking_low is not None) != (self.asking_date is not None):
            raise ValueError("호가와 확인일을 함께 입력해 주세요")
        if self.price_basis != "manual" and (self.price is None or self.price_date is None):
            raise ValueError("실거래·호가 기준 가격은 금액과 기준일이 필요합니다")
        return self


class PirSettings(InputModel):
    annual_me: Money | None = None
    annual_partner: Money | None = None
    lower: Annotated[float, Field(gt=0, le=100, allow_inf_nan=False)] = Field(default_factory=lambda: load_watch_rules()["pir_min"])
    upper: Annotated[float, Field(gt=0, le=100, allow_inf_nan=False)] = Field(default_factory=lambda: load_watch_rules()["pir_max"])

    @model_validator(mode="after")
    def ordered(self):
        if self.lower >= self.upper:
            raise ValueError("PIR 최솟값은 최댓값보다 작아야 합니다")
        return self


class MoveInput(InputModel):
    pir: PirSettings = Field(default_factory=PirSettings)
    version: Annotated[int, Field(strict=True, ge=0)] = 0
    source_home_ids: Annotated[list[UUID], Field(max_length=30)] = []
    cash: Money | None = None
    sale_costs: Money | None = None
    new_loan: Money = 0
    monthly_saving: Money = 0
    target_month: Annotated[str, Field(pattern=r"^(20|21)\d{2}-(0[1-9]|1[0-2])$")] | None = None
    target_id: UUID | None = None
    candidates: Annotated[list[Candidate], Field(max_length=50)] = []

    @model_validator(mode="after")
    def unique(self):
        ids = [c.id for c in self.candidates]
        if len(set(ids)) != len(ids) or len(set(self.source_home_ids)) != len(self.source_home_ids):
            raise ValueError("같은 집을 두 번 넣을 수 없습니다")
        if self.target_id and self.target_id not in ids:
            raise ValueError("목표 집은 비교 후보 중에서 선택해 주세요")
        return self


class TrackInput(InputModel):
    """오늘의 추적 기록. 가격은 화면이 보여주는 기준(실거래·호가·계획 매수가) 그대로 보낸다."""
    candidate_id: UUID
    price: Annotated[int, Field(strict=True, gt=0, le=1_000_000_000_000_000)]
    price_basis: Literal["manual", "trade", "asking"] = "manual"
    price_date: dt.date | None = None
    note: Annotated[str, Field(max_length=100)] = ""

    @model_validator(mode="after")
    def not_future(self):
        if self.price_date and self.price_date > dt.date.today():
            raise ValueError("기준일은 미래일 수 없습니다")
        return self


def _table(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS property_move (owner TEXT PRIMARY KEY, payload TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL)")
    conn.execute("CREATE TABLE IF NOT EXISTS property_track (owner TEXT NOT NULL, candidate_id TEXT NOT NULL, day TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (owner, candidate_id, day))")


def _tracks(conn, owner: Owner) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for row in conn.execute("SELECT candidate_id, day, payload FROM property_track WHERE owner=? ORDER BY day DESC", (owner,)):
        out.setdefault(row["candidate_id"], []).append({**json.loads(row["payload"]), "day": row["day"]})
    return out


def _base(plan: dict, owner: Owner, homes: list[dict] | None = None) -> tuple[dict, list[str], list[dict]]:
    if homes is None:
        homes = list_homes(owner)["homes"]
    chosen = [h for h in homes if h["asset"]["id"] in plan["source_home_ids"]]
    missing = sorted(set(plan["source_home_ids"]) - {h["asset"]["id"] for h in chosen})
    # 지워진 집은 0원으로 조용히 바꾸지 않고 계획 재확인을 요구한다.
    base = dict(sale_value=sum(h["value"] for h in chosen),
                loans=sum(h["metrics"]["loans_mine"] for h in chosen),
                deposit=sum(h["metrics"]["deposit_mine"] for h in chosen),
                sale_costs=plan["sale_costs"], cash=plan["cash"] if not missing else None,
                new_loan=plan["new_loan"], monthly=plan["monthly_saving"], target_month=plan["target_month"])
    return base, missing, chosen


def _entry(base: dict, candidate: dict, *, price: int, basis: str, price_date: str | None, note: str) -> dict:
    budget = move_budget(**base, price=price, purchase_costs=candidate["purchase_costs"])
    return {"price": price, "price_basis": basis, "price_date": price_date, "note": note,
            "home_value": base["sale_value"], "home_net": budget["sale_net"], "own_funds": budget["own_funds"],
            "gap": price_gap(home_value=base["sale_value"], target_price=price), "needed": budget["gap"],
            "costs_complete": budget["costs_complete"], "saved_at": storage.now()}


def _write_track(conn, owner: Owner, candidate_id: str, day: str, entry: dict) -> None:
    conn.execute("INSERT INTO property_track VALUES (?, ?, ?, ?) ON CONFLICT(owner, candidate_id, day) DO UPDATE SET payload=excluded.payload",
                 (owner, candidate_id, day, json.dumps(entry, ensure_ascii=False)))


def _auto_track(conn, owner: Owner, plan: dict) -> None:
    """계획을 저장할 때 가격이 있는 후보마다 오늘 기록을 남긴다 — 단, 마지막 기록과 가격·더 필요한 돈이 같으면 건너뛴다(메모만 고친 저장이 기록을 만들지 않게)."""
    base, missing, _ = _base(plan, owner)
    tracks = _tracks(conn, owner)
    today = dt.date.today().isoformat()
    for c in plan["candidates"]:
        if not c["price"]:
            continue
        entry = _entry(base, c, price=c["price"], basis=c["price_basis"], price_date=c["price_date"], note="")
        latest = next(iter(tracks.get(c["id"], [])), None)   # 오늘 것이면 오늘 것, 아니면 가장 최근 기록
        if latest and latest["price"] == entry["price"] and latest["needed"] == entry["needed"]:
            continue
        note = latest["note"] if latest and latest["day"] == today else ""
        _write_track(conn, owner, c["id"], today, {**entry, "note": note})


def read_plan(owner: Owner) -> dict:
    with storage.connection() as conn:
        _table(conn)
        row = conn.execute("SELECT * FROM property_move WHERE owner=?", (owner,)).fetchone()
    return {**json.loads(row["payload"]), "version": row["version"]} if row else MoveInput().model_dump(mode="json")


def _capital(owner: Owner, homes: dict | None = None, dashboard: dict | None = None) -> dict:
    if homes is None:
        homes = list_homes(owner)
    if dashboard is None:
        dashboard = storage.dashboard(owner)
    # 재원 = 모든 집 순자산 + 현금 주머니 전체(현금 + 주식 등), 연금 제외 (CALCULATION_RULES §6-F)
    pocket = [a for a in dashboard["assets"] if a["pocket"] == "cash"]
    cash = sum(a["amount"] for a in pocket if a["assetClass"] == "cash")
    invest = sum(a["amount"] for a in pocket if a["assetClass"] != "cash")
    capital = {**homes["total"], "cash": cash, "invest": invest,
               "net": homes["total"]["equity"] + cash + invest,
               "valuation_missing": any(h["basis"]["missing"] or h["full_value"] <= 0 for h in homes["homes"]),
               "basis": [{"id": h["asset"]["id"], **{k: h["basis"][k] for k in ("kind", "date", "needs_review", "trade_error")}} for h in homes["homes"]]}
    return capital


def result(plan: dict, owner: Owner, *, include_homes: bool = False) -> dict:
    homes = list_homes(owner)
    base, missing, chosen = _base(plan, owner, homes["homes"])
    comparisons = [{"id": c["id"], **move_budget(**base, price=c["price"], purchase_costs=c["purchase_costs"]),
                    "price_gap": price_gap(home_value=base["sale_value"], target_price=c["price"]) if c["price"] else None}
                   for c in plan["candidates"]]
    with storage.connection() as conn:
        _table(conn)
        tracks = _tracks(conn, owner)
    dashboard = storage.dashboard(owner)
    capital = _capital(owner, homes, dashboard)
    return {**({"homes": homes} if include_homes else {}), "plan": plan, "comparisons": comparisons, "missing_home_ids": missing, "track": {c["id"]: tracks.get(c["id"], []) for c in plan["candidates"]},
            "funds": move_budget(**base, price=None, purchase_costs=None),
            "cash_reference": dashboard["cash"], "capital": capital,
            "pir": income_price_ratio(None, **PirSettings(**plan.get("pir", {})).model_dump()),
            "valuation_needs_review": [h["asset"]["id"] for h in chosen if h["basis"]["needs_review"]]}


@router.get("")
def get_plan(owner: Owner = "together", include_homes: bool = False):
    return result(read_plan(owner), owner, include_homes=include_homes)


@router.put("")
def save_plan(data: MoveInput, owner: Owner = "together"):
    valid_ids = {h["asset"]["id"] for h in list_homes(owner)["homes"]}
    if any(str(i) not in valid_ids for i in data.source_home_ids):
        raise HTTPException(422, "매도할 집이 현재 소유자 범위에 있는지 확인해 주세요.")
    payload = data.model_dump(mode="json", exclude={"version"})
    with storage.connection() as conn:
        _table(conn)
        conn.execute("BEGIN IMMEDIATE")
        current = conn.execute("SELECT version FROM property_move WHERE owner=?", (owner,)).fetchone()
        if (current["version"] if current else 0) != data.version:
            raise HTTPException(409, "다른 화면에서 갈아타기 계획이 바뀌었어요. 새로고침 후 다시 확인해 주세요.")
        conn.execute("INSERT INTO property_move VALUES (?, ?, ?, ?) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload, version=excluded.version, updated_at=excluded.updated_at",
                     (owner, json.dumps(payload, ensure_ascii=False), data.version + 1, storage.now()))
        kept = [c["id"] for c in payload["candidates"]]
        conn.execute(f"DELETE FROM property_track WHERE owner=? AND candidate_id NOT IN ({','.join('?' * len(kept)) or "''"})", (owner, *kept))
        _auto_track(conn, owner, payload)
    return result({**payload, "version": data.version + 1}, owner)


@router.post("/track", status_code=201)
def track(data: TrackInput, owner: Owner = "together"):
    """오늘 기록 한 줄: 화면이 보여주는 목표 집 가격으로 격차·더 필요한 돈을 계산해 저장. 같은 날 다시 누르면 덮어쓴다."""
    plan = read_plan(owner)
    candidate = next((c for c in plan["candidates"] if c["id"] == str(data.candidate_id)), None)
    if not candidate:
        raise HTTPException(404, "추적할 후보를 찾을 수 없어요. 비교 후보를 먼저 저장해 주세요.")
    base, _, _ = _base(plan, owner)
    entry = _entry(base, candidate, price=data.price, basis=data.price_basis, price_date=data.price_date.isoformat() if data.price_date else None, note=data.note)
    with storage.connection() as conn:
        _table(conn)
        _write_track(conn, owner, candidate["id"], dt.date.today().isoformat(), entry)
    return result(plan, owner)


@router.delete("/track/{candidate_id}/{day}")
def untrack(candidate_id: UUID, day: Annotated[str, Path(pattern=r"^\d{4}-\d{2}-\d{2}$")], owner: Owner = "together"):
    with storage.connection() as conn:
        _table(conn)
        conn.execute("DELETE FROM property_track WHERE owner=? AND candidate_id=? AND day=?", (owner, str(candidate_id), day))
    return result(read_plan(owner), owner)


@router.get("/watch")
def watch(owner: Owner = "together"):
    """관심 단지별 최근 실거래 요약(평형별). 묶음 단지는 members 전체, 아니면 주소의 지번 하나. 판단 없이 숫자만."""
    if not prop.market_key():   # 모듈 경유: 테스트가 키를 비운다
        return {"configured": False, "watch": []}
    rules = load_watch_rules()
    today = dt.date.today()
    yms = [f"{(today.year * 12 + today.month - 1 - i) // 12}{(today.month - 1 - i) % 12 + 1:02d}" for i in range(rules["months"])]
    out = []
    districts: dict[str, list[dict] | None] = {}
    plan = read_plan(owner)
    pir = PirSettings(**plan.get("pir", {})).model_dump()
    capital = _capital(owner)
    for c in plan["candidates"]:
        a = c.get("address") or {}
        members = c.get("members") or ([{"name": "", "jibun": a["jibun"]}] if a.get("jibun") else [])
        if not a.get("sigungu_code") or not members:
            out.append({"id": c["id"], "name": c["name"], "names": [], "summary": None, "missing": "주소(지번) 확인 필요"})
            continue
        code = a["sigungu_code"]
        if code not in districts:
            try:
                districts[code] = [r for ym in yms for r in prop._month_trades(code, ym, prop.market_key())]
            except HTTPException:
                districts[code] = None
        if districts[code] is None:
            out.append({"id": c["id"], "name": c["name"], "names": [], "summary": None, "missing": "실거래 조회 실패"})
            continue
        rows = group_trades(districts[code], members)
        out.append({"id": c["id"], "name": c["name"], "names": sorted({r["name"] for r in rows}),
                    "summary": summarize(rows, large_area_m2=rules["large_area_m2"])})
    for item in out:
        for area in (item["summary"] or {}).get("areas", []):
            area["pir"] = income_price_ratio(area["latest"]["price"], **pir)
            area["funding"] = capital_shortfall(area["latest"]["price"], None if capital["valuation_missing"] else capital["net"])
    return {"configured": True, "months": rules["months"], "large_area_m2": rules["large_area_m2"], "watch": out}


@router.get("/research")
def research(owner: Owner = "together"):
    from tools.property_watch import research_snapshot
    plan = read_plan(owner)
    return research_snapshot(plan["candidates"], watch(owner), today=dt.date.today())


@router.get("/places")
def places(owner: Owner = "together"):
    """관심 단지별 가장 가까운 백화점·큰 공원·상급종합/종합병원(직선거리)과 반경 내 공원 수. 저장된 시설 자료로 계산."""
    from backend import property_place
    return property_place.summaries(read_plan(owner)["candidates"])


@router.post("/places/refresh")
def refresh_places(owner: Owner = "together"):
    """시설 자료(백화점 좌표·도시공원·병원)를 다시 받아 저장. 출처별 성공/실패를 돌려준다."""
    from backend import property_place
    points = [i["point"] for i in property_place.summaries(read_plan(owner)["candidates"])["items"]]
    return property_place.refresh(points)


@router.get("/price-check")
def price_check(sigungu: Annotated[str, Query(pattern=r"^\d{5}$")], name: Annotated[str, Query(min_length=1, max_length=100)],
                area: Annotated[float, Query(gt=0, le=2000)] | None = None, months: Annotated[int, Query(ge=1, le=36)] = 12,
                dong: Annotated[str, Query(max_length=20)] | None = None,
                jibun: Annotated[str, Query(max_length=200)] | None = None, asking: Annotated[int, Query(gt=0, le=1_000_000_000_000_000)] | None = None):
    """호가를 과거 실거래(국토부, 최대 36개월)와 나란히. 판단은 사용자 몫 — 숫자만 준다."""
    if not prop.market_key():   # 모듈 경유 호출: 테스트가 인증키를 비우고, 실제 조회를 막는다
        return {"configured": False, "months": months, "trades": [], "analysis": asking_vs_trades(asking, [])}
    trades = prop.recent_trades(sigungu, name, area, months, dong, jibun)
    return {"configured": True, "months": months, "trades": trades[:60], "analysis": asking_vs_trades(asking, trades)}
