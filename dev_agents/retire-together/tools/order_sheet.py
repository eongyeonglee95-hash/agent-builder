"""build_order_sheet — RebalanceResult → 사람이 읽는 표 (markdown). 화면과 CLI가 같은 순서로 쓴다."""
from __future__ import annotations

import pandas as pd

from tools.rebalance import RebalanceResult
from tools.strategy import CLASS_LABELS


def classes_table(r: RebalanceResult) -> pd.DataFrame:
    rows = []
    for c in r.classes:
        rows.append({
            "자산군": c["label"], "목표": f"{c['target']*100:.1f}%", "현재": f"{c['current']*100:.1f}%",
            "편차": f"{c['deviation_pp']:+.1f}%p", "평가액": f"{c['value']:,}",
            "발동": "●" if c["over_threshold"] else "",
        })
    return pd.DataFrame(rows)


def orders_table(r: RebalanceResult, account_labels: dict[str, str] | None = None) -> pd.DataFrame:
    labels = account_labels or {}
    rows = []
    for o in r.orders:
        rows.append({
            "구분": o.side,
            "자산군": ", ".join(r.labels.get(k) or CLASS_LABELS.get(k, k) for k in o.asset_class.split(",")),
            "계좌": labels.get(o.account_id, o.account_id),
            "종목": o.ticker_name or "—",
            "수량": f"{o.qty}주" if o.qty else "—",
            "예상 금액": (f"{'-' if o.side=='매도' else '+'}{o.amount:,}원" if o.amount and o.side != "생략" else "—"),
            "비고": o.note,
        })
    return pd.DataFrame(rows)


def to_markdown(df: pd.DataFrame) -> str:
    if df.empty:
        return "(없음)"
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for _, row in df.iterrows():
        lines.append("| " + " | ".join(str(row[c]) for c in cols) + " |")
    return "\n".join(lines)
