"""CLI — 화면과 같은 순서로 출력: 전략 → 목표 vs 현재 → 주문표 → 왜 지금.

예)
  uv run python -m tools.cli --holdings data/fixtures/holdings_fixture.csv --strategy all_weather
  uv run python -m tools.cli --holdings data/samples/.../balance_2026-10-26.csv --new-cash 3000000 --new-cash-account me_mirae_pension_new --live
"""
from __future__ import annotations

import argparse
import sys

from tools import explain, order_sheet
from tools.assets import defaults_with_prices, load_accounts, load_pools, tag_holdings
from tools.decisions import read_decisions
from tools.parse_balance import load_holdings_csv
from tools.rebalance import NewCash, compute_rebalance
from tools.strategy import load_strategy


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="둘이서은퇴 — 연금 리밸런싱 (드라이런)")
    ap.add_argument("--holdings", required=True, help="보유 내역 CSV")
    ap.add_argument("--pool", default=None, help="리밸런싱 풀 id (rules/accounts.yaml pools). 지정하면 그 풀의 계좌만, 전략은 풀 설정")
    ap.add_argument("--strategy", default=None, help="전략 id (풀 설정보다 우선)")
    ap.add_argument("--new-cash", type=int, default=0, help="신규 납입 금액(원)")
    ap.add_argument("--new-cash-account", default=None, help="납입이 들어가는 계좌 id")
    ap.add_argument("--full", action="store_true", help="완전 리밸런싱: 임계치 무시, 모든 자산군을 목표로")
    ap.add_argument("--live", action="store_true", help="현재가를 공개 시세로 갱신 (기본: CSV의 스냅샷 가격)")
    args = ap.parse_args(argv)

    holdings = load_holdings_csv(args.holdings)
    if args.live:
        from tools.market import fetch_prices
        codes = [c for c in holdings["ticker"].dropna().unique()]
        try:
            prices = fetch_prices(codes)
            holdings["price"] = holdings["ticker"].map(prices).fillna(holdings["price"]).astype(int)
            print("현재가: 공개 시세로 갱신")
        except Exception as e:  # 네트워크 없으면 스냅샷 가격
            print(f"현재가 조회 실패({e}) → CSV 스냅샷 가격 사용")
    strategy_id = args.strategy or "all_weather"
    mode = "rebalance"
    if args.pool:
        pool = load_pools()[args.pool]
        holdings = holdings[holdings["account_id"].isin(pool["accounts"])].reset_index(drop=True)
        strategy_id = args.strategy or pool.get("strategy") or strategy_id
        mode = pool.get("mode", "rebalance")
        print(f"풀: {pool.get('label', args.pool)} · 계좌 {len(pool['accounts'])}개 · 모드 {'리밸런싱(매도·매수)' if mode=='rebalance' else '매수만'}")
    holdings, unmapped = tag_holdings(holdings)
    if unmapped:
        print("자산군 미분류 종목 (rules/asset_map.yaml에 추가 필요):", ", ".join(unmapped))

    strategy = load_strategy(strategy_id)
    new_cash = None
    if args.new_cash:
        acct = args.new_cash_account or holdings["account_id"].iloc[0]
        new_cash = NewCash(args.new_cash, acct)
    accounts = load_accounts()
    labels = {k: v.get("label", k) for k, v in accounts.items()}
    defaults = defaults_with_prices(holdings, live=True, instruments=strategy.instruments)
    r = compute_rebalance(holdings, strategy, new_cash=new_cash, accounts=accounts, mode=mode, defaults=defaults, full_align=args.full)

    print(f"\n전략: {r.strategy_name} · 임계치 ±{r.threshold*100:.0f}%p · 최소 거래 {r.min_trade_krw:,}원")
    print(f"총 평가액 {r.total_value:,}원" + (f" + 납입 {r.new_cash:,}원 = {r.total_after_cash:,}원" if r.new_cash else ""))
    print("\n■ " + explain.headline(r) + "\n")
    print("목표 vs 현재")
    print(order_sheet.to_markdown(order_sheet.classes_table(r)))
    print("\n제도 검증: " + " / ".join(f"{c.name} {'✓' if c.passed else '✗ ' + c.detail}" for c in r.constraints))
    print("\n주문표 (매도 먼저, 그다음 매수)")
    print(order_sheet.to_markdown(order_sheet.orders_table(r, labels)))
    for n in r.notes:
        print("· " + n)
    if not r.blocked_reason:
        print("\n왜 지금\n" + explain.why_now(r, read_decisions()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
