"""SAFE-01 — 저장 경로·계좌·수량·가격·합계 재검증 (docs/AGENT_DESIGN.md §0, ARCHITECTURE_REVIEW §4 P0).
각 테스트는 보고서의 합성 입력을 그대로 재현한다. 고치기 전에는 실패해야 한다."""
import datetime as dt
from pathlib import Path

import pandas as pd
import pytest

from tools import store
from tools.assets import tag_holdings
from tools.parse_balance import load_holdings_csv, reconcile, validate_holdings
from tools.rebalance import compute_rebalance
from tools.strategy import Strategy

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "data" / "fixtures" / "holdings_fixture.csv"
STRAT = Strategy(id="t", name="t", targets={"stock": 0.3, "long_bond": 0.4, "mid_bond": 0.15, "gold": 0.075, "commodity": 0.075},
                 threshold=0.05, min_trade_krw=100_000)


def _csv(tmp_path: Path, text: str) -> Path:
    p = tmp_path / "h.csv"
    p.write_text(text, encoding="utf-8-sig")
    return p


# ---- 수량·가격: 음수·소수·0·빈 종목명·이상한 계좌 ID는 행별 오류로 거부 ----
def test_csv_rejects_negative_fraction_zero_and_bad_ids(tmp_path):
    p = _csv(tmp_path, "account_id,ticker_name,ticker,qty,price\n"
                       "acct_a,X,1,-2,100\n"       # 음수 수량
                       "acct_a,Y,2,1.9,100\n"      # 소수 수량 (예전엔 1로 잘림)
                       "acct_a,Z,3,1,0\n"          # 가격 0
                       "acct_a,,4,1,100\n"         # 종목명 없음
                       "../outside,W,5,1,100\n")   # 경로 문자가 든 계좌 ID
    with pytest.raises(ValueError) as e:
        load_holdings_csv(p)
    msg = str(e.value)
    assert "2행" in msg and "qty" in msg          # 음수
    assert "3행" in msg                            # 소수
    assert "4행" in msg and "price" in msg        # 0
    assert "5행" in msg and "ticker_name" in msg  # 빈 종목명
    assert "6행" in msg and "account_id" in msg   # 계좌 ID 형식


def test_csv_rejects_duplicate_rows_and_accepts_clean(tmp_path):
    dup = _csv(tmp_path, "account_id,ticker_name,ticker,qty,price\nacct_a,X,1,1,100\nacct_a,X,1,2,100\n")
    with pytest.raises(ValueError, match="중복"):
        load_holdings_csv(dup)
    df = load_holdings_csv(FIXTURE)
    assert df["qty"].dtype.kind == "i" and (df["qty"] > 0).all() and (df["price"] > 0).all()
    assert validate_holdings(df) == []


# ---- 합계 대조: 수량×가격으로 계산하고, 전사한 value가 그것과 다르면 '일치'라고 하지 않는다 ----
def test_reconcile_uses_qty_times_price_not_transcribed_value():
    rows = pd.DataFrame({"account_id": ["a"], "ticker_name": ["X"], "ticker": ["1"], "qty": [1], "price": [100], "value": [10_000]})
    r = reconcile(rows, 10_000)
    assert r.verified and not r.ok           # 예전엔 (True, 0)으로 통과했던 입력
    assert r.computed == 100 and r.diff == 100 - 10_000 and r.value_diff == 10_000 - 100
    good = rows.assign(value=[100])
    assert reconcile(good, 100).ok
    # 화면 합계가 없으면 '검증 불가'이지 '일치'가 아니다
    r2 = reconcile(good, 0)
    assert not r2.verified and not r2.ok


# ---- 저장: 계좌 ID는 등록·활성 계좌만, 경로 문자 금지, 빈 표 거부, 스냅샷 폴더 밖 쓰기 금지 ----
def test_save_holdings_rejects_traversal_unregistered_inactive_and_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "SNAPSHOTS", tmp_path / "snap")
    accounts = {"a": {"active": True}, "off": {"active": False}}
    df = pd.DataFrame({"account_id": ["a"], "ticker_name": ["X"], "ticker": ["1"], "qty": [1], "price": [100]})
    with pytest.raises(ValueError, match="계좌 ID"):
        store.save_holdings("../outside", df, accounts=accounts)
    assert not (tmp_path / "outside").exists() and not list(tmp_path.glob("*.csv"))
    with pytest.raises(ValueError, match="등록"):
        store.save_holdings("ghost", df, accounts=accounts)
    with pytest.raises(ValueError, match="사용 안 함"):
        store.save_holdings("off", df.assign(account_id="off"), accounts=accounts)
    # A 계좌 표를 B로 저장 → 필터 후 0행 → 거부 (예전엔 0행 CSV가 생김)
    with pytest.raises(ValueError, match="행이 없"):
        store.save_holdings("a", df.assign(account_id="b"), accounts={"a": {}, "b": {}})
    with pytest.raises(ValueError, match="qty"):
        store.save_holdings("a", df.assign(qty=[-1]), accounts=accounts)
    out = store.save_holdings("a", df, on=dt.date(2026, 1, 1), accounts=accounts)
    assert out == tmp_path / "snap" / "a" / "2026-01-01.csv" and out.exists()


# ---- 계산: 계좌 목록에 없거나 사용 안 함인 계좌의 보유분은 주문표를 만들지 않는다 ----
def test_unknown_or_inactive_account_blocks_orders():
    h, _ = tag_holdings(load_holdings_csv(FIXTURE))
    only_a = {"acct_a": {"account_type": "pension_savings"}}          # acct_b 미등록
    r = compute_rebalance(h, STRAT, accounts=only_a)
    assert r.blocked_reason and "acct_b" in r.blocked_reason and r.orders == []
    inactive = {"acct_a": {"account_type": "pension_savings"}, "acct_b": {"account_type": "pension_savings", "active": False}}
    r2 = compute_rebalance(h, STRAT, accounts=inactive)
    assert r2.blocked_reason and "acct_b" in r2.blocked_reason
    ok = {"acct_a": {"account_type": "pension_savings"}, "acct_b": {"account_type": "pension_savings", "active": True}}
    assert compute_rebalance(h, STRAT, accounts=ok).blocked_reason is None


# =====================================================================================
# SAFE-02 — 신규 매수 후보 적격·전략 범위·계좌 전환 검증 (ARCHITECTURE_REVIEW §4 P0 "제약 검사는 보유 종목에만", P1 "전략 저장은 합계만", P1 "계좌 전환 시 오저장")
# =====================================================================================
from tools.rebalance import NewCash  # noqa: E402

ACCTS = {"acct_a": {"account_type": "pension_savings"}, "acct_b": {"account_type": "pension_savings", "active": True}}


def _fixture():
    h, _ = tag_holdings(load_holdings_csv(FIXTURE))
    return h


# ---- 후보 종목: 보유에 없는 자산군을 살 기본 종목도 연금계좌 제약을 받는다 ----
def test_leverage_candidate_blocks_order_sheet():
    d = {"long_bond": {"ticker": "999990", "name": "테스트 레버리지 채권", "price": 10_000, "source": "class_defaults"}}
    r = compute_rebalance(_fixture(), STRAT, new_cash=NewCash(3_000_000, "acct_a"), accounts=ACCTS, mode="buy_only", defaults=d)
    assert r.blocked_reason and "테스트 레버리지 채권" in r.blocked_reason and r.orders == []   # 예전엔 매수 주문이 나왔다
    assert any(c.name == "신규 매수 후보 적격" and not c.passed for c in r.constraints)


def test_candidate_bad_ticker_format_blocks():
    d = {"long_bond": {"ticker": "../x", "name": "이상한 코드", "price": 10_000, "source": "strategy"}}
    r = compute_rebalance(_fixture(), STRAT, new_cash=NewCash(3_000_000, "acct_a"), accounts=ACCTS, mode="buy_only", defaults=d)
    assert r.blocked_reason and "이상한 코드" in r.blocked_reason


def test_unconfirmed_candidate_gets_amount_only_and_confirmed_gets_qty():
    """asset_map에 '확인됨'으로 없는 후보는 수량을 계산하지 않고 금액만 보여 준다. 확인된 후보만 수량이 나온다."""
    base = {"ticker": "999991", "name": "미확인 장기채", "price": 10_000, "source": "strategy"}
    r = compute_rebalance(_fixture(), STRAT, new_cash=NewCash(3_000_000, "acct_a"), accounts=ACCTS, mode="buy_only",
                          defaults={"long_bond": dict(base, confirmed=False)})
    lb = [o for o in r.orders if o.asset_class == "long_bond" and o.side == "매수"]
    assert lb and lb[0].qty is None and lb[0].amount > 0 and "확인 필요" in lb[0].note and lb[0].ticker == "999991"
    assert any("확인 필요" in n for n in r.notes)
    r2 = compute_rebalance(_fixture(), STRAT, new_cash=NewCash(3_000_000, "acct_a"), accounts=ACCTS, mode="buy_only",
                           defaults={"long_bond": dict(base, confirmed=True)})
    lb2 = [o for o in r2.orders if o.asset_class == "long_bond" and o.side == "매수"]
    assert lb2 and lb2[0].qty and lb2[0].qty > 0


def test_defaults_with_prices_marks_confirmed_from_asset_map():
    from tools.assets import defaults_with_prices
    amap = {"확인 금": {"ticker": "411060", "asset_class": "gold", "status": "confirmed"},
            "제안 채권": {"ticker": "356540", "asset_class": "mid_bond", "status": "proposed"},
            "분류 다른 주식": {"ticker": "360750", "asset_class": "gold", "status": "confirmed"}}
    inst = {"gold": {"ticker": "411060", "name": "확인 금"}, "mid_bond": {"ticker": "356540", "name": "제안 채권"},
            "stock": {"ticker": "360750", "name": "분류 다른 주식"}, "long_bond": {"ticker": "453850", "name": "매핑 없음"}}
    d = defaults_with_prices(_fixture(), live=False, instruments=inst, asset_map=amap)
    assert d["gold"]["confirmed"] is True
    assert d["mid_bond"]["confirmed"] is False        # proposed
    assert d["stock"]["confirmed"] is False           # 자산군 불일치
    assert d["long_bond"]["confirmed"] is False       # 매핑 없음


# ---- 납입 계좌: 등록·활성 계좌만, 금액은 0 이상 정수 ----
def test_new_cash_account_must_be_registered_and_active():
    r = compute_rebalance(_fixture(), STRAT, new_cash=NewCash(1_000_000, "ghost"), accounts=ACCTS, mode="buy_only")
    assert r.blocked_reason and "ghost" in r.blocked_reason and r.orders == []
    off = dict(ACCTS, acct_c={"account_type": "pension_savings", "active": False})
    r2 = compute_rebalance(_fixture(), STRAT, new_cash=NewCash(1_000_000, "acct_c"), accounts=off, mode="buy_only")
    assert r2.blocked_reason and "acct_c" in r2.blocked_reason
    with pytest.raises(ValueError):
        compute_rebalance(_fixture(), STRAT, new_cash=NewCash(-5, "acct_a"), accounts=ACCTS)
    with pytest.raises(ValueError):
        compute_rebalance(_fixture(), STRAT, new_cash=NewCash(1.5, "acct_a"), accounts=ACCTS)  # type: ignore[arg-type]


# ---- 주문 후 계좌: 어떤 계좌도 가진 현금보다 많이 사지 않는다 (사후 검증 항목이 결과에 남는다) ----
def test_orders_never_exceed_account_cash():
    r = compute_rebalance(_fixture(), STRAT, cash_by_account={"acct_a": 500_000}, new_cash=NewCash(2_000_000, "acct_b"),
                          accounts=ACCTS, mode="rebalance", full_align=True)
    assert r.blocked_reason is None
    for acct, start in {"acct_a": 500_000, "acct_b": 2_000_000}.items():
        sells = sum(o.amount for o in r.orders if o.side == "매도" and o.account_id == acct)
        buys = sum(o.amount for o in r.orders if o.side == "매수" and o.account_id == acct)
        assert buys <= start + sells
    assert any(c.name == "계좌별 현금 범위" and c.passed for c in r.constraints)


# ---- 전략 비율: 합계뿐 아니라 항목별 범위·자산군·임계치·최소 거래액을 거부 ----
def test_strategy_rejects_out_of_range_targets(tmp_path):
    import yaml
    from tools.strategy import load_strategy, save_targets, validate_strategy_fields
    p = tmp_path / "s.yaml"
    def write(targets, **extra):
        p.write_text(yaml.safe_dump({"strategies": {"x": dict({"name": "x", "threshold_pp": 5, "min_trade_krw": 100000, "targets": targets}, **extra)}},
                                    allow_unicode=True), encoding="utf-8")
    write({"stock": -10, "gold": 110})          # 합계 100이라 예전엔 통과
    with pytest.raises(ValueError, match="범위"):
        load_strategy("x", p)
    write({"stock": 50, "gold": 50}, threshold_pp=0)
    with pytest.raises(ValueError, match="임계치"):
        load_strategy("x", p)
    write({"stock": 50, "gold": 50}, min_trade_krw=-1)
    with pytest.raises(ValueError, match="최소 거래"):
        load_strategy("x", p)
    write({"stock": 50, "gold": 50}, instruments={"stock": {"ticker": "../x", "name": "n"}})
    with pytest.raises(ValueError, match="종목코드"):
        load_strategy("x", p)
    write({"stock": 50, "gold": 50})
    assert load_strategy("x", p).targets == {"stock": 0.5, "gold": 0.5}
    with pytest.raises(ValueError, match="범위"):
        save_targets("x", {"stock": -10, "gold": 110}, path=p)
    with pytest.raises(ValueError):
        save_targets("x", {"stock": float("nan"), "gold": 100}, path=p)
    with pytest.raises(ValueError, match="자산군"):
        save_targets("x", {"stock": 50, "bitcoin": 50}, path=p)
    with pytest.raises(ValueError, match="임계치"):
        save_targets("x", {"stock": 50, "gold": 50}, path=p, threshold_pp=80)
    assert validate_strategy_fields({"stock": 30, "long_bond": 70}, threshold_pp=5, min_trade_krw=100_000) == []


# ---- 계좌 전환: 다른 계좌 행이 섞인 표는 저장하지 않는다 (A 표를 B로 저장하면 행이 조용히 빠지던 문제) ----
def test_save_holdings_rejects_rows_of_other_accounts(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "SNAPSHOTS", tmp_path / "snap")
    accounts = {"a": {"active": True}, "b": {"active": True}}
    mixed = pd.DataFrame({"account_id": ["a", "b"], "ticker_name": ["X", "Y"], "ticker": ["1", "2"], "qty": [1, 1], "price": [100, 100]})
    with pytest.raises(ValueError, match="다른 계좌"):
        store.save_holdings("a", mixed, accounts=accounts)
    assert not list((tmp_path / "snap").glob("**/*.csv"))
    out = store.save_holdings("a", mixed[mixed["account_id"] == "a"], on=dt.date(2026, 1, 2), accounts=accounts)
    assert out.exists() and len(pd.read_csv(out)) == 1
