"""숫자 근거와 출력 경계: 실제 장부·네트워크·모델을 사용하지 않는다."""
import asyncio

import pytest
from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock

from agent import guard
from agent.main import chat


@pytest.mark.parametrize(("answer", "evidence"), [
    ("비중 99%", "비중 30%"),
    ("납입 90억원", "납입 90만원"),
    ("납입 90원", "납입 90만원"),
    ("주식 5주", "주식 2주"),
    ("현금 0원", "현금 10원"),
    ("편차 +70.0%p", "편차 −70.0%p"),
    ("편차 −70.0%p", "편차 +70.0%p"),
    ("비중 5%", "편차 5%p"),
    ("편차 5%p", "임계치 ±5%p"),
    ("납입 300만원", "납입 3,000,000원"),
    ("납입 10만원", "10번 확인"),
])
def test_changed_financial_quantities_are_rejected(answer, evidence):
    result = guard.check_answer(answer, evidence)
    assert not result.ok
    assert result.unverified


@pytest.mark.parametrize(("answer", "evidence"), [
    ("비중 30%", "비중 30%"),
    ("주식 2주", "주식 2주"),
    ("현금 0원", "현금 0원"),
    ("금액 3000000 원", "금액 3,000,000원"),
    ("편차 70.0%p", "편차 +70.0%p"),
    ("편차 -70.0%p", "편차 −70.0%p"),
    ("임계치 ±5%p", "임계치 ±5%p"),
    ("비중 30퍼센트", "비중 30%"),
    ("1. 확인해 주세요. 2번 연속 보류예요.", ""),
])
def test_unchanged_quantities_and_list_numbers_are_allowed(answer, evidence):
    assert guard.check_answer(answer, evidence).ok


def reply(text):
    return AssistantMessage(content=[TextBlock(text=text)], model="test")


def done(is_error=False):
    return ResultMessage(subtype="success", duration_ms=0, duration_api_ms=0,
                         is_error=is_error, num_turns=1, session_id="test")


def install_client(monkeypatch, turns, before_yield=None):
    """turns = [(이번 질문의 도구 결과, SDK 메시지 목록), ...]."""
    captured = {}

    def options(log, **kwargs):
        captured["log"] = log
        return object()

    class Client:
        def __init__(self, **kwargs):
            self.index = -1

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def query(self, text):
            self.index += 1
            captured["log"].texts.extend(turns[self.index][0])

        async def receive_response(self):
            for message in turns[self.index][1]:
                if before_yield:
                    before_yield()
                yield message

    monkeypatch.setattr("agent.main.build_options", options)
    monkeypatch.setattr("agent.main.rules_excerpt", lambda: "")
    monkeypatch.setattr("claude_agent_sdk.ClaudeSDKClient", Client)


def test_answer_is_not_printed_until_the_result_is_complete(monkeypatch, capsys):
    def nothing_printed():
        assert capsys.readouterr().out == ""

    install_client(monkeypatch, [(["금액 90만원"], [reply("금액은 90만원이에요."), done()])],
                   before_yield=nothing_printed)
    assert asyncio.run(chat("확인", "together", False, None)) == 0
    assert capsys.readouterr().out == "금액은 90만원이에요.\n"


@pytest.mark.parametrize("answer", ["금액은 90억원이에요.", "이 종목은 오를 것 같아요."])
def test_unverified_or_forbidden_answer_never_reaches_stdout(monkeypatch, capsys, answer):
    install_client(monkeypatch, [(["금액 90만원"], [reply(answer), done()])])
    assert asyncio.run(chat("확인", "together", False, None)) == 2
    output = capsys.readouterr()
    assert "표시를 보류" in output.out
    assert answer not in output.out + output.err


@pytest.mark.parametrize("messages", [
    [reply("금액 90만원"), done(is_error=True)],
    [reply("금액 90만원")],
    [done()],
])
def test_sdk_error_incomplete_and_empty_replies_are_not_success(monkeypatch, capsys, messages):
    install_client(monkeypatch, [(["금액 90만원"], messages)])
    assert asyncio.run(chat("확인", "together", False, None)) == 1
    output = capsys.readouterr()
    assert output.out == ""
    assert "답변을 완료하지 못했어요" in output.err


@pytest.mark.parametrize(("field", "value"), [
    ("terminal_reason", "max_turns"),
    ("terminal_reason", "aborted_streaming"),
    ("stop_reason", "max_tokens"),
    ("subtype", "error_max_turns"),
])
def test_interrupted_or_limited_result_does_not_publish_partial_answer(monkeypatch, capsys, field, value):
    result = done()
    setattr(result, field, value)
    install_client(monkeypatch, [(["금액 90만원"], [reply("금액 90만원"), result])])
    assert asyncio.run(chat("확인", "together", False, None)) == 1
    assert capsys.readouterr().out == ""


def test_previous_turn_numbers_do_not_validate_current_answer(monkeypatch, capsys):
    install_client(monkeypatch, [
        (["금액 90만원"], [reply("금액 90만원"), done()]),
        (["금액 20만원"], [reply("금액 90만원"), done()]),
    ])
    prompts = iter(["첫 질문", "다음 질문", "끝"])
    monkeypatch.setattr("builtins.input", lambda _: next(prompts))
    assert asyncio.run(chat(None, "together", False, None)) == 0
    output = capsys.readouterr().out
    assert output.count("금액 90만원") == 1
    assert "표시를 보류" in output
