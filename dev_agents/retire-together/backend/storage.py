"""Local single-household ledger. Tests inject a temporary database path."""
from contextlib import contextmanager
from datetime import date, datetime, timezone
import json
from pathlib import Path
import sqlite3
import unicodedata
from typing import Annotated, Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend import ledger

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "local" / "retire-together.sqlite3"
Money = Annotated[int, Field(strict=True, ge=0, le=1_000_000_000_000_000)]

class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

class Person(InputModel):
    name: Annotated[str, Field(min_length=1, max_length=40)]
    age: Annotated[int, Field(strict=True, ge=18, le=110)] | None = None
    gender: Literal["female", "male", "unspecified"] = "unspecified"
    role: Literal["wife", "husband", "partner"] | None = None

class FamilyInput(InputModel):
    me: Person
    partner: Person | None = None
    retirement_age: Annotated[int, Field(strict=True, ge=18, le=100)] | None = None
    target_amount: Annotated[int, Field(strict=True, ge=1, le=1_000_000_000_000_000)] | None = None
    version: Annotated[int, Field(strict=True, ge=0)]

class AssetInput(InputModel):
    name: Annotated[str, Field(min_length=1, max_length=100)]
    account: Annotated[str, Field(min_length=1, max_length=100)]
    owner: Literal["me", "partner", "joint"]
    pocket: Literal["retirement", "cash", "property", "debt"]
    assetClass: Literal["stock", "long_bond", "mid_bond", "gold", "commodity", "cash", "property", "mixed", "debt"]
    amount: Money
    as_of: date
    parent_id: UUID | None = None
    valuation_source: Literal["total", "details"] = "total"
    share_percent: Annotated[int, Field(strict=True, ge=1, le=99)] | None = None

    @model_validator(mode="after")
    def consistent_class(self):
        if self.pocket in ("property", "debt"):
            if self.assetClass != self.pocket:
                raise ValueError("부동산·대출의 분류가 일치해야 합니다")
        elif self.assetClass in ("property", "debt"):
            raise ValueError("금융 주머니에 부동산·대출을 넣을 수 없습니다")
        if self.as_of > date.today():
            raise ValueError("기준일은 미래일 수 없습니다")
        if self.owner == "joint":
            if self.pocket not in ("property", "debt") or self.share_percent is None:
                raise ValueError("공동 소유는 집·대출에 지분율과 함께 입력해 주세요")
        elif self.share_percent is not None:
            raise ValueError("개인 소유에는 공동 지분율을 넣을 수 없습니다")
        if self.parent_id and (self.pocket in ("property", "debt") or self.valuation_source != "total"):
            raise ValueError("계좌 세부 자산에는 집·대출이나 합계 출처를 지정할 수 없습니다")
        if self.pocket in ("property", "debt") and self.valuation_source != "total":
            raise ValueError("집·대출은 직접 등록한 금액을 사용합니다")
        return self

class AssetCreate(AssetInput):
    request_id: UUID

class AssetUpdate(AssetInput):
    version: Annotated[int, Field(strict=True, ge=1)]

def now():
    return datetime.now(timezone.utc).isoformat()

@contextmanager
def connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    conn = sqlite3.connect(DB_PATH, timeout=5)
    DB_PATH.chmod(0o600)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS family (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS asset_history (event_id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id TEXT NOT NULL, operation TEXT NOT NULL, payload TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL);
        """)
        with conn:
            yield conn
    finally:
        conn.close()

def family_from(conn):
    row = conn.execute("SELECT payload, version FROM family WHERE id=1").fetchone()
    return {**json.loads(row["payload"]), "version": row["version"]} if row else None

def require_person(conn, owner):
    """Asset-first onboarding: create only neutral, incomplete owner records."""
    family = family_from(conn)
    payload = {k: v for k, v in (family or {}).items() if k != "version"}
    changed = False
    for key in (("me", "partner") if owner == "joint" else ("me", owner)):
        if not payload.get(key):
            payload[key] = Person(name="나" if key == "me" else "배우자").model_dump()
            changed = True
    if changed:
        payload.setdefault("partner", None)
        payload.setdefault("retirement_age", None)
        payload.setdefault("target_amount", None)
        payload["updated_at"] = now()
        version = (family or {}).get("version", 0) + 1
        conn.execute("INSERT INTO family VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, version=excluded.version", (json.dumps(payload, ensure_ascii=False), version))

def asset_from(row):
    return {"parent_id": None, "valuation_source": "total", "share_percent": None, **json.loads(row["payload"]), "id": row["id"], "version": row["version"], "updated_at": row["updated_at"]}


def ledger_rows(conn):
    return [asset_from(row) for row in conn.execute("SELECT * FROM assets ORDER BY created_at, id")]


def normalize_account(account):
    return "".join(unicodedata.normalize("NFKC", account).casefold().split())


def validate_links(conn, payload, asset_id=None, rows=None):
    rows = ledger_rows(conn) if rows is None else rows   # SHEET-01: 시트가 원천이면 시트 행을 넘긴다
    previous = next((a for a in rows if a["id"] == asset_id), None)
    if previous and previous["parent_id"] and previous["parent_id"] != payload["parent_id"]:
        old_parent = next((a for a in rows if a["id"] == previous["parent_id"]), None)
        if old_parent and old_parent["valuation_source"] == "details" and sum(a["parent_id"] == previous["parent_id"] for a in rows) == 1:
            raise HTTPException(409, "마지막 세부 자산입니다. 원래 계좌의 합산 기준을 먼저 바꿔 주세요.")
    children = [a for a in rows if a["parent_id"] == asset_id] if asset_id else []
    parent_id = payload["parent_id"]
    if parent_id:
        parent = next((a for a in rows if a["id"] == parent_id), None)
        if not parent or parent["parent_id"] or parent_id == asset_id or parent["pocket"] in ("property", "debt"):
            raise HTTPException(422, "세부 자산을 연결할 금융 계좌를 확인해 주세요.")
        if any(payload[key] != parent[key] for key in ("owner", "pocket", "account")):
            raise HTTPException(422, "세부 자산의 소유자·종류·계좌는 원래 계좌와 같아야 합니다.")
        if any(a["id"] != asset_id and a["parent_id"] == parent_id and normalize_account(a["name"]) == normalize_account(payload["name"]) for a in rows):
            raise HTTPException(409, "같은 세부 자산이 이미 있습니다. 기존 금액을 갱신해 주세요.")
    elif payload["pocket"] in ("retirement", "cash"):
        duplicate = next((a for a in rows if a["id"] != asset_id and not a["parent_id"] and a["pocket"] == payload["pocket"] and a["owner"] == payload["owner"] and normalize_account(a["account"]) == normalize_account(payload["account"])), None)
        if duplicate:
            raise HTTPException(409, "이 계좌가 이미 등록되어 있습니다. 계좌 관리에서 금액을 갱신하거나 세부 자산을 추가해 주세요.")
    if payload["valuation_source"] == "details" and not children:
        raise HTTPException(422, "세부 자산을 먼저 추가한 뒤 합산 기준을 바꿔 주세요.")
    if children:
        original = next(a for a in rows if a["id"] == asset_id)
        if any(payload[key] != original[key] for key in ("owner", "pocket", "account", "parent_id")):
            raise HTTPException(409, "연결된 세부 자산이 있어 계좌의 소유자·종류·이름을 바꿀 수 없습니다.")

def get_family():
    with connection() as conn:
        return family_from(conn)

def save_family(data: FamilyInput):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        current = family_from(conn)
        if (current["version"] if current else 0) != data.version:
            raise HTTPException(409, "다른 화면에서 정보가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.")
        if data.partner is None and any(a["owner"] in ("partner", "joint") for a in list_assets()):
            raise HTTPException(409, "배우자 자산이 있어 배우자 정보를 지울 수 없습니다.")
        payload = data.model_dump(exclude={"version"})
        payload["updated_at"] = now()
        conn.execute("INSERT INTO family VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, version=excluded.version", (json.dumps(payload, ensure_ascii=False), data.version + 1))
        return {**payload, "version": data.version + 1}

def list_assets():
    store = ledger.sheet_store()   # SHEET-01: 구글 시트가 연결돼 있으면 시트가 원천
    if store is not None:
        return store.list_assets()
    with connection() as conn:
        return ledger_rows(conn)

def list_local_assets():
    """시트 연결과 무관하게 로컬 SQLite의 자산 (시트로 이관할 때 쓴다)."""
    with connection() as conn:
        return [asset_from(row) for row in conn.execute("SELECT * FROM assets ORDER BY created_at, id")]

def create_asset(data: AssetCreate):
    from uuid import uuid4
    payload = data.model_dump(mode="json", exclude={"request_id"})
    text = json.dumps(payload, ensure_ascii=False)
    store = ledger.sheet_store()
    if store is not None:
        # Retry is checked before duplicate-account validation.
        existing = store.find_request(str(data.request_id), payload)
        if existing is not None:
            return existing
        validate_links(None, payload, rows=store.list_assets())
        with connection() as conn:
            require_person(conn, data.owner)
        return store.create_asset(payload, str(data.request_id))
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute("SELECT * FROM assets WHERE request_id=?", (str(data.request_id),)).fetchone()
        if existing:
            if json.loads(existing["payload"]) != payload:
                raise HTTPException(409, "이미 사용된 등록 요청입니다. 화면을 다시 열어 주세요.")
            return asset_from(existing)
        validate_links(conn, payload)
        require_person(conn, data.owner)
        asset_id, timestamp = str(uuid4()), now()
        conn.execute("INSERT INTO assets VALUES (?, ?, ?, 1, ?, ?)", (asset_id, str(data.request_id), text, timestamp, timestamp))
        conn.execute("INSERT INTO asset_history(asset_id, operation, payload, version, created_at) VALUES (?, 'create', ?, 1, ?)", (asset_id, text, timestamp))
        return {**payload, "id": asset_id, "version": 1, "updated_at": timestamp}

def update_asset(asset_id: UUID, data: AssetUpdate):
    payload = data.model_dump(mode="json", exclude={"version"})
    store = ledger.sheet_store()
    if store is not None:
        validate_links(None, payload, str(asset_id), rows=store.list_assets())
        with connection() as conn:
            require_person(conn, data.owner)
        return store.update_asset(str(asset_id), payload, data.version)
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute("SELECT version, payload FROM assets WHERE id=?", (str(asset_id),)).fetchone()
        if not existing:
            raise HTTPException(404, "등록된 자산을 찾을 수 없습니다.")
        if existing["version"] != data.version:
            raise HTTPException(409, "다른 화면에서 자산이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.")
        validate_links(conn, payload, str(asset_id))
        require_person(conn, data.owner)
        old = json.loads(existing["payload"])
        payload = {**{k: old[k] for k in ("account_id", "source") if k in old}, **payload}   # 등록 출처는 수정해도 유지
        text = json.dumps(payload, ensure_ascii=False)
        timestamp = now()
        conn.execute("UPDATE assets SET payload=?, version=version+1, updated_at=? WHERE id=?", (text, timestamp, str(asset_id)))
        conn.execute("INSERT INTO asset_history(asset_id, operation, payload, version, created_at) VALUES (?, 'update', ?, ?, ?)", (str(asset_id), text, data.version + 1, timestamp))
        return {**payload, "id": str(asset_id), "version": data.version + 1, "updated_at": timestamp}

def delete_asset(asset_id: UUID, version: int):
    store = ledger.sheet_store()
    if store is not None:
        return store.delete_asset(str(asset_id), version)
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute("SELECT * FROM assets WHERE id=?", (str(asset_id),)).fetchone()
        if not existing:
            raise HTTPException(404, "등록된 자산을 찾을 수 없습니다.")
        if existing["version"] != version:
            raise HTTPException(409, "다른 화면에서 자산이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.")
        item = asset_from(existing)
        rows = ledger_rows(conn)
        if any(a["parent_id"] == str(asset_id) for a in rows):
            raise HTTPException(409, "세부 자산이 연결되어 있습니다. 세부 자산을 먼저 정리해 주세요.")
        if item["parent_id"]:
            parent = next((a for a in rows if a["id"] == item["parent_id"]), None)
            if parent and parent["valuation_source"] == "details" and sum(a["parent_id"] == item["parent_id"] for a in rows) == 1:
                raise HTTPException(409, "마지막 세부 자산입니다. 합산 기준을 계좌 총액으로 바꾼 뒤 삭제해 주세요.")
        conn.execute("INSERT INTO asset_history(asset_id, operation, payload, version, created_at) VALUES (?, 'delete', ?, ?, ?)", (str(asset_id), existing["payload"], version, now()))
        conn.execute("DELETE FROM assets WHERE id=?", (str(asset_id),))

def replace_account_assets(account_id: str, source: str, payloads: list[dict]) -> list[dict]:
    """Replace imported detail rows beneath one account, preserving its chosen source."""
    from backend.account_groups import replace_group
    from uuid import uuid4
    payloads = [AssetInput(**p).model_dump(mode="json") for p in payloads]
    store = ledger.sheet_store()
    if store is not None:
        return store.replace_account_assets(account_id, source, payloads)
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        rows, timestamp = ledger_rows(conn), now()
        after, children = replace_group(rows, account_id, source, payloads, timestamp)
        old, new = {a["id"]: a for a in rows}, {a["id"]: a for a in after}
        for asset_id in old.keys() | new.keys():
            before, item = old.get(asset_id), new.get(asset_id)
            if before == item:
                continue
            operation = "delete" if item is None else "update" if before else "create"
            record = item or before
            payload = {k: v for k, v in record.items() if k not in ("id", "version", "updated_at")}
            text = json.dumps(payload, ensure_ascii=False)
            if item is None:
                conn.execute("DELETE FROM assets WHERE id=?", (asset_id,))
            elif before:
                conn.execute("UPDATE assets SET payload=?, version=?, updated_at=? WHERE id=?", (text, item["version"], timestamp, asset_id))
            else:
                conn.execute("INSERT INTO assets VALUES (?, ?, ?, ?, ?, ?)", (asset_id, str(uuid4()), text, item["version"], timestamp, timestamp))
            conn.execute("INSERT INTO asset_history(asset_id, operation, payload, version, created_at) VALUES (?, ?, ?, ?, ?)",
                         (asset_id, operation, text, record["version"], timestamp))
        return children


def scoped_asset(asset, owner):
    if owner == "together" or asset["owner"] == owner:
        return dict(asset)
    if asset["owner"] != "joint":
        return None
    me_amount = asset["amount"] * asset["share_percent"] // 100
    return {**asset, "amount": me_amount if owner == "me" else asset["amount"] - me_amount,
            "full_amount": asset["amount"], "scoped_owner": owner}


def dashboard(owner: Literal["together", "me", "partner"]):
    # One read transaction provides family and ledger from the same database view.
    with connection() as conn:
        conn.execute("BEGIN")
        all_assets, family = ledger_rows(conn), family_from(conn)
    store = ledger.sheet_store()   # SHEET-01: 시트가 연결돼 있으면 시트 행이 원천 (가족 정보는 SQLite)
    if store is not None:
        all_assets = store.list_assets()
    roots = [a for a in all_assets if not a["parent_id"]]
    effective, groups = [], []
    for root in roots:
        scoped = scoped_asset(root, owner)
        if scoped is None:
            continue
        children = [a for a in all_assets if a["parent_id"] == root["id"]]
        effective.extend(children if root["valuation_source"] == "details" and children else [scoped])
        if root["pocket"] in ("retirement", "cash"):
            groups.append({"account": root, "details": children, "source": root["valuation_source"],
                           "details_total": sum(a["amount"] for a in children),
                           "difference": sum(a["amount"] for a in children) - root["amount"]})
    assets = [a for a in effective if a["pocket"] != "debt"]
    debts = [a for a in effective if a["pocket"] == "debt"]
    total = sum(a["amount"] for a in assets)
    debt = sum(a["amount"] for a in debts)
    retirement = sum(a["amount"] for a in assets if a["pocket"] == "retirement")
    cash = sum(a["amount"] for a in assets if a["pocket"] == "cash")
    return {"assets": assets, "debts": debts, "total": total, "debt": debt, "net": total - debt,
            "retirement": retirement, "cash": cash, "financial": retirement + cash,
            "property": sum(a["amount"] for a in assets if a["pocket"] == "property"),
            "count": sum(scoped_asset(a, owner) is not None for a in roots),
            "unclassified": sum(a["amount"] for a in assets if a["assetClass"] == "mixed"),
            "as_of": min((a["as_of"] for a in effective), default=None),
            "account_groups": groups,
            "partner_missing": not any(a["owner"] in ("partner", "joint") for a in roots),
            "goal_missing": not family or family.get("retirement_age") is None or family.get("target_amount") is None}
