"""parse_balance — 보유 내역 입력. (1) CSV 읽기 (2) 앱 캡처 이미지 → 표 (Claude 비전, Agent SDK).

캡처 파싱은 처음 등록할 때와 수량이 바뀔 때만 쓴다. 매번의 현재가는 tools.market.fetch_prices.
검사 칸은 종목명·수량·현재가 세 개 (docs/AGENT_DESIGN.md 완료 기준 2).
"""
from __future__ import annotations

import asyncio
import datetime as dt
import math
import re
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

HOLDING_COLUMNS = ["account_id", "ticker_name", "ticker", "qty", "price"]

# 캡처 한 묶음은 둘 중 하나다 — (a) 증권사 종목 잔고(holdings: 종목·수량·현재가) (b) 연금 계약 표(contracts: 금융감독원
# 통합연금포털 '내 연금조회'처럼 가입회사·상품유형·상품명·연금개시예정일·적립금이 한 줄인 표). 연금보험처럼 종목이 없는
# 계약은 (b)로만 옮길 수 있다 (2026-11-02 사용자 캡처).
CONTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "company": {"type": "string", "description": "가입회사, 예: 한화생명보험"},
        "product_type": {"type": "string", "description": "상품유형, 예: 연금저축펀드 · 일반연금보험 · DC · IRP"},
        "product_name": {"type": "string", "description": "상품명"},
        "start_date": {"type": "string", "description": "가입일 YYYY-MM-DD, 없으면 빈 문자열"},
        "payout_start_date": {"type": "string", "description": "연금개시예정일 YYYY-MM-DD, 없으면 빈 문자열"},
        "amount": {"type": ["integer", "null"], "description": "화면에 적립금/계약자적립액으로 표시된 금액(원). 없으면 null. 총납입보험료·해지환급금·월납입액을 대신 넣지 않는다"},
        "insurance_detail": {"type": "boolean", "description": "보험사 앱의 개별 보험 계약 상세 화면이면 true"},
        "monthly_premium": {"type": ["integer", "null"], "description": "월납 보험료(원), 없으면 null. 연금 수령액이 아니다"},
        "total_premiums": {"type": ["integer", "null"], "description": "총납입보험료(원), 없으면 null"},
        "surrender_value": {"type": ["integer", "null"], "description": "해지환급금(원), 없으면 null. 적립금과 별개"},
        "paid_installments": {"type": ["integer", "null"], "description": "납입횟수 중 납입한 횟수, 없으면 null"},
        "total_installments": {"type": ["integer", "null"], "description": "총 납입예정 횟수, 없으면 null"},
        "as_of": {"type": "string", "description": "조회기준일 YYYY-MM-DD, 없으면 빈 문자열"},
    },
    "required": ["company", "product_type", "product_name", "start_date", "payout_start_date", "amount", "as_of", "insurance_detail", "monthly_premium", "total_premiums", "surrender_value", "paid_installments", "total_installments"],
    "additionalProperties": False,
}

CAPTURE_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["holdings", "contracts"], "description": "종목 잔고면 holdings, 연금 계약 표면 contracts"},
        "account_label": {"type": "string", "description": "화면 상단 계좌 이름(예: 연금저축계좌(신)) 또는 계약 표의 제목(예: 개인연금, 퇴직연금)"},
        "screen_total_value": {"type": "integer", "description": "화면에 보이는 평가금액 합계 또는 적립금 합계(원). 없으면 0"},
        "contracts": {"type": "array", "items": CONTRACT_SCHEMA, "description": "kind가 contracts일 때 계약 줄. holdings면 빈 배열"},
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
    "required": ["kind", "account_label", "screen_total_value", "contracts", "rows"],
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
        "다음 캡처 이미지를 Read 도구로 읽고 표로 옮겨라. 증권 잔고, 연금 계약 표, 보험사 계약 상세 화면을 지원한다.\n"
        "(a) 증권사 앱 잔고: 종목·보유수량·현재가가 있다 → kind=holdings, 보이는 종목 전부를 rows에. contracts는 빈 배열.\n"
        "(b) 연금 계약 표(금융감독원 통합연금포털 '내 연금조회' 등): 가입회사·상품유형·상품명·가입일·연금개시예정일·적립금·조회기준일이 "
        "한 줄씩 있다 → kind=contracts, 줄마다 contracts에. rows는 빈 배열. account_label은 표 제목(개인연금·퇴직연금·국민연금 등). "
        "날짜는 YYYY-MM-DD로, 적립금 합계가 보이면 screen_total_value에.\n"
        "(c) 보험사 앱 계약 상세(표가 아니어도 된다): 회사·상품명·월납·납입횟수·총납입보험료·해지환급금이 세로로 나오는 화면도 kind=contracts. "
        "계약 하나마다 contracts 한 줄, insurance_detail=true, rows=[]로 반환한다. 보험 상세를 종목으로 만들지 마라. "
        "amount는 명시된 적립금/계약자적립액만, 표시가 없으면 null. 월납·총납입보험료·해지환급금은 각각 monthly_premium·total_premiums·surrender_value에 옮겨라. "
        "120/120회처럼 납입횟수는 paid_installments/total_installments로 분리한다. 상품명은 그대로 보존한다. "
        "상품명에 연금보험이 있다는 이유만으로 일반연금보험/연금저축보험을 판단하지 마라. 명시된 상품유형이 없으면 product_type은 빈 문자열. "
        "보험기간의 시작은 start_date에 옮기되, 끝 날짜를 연금개시일로 추정하지 마라. 연금개시일이 별도로 명시된 경우에만 payout_start_date에 넣는다. "
        "같은 보험사라도 상품명이나 가입일이 다르면 별개 계약이다. account_label은 회사와 상품명으로 구분한다. "
        "보험 상세가 아닌 계약 표는 insurance_detail=false이며 나머지 보험 전용 항목은 보이지 않으면 null.\n"
        "같은 줄이 여러 이미지에 중복으로 보이면 한 번만 넣어라. 숫자는 쉼표를 빼고 정수로. "
        "계산하거나 추정하지 말고 화면에 보이는 값만 옮겨라.\n"
        + ("이미지에 계좌가 여러 개면 화면 상단의 계좌 이름(예: 연금저축계좌(신), IRP, ISA)으로 계좌별로 나눠라. "
           "증권 계좌 이름이 같은 잔고 이미지는 같은 계좌다. 보험은 회사 이름만 같다고 합치지 마라. 계좌마다 화면 합계를 따로 적어라.\n" if multi else "")
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
    if data.get("kind") == "contracts":
        return _contracts_from(data)
    df = pd.DataFrame(data["rows"])
    df.insert(0, "account_id", account_id)
    df["ticker"] = None
    rc = reconcile(df, data["screen_total_value"])
    meta = {"account_label": data["account_label"], "screen_total_value": data["screen_total_value"],
            "reconciled": rc.ok, "verified": rc.verified, "diff": rc.diff, "value_diff": rc.value_diff,
            "errors": validate_holdings(df)}
    return df[HOLDING_COLUMNS + ["value", "buy_value"]], meta


def _contracts_from(data: dict) -> tuple[pd.DataFrame, dict]:
    """연금 계약 표 묶음. 종목 표(df)는 비워 두고 meta['contracts']에 계약 줄을 담는다. 적립금 우선, 없으면 총납입보험료를 사용한다(사용자 결정). 출처를 함께 반환하며 해지환급금은 대입하지 않는다."""
    rows = []
    for c in data.get("contracts") or []:
        accumulated = _optional_int(c.get("amount"))
        premiums = _optional_int(c.get("total_premiums"))
        amount = accumulated if accumulated is not None else premiums
        amount_source = "accumulation" if accumulated is not None else "total_premiums" if premiums is not None else None
        rows.append({"company": str(c.get("company") or "").strip(), "product_type": str(c.get("product_type") or "").strip(),
                     "product_name": str(c.get("product_name") or "").strip(), "start_date": _iso_date(c.get("start_date")),
                     "payout_start_date": _iso_date(c.get("payout_start_date")), "amount": amount, "amount_source": amount_source, "as_of": _iso_date(c.get("as_of")),
                     "insurance_detail": c.get("insurance_detail") is True,
                     **{key: _optional_int(c.get(key)) for key in ("monthly_premium", "total_premiums", "surrender_value", "paid_installments", "total_installments")}})
    df = pd.DataFrame([], columns=HOLDING_COLUMNS + ["value", "buy_value"])
    meta = {"kind": "contracts", "account_label": data.get("account_label") or "", "contracts": rows,
            "screen_total_value": data.get("screen_total_value") or 0, "reconciled": True, "verified": False, "diff": 0, "value_diff": None, "errors": []}
    return df, meta


def _optional_int(value) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip().replace(",", "")
    return int(text) if re.fullmatch(r"\d+", text) else None


def _iso_date(value) -> str | None:
    """'2026/09/30' · '2026.09.30' · '2026-09-30' → '2026-09-30'. 못 읽으면 None (추정하지 않는다)."""
    m = re.search(r"(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?!\d)", str(value or ""))
    if not m:
        return None
    y, mo, d = (int(g) for g in m.groups())
    try:
        return dt.date(y, mo, d).isoformat()
    except ValueError:
        return None


def _frame_from(data: dict, account_id: str) -> tuple[pd.DataFrame, dict]:
    df = pd.DataFrame(data["rows"], columns=["ticker_name", "qty", "price", "value", "buy_value"])
    df.insert(0, "account_id", account_id)
    df["ticker"] = None
    rc = reconcile(df, data["screen_total_value"]) if len(df) else None
    meta = {"account_label": data["account_label"], "screen_total_value": data["screen_total_value"],
            "reconciled": bool(rc and rc.ok), "verified": bool(rc and rc.verified), "diff": rc.diff if rc else 0,
            "value_diff": rc.value_diff if rc else None,
            # 계좌는 확인 화면에서 정한다 — 아직 비어 있는 account_id는 오류로 보지 않는다 (종목명·수량·가격만 검사)
            "errors": validate_holdings(df.assign(account_id=account_id or "pending")) if len(df) else []}
    return df[HOLDING_COLUMNS + ["value", "buy_value"]], meta


def parse_captures(image_paths: list[str | Path]) -> list[tuple[pd.DataFrame, dict]]:
    """여러 계좌의 캡처를 한꺼번에 → 계좌별 (holdings DataFrame, meta) 목록. meta['account_label']이 캡처 상단의 계좌 이름.
    account_id 열은 비워 둔다(''). 어느 등록 계좌인지는 호출하는 쪽이 이름으로 맞춘다."""
    paths = [Path(p) for p in image_paths]
    data = asyncio.run(_parse_capture_async(paths, multi=True))
    groups = []
    for acct in data.get("accounts", []):
        if acct.get("kind") == "contracts" or (not acct.get("rows") and acct.get("contracts")):
            if acct.get("contracts"):
                groups.append(_contracts_from(acct))
            continue
        if not acct.get("rows"):
            continue
        groups.append(_frame_from(acct, ""))
    return groups
