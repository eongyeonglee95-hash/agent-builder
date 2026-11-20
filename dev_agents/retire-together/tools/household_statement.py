"""가계부 명세서 파일 — 카드사·은행에서 내려받은 엑셀·CSV → [{date, merchant, amount}]. AI 없이 코드로만 읽는다.

머리글 이름은 rules/household_book.yaml `statement_columns`. 취소·환불·입금·음수 금액은 뺀다. 분류는 tools/household_book.classify가 한다.
"""
from __future__ import annotations

import datetime as dt
from html.parser import HTMLParser
import math
import re

import pandas as pd

from tools.import_file import read_raw

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 2000


def _norm(s) -> str:
    """머리글 맞추기: 괄호 속 단위('(원)')·띄어쓰기·기호를 뗀다."""
    return re.sub(r"[\s_()\[\]\-./·:]", "", re.sub(r"\(.*?\)|\[.*?\]", "", str(s))).lower()


class _Tables(HTMLParser):
    """카드사 '.xls'는 HTML 표인 경우가 많다 → 칸만 꺼낸다(추가 라이브러리 없이)."""
    def __init__(self):
        super().__init__(); self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr": self.row = []
        elif tag in ("td", "th") and self.row is not None: self.cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.row.append(" ".join("".join(self.cell).split())); self.cell = None
        elif tag == "tr" and self.row is not None:
            if any(self.row): self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None: self.cell.append(data)


def _raw(data: bytes, filename: str) -> pd.DataFrame:
    if len(data) > MAX_BYTES:
        raise ValueError("파일이 5MB를 넘어요. 한 달 치 명세서만 올려 주세요.")
    head = data[:2048].lstrip().lower()
    if head.startswith((b"<", b"\xef\xbb\xbf<")) and b"<t" in data[:200000].lower():
        for enc in ("utf-8", "cp949", "euc-kr"):
            try:
                text = data.decode(enc); break
            except UnicodeDecodeError:
                continue
        else:
            raise ValueError("파일 글자 인코딩을 읽을 수 없어요.")
        p = _Tables(); p.feed(text)
        if not p.rows:
            raise ValueError("파일에서 표를 찾지 못했어요.")
        width = max(len(r) for r in p.rows)
        return pd.DataFrame([r + [""] * (width - len(r)) for r in p.rows], dtype=object)
    try:
        return read_raw(data, filename)
    except ValueError as e:
        if filename.lower().endswith(".xls"):
            raise ValueError("이 엑셀(.xls) 파일은 읽지 못했어요. 엑셀에서 .xlsx나 CSV로 다시 저장해 올려 주세요.") from None
        raise ValueError(str(e).replace("보유 내역", "명세서")) from None


def _columns(cells: list, aliases: dict[str, list[str]]) -> dict[str, int]:
    norm = [_norm(c) for c in cells]
    out: dict[str, int] = {}
    for std, names in aliases.items():
        for name in names:
            if _norm(name) in norm:
                out[std] = norm.index(_norm(name)); break
    return out


def parse_date(v, year: int) -> str:
    """'2026.11.03' '26-11-03 12:30' '11/03' 20261103 엑셀 날짜 → ISO. 못 읽으면 ''."""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return ""
    if isinstance(v, (dt.datetime, pd.Timestamp)):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    s = str(v).strip()
    m = re.match(r"^(\d{4})(\d{2})(\d{2})", s)
    if m:
        y, mo, d = map(int, m.groups())
    else:
        m = re.match(r"^(?:(\d{2,4})\D+)?(\d{1,2})\D+(\d{1,2})", s)
        if not m:
            return ""
        y = int(m.group(1)) if m.group(1) else year
        y = 2000 + y if y < 100 else y
        mo, d = int(m.group(2)), int(m.group(3))
    try:
        return dt.date(y, mo, d).isoformat()
    except ValueError:
        return ""


def _money(v) -> int | None:
    """'12,300원' 12300.0 '-5,000' → 정수(음수 포함). 빈 값은 None."""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return int(round(v))
    s = re.sub(r"[,\s원₩]", "", str(v))
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    if not re.fullmatch(r"[-+]?\d+(\.\d+)?", s):
        return None
    n = int(round(float(s)))
    return -n if neg else n


def parse_statement(data: bytes, filename: str, year: int, rules: dict) -> dict:
    """→ {rows: [{date, merchant, amount}], skipped: 뺀 줄 수}. 머리글을 못 찾으면 ValueError."""
    raw = _raw(data, filename)
    aliases = rules["statement_columns"]
    header, cols = None, {}
    for i in range(min(len(raw), 40)):
        found = _columns(raw.iloc[i].tolist(), aliases)
        if {"date", "merchant"} <= set(found) and ("amount" in found or "deposit" in found):
            header, cols = i, found
            break
    if header is None:
        raise ValueError("날짜·가맹점(내용)·금액 열을 찾지 못했어요. 카드사·은행에서 내려받은 이용내역 파일인지 확인해 주세요.")
    if "amount" not in cols:
        raise ValueError("출금(이용) 금액 열을 찾지 못했어요.")
    skip_words = [_norm(w) for w in rules.get("statement_skip_words", [])]
    rows, skipped = [], 0
    body = raw.iloc[header + 1:header + 1 + MAX_ROWS]
    for cells in body.itertuples(index=False):
        cells = list(cells)
        day = parse_date(cells[cols["date"]], year)
        merchant = " ".join(str(cells[cols["merchant"]] or "").split())[:60]
        amount = _money(cells[cols["amount"]])
        if not day and not merchant:
            continue  # 빈 줄·합계 줄
        status = _norm(cells[cols["status"]]) if "status" in cols else ""
        deposit = _money(cells[cols["deposit"]]) if "deposit" in cols else None
        if (not day or not merchant or merchant.lower() == "nan" or not amount or amount <= 0
                or any(w and w in status for w in skip_words) or any(w and w in _norm(merchant) for w in skip_words[:3])
                or (deposit and deposit > 0 and not amount)):
            skipped += 1
            continue
        rows.append({"date": day, "merchant": merchant, "amount": amount})
    return {"rows": rows, "skipped": skipped}
