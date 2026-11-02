"""compute_rebalance 단위 테스트 — docs/AGENT_DESIGN.md 완료 기준 1·3·4·6 + 규칙."""
from pathlib import Path

import pandas as pd
import pytest

from tools import explain
from tools.assets import tag_holdings
from tools.parse_balance import load_holdings_csv
from tools.rebalance import NewCash, compute_rebalance
from tools.strategy import Strategy, load_strategy

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "data" / "fixtures" / "holdings_fixture.csv"
ACCOUNTS = {"acct_a": {"account_type": "pension_savings"}, "acct_b": {"account_type": "pension_savings"}}


def holdings():
    h, unmapped = tag_holdings(load_holdings_csv(FIXTURE))
    assert not unmapped
    return h


def strat(**over):
    base = dict(id="t", name="테스트", targets={"stock": 0.3, "long_bond": 0.4, "mid_bond": 0.15, "gold": 0.075, "commodity": 0.075},
                threshold=0.05, min_trade_krw=100_000, shock={"stock": -0.3, "long_bond": 0.05, "mid_bond": 0.02, "gold": 0.0, "commodity": -0.1})
    base.update(over)
    return Strategy(**base)


def test_same_input_same_orders():  # 완료 기준 1
    a = compute_rebalance(holdings(), strat(), accounts=ACCOUNTS)
    b = compute_rebalance(holdings(), strat(), accounts=ACCOUNTS)
    assert [o.__dict__ for o in a.orders] == [o.__dict__ for o in b.orders]
    assert a.classes == b.classes


def test_weights_and_trigger():
    r = compute_rebalance(holdings(), strat(), accounts=ACCOUNTS)
    assert r.total_value == 39_050_000
    by = {c["asset_class"]: c for c in r.classes}
    assert by["stock"]["value"] == 25_000_000 and abs(by["stock"]["current"] - 25 / 39.05) < 1e-9
    assert by["stock"]["over_threshold"] and by["long_bond"]["over_threshold"]
    assert not by["mid_bond"]["over_threshold"]  # -2.2%p
    assert r.triggered


def test_target_change_changes_orders():  # 완료 기준 3
    r1 = compute_rebalance(holdings(), strat(), accounts=ACCOUNTS)
    r2 = compute_rebalance(holdings(), strat(targets={"stock": 0.6, "mid_bond": 0.15, "gold": 0.25}), accounts=ACCOUNTS)
    assert [o.__dict__ for o in r1.orders] != [o.__dict__ for o in r2.orders]
    sells2 = [o for o in r2.orders if o.side == "매도"]
    assert all(o.asset_class != "stock" for o in sells2)  # 주식 64% vs 목표 60%: 임계치 안 → 매도 없음


def test_leverage_etf_blocks_order_sheet():  # 완료 기준 4
    h = holdings()
    h.loc[0, "ticker_name"] = "KODEX 레버리지"
    h.loc[0, "asset_class"] = "stock"
    r = compute_rebalance(h, strat(), accounts=ACCOUNTS)
    assert r.blocked_reason and "레버리지" in r.blocked_reason
    assert r.orders == []


def test_cashflow_first_buys_only_when_within_threshold():
    # 모든 자산군이 임계치 안인 전략 + 납입 → 매도 없이 매수만
    h = holdings()
    s = strat(targets={"stock": 0.64, "mid_bond": 0.13, "gold": 0.23})
    r = compute_rebalance(h, s, new_cash=NewCash(3_000_000, "acct_a"), accounts=ACCOUNTS)
    assert not r.triggered
    assert all(o.side != "매도" for o in r.orders)
    buys = [o for o in r.orders if o.side == "매수"]
    assert buys and all(o.account_id == "acct_a" for o in buys)  # 납입 들어간 계좌에서만
    assert sum(o.amount for o in buys) <= 3_000_000


def test_sell_then_buy_order_and_cash_stays_in_account():
    r = compute_rebalance(holdings(), strat(), accounts=ACCOUNTS)
    sides = [o.side for o in r.orders if o.side != "생략"]
    assert sides == sorted(sides, key=lambda s: {"매도": 0, "매수": 1}[s])
    for acct in ("acct_a", "acct_b"):
        sells = sum(o.amount for o in r.orders if o.side == "매도" and o.account_id == acct)
        buys = sum(o.amount for o in r.orders if o.side == "매수" and o.account_id == acct)
        assert buys <= sells + 1  # 계좌 안의 현금으로만 매수


def test_min_trade_skipped():
    s = strat(min_trade_krw=10_000_000)
    r = compute_rebalance(holdings(), s, accounts=ACCOUNTS)
    assert all(o.side == "생략" for o in r.orders if o.asset_class == "gold" and o.account_id == "acct_a")


def test_explain_has_no_forbidden_words_and_correct_losses():  # 완료 기준 6
    r = compute_rebalance(holdings(), strat(), accounts=ACCOUNTS)
    text = explain.why_now(r)
    assert not any(w in text for w in explain.FORBIDDEN)
    # L_now = Σ w_i·shock_i·T = (-0.3·25,000,000) + (0.02·5,000,000) = -7,400,000
    assert r.explain_inputs["loss_now"] == 7_400_000
    assert r.explain_inputs["loss_target"] < r.explain_inputs["loss_now"]


def test_load_strategy_from_yaml():
    s = load_strategy("all_weather")
    assert abs(sum(s.targets.values()) - 1) < 1e-9 and s.threshold == 0.05
    with pytest.raises(ValueError):
        load_strategy("custom")  # 비율 비어 있음


def test_buy_only_mode_never_sells():
    h = holdings()
    r = compute_rebalance(h, strat(), new_cash=NewCash(3_000_000, "acct_a"), accounts=ACCOUNTS, mode="buy_only")
    assert r.triggered  # 편차는 크지만
    assert all(o.side != "매도" for o in r.orders)
    buys = [o for o in r.orders if o.side == "매수"]
    assert buys and sum(o.amount for o in buys) <= 3_000_000
    assert buys[0].asset_class == "long_bond"  # 가장 부족한 자산군부터


def test_buy_only_without_cash_does_nothing():
    r = compute_rebalance(holdings(), strat(), accounts=ACCOUNTS, mode="buy_only")
    assert r.orders == [] and any("매수만 모드" in n for n in r.notes)


def test_satellite_sold_first_and_never_bought():
    h = holdings()
    # 테스트계좌A의 S&P500을 위성(테마)으로, 나머지 핵심
    h["role"] = ["satellite", "core", "core", "core", "core"]
    r = compute_rebalance(h, strat(), accounts=ACCOUNTS)
    sells_a = [o for o in r.orders if o.side == "매도" and o.account_id == "acct_a" and o.asset_class == "stock"]
    assert sells_a and "위성" in sells_a[0].note
    assert all(not (o.side == "매수" and o.ticker_name == "TIGER 미국S&P500") for o in r.orders)


def test_full_align_trades_classes_inside_threshold():
    r1 = compute_rebalance(holdings(), strat(), accounts=ACCOUNTS)
    r2 = compute_rebalance(holdings(), strat(), accounts=ACCOUNTS, full_align=True)
    assert all(c["over_threshold"] for c in r2.classes if c["asset_class"] != "cash")
    assert not any(c["asset_class"] == "mid_bond" and c["over_threshold"] for c in r1.classes)


def test_save_targets_roundtrip(tmp_path):
    import shutil
    from tools.strategy import STRATEGIES_PATH, has_targets, load_strategy, save_targets
    p = tmp_path / "strategies.yaml"; shutil.copy(STRATEGIES_PATH, p)
    assert not has_targets("k_all_weather", p)
    save_targets("k_all_weather", {"stock": 35, "long_bond": 25, "mid_bond": 15, "gold": 15, "commodity": 10}, path=p, source="임시")
    s = load_strategy("k_all_weather", p)
    assert abs(s.targets["stock"] - 0.35) < 1e-9 and has_targets("k_all_weather", p)
    assert abs(sum(load_strategy("all_weather", p).targets.values()) - 1) < 1e-9  # 다른 전략 보존
    with pytest.raises(ValueError):
        save_targets("custom", {"stock": 50}, path=p)


def test_strategy_instruments_override_class_defaults(tmp_path, monkeypatch):
    """전략이 지정한 종목(instruments)이 asset_map class_defaults보다 우선. 지정 없는 자산군은 class_defaults (REBALANCING §1-2)."""
    import shutil
    import yaml
    from tools.assets import defaults_with_prices
    from tools.strategy import STRATEGIES_PATH
    p = tmp_path / "strategies.yaml"; shutil.copy(STRATEGIES_PATH, p)
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    data["strategies"]["all_weather"]["instruments"] = {"long_bond": {"ticker": "476760", "name": "ACE 미국30년국채액티브", "type": "미국 20년+"},
                                                        "mid_bond": {"ticker": None, "name": None, "type": "미정"}}
    p.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    s = load_strategy("all_weather", p)
    assert set(s.instruments) == {"long_bond"}  # ticker 없는 항목은 지정 아님
    d = defaults_with_prices(holdings(), live=False, instruments=s.instruments)
    assert d["long_bond"]["ticker"] == "476760" and d["long_bond"]["source"] == "strategy"
    assert d["mid_bond"]["ticker"] == "356540" and d["mid_bond"]["source"] == "class_defaults"
    # 엔진: 보유 없는 장기채 매수는 전략 지정 종목으로
    d["long_bond"]["price"] = 10_000
    r = compute_rebalance(holdings(), strat(), new_cash=NewCash(3_000_000, "acct_a"), accounts=ACCOUNTS, mode="buy_only", defaults=d)
    lb = [o for o in r.orders if o.asset_class == "long_bond" and o.side == "매수"]
    assert lb and lb[0].ticker == "476760" and "전략 지정" in lb[0].note


def test_strategy_instrument_beats_held_ticker_on_buy():
    """전략 지정 종목이 있으면 그 자산군을 이미 보유한 계좌에서도 매수는 지정 종목으로 (REBALANCING §1-2 예외). 지정 없으면 보유 종목."""
    h = holdings()
    held_stock = h[(h["asset_class"] == "stock") & (h["account_id"] == "acct_a")]
    assert len(held_stock) > 0
    d = {"stock": {"ticker": "999999", "name": "전략지정주식", "price": 10_000, "source": "strategy"}}
    s = strat(targets={"stock": 0.9, "gold": 0.1})  # 주식 부족하게 만들어 매수 유도
    r = compute_rebalance(h, s, new_cash=NewCash(3_000_000, "acct_a"), accounts=ACCOUNTS, mode="buy_only", defaults=d)
    buys = [o for o in r.orders if o.asset_class == "stock" and o.side == "매수" and o.account_id == "acct_a"]
    assert buys and all(o.ticker == "999999" for o in buys)
    d2 = {"stock": dict(d["stock"], source="class_defaults")}
    r2 = compute_rebalance(h, s, new_cash=NewCash(3_000_000, "acct_a"), accounts=ACCOUNTS, mode="buy_only", defaults=d2)
    buys2 = [o for o in r2.orders if o.asset_class == "stock" and o.side == "매수" and o.account_id == "acct_a"]
    assert buys2 and all(o.ticker != "999999" for o in buys2)  # 공통 기본값은 보유 종목에 밀린다


def test_strategy_labels_show_in_classes_and_order_sheet():
    """전략 labels(예: gold → '금 (=원자재)')가 자산군 표와 주문표에 나온다. 박곰희 템플릿은 YAML labels도 확인."""
    from tools.order_sheet import classes_table, orders_table
    assert load_strategy("park_gomhee").labels.get("cash") == "달러"
    s = strat(labels={"gold": "금 (=원자재)"})
    r = compute_rebalance(holdings(), s, accounts=ACCOUNTS, mode="rebalance", full_align=True)
    assert "금 (=원자재)" in classes_table(r)["자산군"].tolist()
    gold_orders = orders_table(r)[orders_table(r)["구분"] != "생략"]
    assert all(v != "금" for v in gold_orders["자산군"])  # 전략 라벨이 CLASS_LABELS를 덮는다


def test_cash_instrument_is_bought_only_when_strategy_names_it():
    """전략이 cash에 종목(달러 ETF)을 지정하면 cash도 매수한다. 지정이 없으면 cash는 예수금으로만 보고 사지 않는다 (§1-2)."""
    t = {"stock": 0.65, "mid_bond": 0.1, "gold": 0.2, "cash": 0.05}
    usd = {"cash": {"ticker": "456610", "name": "TIGER 미국달러SOFR금리액티브(합성)", "price": 8_735, "source": "strategy"}}
    r = compute_rebalance(holdings(), strat(targets=t), new_cash=NewCash(3_000_000, "acct_a"), accounts=ACCOUNTS, mode="buy_only", defaults=usd)
    cash_buys = [o for o in r.orders if o.asset_class == "cash" and o.side == "매수"]
    assert cash_buys and cash_buys[0].ticker == "456610" and cash_buys[0].qty and cash_buys[0].qty > 0
    assert cash_buys[0].amount <= 0.05 * (39_050_000 + 3_000_000) + 8_735  # 목표 5% 안
    assert all(o.side != "매도" for o in r.orders)
    r2 = compute_rebalance(holdings(), strat(targets=t), new_cash=NewCash(3_000_000, "acct_a"), accounts=ACCOUNTS, mode="buy_only")
    assert not [o for o in r2.orders if o.asset_class == "cash"]
