"""Read-only bridge to the existing engine; no persistence or broker calls."""
from dataclasses import asdict
from datetime import date
from hashlib import sha256
from io import StringIO
import json
import re
from typing import Annotated, Literal

from fastapi import HTTPException
import pandas as pd
from pydantic import Field, model_validator

from backend.storage import InputModel, Money
from backend.strategies import load_strategy_display
from tools.assets import ConstraintResult, check_constraints, defaults_with_prices, load_accounts, load_asset_map, load_pools, tag_holdings
from tools.parse_balance import ACCOUNT_ID_RE, HOLDING_COLUMNS, load_holdings_csv
from tools.rebalance import NewCash, compute_rebalance
from tools.strategy import ASSET_CLASSES, load_strategy


class PreviewInput(InputModel):
    pool_id: Annotated[str, Field(min_length=1, max_length=64)]
    csv: Annotated[str, Field(min_length=1, max_length=200_000)]
    as_of: date
    new_cash: Money = 0
    new_cash_account: str | None = None

    @model_validator(mode="after")
    def check_date(self):
        if self.as_of > date.today():
            raise ValueError("잔고 기준일은 미래일 수 없습니다")
        return self


def supported_pools():
    accounts, pools = load_accounts(), load_pools()
    supported = {}
    for key, pool in pools.items():
        ids = pool.get("accounts", [])
        # IRP needs a separate risk-limit check. Household totals are not trading pools.
        if (not ACCOUNT_ID_RE.fullmatch(key) or not ids or len(set(ids)) != len(ids)
                or any(a not in accounts or not ACCOUNT_ID_RE.fullmatch(a)
                       or accounts[a].get("active", True) is not True
                       or accounts[a].get("account_type") != "pension_savings" for a in ids)
                or len({accounts[a].get("owner") for a in ids}) != 1
                or accounts[ids[0]].get("owner") not in ("me", "spouse")
                or pool.get("mode") not in ("rebalance", "buy_only")):
            continue
        supported[key] = pool
    return accounts, supported


def options(owner: Literal["together", "me", "partner"]):
    accounts, pools = supported_pools()
    return [{
        "id": key, "label": pool.get("label", key),
        "owner": "partner" if accounts[pool["accounts"][0]]["owner"] == "spouse" else "me",
        "mode": pool["mode"], "strategy_id": pool.get("strategy"),
        "accounts": [{"id": a, "label": accounts[a].get("label", a)} for a in pool["accounts"]],
    } for key, pool in pools.items()
        if owner == "together" or accounts[pool["accounts"][0]]["owner"] == ("spouse" if owner == "partner" else "me")]


def preview(data: PreviewInput):
    accounts, pools = supported_pools()
    pool = pools.get(data.pool_id)
    if pool is None:
        raise HTTPException(422, "지원하는 연금저축 계좌 묶음을 선택해 주세요.")
    ids = set(pool["accounts"])
    if data.new_cash and data.new_cash_account not in ids:
        raise HTTPException(422, "추가 납입을 받을 계좌를 선택해 주세요.")
    try:
        h = load_holdings_csv(StringIO(data.csv))
    except (ValueError, TypeError, OverflowError):
        raise HTTPException(422, "CSV의 필수 열·종목명·정수 수량·가격·중복 행을 확인해 주세요.") from None
    if h.empty or len(h) > 1000:
        raise HTTPException(422, "잔고는 1~1,000행으로 입력해 주세요.")
    if set(h["account_id"]) != ids:
        raise HTTPException(422, "CSV에는 선택한 묶음의 모든 계좌만 포함해야 합니다. 다른 계좌나 빠진 계좌를 확인해 주세요.")
    if (not h["ticker"].map(lambda v: isinstance(v, str) and re.fullmatch(r"[0-9A-Z]{6}", v) is not None).all()
            or (h["qty"] <= 0).any() or (h["price"] <= 0).any()
            or (h["qty"] > 100_000_000).any() or (h["price"] > 1_000_000_000).any()
            or sum(int(r.qty) * int(r.price) for r in h.itertuples()) + data.new_cash > 10**15):
        raise HTTPException(422, "종목코드 6자리와 수량·가격·총액 범위를 확인해 주세요.")
    asset_map = load_asset_map()
    for row in h.itertuples():
        entry = asset_map.get(row.ticker_name)
        if (not entry or entry.get("status") != "confirmed"
                or str(entry.get("ticker")) != row.ticker
                or entry.get("asset_class") not in ASSET_CLASSES):
            raise HTTPException(422, "확인된 종목코드·자산군 매핑이 필요합니다. 기존 입력 화면에서 분류를 먼저 확인해 주세요.")
    h, unmapped = tag_holdings(h[HOLDING_COLUMNS], asset_map)
    if unmapped:
        raise HTTPException(422, "미분류 종목이 있어 계산할 수 없습니다.")
    # The display model validates individual weights before the older domain loader.
    strategy_id = pool.get("strategy")
    display = next((s for s in load_strategy_display() if s.id == strategy_id), None)
    if not display or not display.targets:
        raise HTTPException(422, "계좌 전략의 목표 비율을 먼저 확정해 주세요.")
    strategy = load_strategy(strategy_id)
    if strategy.min_trade_krw < 0 or strategy.min_trade_krw > 10**15:
        raise HTTPException(422, "전략의 최소 거래 금액을 확인해 주세요.")
    if any(not c.passed for c in check_constraints(h, accounts)):
        raise HTTPException(422, "계좌 또는 보유 종목의 제약 검사를 통과하지 못했습니다.")
    defaults = defaults_with_prices(h, live=False, instruments=strategy.instruments)
    # SAFE-02 is pending in the domain. Check every new candidate here as well.
    candidates = []
    candidate_errors = []
    for cls, item in defaults.items():
        if cls not in strategy.targets or not item.get("ticker"):
            continue
        entry = asset_map.get(item.get("name"))
        if (not entry or entry.get("status") != "confirmed"
                or str(entry.get("ticker")) != str(item["ticker"])
                or entry.get("asset_class") != cls):
            candidate_errors.append(str(item.get("name") or item["ticker"]))
            continue
        candidates.extend({"account_id": a, "ticker_name": item["name"], "asset_class": cls} for a in ids)
    if candidates:
        candidate_errors.extend(c.detail for c in check_constraints(pd.DataFrame(candidates), accounts) if not c.passed)
    result = compute_rebalance(
        h, strategy, new_cash=NewCash(data.new_cash, data.new_cash_account) if data.new_cash else None,
        accounts=accounts, mode=pool["mode"], defaults=defaults,
    )
    if candidate_errors:
        reason = "매수 후보 분류·제약 확인 필요: " + ", ".join(candidate_errors)
        result.orders = []
        result.notes = []
        result.blocked_reason = reason
        result.constraints.append(ConstraintResult("신규 매수 후보 확인", False, reason))
    payload = asdict(result)
    explanation = (
        f"잔고 기준일 {data.as_of.isoformat()}의 가격으로 계산했습니다. "
        f"목표와의 편차가 ±{display.threshold:g}%p를 초과한 자산군이 "
        f"{sum(c['over_threshold'] for c in result.classes)}개입니다. "
        + ("이 계좌는 매수만 모드로, 납입금·예수금 범위에서 부족한 자산군을 채웁니다." if pool["mode"] == "buy_only"
           else "이 계좌는 매도·매수 모드로 목표 비율을 비교합니다.")
    )
    fingerprint = json.dumps({"result": payload, "as_of": data.as_of.isoformat()}, sort_keys=True, ensure_ascii=False)
    return {**payload, "preview_id": sha256(fingerprint.encode()).hexdigest(), "as_of": data.as_of,
            "pool_label": pool.get("label", data.pool_id),
            "account_labels": {a: accounts[a].get("label", a) for a in ids},
            "explanation": explanation, "price_source": "uploaded_snapshot", "executable": False}
