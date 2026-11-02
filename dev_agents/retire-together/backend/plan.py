"""plan — 리밸런싱 결과를 '아주 단순한 제안'으로 접는다 (2026-11-02 사용자 "각 리밸런싱을 아주아주 심플하고 알아보기 쉽게").

엔진(tools.rebalance)이 낸 종목별 주문을 자산군별로 묶어 '줄이기 → 늘리기' 금액과 한두 문장을 만든다.
문장은 판정에 따라 코드가 고르는 틀이다(LLM 없음, 예측·추천 표현 없음). 숫자는 모두 엔진 주문의 합.
"""
from __future__ import annotations

from collections import OrderedDict

from tools.rebalance import RebalanceResult
from tools.strategy import CLASS_LABELS

LEFTOVER_MIN = 10_000   # 판 돈과 산 돈의 차이가 이 이상이면 '현금으로 남아요'를 보여 준다


def _has_batchim(word: str) -> bool:
    ch = word.rstrip()[-1:] if word else ""
    if not ("가" <= ch <= "힣"):
        return False
    return (ord(ch) - 0xAC00) % 28 != 0


def _rieul(word: str) -> bool:
    ch = word.rstrip()[-1:]
    return "가" <= ch <= "힣" and (ord(ch) - 0xAC00) % 28 == 8


def eul(word: str) -> str:
    return word + ("을" if _has_batchim(word) else "를")


def euro(word: str) -> str:
    return word + ("으로" if _has_batchim(word) and not _rieul(word) else "로")


def ida(word: str) -> str:
    return word + ("이" if _has_batchim(word) else "가")


def _join(labels: list[str]) -> str:
    return "·".join(labels)


def _groups(r: RebalanceResult, side: str) -> list[dict]:
    acc: "OrderedDict[str, int]" = OrderedDict()
    for o in r.orders:
        if o.side != side or not o.amount:
            continue
        for cls in o.asset_class.split(","):
            acc[cls] = acc.get(cls, 0) + int(o.amount)
            break
    rows = [{"asset_class": k, "label": r.labels.get(k) or CLASS_LABELS.get(k, k), "amount": v} for k, v in acc.items()]
    return sorted(rows, key=lambda x: -x["amount"])


def build(r: RebalanceResult, mode: str) -> dict:
    """판정 종류(kind)·문장(title, line)·줄이기/늘리기 금액. kind: blocked | in_range | move | buy | buy_needs_cash."""
    reduce, increase = _groups(r, "매도"), _groups(r, "매수")
    sells = [o for o in r.orders if o.side == "매도"]
    buys = [o for o in r.orders if o.side == "매수"]
    out = {"reduce": reduce, "increase": increase,
           "reduce_total": sum(x["amount"] for x in reduce), "increase_total": sum(x["amount"] for x in increase),
           "sell_count": len(sells), "buy_count": len(buys),
           "amount_only": sum(1 for o in buys if not o.qty),
           "targets": [{"asset_class": c["asset_class"], "label": c["label"], "target_pct": round(c["target"] * 100, 2)} for c in r.classes if c["target"] > 0],
           "leftover": 0, "notes": []}
    worst = max(r.classes, key=lambda c: abs(c["deviation_pp"]), default=None)
    if worst:
        more = worst["deviation_pp"] > 0
        out["title_head"] = f"{worst['label']} 비중이 목표보다"
        out["title_tail"] = f"{abs(worst['deviation_pp']):.1f}%p {'많아요' if more else '적어요'}."
        out["title_tone"] = "up" if more else "down"
        out["title"] = f"{out['title_head']} {out['title_tail']}"
        out["worst"] = {"label": worst["label"], "deviation_pp": worst["deviation_pp"]}
    if r.blocked_reason:
        out.update(kind="blocked", title="주문표를 만들 수 없어요.", title_head=None, line=r.blocked_reason)
        return out
    if not r.triggered:
        out.update(kind="in_range", title="모든 자산군이 목표 범위 안이에요.", title_head=None, line=f"±{r.threshold * 100:g}%p 안이라 이번 달은 할 일이 없어요.")
        return out
    if reduce:
        out["kind"] = "move"
        tail = euro(_join([x["label"] for x in increase])) + " 옮겨요." if increase else "팔아요."
        out["line"] = f"{eul(_join([x['label'] for x in reduce]))} 팔아 {tail}" if increase else f"{eul(_join([x['label'] for x in reduce]))} 팔아요."
        left = out["reduce_total"] - out["increase_total"]
        if left >= LEFTOVER_MIN:
            out["leftover"] = left
        return out
    if increase:
        out.update(kind="buy", line=f"팔지 않고 {eul(_join([x['label'] for x in increase]))} 사요.")
        return out
    short = [c["label"] for c in sorted(r.classes, key=lambda c: c["deviation_pp"]) if c["deviation_pp"] < 0]
    out.update(kind="buy_needs_cash" if mode == "buy_only" else "in_range",
               line=(f"팔지 않고, 이번 달 넣는 돈으로 모자란 {eul(_join(short))} 채워요." if mode == "buy_only"
                     else "사고팔 주문이 없어요."))
    return out


def compare_notes(current: RebalanceResult, proposed: RebalanceResult, proposed_name: str) -> list[str]:
    """원칙을 바꾸면 눈여겨볼 것 — 새 원칙에 자리가 없는 자산군을 파는 주문, 주식처럼 그대로인 자산군."""
    notes = []
    targets = {c["asset_class"]: c["target"] for c in proposed.classes}
    by_class: "OrderedDict[str, list]" = OrderedDict()
    for o in proposed.orders:
        if o.side == "매도" and targets.get(o.asset_class, 0) == 0:
            by_class.setdefault(o.asset_class, []).append(o)
    for cls, orders in by_class.items():
        label = CLASS_LABELS.get(cls, cls)
        items = ", ".join(f"{o.ticker_name} {o.qty:,}주" for o in orders if o.qty)
        notes.append(f"{proposed_name}에는 {label} 자리가 없어서 지금 가진 {label}{'(' + items + ')' if items else ''}{'을' if _has_batchim(label) else '를'} 모두 팔게 돼요.")
    traded = {o.asset_class for o in proposed.orders if o.side in ("매도", "매수")}
    cur_traded = {o.asset_class for o in current.orders if o.side in ("매도", "매수")}
    kept = [CLASS_LABELS.get(c, c) for c in cur_traded - traded if targets.get(c, 0) > 0]
    if kept:
        notes.append(f"{_join(kept)}{'은' if _has_batchim(kept[-1]) else '는'} 목표 범위 안이라 사고팔지 않아요.")
    return notes
