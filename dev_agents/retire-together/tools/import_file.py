"""import_file — 보유 내역 파일(CSV·엑셀) → 보유 내역 표 (REG-01 '파일' 경로).

증권사·사용자가 내려받은 파일의 머리글은 제각각이라 이름을 느슨하게 맞춘다 (종목명/종목/상품명, 수량/보유수량/잔고수량, 현재가/단가/평가단가 …).
숫자는 쉼표·원·주 표기를 떼고 정수로. 값은 바꾸지 않고 못 읽는 행은 오류로 돌려준다 (SAFE-01 원칙).
"""
from __future__ import annotations

import csv
import io
import math
import re
from pathlib import Path

import pandas as pd

# 느슨한 머리글 ↔ 표준 열. 앞의 것이 우선.
HEADER_ALIASES: dict[str, list[str]] = {
    "ticker_name": ["ticker_name", "종목명", "종목", "상품명", "펀드명", "자산명", "name"],
    "ticker": ["ticker", "종목코드", "코드", "단축코드", "code", "isin"],
    "qty": ["qty", "수량", "보유수량", "잔고수량", "보유량", "quantity", "shares"],
    "price": ["price", "현재가", "단가", "평가단가", "기준가", "시세", "현재단가"],
    "value": ["value", "평가금액", "평가액", "금액", "evaluation"],
    "buy_value": ["buy_value", "매입금액", "매수금액", "투자원금", "원금"],
    "account_id": ["account_id", "계좌id", "계좌 id"],
    "account_label": ["계좌", "계좌명", "계좌이름", "account"],
    "asset_class": ["자산군", "asset_class"],
    "stock_group": ["주식 구분", "주식구분", "stock_group"],
}
# 양식·표에서 쓰는 한글 이름 → 키 (엑셀 양식의 고르는 칸과 같다)
CLASS_BY_LABEL = {"주식": "stock", "장기채": "long_bond", "중기채": "mid_bond", "금": "gold", "원자재": "commodity", "현금": "cash", "혼합·미분류": "mixed"}
GROUP_BY_LABEL = {"국내": "kr", "미국": "us", "신흥국·테마": "em", "배당·리츠": "income"}


def _label_value(v, table: dict) -> str | None:
    s = str(v or "").strip()
    if not s or s.lower() == "nan":
        return None
    return table.get(s) or (s if s in table.values() else None)
REQUIRED = ["ticker_name", "qty"]
MAX_ROWS = 1000
MAX_BYTES = 5 * 1024 * 1024


def _norm(s) -> str:
    return re.sub(r"[\s_()\[\]-]", "", str(s)).lower()


def _match_columns(columns: list) -> dict[str, str]:
    """파일 머리글 → 표준 열 이름. 같은 표준 열에 두 머리글이 맞으면 먼저 나온 별칭을 쓴다."""
    normalized = {_norm(c): c for c in columns}
    out: dict[str, str] = {}
    for std, aliases in HEADER_ALIASES.items():
        for a in aliases:
            if _norm(a) in normalized:
                out[std] = normalized[_norm(a)]
                break
    return out


def _to_int(v) -> int | None:
    """'1,234원' '12.0' 1234 → 1234. 빈 값·NaN·소수·음수는 None."""
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        f = float(v)
    else:
        s = re.sub(r"[,\s원주개구좌]", "", str(v))
        if not s or s.lower() in ("nan", "none", "-", "—"):
            return None
        try:
            f = float(s)
        except ValueError:
            return None
    if not math.isfinite(f) or f < 0 or float(int(f)) != f:
        return None
    return int(f)


def _clean_ticker(v) -> str | None:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    s = str(v).strip().upper()
    if not s or s in ("NAN", "NONE"):
        return None
    if re.fullmatch(r"\d{1,6}", s):   # 엑셀이 숫자로 읽어 앞의 0이 빠진 종목코드
        return s.zfill(6)
    if s.startswith("A") and re.fullmatch(r"A\d{6}", s):   # 증권사 표기 A069500
        return s[1:]
    return s


def read_table(data: bytes, filename: str) -> pd.DataFrame:
    """바이트 → 원본 표 (첫 시트, 머리글 행 자동 탐색). 지원: .csv .xlsx .xls(x) ."""
    if len(data) > MAX_BYTES:
        raise ValueError("파일이 5MB를 넘어요. 보유 내역만 담긴 파일을 올려 주세요.")
    suffix = Path(filename).suffix.lower()
    if suffix == ".csv":
        for enc in ("utf-8-sig", "cp949", "euc-kr"):
            try:
                text = data.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            raise ValueError("CSV 글자 인코딩을 읽을 수 없어요 (UTF-8 또는 한글 윈도우 CP949로 저장해 주세요).")
        # 증권사 CSV는 제목 줄의 칸 수가 표와 달라 pandas가 거부한다 → csv 모듈로 읽어 폭을 맞춘다
        lines = [row for row in csv.reader(io.StringIO(text))]
        width = max((len(r) for r in lines), default=0)
        if not width:
            raise ValueError("파일이 비어 있어요.")
        raw = pd.DataFrame([r + [""] * (width - len(r)) for r in lines], dtype=str)
    elif suffix in (".xlsx", ".xlsm", ".xls"):
        try:
            raw = pd.read_excel(io.BytesIO(data), header=None, dtype=object)
        except Exception as e:
            raise ValueError(f"엑셀 파일을 읽지 못했어요: {e}") from e
    else:
        raise ValueError("CSV 또는 엑셀(.xlsx) 파일만 올릴 수 있어요.")
    if raw.empty:
        raise ValueError("파일이 비어 있어요.")
    # 머리글 행: 종목명 계열과 수량 계열이 함께 보이는 첫 행 (증권사 파일은 위에 제목 줄이 있다)
    header_idx = None
    for i in range(min(len(raw), 30)):
        cells = [str(c) for c in raw.iloc[i].tolist()]
        found = _match_columns(cells)
        if all(k in found for k in REQUIRED):
            header_idx = i
            break
    if header_idx is None:
        raise ValueError("종목명과 수량 열을 찾지 못했어요. 머리글에 '종목명'·'수량'(또는 ticker_name·qty)이 있어야 해요.")
    df = raw.iloc[header_idx + 1:].copy()
    df.columns = [str(c).strip() for c in raw.iloc[header_idx].tolist()]
    df = df.loc[:, [c for c in df.columns if c and c.lower() != "nan"]]
    return df.reset_index(drop=True)


def holdings_from_file(data: bytes, filename: str, account_id: str) -> tuple[pd.DataFrame, dict]:
    """파일 → 보유 내역 표(account_id, ticker_name, ticker, qty, price, value, buy_value) + 메타.
    price가 없고 value가 있으면 price = value / qty (나누어떨어질 때만). 못 읽는 행은 meta['errors']."""
    raw = read_table(data, filename)
    cols = _match_columns(list(raw.columns))
    rows, errors = [], []
    for i, r in raw.iterrows():
        n = int(i) + 1
        name = str(r[cols["ticker_name"]]).strip() if cols.get("ticker_name") else ""
        if not name or name.lower() in ("nan", "합계", "총계", "계"):
            continue
        qty = _to_int(r[cols["qty"]]) if cols.get("qty") else None
        price = _to_int(r[cols["price"]]) if cols.get("price") else None
        value = _to_int(r[cols["value"]]) if cols.get("value") else None
        buy_value = _to_int(r[cols["buy_value"]]) if cols.get("buy_value") else None
        ticker = _clean_ticker(r[cols["ticker"]]) if cols.get("ticker") else None
        if price is None and value is not None and qty:
            price = value // qty if value % qty == 0 else None
        if qty is None or qty == 0:
            errors.append(f"{n}행 {name}: 수량이 양의 정수가 아니에요")
            continue
        if price is None or price == 0:
            errors.append(f"{n}행 {name}: 현재가(또는 평가금액÷수량)를 읽지 못했어요")
            continue
        label = str(r[cols["account_label"]]).strip() if cols.get("account_label") else ""
        rows.append({"account_id": account_id, "ticker_name": name, "ticker": ticker, "qty": qty, "price": price,
                     "value": value if value is not None else qty * price, "buy_value": buy_value if buy_value is not None else 0,
                     "account_label": "" if label.lower() == "nan" else label,
                     "asset_class": _label_value(r[cols["asset_class"]], CLASS_BY_LABEL) if cols.get("asset_class") else None,
                     "stock_group": _label_value(r[cols["stock_group"]], GROUP_BY_LABEL) if cols.get("stock_group") else None})
    if len(rows) > MAX_ROWS:
        raise ValueError(f"행이 {MAX_ROWS}개를 넘어요.")
    df = pd.DataFrame(rows, columns=["account_id", "ticker_name", "ticker", "qty", "price", "value", "buy_value", "account_label", "asset_class", "stock_group"])
    computed = int((df["qty"] * df["price"]).sum()) if len(df) else 0
    value_total = int(df["value"].sum()) if len(df) else 0
    meta = {"account_label": None, "screen_total_value": value_total if cols.get("value") else 0,
            "verified": bool(cols.get("value")), "reconciled": bool(cols.get("value")) and abs(value_total - computed) <= 5_000,
            "diff": computed - value_total if cols.get("value") else 0, "value_diff": value_total - computed if cols.get("value") else None,
            "errors": errors, "matched_columns": cols, "source_rows": int(len(raw))}
    return df, meta
