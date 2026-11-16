# SHARE-07 통합 검수 기록과 실제 검수 절차

2026-11-09 · 작업 `88070bf3-7b9c-4b1f-8d24-7256d79a86ce`.
상태 원본: [AGENT_DESIGN §0](../AGENT_DESIGN.md). **점검 도구·합성 API 회귀 완료, 금융 화면 연결 미결·브라우저 재검수·실제 두 계정 검증 대기. SHARE-07 최종 완료가 아니다.** `verify_task`는 호출하지 않았다.

## 범위와 변경

새 로컬 세션에서 AGENTS/CLAUDE·담당/인계·공유 요구사항을 읽고 MCP `get_task_detail`로 선행02~06의 completed를 확인한 뒤 `execute_task`로 착수했다. 이 세션은 SHARE-07 전용 점검/검수와 발견한 공통 설정 결함만 담당했다. 영역별 금융 화면 전환은 기존 담당과 연결해야 하는 사전 미결로 유지했다.

- `backend/shared_preflight.py`: OAuth·Picker·인증/금융 DB 분리·파일 권한·HTTPS 설정을 읽기 전용 점검한다. 결과에 금융 화면 미연결 목록과 실제 검수 항목을 함께 표시한다. 네트워크·DB 열기/생성·설정 저장·금융 자료 읽기 없음. 구성값/비밀값/실제 파일 경로를 출력하지 않는다.
- `backend/auth_config.py`, `backend/shared_sheets.py`: 공백 API 키·전각 숫자/0 프로젝트 번호가 Picker 정상 응답을 만들던 3건을 재현한 뒤 수정했다. 같은 형식 검사를 실제 Picker API와 사전 점검에서 사용한다. 형식 통과는 실제 키 유효성/프로젝트 일치 확인이 아니다.
- `tests/test_share_preflight.py`: 설정 누락/잘못된 값·OAuth 파일 오류·저장소 권한/링크/금융 DB 혼용·HTTP/HTTPS 구분·무쓰기/무통신/비밀값 비노출 **21개**.
- `tests/test_share_integration.py`: 서명된 합성 로그인·실제 FastAPI/SQLite/Google HTTP 어댑터로 통합 흐름 **18개**. 기존 임시 자료 fixture를 재사용하며 실제 Google 응답만 가짜다.

기존 미커밋 구현을 되돌리지 않았고 UI 레이아웃·투자 규칙·운영 금융 자료/세션/토큰·공용 5180/8010·다른 세션을 변경하지 않았다. 커밋/푸시/배포·초대 전송·다음 작업 실행 없음.

## 이번 세션에서 실제 실행한 검수

| 구분 | 결과 | 의미/한계 |
|---|---|---|
| 변경 전 전체 Python | 635 passed, 11.14초 | 기존 인계 결과 재현 |
| 신규 사전 점검/통합 API | 39 passed, 1.71초 | 21 설정 + 18 API; 두 실제 계정 아님 |
| 변경 후 전체 Python | **674 passed, 12.33초** | 기존635 + 신규39; 실패/skip 없음 |
| 브라우저 임시 서버 `--check` | 통과 | 합성 생성/재시도·이전·가입 대기·Picker·고정 명의 홈·해제. 소켓/브라우저를 사용하지 않음 |
| 웹 빌드 | 통과 | 기존 CSS @import·500kB 번들 경고 남음; 제품 UI 변경 없음 |
| Playwright 공유8개 재실행 | **서버 시작 실패, 테스트 미실행** | 전용8788, 가짜 제공자의 socket bind가 `PermissionError: [Errno 1] Operation not permitted`. 권한 확대 불가. 이전06의 브라우저15통과를 이번 통과로 세지 않음 |
| 현재 셸의 OAuth 파일 검사 | 통과 | loopback HTTP를 해당 검사 명령에만 허용. 파일 형식·0600·콜백만 확인 |
| 현재 셸의 local 사전 점검 | 미충족을 정상 탐지(exit 1) | OAuth·DB 분리·권한 통과, Picker 키/프로젝트 번호 환경변수 없음 |
| 현재 셸의 HTTPS 사전 점검 | 미충족을 정상 탐지(exit 1) | 웹 모드/HTTPS 원본이 셸에 설정되지 않음. 실행 중인 제품 서버의 환경이라고 추정하지 않음 |
| 실제 Google 두 계정/Picker/시트·HTTPS | **미실행** | 검수용 HTTPS 주소·두 계정 로그인 준비/별도 시트가 이 세션에 제공되지 않음. 기존 운영 동의가 없다는 뜻이 아님 |
| 디자인 | 변경 없음·이번 시각 검수 미실행 | 기존 대시보드/공유 설정 디자인 유지 |

첫 신규 API 실행의 15실패 중 12개는 테스트의 FastAPI 라우트 열거 방식 오류였으며 OpenAPI 계약 조회로 수정했다. 나머지 3개는 위 Picker 설정 결함으로 제품 수정 후 모두 통과했다. 이 구분을 제품 결함 수나 성공률로 섞지 않는다.

통합 시나리오는 다음을 연결해 검증했다.

1. 같은 공유 상태·고정 사람 ID → 배우자 프로필/연금/부동산 계획을 같은 revision으로 저장 → 응답 유실 → 같은 UUID 재조회로 중복 추가 없음 → 오너가 같은 결과 조회 → 오래된 revision 거부.
2. 실제 어댑터가 읽는 공유 이력에 손상 행 추가 → 양쪽 홈 조회 실패 → 오너의 이전 버전 복구는 배우자 편집 허용 전403 → 본인 허용 후 복구/합계 일치 → 손상 행 보존.
3. 재로그인·제3자 차단 → Drive 삭제 실패에도 배우자의 두 앱 세션 먼저 차단 → 정리 재시도 성공 → 오너/파일/로컬 원본 유지. 같은 Google 사람 재초대 시 새 앱 멤버십과 기존 금융 명의가 구분되어 보존됨.
4. HTTPS 요청을 TestClient로 구성해 `__Host-`/Secure/HttpOnly/SameSite/Path·no-store·Origin/Host/CSRF·HTTP 차단 확인. **실제 TLS 인증서·프록시·브라우저 쿠키 검수는 아니다.**
5. 미전환 금융 API의 대표 12개 요청은 이전 후 오너409/배우자403·원본/공유 자료 무변경 확인. **접근 차단 테스트 통과는 영역 기능이 작동한다는 뜻이 아니다.**

## 아직 연결되지 않은 금융 화면 — 설정과 별개인 구현 미결

| 영역 | 현재 호출/경로 예 | 다음 구현·검수 |
|---|---|---|
| 워크북·등록·리밸런싱 | `workbook/Workbook.tsx`, `RebalancePlan.tsx`, `register.tsx` → `/workbook/*`, `/register/*` | 공유 스냅샷·고정 계좌 명의로 조회/등록/보고서/주문표 연결. 규칙/결정은 별도 승인 계약 보존 |
| 보유종목·계좌 | `holdings.tsx` → `/holdings`, `/register/accounts` | 고정 계좌→멤버 매핑·종목 저장·평가액/요약 일치 |
| 은퇴 | `workbook/retirement.tsx` → `/retirement`, `/plan`, `/preview` | 공유 프로필/개인계획/가구계획으로 기존 순수 계산 호출, 로그인 기준 표지만 변환 |
| 부동산 | `property-move/`·`property-entry.tsx` → `/property-move`, `/property` | 공유 집/지분/대출/후보/추적·계획으로 계산과 원자 저장, 연결 삭제/충돌 검수 |

이 표는 API 차단을 해제하라는 지시가 아니다. `WORK_AREAS.md` 담당 경로를 인계하고 각 영역에 revision/UUID·개인 편집 허용·고정 명의 계약을 연결한 뒤 두 사람 읽기/쓰기를 검수해야 한다. 이번 전용 점검/통합 회귀가 그 구현을 대신하지 않는다. **설정만 채워도 전체 공유 사용이 가능해지는 상태가 아니며, 운영 자료 이전을 진행하지 않는다.**

## 재현 명령

저장소 작업 폴더에서 실행한다. 첫 세 명령은 임시 자료만 사용한다.

```sh
.venv/bin/python -m pytest -q tests/test_share_preflight.py tests/test_share_integration.py
.venv/bin/python -m pytest -q
.venv/bin/python web/e2e/share-server.py --check
npm --prefix web run build
git diff --check
```

설정 점검은 서비스와 같은 환경변수를 제공한 프로세스에서 실행해야 한다. 다음 local 예시는 현재 셸에서만 HTTP 검사를 허용하며 서버 설정을 저장하지 않는다.

```sh
RETIRE_AUTH_MODE=web RETIRE_AUTH_ALLOW_HTTP=1 .venv/bin/python -m backend.shared_preflight --target local
.venv/bin/python -m backend.shared_preflight --target https
```

종료0은 **정적 설정만** 통과했다는 뜻이다. 결과의 `live_verification`은 항상 `not_run`이며 이 명령은 실계정 검증이나 완료 판정을 하지 않는다. Google 프로젝트 일치/키 원본 제한/API 활성화·실제 저장소 생성 후 권한은 별도 확인한다. 점검은 누락 설정을 자동 생성/변경하지 않는다.

로컬 소켓·Chrome이 허용되는 세션에서 제품 서버와 분리된 테스트 포트로 브라우저 검수를 다시 실행한다. 테스트 서버는 가짜 Google을 쓰므로 아래 통과도 실제 Google 검수로 세지 않는다.

```sh
RETIRE_E2E_PORT=8788 npm --prefix web exec -- playwright test --config=web/share.playwright.config.ts
RETIRE_AUTH_BROWSER_TEST=1 RETIRE_E2E_PORT=8789 npm --prefix web exec -- playwright test --config=web/auth.playwright.config.ts
```

## 운영자가 준비할 것 — 아직 실행하지 않음

1. 운영 가구/원본과 분리된 검수 환경을 마련한다. 별도 체크아웃/호스트의 빈 금융 DB·합성 YAML/CSV·별도 인증 DB/백업 폴더를 사용한다. 운영 인증 DB·token.json·금융 DB를 복사하지 않는다. 금융 DB 경로는 현재 `backend/storage.py`의 체크아웃 기준 고정 경로이므로 **RETIRE_AUTH_DB만 바꾸어도 금융 자료까지 격리된다고 가정하지 않는다.** `share-server.py`는 가짜 제공자 검수용이며 실제 Google 검수 서버로 사용하지 않는다.
2. 기존 OAuth 클라이언트와 같은 Google 프로젝트의 Drive/Sheets/Picker API, 테스트 앱의 두 테스트 사용자, 검수 원본/정확한 콜백 URI를 확인한다. 서버에는 비공개 웹 OAuth 파일과 `RETIRE_GOOGLE_PICKER_API_KEY`, 양의 ASCII 숫자 `RETIRE_GOOGLE_PROJECT_NUMBER`를 설정한다. 키/비밀값은 대화·문서·Git에 기록하지 않는다. Picker 키의 Website 제한은 검수 도메인과 Picker iframe 도메인, API 제한은 사용 API를 공식 안내에 맞춰 확인한다. [Google Picker 웹 설정](https://developers.google.com/workspace/drive/picker/guides/web-picker), [웹 서버 OAuth 설정](https://developers.google.com/identity/protocols/oauth2/web-server).
3. 최초 오너는 검수 환경의 loopback 초기 설정에서 본인이 로그인해 만든다. 완료 후 `RETIRE_AUTH_BOOTSTRAP=0`으로 닫고 같은 검수 인증 DB를 유지한 채 HTTPS 원본/콜백·프록시를 설정한다. 현재 공용 개발 서버를 재설정하거나 추가 개발 서버를 띄우라는 뜻이 아니다. HTTPS 전환 뒤 `RETIRE_AUTH_MODE=web`, `RETIRE_AUTH_ALLOW_HTTP=0`을 확인한다.
4. 검수 주소와 두 계정 로그인 준비 여부만 담당자에게 전달한다. 별도 테스트 시트는 합성 자료만 포함한다. 두 사람이 각자 로그인/동의하며 계정 비밀번호나 토큰을 전달하지 않는다. 실제 외부 설정 변경·파일 생성/공유/삭제는 검수 범위를 명시한 뒤 해당 환경에서만 수행한다.

## 실제 두 계정·복구·배포 전 검수표 — 전부 미검증

검수자는 각 행에 실행일·합성 사례·기대/실제 결과·비식별 근거를 기록한다. 계정 이메일/sub·파일 ID·토큰·초대 코드·금융 자료는 기록에서 제외한다. 실제 검수의 모든 행과 위 금융 화면 연결이 통과하기 전 `verify_task` 완료 금지.

| 항목 | 실제 절차와 통과 조건 | 상태 |
|---|---|---|
| 오너/배우자 동의 | 각자 로그인과 drive.file 동의; 앱의 고정 오너·동일 가구가 로그인 순서로 바뀌지 않음 | 미검증 |
| Picker 기존 파일 | 오너 소유의 별도 기존 테스트 파일 선택·서버 양식 확인, 배우자도 필요한 경우 같은 파일 승인. 새 파일 중복 생성 없음 | 미검증 |
| 초대 왕복 | 오너 발급→별도 전달→배우자 본인 수락→Drive 공유/앱 가입 각각 확인→두 사람 로그아웃/재로그인 시 같은 파일 | 미검증 |
| 제3자/초대 상태 | 초대 없는 계정·다른 대상·만료·취소·재사용 차단. 중간 공유 성공/앱 실패는 재개 또는 정리 | 미검증 |
| 이전 대조 | 합성 원본 백업·복원 확인, 원천/선택 결과 건수·계좌 평가액·명의별 합계·공동 지분·고정 은퇴 기준 확인 후 테스트 자료만 이전 | 미검증 |
| 두 기기·영역별 동작 | 별도 브라우저/기기의 각 사람 프로필/자산/보유종목/은퇴/부동산/계좌·계획 저장·계산·재조회 일치, 상대 자료 허용/철회 | 미검증 |
| 저장 경쟁 | 같은 revision의 두 저장·시트 직접 수정·네트워크 응답 유실: 충돌 표시/초안 보존/같은 UUID 조회, 중복·덮어쓰기 없음 | 미검증 |
| 오류와 복구 | 테스트 파일 접근 철회/삭제·토큰 만료·일시 오류 때 원래 연결 유지. 별도 시트의 합성 손상/백업 before/proposed 대조 후 복구, 원본 이력/명의 유지 | 미검증 |
| 접근 해제 | 배우자 두 앱 세션 차단, 앱이 만든 Drive 직접 권한 삭제, Google 직접 열기로 확인. 그룹/기존 공유 등 잔존 접근을 별도 기록 | 미검증 |
| HTTPS | 실제 인증서/브라우저 Secure·HttpOnly·SameSite·__Host 쿠키, 신뢰 프록시만 HTTPS 전달, CSRF/Host 차단·콜백 쿼리 로그 비노출 | 미검증 |

실제 자료 이전/운영 배포는 이 검수 기록으로 자동 승인되지 않는다. 현 세션은 검수 도구와 증거만 남기고 작업을 `in_progress`/문서 ‘검증 대기’로 유지한다.
