# RetireTogether (둘이서은퇴)

부부 연금·현금 주머니를 규칙대로 굴리는 은퇴 가계 노트. 현재 목표는 원래 컨셉에 가까운 제품 화면과 안전한 리밸런싱 흐름을 함께 완성하는 것.

## 현재 작업 기준 — 2026-10-27 사용자 승인
- **진행 중인 세션 간 인계**: `docs/DEV_HANDOFF.md`를 읽고 수신 확인을 남긴다. Codex가 사용자 추가 요청(내 정보·배우자 정보·수동 자산 등록)을 `web/`·`backend/`에서 구현 중. 기존 Claude는 SAFE/엔진·투자 규칙 경로를 유지하고 겹치는 파일 수정 전 인계한다.
- 사용자가 Codex 검토 내용을 Claude의 기존 작업에 반영하고 충돌 없이 원래 컨셉대로 진행하도록 요청했다.
- 시각 기준(2026-10-28 사용자 확정으로 변경): 화면 표준은 Tailwind CSS + shadcn/ui, 테마 토큰은 `web/src/theme.css`(근거 `docs/research/UI_REFERENCES.md`). 첫 화면은 엑셀 워크북, 예전 카드형 화면(concept.jpg 기반)은 '다른 버전으로 보기'. 새 화면에 토큰 밖의 색·글자 크기를 쓰지 않는다. 작업 순서·담당·완료 조건의 원본은 `docs/AGENT_DESIGN.md` §0. 상세 검토 근거는 `docs/ARCHITECTURE_REVIEW.md`.
- 목표 스택: `web/` React·TypeScript·Vite + Python·FastAPI. 기존 `app/` Streamlit은 전환 중 비교 도구. 기존 계산 로직은 검증을 보강해 재사용한다.
- 현재 진행 중인 투자 출처·저자 리서치는 유지한다. 전략 비율·종목·투자 규칙 결정과 UI/구조 전환은 별개다. 새 비율이나 종목을 이 전환의 일부로 임의 반영하지 않는다.
- 동시 작업 전 §0의 담당 경로와 협업 메모를 확인한다. 기존 세션의 작업을 복제하거나 다른 작업자의 변경을 되돌리지 않는다. 준비/전달/수신 확인/구현 완료를 구분한다.

## 시작할 때 반드시 읽을 것
1. `docs/MASTER_CONTEXT.md` — 단일 출발점. 제품 철학과 책임 분리 원칙
2. `docs/AGENT_DESIGN.md` — 현재 실행 계획·협업(§0), Agent 정의(§1), 이전 PoC 기록(§2). 현재 범위는 §0이 우선한다
3. 작업 영역에 따라 `docs/REBALANCING_RULES.md`, `docs/CALCULATION_RULES.md`, `docs/TAX_RULES.md`

## 지켜야 할 원칙
- 숫자 → 코드/DB. LLM은 계산하지 않는다. 모든 공식은 `CALCULATION_RULES.md`를 순수 함수로 구현하고 pytest 단위 테스트를 둔다
- 규칙 → `docs/*_RULES.md` (wiki). 코드에 규칙을 하드코딩하지 말고 문서/YAML에서 읽는다
- 판단 조건(임계치·한도·제도 제약) → deterministic logic
- 설명/대화/기억 → Agent. 예측·추천 표현 금지("오를 것", "이 ETF가 좋다")
- 전략과 종목은 사용자가 정한다. Agent는 전략을 바꾸거나 추천하지 않는다
- 사용자 결정(수락/거절/사유, 가정값 변경)은 `docs/DECISIONS.md`에 기록
- 문서를 고치면 `docs/CHANGELOG.md`에 한 줄 남긴다
- Agent 허용 도구는 `tools/`의 커스텀 도구만. Bash·파일 편집 등 SDK 기본 도구는 비활성
- 전략 비율·종목 매핑 숫자는 `rules/*.yaml`이 원천. 문서에 숫자를 복사하지 않는다

## 저장소 구조 (목표)
- `docs/` 기획·규칙 문서. `docs/wiki/` 리서치 위키 — 쓰고 갱신하는 절차는 `/wiki-research` 스킬
- `web/` 목표 React 화면, `backend/` 목표 API·서비스·저장소 (현재 계획, 착수 여부는 AGENT_DESIGN §0)
- `app/` 기존 Streamlit 화면 (전환 중 비교용)
- `agent/` 메인 Agent와 프롬프트
- `tools/` parse_balance / tag_assets / load_strategy / compute_rebalance / explain_inputs / build_order_sheet / record_decision
- `rules/` 전략 YAML, 자산군↔종목 매핑 YAML, 계좌 목록 YAML(소유자·증권사·계좌종류)
- `data/` 샘플 CSV·캡처, 결정 기록
- `tests/` 계산 함수 단위 테스트

## 기술
현재 실행 코드: Python 3.12 + uv, Claude Agent SDK, pandas, PyYAML, pytest, Streamlit. 전환 목표: TypeScript·React·Vite + Python·FastAPI·Pydantic, 로컬 SQLite. 전환을 완료했다고 보고하지 않는다.
실행: `uv run pytest` / 등록 `uv run python -m tools.register --account <id> --images <png...> --out <csv>` / 드라이런 `uv run python -m tools.cli --holdings <csv> --pool me_pension [--new-cash 3000000 --new-cash-account <id>] [--live]` / 화면 `scripts/dev.sh`(기존 서버 내리고 PYTHONPATH=. 로 띄움 — tools/ 변경도 자동 반영. `uv run streamlit run app/main.py`로 직접 띄우면 tools/를 고친 뒤 서버를 다시 띄워야 한다).
tools/: strategy(load_strategy) · assets(tag_assets, 제약 검증, 계좌·풀) · market(종목코드·현재가) · rebalance(compute_rebalance 순수 함수) · explain(왜 지금 템플릿) · order_sheet · decisions · parse_balance(CSV·캡처) · cli. 자동주문(KIS API)은 후속 단계 — 지금은 드라이런만. 현재 범위와 순서는 `docs/AGENT_DESIGN.md` §0.
