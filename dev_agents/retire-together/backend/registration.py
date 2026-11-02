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
from tools.assets import STOCK_GROUPS, guess_stock_group, load_accounts, load_asset_map, load_accounts_list, load_pools, save_accounts, upsert_asset_tags
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
                     "asset_class": (r.get("asset_class") if r.get("asset_class") in (*ASSET_CLASSES, "mixed") else None)
                                    or (entry.get("asset_class") if entry.get("asset_class") in ASSET_CLASSES else None),
                     "stock_group": (r.get("stock_group") if r.get("stock_group") in STOCK_GROUPS else None)
                                    or (entry.get("stock_group") if entry.get("stock_group") in STOCK_GROUPS else guess_stock_group(r["ticker_name"])),
                     "role": entry.get("role") if entry.get("role") in ("core", "satellite") else None,
                     "confirmed": entry.get("status") == "confirmed", "candidates": []})
    for name, cands in meta.get("unresolved", []) or []:
        for row in rows:
            if row["ticker_name"] == name:
                row["candidates"] = [list(c) for c in cands[:5]]
    computed = sum((r["qty"] or 0) * (r["price"] or 0) for r in rows)
    return {"account_id": account_id, "account_label": label, "source": source, "rows": rows, "computed_total": computed,
            "screen_total": meta.get("screen_total_value") or None, "verified": bool(meta.get("verified")),
            "reconciled": bool(meta.get("reconciled")), "diff": meta.get("diff", 0), "value_diff": meta.get("value_diff"),
            "errors": list(meta.get("errors") or []), "class_labels": CLASS_LABELS, "stock_groups": STOCK_GROUPS}


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
        if meta.get("kind") == "contracts":
            continue   # 계약 표에는 종목코드가 없다
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
        if meta.get("kind") == "contracts":
            out.append(_contracts_preview(meta, owner or "me"))
            continue
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
    labels = [x for x in df["account_label"].fillna("").unique() if x] if "account_label" in df and not account_id else []
    if labels:   # 엑셀 양식처럼 '계좌' 열이 있으면 한 파일에 여러 계좌
        out = []
        for lab in labels:
            part = df[df["account_label"] == lab]
            matched = match_account(lab, accts)
            sub_meta = {**meta, "verified": False, "reconciled": False, "screen_total_value": 0, "diff": 0, "value_diff": None,
                        "errors": meta["errors"] if lab == labels[0] else []}
            pv = _preview(part, sub_meta, matched, lab, "file")
            pv["matched_label"] = accts[matched].get("label") if matched else None
            pv["suggested"] = suggest_account(lab, owner or "me")
            out.append(pv)
        return {"groups": out}
    label = (acct.get("label") if acct else None) or stem or "파일"
    matched = account_id or match_account(stem, accts)
    preview = _preview(df, meta, matched, label, "file")
    preview["matched_label"] = accts[matched].get("label") if matched else None
    preview["suggested"] = suggest_account(stem, owner or "me")
    return {"groups": [preview]}


# ---------- 엑셀 양식 (진짜 엑셀로 입력) ----------

TEMPLATE_COLUMNS = ["계좌", "종목명", "종목코드", "보유수량", "현재가", "매입금액", "자산군", "주식 구분"]
CLASS_LABEL_LIST = ["주식", "장기채", "중기채", "금", "원자재", "현금", "혼합·미분류"]
GROUP_LABEL_LIST = list(STOCK_GROUPS.values())


@router.get("/template.xlsx")
def template(prefill: bool = False, owner: Literal["together", "me", "partner"] = "together"):
    """엑셀 양식. prefill=1이면 지금 잔고를 채워 준다 — 엑셀에서 고쳐 '파일'로 다시 올리면 된다.
    계좌·자산군·주식 구분은 엑셀 안에서 고르는 칸(데이터 유효성)."""
    import io
    from fastapi.responses import Response
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation
    accts = load_accounts(accounts_path())
    labels = [a.get("label") or k for k, a in accts.items() if a.get("active", True) is not False]
    wb = Workbook(); ws = wb.active; ws.title = "보유종목"
    ws.append(TEMPLATE_COLUMNS)
    for c in ws[1]:
        c.font = Font(bold=True); c.fill = PatternFill("solid", fgColor="F2F2F2"); c.alignment = Alignment(horizontal="center")
    if prefill:
        from backend.holdings import load_rows
        accounts, rows = load_rows(owner)
        name_of = {a.id: a.label for a in accounts}
        cls_label = {"stock": "주식", "long_bond": "장기채", "mid_bond": "중기채", "gold": "금", "commodity": "원자재", "cash": "현금", "mixed": "혼합·미분류"}
        for h in rows:
            ws.append([name_of.get(h.account_id, h.account_id), h.ticker_name, h.ticker or "", h.qty, h.price, h.buy_value or None,
                       cls_label.get(h.asset_class or "", ""), STOCK_GROUPS.get(h.stock_group or "", "")])
    for col, w in zip("ABCDEFGH", [22, 28, 11, 11, 12, 14, 12, 12]):
        ws.column_dimensions[col].width = w
    for col in "DEF":
        for cell in ws[col][1:400]:
            cell.number_format = "#,##0"
    ws.freeze_panes = "A2"
    lists = wb.create_sheet("목록")
    for i, v in enumerate(labels, 1): lists.cell(i, 1, v)
    for i, v in enumerate(CLASS_LABEL_LIST, 1): lists.cell(i, 2, v)
    for i, v in enumerate(GROUP_LABEL_LIST, 1): lists.cell(i, 3, v)
    lists.sheet_state = "hidden"
    for col, src, n in (("A", "A", max(len(labels), 1)), ("G", "B", len(CLASS_LABEL_LIST)), ("H", "C", len(GROUP_LABEL_LIST))):
        dv = DataValidation(type="list", formula1=f"=목록!${src}$1:${src}${n}", allow_blank=True,
                            showErrorMessage=col != "A", errorTitle="목록에서 골라 주세요", error="목록에 있는 값만 넣을 수 있어요.")
        ws.add_data_validation(dv); dv.add(f"{col}2:{col}500")
    guide = wb.create_sheet("안내")
    for line in ["채운 뒤 둘이서은퇴 → 자산 등록 → 파일로 이 파일을 올리면 계좌별로 나눠 확인 화면이 열려요.",
                 "계좌: 목록에서 고르거나 새 이름을 적으면 확인 화면에서 새 계좌로 추가할 수 있어요.",
                 "보유수량·현재가는 필수, 매입금액은 알면 적어요(넣은 돈·불어난 돈 계산에 써요).",
                 "자산군·주식 구분은 비워 두면 확인 화면에서 골라요. 한 번 고르면 다음부터 안 물어요."]:
        guide.append([line])
    guide.column_dimensions["A"].width = 100
    buf = io.BytesIO(); wb.save(buf)
    name = "dulyeo_holdings.xlsx"
    return Response(buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename=\"{name}\"; filename*=UTF-8''%EB%91%98%EC%9D%B4%EC%84%9C%EC%9D%80%ED%87%B4_%EB%B3%B4%EC%9C%A0%EC%A2%85%EB%AA%A9.xlsx"})


@router.get("/sheet")
def sheet_rows(owner: Literal["together", "me", "partner"] = "together"):
    """'엑셀처럼 고치기' 표의 보유종목 탭: 지금 잔고 행 + 고를 수 있는 계좌 목록."""
    from backend.holdings import load_rows
    accts = load_accounts(accounts_path())
    accounts, rows = load_rows(owner)
    return {"accounts": [account_view(k, v, set()) for k, v in accts.items() if v.get("active", True) is not False],
            "rows": [{"account_id": h.account_id, "ticker_name": h.ticker_name, "ticker": h.ticker, "qty": h.qty, "price": h.price,
                      "buy_value": h.buy_value, "asset_class": h.asset_class, "stock_group": h.stock_group} for h in rows],
            "as_of": {a.id: a.as_of.isoformat() if a.as_of else None for a in accounts}}


# ---------- 연금 계약 표 (통합연금포털 캡처) ----------

LAYER_LABELS = {1: "국민연금", 2: "퇴직연금 · DC·IRP", 3: "개인연금 · 연금저축(세제적격)", 4: "추가연금 · 연금보험(세제비적격)·ISA"}
_LAYER2 = re.compile(r"IRP|퇴직|DC|DB", re.IGNORECASE)
_LAYER4 = re.compile(r"ISA|연금보험|추가연금", re.IGNORECASE)   # backend.retirement._EXTRA 와 같은 뜻


def guess_layer(label: str, product_type: str = "") -> int:
    """표 제목·상품유형으로 연금 층을 미리 고른다. 사용자가 확인 화면에서 바꾼다. 적립금 계산·판단은 하지 않는다."""
    text = f"{label} {product_type}"
    if "국민" in text:
        return 1
    if _LAYER2.search(text):
        return 2
    if "연금저축" in text:
        return 3
    if _LAYER4.search(text):
        return 4
    return 3


def _overlaps_existing(contract: dict, existing_accounts: list[str]) -> bool:
    """증권사 잔고(캡처·파일)로 이미 등록한 연금저축·IRP 계좌가 있으면 포털의 같은 종류 계약은 두 번 잡힐 수 있다 → 기본 제외 표시.
    판단은 '종류 이름이 겹친다'는 힌트일 뿐이며 사용자가 확인 화면에서 켠다."""
    ptype = (contract.get("product_type") or "")
    keys = [k for k in ("연금저축", "IRP", "DC") if k.casefold() in ptype.casefold()]
    return any(k.casefold() in acct.casefold() for k in keys for acct in existing_accounts)


def _contracts_preview(meta: dict, owner: str) -> dict:
    label = meta.get("account_label") or "연금"
    owner = owner if owner in ("me", "partner") else "me"
    brokered = [a.get("account") or "" for a in storage.list_assets() if a.get("owner") == owner and a.get("pocket") == "retirement" and a.get("source") in ("capture", "file")]
    rows = [{**c, "layer": guess_layer(label, c.get("product_type") or ""), "overlap": _overlaps_existing(c, brokered)} for c in meta.get("contracts") or []]
    total = sum(r["amount"] for r in rows)
    screen = meta.get("screen_total_value") or None
    return {"kind": "contracts", "account_id": None, "account_label": label, "source": "capture", "rows": [], "contracts": rows,
            "computed_total": total, "screen_total": screen, "verified": bool(screen), "reconciled": screen is None or abs(total - screen) <= 5000,
            "diff": (total - screen) if screen else 0, "value_diff": None, "errors": [], "class_labels": CLASS_LABELS, "layer_labels": LAYER_LABELS,
            "owner": owner}


class ContractRow(InputModel):
    company: Annotated[str, Field(min_length=1, max_length=60)]
    product_type: Annotated[str, Field(max_length=60)] = ""
    product_name: Annotated[str, Field(min_length=1, max_length=100)]
    amount: Annotated[int, Field(strict=True, ge=0, le=10**15)]
    as_of: dt.date
    payout_start_date: dt.date | None = None
    layer: Literal[2, 3, 4]


class ContractsInput(InputModel):
    owner: Literal["me", "partner"]
    rows: Annotated[list[ContractRow], Field(min_length=1, max_length=200)]


def _layer_account(row: ContractRow) -> str:
    """자산 장부의 계좌 이름. 장부는 계좌 하나에 총액 자산 하나만 허용하므로 계약마다 다른 이름(회사 · 상품명)을 쓴다.
    backend.retirement.layer_of 가 이름으로 층을 정하므로 고른 층이 이름에 드러나게 한다."""
    base = " · ".join(x for x in (row.company.strip(), row.product_name.strip()) if x)
    if row.layer == 2 and not _LAYER2.search(base):
        base += " · IRP"
    if row.layer == 4 and not _LAYER4.search(base):
        base += " · 추가연금"
    if row.layer == 3:
        base = _LAYER4.sub("", _LAYER2.sub("", base)).strip(" ·") or row.company.strip()
        if "연금저축" not in base:
            base += " · 연금저축"
    return base[:100]


@router.post("/contracts")
def save_contracts(data: ContractsInput):
    """연금 계약 줄 → 노후 주머니의 금액 자산(종목 없음). 같은 소유자·계좌·상품명이 이미 있으면 금액·기준일만 갱신한다.
    적립금은 보이는 값 그대로 저장하며 수익·수령액 계산은 하지 않는다. 연금개시예정일은 저장하지 않고 응답에만 돌려준다."""
    from uuid import UUID, uuid4
    today = dt.date.today()
    with storage.connection() as conn:
        storage.require_person(conn, data.owner)
    existing = [a for a in storage.list_assets() if a.get("owner") == data.owner and a.get("pocket") == "retirement"]
    created, updated, total, saved = 0, 0, 0, []
    for row in data.rows:
        if row.as_of > today:
            raise HTTPException(422, f"{row.product_name}: 기준일은 미래일 수 없어요.")
        account = _layer_account(row)
        payload = {"name": row.product_name.strip()[:100], "account": account, "owner": data.owner, "pocket": "retirement", "assetClass": "mixed",
                   "amount": row.amount, "as_of": row.as_of.isoformat()}
        match = next((a for a in existing if a.get("name") == payload["name"] and a.get("account") == account), None)
        if match is not None:
            out = storage.update_asset(UUID(match["id"]), storage.AssetUpdate(**{**payload, "version": match["version"]}))
            updated += 1
        else:
            out = storage.create_asset(storage.AssetCreate(**{**payload, "request_id": uuid4()}))
            created += 1
        total += row.amount
        saved.append({"id": out["id"], "name": payload["name"], "account": account, "amount": row.amount, "layer": row.layer,
                      "payout_start_date": row.payout_start_date.isoformat() if row.payout_start_date else None})
    return {"created": created, "updated": updated, "total": total, "assets": saved}


# ---------- 저장 ----------

class CommitRow(InputModel):
    ticker_name: Annotated[str, Field(min_length=1, max_length=100)]
    ticker: Annotated[str | None, Field(max_length=12)] = None
    qty: Annotated[int, Field(strict=True, ge=1, le=100_000_000)]
    price: Annotated[int, Field(strict=True, ge=1, le=1_000_000_000)]
    asset_class: Literal["stock", "long_bond", "mid_bond", "gold", "commodity", "cash", "mixed"]
    role: Literal["core", "satellite"] | None = None          # 안 보내면 매핑의 기존 역할을 그대로 둔다
    stock_group: Literal["kr", "us", "em", "income"] | None = None
    buy_value: Annotated[int | None, Field(ge=0, le=10**15)] = None   # 매입금액(캡처·파일에 있을 때). 손익 표시용

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
    df = pd.DataFrame([{"account_id": data.account_id, "ticker_name": r.ticker_name.strip(), "ticker": r.ticker, "qty": r.qty, "price": r.price,
                        "buy_value": r.buy_value} for r in data.rows], columns=HOLDING_COLUMNS + ["buy_value"])
    errors = validate_holdings(df)
    if errors:
        raise HTTPException(422, " / ".join(errors))
    rc = reconcile(df[HOLDING_COLUMNS], data.screen_total)
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
    tags = [{"ticker_name": r.ticker_name.strip(), "ticker": r.ticker, "asset_class": r.asset_class, "role": r.role, "stock_group": r.stock_group}
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
