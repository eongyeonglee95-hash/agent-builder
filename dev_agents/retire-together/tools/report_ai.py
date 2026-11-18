"""Server-side OpenAI report explanations. No tools, retries, or trade execution."""
import os
from pathlib import Path
import requests

ENV_PATH = Path(__file__).resolve().parents[1] / '.env'
DEFAULT_MODEL = 'gpt-5.4-mini'


class ReportAIError(ValueError):
    """Safe user-facing error; never includes provider payloads or credentials."""


def settings():
    values = {}
    if ENV_PATH.is_file():
        for line in ENV_PATH.read_text().splitlines():
            key, sep, value = line.partition('=')
            if sep and not key.strip().startswith('#'):
                values[key.strip()] = value.strip().strip('\"').strip("'")
    return {key: os.environ.get(key) or values.get(key, default) for key, default in
            [('OPENAI_API_KEY', ''), ('RETIRE_REPORT_MODEL', DEFAULT_MODEL)]}


def generate(instructions, source, schema=None):
    config = settings()
    if not config['OPENAI_API_KEY']:
        raise ReportAIError('OpenAI API 키가 없어요. 서버의 OPENAI_API_KEY 설정을 확인해 주세요.')
    output_format = {'text': {'format': {'type': 'json_schema', 'name': 'allocation_review', 'strict': True, 'schema': schema}}} if schema else {}
    try:
        response = requests.post('https://api.openai.com/v1/responses',
            headers={'Authorization': 'Bearer ' + config['OPENAI_API_KEY']},
            json={'model': config['RETIRE_REPORT_MODEL'], 'instructions': instructions,
                  'input': source, 'tools': [], 'store': False,
                  'reasoning': {'effort': 'low'}, 'max_output_tokens': 12000 if schema else 3000, **output_format},
            timeout=(5, 100), allow_redirects=False)
        if response.status_code == 401:
            raise ReportAIError('OpenAI 키 인증에 실패했어요. 저장한 키를 확인해 주세요.')
        if response.status_code == 429:
            raise ReportAIError('OpenAI 사용 한도에 도달했어요. API 결제 잔액과 요청 한도를 확인해 주세요.')
        if response.status_code in (403, 404):
            raise ReportAIError('보고서 모델을 사용할 수 없어요. OpenAI 프로젝트 권한과 RETIRE_REPORT_MODEL 설정을 확인해 주세요.')
        if not response.ok or response.status_code >= 300:
            raise ReportAIError('OpenAI가 보고서 요청을 처리하지 못했어요. 잠시 뒤 다시 점검해 주세요.')
        result = response.json()
        if result.get('status') != 'completed':
            raise ReportAIError('GPT 설명이 끝까지 생성되지 않았어요. 다시 점검해 주세요.')
        chunks = []
        for item in result.get('output', []):
            if item.get('type') != 'message':
                continue
            for part in item.get('content', []):
                if part.get('type') == 'refusal':
                    raise ReportAIError('GPT 설명을 생성하지 못했어요. 아래 계산 결과를 확인해 주세요.')
                if part.get('type') == 'output_text':
                    chunks.append(part['text'])
        text = '\n'.join(chunks).strip()
        if not text:
            raise ReportAIError('GPT 설명이 비어 있어요. 다시 점검해 주세요.')
        return text
    except ReportAIError:
        raise
    except (requests.RequestException, ValueError, KeyError, TypeError, AttributeError):
        raise ReportAIError('OpenAI 응답을 확인하지 못했어요. 잠시 뒤 다시 점검해 주세요.') from None
