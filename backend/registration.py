"""registration — '우리 자산'의 자산 등록 한 곳 (REG-01): 사진(캡처)·파일(CSV·엑셀) → 확인 표 → 저장.

흐름: /capture 또는 /file 로 표를 만든다(저장 안 함) → 사용자가 수량·현재가·자산군을 확인 → /commit 이 저장한다.
저장 = (1) data/snapshots 계좌 스냅샷(리밸런싱 엔진용, SAFE-01/02 검증 포함) (2) 종목 꼬리표 확인(asset_map)
       (3) 시트 '보유종목' 탭 (4) 자산군별로 묶은 자산 행 → 자산 장부(시트 원천, 미연결이면 SQLite).
직접 입력은 기존 /api/assets 그대로 쓴다. 계산은 전부 여기(코드)에서 하고 캡처 전사만 Claude 비전이 한다.
"""
from __future__ import annotations

import datetime as dt
import os
import re
from pathlib import Path
from typing import Annotated, Literal

import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import Field, field_validator

from backend import ledger, storage
from backend.storage import InputModel
from tools.assets import load_accounts, load_asset_map, load_accounts_list, load_pools, save_accounts, upsert_asset_tags
from tools.parse_balance import ACCOUNT_ID_RE, HOLDING_COLUMNS, reconcile, validate_holdings
from tools.strategy import ASSET_CLASSES, CLASS_LABELS, TICKER_RE
from tools import store as snapshots

ROOT = Path(__file__).resolve().parents[1]
router = APIRouter(prefix="/api/register", tags=["register"])

MAX_IMAGES = 12
MAX_IMAGE_BYTES = 12 * 1024 * 1024
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
OWNER_TO_WEB = {"me": "me", "spouse": "partner"}
WEB_TO_OWNER = {"me": "me", "partner": "spouse"}
POCKET_TO_WEB = {"pension": "retirement", "cash": "cash"}
BROKER_LABELS = {"mirae": "미래에셋", "kiwoom": "키움", "kis": "한국투자", "samsung": "삼성", "nh": "NH", "kb": "KB", "shinhan": "신한", "toss": "토스", "other": "기타"}
TYPE_LABELS = {"pension_savings": "연금저축", "irp": "IRP", "isa": "ISA", "general": "일반"}


# ---------- 경로 (브라우저 테스트가 임시 폴더로 바꾼다) ----------

def accounts_path() -> Path:
    return Path(os.environ.get("RETIRE_ACCOUNTS_PATH") or ROOT / "rules" / "accounts.yaml")


def asset_map_path() -> Path:
    return Path(os.environ.get("RETIRE_ASSET_MAP_PATH") or ROOT / "rules" / "asset_map.yaml")


def upload_dir() -> Path:
    return Path(os.environ.get("RETIRE_UPLOAD_DIR") or ROOT / "data" / "uploads")


def snapshot_dir() -> Path:
    return Path(os.environ.get("RETIRE_SNAPSHOT_DIR") or snapshots.SNAPSHOTS)


# ---------- 계좌 ----------

def account_view(acct_id: str, a: dict, holdings_accounts: set[str]) -> dict:
    return {"id": acct_id, "label": a.get("label") or acct_id, "owner": OWNER_TO_WEB.get(a.get("owner"), "me"),
            "broker": a.get("broker"), "broker_label": BROKER_LABELS.get(a.get("broker"), a.get("broker") or ""),
            "account_type": a.get("account_type"), "type_label": TYPE_LABELS.get(a.get("account_type"), a.get("account_type") or ""),
            "pocket": POCKET_TO_WEB.get(a.get("pocket"), "cash"), "active": a.get("active", True) is not False,
            "has_holdings": acct_id in holdings_accounts}


@router.get("/accounts")
def accounts():
    accts = load_accounts(accounts_path())
    with_holdings = {a for a in accts if (snapshot_dir() / a).exists() and any((snapshot_dir() / a).glob("*.csv"))}
    return [account_view(k, v, with_holdings) for k, v in accts.items() if v.get("active", True) is not False]


class AccountCreate(InputModel):
    label: Annotated[str, Field(min_length=1, max_length=60)]
    owner: Literal["me", "partner"]
    broker: Literal["mirae", "kiwoom", "kis", "samsung", "nh", "kb", "shinhan", "toss", "other"]
    account_type: Literal["pension_savings", "irp", "isa", "general"]


@router.post("/accounts", status_code=201)
def create_account(data: AccountCreate):
    """계좌를 rules/accounts.yaml에 추가. id는 소유자_증권사_종류(_n). 풀·전략은 사용자가 설정 화면에서 정한다."""
    rows = load_accounts_list(accounts_path())
    pools = load_pools(accounts_path())
    base = f"{WEB_TO_OWNER[data.owner]}_{data.broker}_{data.account_type}"
    existing = {r["id"] for r in rows}
    acct_id, n = base, 1
    while acct_id in existing:
        n += 1; acct_id = f"{base}_{n}"
    pocket = "pension" if data.account_type in ("pension_savings", "irp") else "cash"
    layer = {"irp": 2, "pension_savings": 3, "isa": 4}.get(data.account_type)
    row = {"id": acct_id, "label": data.label, "owner": WEB_TO_OWNER[data.owner], "broker": data.broker,
           "account_type": data.account_type, "pocket": pocket, "layer": layer, "api": False, "active": True}
    save_accounts(rows + [row], {k: {kk: vv for kk, vv in v.items() if kk != "accounts"} for k, v in pools.items()}, accounts_path())
    return account_view(acct_id, row, set())


# ---------- 표 만들기 ----------

def _safe_name(name: str) -> str:
    return re.sub(r"[^\w.\-가-힣]", "_", Path(name or "upload").name)[:80]


def _preview(df: pd.DataFrame, meta: dict, account_id: str | None, label: str, source: str) -> dict:
    amap = load_asset_map(asset_map_path())
    rows = []
    for r in df.to_dict("records"):
        entry = amap.get(r["ticker_name"]) or next((v for v in amap.values() if r.get("ticker") and str(v.get("ticker")) == str(r.get("ticker"))), {})
        rows.append({"ticker_name": r["ticker_name"], "ticker": r.get("ticker") or None, "qty": int(r["qty"]) if pd.notna(r["qty"]) else None,
                     "price": int(r["price"]) if pd.notna(r["price"]) else None, "value": int(r.get("value") or 0) or None,
                     "buy_value": int(r.get("buy_value") or 0) or None,
                     "asset_class": entry.get("asset_class") if entry.get("asset_class") in ASSET_CLASSES else None,
                     "confirmed": entry.get("status") == "confirmed", "candidates": []})
    for name, cands in meta.get("unresolved", []) or []:
        for row in rows:
            if row["ticker_name"] == name:
                row["candidates"] = [list(c) for c in cands[:5]]
    computed = sum((r["qty"] or 0) * (r["price"] or 0) for r in rows)
    return {"account_id": account_id, "account_label": label, "source": source, "rows": rows, "computed_total": computed,
            "screen_total": meta.get("screen_total_value") or None, "verified": bool(meta.get("verified")),
            "reconciled": bool(meta.get("reconciled")), "diff": meta.get("diff", 0), "value_diff": meta.get("value_diff"),
            "errors": list(meta.get("errors") or []), "class_labels": CLASS_LABELS}


def _norm_label(s: str) -> str:
    return re.sub(r"[\s\-_·.,()\[\]]", "", str(s or "")).casefold()


def match_account(label: str, accounts: dict[str, dict]) -> str | None:
    """캡처 상단의 계좌 이름 → 등록된 계좌 id. 같은 이름이면 바로, 아니면 한쪽이 다른 쪽을 품을 때 하나뿐이면 그것."""
    key = _norm_label(label)
    if not key:
        return None
    active = {k: v for k, v in accounts.items() if v.get("active", True) is not False}
    exact = [k for k, v in active.items() if _norm_label(v.get("label")) == key]
    if len(exact) == 1:
        return exact[0]
    loose = [k for k, v in active.items() if _norm_label(v.get("label")) and (key in _norm_label(v.get("label")) or _norm_label(v.get("label")) in key)]
    return loose[0] if len(loose) == 1 else None


BROKER_HINTS = [("미래에셋", "mirae"), ("키움", "kiwoom"), ("한국투자", "kis"), ("한투", "kis"), ("삼성", "samsung"), ("nh", "nh"), ("농협", "nh"),
                ("kb", "kb"), ("국민", "kb"), ("신한", "shinhan"), ("토스", "toss")]
TYPE_HINTS = [("연금저축", "pension_savings"), ("연금", "pension_savings"), ("irp", "irp"), ("퇴직", "irp"), ("isa", "isa")]


def suggest_account(label: str, owner: str = "me") -> dict:
    """등록 안 된 계좌를 캡처 이름으로 바로 추가할 수 있게 미리 채운 값. 사용자가 확인한다."""
    low = (label or "").casefold()
    broker = next((b for k, b in BROKER_HINTS if k in low), "other")
    account_type = next((t for k, t in TYPE_HINTS if k in low), "general")
    return {"label": (label or "새 계좌").strip()[:60], "owner": owner if owner in ("me", "partner") else "me", "broker": broker, "account_type": account_type}


def _account_or_422(account_id: str) -> tuple[dict, dict]:
    accts = load_accounts(accounts_path())
    if not ACCOUNT_ID_RE.match(account_id or "") or account_id not in accts:
        raise HTTPException(422, "등록된 계좌를 먼저 골라 주세요.")
    if accts[account_id].get("active", True) is False:
        raise HTTPException(422, "사용 안 함으로 표시된 계좌예요.")
    return accts, accts[account_id]


def parse_images(paths: list[Path], account_id: str, label: str | None) -> tuple[pd.DataFrame, dict]:
    """캡처 → 표 (tools.register.register: Claude 비전 전사 + 종목코드 조회). 테스트에서 바꿔 끼운다."""
    from tools.register import register
    return register(account_id, paths, label)


def parse_images_multi(paths: list[Path]) -> list[tuple[pd.DataFrame, dict]]:
    """여러 계좌 캡처 한꺼번에 → 계좌별 (표, meta). 종목코드는 공개 검색으로 채우되 실패해도 표는 돌려준다."""
    import time

    from tools.market import resolve_ticker
    from tools.parse_balance import parse_captures
    groups = parse_captures(paths)
    for df, meta in groups:
        codes, pending = [], []
        for name in df["ticker_name"]:
            try:
                code, cands = resolve_ticker(name)
            except Exception:
                code, cands = None, []
            codes.append(code)
            if code is None:
                pending.append((name, cands[:5]))
            time.sleep(0.15)
        df["ticker"] = codes
        meta["unresolved"] = pending
    return groups


@router.post("/capture")
async def capture(images: Annotated[list[UploadFile], File()], account_id: Annotated[str | None, Form()] = None,
                  owner: Annotated[str | None, Form()] = None):
    """캡처 → 계좌별 확인 표. account_id 없이 올리면(기본) 캡처 상단 계좌 이름으로 나누고 등록 계좌에 맞춘다."""
    accts = load_accounts(accounts_path())
    acct = _account_or_422(account_id)[1] if account_id else None
    if not images or len(images) > MAX_IMAGES:
        raise HTTPException(422, f"캡처는 1~{MAX_IMAGES}장까지 올릴 수 있어요.")
    day = dt.date.today().isoformat()
    folder = upload_dir() / (account_id or "_batch") / day
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, f in enumerate(images):
        if f.content_type not in IMAGE_TYPES:
            raise HTTPException(422, "PNG·JPG·WEBP 이미지만 올릴 수 있어요.")
        data = await f.read()
        if not data or len(data) > MAX_IMAGE_BYTES:
            raise HTTPException(422, "이미지 하나는 12MB 이하여야 해요.")
        dst = folder / f"{i + 1:03d}_{_safe_name(f.filename or 'capture')}"
        if dst.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
            dst = dst.with_suffix(IMAGE_TYPES[f.content_type])
        dst.write_bytes(data)
        paths.append(dst)
    import anyio
    try:
        if acct is not None:
            df, meta = await anyio.to_thread.run_sync(parse_images, paths, account_id, acct.get("label"))
            groups = [(df, meta)]
        else:
            groups = await anyio.to_thread.run_sync(parse_images_multi, paths)
    except Exception as e:
        raise HTTPException(502, f"캡처를 읽지 못했어요: {str(e)[:200]}") from None
    if not groups:
        raise HTTPException(422, "캡처에서 종목을 찾지 못했어요. 잔고 화면이 보이는 캡처인지 확인해 주세요.")
    out = []
    for df, meta in groups:
        label = meta.get("account_label") or (acct.get("label") if acct else "") or "계좌"
        matched = account_id or match_account(label, accts)
        preview = _preview(df, meta, matched, label, "capture")
        preview["matched_label"] = accts[matched].get("label") if matched else None
        preview["suggested"] = suggest_account(label, owner or "me")
        out.append(preview)
    return {"groups": out}


@router.post("/file")
async def file_import(file: Annotated[UploadFile, File()], account_id: Annotated[str | None, Form()] = None,
                      owner: Annotated[str | None, Form()] = None):
    """CSV·엑셀 → 확인 표. 파일에는 계좌 이름이 없으니 파일 이름으로 등록 계좌를 맞춰 보고, 못 맞추면 확인 표에서 고른다."""
    from tools.import_file import holdings_from_file
    accts = load_accounts(accounts_path())
    acct = _account_or_422(account_id)[1] if account_id else None
    data = await file.read()
    try:
        df, meta = holdings_from_file(data, file.filename or "upload.csv", account_id or "")
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    if df.empty and not meta["errors"]:
        raise HTTPException(422, "읽을 수 있는 종목 행이 없어요.")
    stem = Path(file.filename or "").stem
    label = (acct.get("label") if acct else None) or stem or "파일"
    matched = account_id or match_account(stem, accts)
    preview = _preview(df, meta, matched, label, "file")
    preview["matched_label"] = accts[matched].get("label") if matched else None
    preview["suggested"] = suggest_account(stem, owner or "me")
    return {"groups": [preview]}


# ---------- 저장 ----------

class CommitRow(InputModel):
    ticker_name: Annotated[str, Field(min_length=1, max_length=100)]
    ticker: Annotated[str | None, Field(max_length=12)] = None
    qty: Annotated[int, Field(strict=True, ge=1, le=100_000_000)]
    price: Annotated[int, Field(strict=True, ge=1, le=1_000_000_000)]
    asset_class: Literal["stock", "long_bond", "mid_bond", "gold", "commodity", "cash", "mixed"]
    role: Literal["core", "satellite"] = "core"

    @field_validator("ticker")
    @classmethod
    def ticker_format(cls, v):
        v = (v or "").strip().upper() or None
        if v is not None and not TICKER_RE.match(v):
            raise ValueError("종목코드는 영문 대문자·숫자 6자리예요")
        return v


class CommitInput(InputModel):
    account_id: Annotated[str, Field(min_length=1, max_length=64)]
    source: Literal["capture", "file"]
    as_of: dt.date
    rows: Annotated[list[CommitRow], Field(min_length=1, max_length=1000)]
    screen_total: Annotated[int | None, Field(ge=0, le=10**15)] = None
    accept_diff: bool = False


@router.post("/commit")
def commit(data: CommitInput):
    accts, acct = _account_or_422(data.account_id)
    if data.as_of > dt.date.today():
        raise HTTPException(422, "기준일은 미래일 수 없어요.")
    owner = OWNER_TO_WEB.get(acct.get("owner"), "me")
    with storage.connection() as conn:
        storage.require_person(conn, owner)
    df = pd.DataFrame([{"account_id": data.account_id, "ticker_name": r.ticker_name.strip(), "ticker": r.ticker, "qty": r.qty, "price": r.price} for r in data.rows],
                      columns=HOLDING_COLUMNS)
    errors = validate_holdings(df)
    if errors:
        raise HTTPException(422, " / ".join(errors))
    rc = reconcile(df, data.screen_total)
    if rc.verified and not rc.ok and not data.accept_diff:
        raise HTTPException(422, f"화면 합계와 {rc.diff:+,}원 차이가 있어요. 틀린 칸을 고치거나 '차이를 확인했어요'를 켜 주세요.")
    # Group reconciliation is validated before snapshots or sheet holdings are changed.
    label = acct.get("label") or data.account_id
    pocket = POCKET_TO_WEB.get(acct.get("pocket"), "cash")
    by_class: dict[str, int] = {}
    for r in data.rows:
        by_class[r.asset_class] = by_class.get(r.asset_class, 0) + r.qty * r.price
    payloads = [{"name": f"{label} · {CLASS_LABELS.get(cls, '혼합·미분류')}", "account": label, "owner": owner, "pocket": pocket,
                 "assetClass": cls, "amount": amount, "as_of": data.as_of.isoformat()} for cls, amount in by_class.items()]
    from backend.account_groups import replace_group
    replace_group(storage.list_assets(), data.account_id, data.source, payloads, storage.now())
    # (1) 엔진용 스냅샷 — 등록·활성·형식·중복 검사는 store가 다시 한다 (SAFE-01/02)
    try:
        snapshots.SNAPSHOTS = snapshot_dir()
        snapshot_path = snapshots.save_holdings(data.account_id, df, on=data.as_of, accounts=accts)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    # (2) 종목 꼬리표 — 사용자가 고른 자산군은 '확인됨'으로 매핑에 남아 다음부터 안 묻는다. 혼합은 남기지 않는다
    tags = [{"ticker_name": r.ticker_name.strip(), "ticker": r.ticker, "asset_class": r.asset_class, "role": r.role}
            for r in data.rows if r.asset_class != "mixed"]
    tagged = upsert_asset_tags(tags, asset_map_path()) if tags else 0
    # (3) 시트 보유종목 탭
    store = ledger.sheet_store()
    if store is not None:
        store.replace_holdings(data.account_id, [r.model_dump() for r in data.rows], data.as_of.isoformat())
    # (4) 자산군별 자산 행
    created = storage.replace_account_assets(data.account_id, data.source, payloads)
    return {"assets": created, "holdings": len(data.rows), "tags_confirmed": tagged, "total": sum(by_class.values()),
            "snapshot": str(snapshot_path.relative_to(ROOT)) if snapshot_path.is_relative_to(ROOT) else snapshot_path.name,
            "sheet": store is not None}
