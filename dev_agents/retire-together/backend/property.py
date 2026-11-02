"""property — 부동산 메뉴의 집 등록·수정·조회 (PROPERTY-02, Claude 담당).

집 한 채를 한 번에 저장한다: 장부(`/api/assets`와 같은 storage)에는 집 금액·연결 대출·임대보증금이
각각 자산/대출 행으로 들어가고(그래서 홈·우리 자산·엑셀 보고서 합계에 그대로 잡힌다), 주소·산 가격·
거주 형태·대출 연결 같은 집 정보는 같은 SQLite의 `property_detail` 표에 둔다.

- GET    /api/property?owner=     집 목록 + 연결 대출·보증금 + 지표(tools.property) + 연결 안 된 대출
- POST   /api/property            새 집 (request_id로 재시도 안전)
- PUT    /api/property/{asset_id} 집 수정 (자산 version + 집 정보 version 검사)
- DELETE /api/property/{asset_id}?version=  집과 그 집의 보증금 행 삭제. 연결 대출은 남긴다
"""
from __future__ import annotations

import datetime as dt
import json
from typing import Annotated, Literal
from uuid import UUID, uuid5

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import Field, model_validator

from backend import storage
from backend.storage import InputModel, Money
from tools.property import asking_summary, dong_of, home_metrics, match_trades, parse_trades, pyeong

router = APIRouter(prefix="/api/property", tags=["property"])
from backend.property_market import router as market_router
router.include_router(market_router)

Share = Annotated[int, Field(strict=True, ge=1, le=99)]
Text = Annotated[str, Field(max_length=200)]


class Address(InputModel):
    road: Text = ""                 # 도로명 주소
    jibun: Text = ""                # 지번 주소
    building: Text = ""             # 단지·건물 이름
    bcode: Annotated[str, Field(pattern=r"^\d{10}$")] | None = None        # 법정동 코드 (실거래가 연결용)
    sigungu_code: Annotated[str, Field(pattern=r"^\d{5}$")] | None = None
    zonecode: Annotated[str, Field(pattern=r"^\d{5}$")] | None = None
    apartment: bool = False


class NewLoan(InputModel):
    name: Annotated[str, Field(min_length=1, max_length=100)]
    amount: Money


class HomeInput(InputModel):
    name: Annotated[str, Field(min_length=1, max_length=100)]
    owner: Literal["me", "partner", "joint"]
    share_percent: Share | None = None
    value: Money | None = None                     # 지금 시세 (전체). 비우면 새 집은 최근 실거래가 → 산 가격 순으로 자동, 수정은 그대로 둔다
    as_of: dt.date = Field(default_factory=dt.date.today)
    address: Address | None = None
    area_m2: Annotated[float, Field(gt=0, le=2000)] | None = None
    purchase_price: Money | None = None
    purchase_month: Annotated[str, Field(pattern=r"^(19|20)\d{2}-(0[1-9]|1[0-2])$")] | None = None
    tenure: Literal["live", "jeonse", "monthly", "other"] = "live"
    deposit: Money | None = None                   # 세입자에게 돌려줄 보증금
    monthly_rent: Money | None = None
    loan_ids: list[UUID] = []
    new_loans: Annotated[list[NewLoan], Field(max_length=5)] = []

    @model_validator(mode="after")
    def consistent(self):
        if (self.owner == "joint") != (self.share_percent is not None):
            raise ValueError("공동 명의일 때만 내 지분을 입력해 주세요")
        if self.as_of > dt.date.today():
            raise ValueError("기준일은 미래일 수 없습니다")
        if self.purchase_month and self.purchase_month > dt.date.today().strftime("%Y-%m"):
            raise ValueError("산 날짜는 미래일 수 없습니다")
        if self.tenure in ("live", "other"):
            self.deposit = None
            self.monthly_rent = None
        if self.tenure == "jeonse":
            self.monthly_rent = None
        if len(set(self.loan_ids)) != len(self.loan_ids):
            raise ValueError("같은 대출을 두 번 연결할 수 없습니다")
        return self


class HomeCreate(HomeInput):
    request_id: UUID


class HomeUpdate(HomeInput):
    version: Annotated[int, Field(strict=True, ge=1)]          # 장부의 집 자산 version
    detail_version: Annotated[int, Field(strict=True, ge=0)]   # 집 정보 version (예전 등록은 0)


# ── 저장 ──────────────────────────────────────────────────────

def _table(conn) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS property_detail (asset_id TEXT PRIMARY KEY, payload TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL)")


def _details() -> dict[str, dict]:
    with storage.connection() as conn:
        _table(conn)
        return {r["asset_id"]: {**json.loads(r["payload"]), "version": r["version"], "updated_at": r["updated_at"]}
                for r in conn.execute("SELECT * FROM property_detail")}


def _write_detail(asset_id: str, payload: dict, expected: int) -> int:
    with storage.connection() as conn:
        _table(conn)
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT version FROM property_detail WHERE asset_id=?", (asset_id,)).fetchone()
        if (row["version"] if row else 0) != expected:
            raise HTTPException(409, "다른 화면에서 집 정보가 바뀌었어요. 새로고침 후 다시 확인해 주세요.")
        conn.execute("INSERT INTO property_detail VALUES (?, ?, ?, ?) ON CONFLICT(asset_id) DO UPDATE SET payload=excluded.payload, version=excluded.version, updated_at=excluded.updated_at",
                     (asset_id, json.dumps(payload, ensure_ascii=False), expected + 1, storage.now()))
    return expected + 1


def _ledger_payload(data: HomeInput, name: str, pocket: str, amount: int, as_of: dt.date | None = None) -> dict:
    return {"name": name, "account": data.name, "owner": data.owner, "pocket": pocket, "assetClass": pocket,
            "amount": amount, "as_of": as_of or data.as_of, "share_percent": data.share_percent}


def _auto_value(address: dict | None, name: str, area: float | None, purchase_price: int | None) -> tuple[int, dt.date, dict]:
    """시세를 입력받지 않을 때: 최근 12개월 같은 단지·면적 실거래 → 없으면 산 가격 → 없으면 0. 출처를 함께 남긴다."""
    if address and address.get("sigungu_code") and market_key():
        try:
            hits = recent_trades(address["sigungu_code"], address.get("building") or name, area, 12, dong_of(address.get("jibun")), address.get("jibun"))
        except HTTPException:
            hits = []
        if hits:
            t = hits[0]
            return t["price"], dt.date.fromisoformat(t["date"]), {"kind": "trade", "date": t["date"], "floor": t["floor"], "area": t["area"]}
    if purchase_price:
        return purchase_price, dt.date.today(), {"kind": "purchase"}
    return 0, dt.date.today(), {"kind": "none"}


def _check_loans(data: HomeInput, rows: list[dict], details: dict, home_id: str | None) -> None:
    by_id = {a["id"]: a for a in rows}
    taken = {lid: hid for hid, d in details.items() if hid != home_id for lid in d.get("loan_ids", [])}
    deposits = {d.get("deposit_asset_id") for d in details.values()}
    for lid in map(str, data.loan_ids):
        loan = by_id.get(lid)
        if not loan or loan["pocket"] != "debt" or lid in deposits:
            raise HTTPException(422, "연결하려는 대출을 장부에서 찾을 수 없어요. 새로고침 후 다시 골라 주세요.")
        if lid in taken:
            raise HTTPException(409, f"'{loan['name']}'은 이미 다른 집에 연결된 대출이에요.")


def _new_loans(data: HomeInput, seed: UUID) -> list[str]:
    ids = []
    for i, loan in enumerate(data.new_loans):
        created = storage.create_asset(storage.AssetCreate(**_ledger_payload(data, loan.name, "debt", loan.amount),
                                                           request_id=uuid5(seed, f"loan-{i}")))
        ids.append(created["id"])
    return ids


def _detail_payload(data: HomeInput, loan_ids: list[str], deposit_id: str | None) -> dict:
    keep = data.model_dump(mode="json", include={"address", "area_m2", "purchase_price", "purchase_month", "tenure", "deposit", "monthly_rent"})
    return {**keep, "loan_ids": loan_ids, "deposit_asset_id": deposit_id}


def create_home(data: HomeCreate) -> dict:
    rows, details = storage.list_assets(), _details()
    done = next((hid for hid, d in details.items() if d.get("request_id") == str(data.request_id)), None)
    if done:                           # 같은 요청의 재시도
        return get_home(done)
    _check_loans(data, rows, details, None)
    if data.value is None:
        value, as_of, source = _auto_value(data.model_dump(mode="json")["address"], data.name, data.area_m2, data.purchase_price)
    else:
        value, as_of, source = data.value, data.as_of, {"kind": "manual"}
    home = storage.create_asset(storage.AssetCreate(**_ledger_payload(data, data.name, "property", value, as_of), request_id=data.request_id))
    deposit_id = None
    if data.deposit:
        deposit_id = storage.create_asset(storage.AssetCreate(**_ledger_payload(data, f"{data.name} 임대보증금", "debt", data.deposit),
                                                              request_id=uuid5(data.request_id, "deposit")))["id"]
    loan_ids = [*map(str, data.loan_ids), *_new_loans(data, data.request_id)]
    _write_detail(home["id"], {**_detail_payload(data, loan_ids, deposit_id), "request_id": str(data.request_id), "value_source": source}, 0)
    return get_home(home["id"])


def update_home(asset_id: UUID, data: HomeUpdate) -> dict:
    hid = str(asset_id)
    rows, details = storage.list_assets(), _details()
    by_id = {a["id"]: a for a in rows}
    current = by_id.get(hid)
    if not current or current["pocket"] != "property":
        raise HTTPException(404, "등록된 집을 찾을 수 없습니다.")
    if (details.get(hid, {}).get("version", 0)) != data.detail_version:
        raise HTTPException(409, "다른 화면에서 집 정보가 바뀌었어요. 새로고침 후 다시 확인해 주세요.")
    _check_loans(data, rows, details, hid)
    if data.value is None:      # 시세는 건드리지 않음
        value, as_of, source = current["amount"], dt.date.fromisoformat(str(current["as_of"])), details.get(hid, {}).get("value_source")
    else:
        value, as_of, source = data.value, data.as_of, {"kind": "manual"}
    storage.update_asset(asset_id, storage.AssetUpdate(**_ledger_payload(data, data.name, "property", value, as_of),
                                                       version=data.version, parent_id=None))
    # 보증금 행: 생기면 만들고, 바뀌면 고치고, 없어지면 지운다
    deposit_id = details.get(hid, {}).get("deposit_asset_id")
    old_deposit = by_id.get(deposit_id) if deposit_id else None
    if data.deposit and old_deposit:
        storage.update_asset(UUID(deposit_id), storage.AssetUpdate(**_ledger_payload(data, f"{data.name} 임대보증금", "debt", data.deposit),
                                                                   version=old_deposit["version"]))
    elif data.deposit:
        seed = uuid5(asset_id, f"deposit-{data.detail_version}")
        deposit_id = storage.create_asset(storage.AssetCreate(**_ledger_payload(data, f"{data.name} 임대보증금", "debt", data.deposit), request_id=seed))["id"]
    else:
        if old_deposit:
            storage.delete_asset(UUID(deposit_id), old_deposit["version"])
        deposit_id = None
    loan_ids = [*map(str, data.loan_ids), *_new_loans(data, uuid5(asset_id, f"loans-{data.detail_version}"))]
    keep = {k: details[hid][k] for k in ("request_id", "listings") if details.get(hid, {}).get(k)}
    _write_detail(hid, {**_detail_payload(data, loan_ids, deposit_id), **keep, "value_source": source}, data.detail_version)
    return get_home(hid)


def delete_home(asset_id: UUID, version: int) -> None:
    hid = str(asset_id)
    rows = {a["id"]: a for a in storage.list_assets()}
    detail = _details().get(hid, {})
    deposit = rows.get(detail.get("deposit_asset_id") or "")
    storage.delete_asset(asset_id, version)
    if deposit:
        storage.delete_asset(UUID(deposit["id"]), deposit["version"])
    with storage.connection() as conn:
        _table(conn)
        conn.execute("DELETE FROM property_detail WHERE asset_id=?", (hid,))


# ── 조회 ──────────────────────────────────────────────────────

def _summary(home: dict, detail: dict | None, by_id: dict, owner: str) -> dict | None:
    mine = storage.scoped_asset(home, owner)
    if mine is None:
        return None
    detail = detail or {}
    loans = [by_id[i] for i in detail.get("loan_ids", []) if i in by_id]
    deposit = by_id.get(detail.get("deposit_asset_id") or "")
    as_of = dt.date.fromisoformat(str(home["as_of"]))
    full = home_metrics(home["amount"], detail.get("purchase_price"), detail.get("purchase_month"), as_of,
                        loans=sum(a["amount"] for a in loans), deposit=deposit["amount"] if deposit else 0)

    def scoped(a):
        s = storage.scoped_asset(a, owner)
        return s["amount"] if s else 0
    my_loans = sum(scoped(a) for a in loans)
    my_deposit = scoped(deposit) if deposit else 0
    ratio = mine["amount"] / home["amount"] if home["amount"] else 0
    return {
        "asset": home, "value": mine["amount"], "full_value": home["amount"],
        "detail": {**detail, "pyeong": pyeong(detail.get("area_m2"))} if detail else None,
        "asking": asking_summary(detail.get("listings", [])),
        "loans": [{"id": a["id"], "name": a["name"], "amount": a["amount"], "mine": scoped(a), "as_of": a["as_of"], "owner": a["owner"]} for a in loans],
        "deposit": {"id": deposit["id"], "amount": deposit["amount"], "mine": my_deposit} if deposit else None,
        "metrics": {**full, "gain_mine": round(full["gain"] * ratio) if full["gain"] is not None else None,
                    "loans_mine": my_loans, "deposit_mine": my_deposit, "equity_mine": mine["amount"] - my_loans - my_deposit},
    }


def list_homes(owner: str = "together") -> dict:
    rows, details = storage.list_assets(), _details()
    by_id = {a["id"]: a for a in rows}
    homes = [s for a in rows if a["pocket"] == "property" and not a["parent_id"]
             if (s := _summary(a, details.get(a["id"]), by_id, owner))]
    linked = {i for d in details.values() for i in [*d.get("loan_ids", []), d.get("deposit_asset_id")] if i}
    free = [{"id": a["id"], "name": a["name"], "amount": a["amount"], "owner": a["owner"], "as_of": a["as_of"]}
            for a in rows if a["pocket"] == "debt" and a["id"] not in linked]
    m = [h["metrics"] for h in homes]
    return {"homes": homes, "free_loans": free,
            "total": {"value": sum(h["value"] for h in homes), "loans": sum(x["loans_mine"] for x in m),
                      "deposit": sum(x["deposit_mine"] for x in m), "equity": sum(x["equity_mine"] for x in m)}}


def get_home(asset_id: str) -> dict:
    found = next((h for h in list_homes()["homes"] if h["asset"]["id"] == asset_id), None)
    if not found:
        raise HTTPException(404, "등록된 집을 찾을 수 없습니다.")
    return found


# ── 실거래가(국토부, 공식) ─────────────────────────────────────
# 공공데이터포털 '국토교통부_아파트 매매 실거래가 (상세)자료' 또는 '(기본)자료'. 같은 인증키로 활용 신청한 쪽을 쓴다.
TRADE_URLS = ("https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
              "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade")
_cache: dict[tuple[str, str], tuple[float, list[dict]]] = {}
CACHE_SECONDS = 6 * 3600


def key_path():
    return storage.DB_PATH.parent / "molit.key"


# git 제외. RETIRE_MOLIT_KEY=... 한 줄만 읽는다. 이 폴더의 .env, 없으면 저장소 맨 위 .env
ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
ROOT_ENV_PATH = Path(__file__).resolve().parents[3] / ".env"


def _dotenv_key() -> str | None:
    for path in (ENV_PATH, ROOT_ENV_PATH):
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in lines:
            name, _, value = line.strip().removeprefix("export ").partition("=")
            if name.strip() == "RETIRE_MOLIT_KEY" and value.strip():
                return value.strip().strip("'\"")
    return None


def market_key() -> str | None:
    import os
    from urllib.parse import unquote
    key = os.environ.get("RETIRE_MOLIT_KEY") or _dotenv_key()
    if not key and key_path().is_file():
        key = key_path().read_text(encoding="utf-8").strip()
    return unquote(key) if key else None   # 포털의 '인코딩' 키를 붙여 넣어도 된다


class KeyInput(InputModel):
    key: Annotated[str, Field(min_length=10, max_length=300, pattern=r"^[A-Za-z0-9%+/=]+$")]


def _month_trades(sigungu: str, ym: str, key: str) -> list[dict]:
    import time
    import requests
    hit = _cache.get((sigungu, ym))
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    last = "실거래가를 불러오지 못했어요."
    for url in TRADE_URLS:
        try:
            r = requests.get(url, params={"serviceKey": key, "LAWD_CD": sigungu, "DEAL_YMD": ym, "numOfRows": 1000, "pageNo": 1}, timeout=10)
        except requests.RequestException:
            raise HTTPException(503, "실거래가 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.") from None
        if r.status_code != 200 or "<item" not in r.text and "resultCode" not in r.text:
            last = "인증키가 이 서비스에 등록되지 않았거나 아직 승인 전이에요. 공공데이터포털에서 활용 신청 상태를 확인해 주세요."
            continue
        try:
            rows = parse_trades(r.text)
        except (ValueError, Exception) as e:   # 포털 오류 문구 또는 깨진 XML
            last = f"실거래가 조회 오류: {e}"[:200]
            continue
        _cache[(sigungu, ym)] = (time.time(), rows)
        return rows
    raise HTTPException(502, last)


@router.get("/market/status")
def market_status():
    return {"configured": bool(market_key())}


@router.put("/market/key")
def save_market_key(data: KeyInput):
    path = key_path()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(data.key.strip(), encoding="utf-8")
    path.chmod(0o600)
    _cache.clear()
    return {"configured": True}


def recent_trades(sigungu: str, name: str, area: float | None, months: int, dong: str | None = None, jibun: str | None = None) -> list[dict]:
    key = market_key()
    if not key:
        return []
    today = dt.date.today()
    yms = [f"{(today.year * 12 + today.month - 1 - i) // 12}{(today.month - 1 - i) % 12 + 1:02d}" for i in range(months)]
    return match_trades([r for ym in yms for r in _month_trades(sigungu, ym, key)], name, area, dong=dong, jibun=jibun)


@router.get("/trades")
def trades(sigungu: Annotated[str, Query(pattern=r"^\d{5}$")], name: Annotated[str, Query(min_length=1, max_length=100)],
           area: Annotated[float, Query(gt=0, le=2000)] | None = None, months: Annotated[int, Query(ge=1, le=12)] = 12,
           dong: Annotated[str, Query(max_length=20)] | None = None,
           jibun: Annotated[str, Query(max_length=200)] | None = None):
    if not market_key():
        return {"configured": False, "trades": []}
    return {"configured": True, "months": months, "trades": recent_trades(sigungu, name, area, months, dong, jibun)[:30]}


@router.post("/{asset_id}/refresh")
def refresh_value(asset_id: UUID):
    """최근 12개월 실거래가 중 가장 최근 거래로 시세를 갱신한다."""
    hid = str(asset_id)
    current = next((a for a in storage.list_assets() if a["id"] == hid), None)
    detail = _details().get(hid)
    if not current or not detail:
        raise HTTPException(404, "집 정보를 찾을 수 없습니다.")
    if not market_key():
        raise HTTPException(409, "실거래가 인증키를 먼저 넣어 주세요.")
    value, as_of, source = _auto_value(detail.get("address"), current["name"], detail.get("area_m2"), None)
    if source["kind"] != "trade":
        raise HTTPException(409, "최근 12개월 안에 이 단지·면적의 실거래가 없어요. 시세를 직접 넣어 주세요.")
    fields = {k: current[k] for k in ("name", "account", "owner", "pocket", "assetClass", "share_percent", "parent_id", "valuation_source")}
    storage.update_asset(asset_id, storage.AssetUpdate(**fields, amount=value, as_of=as_of, version=current["version"]))
    payload = {k: v for k, v in detail.items() if k not in ("version", "updated_at")}
    _write_detail(hid, {**payload, "value_source": source}, detail["version"])
    return get_home(hid)


# ── 호가·매물 (직접 적어 둔 것) ─────────────────────────────────
class Listing(InputModel):
    price: Money
    floor: Annotated[str, Field(max_length=20)] = ""
    memo: Annotated[str, Field(max_length=100)] = ""
    checked_on: dt.date


class ListingsInput(InputModel):
    listings: Annotated[list[Listing], Field(max_length=30)]
    detail_version: Annotated[int, Field(strict=True, ge=1)]


@router.put("/{asset_id}/listings")
def save_listings(asset_id: UUID, data: ListingsInput):
    hid = str(asset_id)
    detail = _details().get(hid)
    if not detail:
        raise HTTPException(404, "집 정보를 먼저 저장해 주세요.")
    payload = {k: v for k, v in detail.items() if k not in ("version", "updated_at")}
    payload["listings"] = [l.model_dump(mode="json") for l in data.listings]
    _write_detail(hid, payload, data.detail_version)
    return get_home(hid)


@router.get("")
def homes(owner: Literal["together", "me", "partner"] = "together"):
    return list_homes(owner)


@router.post("", status_code=201)
def create(data: HomeCreate):
    return create_home(data)


@router.put("/{asset_id}")
def update(asset_id: UUID, data: HomeUpdate):
    return update_home(asset_id, data)


@router.delete("/{asset_id}", status_code=204)
def delete(asset_id: UUID, version: int = Query(ge=1)):
    delete_home(asset_id, version)
    return Response(status_code=204)
