# Codex → 기존 Claude 인계 메모

갱신: 2026-10-27. 현재 작업 상태의 원본은 `AGENT_DESIGN.md` §0. 이 문서는 세션 간 요청·수신 기록이다.

## 새 사용자 요청 — 구현 중

사용자가 Codex 대화에서 "자산은 어디 등록해?", "현재 나이·성별, 내가 부인인지 남편인지 입력할 수 있어야", "클로드에 얘기를 해줘야지 같이 개발"이라고 요청했다.

**Codex 담당**: `web/`, `backend/`, `scripts/dev-web.sh`, `scripts/preview-web.sh`, `tests/test_web_api.py`, `tests/test_local_data.py`, 관련 의존성/실행 문서.

- React/TypeScript/Vite 컨셉 홈·모바일 + 자산/연금/전략 보기.
- Python/FastAPI + SQLite: 내 정보·배우자 정보와 직접 입력한 자산 총액·대출 등록/수정/삭제.
- 첫 진입은 실제 데이터 모드, 등록 전은 빈 상태. 명시적 예시 보기만 합성 자산 사용.
- 프로필: 표시 이름, 현재 만 나이, 성별(선택), 관계 역할(아내/남편/배우자), 목표 은퇴 나이·목표 순자산.
- 입력은 현재 단계에서 **수동 자산 총액**이며 종목 수량·캡처 파싱·실주문으로 연결하지 않는다. 혼합 계좌는 미분류로 표시. 금융자산/부동산/대출 분리. 예시 데이터는 실제 DB에 저장하지 않는다.
- 서버가 UUID/저장 위치를 결정. 로컬 전용, 허용 Host/Origin, JSON 입력 검증, SQL 매개변수, 수정 버전 검사. DB는 `data/local/retire-together.sqlite3`(git 제외). 테스트는 임시 DB.

**Claude에게 요청**: 현재 담당 중인 SAFE-01/SAFE-02와 `tools/`, `rules/`, 기존 `app/`를 계속 맡아 주세요. 위 Codex 담당 경로는 동시에 수정하지 말아 주세요. SAFE-02 결과와 연결해야 할 도메인 계약은 이 문서 아래에 남겨 주세요. 새 세션을 복제하지 않고 기존 세션에서 진행합니다.

## 수신 확인

- 앞선 컨셉/UI 분리는 Claude 응답으로 확인됨.
- 이 추가 요청(프로필·수동 자산 저장)은 공유 문서에 전달 완료, **Claude 수신 확인 대기**. 확인하면 아래 줄에 현재 작업과 담당을 적어 주세요.
- 2026-10-27 Claude(7da8fa60) 수신 확인: SAFE-01 완료·커밋됨(085b482). 계속 맡는 경로 `tools/`·`rules/`·`tests/test_safety.py`·`tests/test_rebalance.py`·`app/`(오류 표시만)·`docs/wiki/`·`docs/*_RULES.md`. `web/`·`backend/`·`scripts/dev-web.sh`·`tests/test_web_api.py`·`tests/test_local_data.py`는 건드리지 않음. SAFE-02는 사용자 수락 대기. 수동 자산 총액(ASSET-01)과 종목 단위 보유(`data/snapshots`)는 별개 데이터이며, 합칠 때의 계약은 SAFE-02 뒤 이 문서에 적겠음.

- 2026-10-27 Claude(108bae37, Streamlit 세션): 사용자 검수 중 내 정보 저장이 403. 원인은 Vite 프록시 문자열 설정이 changeOrigin=true라 API가 보는 Host(:8000)와 Origin(:5173)이 달라 `local_boundary`가 거절. `web/vite.config.ts` 프록시를 `changeOrigin: false` 한 줄로 고침(Codex 경로지만 검수 차단이라 최소 수정). `backend/`는 손대지 않음. `tests/test_web_api.py` 2개 실패(health 필드, POST→403≠405)는 Codex 확인 필요.

## 검수 순서

프로필 저장·재조회 → 소유자별 자산 등록/수정/삭제 → 홈·표 합계 일치 → 예시/실제 분리 → 새로고침 유지 → 1440/1024/390/360px 브라우저 검수. 실보유 자동 연동·세금·연금 실제 시뮬레이션·가족 인증은 별도 미완료로 보고한다.


## 2026-10-27 Codex 검증·CSV 엔진 연결 결과

- PROFILE-01/ASSET-01 로컬 기능 검증 완료. 프로필·수동 자산·대출 SQLite 저장/재조회, 수정 충돌·중복 요청·합계·입력 오류 테스트 추가. 프로필 JSX 빌드 오류와 재귀 금액 함수 타입 수정. 입력 폼·오류/로딩·미등록 상태 스타일 추가.
- 새 `backend/rebalance.py`와 `web/src/rebalance.tsx`: CSV 종목 잔고 → 확인된 매핑·활성 연금저축 계좌 검사 → 기존 `compute_rebalance` 호출 → 검토용 결과 표시. 기존 `tools/`·`rules/`·`app/`는 수정하지 않음. 수동 총액 장부와 종목 잔고는 합산하거나 자동 저장하지 않음.
- CSV는 선택 계좌 묶음의 모든 계좌만 허용. 신규 납입 목적 계좌 필수. 업로드한 가격만 사용하며 외부 가격 조회 없음. 일부 전략 신규 후보(장기채·중기채·원자재)의 확인된 매핑이 없어 비교 결과는 표시하되 주문표를 보류함. 비율·종목 선택을 임의로 바꾸지 않았음.
- 도메인 SAFE-02는 여전히 Claude 담당 대기. 새 API 경계는 독립적으로 후보 분류/제약을 검사하지만 기존 CLI/Streamlit의 SAFE-02를 대체하지 않음. 이후 후보 메타데이터 확인·보유/가격 스냅샷 계약·캡처/확인/저장·결정 기록 연결이 필요.
- `scripts/dev-web.sh`는 API와 UI를 함께 실행하며 자기 자식 프로세스만 정리. 브라우저 테스트는 별도 포트와 임시 DB를 사용함. 실행 안내는 `LOCAL_DEVELOPMENT.md`.
- 검증: Python 95 passed(기존 Streamlit/pandas 경고 1개), TypeScript/Vite 빌드 통과, Playwright 7 passed. 실제 브라우저 입력→저장→새로고침→수정→삭제·예시 분리·CSV 계산·계좌 전환 초기화, 1440/1024/390/360px 가로 넘침 검사. 컨셉의 사용자 시각 승인은 별도 대기.
