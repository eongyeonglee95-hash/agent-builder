"""parse_balance — 보유 내역 입력. (1) CSV 읽기 (2) 앱 캡처 이미지 → 표 (Claude 비전, Agent SDK).

캡처 파싱은 처음 등록할 때와 수량이 바뀔 때만 쓴다. 매번의 현재가는 tools.market.fetch_prices.
검사 칸은 종목명·수량·현재가 세 개 (docs/AGENT_DESIGN.md 완료 기준 2).
"""
from __future__ import annotations

import asyncio
import math
import re
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

HOLDING_COLUMNS = ["account_id", "ticker_name", "ticker", "qty", "price"]

CAPTURE_SCHEMA = {
    "type": "object",
    "properties": {
        "account_label": {"type": "string", "description": "화면 상단 계좌 이름, 예: 연금저축계좌(신)"},
        "screen_total_value": {"type": "integer", "description": "화면에 보이는 평가금액 합계(원). 없으면 0"},
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "ticker_name": {"type": "string"},
                    "qty": {"type": "integer", "description": "보유수량"},
                    "price": {"type": "integer", "description": "현재가(원)"},
                    "value": {"type": "integer", "description": "평가금액(원)"},
                    "buy_value": {"type": "integer", "description": "매입금액(원), 없으면 0"},
                },
                "required": ["ticker_name", "qty", "price", "value", "buy_value"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["account_label", "screen_total_value", "rows"],
    "additionalProperties": False,
}


# 여러 계좌의 캡처를 한꺼번에 올릴 때 (REG-01 '전체'): 계좌별로 나눠 돌려준다
CAPTURE_MULTI_SCHEMA = {
    "type": "object",
    "properties": {"accounts": {"type": "array", "items": CAPTURE_SCHEMA}},
    "required": ["accounts"],
    "additionalProperties": False,
}

ACCOUNT_ID_RE = re.compile(r"^[A-Za-z0-9_]{1,64}$")   # 저장 경로에 쓰이므로 경로 문자(/ . 공백) 금지


def _is_whole_positive(v) -> bool:
    """유한한 양의 정수값인지 (1.9, -2, 0, NaN, inf 는 아님). 문자열 '3'은 허용."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return False
    return math.isfinite(f) and f > 0 and float(int(f)) == f


def validate_holdings(df: pd.DataFrame) -> list[str]:
    """보유 내역 표의 행·열별 오류 목록. 비어 있으면 통과 (SAFE-01: 입력 경계에서 타입·범위·중복·계좌 검증).
    행 번호는 CSV 기준(머리글이 1행)."""
    errors: list[str] = []
    missing = [c for c in HOLDING_COLUMNS if c not in df.columns]
    if missing:
        return [f"CSV에 없는 열: {missing}"]
    for i, row in df.iterrows():
        n = int(i) + 2
        acct = row["account_id"]
        if not isinstance(acct, str) or not ACCOUNT_ID_RE.match(acct):
            errors.append(f"{n}행 account_id: 영문·숫자·밑줄만 허용 (받은 값: {acct!r})")
        name = row["ticker_name"]
        if not isinstance(name, str) or not name.strip():
            errors.append(f"{n}행 ticker_name: 종목명이 비어 있음")
        if not _is_whole_positive(row["qty"]):
            errors.append(f"{n}행 qty: 양의 정수여야 함 (받은 값: {row['qty']!r})")
        if not _is_whole_positive(row["price"]):
            errors.append(f"{n}행 price: 양의 정수여야 함 (받은 값: {row['price']!r})")
    dup = df.duplicated(subset=["account_id", "ticker_name"], keep=False)
    if dup.any():
        pairs = df.loc[dup, ["account_id", "ticker_name"]].drop_duplicates().itertuples(index=False)
        errors.append("중복 행: " + ", ".join(f"{a}/{t}" for a, t in pairs) + " — 같은 계좌·종목은 한 행으로")
    return errors


def load_holdings_csv(path: str | Path) -> pd.DataFrame:
    """CSV → 검증된 보유 내역. 잘못된 입력은 행/열별 메시지로 ValueError (잘라내거나 바꾸지 않는다)."""
    df = pd.read_csv(path, encoding="utf-8-sig", dtype={"ticker": str, "account_id": str, "ticker_name": str})
    errors = validate_holdings(df)
    if errors:
        raise ValueError("보유 내역 CSV 오류:\n" + "\n".join(errors))
    df["qty"] = df["qty"].astype(float).astype(int)
    df["price"] = df["price"].astype(float).astype(int)
    return df


@dataclass(frozen=True)
class ReconcileResult:
    verified: bool      # 화면 합계가 있어서 대조할 수 있었는가. False면 '검증 불가'이지 '일치'가 아니다
    ok: bool            # verified이고, 수량×가격 합계가 화면 합계와 맞고, 전사한 value도 수량×가격과 맞음
    computed: int       # Σ 수량×가격 — 주문표 계산에 쓰는 값
    diff: int           # computed − 화면 합계
    value_total: int | None   # 전사한 평가금액 합계 (value 열이 있을 때)
    value_diff: int | None    # value_total − computed


def reconcile(rows: pd.DataFrame, screen_total: int | None, tolerance: int = 5_000) -> ReconcileResult:
    """파싱한 행의 합계와 화면 합계를 대조. 합계는 항상 수량×가격으로 계산한다 — 전사한 value 열은 따로 대조만 한다
    (SAFE-01: value 열 합계를 그대로 믿으면 수량×가격이 틀려도 '일치'로 통과했다)."""
    computed = int((rows["qty"].astype(float) * rows["price"].astype(float)).sum())
    value_total = int(rows["value"].astype(float).sum()) if "value" in rows else None
    value_diff = (value_total - computed) if value_total is not None else None
    verified = bool(screen_total)
    diff = computed - int(screen_total or 0)
    ok = verified and abs(diff) <= tolerance and (value_diff is None or abs(value_diff) <= tolerance)
    return ReconcileResult(verified, ok, computed, diff, value_total, value_diff)


async def _parse_capture_async(image_paths: list[Path], multi: bool = False) -> dict:
    from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

    files = "\n".join(f"- {p.resolve()}" for p in image_paths)
    prompt = (
        "다음 증권사 앱 잔고 캡처 이미지를 Read 도구로 읽고, 보이는 종목 전부를 표로 옮겨라. "
        "같은 종목이 여러 이미지에 중복으로 보이면 한 번만 넣어라. 숫자는 쉼표를 빼고 정수로. "
        "계산하거나 추정하지 말고 화면에 보이는 값만 옮겨라. 화면 합계(평가금액)도 보이면 적어라.\n"
        + ("이미지에 계좌가 여러 개면 화면 상단의 계좌 이름(예: 연금저축계좌(신), IRP, ISA)으로 계좌별로 나눠라. "
           "계좌 이름이 같은 이미지는 같은 계좌다. 계좌마다 화면 합계를 따로 적어라.\n" if multi else "")
        + files
    )
    options = ClaudeAgentOptions(
        allowed_tools=["Read"],
        permission_mode="dontAsk",
        max_turns=12 + (6 if multi else 0),
        output_format={"type": "json_schema", "schema": CAPTURE_MULTI_SCHEMA if multi else CAPTURE_SCHEMA},
        system_prompt="너는 표 전사 도구다. 보이는 값만 옮긴다. 분류·판단·계산을 하지 않는다.",
    )
    result = None
    async for msg in query(prompt=prompt, options=options):
        if isinstance(msg, ResultMessage):
            result = msg
    if result is None or result.structured_output is None:
        raise RuntimeError(f"캡처 파싱 실패: {getattr(result, 'result', None)}")
    return result.structured_output


def parse_capture(image_paths: list[str | Path], account_id: str) -> tuple[pd.DataFrame, dict]:
    """캡처 이미지들 → holdings DataFrame. 두 번째 반환값은 {account_label, screen_total_value, reconciled, diff}."""
    paths = [Path(p) for p in image_paths]
    data = asyncio.run(_parse_capture_async(paths))
    df = pd.DataFrame(data["rows"])
    df.insert(0, "account_id", account_id)
    df["ticker"] = None
    rc = reconcile(df, data["screen_total_value"])
    meta = {"account_label": data["account_label"], "screen_total_value": data["screen_total_value"],
            "reconciled": rc.ok, "verified": rc.verified, "diff": rc.diff, "value_diff": rc.value_diff,
            "errors": validate_holdings(df)}
    return df[HOLDING_COLUMNS + ["value", "buy_value"]], meta


def _frame_from(data: dict, account_id: str) -> tuple[pd.DataFrame, dict]:
    df = pd.DataFrame(data["rows"], columns=["ticker_name", "qty", "price", "value", "buy_value"])
    df.insert(0, "account_id", account_id)
    df["ticker"] = None
    rc = reconcile(df, data["screen_total_value"]) if len(df) else None
    meta = {"account_label": data["account_label"], "screen_total_value": data["screen_total_value"],
            "reconciled": bool(rc and rc.ok), "verified": bool(rc and rc.verified), "diff": rc.diff if rc else 0,
            "value_diff": rc.value_diff if rc else None, "errors": validate_holdings(df) if len(df) else []}
    return df[HOLDING_COLUMNS + ["value", "buy_value"]], meta


def parse_captures(image_paths: list[str | Path]) -> list[tuple[pd.DataFrame, dict]]:
    """여러 계좌의 캡처를 한꺼번에 → 계좌별 (holdings DataFrame, meta) 목록. meta['account_label']이 캡처 상단의 계좌 이름.
    account_id 열은 비워 둔다(''). 어느 등록 계좌인지는 호출하는 쪽이 이름으로 맞춘다."""
    paths = [Path(p) for p in image_paths]
    data = asyncio.run(_parse_capture_async(paths, multi=True))
    groups = []
    for acct in data.get("accounts", []):
        if not acct.get("rows"):
            continue
        groups.append(_frame_from(acct, ""))
    return groups
