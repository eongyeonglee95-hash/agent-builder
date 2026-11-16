"""키움 REST API로 일반(주식) 계좌 잔고를 읽어 보유 표로 바꾼다. 조회만 한다 — 주문 TR은 부르지 않는다.

키는 .env 의 KIWOOM_APPKEY / KIWOOM_SECRETKEY (키움 OpenAPI 포털에서 발급, 발급 때 등록한 IP에서만 통한다).
KIWOOM_MOCK=1 이면 모의투자 서버(mockapi)를 쓴다. 근거·한도: docs/wiki/sources/broker-apis.md
- 토큰 au10001 POST /oauth2/token (유효 24시간 → 만료 전까지 메모리에 둔다)
- 잔고 kt00018 POST /api/dostk/acnt (qry_tp 1=합산, dmst_stex_tp KRX). 응답 숫자는 0채움·부호 포함 문자열
- 예수금 kt00001 POST /api/dostk/acnt (qry_tp 3=추정조회) → d2_entra(D+2 추정예수금: 결제 끝난 뒤 실제로 남는 현금)
- 미국 잔고 ust21070 POST /api/us/acnt (stex_tp "" = 전 거래소. ND/NY/NA를 넣으면 stk_cd가 필수가 된다 — 2026-11-16 실호출 확인)
  원화 환산값(now_pric_krw·frgn_stk_book_amt_krw·tot_evlt_amt_krw)을 쓴다. 외화 예수금은 ust21120 chg_entr(원화 환산)
- 연속조회: 응답 헤더 cont-yn=Y 면 next-key 를 실어 다시 부른다. 조회 TR 초당 5회 한도라 쪽마다 0.25초 쉰다
"""
from __future__ import annotations

import datetime as dt
import os
import time
from pathlib import Path

import pandas as pd
import requests

REAL = "https://api.kiwoom.com"
MOCK = "https://mockapi.kiwoom.com"
ROOT = Path(__file__).resolve().parents[1]
MAX_PAGES = 20

_token: dict = {}   # {"base", "appkey", "token", "expires"}


class KiwoomError(RuntimeError):
    """사용자에게 그대로 보여 줄 수 있는 한국어 메시지만 담는다 (키·토큰은 넣지 않는다)."""


def _env() -> dict[str, str]:
    """os.environ 우선, 없으면 .env 파일을 읽는다(서버를 다시 띄우지 않아도 키를 넣으면 바로 통하게)."""
    vals: dict[str, str] = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            k, sep, v = line.strip().partition("=")
            if sep and not k.startswith("#"):
                vals[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("KIWOOM_APPKEY", "KIWOOM_SECRETKEY", "KIWOOM_MOCK"):
        if os.environ.get(k):
            vals[k] = os.environ[k]
    return vals


def configured() -> bool:
    e = _env()
    return bool(e.get("KIWOOM_APPKEY") and e.get("KIWOOM_SECRETKEY"))


def num(s) -> int:
    """'000000000177000' · '-00000000196888' · '+59000' · '' → int. 가격은 등락 부호가 붙어 올 수 있어 호출하는 쪽에서 abs."""
    s = str(s or "").strip().replace(",", "")
    if not s:
        return 0
    sign = -1 if s.startswith("-") else 1
    digits = s.lstrip("+-").split(".")[0]
    return sign * int(digits or 0)


def holdings_from_balance(body: dict, account_id: str = "", us: dict | None = None) -> tuple[pd.DataFrame, dict]:
    """kt00018 응답(여러 쪽이면 목록을 이어 붙인 것)과 ust21070 미국 잔고 → (account_id, ticker_name, ticker, qty, price, buy_value, stock_group) 표와 메타.
    같은 종목이 신용·현금 줄로 나뉘어 와도 한 줄로 합친다(수량·매입금액 합, 현재가는 그대로).
    미국 종목은 원화 환산 현재가·매입금액, 종목코드는 비운다(종목코드 칸은 KRX 6자리 전용) — 이름 뒤에 티커를 붙여 구분."""
    merged: dict[str, dict] = {}
    for r in body.get("acnt_evlt_remn_indv_tot") or []:
        qty = num(r.get("rmnd_qty"))
        if qty <= 0:
            continue
        code = str(r.get("stk_cd") or "").strip()
        ticker = code[1:] if len(code) == 7 and code[0].isalpha() else code
        name = str(r.get("stk_nm") or "").strip() or ticker
        price = abs(num(r.get("cur_prc")))
        row = merged.setdefault(ticker or name, {"account_id": account_id, "ticker_name": name, "ticker": ticker or None,
                                                 "qty": 0, "price": price, "buy_value": 0, "stock_group": None})
        row["qty"] += qty
        row["buy_value"] += num(r.get("pur_amt"))
    for r in (us or {}).get("result_list") or []:
        qty = num(r.get("poss_qty"))
        if qty <= 0:
            continue
        code = str(r.get("stk_cd") or "").strip().upper()
        name = f"{str(r.get('frgn_stk_nm') or '').strip() or code} ({code})" if code else str(r.get("frgn_stk_nm") or "").strip()
        row = merged.setdefault(f"us:{code or name}", {"account_id": account_id, "ticker_name": name, "ticker": None, "qty": 0,
                                                       "price": abs(num(r.get("now_pric_krw"))), "buy_value": 0, "stock_group": "us"})
        row["qty"] += qty
        row["buy_value"] += num(r.get("frgn_stk_book_amt_krw"))
    df = pd.DataFrame(list(merged.values()), columns=["account_id", "ticker_name", "ticker", "qty", "price", "buy_value", "stock_group"])
    for col in ("ticker", "stock_group"):   # pandas 문자열 열은 None을 NaN으로 바꾼다 — JSON·검증에 None으로 넘긴다
        df[col] = df[col].astype(object).where(df[col].notna(), None)
    total = abs(num(body.get("tot_evlt_amt"))) + abs(num((us or {}).get("tot_evlt_amt_krw")))
    computed = int((df["qty"] * df["price"]).sum()) if len(df) else 0
    meta = {"screen_total_value": total or None, "verified": bool(total), "reconciled": bool(total) and abs(computed - total) <= 5000,
            "diff": computed - total if total else 0, "value_diff": None, "errors": [], "unresolved": []}
    return df, meta


def _base() -> str:
    return MOCK if _env().get("KIWOOM_MOCK", "").strip() in ("1", "true", "yes") else REAL


def _post(url: str, headers: dict, body: dict, retry: bool = True) -> requests.Response:
    try:
        resp = requests.post(url, headers={"Content-Type": "application/json;charset=UTF-8", **headers}, json=body, timeout=15)
    except requests.RequestException:
        raise KiwoomError("키움 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.") from None
    try:
        data = resp.json()
    except ValueError:
        data = {}
    code = data.get("return_code", 0 if resp.ok else None)
    msg = str(data.get("return_msg") or resp.reason or "").strip()[:200]
    if (not resp.ok or code not in (0, "0", None)) and any(c in msg for c in ("1700", "1701", "1702")):
        if retry:   # 초당 호출 한도 — 1초 쉬고 한 번만 다시
            time.sleep(1.1)
            return _post(url, headers, body, retry=False)
        raise KiwoomError("키움 API 호출 한도에 걸렸어요. 잠시 뒤 다시 불러와 주세요.")
    if not resp.ok or code not in (0, "0", None):
        raise KiwoomError(f"키움 API 오류: {msg or resp.status_code}. 앱키·시크릿키와 등록한 IP(지금 이 컴퓨터의 공인 IP)를 확인해 주세요.")
    return resp


def token() -> str:
    e = _env()
    appkey, secret = e.get("KIWOOM_APPKEY", ""), e.get("KIWOOM_SECRETKEY", "")
    if not (appkey and secret):
        raise KiwoomError("키움 앱키가 없어요. .env 에 KIWOOM_APPKEY 와 KIWOOM_SECRETKEY 를 넣어 주세요.")
    base = _base()
    now = dt.datetime.now()
    if _token.get("base") == base and _token.get("appkey") == appkey and _token.get("expires", now) > now + dt.timedelta(minutes=5):
        return _token["token"]
    data = _post(f"{base}/oauth2/token", {}, {"grant_type": "client_credentials", "appkey": appkey, "secretkey": secret}).json()
    tok = data.get("token")
    if not tok:
        raise KiwoomError("키움 접근토큰을 받지 못했어요. 앱키·시크릿키를 확인해 주세요.")
    try:
        expires = dt.datetime.strptime(str(data.get("expires_dt")), "%Y%m%d%H%M%S")
    except ValueError:
        expires = now + dt.timedelta(hours=23)
    _token.update(base=base, appkey=appkey, token=tok, expires=expires)
    return tok


def fetch_balance() -> dict:
    """kt00018 을 연속조회까지 모두 불러 종목 목록을 이어 붙인 응답 하나로 돌려준다."""
    tok, base = token(), _base()
    out: dict = {}
    rows: list[dict] = []
    headers = {"api-id": "kt00018", "authorization": f"Bearer {tok}"}
    for page in range(MAX_PAGES):
        resp = _post(f"{base}/api/dostk/acnt", headers, {"qry_tp": "1", "dmst_stex_tp": "KRX"})
        data = resp.json()
        if not out:
            out = {k: v for k, v in data.items() if k != "acnt_evlt_remn_indv_tot"}
        rows += data.get("acnt_evlt_remn_indv_tot") or []
        if resp.headers.get("cont-yn") != "Y" or not resp.headers.get("next-key"):
            break
        headers = {**headers, "cont-yn": "Y", "next-key": resp.headers["next-key"]}
        time.sleep(0.25)
    out["acnt_evlt_remn_indv_tot"] = rows
    return out


def fetch_deposit() -> int:
    """D+2 추정예수금(원). 미수로 음수면 0 — 현금 주머니에 빚을 넣지 않는다."""
    data = _post(f"{_base()}/api/dostk/acnt", {"api-id": "kt00001", "authorization": f"Bearer {token()}"}, {"qry_tp": "3"}).json()
    return max(0, num(data.get("d2_entra")))


def _fetch_all(api_id: str, path: str, body: dict, list_key: str) -> dict:
    """연속조회(cont-yn·next-key)까지 이어 붙인 응답 하나."""
    tok, base = token(), _base()
    out: dict = {}
    rows: list[dict] = []
    headers = {"api-id": api_id, "authorization": f"Bearer {tok}"}
    for _ in range(MAX_PAGES):
        resp = _post(f"{base}{path}", headers, body)
        data = resp.json()
        if not out:
            out = {k: v for k, v in data.items() if k != list_key}
        rows += data.get(list_key) or []
        if resp.headers.get("cont-yn") != "Y" or not resp.headers.get("next-key"):
            break
        headers = {**headers, "cont-yn": "Y", "next-key": resp.headers["next-key"]}
        time.sleep(0.25)
    out[list_key] = rows
    return out


def fetch_us_balance() -> dict:
    """미국 주식 보유(ust21070, 전 거래소)."""
    return _fetch_all("ust21070", "/api/us/acnt", {"stex_tp": ""}, "result_list")


def fetch_us_cash() -> int:
    """외화 예수금의 원화 환산 합(ust21120 chg_entr)."""
    data = _post(f"{_base()}/api/us/acnt", {"api-id": "ust21120", "authorization": f"Bearer {token()}"}, {}).json()
    return max(0, sum(num(r.get("chg_entr")) for r in data.get("result_list") or []))
