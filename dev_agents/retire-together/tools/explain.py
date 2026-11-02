"""explain — "왜 지금" 한 문단. 회의 전까지는 코드 템플릿(수치만 끼움), 회의 후 Agent 생성으로 교체.

금지: 예측·추천 표현 ("오를 것", "이 ETF가 좋다"). 재료는 docs/REBALANCING_RULES.md §4.
"""
from __future__ import annotations

from tools.rebalance import RebalanceResult

FORBIDDEN = ("오를 것", "오를 거", "떨어질 것", "유망", "추천", "좋은 ETF", "사야 합니다", "팔아야 합니다")


def _man(won: int) -> str:
    return f"약 {round(won / 10_000):,}만원"


def headline(r: RebalanceResult) -> str:
    if r.blocked_reason:
        return f"주문표를 만들 수 없어요 — {r.blocked_reason}"
    if not r.triggered:
        return "이번엔 재배분이 필요 없어요 — 모든 자산군이 임계치 안이에요"
    e = r.explain_inputs
    sign = "높아요" if (e["worst_deviation_pp"] or 0) > 0 else "낮아요"
    return f"재배분이 필요해요 — {e['worst_class']} 비중이 목표보다 {abs(e['worst_deviation_pp']):.1f}%p {sign}"


def why_now(r: RebalanceResult, last_decisions: list[dict] | None = None) -> str:
    e = r.explain_inputs
    shock_stock = r.explain_inputs.get("shock_stock_pct", 30)
    parts = [
        "리밸런싱의 목적은 수익을 늘리는 게 아니라 처음 정한 위험 수준을 지키는 것이에요.",
        f"지금 비율대로 두고 주식이 {shock_stock}% 떨어지면 {_man(e['loss_now'])}을 잃지만, "
        f"목표 비율로 되돌려 두면 {_man(e['loss_target'])}에 그쳐요.",
    ]
    if e.get("tax_deferred"):
        parts.append("연금계좌는 과세이연이라 지금 팔아도 세금이 없어요.")
    if r.new_cash:
        parts.append(f"이번 납입금 {r.new_cash:,}원은 매도 없이 부족한 자산군을 사는 데 먼저 써요.")
    for d in last_decisions or []:
        parts.append(f"지난 결정: {d['date']} \"{d['decision']}\" → 이번엔 편차가 {abs(e['worst_deviation_pp']):.1f}%p예요.")
    text = " ".join(parts)
    assert not any(w in text for w in FORBIDDEN), "설명에 금지 표현이 들어갔음"
    return text
