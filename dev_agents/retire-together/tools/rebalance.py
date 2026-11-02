"""compute_rebalance — 순수 함수. docs/CALCULATION_RULES.md §1~3, REBALANCING_RULES.md §1-1·§2.

입력: 태깅된 보유 내역(account_id, ticker_name, ticker, qty, price, asset_class), 계좌별 예수금,
      신규 납입(금액·계좌), 전략.
출력: docs/AGENT_DESIGN.md "compute_rebalance 출력" 데이터 계약 (dict).

원칙
- 비중·편차·발동은 같은 풀의 계좌를 **합산**해서 본다. 주문은 **계좌별**로 낸다 (계좌 간 자금 이동 불가).
- 임계치를 넘은 자산군만 거래한다. 신규 납입은 매도 없이 부족한 자산군 매수에 먼저 쓴다.
- 매도 → 매수 순서. 계좌 예수금이 부족하면 매수 수량을 줄이고 표시한다.
- LLM은 이 함수를 실행하지 않는다. 같은 입력이면 같은 출력.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import pandas as pd

from tools.assets import ConstraintResult, check_candidates, check_constraints, load_accounts
from tools.strategy import Strategy, class_label


@dataclass
class NewCash:
    amount: int
    account_id: str


@dataclass
class Order:
    side: str            # "매도" | "매수" | "생략"
    asset_class: str
    account_id: str
    ticker_name: str | None
    ticker: str | None
    qty: int | None
    amount: int          # 양수. 매도는 유입, 매수는 유출
    note: str


@dataclass
class RebalanceResult:
    mode: str
    strategy_id: str
    strategy_name: str
    threshold: float
    min_trade_krw: int
    total_value: int                 # 보유 + 예수금
    new_cash: int
    total_after_cash: int            # total_value + new_cash  (T')
    classes: list[dict]              # 자산군별 target/current/deviation_pp/value/over_threshold
    triggered: bool
    constraints: list[ConstraintResult]
    orders: list[Order]
    explain_inputs: dict
    blocked_reason: str | None = None
    notes: list[str] = field(default_factory=list)
    labels: dict[str, str] = field(default_factory=dict)  # 자산군 → 표시 이름 (전략 labels 반영)

    def orders_df(self) -> pd.DataFrame:
        return pd.DataFrame([o.__dict__ for o in self.orders])


def _class_values(holdings: pd.DataFrame) -> dict[str, int]:
    v = holdings.assign(value=holdings["qty"] * holdings["price"]).groupby("asset_class")["value"].sum()
    return {k: int(x) for k, x in v.items()}


def compute_rebalance(
    holdings: pd.DataFrame,
    strategy: Strategy,
    cash_by_account: dict[str, int] | None = None,
    new_cash: NewCash | None = None,
    accounts: dict[str, dict] | None = None,
    mode: str = "rebalance",
    defaults: dict[str, dict] | None = None,
    full_align: bool = False,
) -> RebalanceResult:
    """mode: "rebalance" = 매도·매수 / "buy_only" = 매도 없이 납입금·예수금으로 부족한 자산군만 매수.
    defaults: 자산군 → {"ticker", "name", "price"} 보유 없는 자산군을 살 때 쓰는 기본 종목 (price 없으면 금액만 표시)."""
    defaults = defaults or {}
    if full_align:  # 완전 리밸런싱: 임계치 무시, 모든 자산군을 목표로
        strategy = Strategy(**{**strategy.__dict__, "threshold": 0.0})
    if mode not in ("rebalance", "buy_only"):
        raise ValueError(f"알 수 없는 mode: {mode}")
    cash_by_account = dict(cash_by_account or {})
    if new_cash is not None and (isinstance(new_cash.amount, bool) or not isinstance(new_cash.amount, int) or new_cash.amount < 0):
        raise ValueError(f"신규 납입 금액은 0 이상 정수여야 함: {new_cash.amount!r}")
    h = holdings.copy()
    h["value"] = (h["qty"] * h["price"]).astype(int)
    accts = load_accounts() if accounts is None else accounts

    # ---- 제약 검증 (실패 시 주문표 없음) ----
    constraints = check_constraints(h, accts)
    # SAFE-02: 납입 계좌도 등록·사용 중이어야 한다 (풀의 첫 계좌로 자동 지정하던 것을 명시 선택으로)
    if new_cash is not None:
        a = new_cash.account_id
        if a not in accts:
            constraints.append(ConstraintResult("납입 계좌 등록·사용 중", False, f"미등록 {a}"))
        elif accts[a].get("active", True) is False:
            constraints.append(ConstraintResult("납입 계좌 등록·사용 중", False, f"사용 안 함 {a}"))
        else:
            constraints.append(ConstraintResult("납입 계좌 등록·사용 중", True, "통과"))
    # SAFE-02: 신규 매수 후보(기본 종목)도 보유 종목과 같은 제도 제약을 받는다
    cand_accounts = [str(a) for a in h["account_id"].unique()] + ([new_cash.account_id] if new_cash else [])
    constraints.append(check_candidates(defaults, strategy.targets, cand_accounts, accts))
    blocked = [c for c in constraints if not c.passed]

    # ---- 합산 비중·편차 ----
    class_vals = _class_values(h) if not blocked else {}
    cash_total = sum(cash_by_account.values())
    T = sum(class_vals.values()) + cash_total
    C = new_cash.amount if new_cash else 0
    T2 = T + C
    classes = []
    for cls, t in strategy.targets.items():
        a = class_vals.get(cls, 0) + (cash_total if cls == "cash" else 0)
        w = a / T if T else 0.0
        d = w - t
        classes.append({
            "asset_class": cls, "label": class_label(cls, strategy),
            "target": t, "current": w, "deviation_pp": round(d * 100, 2),
            "value": a, "over_threshold": abs(d) > strategy.threshold + 1e-12,
        })
    # 전략에 없는 자산군을 들고 있으면 (예: 전략이 금을 안 쓰는데 금 보유) 편차 = 전부 초과
    for cls, a in class_vals.items():
        if cls not in strategy.targets and cls != "cash":
            w = a / T if T else 0.0
            classes.append({"asset_class": cls, "label": class_label(cls, strategy), "target": 0.0,
                            "current": w, "deviation_pp": round(w * 100, 2), "value": a,
                            "over_threshold": w > strategy.threshold})
    triggered = any(c["over_threshold"] for c in classes)

    # ---- 설명용 수치 (§3) ----
    shock = strategy.shock
    L_now = sum(c["current"] * shock.get(c["asset_class"], 0.0) for c in classes) * T
    L_target = sum(c["target"] * shock.get(c["asset_class"], 0.0) for c in classes) * T
    worst = max(classes, key=lambda c: abs(c["deviation_pp"])) if classes else None
    explain_inputs = {
        "loss_now": int(round(-L_now)), "loss_target": int(round(-L_target)),
        "loss_diff": int(round(-L_now + L_target)),
        "worst_class": worst["label"] if worst else None,
        "worst_deviation_pp": worst["deviation_pp"] if worst else None,
        "tax_deferred": True,
    }

    result = RebalanceResult(
        mode=mode,
        strategy_id=strategy.id, strategy_name=strategy.name, threshold=strategy.threshold,
        min_trade_krw=strategy.min_trade_krw, total_value=int(T), new_cash=C, total_after_cash=int(T2),
        classes=classes, triggered=triggered, constraints=constraints, orders=[],
        explain_inputs=explain_inputs, labels={c["asset_class"]: c["label"] for c in classes},
    )
    if blocked:
        result.blocked_reason = " / ".join(f"{c.name}: {c.detail}" for c in blocked)
        return result
    if not triggered and C == 0 and cash_total == 0:
        result.notes.append("모든 자산군이 임계치 안. 이번엔 거래 없음")
        return result
    if mode == "buy_only" and C == 0 and cash_total == 0:
        result.notes.append("매수만 모드: 납입금·예수금이 없어 이번엔 거래 없음" + (" (편차는 임계치 초과)" if triggered else ""))
        return result

    # ---- 주문 (계좌별) ----
    orders: list[Order] = []
    acct_cash = {a: int(v) for a, v in cash_by_account.items()}
    if new_cash:
        acct_cash[new_cash.account_id] = acct_cash.get(new_cash.account_id, 0) + C

    # cash 자산군은 전략이 종목(예: 달러 단기금리 ETF)을 지정한 경우에만 매수 대상 (REBALANCING §1-2, 2026-10-27).
    # 보유는 cash로 태깅된 ETF만 센다 — 예수금은 사는 데 쓰는 돈이라 보유로 안 본다. 매도는 cash를 건드리지 않는다
    cash_buyable = bool(defaults.get("cash") and defaults["cash"].get("source") == "strategy" and defaults["cash"].get("price"))
    targets = {c["asset_class"]: c["target"] for c in classes if c["asset_class"] != "cash" or cash_buyable}
    goal = {cls: t * T2 for cls, t in targets.items()}              # G_i
    have = {cls: class_vals.get(cls, 0) for cls in targets}
    over = {c["asset_class"] for c in classes if c["over_threshold"] and c["asset_class"] != "cash"}

    # 1) 매도: 임계치를 넘은 초과 자산군만, 보유 계좌별로 비례 매도 (buy_only 모드는 매도 없음)
    for cls in (sorted(over) if mode == "rebalance" else []):
        excess = have[cls] - goal[cls]
        if excess <= 0:
            continue
        rows = h[h["asset_class"] == cls]
        if "role" not in rows:
            rows = rows.assign(role="core")
        # 위성(테마) 종목을 먼저 전량까지 순차 매도, 남은 초과분은 핵심 종목에서 비례 매도
        sat = rows[rows["role"] == "satellite"].sort_values("value", ascending=False)
        core = rows[rows["role"] != "satellite"].sort_values("value", ascending=False)
        plan = []  # (row, amount)
        remaining = excess
        for _, r in sat.iterrows():
            take = min(remaining, int(r["value"]))
            if take > 0:
                plan.append((r, take)); remaining -= take
        core_total = int(core["value"].sum())
        for _, r in core.iterrows():
            if remaining > 0 and core_total > 0:
                plan.append((r, remaining * r["value"] / core_total))
        for r, amt in plan:
            qty = int(math.floor(amt / r["price"]))
            amt_i = qty * int(r["price"])
            if amt_i < strategy.min_trade_krw or qty <= 0:
                orders.append(Order("생략", cls, r["account_id"], r["ticker_name"], r.get("ticker"), None, int(amt),
                                    "최소 거래 금액 미만"))
                continue
            note = f"편차 {[c for c in classes if c['asset_class']==cls][0]['deviation_pp']:+.1f}%p"
            if r.get("role") == "satellite":
                note += " · 위성(테마) 먼저 매도"
            orders.append(Order("매도", cls, r["account_id"], r["ticker_name"], r.get("ticker"), qty, amt_i, note))
            acct_cash[r["account_id"]] = acct_cash.get(r["account_id"], 0) + amt_i
            have[cls] -= amt_i

    # 2) 매수: 부족한 자산군에, 계좌별 가용 현금 안에서 부족분 비례 배분
    short = {cls: goal[cls] - have[cls] for cls in targets if goal[cls] - have[cls] > 0}
    unconfirmed: set[str] = set()
    for acct, cash in sorted(acct_cash.items()):
        if cash <= 0 or not short:
            continue
        total_short = sum(short.values())
        spend = min(cash, total_short)
        for cls in sorted(short, key=lambda k: -short[k]):
            if short[cls] <= 0:
                continue
            amt = spend * short[cls] / total_short
            rows = h[(h["asset_class"] == cls) & (h["account_id"] == acct)]
            if "role" in rows:
                rows = rows[rows["role"] != "satellite"]  # 매수는 핵심 종목으로만
            rows = rows.sort_values("value", ascending=False)
            d = defaults.get(cls)
            # 전략 지정 종목(strategies.yaml instruments)은 보유 종목보다 먼저 산다 (REBALANCING §1-2, 2026-10-26). 현재가 없으면 보유 종목으로
            strategy_pick = bool(d and d.get("source") == "strategy" and d.get("price"))
            if len(rows) == 0 or strategy_pick:
                if d and d.get("ticker") and d.get("confirmed", True) is False:
                    # SAFE-02: asset_map에 '확인됨'으로 없는 후보는 수량을 계산하지 않는다 — 금액만 보여 주고 사용자가 확인·등록한 뒤 수량
                    src = "전략 지정 종목" if d.get("source") == "strategy" else "기본 종목"
                    orders.append(Order("매수", cls, acct, d.get("name"), d.get("ticker"), None, int(amt),
                                        f"{src} · 종목 확인 필요 (rules/asset_map.yaml에 '확인됨'으로 등록되지 않음)"))
                    unconfirmed.add(str(d.get("name") or d.get("ticker")))
                    short[cls] -= amt
                    acct_cash[acct] -= amt
                    continue
                if d and d.get("price"):
                    # 기본 종목으로 수량 계산
                    qty = int(math.floor(amt / d["price"]))
                    amt_i = qty * int(d["price"])
                    if amt_i < strategy.min_trade_krw or qty <= 0:
                        orders.append(Order("생략", cls, acct, d.get("name"), d.get("ticker"), None, int(amt), "최소 거래 금액 미만"))
                        continue
                    orders.append(Order("매수", cls, acct, d.get("name"), d.get("ticker"), qty, amt_i,
                                        "전략 지정 종목 (strategies.yaml instruments)" if d.get("source") == "strategy"
                                        else "기본 종목 (asset_map.yaml class_defaults, 변경 가능)"))
                    short[cls] -= amt_i
                    acct_cash[acct] -= amt_i
                    have[cls] += amt_i
                    continue
                # 기본 종목도 없음 → 금액만 표시, 종목은 사용자가 정한다
                orders.append(Order("매수", cls, acct, (d or {}).get("name"), (d or {}).get("ticker"), None, int(amt),
                                    "종목 지정 필요 (asset_map.yaml class_defaults)" if not d else "현재가 없음 — --live 또는 가격 입력 필요"))
                short[cls] -= amt
                acct_cash[acct] -= amt
                continue
            r = rows.iloc[0]
            qty = int(math.floor(amt / r["price"]))
            amt_i = qty * int(r["price"])
            if amt_i < strategy.min_trade_krw or qty <= 0:
                orders.append(Order("생략", cls, acct, r["ticker_name"], r.get("ticker"), None, int(amt),
                                    "최소 거래 금액 미만"))
                continue
            note = f"편차 {[c for c in classes if c['asset_class']==cls][0]['deviation_pp']:+.1f}%p"
            if new_cash and acct == new_cash.account_id:
                note += f" · 납입금 {C:,}원 포함"
            orders.append(Order("매수", cls, acct, r["ticker_name"], r.get("ticker"), qty, amt_i, note))
            short[cls] -= amt_i
            acct_cash[acct] -= amt_i
            have[cls] += amt_i

    # 3) 임계치 안이라 건드리지 않은 자산군은 "생략" 한 줄로
    untouched = [c for c in classes if not c["over_threshold"] and c["asset_class"] != "cash"
                 and not any(o.asset_class == c["asset_class"] and o.side != "생략" for o in orders)]
    if untouched:
        orders.append(Order("생략", ",".join(c["asset_class"] for c in untouched), "", None, None, None, 0,
                            "임계치 미만 · " + " · ".join(c["label"] for c in untouched)))

    if unconfirmed:
        result.notes.append("종목 확인 필요 (수량 없이 금액만 표시): " + ", ".join(sorted(unconfirmed))
                            + " — 입력 화면에서 분류를 확인하면 rules/asset_map.yaml에 '확인됨'으로 들어간다")
    # SAFE-02 사후 검증: 어떤 계좌도 가진 현금(예수금+매도대금+납입)보다 많이 사지 않았는지
    overspent = {a: int(v) for a, v in acct_cash.items() if v < -1}
    if overspent:
        result.constraints.append(ConstraintResult("계좌별 현금 범위", False, "초과 매수 " + ", ".join(f"{a} {v:,}원" for a, v in overspent.items())))
        result.blocked_reason = "계좌별 현금 범위: " + ", ".join(f"{a} {v:,}원 초과" for a, v in overspent.items())
        result.orders = []
        return result
    result.constraints.append(ConstraintResult("계좌별 현금 범위", True, "통과"))
    leftover = {a: int(v) for a, v in acct_cash.items() if v >= strategy.min_trade_krw}
    if leftover:
        result.notes.append("매수 후 남는 예수금: " + ", ".join(f"{a} {v:,}원" for a, v in leftover.items()))
    remaining_short = {cls: int(v) for cls, v in short.items() if v >= strategy.min_trade_krw}
    if remaining_short:
        result.notes.append("현금 부족으로 목표에 못 미친 자산군: " +
                            ", ".join(f"{class_label(k, strategy)} {v:,}원" for k, v in remaining_short.items()))
    # 매도 먼저, 그다음 매수, 생략은 끝에
    order_rank = {"매도": 0, "매수": 1, "생략": 2}
    result.orders = sorted(orders, key=lambda o: (order_rank[o.side], o.account_id, -o.amount))
    return result
