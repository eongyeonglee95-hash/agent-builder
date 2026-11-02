"""Agent가 쓸 수 있는 도구 7개 — 전부 기존 코드(tools/·backend/workbook.py)를 감싼 것이다.

LLM은 계산하지 않는다: 숫자는 여기서 코드가 만들고, 결과는 사람이 읽을 문장·표(이미 서식이 잡힌 숫자)로 돌려준다.
Agent는 이 숫자를 옮겨 적기만 한다. 각 함수는 순수하게 문자열을 돌려주므로 LLM 없이 테스트한다.

| 도구 | 설계상 역할 (AGENT_DESIGN §1) | 쓰기 |
|---|---|---|
| list_pools        | load_strategy — 묶음·전략 비율·임계치·모드 | 읽기 |
| tag_assets        | tag_assets — 등록 잔고 종목별 자산군·확인 상태 | 읽기 |
| compute_rebalance | compute_rebalance — 비중·편차·발동·제도 검증 | 읽기 |
| explain_inputs    | explain_inputs — "왜 지금" 재료 수치 | 읽기 |
| build_order_sheet | build_order_sheet — 주문표 | 읽기 |
| read_decisions    | read_decisions — 지난 수락·보류와 사유 | 읽기 |
| record_decision   | record_decision — 수락·보류 기록 | **쓰기 (사용자 확인 후)** |

parse_balance(캡처·파일 등록)는 등록 화면이 맡는다. Agent는 이미 등록된 잔고만 읽는다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException

from backend import workbook
from tools import order_sheet
from tools.strategy import CLASS_LABELS, load_strategy

SERVER = "retire"
OWNERS = ("together", "me", "partner")


def _man(won: int) -> str:
    return f"약 {round(won / 10_000):,}만원"


def _input(owner: str = "together", live: bool = False, pool_id: str | None = None,
           new_cash: int = 0, new_cash_account: str | None = None) -> workbook.RebalanceInput:
    cash = {pool_id: workbook.PoolCash(amount=new_cash, account_id=new_cash_account)} if pool_id and new_cash else {}
    return workbook.RebalanceInput(owner=owner, live=live, cash=cash)


def _run(pool_id: str, **kw):
    """(base, RebalanceResult) 또는 ValueError(사람이 읽는 이유)."""
    data = _input(pool_id=pool_id, **kw)
    ctx = workbook._context(data)
    if pool_id not in ctx["pools"]:
        raise ValueError(f"'{pool_id}' 묶음이 없어요. list_pools로 묶음 id를 확인하세요.")
    ran = workbook.run_pool(data, ctx, pool_id)
    if ran is None:
        raise ValueError("이 묶음 계좌에 등록된 잔고가 없어요. 먼저 '자산 등록'에서 잔고를 올려야 해요.")
    base, r, error = ran
    if error:
        raise ValueError(error)
    return base, r, ctx


def list_pools(owner: str = "together") -> str:
    data = _input(owner=owner)
    ctx = workbook._context(data)
    lines = []
    for pid, pool in ctx["pools"].items():
        ids = [a for a in pool.get("accounts", []) if a in ctx["accts"] and ctx["accts"][a].get("active", True) is not False]
        has = bool(ids) and ctx["df"]["account_id"].isin(ids).any()
        mode = "리밸런싱(매도·매수)" if pool.get("mode", "rebalance") == "rebalance" else "매수만"
        head = f"- 묶음 id `{pid}` · {pool.get('label', pid)} · 모드 {mode} · 등록 잔고 {'있음' if has else '없음'}"
        accts = ", ".join(ctx["accts"][a].get("label", a) + f" (`{a}`)" for a in ids) or "(사용 중인 계좌 없음)"
        try:
            s = load_strategy(pool.get("strategy") or "all_weather")
            targets = " / ".join(f"{s.labels.get(k) or CLASS_LABELS.get(k, k)} {v*100:.1f}%" for k, v in s.targets.items()) or "(비율 미정)"
            strat = f"전략 {s.name} · 임계치 ±{s.threshold*100:.1f}%p · 최소 거래 {s.min_trade_krw:,}원 · 목표 {targets}"
        except (KeyError, ValueError) as e:
            strat = f"전략을 읽을 수 없음: {e}"
        lines += [head, f"  계좌: {accts}", f"  {strat}"]
    return "\n".join(lines) or "등록된 묶음이 없어요."


def tag_assets(owner: str = "together") -> str:
    from tools.assets import tag_holdings
    ctx = workbook._context(_input(owner=owner))
    df = ctx["df"]
    if df.empty:
        return "등록된 잔고가 없어요."
    tagged, unmapped = tag_holdings(df, ctx["amap"])
    assets = ctx["amap"]  # load_asset_map: 종목명 → {ticker, asset_class, status ...}
    lines = []
    for acct, part in tagged.groupby("account_id", sort=False):
        lines.append(f"[{ctx['accts'].get(acct, {}).get('label', acct)}] 기준일 {ctx['as_of'].get(acct) or '모름'}")
        for _, row in part.iterrows():
            cls = row.get("asset_class")
            status = (assets.get(row["ticker_name"]) or {}).get("status", "미등록")
            label = CLASS_LABELS.get(cls, cls) if isinstance(cls, str) else "미분류"
            lines.append(f"- {row['ticker_name']} ({row['ticker'] or '종목코드 없음'}) → {label} · 분류 상태 {status} · {int(row['qty']):,}주")
    if unmapped:
        lines.append("자산군 미분류 종목: " + ", ".join(unmapped) + " — 사용자가 분류를 정해야 계산할 수 있어요.")
    return "\n".join(lines)


def compute_rebalance(pool_id: str, owner: str = "together", live: bool = False,
                      new_cash: int = 0, new_cash_account: str | None = None) -> str:
    from tools.explain import headline
    base, r, _ = _run(pool_id, owner=owner, live=live, new_cash=new_cash, new_cash_account=new_cash_account)
    total = f"총 평가액 {r.total_value:,}원" + (f" + 이번 납입 {r.new_cash:,}원 = {r.total_after_cash:,}원" if r.new_cash else "")
    checks = " / ".join(f"{c.name} {'통과' if c.passed else '실패: ' + c.detail}" for c in r.constraints)
    parts = [
        f"묶음: {base['label']} · 전략 {r.strategy_name} · 임계치 ±{r.threshold*100:.1f}%p · 잔고 기준일 {base['as_of'] or '모름'}",
        f"판정: {headline(r)}",
        total,
        "목표 vs 현재 (● = 임계치 넘음)",
        order_sheet.to_markdown(order_sheet.classes_table(r)),
        f"제도 검증: {checks}",
    ]
    if r.blocked_reason:
        parts.append(f"주문표 보류: {r.blocked_reason}")
    parts += [f"참고: {n}" for n in r.notes]
    return "\n".join(parts)


def explain_inputs(pool_id: str, owner: str = "together", live: bool = False,
                   new_cash: int = 0, new_cash_account: str | None = None) -> str:
    base, r, ctx = _run(pool_id, owner=owner, live=live, new_cash=new_cash, new_cash_account=new_cash_account)
    e = r.explain_inputs
    worst = e.get("worst_deviation_pp")
    lines = [
        f"가정 하락장: 주식 −{e.get('shock_stock_pct', 30)}% (CALCULATION_RULES 기본값)",
        f"지금 비율로 두면 예상 손실 {_man(e['loss_now'])}",
        f"목표 비율로 되돌리면 예상 손실 {_man(e['loss_target'])}",
        f"두 손실의 차이 {_man(e['loss_diff'])}",
    ]
    if worst is not None:
        lines.append(f"편차가 가장 큰 자산군: {e['worst_class']} {worst:+.1f}%p (목표보다 {'높음' if worst > 0 else '낮음'})")
    lines.append("연금계좌 과세이연: " + ("예 — 지금 팔아도 세금이 없음" if e.get("tax_deferred") else "아니오"))
    if r.new_cash:
        lines.append(f"이번 납입 {r.new_cash:,}원은 매도 없이 부족한 자산군 매수에 먼저 씀")
    lines.append(_decision_summary(base["label"], ctx["decisions"]))
    return "\n".join(lines)


def build_order_sheet(pool_id: str, owner: str = "together", live: bool = False,
                      new_cash: int = 0, new_cash_account: str | None = None) -> str:
    base, r, ctx = _run(pool_id, owner=owner, live=live, new_cash=new_cash, new_cash_account=new_cash_account)
    if r.blocked_reason:
        return f"주문표 보류: {r.blocked_reason}"
    labels = {k: v.get("label", k) for k, v in ctx["accts"].items()}
    table = order_sheet.to_markdown(order_sheet.orders_table(r, labels))
    trades = [o for o in r.orders if o.side != "생략"]
    head = "주문표 (매도 먼저, 그다음 매수). 이 표를 고치지 말고 그대로 보여 주세요. 주문은 사용자가 증권사 앱에서 직접 합니다."
    tail = "" if trades else "\n이번엔 실제 거래가 없어요."
    return f"{head}\n{table}{tail}"


def _pool_decisions(label: str, decisions: list[dict]) -> list[dict]:
    short = workbook._short(label)
    return [d for d in decisions if d["decision"].startswith(short)]


def _decision_summary(label: str, decisions: list[dict]) -> str:
    mine = _pool_decisions(label, decisions)
    if not mine:
        return "지난 결정: 이 묶음은 기록이 없음"
    streak = 0
    for d in reversed(mine):
        if "보류" not in d["decision"]:
            break
        streak += 1
    last = mine[-1]
    text = f"지난 결정: {last['date']} {last['decision']} — 사유 \"{last['reason']}\""
    if streak >= 2:
        text += f" · 최근 {streak}번 연속 보류 (REBALANCING_RULES §5: 지난 사유를 먼저 보여 주고, 임계치 조정을 제안할 수 있음. 바꾸는 건 사용자)"
    return text


def read_decisions(pool_id: str | None = None, limit: int = 5) -> str:
    data = _input()
    ctx = workbook._context(data)
    decisions = ctx["decisions"]
    if pool_id:
        if pool_id not in ctx["pools"]:
            return f"'{pool_id}' 묶음이 없어요."
        decisions = _pool_decisions(ctx["pools"][pool_id].get("label") or pool_id, decisions)
    if not decisions:
        return "기록된 리밸런싱 결정이 없어요."
    return "\n".join(f"- {d['date']} | {d['who']} | {d['decision']} | 사유: {d['reason']}" for d in decisions[-limit:])


def record_decision(pool_id: str, action: str, reason: str = "", owner: str = "together", live: bool = False,
                    new_cash: int = 0, new_cash_account: str | None = None) -> str:
    """수락 = 사용자가 증권사 앱에서 직접 주문하겠다는 기록(자동주문 없음). 보류 = 이번엔 넘김.
    주문표는 같은 입력으로 다시 계산해 기록한다 (workbook.decision)."""
    data = workbook.DecisionInput(owner=owner, live=live, pool_id=pool_id, action=action, reason=reason,
                                  cash={pool_id: workbook.PoolCash(amount=new_cash, account_id=new_cash_account)} if new_cash else {})
    try:
        out = workbook.decision(data)
    except HTTPException as e:
        raise ValueError(str(e.detail)) from None
    return f"기록했어요: {out['line']}"


# ---- Claude Agent SDK 연결 ----------------------------------------------------------

_CALC_ARGS = {
    "pool_id": {"type": "string", "description": "묶음 id (list_pools의 `...` 안 값)"},
    "owner": {"type": "string", "enum": list(OWNERS), "description": "together=부부 전체, me=나, partner=배우자", "default": "together"},
    "live": {"type": "boolean", "description": "true면 공개 시세로 현재가 갱신, false면 등록 때 가격", "default": False},
    "new_cash": {"type": "integer", "minimum": 0, "description": "이번 달 납입 금액(원). 사용자가 말한 금액만", "default": 0},
    "new_cash_account": {"type": "string", "description": "납입이 들어가는 계좌 id. 모르면 비움"},
}


def _schema(props: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


SPECS: dict[str, dict[str, Any]] = {
    "list_pools": {"fn": list_pools, "write": False,
                   "description": "리밸런싱 묶음(풀) 목록: 묶음 id, 계좌, 전략 이름·목표 비율·임계치·모드, 등록 잔고 여부. 대화를 시작할 때 먼저 부른다.",
                   "schema": _schema({"owner": _CALC_ARGS["owner"]}, [])},
    "tag_assets": {"fn": tag_assets, "write": False,
                   "description": "등록된 잔고의 종목별 자산군과 분류 확인 상태(confirmed/proposed), 미분류 종목.",
                   "schema": _schema({"owner": _CALC_ARGS["owner"]}, [])},
    "compute_rebalance": {"fn": compute_rebalance, "write": False,
                          "description": "묶음 하나의 현재 비중·목표·편차·발동 여부·제도 검증을 코드로 계산한 결과.",
                          "schema": _schema(_CALC_ARGS, ["pool_id"])},
    "explain_inputs": {"fn": explain_inputs, "write": False,
                       "description": "'왜 지금' 설명 재료: 가정 하락장 손실(지금 vs 목표), 편차 최대 자산군, 과세이연, 납입, 지난 결정 요약.",
                       "schema": _schema(_CALC_ARGS, ["pool_id"])},
    "build_order_sheet": {"fn": build_order_sheet, "write": False,
                          "description": "묶음의 주문표(매도 먼저, 계좌·종목·수량·예상 금액). 표를 그대로 보여 준다.",
                          "schema": _schema(_CALC_ARGS, ["pool_id"])},
    "read_decisions": {"fn": read_decisions, "write": False,
                       "description": "지난 리밸런싱 수락·보류와 사유. pool_id를 주면 그 묶음만.",
                       "schema": _schema({"pool_id": _CALC_ARGS["pool_id"],
                                          "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5}}, [])},
    "record_decision": {"fn": record_decision, "write": True,
                        "description": "사용자가 이번 대화에서 분명히 수락(직접 주문하겠다) 또는 보류라고 말했을 때만 기록한다. 사유는 사용자 말 그대로. 실행 전 사용자 확인을 거친다.",
                        "schema": _schema({**_CALC_ARGS,
                                           "action": {"type": "string", "enum": ["accept", "hold"], "description": "accept=직접 주문할게요, hold=이번엔 넘기기"},
                                           "reason": {"type": "string", "maxLength": 200, "description": "사용자가 말한 사유 그대로. 없으면 비움"}},
                                          ["pool_id", "action"])},
}


def full_name(name: str) -> str:
    return f"mcp__{SERVER}__{name}"


READ_ONLY = [full_name(n) for n, s in SPECS.items() if not s["write"]]
WRITE = [full_name(n) for n, s in SPECS.items() if s["write"]]


@dataclass
class ToolLog:
    """이번 대화에서 도구가 돌려준 글 — 답의 숫자가 여기 있는지 guard가 대조한다."""
    texts: list[str] = field(default_factory=list)

    def joined(self) -> str:
        return "\n".join(self.texts)


def call(name: str, args: dict, log: ToolLog | None = None) -> tuple[str, bool]:
    """도구 하나 실행 → (글, 오류 여부). 오류도 사람이 읽는 문장으로 돌려준다."""
    spec = SPECS[name]
    try:
        text, is_error = spec["fn"](**{k: v for k, v in args.items() if v is not None}), False
    except (ValueError, KeyError) as e:
        text, is_error = f"계산할 수 없어요: {e}", True
    if log is not None:
        log.texts.append(text)
    return text, is_error


def build_server(log: ToolLog):
    from claude_agent_sdk import create_sdk_mcp_server, tool

    def make(name: str, spec: dict):
        @tool(name, spec["description"], spec["schema"])
        async def handler(args: dict) -> dict:
            text, is_error = call(name, args, log)
            return {"content": [{"type": "text", "text": text}], "is_error": is_error}
        return handler

    return create_sdk_mcp_server(name=SERVER, version="0.1.0", tools=[make(n, s) for n, s in SPECS.items()])
