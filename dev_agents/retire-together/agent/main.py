"""Pension Rebalancing Agent 본체 (Claude Agent SDK).

  uv run python -m agent                                  # 대화
  uv run python -m agent "연금저축(구) 리밸런싱 봐줘"         # 한 번 묻고 끝
  uv run python -m agent --owner me --live "이번 달 300만원 넣으면?"

허용 도구는 agent/tools.py의 7개뿐이다. 내장 도구(Bash·파일 읽기/쓰기·웹 등)는 tools=[]로 아예 주지 않고,
설정 파일·CLAUDE.md·스킬·다른 MCP 서버도 읽지 않는다. 쓰기 도구(record_decision)는 매번 사용자 확인을 받는다.
답을 모아 agent/guard.py로 금지 표현과 숫자의 단위·부호를 검사한 뒤에만 출력한다.
검증 실패나 SDK 오류/미완료 응답은 고정 안내로 대체하며, 단일 질문 실행은 비정상 종료 코드를 반환한다.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from typing import Awaitable, Callable

from agent import guard
from agent.prompt import rules_excerpt, system_prompt
from agent.tools import READ_ONLY, SPECS, WRITE, ToolLog, build_server, full_name

DEFAULT_MODEL = "claude-opus-5-5"
Confirm = Callable[[str], Awaitable[bool]]


async def ask_terminal(question: str) -> bool:
    if not sys.stdin.isatty():
        return False
    answer = await asyncio.to_thread(input, question + " [y/N] ")
    return answer.strip().lower() in ("y", "yes", "네", "응", "ㅇ")


def permission_gate(confirm: Confirm):
    """쓰기 도구만 여기로 온다(읽기 도구는 allowed_tools로 자동 허용). 사용자가 y라고 해야 실행."""
    from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny

    async def can_use_tool(tool_name: str, tool_input: dict, context) -> PermissionResultAllow | PermissionResultDeny:
        if tool_name not in WRITE:
            return PermissionResultDeny(message=f"{tool_name}은(는) 이 Agent가 쓸 수 없는 도구예요.")
        action = {"accept": "수락(직접 주문)", "hold": "보류"}.get(tool_input.get("action"), tool_input.get("action"))
        question = f"\n[기록 확인] 묶음 {tool_input.get('pool_id')} · {action} · 사유 \"{tool_input.get('reason', '')}\"\nDECISIONS.md에 남길까요?"
        if await confirm(question):
            return PermissionResultAllow()
        return PermissionResultDeny(message="사용자가 기록을 승인하지 않았어요. 기록하지 말고, 바꿀 내용이 있는지 물어보세요.")

    return can_use_tool


def build_options(log: ToolLog, confirm: Confirm = ask_terminal, model: str | None = None):
    import warnings

    from claude_agent_sdk import CanUseToolShadowedWarning, ClaudeAgentOptions

    # 읽기 도구가 can_use_tool을 거치지 않는 건 의도한 것(allowed_tools로 자동 허용). 쓰기 도구만 확인한다.
    warnings.filterwarnings("ignore", category=CanUseToolShadowedWarning)

    return ClaudeAgentOptions(
        model=model or os.environ.get("RETIRE_AGENT_MODEL") or DEFAULT_MODEL,
        system_prompt=system_prompt(),
        tools=[],                        # 내장 도구 전부 끔 — LLM은 계산·파일 접근을 못 한다
        mcp_servers={"retire": build_server(log)},
        strict_mcp_config=True,          # 사용자 설정의 다른 MCP 서버를 섞지 않는다
        allowed_tools=READ_ONLY,         # 읽기 도구만 자동 허용
        can_use_tool=permission_gate(confirm),
        setting_sources=[],              # CLAUDE.md·settings·훅을 읽지 않는다
        skills=[],
        max_turns=20,
    )


def _with_context(text: str, owner: str, live: bool) -> str:
    if owner == "together" and not live:
        return text
    return f"{text}\n\n(화면 설정: owner={owner}, live={'true' if live else 'false'} — 도구를 부를 때 이 값을 쓴다)"


async def chat(first: str | None, owner: str, live: bool, model: str | None) -> int:
    from claude_agent_sdk import AssistantMessage, ClaudeSDKClient, ResultMessage, TextBlock

    log = ToolLog()
    async with ClaudeSDKClient(options=build_options(log, model=model)) as client:
        prompt = first
        while True:
            if prompt is None:
                try:
                    prompt = (await asyncio.to_thread(input, "\n나> ")).strip()
                except EOFError:
                    return 0
                if prompt in ("", "끝", "exit", "quit"):
                    return 0
            # 이전 질문의 잔고·시세가 이번 답변의 근거로 재사용되지 않게 한다.
            log.texts.clear()
            await client.query(_with_context(prompt, owner, live))
            answer: list[str] = []
            completed = False
            failed = False
            async for msg in client.receive_response():
                if isinstance(msg, AssistantMessage):
                    failed = failed or msg.error is not None
                    for block in msg.content:
                        if isinstance(block, TextBlock):
                            answer.append(block.text)
                elif isinstance(msg, ResultMessage):
                    completed = True
                    failed = (failed or msg.is_error or msg.subtype != "success"
                              or msg.terminal_reason not in (None, "completed")
                              or msg.stop_reason == "max_tokens")
            # 규칙 발췌의 숫자(종목코드·연구 수치 등)도 Agent가 받은 글이므로 대조 대상에 넣는다
            text = "\n".join(answer).strip()
            checked = guard.check_answer(text, log.joined() + "\n" + rules_excerpt())
            status = 0
            if failed or not completed or not text:
                print("[오류] 답변을 완료하지 못했어요. 다시 요청해 주세요.", file=sys.stderr)
                status = 1
            elif not checked.ok:
                print("답변의 숫자나 표현을 확인하지 못해 표시를 보류했어요. 잔고와 계산 결과를 다시 조회해 달라고 요청해 주세요.")
                status = 2
            else:
                print(text, flush=True)
            if first is not None:
                return status
            prompt = None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="둘이서은퇴 연금 리밸런싱 Agent (드라이런, 자동주문 없음)")
    ap.add_argument("prompt", nargs="?", help="한 번 묻고 끝낼 질문. 비우면 대화")
    ap.add_argument("--owner", choices=["together", "me", "partner"], default="together")
    ap.add_argument("--live", action="store_true", help="공개 시세로 현재가 갱신")
    ap.add_argument("--model", default=None, help=f"기본 {DEFAULT_MODEL} (RETIRE_AGENT_MODEL로도 바꿈)")
    args = ap.parse_args(argv)
    return asyncio.run(chat(args.prompt, args.owner, args.live, args.model))


__all__ = ["main", "build_options", "permission_gate", "SPECS", "full_name"]
