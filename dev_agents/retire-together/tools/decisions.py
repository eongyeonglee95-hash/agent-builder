"""record_decision / read_decisions — docs/DECISIONS.md의 "리밸런싱 제안 기록" 절에 append·조회."""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DECISIONS_PATH = ROOT / "docs" / "DECISIONS.md"
SECTION = "## 리밸런싱 제안 기록"
LINE_RE = re.compile(r"^- (\d{4}-\d{2}-\d{2}) \| (.+?) \| (.+?) \| (.*)$")


def read_decisions(path: Path = DECISIONS_PATH) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    if SECTION not in text:
        return []
    body = text.split(SECTION, 1)[1]
    out = []
    for line in body.splitlines():
        m = LINE_RE.match(line.strip())
        if m:
            out.append({"date": m.group(1), "who": m.group(2), "decision": m.group(3), "reason": m.group(4)})
    return out


def record_decision(decision: str, reason: str = "", who: str = "사용자", on: date | None = None,
                    path: Path = DECISIONS_PATH) -> str:
    on = on or date.today()
    line = f"- {on.isoformat()} | {who} | {decision} | {reason}"
    text = path.read_text(encoding="utf-8")
    if SECTION not in text:
        text = text.rstrip() + f"\n\n{SECTION}\n"
    head, body = text.split(SECTION, 1)
    body = body.replace("(아직 없음)\n", "").replace("(아직 없음)", "")
    text = head + SECTION + body.rstrip("\n") + "\n" + line + "\n"
    path.write_text(text, encoding="utf-8")
    return line
