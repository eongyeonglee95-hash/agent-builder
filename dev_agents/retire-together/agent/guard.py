"""답 검사 — Agent가 쓴 답을 코드가 마지막으로 본다.

1. 예측·추천 표현 (tools.explain.FORBIDDEN)
2. 숫자: 금액·비율·주식 수량의 값/부호/단위를 현재 질문의 도구 결과와 대조한다.
   단위 없는 두 자리 이하 정수(목록 번호, "2번 연속" 등)는 보지 않는다.

숫자의 존재를 검사하며 숫자가 어느 계좌·종목에 속하는지까지 증명하지는 않는다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from tools.explain import FORBIDDEN

NUM_RE = re.compile(
    r"(?P<value>[+\-−±]?\d[\d,]*(?:\.\d+)?)"
    r"(?:[ \t]*(?P<unit>%p|%|퍼센트포인트|퍼센트|[조억천백십만]+원|원|주|조|억|만))?"
)
UNIT_ALIASES = {"퍼센트포인트": "%p", "퍼센트": "%"}


def _norm(token: str) -> str:
    return token.replace(",", "").replace("−", "-").lstrip("+")


def numbers(text: str) -> list[str]:
    """서식의 쉼표·공백·양수 기호만 정규화한다. 금액 환산이나 부호 제거는 하지 않는다."""
    out = []
    for m in NUM_RE.finditer(text):
        n = _norm(m.group("value"))
        unit = m.group("unit") or ""
        if unit or "." in n or len(n.lstrip("-±0")) >= 3:
            out.append(n + UNIT_ALIASES.get(unit, unit))
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
