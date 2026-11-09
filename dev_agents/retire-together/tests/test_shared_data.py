"""SHARE-05: temporary originals, signed synthetic identities, fake HTTP only."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import base64
import json
import select
import sqlite3
import subprocess
import sys
import threading
from urllib.parse import unquote
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
import requests
import yaml

from backend import auth_config, property_move, retirement, storage
from backend.main import app
from backend.shared_data_google import HEADER, TAB, events, head
from backend.shared_data_schema import encoded, fingerprint, summary
from backend.shared_data_store import DataStore
from tools import sheets
from tests.test_web_auth import signing_material, setup, client, login, ORIGIN
from tests.test_household_invites import invited, FakeSharing, issue, accept
from tests.test_shared_sheets import SID, response

ROOT = "/api/shared-data"


class FakeData(FakeSharing):
    """Emulate only the Google wire contract, retaining real app/adapter logic."""
    def __init__(self):
        super().__init__()
        self.ids = {t: i for i, t in enumerate(sheets.TABS)}
        self.writes = 0
        self.write_failure = None
        self.before_append = None
        self.after_append = None
        self.pause_append = None
        self.actors = []

    def request(self, method, url, *, headers, timeout, allow_redirects, params=None, json=None):
        self.actors.append(headers["Authorization"])
        if not url.startswith(sheets.API + "/") or self.status != 200:
            return super().request(method, url, headers=headers, timeout=timeout,
                                   allow_redirects=allow_redirects, params=params, json=json)
        assert timeout == 20 and not allow_redirects
        assert headers["Authorization"] in {"Bearer synthetic-owner-token", "Bearer synthetic-partner-token"}
        tail = unquote(url[len(sheets.API) + 1:])
        assert tail.split(":", 1)[0].split("/", 1)[0] == SID
        tabs = self.files[SID]["tabs"]
        if tail.endswith(":batchUpdate"):
            self.writes += 1
            if self.pause_append:
                self.pause_append[0].set()
                assert self.pause_append[1].wait(10)
            if self.before_append:
                callback, self.before_append = self.before_append, None
                callback(tabs)
            if self.write_failure == "before":
                raise requests.Timeout("synthetic sensitive provider message")
            # One batch is all-or-nothing, including creation and all chunks.
            candidate, ids = deepcopy(tabs), dict(self.ids)
            for item in json["requests"]:
                if "addSheet" in item:
                    p = item["addSheet"]["properties"]
                    assert p["title"] not in candidate and p["sheetId"] not in ids.values()
                    candidate[p["title"]], ids[p["title"]] = [], p["sheetId"]
                else:
                    p = item["appendCells"]
                    assert p["fields"] == "userEnteredValue"
                    tab = next(t for t, i in ids.items() if i == p["sheetId"])
                    assert tab == TAB
                    candidate[tab].extend([[c["userEnteredValue"]["stringValue"] for c in row["values"]] for row in p["rows"]])
            tabs.clear()
            tabs.update(candidate)
            self.ids = ids
            if self.after_append:
                callback, self.after_append = self.after_append, None
                callback(tabs)
            if self.write_failure == "lost":
                raise requests.Timeout("synthetic sensitive provider message")
            return response()
        assert method == "GET", "legacy overwrite is forbidden"
        if "/values/" not in tail:
            return response({"sheets": [{"properties": {"title": t, "sheetId": self.ids[t]}} for t in tabs]})
        name = tail.split("/values/", 1)[1]
        tab = name.split("!", 1)[0].strip("'")
        values = deepcopy(tabs[tab])
        if "!" in name and name.endswith("1"):
            values = values[:1]
        return response({"values": values})


@pytest.fixture
def data_env(invited, setup, monkeypatch):
    fake = FakeData()
    invited.fake = fake
    monkeypatch.setattr(requests, "request", fake.request)
    source_files = {
        "RETIRE_ACCOUNTS_PATH": ("accounts.yaml", yaml.safe_dump({
            "accounts": [dict(id="owner_cash", owner="me", broker="합성", account_type="general", pocket="cash", pool="shared"),
                         dict(id="partner_pension", owner="spouse", broker="합성", account_type="pension_savings", pocket="pension", pool="shared")],
            "pools": {"shared": {"label": "합성 묶음", "strategy": "synthetic", "mode": "rebalance"}}})),
        "RETIRE_STRATEGIES_PATH": ("strategies.yaml", "strategies: {}\n"),
        "RETIRE_ASSET_MAP_PATH": ("asset_map.yaml", "assets: {}\n"),
        "RETIRE_DECISIONS_PATH": ("decisions.md", "# DECISIONS\n\n## 리밸런싱 제안 기록\n- 2026-01-01 | 사용자 | 보류 | 합성 기록\n"),
    }
    for env, (name, content) in source_files.items():
        path = setup.path / name
        path.write_text(content)
        monkeypatch.setenv(env, str(path))
    snap = setup.path / "snapshots" / "owner_cash"
    snap.mkdir(parents=True)
    (snap / "2026-01-01.csv").write_text("account_id,ticker_name,ticker,qty,price,value,buy_value\nowner_cash,합성 종목,000001,2,300,600,500\n")
    family = storage.FamilyInput(me=storage.Person(name="첫 사람", age=40), partner=storage.Person(name="둘째 사람", age=37),
                                 retirement_age=60, target_amount=1000000, version=0).model_dump(exclude={"version"})
    invited.home_id, invited.asset_id, invited.candidate_id = [str(uuid4()) for _ in range(3)]
    with storage.connection() as db:
        db.execute("INSERT INTO family VALUES (1,?,1)", (encoded(family),))
        retirement._table(db)
        plan = retirement.PlanInput(version=0, me=retirement.PersonPlan(national_monthly=100),
                                    partner=retirement.PersonPlan(national_monthly=200), monthly_need=300).model_dump(exclude={"version"})
        db.execute("INSERT INTO retirement_plan VALUES (1,?,1)", (encoded(plan),))
        for rid, owner, pocket, amount in [(invited.asset_id, "me", "cash", 600), (invited.home_id, "joint", "property", 10000)]:
            p = storage.AssetInput(name="합성 자산", account=rid, owner=owner, pocket=pocket, assetClass=pocket,
                                   amount=amount, as_of="2026-01-01", share_percent=40 if owner == "joint" else None).model_dump(mode="json")
            db.execute("INSERT INTO assets VALUES (?,?,?,1,'2026-01-01','2026-01-01')", (rid, str(uuid4()), encoded(p)))
        from backend.property import _table
        _table(db)
        db.execute("INSERT INTO property_detail VALUES (?,?,1,'2026-01-01')", (invited.home_id, encoded({"tenure": "live", "loan_ids": [], "deposit_asset_id": None})))
        property_move._table(db)
        for who in ("me", "partner", "together"):
            plan = property_move.MoveInput(candidates=[property_move.Candidate(id=invited.candidate_id, name="합성 후보", price=20000)],
                                           source_home_ids=[invited.home_id]).model_dump(mode="json", exclude={"version"})
            db.execute("INSERT INTO property_move VALUES (?,?,1,'2026-01-01')", (who, encoded(plan)))
            db.execute("INSERT INTO property_track VALUES (?,?,?,?)", (who, invited.candidate_id, "2026-01-01", encoded({"price": 20000, "price_basis": "manual", "note": "합성"})))
    invited.data_store = DataStore(invited.config.db_path)
    yield invited


@pytest.fixture
def partner(client, setup, data_env):
    invitation = issue(client, data_env)
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as p:
        assert accept(p, setup, data_env, invitation).status_code == 303
        session = p.get("/api/auth/session").json()
        p.headers.update({"Origin": ORIGIN, "X-Retire-CSRF": session["csrf_token"]})
        yield p


def preview(client, env):
    r = client.post(ROOT + "/migration/preview", headers=env.headers)
    assert r.status_code == 200, r.text
    return r.json()


def migrate(client, env, plan=None, **kw):
    plan = plan or preview(client, env)
    request = {"operation_id": str(uuid4()), "preview_id": plan["preview_id"], **kw}
    r = client.post(ROOT + "/migration/commit", headers=env.headers, json=request)
    assert r.status_code == 200, r.text
    return r.json(), request


def find(state, kind, rid=None):
    return next(r for r in state["records"] if r["kind"] == kind and (rid is None or r["id"] == rid))


def save_request(result, record):
    return {"operation_id": str(uuid4()), "expected_revision": result["revision"], "upsert": [record]}


def test_inventory_backup_migration_two_people_and_relogin(client, setup, data_env, partner):
    env = data_env
    original = storage.DB_PATH.read_bytes()
    legacy = deepcopy(env.fake.files[SID]["tabs"])
    p = preview(client, env)
    assert env.fake.writes == 0 and p["requires_confirmation"]
    assert all(n > 0 for n in p["local"]["counts"].values())
    backup = env.data_store.load_backup(p["preview_id"])
    with sqlite3.connect(":memory:") as restored, sqlite3.connect(storage.DB_PATH) as source:
        restored.deserialize(base64.b64decode(backup["archive"]["financial.sqlite3"]))
        assert list(restored.iterdump()) == list(source.iterdump())
    assert not any("auth" in k or "token" in k for k in backup["archive"])
    assert (env.data_store.backup_dir / (p["preview_id"] + ".json")).stat().st_mode & 0o777 == 0o600
    result, request = migrate(client, env, p)
    assert result["summary"] == p["proposed"]
    assert result["summary"]["holding_values"] == {"owner_cash": 600}
    assert storage.DB_PATH.read_bytes() == original
    assert all(env.fake.files[SID]["tabs"][t] == rows for t, rows in legacy.items())
    theirs = partner.get(ROOT)
    assert theirs.status_code == 200, theirs.text
    theirs = theirs.json()
    assert theirs["state"] == result["state"] and theirs["summary"] == result["summary"]
    assert theirs["viewer"]["me"] == result["viewer"]["partner"]
    assert theirs["viewer"]["retirement_reference_member_id"] == result["viewer"]["me"]
    assert theirs["viewer"]["joint_share_reference_member_id"] == result["viewer"]["me"]
    assert find(theirs["state"], "asset", env.home_id)["payload"]["share_percent"] == 40
    login(partner, setup, sub="partner-sub", email="changed@example.test")
    assert partner.get(ROOT).json()["state"] == result["state"]
    replay = client.post(ROOT + "/migration/commit", headers=env.headers, json=request)
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert env.fake.writes == 1
    assert client.post(ROOT + "/migration/preview", headers=env.headers).status_code == 409
    assert client.get("/api/local").status_code == 409
    assert partner.get("/api/local").status_code == 403


def test_permissions_and_shared_plan_edits(client, data_env, partner):
    env = data_env
    result, _ = migrate(client, env)
    record = deepcopy(find(result["state"], "pension", result["viewer"]["partner"]))
    record["payload"]["national_monthly"] = 777
    req = save_request(result, record)
    assert client.post(ROOT + "/save", headers=env.headers, json=req).status_code == 403
    assert partner.put(ROOT + "/permissions", json={"allow_other": True}).status_code == 200
    r = client.post(ROOT + "/save", headers=env.headers, json=req)
    assert r.status_code == 200, r.text
    assert find(partner.get(ROOT).json()["state"], "pension", record["id"])["payload"]["national_monthly"] == 777
    assert partner.put(ROOT + "/permissions", json={"allow_other": False}).status_code == 200
    record["payload"]["national_monthly"] = 888
    assert client.post(ROOT + "/save", headers=env.headers, json=save_request(r.json(), record)).status_code == 403
    own = partner.post(ROOT + "/save", json=save_request(r.json(), record))
    assert own.status_code == 200, own.text
    plan = deepcopy(find(own.json()["state"], "property_plan", "household"))
    plan["payload"]["monthly_saving"] = 123
    changed = partner.post(ROOT + "/save", json=save_request(own.json(), plan))
    assert changed.status_code == 200, changed.text
    assert find(client.get(ROOT).json()["state"], "property_plan", "household")["payload"]["monthly_saving"] == 123
    assert "Bearer synthetic-partner-token" in env.fake.actors


@pytest.mark.parametrize("path", ["/migration/preview", "/migration/commit", "/save", "/recovery"])
def test_csrf_rejected_before_any_write(client, data_env, path):
    r = client.post(ROOT + path, json={})
    assert r.status_code == 403
    assert data_env.fake.writes == 0


@pytest.mark.parametrize("mutation", ["amount", "foreign", "rename", "dangling", "rules", "pool"])
def test_invalid_or_unauthorized_changes(client, data_env, mutation):
    result, _ = migrate(client, data_env)
    r = deepcopy(find(result["state"], "asset", data_env.asset_id))
    if mutation == "amount":
        r["payload"]["amount"] = -1
    elif mutation == "foreign":
        r["member_id"] = str(uuid4())
    elif mutation == "rename":
        r["member_id"] = result["viewer"]["partner"]
    elif mutation == "dangling":
        r["payload"]["account_id"] = "missing"
    elif mutation == "rules":
        r = deepcopy(find(result["state"], "rules"))
        from hashlib import sha256
        r["payload"] = {"text": "different", "sha256": sha256(b"different").hexdigest()}
    else:
        r = deepcopy(find(result["state"], "pool"))
        r["payload"]["mode"] = "buy_only"
    response = client.post(ROOT + "/save", headers=data_env.headers, json=save_request(result, r))
    assert response.status_code in (403, 409), response.text
    assert data_env.fake.writes == 1


@pytest.mark.parametrize("failure", ["lost", "before"])
def test_uncertain_commit_never_retransmits_and_can_recover(client, data_env, failure):
    env = data_env
    p = preview(client, env)
    env.fake.write_failure = failure
    req = {"operation_id": str(uuid4()), "preview_id": p["preview_id"]}
    r = client.post(ROOT + "/migration/commit", headers=env.headers, json=req)
    assert r.status_code == (200 if failure == "lost" else 409), r.text
    for _ in range(2):
        again = client.post(ROOT + "/migration/commit", headers=env.headers, json=req)
        assert again.status_code == r.status_code
    assert env.fake.writes == 1
    env.fake.write_failure = None
    if failure == "before":
        status = client.get(ROOT + "/recovery").json()
        bid = next(b["id"] for b in status["backups"] if b["kind"] == "migration")
        recover = client.post(ROOT + "/recovery", headers=env.headers, json={"operation_id": str(uuid4()),
            "expected_revision": status["revision"], "backup_id": bid, "version": "proposed"})
        assert recover.status_code == 200, recover.text
        assert recover.json()["summary"] == p["proposed"]


def test_stale_revision_and_simultaneous_save(client, data_env):
    env = data_env
    result, _ = migrate(client, env)
    record = deepcopy(find(result["state"], "profile", result["viewer"]["me"]))
    record["payload"]["name"] = "수정"
    req = save_request(result, record)
    entered, release = threading.Event(), threading.Event()
    env.fake.pause_append = entered, release
    with ThreadPoolExecutor(2) as pool:
        future = pool.submit(client.post, ROOT + "/save", headers=env.headers, json=req)
        try:
            assert entered.wait(10)
            concurrent = client.post(ROOT + "/save", headers=env.headers, json={**req, "operation_id": str(uuid4())})
            assert concurrent.status_code == 409, concurrent.text
        finally:
            release.set()
        first = future.result()
        assert first.status_code == 200, first.text
    assert client.post(ROOT + "/save", headers=env.headers, json={**req, "operation_id": str(uuid4())}).status_code == 409
    replay = client.post(ROOT + "/save", headers=env.headers, json=req)
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert env.fake.writes == 2


def test_direct_edit_during_append_preserved_and_recovered(client, data_env):
    env = data_env
    result, _ = migrate(client, env)
    record = deepcopy(find(result["state"], "profile", result["viewer"]["me"]))
    record["payload"]["name"] = "앱 수정"
    def direct_edit(tabs):
        state = json.loads(tabs[TAB][1][5])
        find(state, "profile", result["viewer"]["me"])["payload"]["name"] = "시트 수정"
        tabs[TAB][1][5] = encoded(state)
    env.fake.before_append = direct_edit
    r = client.post(ROOT + "/save", headers=env.headers, json=save_request(result, record))
    assert r.status_code == 409, r.text
    assert client.get(ROOT).status_code == 409
    raw = deepcopy(env.fake.files[SID]["tabs"][TAB])
    assert "시트 수정" in raw[1][5] and "앱 수정" in raw[2][5]
    status = client.get(ROOT + "/recovery").json()
    bid = next(b["id"] for b in status["backups"] if b["kind"] == "save")
    r = client.post(ROOT + "/recovery", headers=env.headers, json={"operation_id": str(uuid4()),
        "expected_revision": status["revision"], "backup_id": bid, "version": "before"})
    assert r.status_code == 200, r.text
    assert env.fake.files[SID]["tabs"][TAB][:len(raw)] == raw
    assert r.json()["state"] == result["state"]


@pytest.mark.parametrize("code", [401, 403, 404, 429, 503])
def test_remote_failures_do_not_fall_back(client, data_env, code):
    result, _ = migrate(client, data_env)
    data_env.fake.status = code
    r = client.get(ROOT)
    assert r.status_code in (409, 503), r.text
    assert "provider" not in r.text
    assert data_env.data_store.binding(1)["spreadsheet_id"] == SID
    assert data_env.data_store.started(1)
    assert client.get("/api/family").status_code == 409


@pytest.mark.parametrize("corruption", ["json", "header", "partial", "missing_tab", "header_only", "empty_tab"])
def test_corrupted_journal_explicit_recovery(client, data_env, corruption):
    env = data_env
    result, _ = migrate(client, env)
    tabs = env.fake.files[SID]["tabs"]
    if corruption == "json":
        tabs[TAB][1][5] = "broken JSON"
    elif corruption == "header":
        tabs[TAB][0][0] = "changed header"
    elif corruption == "partial":
        tabs[TAB].append(["partial"])
    elif corruption == "header_only":
        tabs[TAB] = [["damaged header"]]
    elif corruption == "empty_tab":
        tabs[TAB] = []
    else:
        del tabs[TAB]
        del env.fake.ids[TAB]
    assert client.get(ROOT).status_code == 409
    old = deepcopy(tabs.get(TAB, []))
    status = client.get(ROOT + "/recovery").json()
    r = client.post(ROOT + "/recovery", headers=env.headers, json={"operation_id": str(uuid4()),
        "expected_revision": status["revision"], "backup_id": result["backup_id"], "version": "proposed"})
    assert r.status_code == 200, r.text
    assert r.json()["state"] == result["state"]
    assert tabs[TAB][:len(old)] == old
    assert client.get(ROOT).json()["state"] == result["state"]


@pytest.mark.parametrize("source", ["sqlite", "yaml", "snapshot", "sheet"])
def test_source_changed_after_preview_is_not_migrated(client, setup, data_env, source):
    p = preview(client, data_env)
    if source == "sqlite":
        with storage.connection() as db:
            db.execute("UPDATE family SET version=version+1")
    elif source == "yaml":
        path = setup.path / "accounts.yaml"
        path.write_text(path.read_text() + "\n# changed\n")
    elif source == "snapshot":
        (setup.path / "snapshots" / "owner_cash" / "2026-01-02.csv").write_text("account_id,ticker_name,ticker,qty,price\nowner_cash,새 종목,000002,1,1\n")
    else:
        data_env.fake.files[SID]["tabs"][sheets.ASSET_TAB][0].append("extra")
    r = client.post(ROOT + "/migration/commit", headers=data_env.headers,
                    json={"operation_id": str(uuid4()), "preview_id": p["preview_id"]})
    assert r.status_code == 409, r.text
    assert data_env.fake.writes == 0


def add_sheet_asset(env, row):
    env.fake.files[SID]["tabs"][sheets.ASSET_TAB].append([row.get(k, "") if row.get(k) is not None else "" for k in sheets.ASSET_COLUMNS])


def test_existing_sheet_conflict_requires_choice_and_preserves_original(client, data_env):
    env = data_env
    p = preview(client, env)
    row = find(p["state"], "asset", env.asset_id)
    add_sheet_asset(env, {**row["payload"], "id": row["id"], "owner": "me", "amount": 987})
    p = preview(client, env)
    assert len(p["conflicts"]) == 1
    req = {"operation_id": str(uuid4()), "preview_id": p["preview_id"]}
    assert client.post(ROOT + "/migration/commit", headers=env.headers, json=req).status_code == 409
    result, _ = migrate(client, env, p, choices={p["conflicts"][0]["key"]: "sheet"})
    assert find(result["state"], "asset", env.asset_id)["payload"]["amount"] == 987
    assert result["summary"]["totals"][result["viewer"]["me"]]["assets"] == 987
    assert env.fake.files[SID]["tabs"][sheets.ASSET_TAB][-1][7] == 987


def test_duplicate_sheet_ids_do_not_disappear_in_merge(client, data_env):
    p = preview(client, data_env)
    row = find(p["state"], "asset", data_env.asset_id)
    for _ in range(2):
        add_sheet_asset(data_env, {**row["payload"], "id": row["id"], "owner": "me"})
    r = client.post(ROOT + "/migration/preview", headers=data_env.headers)
    assert r.status_code == 409, r.text


@pytest.mark.parametrize("field,value", [("purchase_price", -1), ("tenure", "invalid"), ("area_m2", -20), ("loan_ids", ["missing"]), ("secret", "not-allowed")])
def test_property_detail_domain_validation(client, data_env, field, value):
    result, _ = migrate(client, data_env)
    record = deepcopy(find(result["state"], "property_detail"))
    record["payload"][field] = value
    r = client.post(ROOT + "/save", headers=data_env.headers, json=save_request(result, record))
    assert r.status_code == 409, r.text
    assert data_env.fake.writes == 1


@pytest.mark.parametrize("kind", ["profile", "asset", "property_plan", "retirement"])
def test_noncanonical_input_is_rejected_or_normalized(client, data_env, kind):
    result, _ = migrate(client, data_env)
    record = deepcopy(find(result["state"], kind))
    if kind == "profile":
        record = deepcopy(find(result["state"], kind, result["viewer"]["me"]))
        record["payload"] = {"name": "  정규 이름  "}
    elif kind == "asset":
        record["payload"]["share_percent"] = True
    elif kind == "property_plan":
        record = deepcopy(find(result["state"], kind, "household"))
        record["payload"]["candidates"][0]["area_m2"] = "20"
    else:
        record["payload"]["return_rate"] = "0.03"
    r = client.post(ROOT + "/save", headers=data_env.headers, json=save_request(result, record))
    if r.status_code == 200:
        p = find(r.json()["state"], kind, record["id"])["payload"]
        if kind == "profile":
            assert p["name"] == "정규 이름"
        elif kind == "property_plan":
            assert p["candidates"][0]["area_m2"] == 20
        elif kind == "retirement":
            assert p["return_rate"] == 0.03
        else:
            pytest.fail("boolean money/share accepted")
    else:
        assert r.status_code in (403, 409, 422)


def test_backup_tamper_denies_recovery_without_writing(client, data_env):
    result, _ = migrate(client, data_env)
    backup = data_env.data_store.backup_dir / (result["backup_id"] + ".json")
    backup.write_text(backup.read_text() + " ")
    r = client.post(ROOT + "/recovery", headers=data_env.headers, json={"operation_id": str(uuid4()),
        "expected_revision": result["revision"], "backup_id": result["backup_id"], "version": "proposed"})
    assert r.status_code == 409
    assert data_env.fake.writes == 1


def test_operation_id_reuse_and_partner_admin_denied(client, data_env, partner):
    result, req = migrate(client, data_env)
    assert client.post(ROOT + "/migration/commit", headers=data_env.headers, json={**req, "choices": {"fake": "local"}}).status_code == 409
    for path in ("/migration/preview", "/migration/commit", "/recovery"):
        body = req if path == "/migration/commit" else {"operation_id": str(uuid4()), "expected_revision": result["revision"], "backup_id": result["backup_id"]}
        assert partner.post(ROOT + path, json=body).status_code == 403
    assert partner.get(ROOT + "/recovery").status_code == 403
    assert partner.get(ROOT + "/recovery/" + result["backup_id"]).status_code == 403
    with TestClient(app, base_url=ORIGIN) as stranger:
        assert stranger.get(ROOT).status_code == 401
        assert stranger.get(ROOT + "/recovery").status_code == 401


@pytest.mark.parametrize("cash", [None, 0])
def test_real_property_track_shape_preserves_unknowns_and_negative_gap(client, data_env, cash):
    base = dict(sale_value=50000, loans=60000, deposit=0, sale_costs=None, cash=cash,
                new_loan=0, monthly=0, target_month=None)
    entry = property_move._entry(base, {"purchase_costs": None}, price=20000, basis="manual", price_date=None, note="")
    assert entry["gap"] < 0 and entry["home_net"] < 0
    with storage.connection() as db:
        db.execute("UPDATE property_track SET payload=?", (encoded(entry),))
    result, _ = migrate(client, data_env)
    assert find(result["state"], "property_track")["payload"]["entry"] == entry


def test_nonfinite_json_returns_controlled_error(client, data_env):
    result, _ = migrate(client, data_env)
    record = deepcopy(find(result["state"], "retirement"))
    record["payload"]["return_rate"] = float("nan")
    r = client.post(ROOT + "/save", headers={**data_env.headers, "Content-Type": "application/json"},
                    content=json.dumps(save_request(result, record)))
    assert r.status_code == 409, r.text
    assert data_env.fake.writes == 1


def test_recovery_does_not_bypass_partner_permission(client, data_env, partner):
    env = data_env
    result, _ = migrate(client, env)
    record = deepcopy(find(result["state"], "pension", result["viewer"]["partner"]))
    record["payload"]["national_monthly"] = 300
    r = partner.post(ROOT + "/save", json=save_request(result, record))
    assert r.status_code == 200, r.text
    req = {"operation_id": str(uuid4()), "expected_revision": r.json()["revision"],
           "backup_id": r.json()["backup_id"], "version": "before"}
    assert client.post(ROOT + "/recovery", headers=env.headers, json=req).status_code == 403
    # A deleted remote tab must not bypass the same permission boundary.
    del env.fake.files[SID]["tabs"][TAB]
    del env.fake.ids[TAB]
    req["expected_revision"] = fingerprint([])
    assert client.post(ROOT + "/recovery", headers=env.headers, json=req).status_code == 403
    assert partner.put(ROOT + "/permissions", json={"allow_other": True}).status_code == 200
    assert client.post(ROOT + "/recovery", headers=env.headers, json=req).status_code == 200


def test_valid_direct_sheet_edit_reflected_and_stale_app_write_rejected(client, data_env):
    result, _ = migrate(client, data_env)
    raw = data_env.fake.files[SID]["tabs"][TAB]
    state = json.loads(raw[1][5])
    find(state, "retirement")["payload"]["monthly_need"] = 777
    raw[1][5] = encoded(state)
    updated = client.get(ROOT)
    assert updated.status_code == 200
    assert find(updated.json()["state"], "retirement")["payload"]["monthly_need"] == 777
    record = find(result["state"], "retirement")
    assert client.post(ROOT + "/save", headers=data_env.headers, json=save_request(result, record)).status_code == 409


def test_many_chunks_atomic_and_formula_text_stays_literal(client, data_env):
    result, _ = migrate(client, data_env)
    records = []
    for i in range(200):
        r = deepcopy(find(result["state"], "asset", data_env.asset_id))
        r["id"] = str(uuid4())
        r["payload"].update(account=f"synthetic-{i}", name="=IMPORTDATA('synthetic')")
        records.append(r)
    req = {"operation_id": str(uuid4()), "expected_revision": result["revision"], "upsert": records}
    r = client.post(ROOT + "/save", headers=data_env.headers, json=req)
    assert r.status_code == 200, r.text
    assert r.json()["summary"]["counts"]["asset"] == 202
    raw = data_env.fake.files[SID]["tabs"][TAB]
    assert len([row for row in raw if row[0] == req["operation_id"]]) > 1
    assert client.get(ROOT).json()["state"] == r.json()["state"]


def test_independent_process_lock_blocks_migration(client, data_env):
    code = """
from pathlib import Path
import sys
from backend.shared_data_store import DataStore
with DataStore(Path(sys.argv[1])).operation():
    print('locked', flush=True)
    sys.stdin.readline()
"""
    process = subprocess.Popen([sys.executable, "-c", code, str(data_env.config.db_path)], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert select.select([process.stdout], [], [], 10)[0]
        assert process.stdout.readline().strip() == "locked"
        r = client.post(ROOT + "/migration/preview", headers=data_env.headers)
        assert r.status_code == 409 and data_env.fake.writes == 0
    finally:
        process.communicate("release\n", timeout=10)
    assert process.returncode == 0
    migrate(client, data_env)


def test_fixed_people_cannot_be_reassigned_and_revoked_partner_cannot_read(client, data_env, partner):
    result, _ = migrate(client, data_env)
    with data_env.data_store.connection() as db:
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE shared_people SET member_id=? WHERE role='partner'", (str(uuid4()),))
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE shared_people SET user_id=? WHERE role='partner'", (str(uuid4()),))
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("DELETE FROM shared_people WHERE role='partner'")
        db.execute("UPDATE memberships SET active=0 WHERE role='partner'")
    assert partner.get(ROOT).status_code == 401
    assert client.get(ROOT).json()["state"] == result["state"]


def test_readback_mismatch_not_marked_complete(client, data_env):
    env = data_env
    result, _ = migrate(client, env)
    r = deepcopy(find(result["state"], "retirement"))
    r["payload"]["monthly_need"] = 555
    req = save_request(result, r)
    def change_saved(tabs):
        state = json.loads(tabs[TAB][-1][5])
        find(state, "retirement")["payload"]["monthly_need"] = 999
        tabs[TAB][-1][5] = encoded(state)
    env.fake.after_append = change_saved
    response = client.post(ROOT + "/save", headers=env.headers, json=req)
    assert response.status_code == 409
    assert env.data_store.receipt(req["operation_id"])["status"] == "pending"
    assert client.post(ROOT + "/save", headers=env.headers, json=req).status_code == 409
    assert env.fake.writes == 2


def test_backup_failure_precedes_remote_mutation(client, data_env, monkeypatch):
    p = preview(client, data_env)
    def unavailable(*args, **kwargs):
        raise OSError("private filesystem information")
    monkeypatch.setattr(DataStore, "backup", unavailable)
    r = client.post(ROOT + "/migration/commit", headers=data_env.headers,
                    json={"operation_id": str(uuid4()), "preview_id": p["preview_id"]})
    assert r.status_code == 409 and "private filesystem" not in r.text
    assert data_env.fake.writes == 0 and not data_env.data_store.started(1)


def test_root_detail_and_debt_totals_are_not_double_counted(client, data_env):
    env = data_env
    result, _ = migrate(client, env)
    root = deepcopy(find(result["state"], "asset", env.asset_id))
    child = deepcopy(root)
    child["id"] = str(uuid4())
    child["payload"].update(parent_id=root["id"], amount=100, name="세부")
    root["payload"]["valuation_source"] = "details"
    debt = deepcopy(find(result["state"], "asset", env.home_id))
    debt["id"] = str(uuid4())
    debt["payload"].update(pocket="debt", assetClass="debt", amount=2000)
    req = {"operation_id": str(uuid4()), "expected_revision": result["revision"], "upsert": [root, child, debt]}
    r = client.post(ROOT + "/save", headers=env.headers, json=req)
    assert r.status_code == 200, r.text
    assert r.json()["summary"]["totals"][result["viewer"]["me"]] == {"assets": 100, "debt": 0}
    assert r.json()["summary"]["totals"]["joint"] == {"assets": 10000, "debt": 2000}
    delete = {"operation_id": str(uuid4()), "expected_revision": r.json()["revision"], "delete": [{"kind": "asset", "id": child["id"]}]}
    assert client.post(ROOT + "/save", headers=env.headers, json=delete).status_code == 409


@pytest.mark.parametrize("source", ["snapshot_amount", "unknown_account", "symlink", "malformed_db"])
def test_bad_sources_fail_without_changing_them(client, setup, data_env, source):
    snapshot = setup.path / "snapshots" / "owner_cash" / "2026-01-01.csv"
    if source == "snapshot_amount":
        snapshot.write_text(snapshot.read_text().replace(",600,", ",601,"))
    elif source == "unknown_account":
        data_env.fake.files[SID]["tabs"][sheets.HOLDING_TAB].append(["missing", "합성", "000001", 1, 10, "", "", 10])
    elif source == "symlink":
        snapshot.unlink()
        snapshot.symlink_to(setup.path / "accounts.yaml")
    else:
        storage.DB_PATH.write_bytes(b"invalid sqlite")
    original = storage.DB_PATH.read_bytes()
    r = client.post(ROOT + "/migration/preview", headers=data_env.headers)
    assert r.status_code == 409, r.text
    assert data_env.fake.writes == 0 and storage.DB_PATH.read_bytes() == original
