"""tag_assets — 종목 → 자산군 태그. rules/asset_map.yaml이 원천.

미등록 종목은 여기서 분류하지 않는다 (LLM 제안 → 사용자 확인 → YAML 저장은 Agent 단계).
제도 제약 검증(연금저축: 레버리지·인버스 불가)도 여기서 한다 — deterministic.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
ASSET_MAP_PATH = ROOT / "rules" / "asset_map.yaml"
ACCOUNTS_PATH = ROOT / "rules" / "accounts.yaml"

# 연금저축·IRP에서 담을 수 없는 상품의 이름 패턴 (KRX 상장 ETF 명명 규칙 기준)
LEVERAGE_INVERSE_PATTERN = re.compile(r"레버리지|인버스|2X|3X|곱버스|-1X|-2X", re.IGNORECASE)


@dataclass(frozen=True)
class ConstraintResult:
    name: str
    passed: bool
    detail: str


def load_asset_map(path: Path = ASSET_MAP_PATH) -> dict[str, dict]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return data.get("assets") or {}


def load_class_defaults(path: Path = ASSET_MAP_PATH) -> dict[str, dict]:
    """자산군 → 기본 종목 {ticker, name, status, alternatives}. 보유 없는 자산군을 살 때 쓴다."""
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return data.get("class_defaults") or {}


def load_accounts(path: Path = ACCOUNTS_PATH) -> dict[str, dict]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {a["id"]: a for a in data.get("accounts", [])}


def load_pools(path: Path = ACCOUNTS_PATH) -> dict[str, dict]:
    """pool id → {label, strategy, accounts: [account ids]}. 풀 = 리밸런싱 단위."""
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    pools = {k: dict(v, accounts=[]) for k, v in (data.get("pools") or {}).items()}
    for a in data.get("accounts", []):
        pid = a.get("pool")
        if pid:
            pools.setdefault(pid, {"label": pid, "strategy": None, "accounts": []})["accounts"].append(a["id"])
    return pools


def tag_holdings(holdings: pd.DataFrame, asset_map: dict[str, dict] | None = None) -> tuple[pd.DataFrame, list[str]]:
    """holdings에 asset_class 열을 붙인다. 매핑에 없는 종목명 목록을 함께 돌려준다.

    매핑 키는 종목명(캡처에 보이는 이름). 티커로도 찾는다.
    """
    amap = load_asset_map() if asset_map is None else asset_map
    by_ticker = {v.get("ticker"): v for v in amap.values() if v.get("ticker")}
    out = holdings.copy()
    classes, roles, unmapped = [], [], []
    for _, row in out.iterrows():
        entry = amap.get(row["ticker_name"]) or by_ticker.get(str(row.get("ticker", "")))
        if entry is None:
            classes.append(None); roles.append("core")
            unmapped.append(row["ticker_name"])
        else:
            classes.append(entry["asset_class"]); roles.append(entry.get("role", "core"))
    out["asset_class"] = classes
    out["role"] = roles
    return out, sorted(set(unmapped))


def check_constraints(holdings: pd.DataFrame, accounts: dict[str, dict] | None = None) -> list[ConstraintResult]:
    """계좌 종류별 제도 제약. 하나라도 실패하면 주문표를 만들지 않는다."""
    accts = load_accounts() if accounts is None else accounts
    results: list[ConstraintResult] = []

    # SAFE-01: 계좌 목록에 없거나 '사용 안 함'인 계좌의 보유분으로는 주문표를 만들지 않는다 (계좌 종류를 모르면 제도 검사가 빠진다)
    ids = [str(a) for a in holdings["account_id"].unique()]
    unknown = [a for a in ids if a not in accts]
    inactive = [a for a in ids if a in accts and accts[a].get("active", True) is False]
    if unknown or inactive:
        detail = []
        if unknown:
            detail.append("미등록 " + ", ".join(unknown))
        if inactive:
            detail.append("사용 안 함 " + ", ".join(inactive))
        results.append(ConstraintResult("계좌 등록·사용 중", False, " · ".join(detail)))
    else:
        results.append(ConstraintResult("계좌 등록·사용 중", True, "통과"))

    bad = holdings[holdings["ticker_name"].str.contains(LEVERAGE_INVERSE_PATTERN)]
    pension_bad = bad[bad["account_id"].map(lambda a: accts.get(a, {}).get("account_type") in ("pension_savings", "irp"))]
    if len(pension_bad):
        names = ", ".join(pension_bad["ticker_name"].unique())
        results.append(ConstraintResult("연금계좌 레버리지·인버스 없음", False, f"연금저축/IRP 불가 종목: {names}"))
    else:
        results.append(ConstraintResult("연금계좌 레버리지·인버스 없음", True, "통과"))

    untagged = holdings[holdings["asset_class"].isna()] if "asset_class" in holdings else holdings
    if len(untagged):
        results.append(ConstraintResult("모든 종목 자산군 태깅", False, "미분류: " + ", ".join(untagged["ticker_name"].unique())))
    else:
        results.append(ConstraintResult("모든 종목 자산군 태깅", True, "통과"))

    # IRP 위험자산 70% 한도 — IRP 계좌가 활성화되면 검증 (회의 후). 지금은 항목만 둔다
    return results


def candidate_confirmed(ticker, name, asset_class: str, asset_map: dict[str, dict]) -> bool:
    """후보 종목이 rules/asset_map.yaml assets에 '확인됨(confirmed)'으로 있고 종목코드·자산군이 맞는가 (SAFE-02).
    사용자가 확인한 매핑만 수량 계산에 쓴다. 제안(proposed)·미등록·분류 불일치는 False."""
    entry = asset_map.get(name) if name else None
    if entry is None and ticker is not None:
        entry = next((v for v in asset_map.values() if str(v.get("ticker")) == str(ticker)), None)
    if not entry:
        return False
    return (entry.get("status") == "confirmed" and str(entry.get("ticker")) == str(ticker)
            and entry.get("asset_class") == asset_class)


def check_candidates(defaults: dict[str, dict], targets: dict, account_ids: list[str],
                     accounts: dict[str, dict] | None = None) -> ConstraintResult:
    """신규 매수 후보(보유 없는 자산군을 살 기본 종목)에도 제도 제약을 적용한다 (SAFE-02, ARCHITECTURE_REVIEW §4 P0).
    연금저축/IRP 계좌가 있으면 레버리지·인버스 이름의 후보를 거부하고, 종목코드 형식(6자리)도 검사한다."""
    from tools.strategy import TICKER_RE
    accts = load_accounts() if accounts is None else accounts
    pension = [a for a in account_ids if accts.get(a, {}).get("account_type") in ("pension_savings", "irp")]
    problems = []
    for cls, d in (defaults or {}).items():
        if cls not in targets or not d or not d.get("ticker"):
            continue
        name = str(d.get("name") or d["ticker"])
        if not TICKER_RE.match(str(d["ticker"])):
            problems.append(f"{name} 종목코드 형식 오류 ({d['ticker']!r})")
        if pension and LEVERAGE_INVERSE_PATTERN.search(name):
            problems.append(f"{name} 연금저축/IRP 불가 (레버리지·인버스)")
    if problems:
        return ConstraintResult("신규 매수 후보 적격", False, " · ".join(problems))
    return ConstraintResult("신규 매수 후보 적격", True, "통과")


def defaults_with_prices(holdings: pd.DataFrame, live: bool = True, instruments: dict[str, dict] | None = None,
                         asset_map: dict[str, dict] | None = None) -> dict[str, dict]:
    """기본 종목에 현재가를 붙인다. 전략이 지정한 종목(strategies.yaml instruments)이 있으면 그것, 없으면 asset_map class_defaults (REBALANCING §1-2).
    보유 중인 종목이면 보유 가격, 아니면 공개 시세(live) 조회. 실패하면 price 없음.
    confirmed: asset_map assets에 확인됨으로 등록된 후보인가 (SAFE-02). False면 엔진이 수량 대신 금액만 보여 준다."""
    out = {}
    held = {str(t): int(p) for t, p in zip(holdings.get("ticker", []), holdings.get("price", []))}
    amap = load_asset_map() if asset_map is None else asset_map
    merged = dict(load_class_defaults())
    for cls, d in (instruments or {}).items():
        merged[cls] = dict(d, source="strategy")
    for cls, d in merged.items():
        entry = {"ticker": d.get("ticker"), "name": d.get("name"), "price": held.get(str(d.get("ticker"))), "source": d.get("source", "class_defaults"),
                 "confirmed": candidate_confirmed(d.get("ticker"), d.get("name"), cls, amap)}
        if entry["price"] is None and live and d.get("ticker"):
            try:
                from tools.market import fetch_price
                entry["price"] = fetch_price(d["ticker"])
            except Exception:
                entry["price"] = None
        out[cls] = entry
    return out


ACCOUNTS_HEADER = """# 계좌 목록 — 워크플로우 0단계 (docs/AGENT_DESIGN.md §1). 설정 화면에서 저장하면 이 파일이 다시 쓰인다.
# owner: me | spouse · broker: mirae | kiwoom | kis · account_type: pension_savings | irp | isa | general
# pocket: pension | cash · layer: 1 국민연금 2 퇴직연금 3 개인연금 4 ISA (현금 주머니는 null)
# pool: 리밸런싱 단위. 같은 pool = 합산, 계좌 하나만 = 계좌별. pools: 풀마다 strategy(전략)와 mode(rebalance | buy_only)
"""


def save_accounts(accounts: list[dict], pools: dict[str, dict], path: Path = ACCOUNTS_PATH) -> None:
    """설정 화면에서 바꾼 계좌·풀을 accounts.yaml에 쓴다. pools의 accounts 목록은 계좌의 pool 값에서 파생되므로 저장하지 않는다."""
    clean_pools = {k: {kk: vv for kk, vv in v.items() if kk != "accounts"} for k, v in pools.items()}
    body = yaml.safe_dump({"accounts": accounts, "pools": clean_pools}, allow_unicode=True, sort_keys=False)
    path.write_text(ACCOUNTS_HEADER + body, encoding="utf-8")


def load_accounts_list(path: Path = ACCOUNTS_PATH) -> list[dict]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return list(data.get("accounts", []))


ASSET_MAP_HEADER = """# 종목 ↔ 자산군 매핑 — 비중 계산에 쓰이는 분류의 단일 원천. 입력 화면에서 저장하면 이 파일이 다시 쓰인다.
# asset_class: stock / long_bond / mid_bond / gold / commodity / cash · role: core(핵심) | satellite(위성, 테마) · status: proposed | confirmed
# class_defaults: 자산군 기본 종목 (보유 없는 자산군을 살 때). 선택 규칙은 docs/REBALANCING_RULES.md §1-2
"""


def save_asset_map(assets: dict[str, dict], class_defaults: dict[str, dict] | None = None, path: Path = ASSET_MAP_PATH) -> None:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    data["assets"] = assets
    if class_defaults is not None:
        data["class_defaults"] = class_defaults
    path.write_text(ASSET_MAP_HEADER + yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")


# 주식 안의 구분 — 화면에서 주식 묶음을 나눠 보기 위한 꼬리표. 리밸런싱은 계속 stock 하나로 맞춘다 (2026-10-28 사용자).
STOCK_GROUPS = {"kr": "국내", "us": "미국", "em": "신흥국·테마", "income": "배당·리츠"}
_STOCK_GROUP_HINTS = [("income", ("배당", "리츠", "인프라", "커버드콜", "고배당")),
                      ("us", ("미국", "S&P", "나스닥", "NASDAQ", "다우", "US")),
                      ("em", ("차이나", "중국", "인도", "베트남", "신흥", "휴머노이드", "로봇", "2차전지", "반도체", "AI", "테마")),
                      ("kr", ("200", "코스피", "KOSPI", "코스닥", "KOSDAQ", "KRX300", "국내"))]


def guess_stock_group(name: str) -> str | None:
    """종목명으로 주식 구분을 추측한다 (사용자가 확인·변경). 모르면 None."""
    up = str(name or "").upper()
    for key, words in _STOCK_GROUP_HINTS:
        if any(w.upper() in up for w in words):
            return key
    return None


def upsert_asset_tags(rows: list[dict], path: Path = ASSET_MAP_PATH) -> int:
    """rows: [{ticker_name, ticker, asset_class, role}] → asset_map에 confirmed로 넣거나 갱신. 바뀐 개수 반환."""
    amap = load_asset_map(path)
    changed = 0
    for r in rows:
        name = r["ticker_name"]
        if not r.get("asset_class"):
            continue
        cur = amap.get(name, {})
        new = dict(cur, ticker=str(r.get("ticker") or cur.get("ticker") or ""), asset_class=r["asset_class"],
                   role=r.get("role") or cur.get("role", "core"), status="confirmed")   # role을 안 주면 기존 값 유지
        if r["asset_class"] == "stock" and r.get("stock_group") in STOCK_GROUPS:
            new["stock_group"] = r["stock_group"]
        elif r["asset_class"] != "stock":
            new.pop("stock_group", None)
        if new != cur:
            amap[name] = new; changed += 1
    if changed:
        save_asset_map(amap, path=path)
    return changed


def set_pool_mode(account_id: str, mode: str, path: Path = ACCOUNTS_PATH) -> str:
    """계좌가 속한 풀의 모드를 바꾼다. 풀이 없으면 계좌 id로 풀을 만든다. 풀 id 반환."""
    accounts = load_accounts_list(path)
    pools = load_pools(path)
    acct = next(a for a in accounts if a["id"] == account_id)
    pid = acct.get("pool") or account_id
    acct["pool"] = pid
    pools.setdefault(pid, {"label": acct.get("label", pid), "strategy": "all_weather", "accounts": [account_id]})
    pools[pid]["mode"] = mode
    save_accounts(accounts, pools, path)
    return pid
