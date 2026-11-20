"""가계부 캡처 전사 — 카드·은행 앱 내역 캡처 → [{date, merchant, amount}] (Claude 비전, Agent SDK).

보이는 값만 옮긴다. 분류는 tools/household_book.classify(코드)가 한다. 취소·환불 건은 빼고, 금액은 원 단위 양의 정수.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import re
from pathlib import Path

SCHEMA = {
    "type": "object",
    "properties": {
        "rows": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "결제일. 연도가 보이면 YYYY-MM-DD, 안 보이면 MM-DD"},
                "merchant": {"type": "string", "description": "가맹점·받는 곳 이름 그대로"},
                "amount": {"type": "integer", "description": "결제 금액(원), 쉼표 없이 양의 정수"},
                "cancelled": {"type": "boolean", "description": "취소·환불·입금이면 true"},
            },
            "required": ["date", "merchant", "amount", "cancelled"], "additionalProperties": False}},
    },
    "required": ["rows"], "additionalProperties": False,
}


async def _run(paths: list[Path]) -> dict:
    from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

    files = "\n".join(f"- {p.resolve()}" for p in paths)
    prompt = ("다음 카드·은행 앱 이용내역 캡처를 Read 도구로 읽고 결제 건을 모두 rows에 옮겨라. "
              "한 건 = 날짜·가맹점·금액. 같은 건이 여러 이미지에 겹쳐 보이면 한 번만. 취소·환불·입금 건은 cancelled=true. "
              "분류하거나 계산하지 말고 보이는 값만.\n" + files)
    options = ClaudeAgentOptions(allowed_tools=["Read"], permission_mode="dontAsk", max_turns=14,
                                 output_format={"type": "json_schema", "schema": SCHEMA},
                                 system_prompt="너는 표 전사 도구다. 보이는 값만 옮긴다. 분류·판단·계산을 하지 않는다.")
    result = None
    async for msg in query(prompt=prompt, options=options):
        if isinstance(msg, ResultMessage):
            result = msg
    if result is None or result.structured_output is None:
        raise RuntimeError(f"캡처 파싱 실패: {getattr(result, 'result', None)}")
    return result.structured_output


def normalize(rows: list[dict], year: int) -> list[dict]:
    """전사 결과 → 날짜 ISO·양의 금액·취소 제외. 날짜를 못 읽은 건은 버리지 않고 date=''로 둔다(화면에서 보인다)."""
    out = []
    for r in rows:
        if r.get("cancelled") or not isinstance(r.get("amount"), int) or r["amount"] <= 0:
            continue
        m = re.search(r"(?:(\d{4})\D+)?(\d{1,2})\D+(\d{1,2})", str(r.get("date") or ""))
        day = ""
        if m:
            try:
                day = dt.date(int(m.group(1) or year), int(m.group(2)), int(m.group(3))).isoformat()
            except ValueError:
                pass
        out.append({"date": day, "merchant": str(r.get("merchant") or "").strip()[:60], "amount": r["amount"]})
    return out


def transcribe(paths: list[Path], year: int) -> list[dict]:
    return normalize(asyncio.run(_run(paths))["rows"], year)
