# SHARE-06 화면 구현·검수 기록

2026-11-09, 작업 `2075ad16-f0a5-46d6-acc5-baa83bc320b0`. 상태 원본은 [AGENT_DESIGN §0](../AGENT_DESIGN.md). **주 대화에서 브라우저 제한을 해소하여 실제 화면 결함 3건을 수정했고, 공유 화면 8개·인증 7개가 모두 통과했다. SHARE-06의 화면 구현·격리 검수 완료 기준을 충족했다.** 실제 Google 두 계정과 모든 금융 화면의 공유 저장 전환 완료를 뜻하지 않는다.

## 주 대화 후속 검수 — 2026-11-09

최초 실행기의 `socket bind EPERM`·Chrome SIGABRT는 그 실행 환경의 제한이었다. 공용 서버를 바꾸지 않고 테스트 전용 8786/8787에서 Chrome을 실행했다. 첫 공유 검수는 5개 통과/3개 실패였으며, 다음 제품 결함을 수정한 뒤 8개 모두 통과했다.

- 초대 취소 후 같은 탭에서 링크를 다시 열 때 초대 화면을 새 방문으로 처리하여 새 코드를 메모리에 읽고 URL에서 제거한다. 기존 초대 화면에 남아 새 링크가 적용되지 않던 문제를 수정했다.
- 가입 대기에서 공유 확인을 마친 뒤에는 문서 이동으로 새 서버 세션을 읽는다. 해시만 바꾸어 로그인 전 상태가 남던 문제를 수정했다.
- 편집 허용 체크는 요청 중 선택을 표시하고 실패하면 서버의 이전 값으로 돌아온다. 편집 권한 자체는 성공한 서버 응답으로만 갱신한다. 실패·재시도·서버 권한 불변도 브라우저에서 확인했다.

최종 결과: **공유 브라우저 8 passed (29.6초), 인증 브라우저 7 passed (13.2초), 웹 빌드·diff 검사 통과**. 기존 Python635개는 최초 구현자의 실행 근거로 유지하며 이번 프론트 수정으로 다시 실행한 결과로 세지 않는다. 1440/390/360px에서 공유 설정 3탭의 가로 넘침 없음·키보드 이동·Escape 닫기·합성 캡처를 확인했다. 캡처는 `web/test-results-8786/` 아래이며 운영 가계 자료는 사용하지 않았다.

아래 ‘최초 실행’의 미실행 기록은 당시 증거로 보존한다. 현재 검수 상태는 이 후속 결과를 따른다.

## 구현한 화면과 연결

- 기존 대시보드 구조를 유지하고 시트 연결 창에 공통 시트·우리 자료·배우자 초대를 연결했다. 최초 고정 오너 안내는 기존 로그인 흐름을 재사용한다. 웹 모드에 OAuth JSON 입력을 노출하지 않는다.
- 공통 시트 생성, 생성 응답 유실 후 같은 요청 재확인, Google Picker 기존 파일 선택, 서버의 소유권/양식 검사, 미설정/취소/로딩 실패 안내, 같은 파일 접근 재승인, 계정별 동의 해제·재동의. 파일 ID와 오너는 유지하며 새 파일이나 로컬 장부로 자동 전환하지 않는다.
- 초대 이메일·링크 발급/복사, 목록·기한·취소·가입 후 접근 해제, 앱 접근 차단과 Drive 정리 상태 분리. 링크 코드는 fragment에서 메모리로 읽고 주소에서 제거한다. 로그인 전 코드 입력·Google 본인 확인·가입 대기/동일 파일 Picker·공유 재개를 연결했다. 다른 계정·취소·만료 메시지를 구분한다.
- 이전 전 원본 건수/명의/합계, 충돌별 원본 선택과 **선택 후 서버 합계 재대조**, 명시적 이전 확정, 백업 목록/버전 대조·복구. 저장 UUID는 같은 화면에서 내용이 같으면 재사용한다. 새로고침 후 불확실한 저장은 최신 자료 확인/백업 복구로 다룬다.
- 고정 멤버 조회, 로그인한 사람의 나/배우자 이름, 본인 이름/나이 수정, 상대방 편집 허용, 명의별 계좌·계획 확인. 서버가 변경 명의·권한·revision을 검사한다. 수정 충돌에서 초안을 유지하며 다시 읽기는 명시적으로 초안을 닫는다.
- 메인 대시보드에 공유 자료 조회를 연결했다. 공동 지분의 기준 사람과 은퇴 목표 기준 사람은 고정하고 표시만 로그인 기준으로 바꾼다. 계정 메뉴의 배우자를 오너로 잘못 표시하던 부분을 수정했다.

주요 경로: `web/src/auth/{SharedSheetAccess,InvitationEntry,InviteManager,SharedDataPanel}.tsx`, `picker.ts`, `shared-data-types.ts`, `shared-sheet-access.css`. 공통 연결: `AuthGate.tsx`, `google.tsx`, `App.tsx`, `local-data.ts`, `model.ts`.

서버 보완: `shared_sheets.py` 상태의 `data_started`, `household_invites.py` 콜백 오류 분류, `shared_data.py`의 대조/조회 응답, 신규 `shared_data_view.py` 읽기 전용 표시 변환. 기존 선행 작업의 미커밋 구현은 이어서 사용했으며 투자 규칙·다른 영역 자료를 수정하지 않았다.

## 최초 실행에서 수행한 검증

| 검증 | 결과 | 범위 |
|---|---|---|
| 전체 Python | **635 passed, 11.91초** | `.venv/bin/python -m pytest -q`; 기존 630개와 새 API 계약 5개 |
| 화면용 API 계약 | **5 passed** | 두 사람 조회·공동 지분 반올림·세부자산 중복 제외·고정 은퇴 기준·이전 전/오류의 로컬 대체 금지·복구 합계·편집 허용·충돌 선택 합계 |
| 브라우저 임시 서버 자체 점검 | **통과** | `share-server.py --check`; FastAPI TestClient·합성 두 사람·가짜 Google HTTP·임시 자료로 생성1회/재시도·이전·가입 대기/Picker 설정/재개·조회·접근 해제 |
| 웹 빌드 | **통과** | `npm --prefix web run build`; 기존 CSS `@import`/큰 번들 경고는 남음 |
| 브라우저 테스트 TypeScript 검사 | **통과** | 전용 spec/config의 strict 타입 검사 |
| Playwright 테스트 수집 | **8개 수집** | 파일/Picker/초대/명의/재방문/복구/모바일·키보드/이전 충돌 시나리오. 수집은 실행 통과가 아님 |
| 변경 공백 검사 | **통과** | `git diff --check` |
| 격리 브라우저 실행·스크린샷 | **미실행** | 테스트 서버의 socket bind가 `PermissionError: [Errno 1] Operation not permitted`. 독립 Chrome 실행도 SIGABRT로 종료. 이 세션의 sandbox/approval=never로 재실행 불가 |
| 실제 Google 계정·Picker·공유 | **미실행** | 실제 키/계정/금융 자료를 열거나 변경하지 않음. SHARE-07 필수 실검증 |

E2E용 `web/e2e/share-server.py`는 임시 인증/금융 DB·YAML·파일 경로만 사용한다. 합성 로그인 제공자와 Google HTTP fixture를 사용하며 외부 Google 요청을 금지한다. 테스트 제어 경로는 이 임시 서버 프로세스에만 등록된다. `--check`는 네트워크 소켓과 브라우저 없이 실행되며 브라우저 검수를 대신하지 않는다.

## 검수 재현과 남은 제품 연결

아래 검수는 주 대화에서 통과했다. **SHARE-07은 시작하지 않았다.** 재현 시 로컬 socket/Chrome 실행이 허용되는 환경에서 저장소 작업 폴더 기준:

```sh
npm --prefix web run build
RETIRE_E2E_PORT=8786 npm --prefix web exec -- playwright test --config=web/share.playwright.config.ts
RETIRE_AUTH_BROWSER_TEST=1 RETIRE_E2E_PORT=8787 npm --prefix web exec -- playwright test --config=web/auth.playwright.config.ts
```

두 포트는 격리 검수 전용이며 공용 개발 서버 5180/API 8010을 재시작하거나 대체하지 않는다. 기존 포트가 사용 중이면 다른 **테스트** 포트를 선택한다. 새 테스트의 실제 실행에서 발견되는 화면·선택자·포커스·모바일 결함은 SHARE-06에서 수정한 뒤 완료 여부를 판단한다. 특히 Google Picker iframe을 여는 동안 기존 native dialog의 modal 상태를 잠시 풀고 복원하는 처리는 실제 브라우저 검수가 필수다.

브라우저 검수와 별개로 남은 제품 연결 경계도 확인해야 한다. 이번에 연결한 공유 화면은 홈 조회·가족 이름/나이·편집 허용·계좌/계획 확인·이전/복구 관리다. **기존 워크북 등록/저장, 연금·부동산 계산/계획 편집, 보유종목 등록 등의 모든 금융 화면을 공유 API로 전환한 것은 아니다.** 이들은 기존 API를 사용하며 이전 시작 후 409 또는 배우자 403으로 차단하는 선행 안전 경계를 유지한다. 운영 자료 이전이나 전체 공유 사용이 준비되었다고 안내하지 않는다. 전체 금융 흐름은 영역 담당과 연결 범위를 확인해야 한다.

SHARE-07에는 실제 두 Google 계정, 별도 테스트 시트, 같은 OAuth 프로젝트의 Picker API 키·숫자 프로젝트 번호·원본 제한 설정, 새 기존 파일의 접근 승인→ID 전달, 초대/공유/수락/재로그인/해제, 두 기기 명의·계획 일치, 자료 대조/복구·HTTPS를 인계한다. 이번 세션에서는 운영 Picker 설정의 존재나 유효성을 검사하지 않았으며 설정값을 기록하지 않았다.

## Picker 구현 근거

브라우저에서 단기 access token·프로젝트 번호·개발자 키·원본을 사용하고 SPREADSHEETS 뷰의 선택 ID만 서버로 전송한다. refresh token이나 클라이언트 비밀값은 브라우저에 전달하지 않는다. 참고: [Google Picker 개요](https://developers.google.com/workspace/drive/picker/guides/overview), [PickerBuilder 공식 계약](https://developers.google.com/workspace/drive/picker/reference/picker.pickerbuilder). 실제 Google 동작 검증과 문서 대조를 구분한다.
