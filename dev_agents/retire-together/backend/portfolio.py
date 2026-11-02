"""portfolio — 리밸런싱 시트 맨 위 '포트폴리오' (Claude 담당, 2026-11-02 사용자 "올웨더/K-올웨더/박곰희 포트폴리오를 하나 보여주고,
그 아래에 내가 선택하면 그 포트폴리오를 따라가고 아니면 개별로 저장되게").

- GET  /api/workbook/portfolios        : 고를 수 있는 포트폴리오(목표 비율·예시 종목·확인 상태)와 묶음별 지금 전략
- POST /api/workbook/portfolio/follow  : 묶음이 따라갈 포트폴리오를 바꾼다 (accounts.yaml pools.<id>.strategy 한 줄)
- POST /api/workbook/portfolio/custom  : '직접 설정' 비율 저장 (strategies.yaml custom.targets 한 줄). pool_id를 주면 바로 따라감

전략·비율은 사용자가 정한다. 이 API는 사용자가 누른 것만 저장하고, 바꾼 내용은 DECISIONS.md에 남긴다.
비율 숫자의 원천은 strategies.yaml이고, 아직 정하지 않은 전략(K-올웨더)은 따라갈 수 없다 — 비율을 지어내지 않는다.
"""
from __future__ import annotations

from typing import Annotated, Literal

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import Field

from backend import registration
from backend.storage import InputModel
from backend.workbook import _short, decisions_path
from tools.assets import candidate_confirmed, load_asset_map, load_class_defaults, load_pools, set_pool_strategy
from tools.decisions import record_decision
from tools.strategy import ASSET_CLASSES, CLASS_LABELS, load_strategy, set_custom_targets, strategies_path

router = APIRouter(prefix="/api/workbook", tags=["portfolio"])

CHOICES = ("all_weather", "k_all_weather", "park_gomhee", "custom")
SHORT_NAMES = {"all_weather": "올웨더", "k_all_weather": "K-올웨더", "park_gomhee": "박곰희", "custom": "직접 설정"}
# 예시 종목코드를 확인한 시점 (strategies.yaml 주석: 2026-10-26 네이버 종목 검색). 시그널스노우볼식 면책 문구에 쓴다 (DECISIONS 2026-10-27)
EXAMPLES_AS_OF = "2026년 10월"
PENDING_NOTE = {"k_all_weather": "비율을 아직 정하지 않았어요. 후보 (A) 기사 비율 · (B) 저자 칼럼 · (C) 앱 '국내 올웨더' 중 하나를 고르면 채워 드려요."}


class FollowInput(InputModel):
    pool_id: Annotated[str, Field(min_length=1, max_length=80)]
    strategy_id: Annotated[str, Field(min_length=1, max_length=40)]


class PreviewInput(InputModel):
    pool_id: Annotated[str, Field(min_length=1, max_length=80)]
    strategy_id: Annotated[str, Field(min_length=1, max_length=40)]
    owner: Literal["together", "me", "partner"] = "together"
    live: bool = False
    cash: Annotated[int, Field(strict=True, ge=0, le=10**12)] = 0


class CustomInput(InputModel):
    targets: dict[str, Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]]
    pool_id: Annotated[str | None, Field(max_length=80)] = None


def _raw() -> dict:
    return yaml.safe_load(strategies_path().read_text(encoding="utf-8"))["strategies"]


def _card(sid: str, raw: dict, amap: dict, defaults: dict) -> dict:
    s = raw.get(sid) or {}
    targets = {k: float(v) for k, v in (s.get("targets") or {}).items()}
    ready = False
    error = None
    if targets:
        try:
            load_strategy(sid)
            ready = True
        except (KeyError, ValueError) as e:
            error = str(e)
    labels = s.get("labels") or {}
    instruments = s.get("instruments") or {}
    classes = list(targets) if sid != "custom" else list(ASSET_CLASSES)
    rows = []
    for cls in classes:
        inst = instruments.get(cls) or defaults.get(cls) or {}
        rows.append({"asset_class": cls, "label": labels.get(cls) or CLASS_LABELS.get(cls, cls), "target_pct": targets.get(cls, 0.0),
                     "example": inst.get("name"), "ticker": inst.get("ticker"),
                     "confirmed": bool(inst.get("ticker")) and candidate_confirmed(inst.get("ticker"), inst.get("name"), cls, amap)})
    return {"id": sid, "short": SHORT_NAMES[sid], "name": s.get("name", sid), "ready": ready, "error": error,
            "threshold_pp": float(s.get("threshold_pp", 5)), "source": s.get("source"), "pending_note": PENDING_NOTE.get(sid) if not targets else None,
            "classes": rows}


def portfolios() -> dict:
    raw = _raw()
    amap = load_asset_map(registration.asset_map_path())
    defaults = load_class_defaults(registration.asset_map_path())
    pools = load_pools(registration.accounts_path())
    return {"strategies": [_card(sid, raw, amap, defaults) for sid in CHOICES if sid in raw],
            "pools": [{"pool_id": pid, "label": p.get("label") or pid, "strategy_id": p.get("strategy") or "all_weather"} for pid, p in pools.items()],
            "examples_note": f"종목코드는 {EXAMPLES_AS_OF} 기준 예시이며 추천이 아닙니다. 매수 전 거래 증권사에서 직접 확인하세요."}


@router.get("/portfolios")
def portfolios_api():
    return portfolios()


def _name(sid: str) -> str:
    return SHORT_NAMES.get(sid) or (_raw().get(sid) or {}).get("name", sid)


def follow(pool_id: str, strategy_id: str) -> dict:
    if strategy_id not in CHOICES:
        raise HTTPException(422, "고를 수 없는 포트폴리오예요.")
    pools = load_pools(registration.accounts_path())
    if pool_id not in pools:
        raise HTTPException(404, "이 묶음이 없어요.")
    try:
        load_strategy(strategy_id)
        if not _raw()[strategy_id].get("targets"):
            raise ValueError("비율이 아직 없어요")
    except (KeyError, ValueError) as e:
        raise HTTPException(409, f"{_name(strategy_id)}는 아직 따라갈 수 없어요: {e}") from None
    label = pools[pool_id].get("label") or pool_id
    previous = pools[pool_id].get("strategy") or "all_weather"
    if previous == strategy_id:
        return {"changed": False, "line": None}
    set_pool_strategy(pool_id, strategy_id, registration.accounts_path())
    line = _record(f"{_short(label)} 포트폴리오 변경: {_name(previous)} → {_name(strategy_id)}", "리밸런싱 시트에서 사용자가 선택")
    return {"changed": True, "line": line}


@router.post("/portfolio/follow")
def follow_api(data: FollowInput):
    return follow(data.pool_id, data.strategy_id)


def _what_if(data: PreviewInput, strategy_ids: list[str]) -> tuple[dict, object, list[dict]]:
    """같은 잔고로 원칙만 바꿔 엔진을 다시 돌린다(저장 없음). (base, 지금 결과, [{strategy_id, result|error}])."""
    from backend import workbook
    inp = workbook.RebalanceInput(owner=data.owner, live=data.live,
                                  cash={data.pool_id: workbook.PoolCash(amount=data.cash)} if data.cash else {})
    ctx = workbook._context(inp)
    if data.pool_id not in ctx["pools"]:
        raise HTTPException(404, "이 묶음이 없어요.")
    cur = workbook.run_pool(inp, ctx, data.pool_id)
    if cur is None:
        raise HTTPException(409, "이 묶음은 등록한 잔고가 없어서 비교할 수 없어요.")
    base, r_cur, _ = cur
    out = []
    for sid in strategy_ids:
        ctx2 = {**ctx, "pools": {**ctx["pools"], data.pool_id: {**ctx["pools"][data.pool_id], "strategy": sid}}}
        _, r_alt, err = workbook.run_pool(inp, ctx2, data.pool_id)
        out.append({"strategy_id": sid, "result": r_alt, "error": err})
    return base, r_cur, out


@router.post("/portfolio/preview")
def preview_api(data: PreviewInput):
    """원칙을 바꾸면 이번 달 할 일이 어떻게 달라지는지 — 저장하지 않고 같은 잔고로 엔진을 한 번 더 돌린다."""
    from backend.plan import build, compare_notes
    if data.strategy_id not in CHOICES:
        raise HTTPException(422, "고를 수 없는 포트폴리오예요.")
    base, r_cur, [alt] = _what_if(data, [data.strategy_id])
    if alt["error"] or alt["result"] is None:
        raise HTTPException(409, f"{_name(data.strategy_id)}로는 계산할 수 없어요: {alt['error']}")
    mode = base["mode"]
    return {"pool_id": data.pool_id, "strategy_id": data.strategy_id, "name": _name(data.strategy_id),
            "current": build(r_cur, mode) if r_cur else None, "proposed": build(alt["result"], mode),
            "notes": compare_notes(r_cur, alt["result"], _name(data.strategy_id)) if r_cur else []}


class AlternativesInput(InputModel):
    pool_id: Annotated[str, Field(min_length=1, max_length=80)]
    owner: Literal["together", "me", "partner"] = "together"
    live: bool = False
    cash: Annotated[int, Field(strict=True, ge=0, le=10**12)] = 0


@router.post("/portfolio/alternatives")
def alternatives_api(data: AlternativesInput):
    """'다른 원칙이면' 칸 — 지금 따르는 원칙을 뺀 나머지로 각각 계산한 이번 달 할 일. 순서는 고정(원칙 목록 순),
    좋고 나쁨을 매기지 않는다(전략은 사용자가 정한다)."""
    from backend.plan import build, compare_notes
    from tools.assets import load_pools
    current = (load_pools(registration.accounts_path()).get(data.pool_id) or {}).get("strategy") or "all_weather"
    ids = [sid for sid in CHOICES if sid != current]
    base, r_cur, alts = _what_if(PreviewInput(pool_id=data.pool_id, strategy_id=current, owner=data.owner, live=data.live, cash=data.cash), ids)
    options = []
    for a in alts:
        sid, r = a["strategy_id"], a["result"]
        item = {"strategy_id": sid, "name": _name(sid)}
        if a["error"] or r is None:
            no_ratio = "비율" in (a["error"] or "")
            item.update(ready=False, reason=("비율을 아직 넣지 않았어요" if sid == "custom" else "비율을 아직 정하지 않았어요") if no_ratio else (a["error"] or "계산할 수 없어요"))
        else:
            item.update(ready=True, plan=build(r, base["mode"]), notes=compare_notes(r_cur, r, _name(sid)) if r_cur else [])
        options.append(item)
    return {"pool_id": data.pool_id, "current_id": current, "options": options}


@router.post("/portfolio/custom")
def custom_api(data: CustomInput):
    bad = [k for k in data.targets if k not in ASSET_CLASSES]
    if bad:
        raise HTTPException(422, "모르는 자산군: " + ", ".join(bad))
    try:
        set_custom_targets(data.targets, note="리밸런싱 시트에서 사용자가 저장")
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    text = " / ".join(f"{CLASS_LABELS.get(k, k)} {v:g}" for k, v in data.targets.items() if v)
    line = _record(f"직접 설정 비율 저장: {text}", "리밸런싱 시트에서 사용자가 입력")
    out = {"saved": True, "line": line}
    if data.pool_id:
        out["follow"] = follow(data.pool_id, "custom")
    return out


def _record(text: str, reason: str) -> str:
    path = decisions_path()
    if not path.exists():
        path.write_text("# DECISIONS\n", encoding="utf-8")
    return record_decision(text, reason, path=path)
