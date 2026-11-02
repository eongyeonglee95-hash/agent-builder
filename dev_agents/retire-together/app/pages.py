"""화면별 그리기 함수. 샘플 숫자는 docs/SCREEN_REFERENCE.md 컨셉 이미지 기준. 실제 숫자는 tools/에서."""
from __future__ import annotations

import streamlit as st

# 컨셉 이미지의 샘플 숫자 (회의용). 실제 연동은 v1.5
SAMPLE = {
    "부부 전체": {"total": 12_8450, "pension": 4_2300, "cash": 8_6150, "pension_pct": 33, "cash_pct": 67, "delta": "+3.2%"},
    "나":        {"total": 6_2500,  "pension": 2_0500, "cash": 4_2000, "pension_pct": 33, "cash_pct": 67, "delta": "+2.9%"},
    "배우자":    {"total": 6_5950,  "pension": 2_1800, "cash": 4_4150, "pension_pct": 33, "cash_pct": 67, "delta": "+3.5%"},
}


def _won(man: int) -> str:
    eok, rest = divmod(man, 10_000)
    return (f"{eok}억 " if eok else "") + (f"{rest:,}만원" if rest else "원")


def _real_numbers(view: str) -> dict:
    """등록된 보유 내역으로 홈 숫자를 만든다. 없으면 None (샘플로 폴백)."""
    from tools.assets import defaults_with_prices, load_accounts, load_pools, tag_holdings
    from tools.rebalance import compute_rebalance
    from tools.store import load_holdings
    from tools.strategy import has_targets, load_strategy
    from tools import explain

    accounts = load_accounts()
    owner = {"부부 전체": None, "나": "me", "배우자": "spouse"}[view]
    ids = [a for a, v in accounts.items() if owner is None or v.get("owner") == owner]
    holdings, sources = load_holdings(ids)
    if holdings.empty:
        return {"registered": False, "owner": owner}
    holdings["value"] = holdings["qty"] * holdings["price"]
    pocket = holdings["account_id"].map(lambda a: accounts[a].get("pocket"))
    pension = int(holdings.loc[pocket == "pension", "value"].sum())
    cash = int(holdings.loc[pocket == "cash", "value"].sum())
    # 풀별 리밸런싱 상태 → 이번 달 제안
    proposals = []
    pools = load_pools()
    tagged, _ = tag_holdings(holdings)
    for pid, pv in pools.items():
        sub = tagged[tagged["account_id"].isin([a for a in pv["accounts"] if a in ids])]
        if sub.empty or not has_targets(pv.get("strategy") or ""):
            continue
        strat = load_strategy(pv["strategy"])
        r = compute_rebalance(sub, strat, accounts=accounts, mode=pv.get("mode", "rebalance"),
                              defaults=defaults_with_prices(sub, live=False, instruments=strat.instruments))
        proposals.append({"pool": pv.get("label", pid), "mode": pv.get("mode", "rebalance"), "triggered": r.triggered,
                          "headline": explain.headline(r), "blocked": r.blocked_reason})
    return {"registered": True, "owner": owner, "pension": pension, "cash": cash, "total": pension + cash,
            "n_accounts": holdings["account_id"].nunique(), "proposals": proposals, "sources": sources,
            "cash_registered": bool((pocket == "cash").any())}


def home(view: str) -> None:
    d = _real_numbers(view)
    if not d["registered"]:
        s = SAMPLE[view]
        st.caption("지금의 선택이, 10년 후의 삶을 만듭니다. (이 보기에는 등록된 계좌가 없어 샘플 숫자입니다 → 입력 메뉴에서 등록)")
        c1, c2, c3 = st.columns(3)
        c1.metric("총 자산", _won(s["total"]), "샘플")
        c2.metric("노후 주머니 (연금)", _won(s["pension"]), f"{s['pension_pct']}% 샘플")
        c3.metric("갈아타기 주머니 (현금)", _won(s["cash"]), f"{s['cash_pct']}% 샘플")
    else:
        st.caption("지금의 선택이, 10년 후의 삶을 만듭니다. (등록된 보유 내역 기준, 등록 때 가격)")
        total = d["total"] or 1
        c1, c2, c3 = st.columns(3)
        c1.metric("총 자산 (등록분)", f"{d['total']/10_000:,.0f}만원", f"계좌 {d['n_accounts']}개")
        c2.metric("노후 주머니 (연금)", f"{d['pension']/10_000:,.0f}만원", f"{d['pension']/total*100:.0f}%")
        if d["cash_registered"]:
            c3.metric("갈아타기 주머니 (현금)", f"{d['cash']/10_000:,.0f}만원", f"{d['cash']/total*100:.0f}%")
        else:
            c3.metric("갈아타기 주머니 (현금)", "미등록", "키움 주식계좌는 PoC 범위 밖")

    st.subheader("이번 달 제안")
    props = d.get("proposals") or []
    if props:
        cols = st.columns(min(len(props), 3))
        for c, pr in zip(cols * 3, props):
            text = f"**{pr['pool']}** · {'매수만' if pr['mode']=='buy_only' else '리밸런싱'}\n\n{pr['headline']}"
            if pr["blocked"]:
                c.error(text)
            elif pr["triggered"]:
                c.warning(text + "\n\n→ 리밸런싱 메뉴에서 주문표 확인")
            else:
                c.success(text)
    else:
        st.info("등록된 계좌가 있으면 풀별 리밸런싱 상태가 여기 뜹니다.")
    st.info("**IRP 세액공제 한도 300만원 남았어요** — 올해 안에 납입하면 매수만 모드로 배분 제안을 받을 수 있어요. (수동 메모, 자동 계산은 v1.5)")

    st.subheader("이번 달 체크리스트")
    st.checkbox("연금 납입 확인하기", value=False)
    st.checkbox("연금저축 리밸런싱 검토", value=any(p["triggered"] for p in props) if props else False)
    st.checkbox("대출 상환 계획 점검", value=False)


def pension(view: str) -> None:
    st.caption("부부 각자의 4층 석탑과 '우리 집 예상 월 수령액'. (샘플 — 계산은 3단계 Pension Payout Simulator)")
    left, right = st.columns([2, 1])
    layers = [("4층 ISA → 연금계좌", 0.3), ("3층 개인연금 (연금저축·연금보험)", 0.6), ("2층 퇴직연금 (DB·DC·IRP)", 0.8), ("1층 국민연금", 1.0)]
    with left:
        for label, width in layers:
            st.progress(width, text=label)
        st.caption("막대 길이는 샘플. 층별 월 수령액 입력 → CALCULATION_RULES §4 공식으로 계산 예정")
    with right:
        st.metric("우리 집 예상 월 수령액", "— 만원", "55세 사적연금 개시, 65세 국민연금 (기본값)")
        st.slider("수익률 가정 (%)", 0.0, 10.0, 5.0, 0.5)
        st.slider("물가 가정 (%)", 0.0, 5.0, 2.0, 0.5)
        st.slider("수령 종료 나이", 80, 100, 90)


def _default_holdings_path():
    """data/samples 아래 가장 최근 *_parsed_*.csv 또는 balance_*.csv (git 제외 폴더)."""
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    cands = (sorted(root.glob("data/snapshots/holdings_*.csv")) + sorted(root.glob("data/samples/**/holdings_parsed_*.csv"))
             + sorted(root.glob("data/samples/**/balance_*.csv")))
    return max(cands, key=lambda c: c.stat().st_mtime) if cands else None


def rebalancing(view: str) -> None:
    import pandas as pd
    from tools import explain, order_sheet
    from tools.assets import defaults_with_prices, load_accounts, load_pools, tag_holdings
    from tools.decisions import read_decisions, record_decision
    from tools.parse_balance import load_holdings_csv
    from tools.rebalance import NewCash, compute_rebalance
    from tools.strategy import list_strategies, load_strategy

    accounts = load_accounts()
    pools = load_pools()
    labels = {k: v.get("label", k) for k, v in accounts.items()}

    # ---- 머리글: 풀 · 전략 · 납입 · 데이터 ----
    from tools.strategy import has_targets
    top = st.columns([2, 2, 2])
    pool_id = top[0].selectbox("풀 (합산 단위)", list(pools), format_func=lambda k: pools[k].get("label", k))
    pool = pools[pool_id]
    mode = top[1].radio("모드", ["rebalance", "buy_only"], index=0 if pool.get("mode", "rebalance") == "rebalance" else 1,
                        format_func=lambda m: "리밸런싱 (매도·매수)" if m == "rebalance" else "매수만 (납입금으로)", horizontal=True)
    new_cash_amt = top[2].number_input("신규 납입 (원)", min_value=0, step=100_000, value=0)
    strategies = list_strategies()
    strat_ids = [k for k, _ in strategies]
    default_idx = strat_ids.index(pool.get("strategy")) if pool.get("strategy") in strat_ids else 0
    strat_label = {k: n + ("" if has_targets(k) else "  (비율 미입력)") for k, n in strategies}
    strategy_id = st.radio("전략 (자산배분 룰)", strat_ids, index=default_idx, format_func=lambda k: strat_label[k], horizontal=True)
    full_align = st.toggle("완전 리밸런싱 — 임계치 무시하고 모든 자산군을 목표 비율로 (처음 전환할 때)", value=False) if mode == "rebalance" else False

    from tools.store import load_holdings
    uploaded = st.file_uploader("보유 내역 CSV (비우면 입력 화면에서 등록한 계좌별 최신 파일)", type=["csv"])
    if uploaded is not None:
        holdings = load_holdings_csv(uploaded)
        holdings = holdings[holdings["account_id"].isin(pool["accounts"])].reset_index(drop=True)
    else:
        holdings, sources = load_holdings(pool["accounts"])
        st.caption("데이터: " + " · ".join(f"{labels.get(a, a)} ← {src}" for a, src in sources.items()))
    if holdings.empty:
        st.warning("이 풀의 계좌에 보유 내역이 없어요. 입력 메뉴에서 캡처를 등록해 주세요.")
        return
    if st.toggle("현재가를 공개 시세로 갱신", value=False):
        from tools.market import fetch_prices
        try:
            prices = fetch_prices(list(holdings["ticker"].dropna().unique()))
            holdings["price"] = holdings["ticker"].map(prices).fillna(holdings["price"]).astype(int)
            st.caption("현재가: 네이버 금융 기준 방금 갱신")
        except Exception as e:  # 네트워크 없으면 스냅샷 가격
            st.caption(f"현재가 조회 실패({e}) → 파일의 스냅샷 가격")
    holdings, unmapped = tag_holdings(holdings)
    if unmapped:
        st.error("자산군 미분류 종목: " + ", ".join(unmapped) + " → rules/asset_map.yaml에 추가 필요")

    from tools.strategy import ASSET_CLASSES, CLASS_LABELS, has_targets, save_targets
    with st.expander("비율 편집 — 이 전략의 자산군 목표 비율(%)", expanded=not has_targets(strategy_id)):
        import yaml as _yaml
        from tools.strategy import STRATEGIES_PATH
        raw = _yaml.safe_load(STRATEGIES_PATH.read_text(encoding="utf-8"))["strategies"].get(strategy_id, {})
        cur = raw.get("targets") or {}
        if not cur:
            st.caption("비율이 아직 없어요. 저자 비율은 리서치(/wiki-research)에서 출처와 함께 채우고, 지금은 임시로 넣어 쓸 수 있어요.")
        cols = st.columns(len(ASSET_CLASSES))
        vals = {}
        for c, cls in zip(cols, ASSET_CLASSES):
            vals[cls] = c.number_input(CLASS_LABELS[cls], min_value=0.0, max_value=100.0, value=float(cur.get(cls, 0)), step=0.5, key=f"tgt_{strategy_id}_{cls}")
        total = sum(vals.values())
        th = st.number_input("발동 임계치 (±%p)", min_value=0.5, max_value=20.0, value=float(raw.get("threshold_pp", 5)), step=0.5, key=f"th_{strategy_id}")
        src = st.text_input("출처 (책·페이지·링크)", value=raw.get("source") or "", key=f"src_{strategy_id}")
        c1, c2 = st.columns([1, 3])
        c2.caption(f"합계 {total:.1f}% — 100이어야 저장돼요")
        if c1.button("비율 저장", disabled=abs(total - 100) > 1e-6, key=f"save_{strategy_id}"):
            save_targets(strategy_id, vals, threshold_pp=th, source=src or None)
            st.success("저장했어요 (rules/strategies.yaml)."); st.rerun()
    try:
        strategy = load_strategy(strategy_id)
    except ValueError as e:
        st.warning("이 전략은 비율이 비어 있어요. 위 '비율 편집'에서 채우거나 다른 전략을 고르세요.")
        return
    new_cash = None
    if new_cash_amt:
        # SAFE-02: 납입이 들어가는 계좌를 사용자가 고른다 (풀의 첫 계좌로 자동 지정하면 생각한 계좌와 주문 계좌가 달라질 수 있다)
        cash_acct = st.selectbox("납입이 들어가는 계좌", pool["accounts"], format_func=lambda k: labels.get(k, k), key=f"nc_{pool_id}")
        new_cash = NewCash(int(new_cash_amt), cash_acct)
    with st.expander("자산군 기본 종목 고르기 — 보유가 없는 자산군을 살 때 쓰는 종목 (후보 중 선택, 바꿀 수 있음)"):
        import yaml as _yaml
        from tools.assets import ASSET_MAP_PATH, load_class_defaults, save_asset_map
        from tools.strategy import class_label
        cd = load_class_defaults()
        picks, changed = {}, False
        for cls, d in cd.items():
            options = [(d.get("ticker"), d.get("name"))] + [(a["ticker"], a["name"]) for a in d.get("alternatives", []) if a["ticker"] != d.get("ticker")]
            labels_ = [f"{n} ({t})" for t, n in options]
            idx = st.selectbox(class_label(cls, strategy), range(len(options)), format_func=lambda i, L=labels_: L[i], key=f"cd_{cls}")
            picks[cls] = options[idx]
            if options[idx][0] != d.get("ticker"):
                changed = True
        if strategy.instruments:
            st.caption("이 전략이 직접 지정한 종목(strategies.yaml instruments)이 우선: " + ", ".join(f"{class_label(c, strategy)}={d.get('name')}" for c, d in strategy.instruments.items()))
        st.caption("기준: 계좌 적격 → 전략이 정한 유형(국가·만기·환) → 실물형 우선 → 보유 많은 운용사 → 거래량 → 보수 (REBALANCING §1-2). 비교표는 docs/wiki/products/. 도구는 고르지 않습니다, 본인이 고릅니다.")
        if st.button("기본 종목 저장", disabled=not changed):
            for cls, (t, n) in picks.items():
                d = cd[cls]
                alts = [a for a in d.get("alternatives", []) if a["ticker"] != t]
                if d.get("ticker") != t:
                    alts.insert(0, {"ticker": d.get("ticker"), "name": d.get("name")})
                cd[cls] = dict(d, ticker=t, name=n, status="confirmed", alternatives=alts)
            data = _yaml.safe_load(ASSET_MAP_PATH.read_text(encoding="utf-8"))
            save_asset_map(data.get("assets") or {}, cd)
            st.success("저장했어요 (rules/asset_map.yaml class_defaults)."); st.rerun()
    defaults = defaults_with_prices(holdings, live=True, instruments=strategy.instruments)
    r = compute_rebalance(holdings, strategy, new_cash=new_cash, accounts=accounts, mode=mode, defaults=defaults, full_align=full_align)
    last = read_decisions()

    # ---- 경고 배너 + 왜 지금 + 총 평가액 ----
    b1, b2 = st.columns([4, 1])
    with b1:
        if r.blocked_reason:
            st.error("**" + explain.headline(r) + "**")
        elif r.triggered:
            st.warning("**" + explain.headline(r) + "**\n\n" + explain.why_now(r, last[-2:]))
        else:
            st.success("**" + explain.headline(r) + "**\n\n" + explain.why_now(r, last[-2:]))
    with b2:
        st.metric("총 평가액", f"{r.total_value/10_000:,.0f}만원", f"납입 {r.new_cash:,}원 포함" if r.new_cash else None)

    # ---- 목표 vs 현재 ----
    st.subheader("목표 vs 현재")
    chart = pd.DataFrame({"자산군": [c["label"] for c in r.classes],
                          "목표": [round(c["target"] * 100, 1) for c in r.classes],
                          "현재": [round(c["current"] * 100, 1) for c in r.classes]}).set_index("자산군")
    st.bar_chart(chart, stack=False, height=220)
    st.dataframe(order_sheet.classes_table(r), hide_index=True, use_container_width=True)
    st.caption(f"발동 기준 ±{r.threshold*100:.0f}%p · 임계치를 넘은 자산군만 거래 · 제도 검증: " +
               " / ".join(f"{c.name} {'✓' if c.passed else '✗'}" for c in r.constraints))

    # ---- 주문표 ----
    st.subheader("주문표")
    st.caption("매도 먼저, 그다음 매수 · 납입금은 매수에 먼저 사용 · 종목이 비어 있으면 그 자산군 종목은 아직 안 정한 것")
    if r.orders:
        st.dataframe(order_sheet.orders_table(r, labels), hide_index=True, use_container_width=True)
    else:
        st.info("이번엔 주문 없음")
    for n in r.notes:
        st.caption("· " + n)

    # ---- 지난 결정 + 버튼 ----
    if last:
        d = last[-1]
        st.caption(f"지난 결정: {d['date']} \"{d['decision']}\" — {d['reason']}")
    c1, c2, c3 = st.columns(3)
    reason = st.text_input("사유 (넘기기·보류할 때)", placeholder="예: 금리 인하 기다림")
    if c1.button("이번엔 넘기기"):
        record_decision(f"{pools[pool_id].get('label', pool_id)} 리밸런싱 보류", reason or "(사유 없음)")
        st.toast("DECISIONS.md에 기록했어요")
    if c2.button("직접 주문할게요"):
        record_decision(f"{pools[pool_id].get('label', pool_id)} 주문표 수락 (직접 주문)", reason or "")
        st.toast("DECISIONS.md에 기록했어요. 증권사 앱에서 주문표대로 주문하세요")
    c3.button("승인하고 자동주문", disabled=True, help="한국투자증권 계좌가 생기면(2027) 활성화 — 2단계")


def coming_soon(name: str) -> None:
    st.info(f"**{name}** 화면은 준비 중이에요. 기획은 docs/SCREEN_REFERENCE.md를 보세요.")


OWNERS = {"me": "나", "spouse": "배우자"}
BROKERS = {"mirae": "미래에셋", "kiwoom": "키움", "kis": "한국투자"}
TYPES = {"pension_savings": "연금저축", "irp": "IRP", "isa": "ISA", "general": "일반"}
MODES = {"rebalance": "리밸런싱 (매도·매수)", "buy_only": "매수만 (납입금으로)"}


def settings(view: str) -> None:
    """계좌 묶기 — 이 계좌들, 같이 볼까 따로 볼까? (처음 로그인·설정)"""
    from tools.assets import load_accounts_list, load_pools, save_accounts
    from tools.strategy import list_strategies

    st.caption("합산할 계좌는 같은 풀에, 따로 갈 계좌는 각자 풀. 풀마다 전략과 모드를 고릅니다. 저장하면 rules/accounts.yaml에 쓰입니다.")
    accounts = load_accounts_list()
    pools = load_pools()
    strategies = dict(list_strategies())

    st.subheader("1. 풀 — 리밸런싱 단위")
    new_pool = st.text_input("새 풀 만들기 (id, 영문)", placeholder="예: spouse_pension")
    if new_pool and new_pool not in pools:
        pools[new_pool] = {"label": new_pool, "strategy": "all_weather", "mode": "buy_only", "accounts": []}
    pool_rows = []
    for pid, pv in pools.items():
        c = st.columns([2, 3, 3, 3])
        c[0].markdown(f"**{pid}**")
        label = c[1].text_input("이름", pv.get("label", pid), key=f"pl_{pid}")
        strat = c[2].selectbox("전략", list(strategies), index=list(strategies).index(pv.get("strategy")) if pv.get("strategy") in strategies else 0,
                               format_func=lambda k: strategies[k], key=f"ps_{pid}")
        mode = c[3].selectbox("모드", list(MODES), index=0 if pv.get("mode", "rebalance") == "rebalance" else 1,
                              format_func=lambda k: MODES[k], key=f"pm_{pid}")
        pool_rows.append((pid, {"label": label, "strategy": strat, "mode": mode}))

    st.subheader("2. 계좌 — 어느 풀에 넣을까")
    pool_ids = [pid for pid, _ in pool_rows]
    acct_rows = []
    for a in accounts:
        c = st.columns([3, 2, 2, 2, 3, 1])
        c[0].markdown(f"**{a.get('label', a['id'])}**  \n<span style='color:#888'>{a['id']}</span>", unsafe_allow_html=True)
        c[1].write(OWNERS.get(a.get("owner"), a.get("owner")))
        c[2].write(BROKERS.get(a.get("broker"), a.get("broker")))
        c[3].write(TYPES.get(a.get("account_type"), a.get("account_type")))
        cur = a.get("pool") if a.get("pool") in pool_ids else pool_ids[0]
        pool = c[4].selectbox("풀", pool_ids, index=pool_ids.index(cur), key=f"ap_{a['id']}")
        active = c[5].checkbox("사용", value=bool(a.get("active", False)), key=f"aa_{a['id']}")
        acct_rows.append(dict(a, pool=pool, active=active))

    if st.button("저장", type="primary"):
        save_accounts(acct_rows, dict(pool_rows))
        st.success("저장했어요. 리밸런싱 화면에서 풀을 다시 고르면 반영됩니다.")
        st.rerun()

    st.divider()
    st.caption("가족 초대코드·편집 권한·증권사 API 키·자동매매 한도는 v1.5 이후 (docs/SCREEN_REFERENCE.md 설정).")


def input_page(view: str) -> None:
    """입력 — 숫자 넣기 가장 쉬운 곳. 캡처 붙여넣기가 가장 큰 버튼."""
    import datetime as dt
    from pathlib import Path

    import pandas as pd

    from tools.assets import load_accounts

    root = Path(__file__).resolve().parents[1]
    accounts = load_accounts()
    st.caption("변하지 않는 것(종목·수량·매입금액)은 캡처 한 번으로 등록. 현재가는 리밸런싱 화면에서 공개 시세로 갱신.")

    tab0, tab1, tab2 = st.tabs(["📊 내 자산 한눈에 (시트)", "📷 캡처 등록 (처음·수량 변경 때)", "📄 CSV 올리기"])
    with tab0:
        _asset_sheet(accounts, root)
    with tab1:
        from tools.assets import load_pools, set_pool_mode, upsert_asset_tags
        from tools.strategy import CLASS_LABELS
        pools = load_pools()
        acct = st.selectbox("계좌", list(accounts), format_func=lambda k: accounts[k].get("label", k))
        if "parsed" in st.session_state and st.session_state.get("parsed_account") != acct:
            # SAFE-02: 파싱 결과는 변환한 계좌에만 속한다. 계좌를 바꾸면 이전 표를 버린다 (A 표를 B로 저장하던 문제)
            prev = st.session_state.get("parsed_account")
            for k in ("parsed", "parsed_meta", "parsed_account"):
                st.session_state.pop(k, None)
            st.info(f"계좌를 바꿔서 {accounts.get(prev, {}).get('label', prev)}의 변환 결과를 비웠어요. 이 계좌 캡처를 다시 변환하세요.")
        cur_pool = next((pv for pid, pv in pools.items() if acct in pv["accounts"]), {})
        mode = st.radio("이 계좌 운용 방식 (계좌 꼬리표)", list(MODES), index=0 if cur_pool.get("mode", "rebalance") == "rebalance" else 1,
                        format_func=lambda k: MODES[k], horizontal=True, key=f"mode_{acct}")
        if mode != cur_pool.get("mode", "rebalance"):
            if st.button("운용 방식 저장"):
                set_pool_mode(acct, mode)
                st.success("저장했어요. 리밸런싱 화면에 반영됩니다."); st.rerun()
        images = st.file_uploader("증권사 앱 잔고 화면 캡처 (여러 장 가능, 같은 계좌)", type=["png", "jpg", "jpeg"], accept_multiple_files=True)
        if images and st.button("표로 변환", type="primary"):
            from tools.register import register
            day = dt.date.today().isoformat()
            up_dir = root / "data" / "uploads" / acct / day
            up_dir.mkdir(parents=True, exist_ok=True)
            paths = []
            for i, f in enumerate(images):
                dst = up_dir / f"{i+1:03d}_{f.name}"
                dst.write_bytes(f.getbuffer())
                paths.append(dst)
            with st.spinner("캡처를 읽는 중 (Claude 비전, 10~20초)…"):
                try:
                    df, meta = register(acct, paths, accounts[acct].get("label"))
                except Exception as e:
                    st.error(f"캡처 파싱 실패: {e}")
                    return
            st.session_state["parsed"] = df
            st.session_state["parsed_meta"] = meta
            st.session_state["parsed_account"] = acct
        if "parsed" in st.session_state:
            meta = st.session_state["parsed_meta"]
            if meta.get("reconciled"):
                st.success(f"화면 합계 {meta['screen_total_value']:,}원과 일치해요. 표를 확인하고 저장하세요.")
            elif not meta.get("verified", True):
                st.warning("캡처에서 화면 합계를 못 읽어 검증 불가예요. 수량·현재가를 직접 확인한 뒤 저장하세요.")
            else:
                extra = f" (전사한 평가금액과 수량×현재가 차이 {meta['value_diff']:+,}원)" if meta.get("value_diff") else ""
                st.warning(f"화면 합계와 {meta.get('diff', 0):+,}원 차이가 있어요{extra}. 틀린 칸을 고친 뒤 저장하세요.")
            for err in meta.get("errors", []):
                st.error(err)
            for name, cands in meta.get("unresolved", []):
                st.info(f"종목코드 미확정: {name} → 후보 {cands}. ticker 칸에 직접 넣어 주세요.")
            base = st.session_state["parsed"].copy()
            if "자산군" not in base:  # 종목 꼬리표: 매핑에 있으면 채우고, 없으면 비워서 고르게
                from tools.assets import load_asset_map
                amap = load_asset_map()
                cls_label = {k: v for k, v in CLASS_LABELS.items()}
                base["자산군"] = base["ticker_name"].map(lambda n: cls_label.get(amap.get(n, {}).get("asset_class"), None))
                base["역할"] = base["ticker_name"].map(lambda n: "위성" if amap.get(n, {}).get("role") == "satellite" else "핵심")
                st.session_state["parsed"] = base
            st.caption("종목 꼬리표: 자산군과 역할(핵심=넓은 지수, 위성=테마·특정 국가)을 확인하세요. 저장하면 종목 매핑에 '확인됨'으로 들어가 다음부터 안 묻습니다.")
            edited = st.data_editor(base, num_rows="dynamic", use_container_width=True, key="parsed_editor",
                                    column_config={"자산군": st.column_config.SelectboxColumn(options=list(CLASS_LABELS.values()), required=True),
                                                   "역할": st.column_config.SelectboxColumn(options=["핵심", "위성"], required=True)})
            ok_to_save = True
            if not meta.get("reconciled"):
                st.caption("합계가 안 맞는 흔한 이유: 캡처를 한 장만 올려서 화면 아래쪽 종목이 빠짐 → 그 계좌의 캡처를 전부 올려 다시 변환하세요.")
                ok_to_save = st.checkbox("차이를 확인했고 이대로 저장할게요")
            if st.button("저장 (이 계좌의 보유 내역으로 등록)", disabled=not ok_to_save):
                from tools.store import save_holdings
                label_to_key = {v: k for k, v in CLASS_LABELS.items()}
                tags = [{"ticker_name": r["ticker_name"], "ticker": r.get("ticker"), "asset_class": label_to_key.get(r.get("자산군")),
                         "role": "satellite" if r.get("역할") == "위성" else "core"} for _, r in edited.iterrows()]
                if st.session_state.get("parsed_account") != acct:
                    st.error("변환한 계좌와 선택한 계좌가 달라요. 이 계좌 캡처를 다시 변환하세요."); return
                try:
                    out = save_holdings(acct, edited.drop(columns=["자산군", "역할"]))
                except ValueError as e:
                    st.error(str(e)); return
                n = upsert_asset_tags(tags)
                st.success(f"저장: {out.relative_to(root)} · 종목 꼬리표 {n}개 확인됨 — 리밸런싱 화면이 계좌별 최신 파일을 합쳐 씁니다.")
                for k in ("parsed", "parsed_meta", "parsed_account"):
                    st.session_state.pop(k, None)
    with tab2:
        f = st.file_uploader("보유 내역 CSV (열: account_id, ticker_name, ticker, qty, price …)", type=["csv"], key="csv_up")
        if f is not None:
            df = pd.read_csv(f, encoding="utf-8-sig", dtype={"ticker": str})
            st.dataframe(df, hide_index=True, use_container_width=True)
            if st.button("이 CSV를 보유 내역으로 저장 (계좌별로 나눠 저장)"):
                from tools.store import save_holdings
                try:
                    outs = [save_holdings(a, df[df["account_id"] == a]) for a in df["account_id"].unique()]
                except ValueError as e:
                    st.error(str(e)); return
                st.success("저장: " + ", ".join(str(o.relative_to(root)) for o in outs))
    st.divider()
    st.caption("구글시트 연동·증권사 API 조회·대화형 입력은 v1.5 이후 (MASTER_PRD §4).")


def _asset_sheet(accounts: dict, root) -> None:
    """모든 계좌의 보유 내역을 시트 한 장으로. 어느 파일에서 왔는지, 평가금액, 자산군, 합계, 다운로드."""
    import io

    import pandas as pd

    from tools.assets import load_pools, tag_holdings
    from tools.store import load_holdings, snapshot_history
    from tools.strategy import CLASS_LABELS

    ids = list(accounts)
    holdings, sources = load_holdings(ids)
    st.markdown("**데이터 출처 (계좌별 최신 파일)**")
    src_rows = [{"계좌": accounts[a].get("label", a), "출처": src,
                 "등록 이력": ", ".join(p.stem for p in snapshot_history(a)) or "—"} for a, src in sources.items()]
    st.dataframe(pd.DataFrame(src_rows), hide_index=True, use_container_width=True)
    if holdings.empty:
        st.info("등록된 보유 내역이 없어요. 옆 탭에서 캡처를 등록하세요.")
        return

    f1, f2 = st.columns([3, 1])
    chosen = f1.multiselect("계좌 (비우면 전체)", ids, format_func=lambda a: accounts[a].get("label", a), key="sheet_accts")
    if chosen:
        holdings = holdings[holdings["account_id"].isin(chosen)].reset_index(drop=True)
        if holdings.empty:
            st.info("선택한 계좌에 등록된 보유 내역이 없어요.")
            return
    live = f2.toggle("현재가 갱신", value=False, key="sheet_live", help="공개 시세(네이버 금융)로 지금 가격을 받아 화면에서만 반영")
    if live:
        from tools.market import fetch_prices
        try:
            prices = fetch_prices(list(holdings["ticker"].dropna().unique()))
            holdings["price"] = holdings["ticker"].map(prices).fillna(holdings["price"]).astype(int)
        except Exception as e:
            st.caption(f"현재가 조회 실패({e}) → 등록 때 가격")
    holdings, unmapped = tag_holdings(holdings)
    pools = load_pools()
    acct_pool = {a: pid for pid, pv in pools.items() for a in pv["accounts"]}
    from tools.assets import load_asset_map
    full_names = {k: v.get("full_name", k) for k, v in load_asset_map().items()}  # 캡처에 잘린 이름 → 정식 이름
    holdings["raw_name"] = holdings["ticker_name"]
    holdings["ticker_name"] = holdings["ticker_name"].map(lambda n: full_names.get(n, n))
    sheet = pd.DataFrame({
        "소유자": holdings["account_id"].map(lambda a: OWNERS.get(accounts.get(a, {}).get("owner"), "")),
        "계좌": holdings["account_id"].map(lambda a: accounts.get(a, {}).get("label", a)),
        "풀": holdings["account_id"].map(lambda a: pools.get(acct_pool.get(a), {}).get("label", acct_pool.get(a, ""))),
        "주머니": holdings["account_id"].map(lambda a: "노후" if accounts.get(a, {}).get("pocket") == "pension" else "현금"),
        "종목명": holdings["ticker_name"], "종목코드": holdings["ticker"],
        "운용": holdings["account_id"].map(lambda a: "매수만" if pools.get(acct_pool.get(a), {}).get("mode") == "buy_only" else "리밸런싱"),
        "자산군": holdings["asset_class"].map(lambda c: CLASS_LABELS.get(c, c or "미분류")),
        "역할": holdings["role"].map(lambda r: "위성" if r == "satellite" else "핵심") if "role" in holdings else "핵심",
        "수량": holdings["qty"], "현재가": holdings["price"],
        "매입단가": (holdings["buy_value"] / holdings["qty"]).round(0) if "buy_value" in holdings else None,
        "평가금액": holdings["qty"] * holdings["price"],
        "매입금액": holdings.get("buy_value", pd.Series([None] * len(holdings))),
    })
    has_buy = sheet["매입금액"].notna().all()
    sheet["손익"] = sheet["평가금액"] - sheet["매입금액"] if has_buy else None
    sheet["수익률%"] = ((sheet["평가금액"] / sheet["매입금액"] - 1) * 100).round(2) if has_buy else None
    total = int(sheet["평가금액"].sum())
    c1, c2, c3 = st.columns(3)
    c1.metric("총 평가금액", f"{total:,}원")
    c2.metric("계좌 수", f"{holdings['account_id'].nunique()}개")
    c3.metric("종목 수", f"{len(sheet)}개")
    sheet = sheet.sort_values(["소유자", "계좌", "자산군", "평가금액"], ascending=[True, True, True, False]).reset_index(drop=True)
    palette = ["#f4f6fb", "#fff7ee", "#f1f8f2", "#f8f1fa"]  # 계좌마다 다른 옅은 배경
    acct_color = {a: palette[i % len(palette)] for i, a in enumerate(sheet["계좌"].unique())}
    styled = sheet.style.apply(lambda row: [f"background-color: {acct_color[row['계좌']]}"] * len(row), axis=1) \
        .format({"평가금액": "{:,.0f}", "매입금액": "{:,.0f}", "현재가": "{:,.0f}", "매입단가": "{:,.0f}", "손익": "{:+,.0f}", "수익률%": "{:+.2f}", "수량": "{:,.0f}"}, na_rep="—")
    st.dataframe(styled, hide_index=True, use_container_width=True)
    st.markdown("**자산군별 합계**")
    by_cls = sheet.groupby("자산군")["평가금액"].sum().sort_values(ascending=False)
    st.dataframe(pd.DataFrame({"자산군": by_cls.index, "평가금액": by_cls.values, "비중": (by_cls.values / total * 100).round(1)}),
                 hide_index=True, use_container_width=True)
    if unmapped:
        st.warning("자산군 미분류: " + ", ".join(unmapped))
    with st.expander("종목 꼬리표 고치기 (자산군·역할)"):
        from tools.assets import upsert_asset_tags
        label_to_key = {v: k for k, v in CLASS_LABELS.items()}
        tag_df = sheet[["종목명", "종목코드", "자산군", "역할"]].drop_duplicates("종목명").reset_index(drop=True)
        tag_df["자산군"] = tag_df["자산군"].replace("미분류", None)
        edited_tags = st.data_editor(tag_df, hide_index=True, use_container_width=True, key="tag_editor",
                                     column_config={"자산군": st.column_config.SelectboxColumn(options=list(CLASS_LABELS.values()), required=True),
                                                    "역할": st.column_config.SelectboxColumn(options=["핵심", "위성"], required=True)},
                                     disabled=["종목명", "종목코드"])
        if st.button("꼬리표 저장"):
            raw_names = dict(zip(holdings["ticker_name"], holdings["raw_name"]))  # 정식 이름 → 캡처 이름(매핑 키)
            rows = [{"ticker_name": raw_names.get(r["종목명"], r["종목명"]), "ticker": r["종목코드"], "asset_class": label_to_key.get(r["자산군"]),
                     "role": "satellite" if r["역할"] == "위성" else "core"} for _, r in edited_tags.iterrows()]
            n = upsert_asset_tags(rows)
            st.success(f"{n}개 저장 (확인됨). 리밸런싱 화면은 재실행하면 반영됩니다."); st.rerun()
    buf = io.BytesIO(); sheet.to_excel(buf, index=False)
    d1, d2 = st.columns(2)
    d1.download_button("엑셀로 받기", buf.getvalue(), file_name="my_assets.xlsx")
    d2.download_button("CSV로 받기", sheet.to_csv(index=False, encoding="utf-8-sig").encode("utf-8-sig"), file_name="my_assets.csv")
    st.caption("구글시트 연동(템플릿 복사·자동 읽기)은 v1.5. 지금은 이 시트를 받아 구글시트에 붙여 넣으면 같은 모양입니다.")
