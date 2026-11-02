# RetireTogether 공통 개발 기준

이 저장소에서 작업하는 Codex는 `CLAUDE.md`를 먼저 읽고 같은 제품·계산·보안 원칙을 따른다.

- 현재 실행 계획과 파일 담당: `docs/AGENT_DESIGN.md` §0.
- 제품 맥락: `docs/MASTER_CONTEXT.md`.
- 화면 기준: `docs/assets/concept.jpg`, `docs/SCREEN_REFERENCE.md`.
- 구조·보안 검토 근거: `docs/ARCHITECTURE_REVIEW.md`.
- 기존 Claude의 리서치와 승인된 투자 규칙을 보존한다. 동일 경로 수정은 담당 확인 후 인계한다.
- 사용자 요청 없이 다른 에이전트의 세션을 복제·재개·종료하거나 미커밋 변경을 되돌리지 않는다.
- 작업 결과는 디자인 검수·데이터 연결·동작·테스트를 구분해 보고한다. 이전 PoC 체크 수를 전체 제품 진행률로 사용하지 않는다.
- **작업 영역**: 리밸런싱·주식·부동산·은퇴를 세션별로 나눠 작업한다. 자기 영역 파일만 고치고 공통 파일은 작게, 고치기 전 DEV_HANDOFF에 한 줄 — 영역별 파일·포트는 `docs/WORK_AREAS.md`.
- **개발 서버는 하나만** (2026-11-02 사용자 결정, 여러 세션 동시 작업): 주소는 늘 http://127.0.0.1:5180 (API 8010). `scripts/dev-web.sh`를 실행하면 이미 떠 있을 때 주소만 알려 주고 끝난다 — 새 포트로 따로 띄우지 않는다. 서버 코드(backend/·tools/·rules/)와 화면은 고치면 저절로 반영되므로 다시 띄울 필요가 없다. 정말 멈췄을 때만 `scripts/dev-web.sh --restart`. 브라우저 테스트는 세션마다 다른 `RETIRE_E2E_PORT`를 쓴다.
