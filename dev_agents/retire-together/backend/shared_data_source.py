"""Read-only inventory of legacy financial sources; never follows auth/token files."""
import base64
import csv
from hashlib import sha256
import io
import json
import sqlite3
from uuid import NAMESPACE_URL, uuid5

import yaml

from backend import registration, storage
from backend.shared_data_schema import canonical, fail, fingerprint, validate
from tools.sheets import ASSET_TAB, HOLDING_TAB


# Market observations/collection history share the local DB, but are not the
# household ledger. Keep them in the original DB; do not copy them into a
# migration backup or include them in the household source-change check.
FINANCIAL_TABLES = (
    "family", "assets", "asset_history", "retirement_plan",
    "property_detail", "property_move", "property_track",
)
MAX_FINANCIAL_SNAPSHOT_BYTES = 100_000_000


def financial_snapshot(db, path):
    """Copy household tables/history from one read transaction, without writes to source.

    INSERT SELECT keeps rows inside SQLite instead of materializing a whole DB
    (including large public observations) in Python. The destination page cap
    still bounds financial backups. Source WAL changes are read consistently.
    """
    if path.is_symlink():
        fail("원본 DB 경로의 심볼릭 링크를 확인해 주세요.")
    page_size = db.execute("PRAGMA main.page_size").fetchone()[0]
    db.execute(f"PRAGMA main.max_page_count={max(1, MAX_FINANCIAL_SNAPSHOT_BYTES // page_size)}")
    db.execute("ATTACH DATABASE ? AS original", (path.resolve().as_uri() + "?mode=ro",))
    try:
        db.execute("BEGIN")
        marks = ",".join("?" for _ in FINANCIAL_TABLES)
        tables = db.execute(f"SELECT name, sql FROM original.sqlite_master WHERE type='table' "
                            f"AND name IN ({marks}) ORDER BY name", FINANCIAL_TABLES).fetchall()
        for name, sql in tables:
            db.execute(sql)
            db.execute(f'INSERT INTO main."{name}" SELECT * FROM original."{name}"')
        # Preserve AUTOINCREMENT high-water marks, including deleted history.
        if db.execute("SELECT 1 FROM main.sqlite_master WHERE name='sqlite_sequence'").fetchone():
            db.execute("DELETE FROM main.sqlite_sequence")
            db.execute(f"INSERT INTO main.sqlite_sequence SELECT * FROM original.sqlite_sequence "
                       f"WHERE name IN ({marks})", FINANCIAL_TABLES)
        for (sql,) in db.execute(f"SELECT sql FROM original.sqlite_master WHERE type IN ('index','trigger') "
                                f"AND tbl_name IN ({marks}) AND sql IS NOT NULL ORDER BY type,name",
                                FINANCIAL_TABLES).fetchall():
            db.execute(sql)
        db.commit()
    except sqlite3.Error as exc:
        db.rollback()
        if exc.sqlite_errorcode == sqlite3.SQLITE_FULL:
            fail("이전할 가계 자료와 이력이 백업 크기 한도를 넘었습니다. 원본은 보존되어 있습니다.")
        raise
    finally:
        db.execute("DETACH DATABASE original")


def record(kind, rid, member, payload):
    return {"kind": kind, "id": str(rid), "member_id": member, "payload": payload}


def integer(value, *, optional=False):
    if optional and value in (None, ""):
        return None
    if isinstance(value, bool):
        fail()
    try:
        from decimal import Decimal
        n = Decimal(str(value))
        if not n.is_finite() or n != int(n):
            fail()
        return int(n)
    except (ValueError, ArithmeticError):
        fail()


def asset(raw, members):
    p = dict(raw)
    rid, owner = p.pop("id"), p.pop("owner")
    if owner not in {"me", "partner", "joint"}:
        fail()
    for k in ("amount", "version", "share_percent", "pension_layer"):
        if k in p:
            p[k] = integer(p[k], optional=k in {"share_percent", "pension_layer"})
    for k in ("parent_id", "account_id"):
        p[k] = p.get(k) or None
    p["valuation_source"] = p.get("valuation_source") or "total"
    p["source"] = p.get("source") or "manual"
    p.setdefault("share_percent", None)
    p.setdefault("pension_layer", None)
    return record("asset", rid, "joint" if owner == "joint" else members[owner], p)


def holding(raw, accounts):
    p = dict(raw)
    for k in ("qty", "price", "buy_value"):
        p[k] = integer(p.get(k), optional=k == "buy_value")
    p["ticker"] = str(p.get("ticker") or "")
    if p["ticker"].isdigit():
        p["ticker"] = p["ticker"].zfill(6)
    p.setdefault("as_of", "")
    p.setdefault("updated_at", "")
    account = accounts.get(p["account_id"])
    if account is None:
        fail("보유종목의 계좌 설정이 없습니다. 이전 전에 계좌 명의를 확인해 주세요.")
    rid = str(uuid5(NAMESPACE_URL, p["account_id"] + ":" + (p["ticker"] or p["ticker_name"])))
    return record("holding", rid, account["member_id"], p)


def local_sources(members):
    """Return records, consistent financial SQLite snapshot and exact source files."""
    from backend.workbook import decisions_path
    from tools.strategy import strategies_path
    from tools.decisions import LINE_RE, SECTION
    archive, rows = {}, []

    def read(path, label):
        if path.is_symlink():
            fail("원본 경로의 심볼릭 링크를 확인해 주세요.")
        raw = path.read_bytes() if path.exists() else b""
        if len(raw) > 30_000_000:
            fail("원본 파일이 이전 도구의 크기 한도를 넘었습니다.")
        archive[label] = base64.b64encode(raw).decode()
        return raw.decode("utf-8-sig")

    db = sqlite3.connect(":memory:", uri=True)
    db.row_factory = sqlite3.Row
    try:
        if storage.DB_PATH.exists():
            financial_snapshot(db, storage.DB_PATH)
            archive["financial.sqlite3"] = base64.b64encode(db.serialize()).decode()
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}

        def table(name):
            return [dict(r) for r in db.execute(f'SELECT * FROM "{name}"')] if name in tables else []

        family = table("family")
        if family:
            p = json.loads(family[0]["payload"])
            for who in ("me", "partner"):
                if p.get(who):
                    rows.append(record("profile", members[who], members[who], p[who]))
            rows.append(record("family_goal", "goal", "household", {"reference_member_id": members["me"],
                "retirement_age": p.get("retirement_age"), "target_amount": p.get("target_amount")}))
        retirement = table("retirement_plan")
        if retirement:
            from backend.retirement import PlanInput
            p = PlanInput(**json.loads(retirement[0]["payload"]), version=0).model_dump(exclude={"version"})
            for who in ("me", "partner"):
                rows.append(record("pension", members[who], members[who], p.pop(who)))
            rows.append(record("retirement", "plan", "household", p))
        for r in table("assets"):
            rows.append(asset({**json.loads(r["payload"]), "id": r["id"], "request_id": r["request_id"],
                               "version": r["version"], "updated_at": r["updated_at"]}, members))
        asset_members = {r["id"]: r["member_id"] for r in rows if r["kind"] == "asset"}
        for r in table("property_detail"):
            if r["asset_id"] not in asset_members:
                fail("장부에서 사라진 집의 상세 정보가 있습니다. 원본을 정리한 뒤 이전해 주세요.")
            rows.append(record("property_detail", r["asset_id"], asset_members[r["asset_id"]],
                {**json.loads(r["payload"]), "version": r["version"], "updated_at": r["updated_at"]}))
        for r in table("property_move"):
            scope = "household" if r["owner"] == "together" else members[r["owner"]]
            rows.append(record("property_plan", scope, scope, {**json.loads(r["payload"]), "version": r["version"]}))
        for r in table("property_track"):
            scope = "household" if r["owner"] == "together" else members[r["owner"]]
            rows.append(record("property_track", f'{scope}:{r["candidate_id"]}:{r["day"]}', scope,
                {"candidate_id": r["candidate_id"], "day": r["day"], "entry": json.loads(r["payload"])}))
    finally:
        db.close()
    raw_accounts = yaml.safe_load(read(registration.accounts_path(), "accounts.yaml")) or {}
    for a in raw_accounts.get("accounts", []):
        p = dict(a)
        rid, owner = p.pop("id"), p.pop("owner")
        if owner not in {"me", "spouse", "partner"}:
            fail()
        rows.append(record("account", rid, members["me" if owner == "me" else "partner"], p))
    accounts = {r["id"]: r for r in rows if r["kind"] == "account"}
    if len(accounts) != len(raw_accounts.get("accounts", [])):
        fail("계좌 ID가 중복되었습니다.")
    for rid, p in raw_accounts.get("pools", {}).items():
        owners = {r["member_id"] for r in accounts.values() if r["payload"].get("pool") == rid}
        rows.append(record("pool", rid, next(iter(owners)) if len(owners) == 1 else "household", p))
    snapshot_root = registration.snapshot_dir()
    if snapshot_root.is_symlink():
        fail("원본 스냅샷 폴더의 심볼릭 링크를 확인해 주세요.")
    for rid in accounts:
        from tools.parse_balance import ACCOUNT_ID_RE
        if not ACCOUNT_ID_RE.fullmatch(rid):
            fail()
        if (snapshot_root / rid).is_symlink():
            fail("원본 계좌 폴더의 심볼릭 링크를 확인해 주세요.")
        files = sorted((snapshot_root / rid).glob("*.csv"))
        latest = ""
        for path in files:
            latest = read(path, f"snapshots/{rid}/{path.name}")
        if latest:
            for r in csv.DictReader(io.StringIO(latest)):
                if r.get("account_id") != rid:
                    fail("계좌 스냅샷에 다른 계좌가 섞여 있습니다.")
                allowed = {"account_id", "ticker_name", "ticker", "qty", "price", "buy_value", "as_of", "updated_at"}
                if set(r) - allowed - {"value", "asset_class", "stock_group", "role"}:
                    fail("스냅샷의 추가 열을 확인해 주세요.")
                p = {k: v for k, v in r.items() if k in allowed}
                if "value" in r and integer(r["value"]) != integer(r["qty"]) * integer(r["price"]):
                    fail("스냅샷 평가액과 수량·가격 합계가 일치하지 않습니다.")
                p.setdefault("as_of", files[-1].stem)
                rows.append(holding(p, accounts))
    for rid, path in (("strategies", strategies_path()), ("asset_map", registration.asset_map_path())):
        text = read(path, rid + ".yaml")
        rows.append(record("rules", rid, "household", {"text": text, "sha256": sha256(text.encode()).hexdigest()}))
    decisions = read(decisions_path(), "decisions.md")
    if SECTION in decisions:
        for index, line in enumerate(decisions.split(SECTION, 1)[1].splitlines()):
            match = LINE_RE.match(line.strip())
            if match:
                p = dict(zip(("date", "who", "decision", "reason"), match.groups()))
                rows.append(record("decision", fingerprint([index, p]), "household", p))
    # Unregistered people receive neutral incomplete profiles, never guessed ages.
    for who, member in members.items():
        if not any(r["kind"] == "profile" and r["id"] == member for r in rows):
            from backend.storage import Person
            rows.append(record("profile", member, member, Person(name="나" if who == "me" else "배우자").model_dump()))
    state = validate({"schema": 1, "members": members, "records": rows}, members)
    return state, archive


def sheet_sources(tabs, local, members):
    accounts = {r["id"]: r for r in local["records"] if r["kind"] == "account"}
    rows = [asset(r, members) for r in tabs[ASSET_TAB]]
    rows += [holding(r, accounts) for r in tabs[HOLDING_TAB]]
    if len({(r["kind"], r["id"]) for r in rows}) != len(rows):
        fail("기존 시트에 같은 자료 ID가 중복되었습니다. 원본을 확인해 주세요.")
    return canonical({"schema": 1, "members": members, "records": rows})


def merge(local, remote, choices=None):
    choices = choices or {}
    indexed = {(r["kind"], r["id"]): r for r in local["records"]}
    conflicts, used = [], set()
    for row in remote["records"]:
        k = row["kind"], row["id"]
        old = indexed.get(k)
        choice_key = row["kind"] + ":" + row["id"]
        if old is not None and old != row:
            # The preview is explicit even when only provenance/timestamps differ.
            conflicts.append({"key": choice_key, "local": old, "sheet": row})
            if choice_key not in choices:
                continue
            used.add(choice_key)
            if choices[choice_key] == "local":
                continue
            if choices[choice_key] != "sheet":
                fail()
        indexed[k] = row
    if set(choices) != used:
        fail("이전 대조표에 없는 충돌 선택입니다.")
    state = canonical({**local, "records": list(indexed.values())})
    return state, conflicts
