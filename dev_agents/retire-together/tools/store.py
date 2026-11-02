"""store — 보유 내역 저장소 (파일). 계좌마다 따로 저장하고, 읽을 때는 계좌별 최신 파일을 합친다.

data/snapshots/<account_id>/<YYYY-MM-DD>.csv  ← 입력 화면·register가 쓴다
스냅샷이 없는 계좌는 data/samples/**/holdings_parsed_*.csv, balance_*.csv에서 찾는다 (초기 자료).
PoC는 파일만, SQLite는 v1.5 (docs/DECISIONS.md).
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOTS = ROOT / "data" / "snapshots"
SAMPLES = ROOT / "data" / "samples"


def _read(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, encoding="utf-8-sig", dtype={"ticker": str})


def save_holdings(account_id: str, df: pd.DataFrame, on: dt.date | None = None,
                  accounts: dict[str, dict] | None = None) -> Path:
    """계좌의 보유 내역을 스냅샷으로 저장. SAFE-01: 계좌 ID는 등록된 활성 계좌만(경로 문자 금지), 빈 표·잘못된 행은 거부,
    스냅샷 폴더 밖에는 쓰지 않는다. accounts를 안 주면 rules/accounts.yaml을 읽는다."""
    from tools.assets import load_accounts
    from tools.parse_balance import ACCOUNT_ID_RE, validate_holdings

    if not isinstance(account_id, str) or not ACCOUNT_ID_RE.match(account_id):
        raise ValueError(f"계좌 ID 형식 오류: {account_id!r} (영문·숫자·밑줄만)")
    accts = load_accounts() if accounts is None else accounts
    if account_id not in accts:
        raise ValueError(f"등록되지 않은 계좌: {account_id} (rules/accounts.yaml 또는 설정 화면에서 먼저 등록)")
    if accts[account_id].get("active", True) is False:
        raise ValueError(f"사용 안 함으로 표시된 계좌: {account_id}")
    if "account_id" not in df:
        df = df.assign(account_id=account_id)
    mine = df[df["account_id"] == account_id]
    if len(mine) == 0:
        raise ValueError(f"계좌 {account_id}에 저장할 행이 없음 (표의 account_id가 다른 계좌인지 확인)")
    others = sorted(str(a) for a in df.loc[df["account_id"] != account_id, "account_id"].unique())
    if others:  # SAFE-02: 다른 계좌 행이 섞인 표는 조용히 걸러 저장하지 않는다 — 계좌 전환 뒤 이전 표를 저장하는 실수 차단
        raise ValueError(f"계좌 {account_id} 저장 거부: 다른 계좌 행 포함 ({', '.join(others)}). 계좌별로 나눠 저장")
    df = mine
    errors = validate_holdings(df)
    if errors:
        raise ValueError("저장 거부:\n" + "\n".join(errors))
    on = on or dt.date.today()
    base = SNAPSHOTS.resolve()
    out = (base / account_id / f"{on.isoformat()}.csv").resolve()
    if base not in out.parents:
        raise ValueError(f"스냅샷 폴더 밖 경로: {out}")
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, index=False, encoding="utf-8-sig")
    return out


def _rel(p: Path) -> str:
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


def snapshot_history(account_id: str) -> list[Path]:
    """그 계좌의 스냅샷 파일 전부 (오래된 순). 같은 날 다시 등록하면 그날 파일을 덮어쓴다."""
    d = SNAPSHOTS / account_id
    return sorted(d.glob("*.csv")) if d.exists() else []


def latest_snapshot(account_id: str) -> Path | None:
    d = SNAPSHOTS / account_id
    files = sorted(d.glob("*.csv")) if d.exists() else []
    return files[-1] if files else None


def _sample_rows(account_id: str) -> pd.DataFrame | None:
    cands = sorted(SAMPLES.glob("**/holdings_parsed_*.csv")) + sorted(SAMPLES.glob("**/balance_*.csv"))
    for p in sorted(cands, key=lambda c: c.stat().st_mtime, reverse=True):
        df = _read(p)
        rows = df[df["account_id"] == account_id]
        if len(rows):
            return rows
    return None


def load_holdings(account_ids: list[str]) -> tuple[pd.DataFrame, dict[str, str]]:
    """계좌별 최신 보유 내역을 합쳐 돌려준다. 두 번째 값은 계좌 → 출처(파일 경로 또는 '없음')."""
    frames, sources = [], {}
    for acct in account_ids:
        p = latest_snapshot(acct)
        if p is not None:
            frames.append(_read(p)); sources[acct] = _rel(p)
            continue
        rows = _sample_rows(acct)
        if rows is not None:
            frames.append(rows); sources[acct] = "data/samples (초기 자료)"
        else:
            sources[acct] = "없음"
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=["account_id", "ticker_name", "ticker", "qty", "price"])
    if len(df):
        df["qty"] = df["qty"].astype(int); df["price"] = df["price"].astype(int)
    return df, sources
