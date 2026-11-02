"""Agent 본체 — LLM 없이 검사하는 것: 도구 7개의 출력, 권한(내장 도구 없음·쓰기는 확인), 답 검사(숫자·금지 표현), 프롬프트 주입 범위.
임시 규칙·DB·DECISIONS, 네트워크 없음."""
import asyncio
from datetime import date

import pytest
from fastapi.testclient import TestClient

from agent import guard, prompt, tools
from agent.main import build_options, permission_gate
from backend import storage
from backend.main import app

ACCOUNTS = """accounts:
  - id: me_ag
    label: 테스트 연금저축
    pool: me_ag_pool
    owner: me
    broker: mirae
    account_type: pension_savings
    pocket: pension
    active: true
pools:
  me_ag_pool:
    label: 테스트 연금 — 매수만
    strategy: all_weather
    mode: buy_only
"""
AMAP = """assets:
  KODEX 200:
    ticker: '069500'
    asset_class: stock
    role: core
    status: confirmed
class_defaults: {}
"""


@pytest.fixture
def env(tmp_path, monkeypatch):
    (tmp_path / "accounts.yaml").write_text(ACCOUNTS, encoding="utf-8")
    (tmp_path / "asset_map.yaml").write_text(AMAP, encoding="utf-8")
    monkeypatch.setenv("RETIRE_ACCOUNTS_PATH", str(tmp_path / "accounts.yaml"))
    monkeypatch.setenv("RETIRE_ASSET_MAP_PATH", str(tmp_path / "asset_map.yaml"))
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "ledger.sqlite3")
    (tmp_path / "DECISIONS.md").write_text("# DECISIONS\n\n## 리밸런싱 제안 기록\n(아직 없음)\n", encoding="utf-8")
    monkeypatch.setenv("RETIRE_DECISIONS_PATH", str(tmp_path / "DECISIONS.md"))
    with TestClient(app, base_url="http://127.0.0.1", headers={"Origin": "http://127.0.0.1", "X-Retire-Local": "1"}) as c:
        r = c.post("/api/register/commit", json={"account_id": "me_ag", "source": "file", "as_of": date.today().isoformat(), "screen_total": None,
                                                 "rows": [{"ticker_name": "KODEX 200", "ticker": "069500", "qty": 100, "price": 30000, "asset_class": "stock"}]})
        assert r.status_code == 200, r.text
    return tmp_path


def test_list_pools_shows_ids_strategy_and_registration(env):
    text = tools.list_pools()
    assert "`me_ag_pool`" in text and "매수만" in text and "등록 잔고 있음" in text
    assert "임계치 ±5.0%p" in text and "테스트 연금저축 (`me_ag`)" in text


def test_tag_assets_lists_class_and_status(env):
    text = tools.tag_assets()
    assert "KODEX 200 (069500) → 주식" in text and "confirmed" in text and "100주" in text


def test_compute_rebalance_is_code_formatted(env):
    text = tools.compute_rebalance("me_ag_pool")
    assert "판정: 재배분이 필요해요" in text
    assert "총 평가액 3,000,000원" in text
    assert "| 자산군 | 목표 | 현재 |" in text and "100.0%" in text


def test_unknown_pool_and_missing_holdings_come_back_as_readable_errors(env):
    text, is_error = tools.call("compute_rebalance", {"pool_id": "nope"})
    assert is_error and "묶음이 없어요" in text
    text, is_error = tools.call("compute_rebalance", {"pool_id": "me_ag_pool", "owner": "partner"})
    assert is_error and "등록된 잔고가 없어요" in text


def test_order_sheet_with_new_cash_buys_and_buy_only_without_cash_trades_nothing(env):
    assert "이번엔 실제 거래가 없어요" in tools.build_order_sheet("me_ag_pool")
    sheet = tools.build_order_sheet("me_ag_pool", new_cash=3_000_000, new_cash_account="me_ag")
    assert "| 매수 |" in sheet and "그대로 보여 주세요" in sheet


def test_explain_inputs_preformats_money_so_the_llm_does_not_convert(env):
    text = tools.explain_inputs("me_ag_pool")
    assert "지금 비율로 두면 예상 손실 약" in text and "만원" in text
    assert "과세이연: 예" in text and "기록이 없음" in text


def test_record_decision_writes_and_two_holds_flag_section5(env):
    out = tools.record_decision("me_ag_pool", "hold", "이번 달은 지켜볼래요")
    assert out.startswith("기록했어요") and "테스트 연금 리밸런싱 보류" in out
    tools.record_decision("me_ag_pool", "hold", "다음 달에")
    text = tools.explain_inputs("me_ag_pool")
    assert "사유 \"다음 달에\"" in text and "2번 연속 보류" in text
    assert "이번 달은 지켜볼래요" in tools.read_decisions("me_ag_pool")


def test_accept_without_orders_is_refused(env):
    text, is_error = tools.call("record_decision", {"pool_id": "me_ag_pool", "action": "accept"})
    assert is_error and "수락할 주문이 없어요" in text
    assert "기록된 리밸런싱 결정이 없어요" in tools.read_decisions()


def test_tool_log_collects_outputs_for_guard(env):
    log = tools.ToolLog()
    tools.call("compute_rebalance", {"pool_id": "me_ag_pool"}, log)
    assert "3,000,000원" in log.joined()


def test_guard_flags_numbers_not_in_tool_results_and_forbidden_words():
    tool_text = "총 평가액 3,000,000원 · 주식 100.0% / 목표 30.0% · 편차 +70.0%p · 예상 손실 약 90만원"
    ok = guard.check_answer("총 평가액은 3,000,000원이고 주식이 70.0%p 높아요. 2번 연속 보류예요.", tool_text)
    assert ok.ok
    bad = guard.check_answer("목표로 맞추려면 2,100,000원어치 팔아야 합니다. 주식은 오를 것 같아요", tool_text)
    assert bad.unverified == ["2100000"]
    assert "팔아야 합니다" in bad.forbidden and "오를 것" in bad.forbidden


def test_options_give_only_our_tools_and_no_builtins(env):
    opts = build_options(tools.ToolLog())
    assert opts.tools == []
    assert opts.strict_mcp_config is True and opts.setting_sources == [] and opts.skills == []
    assert list(opts.mcp_servers) == ["retire"]
    assert len(tools.SPECS) == 7
    assert set(opts.allowed_tools) == {tools.full_name(n) for n in tools.SPECS} - {tools.full_name("record_decision")}


def test_write_tool_needs_user_yes():
    from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny

    async def yes(_q):
        return True

    async def no(_q):
        return False

    write = tools.full_name("record_decision")
    args = {"pool_id": "p", "action": "hold", "reason": "r"}
    assert isinstance(asyncio.run(permission_gate(yes)(write, args, None)), PermissionResultAllow)
    assert isinstance(asyncio.run(permission_gate(no)(write, args, None)), PermissionResultDeny)
    assert isinstance(asyncio.run(permission_gate(yes)("Bash", {"command": "ls"}, None)), PermissionResultDeny)


def test_prompt_injects_rules_4_and_5_only():
    text = prompt.system_prompt()
    assert "## 4." in text and "## 5." in text and "## 6." not in text
    assert "CALCULATION_RULES 기본값" not in text  # 공식 문서는 넣지 않는다
    assert "직접 하지 않는다" in text
