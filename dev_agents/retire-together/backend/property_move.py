"""부동산 목표·비교 후보와 소유자 범위별 갈아타기 계획. 장부와 분리 저장."""
from __future__ import annotations

import datetime as dt
import json
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import Field, model_validator

from backend import storage
from backend.property import Address, list_homes
from backend.storage import InputModel, Money
from tools.property_move import move_budget

router = APIRouter(prefix="/api/property-move", tags=["property-move"])
Owner = Literal["together", "me", "partner"]


class Candidate(InputModel):
    id: UUID
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


class MoveInput(InputModel):
    version: Annotated[int, Field(strict=True, ge=0)] = 0
    source_home_ids: Annotated[list[UUID], Field(max_length=30)] = []
    cash: Money | None = None
    sale_costs: Money | None = None
    new_loan: Money = 0
    monthly_saving: Money = 0
    target_month: Annotated[str, Field(pattern=r"^(20|21)\d{2}-(0[1-9]|1[0-2])$")] | None = None
    target_id: UUID | None = None
    candidates: Annotated[list[Candidate], Field(max_length=20)] = []

    @model_validator(mode="after")
    def unique(self):
        ids = [c.id for c in self.candidates]
        if len(set(ids)) != len(ids) or len(set(self.source_home_ids)) != len(self.source_home_ids):
            raise ValueError("같은 집을 두 번 넣을 수 없습니다")
        if self.target_id and self.target_id not in ids:
            raise ValueError("목표 집은 비교 후보 중에서 선택해 주세요")
        return self


def _table(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS property_move (owner TEXT PRIMARY KEY, payload TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL)")


def read_plan(owner: Owner) -> dict:
    with storage.connection() as conn:
        _table(conn)
        row = conn.execute("SELECT * FROM property_move WHERE owner=?", (owner,)).fetchone()
    return {**json.loads(row["payload"]), "version": row["version"]} if row else MoveInput().model_dump(mode="json")


def result(plan: dict, owner: Owner) -> dict:
    homes = list_homes(owner)["homes"]
    chosen = [h for h in homes if h["asset"]["id"] in plan["source_home_ids"]]
    missing = sorted(set(plan["source_home_ids"]) - {h["asset"]["id"] for h in chosen})
    # 지워진 집은 0원으로 조용히 바꾸지 않고 계획 재확인을 요구한다.
    base = dict(sale_value=sum(h["value"] for h in chosen),
                loans=sum(h["metrics"]["loans_mine"] for h in chosen),
                deposit=sum(h["metrics"]["deposit_mine"] for h in chosen),
                sale_costs=plan["sale_costs"], cash=plan["cash"] if not missing else None,
                new_loan=plan["new_loan"], monthly=plan["monthly_saving"], target_month=plan["target_month"])
    comparisons = [{"id": c["id"], **move_budget(**base, price=c["price"], purchase_costs=c["purchase_costs"])} for c in plan["candidates"]]
    return {"plan": plan, "comparisons": comparisons, "missing_home_ids": missing,
            "funds": move_budget(**base, price=None, purchase_costs=None),
            "cash_reference": storage.dashboard(owner)["cash"],
            "valuation_needs_review": [h["asset"]["id"] for h in chosen if ((h["detail"] or {}).get("value_source") or {}).get("kind") in ("none", "purchase")]}


@router.get("")
def get_plan(owner: Owner = "together"):
    return result(read_plan(owner), owner)


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
    return result({**payload, "version": data.version + 1}, owner)
