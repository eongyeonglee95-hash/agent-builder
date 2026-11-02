"""답 검사 — Agent가 쓴 답을 코드가 마지막으로 본다.

1. 예측·추천 표현 (tools.explain.FORBIDDEN)
2. 숫자: 답에 나온 금액·비율·수량이 이번 대화의 도구 결과에 그대로 있는지. 없으면 LLM이 계산·환산했거나 지어낸 것이다.
   두 자리 이하 정수(목록 번호, "2번 연속" 등)는 보지 않는다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from tools.explain import FORBIDDEN

NUM_RE = re.compile(r"[+\-−]?\d[\d,]*(?:\.\d+)?")


def _norm(token: str) -> str:
    return token.replace(",", "").lstrip("+-−")


def numbers(text: str) -> list[str]:
    out = []
    for m in NUM_RE.finditer(text):
        n = _norm(m.group())
        if "." in n or len(n.lstrip("0")) >= 3:
            out.append(n)
    return out


@dataclass
class GuardResult:
    forbidden: list[str]
    unverified: list[str]

    @property
    def ok(self) -> bool:
        return not self.forbidden and not self.unverified

    def warning(self) -> str:
        parts = []
        if self.forbidden:
            parts.append("금지 표현: " + ", ".join(self.forbidden))
        if self.unverified:
            parts.append("도구 결과에 없는 숫자(직접 확인 필요): " + ", ".join(self.unverified))
        return " / ".join(parts)


def check_answer(answer: str, tool_text: str) -> GuardResult:
    known = set(numbers(tool_text))
    unverified = list(dict.fromkeys(n for n in numbers(answer) if n not in known))
    forbidden = [w for w in FORBIDDEN if w in answer]
    return GuardResult(forbidden, unverified)
