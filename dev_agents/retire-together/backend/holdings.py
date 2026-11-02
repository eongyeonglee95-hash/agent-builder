"""holdings API — 등록한 종목 잔고를 계좌별로 모아 손익을 돌려준다 (Robinhood 'Position'·'Portfolio Overview' 참고, CALCULATION_RULES §7).

원천: 구글 시트 '보유종목' 탭(연결 시) 또는 계좌별 최신 스냅샷(data/snapshots). 계산은 tools.holdings.summarize.
live=1이면 공개 시세(네이버)로 현재가·전일 종가를 받아 오늘 손익을 낸다. 실패하면 등록 가격으로 보여 주고 이유를 알린다.
"""
from __future__ import annotations

import datetime as dt
import threading
import time
from pathlib import Path
from typing import Literal

import pandas as pd
import yaml
from fastapi import APIRouter, Query

from backend import ledger, registration
from tools.assets import load_accounts, load_asset_map
from tools.holdings import AccountIn, HoldingIn, summarize

ROOT = Path(__file__).resolve().parents[1]
SETTINGS_PATH = ROOT / "rules" / "holdings.yaml"
router = APIRouter(prefix="/api/holdings", tags=["holdings"])

_quote_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()


def settings() -> dict:
    try:
        data = yaml.safe_load(SETTINGS_PATH.read_text(encoding="utf-8")) or {}
    except OSError:
        data = {}
    return {"stale_days": int(data.get("stale_days", 31)), "quote_ttl_seconds": int(data.get("quote_ttl_seconds", 60))}


def fetch_quote(code: str) -> dict:
    from tools.market import fetch_quote as _fetch
    return _fetch(code)


def quotes_for(codes: list[str], ttl: int) -> tuple[dict[str, dict], list[str]]:
    out, failed = {}, []
    for c in codes:
        with _lock:
            hit = _quote_cache.get(c)
        if hit and time.monotonic() - hit[0] < ttl:
            out[c] = hit[1]; continue
        try:
            q = fetch_quote(c)
            with _lock:
                _quote_cache[c] = (time.monotonic(), q)
            out[c] = q
        except Exception:
            failed.append(c)
        time.sleep(0.05)
    return out, failed


def _latest_snapshot(account_id: str) -> Path | None:
    d = registration.snapshot_dir() / account_id
    files = sorted(d.glob("*.csv")) if d.exists() else []
    return files[-1] if files else None


def _int_or_none(v):
    try:
        if v in (None, "") or pd.isna(v):
            return None
        n = int(float(v))
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def _earlier_buy_values(account_id: str, latest: Path | None) -> dict[tuple[str, int], tuple[int, str]]:
    """같은 계좌의 이전 등록(이전 스냅샷, 처음 캡처 등록 파일)에서 (종목, 수량) → (매입금액, 기준일).
    최신 잔고에 매입금액이 없을 때만 쓰고, 종목과 수량이 정확히 같을 때만 맞춘다 — 수량이 바뀌었으면 매입금액도 바뀌었으니 쓰지 않는다."""
    from tools.store import SAMPLES
    files = [f for f in sorted((registration.snapshot_dir() / account_id).glob("*.csv")) if f != latest]
    files += sorted(SAMPLES.glob("**/holdings_parsed_*.csv")) + sorted(SAMPLES.glob("**/balance_*.csv"))
    found: dict[tuple[str, int], tuple[int, str]] = {}
    for f in files:
        try:
            df = pd.read_csv(f, encoding="utf-8-sig", dtype={"ticker": str})
        except Exception:
            continue
        if "buy_value" not in df or "account_id" in df and not (df["account_id"] == account_id).any():
            continue
        if "account_id" in df:
            df = df[df["account_id"] == account_id]
        day = f.stem.split("_")[-1]
        for r in df.to_dict("records"):
            qty, buy = _int_or_none(r.get("qty")), _int_or_none(r.get("buy_value"))
            if qty and buy:
                for k in {str(r.get("ticker") or ""), str(r.get("ticker_name") or "")} - {""}:
                    found[(k, qty)] = (buy, day)
    return found


def load_rows(owner: str) -> tuple[list[AccountIn], list[HoldingIn]]:
    accts = load_accounts(registration.accounts_path())
    amap = load_asset_map(registration.asset_map_path())
    by_ticker = {str(v.get("ticker")): v for v in amap.values() if v.get("ticker")}
    want = {"me": "me", "partner": "spouse"}.get(owner)
    accounts, holdings = [], []
    store = ledger.sheet_store()
    sheet_rows = store.list_holdings() if store is not None else None
    for acct_id, a in accts.items():
        if a.get("active", True) is False or (want and a.get("owner") != want):
            continue
        if sheet_rows is not None:
            rs = [r for r in sheet_rows if r["account_id"] == acct_id]
            as_of = max((r["as_of"] for r in rs if r.get("as_of")), default=None)
            source = "sheet"
            records = [{"ticker_name": r["ticker_name"], "ticker": r.get("ticker"), "qty": r["qty"], "price": r["price"], "buy_value": r.get("buy_value")} for r in rs]
        else:
            p = _latest_snapshot(acct_id)
            if p is None:
                continue
            df = pd.read_csv(p, encoding="utf-8-sig", dtype={"ticker": str})
            records = df.to_dict("records")
            as_of, source = p.stem, "snapshot"
            if any(not _int_or_none(r.get("buy_value")) for r in records):
                earlier = _earlier_buy_values(acct_id, p)
                for r in records:
                    if not _int_or_none(r.get("buy_value")):
                        qty = _int_or_none(r.get("qty"))
                        hit = earlier.get((str(r.get("ticker") or ""), qty)) or earlier.get((str(r.get("ticker_name") or ""), qty))
                        if hit:
                            r["buy_value"], r["buy_source"] = hit
        try:
            as_of_date = dt.date.fromisoformat(str(as_of)[:10]) if as_of else None
        except ValueError:
            as_of_date = None
        owner_web = "partner" if a.get("owner") == "spouse" else "me"
        accounts.append(AccountIn(acct_id, a.get("label") or acct_id, owner_web, as_of_date, source,
                                  {"pocket": "retirement" if a.get("pocket") == "pension" else "cash"}))
        for r in records:
            qty, price = _int_or_none(r.get("qty")), _int_or_none(r.get("price"))
            if not qty or not price:
                continue
            ticker = str(r.get("ticker")) if r.get("ticker") not in (None, "") and not (isinstance(r.get("ticker"), float) and pd.isna(r.get("ticker"))) else None
            entry = amap.get(r["ticker_name"]) or (by_ticker.get(ticker) if ticker else None) or {}
            holdings.append(HoldingIn(acct_id, str(r["ticker_name"]), ticker, qty, price, _int_or_none(r.get("buy_value")),
                                      entry.get("asset_class"), entry.get("stock_group"), entry.get("role"), r.get("buy_source")))
    return accounts, holdings


@router.get("")
def holdings(owner: Literal["together", "me", "partner"] = "together", live: bool = Query(False),
             asset_class: Literal["stock", "long_bond", "mid_bond", "gold", "commodity", "cash"] | None = None):
    cfg = settings()
    accounts, rows = load_rows(owner)
    if asset_class:
        rows = [h for h in rows if h.asset_class == asset_class]
    quotes, failed = ({}, [])
    if live and rows:
        quotes, failed = quotes_for(sorted({h.ticker for h in rows if h.ticker}), cfg["quote_ttl_seconds"])
    out = summarize(accounts, rows, quotes, stale_days=cfg["stale_days"])
    out["quote_failed"] = failed
    out["quote_requested"] = live
    out["missing_ticker"] = sorted({h.ticker_name for h in rows if not h.ticker})
    return out
