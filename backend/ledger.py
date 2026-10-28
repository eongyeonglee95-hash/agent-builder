"""ledger — 자산 저장소 선택 (SHEET-01). 구글 시트가 연결돼 있으면 시트가 원천, 아니면 로컬 SQLite(backend/storage.py).

시트 탭 '자산'의 행은 storage.AssetInput 필드 + id, account_id, source, version, updated_at, request_id.
시트는 통째로 읽고 통째로 쓴다(가구 데이터는 수십 행). 버전 번호로 동시 수정 충돌을 막는다.
환경변수 RETIRE_SHEETS=off 이면 시트를 절대 열지 않는다 (테스트·브라우저 테스트 서버).
"""
from __future__ import annotations

import datetime as dt
import os
import time
from uuid import uuid4

from fastapi import HTTPException

from tools import sheets as gsheets
from tools.sheets import ASSET_COLUMNS, ASSET_TAB, HOLDING_COLUMNS, HOLDING_TAB, SheetsError

CAPTURE_SOURCES = ("capture", "file")   # 계좌 단위로 다시 등록하면 통째로 바뀌는 출처
CACHE_SECONDS = 5


def open_sheets():
    if os.environ.get("RETIRE_SHEETS", "").lower() == "off":
        return None
    try:
        return gsheets.open_sheets()
    except Exception:
        return None


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _int(v, default=0) -> int:
    try:
        if v in ("", None):
            return default
        return int(float(v))
    except (TypeError, ValueError):
        return default


def _date_text(v) -> str:
    """시트가 날짜 셀을 일련번호로 돌려주면 ISO 문자열로. 문자열이면 앞 10자."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return (dt.date(1899, 12, 30) + dt.timedelta(days=int(v))).isoformat()
    return str(v or "")[:10]


def _cells(payload: dict) -> dict:
    """시트 셀 값으로: None → 빈 칸, UUID → 문자열. 그 밖의 값은 그대로."""
    out = {}
    for k, v in payload.items():
        out[k] = "" if v is None else (str(v) if k in ("parent_id", "id") else v)
    return out


class SheetStore:
    """시트 한 장을 자산 장부로 쓴다. 읽기는 짧게 캐시하고 쓰면 비운다."""

    def __init__(self, gs):
        self.gs = gs
        self._cache: dict[str, tuple[float, list[dict]]] = {}

    def _read(self, tab: str) -> list[dict]:
        hit = self._cache.get(tab)
        if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
            return [dict(r) for r in hit[1]]
        try:
            rows = self.gs.read(tab)
        except SheetsError as e:
            raise HTTPException(503, str(e)) from None
        if tab == ASSET_TAB:
            rows = [self._norm_asset(r) for r in rows if str(r.get("id", "")).strip()]
        else:
            rows = [self._norm_holding(r) for r in rows if str(r.get("ticker_name", "")).strip()]
        self._cache[tab] = (time.monotonic(), rows)
        return [dict(r) for r in rows]

    def _write(self, tab: str, rows: list[dict]) -> None:
        try:
            self.gs.write(tab, rows)
        except SheetsError as e:
            raise HTTPException(503, str(e)) from None
        self._cache.pop(tab, None)

    @staticmethod
    def _norm_asset(r: dict) -> dict:
        out = {c: r.get(c, "") for c in ASSET_COLUMNS}
        out["id"] = str(out["id"]).strip()
        out["amount"] = _int(out["amount"])
        out["version"] = _int(out["version"], 1) or 1
        out["as_of"] = _date_text(out["as_of"])
        for k in ("owner", "pocket", "assetClass", "name", "account", "account_id", "source", "updated_at", "request_id", "parent_id"):
            out[k] = str(out.get(k) or "").strip()
        out["valuation_source"] = "details" if str(out.get("valuation_source") or "").strip() == "details" else "total"
        sp = _int(out.get("share_percent"), 0)
        out["share_percent"] = sp if 1 <= sp <= 99 else None
        return out

    @staticmethod
    def _norm_holding(r: dict) -> dict:
        out = {c: r.get(c, "") for c in HOLDING_COLUMNS}
        out["qty"] = _int(out["qty"]); out["price"] = _int(out["price"])
        out["as_of"] = _date_text(out["as_of"])
        t = str(out.get("ticker") or "").strip()
        out["ticker"] = t.zfill(6) if t.isdigit() and len(t) < 6 else t
        for k in ("account_id", "ticker_name", "updated_at"):
            out[k] = str(out.get(k) or "").strip()
        return out

    @staticmethod
    def _public(r: dict) -> dict:
        """웹이 쓰는 모양 (storage.asset_from과 같다)."""
        return {"name": r["name"], "account": r["account"], "owner": r["owner"], "pocket": r["pocket"], "assetClass": r["assetClass"],
                "amount": r["amount"], "as_of": r["as_of"], "account_id": r.get("account_id") or None, "source": r.get("source") or "manual",
                "parent_id": r.get("parent_id") or None, "valuation_source": r.get("valuation_source") or "total",
                "share_percent": r.get("share_percent") if r.get("share_percent") else None,
                "id": r["id"], "version": r["version"], "updated_at": r["updated_at"]}

    # ----- 자산 -----
    def list_assets(self) -> list[dict]:
        return [self._public(r) for r in self._read(ASSET_TAB)]

    def find_request(self, request_id: str, payload: dict):
        for row in self._read(ASSET_TAB):
            if row.get('request_id') == request_id:
                if any(self._public(row).get(k) != v for k, v in payload.items()):
                    raise HTTPException(409, '이미 사용된 등록 요청입니다. 화면을 다시 열어 주세요.')
                return self._public(row)
        return None

    def create_asset(self, payload: dict, request_id: str) -> dict:
        rows = self._read(ASSET_TAB)
        for r in rows:
            if r.get("request_id") and r["request_id"] == request_id:
                return self._public(r)
        row = {**{c: "" for c in ASSET_COLUMNS}, **_cells(payload), "id": str(uuid4()), "version": 1, "updated_at": now(),
               "request_id": request_id, "source": payload.get("source") or "manual", "account_id": payload.get("account_id") or ""}
        rows.append(row)
        self._write(ASSET_TAB, rows)
        return self._public(row)

    def update_asset(self, asset_id: str, payload: dict, version: int) -> dict:
        rows = self._read(ASSET_TAB)
        for r in rows:
            if r["id"] == asset_id:
                if r["version"] != version:
                    raise HTTPException(409, "다른 화면(또는 시트)에서 자산이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.")
                r.update({k: v for k, v in _cells(payload).items() if k in ASSET_COLUMNS and k not in ("id", "account_id", "source", "request_id")})
                r["version"] = version + 1; r["updated_at"] = now()
                self._write(ASSET_TAB, rows)
                return self._public(r)
        raise HTTPException(404, "등록된 자산을 찾을 수 없습니다.")

    def delete_asset(self, asset_id: str, version: int) -> None:
        rows = self._read(ASSET_TAB)
        keep = [r for r in rows if r["id"] != asset_id]
        if len(keep) == len(rows):
            raise HTTPException(404, "등록된 자산을 찾을 수 없습니다.")
        gone = next(r for r in rows if r["id"] == asset_id)
        if gone["version"] != version:
            raise HTTPException(409, "다른 화면(또는 시트)에서 자산이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.")
        if any(r.get("parent_id") == asset_id for r in rows):
            raise HTTPException(409, "세부 자산이 연결되어 있습니다. 세부 자산을 먼저 정리해 주세요.")
        if gone.get("parent_id"):
            parent = next((r for r in rows if r["id"] == gone["parent_id"]), None)
            if parent and parent.get("valuation_source") == "details" and sum(r.get("parent_id") == gone["parent_id"] for r in rows) == 1:
                raise HTTPException(409, "마지막 세부 자산입니다. 합산 기준을 계좌 총액으로 바꾼 뒤 삭제해 주세요.")
        self._write(ASSET_TAB, keep)

    def replace_account_assets(self, account_id: str, source: str, payloads: list[dict]) -> list[dict]:
        from backend.account_groups import replace_group
        rows, children = replace_group(self._read(ASSET_TAB), account_id, source, payloads, now())
        self._write(ASSET_TAB, [_cells(r) for r in rows])
        return [self._public(r) for r in children]

    def import_assets(self, assets: list[dict]) -> int:
        """로컬 장부 → 시트 이관 (시트 '자산' 탭이 비어 있을 때만 호출)."""
        rows = self._read(ASSET_TAB)
        existing = {r["id"] for r in rows}
        added = 0
        for a in assets:
            if a["id"] in existing:
                continue
            rows.append({**{c: "" for c in ASSET_COLUMNS}, **_cells({k: a.get(k, "") for k in ASSET_COLUMNS}), "request_id": "",
                         "source": a.get("source") or "manual", "account_id": a.get("account_id") or ""})
            added += 1
        if added:
            self._write(ASSET_TAB, rows)
        return added

    # ----- 보유종목 -----
    def list_holdings(self, account_ids: list[str] | None = None) -> list[dict]:
        rows = self._read(HOLDING_TAB)
        return [r for r in rows if account_ids is None or r["account_id"] in account_ids]

    def replace_holdings(self, account_id: str, rows: list[dict], as_of: str) -> int:
        current = self._read(HOLDING_TAB)
        keep = [r for r in current if r["account_id"] != account_id]
        stamp = now()
        new = [{"account_id": account_id, "ticker_name": r["ticker_name"], "ticker": r.get("ticker") or "", "qty": int(r["qty"]),
                "price": int(r["price"]), "as_of": as_of, "updated_at": stamp} for r in rows]
        self._write(HOLDING_TAB, keep + new)
        return len(new)


def sheet_store() -> SheetStore | None:
    gs = open_sheets()
    return SheetStore(gs) if gs is not None else None
