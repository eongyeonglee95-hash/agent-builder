"""SHARE-07 cross-feature flows. All identities, Google HTTP and files are fake.

These tests do not count as two real Google accounts, real TLS or UI integration.
"""
from copy import deepcopy
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend import storage
from backend.main import app
from backend.shared_data_google import TAB
from backend.shared_preflight import INTEGRATION_GAPS
from tests.test_web_auth import signing_material, setup, client, login, begin, finish, ORIGIN
from tests.test_household_invites import invited, issue, accept
from tests.test_shared_sheets import SID
from tests.test_shared_data import data_env, partner, migrate, find, save_request

ROOT = "/api/shared-data"
INVITES = "/api/auth/invitations"


def test_two_sessions_plan_save_lost_reply_corruption_recovery_and_revoke(client, setup, data_env, partner):
    env = data_env
    originals = storage.DB_PATH.read_bytes()
    migrated, _ = migrate(client, env)
    canonical = deepcopy(migrated["state"])
    members = canonical["members"]
    other = partner.get(ROOT).json()
    assert other["state"] == canonical
    # Save multiple areas with the same fixed person and a single revision.
    records = [deepcopy(find(other["state"], kind, members["partner"])) for kind in ("profile", "pension", "property_plan")]
    records[0]["payload"]["name"] = "합성 배우자 수정"
    records[1]["payload"]["national_monthly"] = 321
    records[2]["payload"]["monthly_saving"] = 456
    request = dict(operation_id=str(uuid4()), expected_revision=other["revision"], upsert=records)
    env.fake.write_failure = "lost"
    result = partner.post(ROOT + "/save", json=request)
    assert result.status_code == 200, result.text
    saved = result.json()
    writes = env.fake.writes
    env.fake.write_failure = None
    assert partner.post(ROOT + "/save", json=request).json()["replayed"]
    assert env.fake.writes == writes  # reply loss must not append twice
    assert client.get(ROOT).json()["state"] == saved["state"]
    stale = deepcopy(find(canonical, "profile", members["me"]))
    stale["payload"]["age"] = 41
    assert client.post(ROOT + "/save", headers=env.headers, json=save_request(migrated, stale)).status_code == 409
    # Damage the wire representation, not a mocked service response.
    tabs = env.fake.files[SID]["tabs"]
    tabs[TAB].append(["partial synthetic row"])
    damaged = deepcopy(tabs[TAB])
    assert partner.get(ROOT + "/dashboard").status_code == 409
    assert client.get(ROOT + "/dashboard").status_code == 409
    status = client.get(ROOT + "/recovery").json()
    recovery = dict(operation_id=str(uuid4()), expected_revision=status["revision"],
                    backup_id=saved["backup_id"], version="before")
    # Recovery cannot erase a partner's latest edits without that person's grant.
    assert client.post(ROOT + "/recovery", headers=env.headers, json=recovery).status_code == 403
    assert partner.put(ROOT + "/permissions", json={"allow_other": True}).status_code == 200
    restored = client.post(ROOT + "/recovery", headers=env.headers, json=recovery)
    assert restored.status_code == 200, restored.text
    assert restored.json()["state"] == canonical
    assert tabs[TAB][:len(damaged)] == damaged
    assert partner.get(ROOT).json()["state"] == canonical
    assert partner.get(ROOT).json()["summary"] == migrated["summary"]
    # Two new sessions retain fixed financial identities; an uninvited third cannot enter.
    login(partner, setup, sub="partner-sub", email="partner@example.test")
    assert partner.get(ROOT).json()["viewer"]["me"] == members["partner"]
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as stranger:
        assert finish(stranger, begin(stranger, setup, sub="stranger", email="stranger@example.test")).status_code == 403
        assert stranger.get(ROOT).status_code == 401
        assert stranger.get(ROOT + "/recovery").status_code == 401
    second_cookie = env.store.login("partner-sub", "partner@example.test", False, "")
    env.fake.fail_delete = True
    invitation = client.get(INVITES).json()["invitations"][0]
    revoked = client.post(INVITES + "/" + invitation["id"] + "/revoke", headers=env.headers)
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["invitation"]["cleanup"] == "pending"
    assert partner.get(ROOT).status_code == 401 and env.store.session(second_cookie) is None
    assert client.get(ROOT).json()["state"] == canonical
    env.fake.fail_delete = False
    assert client.post(INVITES + "/" + invitation["id"] + "/revoke", headers=env.headers).json()["invitation"]["cleanup"] == "done"
    assert len(env.fake.permissions) == 1 and env.store.binding(1)["spreadsheet_id"] == SID
    assert storage.DB_PATH.read_bytes() == originals


def test_reinvite_same_google_person_preserves_all_financial_ownership(client, setup, data_env, partner):
    result, _ = migrate(client, data_env)
    old_membership = partner.get("/api/auth/session").json()["member_id"]
    invitation = client.get(INVITES).json()["invitations"][0]
    assert client.post(INVITES + "/" + invitation["id"] + "/revoke", headers=data_env.headers).status_code == 200
    second = issue(client, data_env)
    assert accept(partner, setup, data_env, second).status_code == 303
    assert partner.get("/api/auth/session").json()["member_id"] != old_membership
    assert partner.get(ROOT).json()["state"] == result["state"]
    assert partner.get(ROOT).json()["viewer"]["me"] == result["viewer"]["partner"]
    assert partner.get(ROOT + "/dashboard?owner=me").json()["snapshot"]["total"] == 6000


@pytest.mark.parametrize("method,path", [request for gap in INTEGRATION_GAPS for request in gap["requests"]])
def test_unconverted_financial_surfaces_stay_closed_for_both_people(client, data_env, partner, method, path):
    """A passing denial is a safety check, NOT evidence of a working financial UI."""
    # Ensure the gap inventory names real routes, not accidental 404s.
    assert method.lower() in app.openapi()["paths"].get(path, {})
    result, _ = migrate(client, data_env)
    original = storage.DB_PATH.read_bytes()
    owner = client.request(method, path, headers=data_env.headers, json={} if method != "GET" else None)
    spouse = partner.request(method, path, json={} if method != "GET" else None)
    assert owner.status_code == 409 and spouse.status_code == 403
    assert client.get(ROOT).json()["state"] == result["state"]
    assert data_env.fake.writes == 1 and storage.DB_PATH.read_bytes() == original
    assert owner.headers["cache-control"] == spouse.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("key,project", [(" ", "123"), ("synthetic", "１２３"), ("synthetic", "0")])
def test_invalid_picker_config_cannot_release_access_token(client, data_env, monkeypatch, key, project):
    monkeypatch.setenv("RETIRE_GOOGLE_PICKER_API_KEY", key)
    monkeypatch.setenv("RETIRE_GOOGLE_PROJECT_NUMBER", project)
    response = client.post("/api/google/shared/picker", headers=data_env.headers)
    assert response.status_code == 503
    assert "access_token" not in response.json()


def test_https_session_shared_reads_csrf_and_protocol_boundary(client, setup, data_env, monkeypatch):
    migrated, _ = migrate(client, data_env)
    secure_origin = "https://app.example"
    monkeypatch.setenv("RETIRE_AUTH_ORIGIN", secure_origin)
    monkeypatch.setenv("RETIRE_AUTH_BOOTSTRAP", "0")
    monkeypatch.setenv("RETIRE_AUTH_ALLOW_HTTP", "0")
    with TestClient(app, base_url=secure_origin, follow_redirects=False) as secure:
        params = begin(secure, setup)
        response = finish(secure, params)
        assert response.status_code == 303
        cookie = next(v for v in response.headers.get_list("set-cookie") if v.startswith("__Host-retire_session="))
        assert all(v in cookie.lower() for v in ("secure", "httponly", "samesite=lax", "path=/"))
        assert "domain=" not in cookie.lower()
        data = secure.get(ROOT)
        assert data.status_code == 200 and data.json()["state"] == migrated["state"]
        assert data.headers["cache-control"] == "no-store"
        assert data.headers["referrer-policy"] == "no-referrer"
        session = secure.get("/api/auth/session").json()
        headers = {"Origin": secure_origin, "X-Retire-CSRF": session["csrf_token"]}
        assert secure.put(ROOT + "/permissions", headers=headers, json={"allow_other": True}).status_code == 200
        assert secure.put(ROOT + "/permissions", json={"allow_other": False}).status_code == 403
        for bad in ({"Origin": "https://evil.example"}, {"Host": "evil.example"}, {"Sec-Fetch-Site": "cross-site"}):
            denied = secure.get(ROOT, headers=bad)
            assert denied.status_code in (400, 403) and "state" not in denied.json()
        assert secure.get("http://app.example" + ROOT).status_code == 400
        assert data_env.fake.writes == 1
