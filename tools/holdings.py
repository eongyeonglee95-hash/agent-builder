"""holdings — 보유 종목 손익 요약 (CALCULATION_RULES §7). 순수 함수: 입력 표 + (선택) 시세 → 계좌·종목·합계·움직임.

LLM은 이 숫자를 계산하지 않는다. 화면과 Agent는 결과만 받는다.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field


@dataclass
class HoldingIn:
    account_id: str
    ticker_name: str
    ticker: str | None
    qty: int
    price: int                       # 등록한 잔고의 가격
    buy_value: int | None = None     # 매입금액. 모르면 None (추정하지 않는다)
    asset_class: str | None = None
    stock_group: str | None = None
    role: str | None = None
    buy_source: str | None = None    # 매입금액을 이전 등록에서 가져왔으면 그 기준일


@dataclass
class AccountIn:
    id: str
    label: str
    owner: str                       # me | partner
    as_of: dt.date | None
    source: str                      # 스냅샷 경로 또는 'sheet'
    extra: dict = field(default_factory=dict)


def _rate(num: int | None, den: int | None) -> float | None:
    return None if num is None or not den else round(num / den * 100, 2)


def summarize(accounts: list[AccountIn], holdings: list[HoldingIn], quotes: dict[str, dict] | None = None,
              today: dt.date | None = None, stale_days: int = 31) -> dict:
    """quotes: 종목코드 → {price, prev_close}. 있으면 현재가를 시세로 바꾸고 오늘 손익을 계산한다."""
    today = today or dt.date.today()
    quotes = quotes or {}
    rows = []
    for h in holdings:
        q = quotes.get(h.ticker or "")
        live = bool(q and q.get("price"))
        price = int(q["price"]) if live else int(h.price)
        value = h.qty * price
        total_return = value - h.buy_value if h.buy_value else None
        prev = q.get("prev_close") if live else None
        today_return = h.qty * (price - int(prev)) if prev else None
        rows.append({"account_id": h.account_id, "ticker_name": h.ticker_name, "ticker": h.ticker, "qty": h.qty, "price": price,
                     "snapshot_price": int(h.price), "live": live, "value": value, "buy_value": h.buy_value or None,
                     "avg_cost": round(h.buy_value / h.qty) if h.buy_value and h.qty else None,
                     "total_return": total_return, "total_rate": _rate(total_return, h.buy_value),
                     "today_return": today_return, "today_rate": _rate(price - int(prev), int(prev)) if prev else None,
                     "asset_class": h.asset_class, "stock_group": h.stock_group, "role": h.role, "buy_source": h.buy_source})
    grand = sum(r["value"] for r in rows)
    for r in rows:
        r["weight"] = round(r["value"] / grand * 100, 2) if grand else 0.0

    def totals(rs: list[dict]) -> dict:
        value = sum(r["value"] for r in rs)
        known = [r for r in rs if r["buy_value"]]
        buy = sum(r["buy_value"] for r in known)
        known_value = sum(r["value"] for r in known)
        live = [r for r in rs if r["today_return"] is not None]
        today_ret = sum(r["today_return"] for r in live) if live else None
        prev_value = sum(r["value"] - r["today_return"] for r in live)
        return {"value": value, "buy_value": buy or None, "total_return": (known_value - buy) if known else None,
                "total_rate": _rate(known_value - buy, buy) if known else None, "cost_known": len(known), "count": len(rs),
                "today_return": today_ret, "today_rate": _rate(today_ret, prev_value) if live else None}

    out_accounts = []
    for a in accounts:
        rs = [r for r in rows if r["account_id"] == a.id]
        if not rs:
            continue
        age = (today - a.as_of).days if a.as_of else None
        out_accounts.append({"id": a.id, "label": a.label, "owner": a.owner, "as_of": a.as_of.isoformat() if a.as_of else None,
                             "age_days": age, "stale": age is not None and age > stale_days, "source": a.source, **a.extra,
                             **totals(rs)})
    live = [r for r in rows if r["today_return"] is not None]
    movers = {
        "drivers": sorted(live, key=lambda r: abs(r["today_return"]), reverse=True)[:3],
        "top": sorted(live, key=lambda r: abs(r["today_rate"] or 0), reverse=True)[:3],
    }
    return {"accounts": out_accounts, "holdings": rows, "total": totals(rows), "movers": movers,
            "live": bool(live), "stale_days": stale_days}
