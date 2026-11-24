"""가계부 급여명세서 사진 → 지급액·공제·실수령 (Claude 비전, Agent SDK).

비전은 보이는 숫자만 옮긴다. 누구의 명세서인지(이름 맞추기)·합이 맞는지·월급/상여 구분은 check()가 코드로 한다.
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path

DEDUCTIONS = {"national_pension": "국민연금", "health": "건강보험", "care": "장기요양", "employment": "고용보험",
              "income_tax": "소득세", "local_tax": "지방소득세"}
_int = {"type": ["integer", "null"]}
SCHEMA = {
    "type": "object",
    "properties": {"slips": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "employee_name": {"type": "string", "description": "성명 칸 그대로. 안 보이면 빈 문자열"},
            "employer": {"type": "string", "description": "회사 이름. 안 보이면 빈 문자열"},
            "pay_date": {"type": "string", "description": "지급일. YYYY-MM-DD, 안 보이면 빈 문자열"},
            "pay_month": {"type": "string", "description": "귀속연월 YYYY-MM (예: '2026년 11월분'). 안 보이면 빈 문자열"},
            "title": {"type": "string", "description": "명세서 제목·구분 그대로 (예: 11월 급여, 상여, 성과급)"},
            "gross": {**_int, "description": "지급액 합계(지급총액·급여총액), 원"},
            "deduction_total": {**_int, "description": "공제액 합계(공제총액), 원"},
            "net": {**_int, "description": "실지급액(실수령액·차인지급액), 원"},
            **{k: {**_int, "description": f"{v} 공제액, 원. 없으면 null"} for k, v in DEDUCTIONS.items()},
        },
        "required": ["employee_name", "employer", "pay_date", "pay_month", "title", "gross", "deduction_total", "net", *DEDUCTIONS],
        "additionalProperties": False}}},
    "required": ["slips"], "additionalProperties": False,
}


async def _run(paths: list[Path]) -> dict:
    from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

    files = "\n".join(f"- {p.resolve()}" for p in paths)
    prompt = ("다음 급여명세서 사진을 Read 도구로 읽고 명세서마다 slips에 한 건씩 옮겨라. "
              "같은 명세서가 여러 장에 나뉘어 찍혔으면 한 건으로. 숫자는 쉼표 없이 원 단위 정수. "
              "계산하거나 추측하지 말고 보이는 값만. 안 보이는 값은 null.\n" + files)
    options = ClaudeAgentOptions(allowed_tools=["Read"], permission_mode="dontAsk", max_turns=14,
                                 output_format={"type": "json_schema", "schema": SCHEMA},
                                 system_prompt="너는 표 전사 도구다. 보이는 값만 옮긴다. 판단·계산을 하지 않는다.")
    result = None
    async for msg in query(prompt=prompt, options=options):
        if isinstance(msg, ResultMessage):
            result = msg
    if result is None or result.structured_output is None:
        raise RuntimeError(f"명세서 읽기 실패: {getattr(result, 'result', None)}")
    return result.structured_output


def transcribe(paths: list[Path]) -> list[dict]:
    return asyncio.run(_run(paths))["slips"]


def _name(s) -> str:
    return re.sub(r"\s", "", str(s or ""))


def _month(slip: dict) -> str:
    for v in (slip.get("pay_month"), slip.get("pay_date")):
        m = re.match(r"^\s*(\d{4})\D*(\d{1,2})", str(v or ""))
        if m and 1 <= int(m.group(2)) <= 12:
            return f"{m.group(1)}-{int(m.group(2)):02d}"
    return ""


def check(slip: dict, names: dict[str, str], month: str) -> dict:
    """전사 한 건 → 확인 표 한 줄. names: {'me': 이름, 'partner': 이름}.

    who: 성명이 가족 이름과 같으면 그 사람, 아니면 None(사용자가 고른다).
    adds_up: 지급액 − 공제 합계 = 실수령. 공제 합계가 없으면 항목 공제의 합으로 본다(그때는 맞아야만 True).
    """
    emp = _name(slip.get("employee_name"))
    who = next((w for w, n in names.items() if n and _name(n) == emp), None) if emp else None
    title = str(slip.get("title") or "")
    kind = "상여" if re.search(r"상여|성과|보너스|인센티브|명절", title) else "월급"
    deductions = {k: slip[k] for k in DEDUCTIONS if isinstance(slip.get(k), int) and slip[k] > 0}
    gross, net, total = slip.get("gross"), slip.get("net"), slip.get("deduction_total")
    if not isinstance(total, int):
        total = sum(deductions.values()) if deductions else None
    adds_up = all(isinstance(v, int) for v in (gross, net, total)) and gross - total == net
    m = _month(slip)
    return {"who": who, "employee_name": str(slip.get("employee_name") or ""), "employer": str(slip.get("employer") or "")[:40],
            "kind": kind, "label": title[:40], "pay_date": str(slip.get("pay_date") or "")[:10],
            "gross": gross if isinstance(gross, int) and gross > 0 else None,
            "deduction_total": total, "net": net if isinstance(net, int) and net > 0 else None,
            "deductions": deductions, "adds_up": adds_up, "month": m, "in_month": m in ("", month)}
