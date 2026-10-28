"""google_api — 구글 시트 연결 설정 (SHEET-01). 상태 보기 → OAuth 클라이언트 저장 → 구글 로그인 → 시트 만들기/지정 → 로컬 장부 이관."""
from __future__ import annotations

import os
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import Field

from backend import ledger, storage
from backend.storage import InputModel
from tools import sheets as gsheets
from tools.sheets import SheetsError

router = APIRouter(prefix="/api/google", tags=["google"])


def _status() -> dict:
    s = gsheets.connect_status()
    store = ledger.sheet_store()
    s["active"] = store is not None
    s["disabled"] = os.environ.get("RETIRE_SHEETS", "").lower() == "off"
    if store is not None:
        try:
            s["asset_rows"] = len(store.list_assets())
            s["health"] = "ok"
        except HTTPException as e:
            s["asset_rows"] = None
            s["health"] = e.detail
    return s


@router.get("/status")
def status():
    return _status()


class ClientSecretInput(InputModel):
    json_text: Annotated[str, Field(min_length=2, max_length=20_000)]


@router.put("/client-secret")
def put_client_secret(data: ClientSecretInput):
    try:
        gsheets.save_client_secret(data.json_text)
    except SheetsError as e:
        raise HTTPException(422, str(e)) from None
    return _status()


@router.post("/connect")
def connect():
    try:
        gsheets.start_connect()
    except SheetsError as e:
        raise HTTPException(422, str(e)) from None
    return _status()


class SpreadsheetInput(InputModel):
    url: Annotated[str | None, Field(max_length=500)] = None


@router.post("/spreadsheet")
def choose_spreadsheet(data: SpreadsheetInput):
    """새 시트를 만들거나(url 없음) 기존 시트를 쓴다. 시트 '자산' 탭이 비어 있고 로컬 장부에 자산이 있으면 옮긴다."""
    if os.environ.get("RETIRE_SHEETS", "").lower() == "off":
        raise HTTPException(422, "이 서버는 시트 연결이 꺼져 있어요 (테스트 모드).")
    try:
        cfg = gsheets.use_spreadsheet(data.url) if data.url else gsheets.create_spreadsheet()
    except SheetsError as e:
        raise HTTPException(422, str(e)) from None
    store = ledger.sheet_store()
    migrated = 0
    if store is not None:
        try:
            if not store.list_assets():
                migrated = store.import_assets(storage.list_local_assets())
        except HTTPException:
            migrated = 0
    return {**_status(), "spreadsheet": cfg, "migrated": migrated}


@router.delete("/connection")
def disconnect():
    gsheets.disconnect()
    return _status()
