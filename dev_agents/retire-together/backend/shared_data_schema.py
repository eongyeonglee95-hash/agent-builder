"""SHARE-05 canonical financial records. People are never login-relative.

The original domain models still validate money and plans. The shared API uses
member_id; only the compatibility projection uses the original owner's me/partner.
No authentication material belongs in this schema.
"""
from copy import deepcopy
from hashlib import sha256
import json
from typing import Annotated, Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field, TypeAdapter, ValidationError

from backend.storage import AssetInput, InputModel, Money, Person

KINDS = {"profile", "family_goal", "pension", "retirement", "asset", "account", "pool",
         "holding", "property_detail", "property_plan", "property_track", "decision", "rules"}
IMMUTABLE = {"decision", "rules"}


def encoded(value):
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (ValueError, TypeError, OverflowError):
        fail("공유 자료에는 유효한 JSON 값과 유한한 숫자만 저장할 수 있습니다.")


def fingerprint(value):
    return sha256(encoded(value).encode()).hexdigest()


def fail(message="공유 자료의 형식·명의·연결을 확인해 주세요."):
    raise HTTPException(409, message)


class Record(InputModel):
    kind: str
    id: Annotated[str, Field(min_length=1, max_length=240)]
    member_id: str
    payload: dict


class Account(InputModel):
    label: Annotated[str | None, Field(max_length=100)] = None
    broker: Annotated[str, Field(min_length=1, max_length=40)]
    account_type: Literal["pension_savings", "irp", "isa", "general"]
    pocket: Literal["pension", "cash"]
    pool: str | None = None
    layer: Literal[1, 2, 3, 4] | None = None
    api: bool = False
    active: bool = True


class Pool(InputModel):
    label: Annotated[str, Field(min_length=1, max_length=100)]
    strategy: Annotated[str | None, Field(max_length=80)] = None
    mode: Literal["rebalance", "buy_only"] = "rebalance"


class Holding(InputModel):
    account_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9_]+$")]
    ticker_name: Annotated[str, Field(min_length=1, max_length=200)]
    ticker: Annotated[str, Field(max_length=40)] = ""
    qty: Annotated[int, Field(strict=True, ge=0, le=10**12)]
    price: Money
    buy_value: Money | None = None
    as_of: str = ""
    updated_at: str = ""


def key(record):
    return record["kind"], record["id"]


def canonical(state):
    out = deepcopy(state)
    out["records"] = sorted(out["records"], key=key)
    return out


def validate(state, members):
    """Fail closed, including foreign members, unknown fields and dangling links."""
    from backend.retirement import PersonPlan, PlanInput
    from backend.property_move import MoveInput
    from backend.property import HomeInput, Listing
    try:
        if not isinstance(state, dict) or set(state) != {"schema", "members", "records"} or type(state["schema"]) is not int or state["schema"] != 1 or state["members"] != members:
            fail()
        if len(state["records"]) > 10000 or len(encoded(state).encode()) > 1_500_000:
            fail("공유 자료 크기가 현재 가구 저장 한도를 넘었습니다.")
        records = [Record.model_validate(r).model_dump() for r in state["records"]]
        indexed = {key(r): r for r in records}
        if len(indexed) != len(records):
            fail("같은 공유 자료 ID가 두 번 있습니다.")
        people = set(members.values())
        aliases = {value: who for who, value in members.items()}
        accounts = {r["id"]: r for r in records if r["kind"] == "account"}
        assets = {r["id"]: r for r in records if r["kind"] == "asset"}
        holding_keys = set()
        linked_debts = set()
        for r in records:
            kind, rid, member, p = r["kind"], r["id"], r["member_id"], r["payload"]
            if kind not in KINDS or member not in people | {"household", "joint"}:
                fail()
            if kind in {"profile", "pension", "account", "holding"} and member not in people:
                fail()
            if kind in {"family_goal", "retirement", "decision", "rules"} and member != "household":
                fail()
            if kind in {"profile", "pension"}:
                if rid != member:
                    fail()
                r["payload"] = (Person if kind == "profile" else PersonPlan).model_validate(p).model_dump(mode="json", exclude_unset=True)
            elif kind == "family_goal":
                if rid != "goal" or set(p) != {"reference_member_id", "retirement_age", "target_amount"} or p["reference_member_id"] != members["me"]:
                    fail()
                from backend.storage import FamilyInput
                FamilyInput(me=Person(name="schema"), retirement_age=p["retirement_age"], target_amount=p["target_amount"], version=0)
            elif kind == "retirement":
                if rid != "plan" or {"me", "partner", "apply_spending_budget"} & set(p):
                    fail()
                r["payload"] = PlanInput(**p, version=0).model_dump(mode="json", exclude_unset=True, exclude={"version"})
            elif kind == "asset":
                UUID(rid)
                if member not in people | {"joint"} or "owner" in p:
                    fail()
                base = {k: v for k, v in p.items() if k not in {"account_id", "source", "updated_at", "version", "request_id"}}
                normalized = AssetInput(**base, owner="joint" if member == "joint" else aliases[member]).model_dump(mode="json", exclude_unset=True, exclude={"owner"})
                r["payload"] = {**p, **normalized}
                if p.get("account_id") and (p["account_id"] not in accounts or accounts[p["account_id"]]["member_id"] != member):
                    fail()
                parent = assets.get(p.get("parent_id"))
                if p.get("parent_id") and (not parent or parent["member_id"] != member or parent["payload"].get("parent_id") or parent["id"] == rid):
                    fail()
                if parent and any(p.get(k) != parent["payload"].get(k) for k in ("account", "pocket")):
                    fail()
                if p.get("valuation_source") == "details" and not any(a["payload"].get("parent_id") == rid for a in assets.values()):
                    fail()
            elif kind == "account":
                from tools.parse_balance import ACCOUNT_ID_RE
                if not ACCOUNT_ID_RE.fullmatch(rid):
                    fail()
                r["payload"] = Account.model_validate(p).model_dump(mode="json", exclude_unset=True)
                if p.get("pool") and ("pool", p["pool"]) not in indexed:
                    fail()
            elif kind == "pool":
                r["payload"] = Pool.model_validate(p).model_dump(mode="json", exclude_unset=True)
                owners = {a["member_id"] for a in accounts.values() if a["payload"].get("pool") == rid}
                if member not in people | {"household"} or (owners and owners != {member} and member != "household"):
                    fail()
            elif kind == "holding":
                r["payload"] = Holding.model_validate(p).model_dump(mode="json", exclude_unset=True)
                account = accounts.get(p["account_id"])
                hk = p["account_id"], p["ticker"] or p["ticker_name"]
                if not account or account["member_id"] != member or hk in holding_keys:
                    fail()
                holding_keys.add(hk)
            elif kind == "property_plan":
                if rid != member or member not in people | {"household"}:
                    fail()
                r["payload"] = MoveInput.model_validate(p).model_dump(mode="json", exclude_unset=True)
                for aid in p.get("source_home_ids", []):
                    if aid not in assets or assets[aid]["payload"]["pocket"] != "property" or (member != "household" and assets[aid]["member_id"] not in {member, "joint"}):
                        fail()
            elif kind == "property_track":
                if set(p) != {"candidate_id", "day", "entry"} or member not in people | {"household"}:
                    fail()
                import datetime as dt
                dt.date.fromisoformat(p["day"])
                plan = indexed.get(("property_plan", member))
                if not plan or p["candidate_id"] not in {c["id"] for c in plan["payload"]["candidates"]}:
                    fail()
                if rid != f'{member}:{p["candidate_id"]}:{p["day"]}':
                    fail()
                e = p["entry"]
                allowed = {"price", "price_basis", "price_date", "note", "home_value", "home_net", "own_funds", "gap", "needed", "costs_complete", "saved_at"}
                if set(e) - allowed:
                    fail()
                from backend.property_move import TrackInput
                TrackInput(candidate_id=p["candidate_id"], **{k: e[k] for k in ("price", "price_basis", "price_date", "note") if k in e})
                for field in ("home_value", "needed"):
                    if field in e:
                        TypeAdapter(Money | None).validate_python(e[field])
                for field in ("home_net", "own_funds", "gap"):
                    if e.get(field) is not None and (type(e[field]) is not int or abs(e[field]) > 10**16):
                        fail()
                if "costs_complete" in e and type(e["costs_complete"]) is not bool:
                    fail()
            elif kind == "property_detail":
                if rid not in assets or assets[rid]["member_id"] != member or assets[rid]["payload"]["pocket"] != "property":
                    fail()
                allowed = {"address", "area_m2", "purchase_price", "purchase_month", "tenure", "deposit", "monthly_rent", "loan_ids", "deposit_asset_id", "request_id", "value_source", "listings", "version", "updated_at"}
                if set(p) - allowed:
                    fail()
                home = assets[rid]["payload"]
                fields = {k: v for k, v in p.items() if k in HomeInput.model_fields}
                normalized = HomeInput(**fields, name=home["name"], owner="joint" if member == "joint" else aliases[member],
                    share_percent=home.get("share_percent")).model_dump(mode="json", exclude_unset=True)
                r["payload"] = {**p, **{k: normalized[k] for k in fields}}
                for listing in p.get("listings", []):
                    Listing.model_validate(listing)
                for aid in [*p.get("loan_ids", []), *([p["deposit_asset_id"]] if p.get("deposit_asset_id") else [])]:
                    if aid not in assets or assets[aid]["payload"]["pocket"] != "debt" or aid in linked_debts:
                        fail()
                    linked_debts.add(aid)
            elif kind == "decision":
                if set(p) != {"date", "who", "decision", "reason"} or any(not isinstance(v, str) for v in p.values()):
                    fail()
            elif kind == "rules":
                if rid not in {"strategies", "asset_map"} or set(p) != {"text", "sha256"} or sha256(p["text"].encode()).hexdigest() != p["sha256"]:
                    fail()
        # A profile cannot disappear while its financial records remain.
        for member in people:
            if any(r["member_id"] == member and r["kind"] in {"asset", "account", "pension"} for r in records) and ("profile", member) not in indexed:
                fail()
    except (ValueError, TypeError, KeyError, AttributeError, ValidationError, OverflowError):
        fail()
    return canonical({**state, "records": records})


def summary(state):
    """Counts and exact integer totals; root/detail alternatives never double count."""
    records = state["records"]
    counts = {kind: sum(r["kind"] == kind for r in records) for kind in sorted(KINDS)}
    assets = [r for r in records if r["kind"] == "asset"]
    totals = {member: {"assets": 0, "debt": 0} for member in [*state["members"].values(), "joint"]}
    for root in (r for r in assets if not r["payload"].get("parent_id")):
        children = [r for r in assets if r["payload"].get("parent_id") == root["id"]]
        rows = children if root["payload"].get("valuation_source") == "details" and children else [root]
        for r in rows:
            totals[r["member_id"]]["debt" if r["payload"]["pocket"] == "debt" else "assets"] += r["payload"]["amount"]
    holdings = {}
    for r in (r for r in records if r["kind"] == "holding"):
        p = r["payload"]
        holdings[p["account_id"]] = holdings.get(p["account_id"], 0) + p["qty"] * p["price"]
    return {"counts": counts, "totals": totals, "holding_values": holdings, "digest": fingerprint(canonical(state))}


def projection(state, member_id):
    """Labels follow the viewer; retirement/joint-share references stay fixed."""
    members = state["members"]
    return {"me": member_id, "partner": next(v for v in members.values() if v != member_id),
            "retirement_reference_member_id": members["me"], "joint_share_reference_member_id": members["me"]}
