"""부동산 메뉴 API — 집 한 번 등록이 장부(집·대출·보증금)와 집 정보로 나뉘어 저장되는지. 임시 DB, 네트워크 없음."""
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

from backend import storage
from backend.main import app

TODAY = date.today().isoformat()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("RETIRE_SHEETS", "off")
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "ledger.sqlite3")
    from backend import property as prop
    monkeypatch.setattr(prop, "ENV_PATH", tmp_path / ".env")   # 실제 .env를 읽지 않는다
    monkeypatch.setattr(prop, "ROOT_ENV_PATH", tmp_path / "root.env")
    with TestClient(app, base_url="http://127.0.0.1", headers={"Origin": "http://127.0.0.1", "X-Retire-Local": "1"}) as c:
        yield c


def home(**kw):
    body = {"name": "헬리오시티", "owner": "joint", "share_percent": 50, "value": 1_000_000_000, "as_of": TODAY,
            "address": {"road": "서울 송파구 송파대로 345", "building": "헬리오시티", "bcode": "1171010700", "apartment": True},
            "area_m2": 84.9, "purchase_price": 800_000_000, "purchase_month": "2019-05", "tenure": "live"}
    return {**body, **kw}


def debt(c, name, amount, owner="me"):
    r = c.post("/api/assets", json={"request_id": str(uuid.uuid4()), "name": name, "account": name, "owner": owner, "pocket": "debt",
                                    "assetClass": "debt", "amount": amount, "as_of": TODAY})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_links_loans_and_reaches_ledger(client):
    old = debt(client, "주택담보대출", 300_000_000)
    rid = str(uuid.uuid4())
    body = home(request_id=rid, loan_ids=[old["id"]], new_loans=[{"name": "신용대출", "amount": 20_000_000}])
    r = client.post("/api/property", json=body)
    assert r.status_code == 201, r.text
    h = r.json()
    assert h["metrics"]["gain"] == 200_000_000 and h["metrics"]["equity"] == 680_000_000
    assert h["detail"]["pyeong"] == 25.7 and len(h["loans"]) == 2
    # 같은 요청 재시도는 새 행을 만들지 않는다
    assert client.post("/api/property", json=body).status_code == 201
    dash = client.get("/api/dashboard").json()
    assert dash["property"] == 1_000_000_000 and dash["debt"] == 320_000_000
    # 내 몫: 집 50%, 내 명의 대출 3억 전체 + 공동 새 대출 50%
    mine = client.get("/api/property?owner=me").json()
    assert mine["total"]["value"] == 500_000_000
    assert mine["total"]["loans"] == 310_000_000 and mine["total"]["equity"] == 190_000_000
    assert client.get("/api/property").json()["free_loans"] == []


def test_jeonse_deposit_becomes_debt_row_and_follows_edits(client):
    h = client.post("/api/property", json=home(request_id=str(uuid.uuid4()), owner="me", share_percent=None,
                                               tenure="jeonse", deposit=600_000_000)).json()
    assert h["deposit"]["amount"] == 600_000_000
    assert client.get("/api/dashboard").json()["debt"] == 600_000_000
    upd = home(owner="me", share_percent=None, tenure="monthly", deposit=100_000_000, monthly_rent=2_000_000,
               version=h["asset"]["version"], detail_version=h["detail"]["version"])
    h2 = client.put(f"/api/property/{h['asset']['id']}", json=upd).json()
    assert h2["deposit"]["amount"] == 100_000_000 and h2["detail"]["monthly_rent"] == 2_000_000
    # 실거주로 바꾸면 보증금 행이 사라진다
    live = home(owner="me", share_percent=None, version=h2["asset"]["version"], detail_version=h2["detail"]["version"])
    h3 = client.put(f"/api/property/{h['asset']['id']}", json=live).json()
    assert h3["deposit"] is None and client.get("/api/dashboard").json()["debt"] == 0
    # 오래된 version으로는 못 고친다
    assert client.put(f"/api/property/{h['asset']['id']}", json=live).status_code == 409


def test_loan_cannot_belong_to_two_homes_and_delete_keeps_loans(client):
    loan = debt(client, "주담대", 100_000_000)
    a = client.post("/api/property", json=home(request_id=str(uuid.uuid4()), loan_ids=[loan["id"]])).json()
    r = client.post("/api/property", json=home(name="두번째 집", request_id=str(uuid.uuid4()), loan_ids=[loan["id"]]))
    assert r.status_code == 409
    assert client.delete(f"/api/property/{a['asset']['id']}?version={a['asset']['version']}").status_code == 204
    left = client.get("/api/property").json()
    assert left["homes"] == [] and [l["id"] for l in left["free_loans"]] == [loan["id"]]


def test_plain_registered_home_shows_without_detail(client):
    r = client.post("/api/assets", json={"request_id": str(uuid.uuid4()), "name": "우리 집", "account": "우리 집", "owner": "me",
                                         "pocket": "property", "assetClass": "property", "amount": 500_000_000, "as_of": TODAY})
    a = r.json()
    h = client.get("/api/property").json()["homes"][0]
    assert h["detail"] is None and h["metrics"]["gain"] is None
    upd = home(owner="me", share_percent=None, name="우리 집", version=a["version"], detail_version=0)
    assert client.put(f"/api/property/{a['id']}", json=upd).json()["detail"]["purchase_price"] == 800_000_000


def test_validation(client):
    bad = [home(request_id=str(uuid.uuid4()), share_percent=None),
           home(request_id=str(uuid.uuid4()), purchase_month="2999-01"),
           home(request_id=str(uuid.uuid4()), loan_ids=[str(uuid.uuid4())])]
    assert [client.post("/api/property", json=b).status_code for b in bad] == [422, 422, 422]


def test_listings_are_separate_from_value_and_survive_home_edit(client):
    h = client.post("/api/property", json=home(request_id=str(uuid.uuid4()))).json()
    body = {"listings": [{"price": 1_300_000_000, "floor": "12층", "memo": "남향", "checked_on": TODAY},
                         {"price": 1_250_000_000, "checked_on": TODAY}], "detail_version": h["detail"]["version"]}
    h2 = client.put(f"/api/property/{h['asset']['id']}/listings", json=body).json()
    assert h2["asking"] == {"low": 1_250_000_000, "high": 1_300_000_000, "count": 2}
    assert h2["value"] == 1_000_000_000 and client.get("/api/dashboard").json()["property"] == 1_000_000_000   # 호가는 시세에 안 들어감
    upd = home(version=h2["asset"]["version"], detail_version=h2["detail"]["version"], value=1_100_000_000)
    h3 = client.put(f"/api/property/{h['asset']['id']}", json=upd).json()
    assert len(h3["detail"]["listings"]) == 2
    assert client.put(f"/api/property/{h['asset']['id']}/listings", json=body).status_code == 409


def test_trades_without_key_and_with_mocked_portal(client, monkeypatch, tmp_path):
    from backend import property as prop
    monkeypatch.delenv("RETIRE_MOLIT_KEY", raising=False)
    prop._cache.clear()
    assert client.get("/api/property/market/status").json() == {"configured": False}
    assert client.get("/api/property/trades?sigungu=11440&name=염리삼성래미안").json() == {"configured": False, "trades": []}
    assert client.put("/api/property/market/key", json={"key": "abc%2Bdef123=="}).json() == {"configured": True}
    assert prop.market_key() == "abc+def123=="          # 인코딩 키도 풀어서 쓴다
    calls = []

    class R:
        status_code = 200
        text = "<response><header><resultCode>000</resultCode></header><body><items><item><aptNm>염리삼성래미안</aptNm><dealAmount>123,000</dealAmount><excluUseAr>84.92</excluUseAr><dealYear>2026</dealYear><dealMonth>10</dealMonth><dealDay>3</dealDay><floor>12</floor></item></items></body></response>"
    import requests
    monkeypatch.setattr(requests, "get", lambda url, params, timeout: calls.append(params["DEAL_YMD"]) or R())
    r = client.get("/api/property/trades?sigungu=11440&name=염리삼성래미안&area=84.9&months=3").json()
    assert len(calls) == 3 and len(r["trades"]) == 3 and r["trades"][0]["price"] == 1_230_000_000
    client.get("/api/property/trades?sigungu=11440&name=염리삼성래미안&months=3")
    assert len(calls) == 3                               # 같은 달은 캐시


def test_value_is_not_asked_auto_from_trade_then_purchase(client, monkeypatch):
    from backend import property as prop
    import requests
    monkeypatch.delenv("RETIRE_MOLIT_KEY", raising=False)
    prop._cache.clear()
    body = home(request_id=str(uuid.uuid4()), owner="me", share_percent=None, address={"road": "x", "building": "헬리오시티", "sigungu_code": "11710"})
    body.pop("value"); body.pop("as_of")
    h = client.post("/api/property", json=body).json()             # 키 없음 → 산 가격
    assert h["full_value"] == 800_000_000 and h["detail"]["value_source"] == {"kind": "purchase"}
    upd = home(owner="me", share_percent=None, name="헬리오시티 집", address=body["address"], version=h["asset"]["version"], detail_version=h["detail"]["version"])
    upd.pop("value")
    h2 = client.put(f"/api/property/{h['asset']['id']}", json=upd).json()   # 수정에서 시세를 안 보내면 그대로
    assert h2["full_value"] == 800_000_000 and h2["detail"]["value_source"] == {"kind": "purchase"}
    assert client.post(f"/api/property/{h['asset']['id']}/refresh").status_code == 409

    monkeypatch.setenv("RETIRE_MOLIT_KEY", "testkey12345")

    class R:
        status_code = 200
        text = "<response><header><resultCode>000</resultCode></header><body><items><item><aptNm>헬리오시티</aptNm><dealAmount>235,000</dealAmount><excluUseAr>84.95</excluUseAr><dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>12</dealDay><floor>15</floor></item></items></body></response>"
    monkeypatch.setattr(requests, "get", lambda url, params, timeout: R())
    r3 = client.post(f"/api/property/{h["asset"]["id"]}/refresh"); assert r3.status_code == 200, r3.text; h3 = r3.json()
    assert h3["full_value"] == 2_350_000_000 and h3["asset"]["as_of"] == "2026-09-12"
    assert h3["detail"]["value_source"]["kind"] == "trade" and h3["detail"]["value_source"]["floor"] == 15
    body2 = {**body, "request_id": str(uuid.uuid4()), "name": "두번째"}
    assert client.post("/api/property", json=body2).json()["detail"]["value_source"]["kind"] == "trade"


def test_key_from_dotenv(client, tmp_path, monkeypatch):
    from backend import property as prop
    monkeypatch.delenv("RETIRE_MOLIT_KEY", raising=False)
    (tmp_path / ".env").write_text("OTHER=1\nexport RETIRE_MOLIT_KEY=\"abc%2Bxyz1234\"\n", encoding="utf-8")
    assert prop.market_key() == "abc+xyz1234"


def test_address_based_trade_lookup_reaches_home_and_analysis_without_ledger_write(client, monkeypatch):
    from backend import property as prop
    row = {"name": "힐스테이트동대구센트럴", "dong": "신천동", "jibun": "1547", "area": 84.9921,
           "price": 660000000, "date": "2026-10-08", "floor": 26, "kind": "중개거래"}
    monkeypatch.setattr(prop, "market_key", lambda: "test")
    monkeypatch.setattr(prop, "_month_trades", lambda *args: [row])
    query = {"sigungu": "27140", "name": "힐스테이트 벤처밸리", "jibun": "대구 동구 신천동 1547", "area": 84, "months": 1}
    before = client.get("/api/assets").json()
    hits = client.get("/api/property/trades", params=query).json()["trades"]
    assert hits == [row]
    # price-check 최소 기간은 1개월. 같은 주소 식별이 분석에도 전달되어야 한다.
    assert client.get("/api/property-move/price-check", params=query).json()["analysis"]["latest"] == 660000000
    assert client.get("/api/assets").json() == before
