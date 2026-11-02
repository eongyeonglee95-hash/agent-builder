"""리밸런싱 시트의 단순 제안(backend/plan.py)과 원칙 바꾸기 미리보기. 임시 규칙·DB, 네트워크 없음."""
import shutil
from datetime import date

import pytest
from fastapi.testclient import TestClient

from backend import plan, storage
from backend.main import app
from tools.strategy import STRATEGIES_PATH

ACCOUNTS = """accounts:
  - id: me_pl
    label: 테스트 연금저축
    pool: me_pl_pool
    owner: me
    broker: mirae
    account_type: pension_savings
    pocket: pension
    active: true
  - id: me_pl2
    label: 빈 IRP
    pool: empty_pool
    owner: me
    broker: mirae
    account_type: irp
    pocket: pension
    active: true
pools:
  me_pl_pool:
    label: 테스트 연금 — 리밸런싱
    strategy: all_weather
    mode: rebalance
  empty_pool:
    label: 빈 IRP
    strategy: all_weather
    mode: buy_only
"""
AMAP = """assets:
  KODEX 200:
    ticker: '069500'
    asset_class: stock
    role: core
    status: confirmed
  ACE 종합채권(AA-이상)KIS채권평가:
    ticker: '356540'
    asset_class: mid_bond
    role: core
    status: confirmed
class_defaults: {}
"""


@pytest.fixture
def client(tmp_path, monkeypatch):
    (tmp_path / "accounts.yaml").write_text(ACCOUNTS, encoding="utf-8")
    (tmp_path / "asset_map.yaml").write_text(AMAP, encoding="utf-8")
    shutil.copy(STRATEGIES_PATH, tmp_path / "strategies.yaml")
    monkeypatch.setenv("RETIRE_ACCOUNTS_PATH", str(tmp_path / "accounts.yaml"))
    monkeypatch.setenv("RETIRE_ASSET_MAP_PATH", str(tmp_path / "asset_map.yaml"))
    monkeypatch.setenv("RETIRE_STRATEGIES_PATH", str(tmp_path / "strategies.yaml"))
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "ledger.sqlite3")
    (tmp_path / "DECISIONS.md").write_text("# DECISIONS\n\n## 리밸런싱 제안 기록\n(아직 없음)\n", encoding="utf-8")
    monkeypatch.setenv("RETIRE_DECISIONS_PATH", str(tmp_path / "DECISIONS.md"))
    with TestClient(app, base_url="http://127.0.0.1", headers={"Origin": "http://127.0.0.1", "X-Retire-Local": "1"}) as c:
        r = c.post("/api/register/commit", json={"account_id": "me_pl", "source": "file", "as_of": date.today().isoformat(), "screen_total": None, "rows": [
            {"ticker_name": "KODEX 200", "ticker": "069500", "qty": 300, "price": 30000, "asset_class": "stock"},
            {"ticker_name": "ACE 종합채권(AA-이상)KIS채권평가", "ticker": "356540", "qty": 10, "price": 100000, "asset_class": "mid_bond"}]})
        assert r.status_code == 200, r.text
        yield c, tmp_path


def test_josa():
    assert plan.eul("주식·금") == "주식·금을" and plan.eul("중기채") == "중기채를"
    assert plan.euro("중기채") == "중기채로" and plan.euro("장기채·금") == "장기채·금으로" and plan.euro("달러") == "달러로"


def test_rebalance_pool_carries_simple_plan_and_empty_pools(client):
    c, _ = client
    d = c.post("/api/workbook/rebalance", json={}).json()
    p = d["pools"][0]
    pl = p["plan"]
    assert p["strategy_id"] == "all_weather"
    assert pl["kind"] == "move" and pl["title_head"] == "주식 비중이 목표보다" and pl["title_tail"].endswith("많아요.") and pl["title_tone"] == "up"
    assert pl["line"].startswith("주식을 팔아 ")
    sells = [o for o in p["orders"] if o["side"] == "매도"]
    assert pl["reduce_total"] == sum(o["amount"] for o in sells) and pl["sell_count"] == len(sells)
    assert [x["asset_class"] for x in pl["reduce"]] == ["stock"]
    assert d["empty_pools"] == [{"pool_id": "empty_pool", "label": "빈 IRP", "mode": "buy_only", "strategy_id": "all_weather"}]


def test_preview_compares_without_saving_and_flags_class_with_no_seat(client):
    c, tmp = client
    before = (tmp / "accounts.yaml").read_text(encoding="utf-8")
    r = c.post("/api/workbook/portfolio/preview", json={"pool_id": "me_pl_pool", "strategy_id": "park_gomhee"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["name"] == "박곰희" and d["current"]["kind"] == "move" and d["proposed"]["targets"][0]["target_pct"] == 70
    assert any("중기채 자리가 없어서" in n and "10주" in n and "모두 팔게 돼요" in n for n in d["notes"])
    assert (tmp / "accounts.yaml").read_text(encoding="utf-8") == before   # 저장하지 않음
    assert c.post("/api/workbook/portfolio/preview", json={"pool_id": "empty_pool", "strategy_id": "park_gomhee"}).status_code == 409
    assert c.post("/api/workbook/portfolio/preview", json={"pool_id": "me_pl_pool", "strategy_id": "k_all_weather"}).status_code == 409
    assert c.post("/api/workbook/portfolio/preview", json={"pool_id": "me_pl_pool", "strategy_id": "../x"}).status_code == 422


def test_alternatives_lists_other_principles_in_fixed_order_without_saving(client):
    c, tmp = client
    before = (tmp / "accounts.yaml").read_text(encoding="utf-8")
    d = c.post("/api/workbook/portfolio/alternatives", json={"pool_id": "me_pl_pool"}).json()
    assert d["current_id"] == "all_weather"
    assert [o["strategy_id"] for o in d["options"]] == ["k_all_weather", "park_gomhee", "custom"]
    k, park, custom = d["options"]
    assert not k["ready"] and "정하지 않았어요" in k["reason"]
    assert not custom["ready"] and "넣지 않았어요" in custom["reason"]
    assert park["ready"] and park["plan"]["targets"][0]["target_pct"] == 70 and any("모두 팔게 돼요" in n for n in park["notes"])
    assert (tmp / "accounts.yaml").read_text(encoding="utf-8") == before
    assert c.post("/api/workbook/portfolio/alternatives", json={"pool_id": "empty_pool"}).status_code == 409
