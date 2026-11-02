"""load_strategy — rules/strategies.yaml에서 전략(목표 비율·임계치·최소 거래)과 가정 하락장을 읽는다.

비율 숫자의 단일 원천은 YAML이다 (docs/REBALANCING_RULES.md §1).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
STRATEGIES_PATH = ROOT / "rules" / "strategies.yaml"

ASSET_CLASSES = ("stock", "long_bond", "mid_bond", "gold", "commodity", "cash")
CLASS_LABELS = {
    "stock": "주식", "long_bond": "장기채", "mid_bond": "중기채",
    "gold": "금", "commodity": "원자재", "cash": "현금",
}
TICKER_RE = re.compile(r"^[0-9A-Z]{6}$")   # KRX 종목코드. 주문표·매핑 키에 쓰이므로 형식을 고정
THRESHOLD_PP_MAX = 50.0
MIN_TRADE_KRW_MAX = 10**12


def _finite_number(v) -> bool:
    return not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(float(v))


def validate_strategy_fields(targets_pct: dict, threshold_pp=None, min_trade_krw=None, instruments: dict | None = None) -> list[str]:
    """전략 값의 오류 목록. 비어 있으면 통과 (SAFE-02: 합계만 보면 -10%+110%도 저장됐다).
    비율은 자산군 키가 알려진 것, 각 0~100의 유한한 수, 합 100. 임계치 0 초과 50 이하 %p. 최소 거래 0 이상 정수. 종목코드 6자리."""
    errors: list[str] = []
    if not targets_pct:
        errors.append("targets가 비어 있음 (직접 설정은 비율을 먼저 채워야 함)")
    else:
        unknown = [k for k in targets_pct if k not in ASSET_CLASSES]
        if unknown:
            errors.append(f"알 수 없는 자산군: {sorted(unknown)}")
        total = 0.0
        bad = False
        for k, v in targets_pct.items():
            if not _finite_number(v):
                errors.append(f"{k} 비율이 유한한 숫자가 아님: {v!r}"); bad = True; continue
            if not 0 <= float(v) <= 100:
                errors.append(f"{k} 비율 범위 밖 (0~100): {v}"); bad = True
            total += float(v)
        if not bad and abs(total - 100) > 1e-6:
            errors.append(f"비율 합계가 100이 아님: {total}")
    if threshold_pp is not None and (not _finite_number(threshold_pp) or not 0 < float(threshold_pp) <= THRESHOLD_PP_MAX):
        errors.append(f"임계치 범위 밖 (0 초과 {THRESHOLD_PP_MAX:g} 이하 %p): {threshold_pp!r}")
    if min_trade_krw is not None and (not _finite_number(min_trade_krw) or float(min_trade_krw) != int(min_trade_krw)
                                      or not 0 <= int(min_trade_krw) <= MIN_TRADE_KRW_MAX):
        errors.append(f"최소 거래 금액 범위 밖 (0 이상 정수, 최대 {MIN_TRADE_KRW_MAX:,}): {min_trade_krw!r}")
    for cls, d in (instruments or {}).items():
        t = d.get("ticker") if isinstance(d, dict) else None
        if t is not None and not TICKER_RE.match(str(t)):
            errors.append(f"{cls} 종목코드 형식 오류 (영문 대문자·숫자 6자리): {t!r}")
    return errors


@dataclass(frozen=True)
class Strategy:
    id: str
    name: str
    targets: dict[str, float]          # 자산군 → 목표 비중 (0~1, 합 1)
    threshold: float                   # 발동 임계치 (절대, 0.05 = ±5%p)
    min_trade_krw: int
    shock: dict[str, float] = field(default_factory=dict)  # 가정 하락장 수익률
    instruments: dict[str, dict] = field(default_factory=dict)  # 자산군 → 전략이 지정한 기본 종목 {ticker, name, type}. 없으면 asset_map class_defaults
    labels: dict[str, str] = field(default_factory=dict)        # 자산군 표시 이름 덮어쓰기 (예: 올웨더 gold → "금 (=원자재)"). 없으면 CLASS_LABELS


def load_strategy(strategy_id: str, path: Path = STRATEGIES_PATH) -> Strategy:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    raw = data["strategies"].get(strategy_id)
    if raw is None:
        raise KeyError(f"전략 '{strategy_id}' 이(가) {path.name}에 없음")
    targets_pct = raw.get("targets") or {}
    errors = validate_strategy_fields(targets_pct, threshold_pp=raw.get("threshold_pp", 5), min_trade_krw=raw.get("min_trade_krw", 100_000),
                                      instruments=raw.get("instruments") or {})
    if errors:
        raise ValueError(f"전략 '{strategy_id}' 값 오류: " + " / ".join(errors))
    return Strategy(
        id=strategy_id,
        name=raw.get("name", strategy_id),
        targets={k: v / 100.0 for k, v in targets_pct.items()},
        threshold=float(raw.get("threshold_pp", 5)) / 100.0,
        min_trade_krw=int(raw.get("min_trade_krw", 100_000)),
        shock={k: float(v) for k, v in (data.get("shock") or {}).items()},
        instruments={k: dict(v) for k, v in (raw.get("instruments") or {}).items() if v and v.get("ticker")},
        labels={k: str(v) for k, v in (raw.get("labels") or {}).items()},
    )


def class_label(cls: str, strategy: "Strategy | None" = None) -> str:
    """자산군 표시 이름: 전략 labels → CLASS_LABELS → 키 그대로."""
    if strategy and cls in strategy.labels:
        return strategy.labels[cls]
    return CLASS_LABELS.get(cls, cls)


def list_strategies(path: Path = STRATEGIES_PATH) -> list[tuple[str, str]]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return [(k, v.get("name", k)) for k, v in data["strategies"].items()]


def save_targets(strategy_id: str, targets_pct: dict[str, float], path: Path = STRATEGIES_PATH,
                 threshold_pp: float | None = None, source: str | None = None) -> None:
    """화면에서 입력한 비율을 YAML에 쓴다 (항목별 범위·자산군·합 100·임계치 검증). 주석은 유지하지 않으므로 머리 주석을 다시 붙인다."""
    errors = validate_strategy_fields(targets_pct, threshold_pp=threshold_pp)
    if errors:
        raise ValueError("전략 저장 거부: " + " / ".join(errors))
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    raw = data["strategies"].setdefault(strategy_id, {"name": strategy_id, "threshold_pp": 5, "min_trade_krw": 100000})
    raw["targets"] = {k: float(v) for k, v in targets_pct.items() if v}
    if threshold_pp is not None:
        raw["threshold_pp"] = float(threshold_pp)
    if source is not None:
        raw["source"] = source
    header = "# 전략 템플릿 — 비율 숫자의 단일 원천 (docs/REBALANCING_RULES.md §1). 화면 '비율 편집'에서 저장하면 이 파일이 다시 쓰인다.\n# 합계는 반드시 100. 사용자가 선택·수정한다. Agent는 바꾸지 않는다. shock: 설명용 가정 하락장 (CALCULATION_RULES §3)\n# instruments: 전략이 정한 자산군별 기본 종목(ticker 있으면 asset_map class_defaults보다 우선, REBALANCING §1-2)\n"
    path.write_text(header + yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")


def has_targets(strategy_id: str, path: Path = STRATEGIES_PATH) -> bool:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return bool((data["strategies"].get(strategy_id) or {}).get("targets"))
