# dev_agents 작업공간

여러 에이전트를 각자 폴더에서 개발하는 저장소다. 폴더끼리 규칙·문서·데이터를 섞지 않는다.

| 폴더 | 내용 | 먼저 읽을 것 |
|---|---|---|
| `dev_agents/retire-together/` | 둘이서은퇴 — 부부 연금·현금 리밸런싱 가계 노트 (제품) | 그 폴더의 `CLAUDE.md` |
| `dev_agents/cooking/` | 요리 실습 에이전트 | `README.md`·`PLAN.md` |
| `dev_agents/saju/` | 신년운세(사주) 리서치·시안 | `README.md`·`CODEX_HANDOFF.md` |
| `dev_agents/tarot/` | 타로 리서치 | `README.md` |

- 명령(pytest·uv·npm·scripts)은 해당 에이전트 폴더 안에서 실행한다. 예: `cd dev_agents/retire-together && uv run pytest`
- 새 에이전트는 `dev_agents/<이름>/`에 README·PLAN·research/ 패턴으로 만든다.
- `.claude/`(스킬·서브에이전트)와 `.agents/`(Codex 스킬)는 저장소 루트에 둔다. 둘이서은퇴용 스킬(`wiki-research`, `wiki-updater`)의 경로는 `dev_agents/retire-together/` 기준이다.
