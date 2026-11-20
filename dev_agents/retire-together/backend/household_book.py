"""가계부 — 부부 수입·지출을 달마다 합계로 적는다. 계산은 tools/household_book.py, 분류는 rules/household_book.yaml.

로컬 장부(storage.connection)에 달마다 한 줄. 공유(웹) 모드에서는 shared_workspace가 같은 표를 시트 기록(household_month)으로 채우고 되돌려 쓴다.
"""
from __future__ import annotations

import datetime as dt
import json
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import Field, field_validator

from backend import storage
from backend.storage import InputModel
from tools.household_book import category_ids, compare_month, empty_entry, flow, load_rules, month_summary, year_view

router = APIRouter(prefix="/api/household-book", tags=["household-book"])
Won = Annotated[int, Field(strict=True, ge=0, le=100_000_000_000)]
Month = Annotated[str, Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]


class IncomeLine(InputModel):
    who: Literal["me", "partner", "joint"]
    kind: Literal["월급", "상여", "기타"]
    label: Annotated[str, Field(max_length=40)] = ""
    gross: Won | None = None
    net: Won


class BigLine(InputModel):
    name: Annotated[str, Field(min_length=1, max_length=40)]
    amount: Won


class MonthInput(InputModel):
    income: Annotated[list[IncomeLine], Field(max_length=20)] = []
    spend: dict[str, Won] = {}
    big: Annotated[list[BigLine], Field(max_length=30)] = []
    saving: dict[str, Won] = {}
    version: Annotated[int, Field(strict=True, ge=0)]

    @field_validator("spend")
    @classmethod
    def known_categories(cls, v):
        unknown = set(v) - set(category_ids(load_rules()))
        if unknown:
            raise ValueError("가계부 분류에 없는 항목이에요: " + ", ".join(sorted(unknown)))
        return v

    @field_validator("saving")
    @classmethod
    def known_saving(cls, v):
        if set(v) - {s["id"] for s in load_rules()["saving"]}:
            raise ValueError("모은 돈 항목은 연금 납입·대출 원금만 적을 수 있어요")
        return v


def _table(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS household_book (month TEXT PRIMARY KEY, payload TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL)")


def _rows(conn, year: int) -> dict[int, tuple[dict, int]]:
    rows = conn.execute("SELECT month, payload, version FROM household_book WHERE month BETWEEN ? AND ?", (f"{year}-01", f"{year}-12"))
    return {int(r["month"][5:]): (json.loads(r["payload"]), r["version"]) for r in rows}


def _one(conn, month: str) -> tuple[dict, int] | None:
    r = conn.execute("SELECT payload, version FROM household_book WHERE month=?", (month,)).fetchone()
    return (json.loads(r["payload"]), r["version"]) if r else None


@router.get("")
def read(year: Annotated[int, Query(ge=2000, le=2100)], month: Annotated[int | None, Query(ge=1, le=12)] = None):
    rules = load_rules()
    with storage.connection() as conn:
        _table(conn)
        rows = _rows(conn, year)
        today = dt.date.today()
        if month is None:
            month = max(rows) if rows else (today.month if year == today.year else 12)
        prev_key = f"{year - 1}-12" if month == 1 else f"{year}-{month - 1:02d}"
        prev = rows.get(month - 1) if month > 1 else _one(conn, prev_key)
    next_open = None
    if rows:
        last = max(rows)
        ny, nm = (year + 1, 1) if last == 12 else (year, last + 1)
        if (ny, nm) <= (today.year, today.month) and not (ny == year and nm in rows):
            next_open = f"{ny}-{nm:02d}"
    view = year_view({m: e for m, (e, _) in rows.items()}, rules)
    entry, version = rows.get(month, (empty_entry(), 0))
    summary = month_summary(entry, rules)
    previous = month_summary(prev[0], rules) if prev else None
    change = {k: summary[k] - previous[k] for k in ("income", "spend", "kept")} if previous and month in rows else None
    vs_average = summary["spend"] - view["average"]["spend"] if month in rows and view["average"]["spend"] is not None else None
    return {
        "categories": rules["spend"], "big_label": rules["big_label"], "saving": rules["saving"],
        "months": {str(m): s for m, s in view.pop("months").items()},
        "year": view, "next_open": next_open,
        "selected": {"month": month, "recorded": month in rows, "entry": entry, "version": version,
                     "summary": summary, "flow": flow(summary, rules),
                     "compare": compare_month(entry, view, rules),
                     "previous": previous, "previous_entry": prev[0] if prev else None, "change": change, "spend_vs_average": vs_average},
    }


@router.put("/{month}")
def save(month: Month, data: MonthInput):
    today = dt.date.today()
    if month > f"{today.year}-{today.month:02d}":
        raise HTTPException(422, "아직 오지 않은 달은 적을 수 없어요.")
    payload = data.model_dump(mode="json", exclude={"version"})
    with storage.connection() as conn:
        _table(conn)
        conn.execute("BEGIN IMMEDIATE")
        current = conn.execute("SELECT version FROM household_book WHERE month=?", (month,)).fetchone()
        if (current["version"] if current else 0) != data.version:
            raise HTTPException(409, "다른 화면에서 이 달 가계부가 바뀌었어요. 새로고침 후 다시 적어 주세요.")
        conn.execute("INSERT INTO household_book VALUES (?, ?, ?, ?) ON CONFLICT(month) DO UPDATE SET payload=excluded.payload, version=excluded.version, updated_at=excluded.updated_at",
                     (month, json.dumps(payload, ensure_ascii=False), data.version + 1, dt.datetime.now(dt.timezone.utc).isoformat()))
    return {"month": month, "version": data.version + 1}
