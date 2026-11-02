"""리밸런싱 시트 '포트폴리오' — 고르기·따라가기·직접 설정 저장. 진짜 strategies.yaml을 임시로 복사해 주석이 남는지까지 본다."""
import shutil

import pytest
import yaml
from fastapi.testclient import TestClient

from backend import storage
from backend.main import app
from tools.strategy import STRATEGIES_PATH

ACCOUNTS = """# 계좌 목록 머리 주석
accounts:
  - id: me_pf
    label: 테스트 연금저축
    pool: me_pf_pool
    owner: me
    broker: mirae
    account_type: pension_savings
    pocket: pension
    active: true
pools:
  me_pf_pool:
    label: 테스트 연금 — 리밸런싱
    strategy: all_weather   # 처음엔 올웨더
    mode: rebalance
  other_pool:
    label: 다른 묶음
    strategy: all_weather
    mode: buy_only
"""


@pytest.fixture
def env(tmp_path, monkeypatch):
    (tmp_path / "accounts.yaml").write_text(ACCOUNTS, encoding="utf-8")
    (tmp_path / "asset_map.yaml").write_text("assets: {}\nclass_defaults: {}\n", encoding="utf-8")
    shutil.copy(STRATEGIES_PATH, tmp_path / "strategies.yaml")
    monkeypatch.setenv("RETIRE_ACCOUNTS_PATH", str(tmp_path / "accounts.yaml"))
    monkeypatch.setenv("RETIRE_ASSET_MAP_PATH", str(tmp_path / "asset_map.yaml"))
    monkeypatch.setenv("RETIRE_STRATEGIES_PATH", str(tmp_path / "strategies.yaml"))
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "ledger.sqlite3")
    (tmp_path / "DECISIONS.md").write_text("# DECISIONS\n\n## 리밸런싱 제안 기록\n(아직 없음)\n", encoding="utf-8")
    monkeypatch.setenv("RETIRE_DECISIONS_PATH", str(tmp_path / "DECISIONS.md"))
    with TestClient(app, base_url="http://127.0.0.1", headers={"Origin": "http://127.0.0.1", "X-Retire-Local": "1"}) as c:
        yield c, tmp_path


def test_lists_three_portfolios_plus_custom_and_pools(env):
    c, _ = env
    d = c.get("/api/workbook/portfolios").json()
    ids = [s["id"] for s in d["strategies"]]
    assert ids == ["all_weather", "k_all_weather", "park_gomhee", "custom"]
    aw = d["strategies"][0]
    assert aw["ready"] and sum(r["target_pct"] for r in aw["classes"]) == 100
    assert {r["ticker"] for r in aw["classes"]} >= {"453850", "308620"}
    k = d["strategies"][1]
    assert not k["ready"] and k["classes"] == [] and "정하지 않았어요" in k["pending_note"]
    assert {p["pool_id"]: p["strategy_id"] for p in d["pools"]} == {"me_pf_pool": "all_weather", "other_pool": "all_weather"}
    assert "추천이 아닙니다" in d["examples_note"]


def test_follow_changes_only_that_line_and_records_decision(env):
    c, tmp = env
    r = c.post("/api/workbook/portfolio/follow", json={"pool_id": "me_pf_pool", "strategy_id": "park_gomhee"})
    assert r.status_code == 200 and r.json()["changed"]
    text = (tmp / "accounts.yaml").read_text(encoding="utf-8")
    assert "# 계좌 목록 머리 주석" in text and "strategy: park_gomhee" in text
    pools = yaml.safe_load(text)["pools"]
    assert pools["me_pf_pool"]["strategy"] == "park_gomhee" and pools["other_pool"]["strategy"] == "all_weather"
    assert "테스트 연금 포트폴리오 변경: 올웨더 → 박곰희" in (tmp / "DECISIONS.md").read_text(encoding="utf-8")
    again = c.post("/api/workbook/portfolio/follow", json={"pool_id": "me_pf_pool", "strategy_id": "park_gomhee"}).json()
    assert again["changed"] is False


def test_cannot_follow_portfolio_without_ratios(env):
    c, tmp = env
    for sid in ("k_all_weather", "custom"):
        r = c.post("/api/workbook/portfolio/follow", json={"pool_id": "me_pf_pool", "strategy_id": sid})
        assert r.status_code == 409, r.text
    assert c.post("/api/workbook/portfolio/follow", json={"pool_id": "nope", "strategy_id": "all_weather"}).status_code == 404
    assert c.post("/api/workbook/portfolio/follow", json={"pool_id": "me_pf_pool", "strategy_id": "../x"}).status_code == 422
    assert "strategy: all_weather   # 처음엔 올웨더" in (tmp / "accounts.yaml").read_text(encoding="utf-8")


def test_custom_save_keeps_comments_then_pool_follows(env):
    c, tmp = env
    before = (tmp / "strategies.yaml").read_text(encoding="utf-8")
    r = c.post("/api/workbook/portfolio/custom", json={"targets": {"stock": 60, "long_bond": 30, "gold": 10}, "pool_id": "me_pf_pool"})
    assert r.status_code == 200, r.text
    after = (tmp / "strategies.yaml").read_text(encoding="utf-8")
    assert len(after.splitlines()) == len(before.splitlines())  # 한 줄만 바뀜
    assert "사용자 확인 대기 (2026-10-27)" in after  # 다른 전략의 결정 주석이 그대로
    assert yaml.safe_load(after)["strategies"]["custom"]["targets"] == {"stock": 60, "long_bond": 30, "gold": 10}
    assert r.json()["follow"]["changed"]
    d = c.get("/api/workbook/portfolios").json()
    custom = next(s for s in d["strategies"] if s["id"] == "custom")
    assert custom["ready"] and next(p for p in d["pools"] if p["pool_id"] == "me_pf_pool")["strategy_id"] == "custom"
    log = (tmp / "DECISIONS.md").read_text(encoding="utf-8")
    assert "직접 설정 비율 저장: 주식 60 / 장기채 30 / 금 10" in log and "직접 설정 → " not in log


def test_custom_save_rejects_bad_ratios_and_leaves_file(env):
    c, tmp = env
    before = (tmp / "strategies.yaml").read_text(encoding="utf-8")
    assert c.post("/api/workbook/portfolio/custom", json={"targets": {"stock": 60, "gold": 30}}).status_code == 422   # 합 90
    assert c.post("/api/workbook/portfolio/custom", json={"targets": {"crypto": 100}}).status_code == 422
    assert c.post("/api/workbook/portfolio/custom", json={"targets": {"stock": 120}}).status_code == 422
    assert c.post("/api/workbook/portfolio/custom", json={"targets": {}}).status_code == 422
    assert (tmp / "strategies.yaml").read_text(encoding="utf-8") == before
