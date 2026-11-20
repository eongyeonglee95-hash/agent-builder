"""가계부 — 부부 수입·지출을 달마다 합계로 적는다. 계산은 tools/household_book.py, 분류는 rules/household_book.yaml.

1년 표(HB-02): 칸 하나씩 고친다(/cell). '매달 고정' 칸은 새 달에 지난 금액으로 미리 채운다(prefill).
캡처(카드·은행 내역)는 비전이 옮기고(tools/household_capture) 코드가 분류한다 — 사용자가 고른 분류는 learned로 기억.

로컬 장부(storage.connection)에 달마다 한 줄. 공유(웹) 모드에서는 shared_workspace가 같은 표를 시트 기록(household_month)으로 채우고 되돌려 쓴다.
"""
from __future__ import annotations

import datetime as dt
import json
import tempfile
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import Field, field_validator

from backend import storage
from backend.storage import InputModel
from tools.household_book import (apply_capture, category_ids, cell_keys, classify, compare_month, empty_entry, flow, load_rules, merchant_key,
                                  month_summary, prefill, set_value, suggest_fixed, tx_fingerprint, value_of, year_table, year_view)

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
    fixed: Annotated[list[str], Field(max_length=40)] | None = None   # 매달 고정 칸 열쇠. 안 보내면 지난 기록에서 이어받는다
    auto: Annotated[list[str], Field(max_length=40)] = []             # 고정으로 미리 채운 칸(아직 사람이 안 고침)
    learned: Annotated[dict[str, str], Field(max_length=3000)] = {}   # 가맹점 → 고른 분류
    seen: Annotated[list[str], Field(max_length=5000)] = []           # 이미 더한 캡처 내역 지문
    version: Annotated[int, Field(strict=True, ge=0)]

    @field_validator("fixed", "auto")
    @classmethod
    def known_keys(cls, v):
        if v is not None and set(v) - set(cell_keys(load_rules())):
            raise ValueError("가계부 표에 없는 칸이에요")
        return v

    @field_validator("learned")
    @classmethod
    def known_learned(cls, v):
        if set(v.values()) - {*category_ids(load_rules()), "big", "skip"}:
            raise ValueError("모르는 분류예요")
        return v

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


class CellInput(InputModel):
    key: Annotated[str, Field(max_length=40)]
    value: Won
    version: Annotated[int, Field(strict=True, ge=0)]


class FixedInput(InputModel):
    keys: Annotated[list[str], Field(max_length=40)]
    version: Annotated[int, Field(strict=True, ge=0)]


class TxRow(InputModel):
    date: Annotated[str, Field(max_length=10)]
    merchant: Annotated[str, Field(min_length=1, max_length=60)]
    amount: Annotated[int, Field(strict=True, gt=0, le=1_000_000_000)]
    category: Annotated[str, Field(max_length=40)]


class ApplyInput(InputModel):
    rows: Annotated[list[TxRow], Field(min_length=1, max_length=500)]
    version: Annotated[int, Field(strict=True, ge=0)]


def _table(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS household_book (month TEXT PRIMARY KEY, payload TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL)")


def _rows(conn, year: int) -> dict[int, tuple[dict, int]]:
    rows = conn.execute("SELECT month, payload, version FROM household_book WHERE month BETWEEN ? AND ?", (f"{year}-01", f"{year}-12"))
    return {int(r["month"][5:]): (json.loads(r["payload"]), r["version"]) for r in rows}


def _one(conn, month: str) -> tuple[dict, int] | None:
    r = conn.execute("SELECT payload, version FROM household_book WHERE month=?", (month,)).fetchone()
    return (json.loads(r["payload"]), r["version"]) if r else None


def _latest(conn, before: str | None = None) -> tuple[str, dict, int] | None:
    r = conn.execute("SELECT month, payload, version FROM household_book WHERE month < ? ORDER BY month DESC LIMIT 1", (before or "9999-99",)).fetchone()
    return (r["month"], json.loads(r["payload"]), r["version"]) if r else None


def _this_month() -> str:
    t = dt.date.today()
    return f"{t.year}-{t.month:02d}"


def _next_open(conn) -> str | None:
    """마지막 기록 다음 달(이번 달까지). 아무 기록이 없으면 None."""
    last = _latest(conn)
    if not last:
        return None
    y, m = int(last[0][:4]), int(last[0][5:])
    nxt = f"{y + 1}-01" if m == 12 else f"{y}-{m + 1:02d}"
    return nxt if nxt <= _this_month() else None


def _base(conn, month: str) -> tuple[dict, int]:
    """그달 기록. 없으면 지난 기록의 고정 칸을 미리 채운 새 기록(version 0)."""
    got = _one(conn, month)
    if got:
        return got
    prev = _latest(conn, month)
    return (prefill(prev[1]) if prev else {**empty_entry(), "fixed": [], "auto": [], "learned": {}, "seen": []}), 0


def _write(conn, month: str, entry: dict, version: int) -> int:
    if month > _this_month():
        raise HTTPException(422, "아직 오지 않은 달은 적을 수 없어요.")
    if entry.get("fixed") is None:
        prev = _latest(conn, month)
        entry = {**entry, "fixed": list(prev[1].get("fixed") or []) if prev else []}
    payload = MonthInput.model_validate({**entry, "version": version}).model_dump(mode="json", exclude={"version"})
    current = conn.execute("SELECT version FROM household_book WHERE month=?", (month,)).fetchone()
    if (current["version"] if current else 0) != version:
        raise HTTPException(409, "다른 화면에서 이 달 가계부가 바뀌었어요. 새로고침 후 다시 적어 주세요.")
    conn.execute("INSERT INTO household_book VALUES (?, ?, ?, ?) ON CONFLICT(month) DO UPDATE SET payload=excluded.payload, version=excluded.version, updated_at=excluded.updated_at",
                 (month, json.dumps(payload, ensure_ascii=False), version + 1, dt.datetime.now(dt.timezone.utc).isoformat()))
    return version + 1


@router.get("")
def read(year: Annotated[int, Query(ge=2000, le=2100)], month: Annotated[int | None, Query(ge=1, le=12)] = None):
    rules = load_rules()
    with storage.connection() as conn:
        _table(conn)
        rows = _rows(conn, year)
        next_open = _next_open(conn)
        preview = None
        if next_open and int(next_open[:4]) == year:
            preview = int(next_open[5:]), _base(conn, next_open)[0]
        if month is None:
            month = preview[0] if preview else max(rows) if rows else (dt.date.today().month if year == dt.date.today().year else 12)
        key = f"{year}-{month:02d}"
        prev = _latest(conn, key)
        latest = _latest(conn)
        recent = [json.loads(r["payload"]) for r in conn.execute("SELECT payload FROM household_book ORDER BY month DESC LIMIT 3")][::-1]
    entries = {m: e for m, (e, _) in rows.items()}
    if preview:
        entries[preview[0]] = preview[1]
    view = year_view({m: e for m, (e, _) in rows.items()}, rules)
    entry, version = rows.get(month, (preview[1] if preview and preview[0] == month else empty_entry(), 0))
    summary = month_summary(entry, rules)
    previous = month_summary(prev[1], rules) if prev else None
    recorded = month in rows
    change = {k: summary[k] - previous[k] for k in ("income", "spend", "kept")} if previous and recorded else None
    vs_average = summary["spend"] - view["average"]["spend"] if recorded and view["average"]["spend"] is not None else None
    keys = cell_keys(rules)
    fixed_keys = list(latest[1].get("fixed") or []) if latest else []
    return {
        "categories": rules["spend"], "big_label": rules["big_label"], "saving": rules["saving"],
        "months": {str(m): s for m, s in view.pop("months").items()},
        "year": view, "next_open": next_open,
        "table": {"months": sorted(entries), "preview": preview[0] if preview else None,
                  "versions": {str(m): v for m, (_, v) in rows.items()},
                  "rows": year_table(entries, rules)},
        "fixed": {"month": latest[0] if latest else None, "version": latest[2] if latest else 0, "keys": fixed_keys,
                  "amounts": {k: value_of(latest[1], k) for k in keys} if latest else {},
                  "suggest": suggest_fixed(recent, keys)},
        "selected": {"month": month, "recorded": recorded, "preview": bool(preview and preview[0] == month and not recorded),
                     "entry": entry, "version": version,
                     "summary": summary, "flow": flow(summary, rules),
                     "compare": compare_month(entry, view, rules),
                     "previous": previous, "previous_entry": prev[1] if prev else None, "change": change, "spend_vs_average": vs_average},
    }


@router.put("/{month}")
def save(month: Month, data: MonthInput):
    with storage.connection() as conn:
        _table(conn)
        conn.execute("BEGIN IMMEDIATE")
        version = _write(conn, month, data.model_dump(mode="json", exclude={"version"}), data.version)
    return {"month": month, "version": version}


@router.put("/{month}/cell")
def save_cell(month: Month, data: CellInput):
    """표의 칸 하나. 아직 없는 달이면 고정 칸을 미리 채운 기록에서 시작한다."""
    if data.key not in cell_keys(load_rules()):
        raise HTTPException(422, "가계부 표에 없는 칸이에요.")
    with storage.connection() as conn:
        _table(conn)
        conn.execute("BEGIN IMMEDIATE")
        entry, _ = _base(conn, month)
        try:
            entry = set_value(entry, data.key, data.value)
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
        version = _write(conn, month, entry, data.version)
    return {"month": month, "version": version}


@router.post("/fixed")
def save_fixed(data: FixedInput):
    """'매달 고정' 칸 고르기. 가장 최근 기록에 적어 두고, 다음 달부터 이어받는다."""
    if set(data.keys) - set(cell_keys(load_rules())) or "big" in data.keys:
        raise HTTPException(422, "매달 고정으로 할 수 없는 칸이에요.")
    with storage.connection() as conn:
        _table(conn)
        conn.execute("BEGIN IMMEDIATE")
        latest = _latest(conn)
        if not latest:
            raise HTTPException(422, "먼저 한 달을 적어 주세요.")
        version = _write(conn, latest[0], {**latest[1], "fixed": list(dict.fromkeys(data.keys))}, data.version)
    return {"month": latest[0], "version": version}


def transcribe(paths: list[Path], year: int) -> list[dict]:
    """캡처 → 내역. 테스트에서 바꿔 끼운다."""
    from tools.household_capture import transcribe as run
    return run(paths, year)


IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


@router.post("/capture")
async def capture(month: Annotated[str, Form(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")], images: Annotated[list[UploadFile], File()]):
    """카드·은행 내역 캡처 → 분류를 채운 확인 표. 저장하지 않는다(이미지도 남기지 않는다)."""
    if not images or len(images) > 12:
        raise HTTPException(422, "캡처는 1~12장까지 올릴 수 있어요.")
    import anyio
    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for i, f in enumerate(images):
            if f.content_type not in IMAGE_TYPES:
                raise HTTPException(422, "PNG·JPG·WEBP 이미지만 올릴 수 있어요.")
            data = await f.read()
            if not data or len(data) > 12 * 1024 * 1024:
                raise HTTPException(422, "이미지 하나는 12MB 이하여야 해요.")
            paths.append(Path(tmp) / f"{i + 1:03d}{IMAGE_TYPES[f.content_type]}")
            paths[-1].write_bytes(data)
        try:
            txs = await anyio.to_thread.run_sync(transcribe, paths, int(month[:4]))
        except Exception as e:
            raise HTTPException(502, f"캡처를 읽지 못했어요: {str(e)[:200]}") from None
    rules = load_rules()
    with storage.connection() as conn:
        _table(conn)
        learned: dict[str, str] = {}
        for r in conn.execute("SELECT payload FROM household_book ORDER BY month"):
            learned.update(json.loads(r["payload"]).get("learned", {}))
        entry, _ = _base(conn, month)
    seen = set(entry.get("seen", []))
    out = []
    for t in txs:
        cat, how = classify(t["merchant"], learned, rules)
        out.append({**t, "category": cat, "how": how, "in_month": t["date"][:7] == month,
                    "duplicate": tx_fingerprint(t["date"], t["merchant"], t["amount"]) in seen})
    if not out:
        raise HTTPException(422, "캡처에서 결제 내역을 찾지 못했어요. 날짜·가맹점·금액이 보이는 화면인지 확인해 주세요.")
    return {"month": month, "rows": out}


@router.post("/{month}/capture")
def apply(month: Month, data: ApplyInput):
    """확인한 내역을 그달 항목 합계에 더한다. 같은 내역은 두 번 더하지 않는다."""
    rules = load_rules()
    with storage.connection() as conn:
        _table(conn)
        conn.execute("BEGIN IMMEDIATE")
        entry, _ = _base(conn, month)
        try:
            entry, added = apply_capture(entry, [r.model_dump() for r in data.rows], rules)
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
        version = _write(conn, month, entry, data.version)
    return {"month": month, "version": version, "added": added}
