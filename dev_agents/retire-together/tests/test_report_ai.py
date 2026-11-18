from types import SimpleNamespace
import pytest
import requests
from tools import report_ai


@pytest.fixture(autouse=True)
def credentials(monkeypatch):
    monkeypatch.setattr(report_ai, 'settings', lambda: {'OPENAI_API_KEY': 'test-secret', 'RETIRE_REPORT_MODEL': 'test-model'})


def reply(monkeypatch, data, status=200):
    calls = []
    def post(*args, **kwargs):
        calls.append(kwargs)
        return SimpleNamespace(status_code=status, ok=status < 400, json=lambda: data)
    monkeypatch.setattr(report_ai.requests, 'post', post)
    return calls


def test_request_is_private_read_only_and_parses_message_after_reasoning(monkeypatch):
    calls = reply(monkeypatch, {'status': 'completed', 'output': [
        {'type': 'reasoning'}, {'type': 'message', 'content': [{'type': 'output_text', 'text': '점검 결과'}]}]})
    assert report_ai.generate('rules', 'facts') == '점검 결과'
    assert len(calls) == 1
    assert calls[0]['json']['store'] is False and calls[0]['json']['tools'] == []
    assert calls[0]['json']['input'] == 'facts'
    assert calls[0]['allow_redirects'] is False


@pytest.mark.parametrize('status', [401, 403, 404, 429, 500])
def test_provider_errors_are_redacted_and_not_retried(monkeypatch, status):
    calls = reply(monkeypatch, {'error': {'message': 'test-secret'}}, status)
    with pytest.raises(report_ai.ReportAIError) as err:
        report_ai.generate('rules', 'facts')
    assert 'test-secret' not in str(err.value) and len(calls) == 1


@pytest.mark.parametrize('data', [
    {'status': 'incomplete', 'output': []},
    {'status': 'completed', 'output': []},
    {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'refusal'}]}]},
])
def test_partial_empty_and_refused_reports_rejected(monkeypatch, data):
    reply(monkeypatch, data)
    with pytest.raises(report_ai.ReportAIError): report_ai.generate('rules', 'facts')


def test_timeout_does_not_leak_credentials(monkeypatch):
    def fail(*args, **kwargs): raise requests.Timeout('test-secret')
    monkeypatch.setattr(report_ai.requests, 'post', fail)
    with pytest.raises(report_ai.ReportAIError) as err: report_ai.generate('rules', 'facts')
    assert 'test-secret' not in str(err.value)
