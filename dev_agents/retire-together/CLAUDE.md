# RetireTogether (둘이서은퇴)

부부 연금·현금 주머니를 규칙대로 굴리는 은퇴 가계 노트. 경로와 명령은 모두 이 폴더(`dev_agents/retire-together/`) 기준.

## 시작할 때
- `docs/BACKLOG.md`에서 할 일을 고른다. 이것만 읽고 시작한다.
- 다른 문서는 그 일에 필요할 때만 연다(아래 문서 지도).
- 작업 세션은 하나다(2026-11-16 결정). 인계·영역 나누기·수신 확인 절차는 없다.

## 지켜야 할 원칙
- 숫자는 코드가 계산한다. LLM은 계산하지 않는다. 공식은 `docs/CALCULATION_RULES.md`대로 순수 함수 + pytest.
- 규칙은 문서·YAML에서 읽는다. 전략 비율·종목 매핑 숫자는 `rules/*.yaml`이 원천이라 문서에 복사하지 않는다.
- 임계치·한도·제도 제약은 deterministic 코드로 판단한다.
- 설명·대화·기억은 Agent가 맡는다. 예측·추천 표현은 쓰지 않는다("오를 것", "이 ETF가 좋다"). 전략·종목은 사용자가 정한다.
- Agent가 쓸 수 있는 도구는 `tools/`의 커스텀 도구뿐이다(SDK 기본 도구는 끔).
- 사용자 결정(수락·거절·가정값 변경)은 `docs/DECISIONS.md`에 적는다.
- 변경 기록은 커밋 메시지로 남긴다. CHANGELOG는 폐지했다(옛 기록은 `docs/archive/`).
- 화면은 `docs/DESIGN_SYSTEM.md`를 따른다. 색·글자 크기는 `web/src/theme.css` 토큰만 쓴다. 견본은 `#design`.
- 첫 화면은 메인 대시보드(`concept.jpg` 구조), 엑셀 워크북은 "표로 보기". 비로그인은 먼저 Google 로그인(2026-11-07).
- 대시보드 구조(총자산/두 주머니 → 도넛/은퇴 목표/알림 → 전략/소득)를 지킨다. 디자인 참고·색 개선 요청을 레이아웃 교체나 소개·온보딩 추가로 넓히지 않는다. 구조가 다른 제안은 별도 시안으로 먼저 보여 주고 사용자가 고른 뒤 반영한다(2026-11-07).

## 구조
- `web/` React·TypeScript·Vite 화면 / `backend/` FastAPI
- `tools/` 계산·등록 도구(Agent 도구 겸용) / `agent/` 메인 Agent / `rules/` 전략·자산 매핑·계좌 YAML
- `tests/` pytest, `web/e2e/` 브라우저 테스트 / `data/` 실제 잔고(git 제외, `data/fixtures/`만 포함)

## 실행
- 개발 서버: `scripts/dev-web.sh` → http://127.0.0.1:5180 (API 8010). 이미 떠 있으면 주소만 알려 준다. 코드를 고치면 저절로 반영된다. 멈췄을 때만 `--restart`.
- 검사: `uv run pytest -q` · `npm --prefix web run build` · `npm --prefix web run test:e2e`
- Agent 대화: `uv run python -m agent ["질문"]`
- 설치·구글 시트 연결은 `docs/LOCAL_DEVELOPMENT.md`, `docs/GOOGLE_SHEETS.md`

## 문서 지도 (필요할 때만)
| 문서 | 언제 |
|---|---|
| `docs/BACKLOG.md` | 늘. 할 일 한곳. 끝나면 줄을 지운다 |
| `docs/MASTER_CONTEXT.md` | 제품 의도·자산 구조(두 주머니·4층)를 확인할 때 |
| `docs/DESIGN_SYSTEM.md` | 화면을 만들거나 고칠 때 |
| `docs/REBALANCING_RULES.md` · `CALCULATION_RULES.md` · `TAX_RULES.md` | 그 계산을 고칠 때 |
| `docs/AGENT_DESIGN.md` | Agent·도구 계약을 고칠 때 |
| `docs/DECISIONS.md` | 예전 결정을 확인하거나 새 결정을 적을 때 |
| `docs/wiki/` | 리서치. 쓰는 절차는 `/wiki-research` |
| `docs/archive/` | 옛 인계·검토·계획 기록. 작업할 때는 읽지 않는다 |
