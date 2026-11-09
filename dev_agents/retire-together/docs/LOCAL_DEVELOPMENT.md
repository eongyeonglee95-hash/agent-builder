# 로컬 실행·검증

현재 앱은 한 컴퓨터에서 부부 정보를 관리하는 로컬 도구다. 작업 범위·담당은 `AGENT_DESIGN.md` §0을 따른다.

## 설치와 실행

Python 3.12+, uv, Node.js 22.12+를 사용한다. 프로젝트 루트에서:

```sh
uv sync --locked
npm --prefix web ci
bash scripts/dev-web.sh
```

개발 화면: http://127.0.0.1:5180 · API: http://127.0.0.1:8010/api/health (하나만 띄운다. 이미 떠 있으면 스크립트가 주소만 알려 주고 끝난다. API는 --reload라 코드를 고치면 저절로 다시 읽는다. 멈췄을 때만 `bash scripts/dev-web.sh --restart`)

스크립트는 API와 웹 개발 서버를 함께 시작한다. 종료할 때 자신이 시작한 프로세스만 정리한다. 다른 서버가 포트를 사용 중이면 해당 실행 상황을 확인한 뒤 다시 실행한다.

빌드한 화면을 API와 같은 주소에서 확인하려면:

```sh
bash scripts/preview-web.sh
```

접속 주소: http://127.0.0.1:8000

## 현재 동작

- 내 정보·배우자 정보와 은퇴 목표 입력, 수동 자산·대출 등록/수정/삭제.
- 부부 전체/나/배우자 집계. 금융자산 두 주머니, 부동산, 대출을 분리하며 예시 자산은 실제 DB에 저장하지 않는다.
- 리밸런싱 화면 하단에서 계좌 묶음 선택 → CSV 양식 다운로드/종목 잔고 입력 → 가격 기준일·추가 납입금과 목적 계좌 확인 → 검토용 계산.
- CSV 필수 열은 `account_id,ticker_name,ticker,qty,price`. 선택한 계좌 묶음의 모든 계좌만 포함하고, 종목명·코드는 확인된 매핑과 일치해야 한다. 수량·가격은 양의 정수, 금액은 원 단위다.
- CSV 계산은 업로드한 가격을 사용한다. 현재가 조회·별도 예수금 입력·잔고 저장·체결·자동주문·결정 기록과는 아직 연결되지 않았다. 신규 매수 후보가 미확인인 경우 비중 비교를 표시하고 주문표를 보류한다.
- 수동 총액 장부와 종목별 CSV는 별도다. 같은 금액을 양쪽에서 더하지 않는다. 기존 캡처 등록/종목 잔고 관리는 Streamlit 비교 도구에 남아 있다.

실제 로컬 장부는 `data/local/retire-together.sqlite3`에 저장된다. 삭제한 자산의 변경 이력도 포함하며 Git에서 제외된다.

## 구글 시트 연결 (자산 데이터의 원천)

머리글의 **로컬 저장** 배지를 누르면 연결 창이 열린다. 구글 OAuth 클라이언트 만들기부터 시트 모양까지는 `GOOGLE_SHEETS.md`. 연결 전에는 로컬 SQLite에 저장되고 연결 때 시트로 옮겨진다. 테스트·브라우저 테스트는 `RETIRE_SHEETS=off`라 시트를 열지 않는다.

자산 등록은 '우리 자산'의 **자산 등록** 한 곳에서 사진(캡처)·직접 입력·파일(CSV·엑셀)을 고른다. 사진은 Claude 비전(Agent SDK)이 표로 옮기므로 Claude 로그인이 된 환경에서만 동작한다.

## 검증

앱 검증 명령:

```sh
uv run pytest -q
npm --prefix web run build
npm --prefix web run test:e2e
```

브라우저 테스트는 설치된 Google Chrome을 사용한다. 8765번 포트에 임시 DB 서버를 따로 실행하며, 개인 장부에 접근하지 않는다. 실행 후 서버를 종료하고 임시 DB를 정리한다. 스크린샷·실패 trace는 `web/test-results/`에 생성된다(Git 제외). 빌드를 먼저 실행해야 최신 화면을 테스트한다.

2026-10-27 검증: Python 95개, 브라우저 7개 통과. 브라우저 항목은 프로필/자산 저장·재접속·수정·삭제·예시 분리, CSV 입력 오류/계좌 전환/계산 표시, 1440·1024·390·360px 화면 넘침이다. 사용자 디자인 승인은 별도다.

## SHARE-02 웹 인증 설정과 검수

2026-11-07 후속: SHARE-02에 최소 로그인 화면·계정 메뉴·로그아웃·공통 JSON/업로드 CSRF 연결을 포함했다. 공용 5180/8010은 웹 로그인 모드로 전환했으며, 앱 첫 화면의 **Google로 로그인**으로 시작한다. 최초 본인 계정의 실제 Google 로그인과 활성 오너 세션을 확인했다. 로그인 버튼은 팝업에서 진행하고, 로그인 후 첫 화면은 메인 대시보드다. 표는 ‘표로 보기’로 연다. 시트 연결·초대·두 사람 자료 공유는 SHARE-03~06의 후속 범위다. `RETIRE_AUTH_MODE=local`은 기존 한 컴퓨터 개발용이며 웹 공유 인증 모드가 아니다.

서버 설정:

| 설정 | 용도·기본값 |
|---|---|
| `RETIRE_AUTH_MODE` | `local`(기본) 또는 `web`; 오타는 503으로 차단 |
| `RETIRE_GOOGLE_WEB_CLIENT` | 다운로드한 **web** JSON 경로. 기본 `data/local/google/web-client.json`, 권한 0600. 비밀값을 환경 출력·브라우저·문서에 넣지 않는다 |
| `RETIRE_AUTH_ORIGIN` | 경로/끝 슬래시 없는 단일 출처. 기본 `http://127.0.0.1:5180`. JSON의 redirect URI에 이 출처 + `/api/auth/google/callback`이 정확히 있어야 한다 |
| `RETIRE_AUTH_ALLOW_HTTP` | 로컬 HTTP 검수만 `1`. localhost/127.0.0.1/::1 이외 HTTP는 항상 거부 |
| `RETIRE_AUTH_BOOTSTRAP` | 최초 설정 때만 `1`. 출처와 실제 접속자가 loopback이고 전달 헤더가 없어야 첫 오너 생성 허용. 공개 출처에 켜면 설정 오류 |
| `RETIRE_AUTH_DB` | 기본 `data/local/auth/auth.sqlite3`. 금융 DB와 분리·0600·Git 제외. 초기화/삭제로 오너를 바꾸는 운영은 금지 |

읽기 전용 설정 검사(서버 시작·DB 생성·Google 접속 없음):

```sh
RETIRE_AUTH_ALLOW_HTTP=1 .venv/bin/python -m backend.auth_config
```

전달된 웹 클라이언트는 위 검사에 통과했다. 이는 클라이언트 종류·필수값·파일 권한·콜백 일치 검사이며 Google 서버가 자격 증명을 수락했다는 뜻은 아니다. 라이브 검수는 운영자가 공용 서버를 쓰는 다른 세션들과 전환 시간을 맞추고 기존 실행을 정상 종료한 뒤, 다음 환경으로 **같은 5180/8010 하나만** 시작한다. 이미 실행 중인 프로세스에는 셸 환경 변경이 전파되지 않는다.

```sh
RETIRE_AUTH_MODE=web RETIRE_AUTH_ALLOW_HTTP=1 RETIRE_AUTH_BOOTSTRAP=1 \
  bash scripts/dev-web.sh --restart
```

본인 컴퓨터에서 `http://127.0.0.1:5180/`의 **Google로 로그인**을 누르고 팝업에서 **본인 계정**을 선택한다. 완료되면 원래 앱 화면이 열린다. 팝업이 차단되면 같은 탭으로 이동하며, 로그인 오류 시 ‘다른 Google 계정 선택’으로 다시 고를 수 있다. 직접 시작 주소는 `/api/auth/google/login`이다. 최초 설정 중 터널/외부 프록시를 열지 않는다. 첫 성공 계정이 원자적으로 고정 오너가 되며 다른 계정은 가입 없이 접근할 수 없다. 이후 `/api/auth/session`으로 오너/멤버 ID와 세션 상태를 확인하고, 로그아웃→같은 계정 재로그인 때 ID 유지 및 제3자 차단을 확인한다. 실계정 식별자·세션/CSRF 토큰을 작업 기록에 복사하지 않는다. 최초 로그인 확인 후 `data/local/auth/dev-mode`를 `web`으로 바꾸고 다음 서버 기동부터 최초 설정을 닫는다. 명시적 환경 설정 방식은 `RETIRE_AUTH_BOOTSTRAP=0`을 사용한다. DB가 유지되는 동안 설정 플래그를 다시 켜도 오너를 바꾸거나 새 가구를 만들 수 없다.

이 PC의 재시작 설정은 Git 제외 `data/local/auth/dev-mode`(0600)에 저장한다. `bootstrap`은 로컬 최초 오너 설정, `web`은 설정 후 로그인 유지다. `scripts/dev-web.sh`는 명시적 `RETIRE_AUTH_MODE`가 없을 때 이 값만 읽으며 파일을 셸 코드로 실행하지 않는다. 설정 후 평소 실행 명령으로 서버를 다시 시작해도 로그인 모드를 유지한다. 웹 인증의 Host 검사에 맞춰 서버 상태 확인도 UI의 Host를 사용한다.

Google 첫 로그인에서는 동의가 필요하다. 재방문 시 유효한 앱 세션이 있으면 바로 메인으로 들어가며, 재로그인의 `prompt=select_account`는 최초 오너 설정과 명시적인 다른 계정 선택에만 쓴다. 팝업은 서버가 검증한 흐름 정보에 연결하고 완료 알림에 토큰/계정 정보를 담지 않는다. 원래 화면은 `/api/auth/session`으로 직접 확인한다. [Google 동의 안내](https://developers.google.com/identity/gsi/web/guides/migration#user_consent_and_revoking_permission) · [OIDC prompt](https://developers.google.com/identity/openid-connect/openid-connect#authenticationuriparameters)

화면 연결용 API 계약:

- `GET /api/auth/status`: local/web·로그인 활성·초기화 여부(비밀값 없음).
- `GET /api/auth/google/login`: 로그인 시작, Google로 303. 10분짜리 state·nonce·PKCE·브라우저 쿠키로 요청을 묶고 콜백을 한 번만 소비한다.
- `GET /api/auth/google/callback`: Google 응답 검증 후 기존 세션을 회전하고 `/`로 이동. 요청자가 지정한 복귀 URL은 사용하지 않는다.
- `GET /api/auth/session`: 로그인한 계정·가구·멤버·역할·만료와 `csrf_token`. 응답은 no-store, 토큰은 프론트 메모리에만 두고 저장소/로그에 넣지 않는다.
- `POST /api/auth/logout`: 동일 출처 `Origin`과 세션에서 받은 `X-Retire-CSRF` 필요. 서버 세션과 브라우저 쿠키를 폐기하며 시트 연결이나 고정 오너는 지우지 않는다.
- 나머지 개인/등록/설정/다운로드/문서 API도 공통 세션 검사 대상. 쓰기에는 동일한 CSRF 검사가 적용되며 `X-Retire-Local`은 웹 인증을 대신하지 않는다. SHARE-04/05의 권한/사람 매핑 전에는 기존 금융 API를 오너에게만 허용한다. 웹 모드의 구형 `/api/google/*`는 기존 InstalledAppFlow/공용 토큰 사용 방지를 위해 409로 차단한다. SHARE-03의 별도 `/api/google/shared/*`를 사용한다. SHARE-04부터 활성 배우자는 자기 파일 권한/상태에만 접근하며 파일 생성·선택은 고정 오너만 가능하다.

세션은 무작위 불투명 쿠키·서버에는 해시만 저장하며 12시간 절대 만료다. HTTPS 쿠키는 `__Host-`·Secure·HttpOnly·SameSite=Lax·Path=/, 로컬 HTTP는 별도 이름과 명시적 허용을 쓴다. 기본 Google 로그인은 `openid email`만 요청하고 받은 Google 토큰을 영구 저장하지 않는다. SHARE-03의 별도 파일 동의에서만 계정별 access/refresh 토큰을 서버에 보관한다(아래 절). Uvicorn 접근 로그의 `/api/auth/*` 쿼리는 제거한다. 향후 외부 HTTPS 프록시를 붙일 때도 콜백 쿼리를 기록하지 않고, 정확한 Host/HTTPS 전달·신뢰할 프록시 범위를 운영 설정으로 확인해야 한다. 이번에는 배포/프록시 설정을 변경하지 않았다.

검수 명령:

```sh
.venv/bin/python -m pytest -q tests/test_web_auth.py tests/test_web_api.py tests/test_local_data.py
.venv/bin/python -m pytest -q
RETIRE_AUTH_BROWSER_TEST=1 RETIRE_E2E_PORT=8779 npm --prefix web run test:e2e -- --config auth.playwright.config.ts
```

Python 인증 전용 51개, 전체 444개 통과. 합성 RSA 서명/가짜 Google HTTP·임시 DB로 서명/issuer/audience/만료/nonce·state 재사용·동시 초기화·고정 오너 변경·CSRF·재로그인·로그아웃·세션 만료/비활성화를 검사했다. 추가 저장 경로 테스트의 첫 실행은 빈 프로필 fixture 처리 오류 1건이었고 수정 후 전체 통과했다. 전용 브라우저 테스트는 Google 이동을 가짜 응답으로 대체하고 별도 임시 인증/금융 DB만 사용한다. 초기 Shrimp 실행에서 포트 제한으로 멈췄던 브라우저 검수는 후속 로컬 세션에서 완료했다. 기존 리디렉션 모킹을 별도 localhost 가짜 제공자로 교체해 외부 요청 없이 4개 검사(로그인·UI 저장·재로그인·로그아웃, 제3자/취소, 설정 실패/재시도, 업로드 CSRF/세션 만료)를 통과했다. 인증/API Python 105개와 빌드도 통과했다. 추가 기존 앱 회귀는 19개 중 17개 통과하며, 2개는 기존 계좌 선택자의 합계 셀 중복 매칭과 변경된 개인연금 입력창의 옛 필드 선택자 불일치로 실패했다. 관련 제품 UI는 이 작업에서 변경하지 않았다. 후속 팝업/메인 전환까지 인증/API Python 108개·인증 브라우저 6개·메인/표 전환 1개를 통과했다. 실제 최초 Google 로그인과 활성 오너 세션도 확인하여 SHARE-02를 완료했다. 실제 계정으로 새 팝업 재로그인은 자동 검수 결과와 구분한다. UI 디자인 검수·공통 시트 연결·두 계정 통합 완료를 이 결과로 대신하지 않는다.

## SHARE-03 공통 시트 API와 검수

2026-11-07 최종 확인: **SHARE-03 서버 범위 완료**. 실제 Google 테스트 파일로 생성·승인된 기존 선택 API·세션/클라이언트 복원·오류/복구·운영 보존 8개 통과, 생성 1회·검수 후 휴지통 정리 및 임시 인증 DB 삭제. 기존 Python515 근거 유지, 이번 격리 브라우저7개·빌드 통과. [검수 범위와 한계](research/SHARE_03_VALIDATION.md). Picker 브라우저 선택/키 설정은 원래 SHARE-06 UI 작업에서 수행한다. 아래 초기 실행의 네트워크/포트 제약과 실검수 대기 기록은 이 후속 결과로 갱신하며, 실제 Google 재로그인/타인 계정/계정 전체 동의 철회까지 검수했다고 보지 않는다. 운영 가구는 여전히 파일 미연결이다.

2026-11-07 재실행: 기존 미커밋 구현을 보존하고 빈 탭/빈 머리글의 연결 및 0원 장부 오인, 연결 뒤 손상된 양식의 정상 표시를 보완했다. 상태 조회·재로그인·같은 파일 생성/선택 재요청에서 두 탭의 머리글만 읽어 확인한다. 오류면 ID/원문을 보존하고 자동 덮어쓰기 없이 attention 또는 409를 반환한다. 지원하던 짧은 옛 양식도 읽힌다. 새 회귀의 수정 전 9건 실패를 확인했고 최종 전용 68개 포함 전체 Python **515 passed**, 웹 OAuth 설정·diff 검사 통과. 실제 파일 권한 저장 1건·파일 연결 0건을 읽기 전용 집계했다.

이번 세션의 실연결 제한: `RETIRE_GOOGLE_PICKER_API_KEY`·`RETIRE_GOOGLE_PROJECT_NUMBER` 환경이 없고, 인증 정보 없는 Google HTTPS 사전 요청은 `ConnectionError`로 실패했다. `RETIRE_AUTH_BROWSER_TEST=1 RETIRE_E2E_PORT=8783 npm --prefix web run test:e2e -- --config auth.playwright.config.ts`는 격리 가짜 제공자의 포트 생성이 `Operation not permitted`로 거부되어 시작하지 못했다. 이전 브라우저 7개 통과를 이번 실행 결과로 세지 않는다. 네트워크와 로컬 포트를 사용할 수 있는 환경에서 이 명령을 실행하고 아래 별도 테스트 시트 절차를 이어간다. 파일 생성에는 Picker 키가 필요 없으므로 생성/복원 검수와 Picker 설정에 의존하는 기존 파일 선택 검수를 분리한다. 운영 가구에는 시험용 파일을 고정하거나 기존 바인딩을 초기화하지 않는다. 실제 API 활성화/파일 동의 완료는 유지하며, 실제 파일 검수 전에는 SHARE-03을 완료 처리하지 않는다.

2026-11-07 실제 동의 확인: 사용자가 위 Google 파일 동의를 완료했고 운영 인증 DB에서 권한 저장 1건·만료 전 1건을 읽기 전용으로 확인했다. 공통 파일 연결은 0건으로, 접근 동의만 완료된 상태다. 아래 초기 검수 기록의 ‘실제 파일 OAuth 미검증’은 이 확인으로 갱신한다. 실제 Drive/Sheets 파일 생성·기존 선택·복원/오류 검수와 Picker 키·프로젝트 번호 설정은 아직 남아 있다. 기존 금융 자료는 변경하지 않았다.

2026-11-07 후속: 파일 동의 진입 화면을 먼저 연결했다. [앱의 시트 연결 창](http://127.0.0.1:5180/?sheet_connection=open#home)을 열거나 로그인 후 상단 ‘시트 연결’을 누른다(모바일은 시트 아이콘). **‘Google에서 접근 허용’ → 로그인한 오너 계정으로 동의**하면 앱으로 돌아와 서버에 저장된 권한 상태를 확인한다. 취소/다른 계정/실패도 앱의 같은 창으로 복귀한다. 이 버튼은 파일 권한만 연결하며 파일 생성/선택·장부 이전/변경은 하지 않는다. Picker 키는 파일 선택에 필요하지만 이 접근 동의 단계에는 필요 없다. 브라우저 합성 검수 7개·인증/공통 시트 Python 111개 통과, 실제 사용자 동의 및 파일 생성/선택 검수는 별도다.

2026-11-07: 서버 구현·합성 자동 검수 완료, 실제 Google 파일 연결 검증 대기. 이번 작업은 화면 변경이 없으며 Picker/재연결 화면은 SHARE-06에서 아래 API를 연결한다. 기존 5180/8010 한 서버를 유지하며 이번 실행에서 재시작/실제 Google 요청/금융 자료 변경을 하지 않았다.

서버 구현은 `backend/shared_sheets.py`(흐름·API·가구 읽기), `shared_sheets_store.py`(별도 테이블·프로세스 잠금), `shared_sheets_google.py`(drive.file·권한/메타데이터·토큰 갱신)다. 인증 저장소의 기존 오너/세션을 그대로 사용하며 `household_sheets`·`sheet_grants`·`sheet_flows`를 추가한다. DB·저널은 금융 시트/브라우저 저장소/Git에 넣지 않는다. 로컬 파일 권한은 0600이며 이 구현은 단일 호스트의 SQLite + POSIX 파일 잠금을 기준으로 한다. 여러 호스트 배포는 이 검증에 포함되지 않는다.

API는 모두 웹 오너 세션이 필요하다. POST/PUT/DELETE에는 기존 `Origin`과 `X-Retire-CSRF`를 보낸다. 응답은 `Cache-Control: no-store`다.

| API | 계약 |
|---|---|
| `GET /api/google/shared/status` | 저장된 `spreadsheet`(ID·URL·ready), connected·active·health·read_only. 오류 시 ID를 유지하고 attention/detail 반환. 읽기로 생성/이전하지 않음 |
| `POST /api/google/shared/connect` | 별도 파일 동의를 시작할 `authorization_url` 반환·전용 HttpOnly 흐름 쿠키 설정. 브라우저를 반환 URL로 이동시킴. 로그인과 같은 등록 콜백 `/api/auth/google/callback` 사용 |
| `POST /api/google/shared/spreadsheet` | 새 공통 시트 생성 요청. 가구당 영구 생성 작업 기록, 다중 탭/프로세스 잠금, 재요청은 같은 파일 복원/초기화. 기존 연결이 있으면 그 파일 확인만 수행. `migrated=0`, `read_only=true` |
| `POST /api/google/shared/picker` | Picker용 메모리 전용 access_token·expires_at·developer_key·app_id·origin 반환. refresh token은 반환하지 않음. 설정 누락 503, 파일 동의 누락 409 |
| `PUT /api/google/shared/spreadsheet` | `{ "spreadsheet_id": "Picker가 선택한 ID" }`. 오너 소유/편집/시트/휴지통·자산/보유종목 양식 검사 후 가구에 저장. 기존 시트에 쓰기/이전 없음. 이미 다른 파일이 연결됐거나 생성 결과가 불확실하면 409 |
| `DELETE /api/google/shared/connection` | 파일용 저장 토큰·진행 중 파일 동의만 제거. 가구/file ID/앱 세션/Google 파일은 유지. 다시 같은 오너가 동의하면 같은 파일 확인. Google 계정 전체 승인 취소는 수행하지 않음 |

화면 구현 시 `/picker` 결과는 메모리에만 두고 Sheets MIME으로 Google Picker를 열어 선택한 ID를 PUT한다. ID를 직접 입력하는 API는 접근 승인 자체를 부여하지 않으므로 아직 앱에 선택되지 않은 파일은 거부된다. 별도 웹 OAuth 클라이언트 JSON을 사용자에게 요구하지 않는다. [Picker 공식 안내](https://developers.google.com/workspace/drive/picker/guides/overview) · [drive.file 범위](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

설정/권한에 의존하는 다음 조치(이번 실행에서 외부 설정 변경 없음):

1. 기존 웹 OAuth 프로젝트에서 **Google Drive API·Google Sheets API** 사용과 `drive.file` 동의 설정을 운영자가 확인한다. 기존 콜백 URI를 그대로 사용한다. 오너가 별도 파일 접근 동의를 직접 진행해야 한다.
2. 기존 파일 선택 검수에는 **Google Picker API**와 같은 프로젝트의 브라우저용 API 키·숫자 프로젝트 번호가 필요하다. 서버 기동 환경에 `RETIRE_GOOGLE_PICKER_API_KEY`·`RETIRE_GOOGLE_PROJECT_NUMBER`를 전달한다. API 키는 Picker 및 사용 출처에 제한하고 OAuth client secret과 구분한다. 새 파일 생성 API에는 Picker 키가 필요하지 않다. 실제 환경 값·토큰을 문서/작업 기록에 출력하지 않는다.
3. 실제 금융 시트 대신 별도 테스트 시트·합성 자료로 검수한다. 새 생성 1회→동시 탭 재요청/새로고침→로그아웃/재로그인 때 같은 file ID인지 확인한다. 기존 파일 선택은 별도의 임시 인증 저장소/검수 환경에서 수행한다. 고정된 운영 가구를 초기화하거나 기존 파일 연결을 테스트 목적으로 교체하지 않는다.
4. 타인 소유 시트/공유 편집만 가능한 시트를 거절하는지, 휴지통/삭제/권한 철회/오너 변경 때 ID를 유지하고 새 파일·로컬 전환을 하지 않는지 확인한다. 재동의 뒤 같은 파일로 복구한다. 결과는 성공 여부만 비식별 기록한다. 실제 검수 전 SHARE-03 완료 처리 금지.

생성 결과가 불확실한 경우: `appProperties.retire_operation`으로 만든 파일만 조회한다. 결과가 없거나 여러 개면 409를 유지한다. Google Workspace 파일은 사전 발급 ID 생성을 지원하지 않아 네트워크 오류 뒤 생성 POST를 안전하게 반복할 수 없다. 재시도는 조회만 하며 DB 행 삭제/새 작업 ID 발급으로 우회하지 않는다. 운영자가 별도 테스트 파일의 존재·접근 승인·메타데이터를 확인한 뒤 같은 요청을 재실행한다. 명시적 Google 생성 거부(400/401/403/404/429)는 `create_rejected` 상태로 남겨 설정 해결 후 같은 작업으로 다시 생성할 수 있다. [공식 생성 제약](https://developers.google.com/workspace/drive/api/guides/create-file)

자료 경계: 설정 전에는 기존 오너 로컬 장부를 유지하며 공용 데스크톱 시트 설정은 무시한다. 설정 기록이 생긴 뒤에는 자산·보유종목의 조회를 공통 파일에 연결하고 오류를 전파한다. 자료 이전/공유 저장은 SHARE-05이므로 앱의 금융 저장·등록·설정 요청은 409로 차단한다(읽기 계산용 preview/rebalance는 허용). 이 차단은 생성과 같은 잠금 안에서 이루어져 기존 등록 API의 스냅샷/태그 부분 저장도 예방한다. 로컬 프로필·계획은 아직 공유 자료로 이전하지 않았으며 배우자 금융 접근도 열지 않는다.

실행한 검수:

```sh
.venv/bin/python -m pytest -q tests/test_shared_sheets.py
.venv/bin/python -m pytest -q
RETIRE_AUTH_ALLOW_HTTP=1 .venv/bin/python -m backend.auth_config
git diff --check
```

SHARE-03 전용 54개 포함 전체 Python **501 passed**. 합성 RSA 서명·가짜 Google HTTP·임시 DB로 오너/계정/세션/CSRF/nonce/권한, 생성 응답 유실·서버 실패/명시적 거부, 다중 탭/별도 프로세스 잠금, 기존 파일 무변경, 재로그인/재동의/갱신, 삭제·권한/소유권 변경, 저장 차단을 검사했다. 전체 검수에서 처음 발견된 프로세스 검사의 pytest 모듈 상속 충돌을 독립 Python 프로세스로 바꾼 뒤 통과했다. 자동 반영 중 먼저 생성된 연결 테이블의 추가 필드 이전에서도 기존 오너·생성 작업 보존을 검증했다. 현재 웹 OAuth JSON의 읽기 전용 설정 검사도 통과했다. **실제 파일 OAuth·Google Picker 브라우저·Drive/Sheets 실연결은 미검증**, 화면 디자인 검수/배우자 초대/자료 이전 검증도 이번 범위에 포함하지 않는다.

## SHARE-04 배우자 초대·공유·접근 해제 API와 검수

2026-11-07 단계 정정: **SHARE-04 서버 구현 완료**. 주 대화에서 전용39개 재검수 통과, 직전 전체567개 근거 유지. 실제 두 계정 공유/수락/재로그인/해제는 아직 미검증이며 아래 실검수 절차를 SHARE-07 필수 조건으로 인계한다. SHARE-06 초대 화면이 아직 없다는 이유로 서버 구현 완료를 막던 순서 모순을 정리했다. 서버 완료는 실제 공유 사용 완료를 의미하지 않는다.

2026-11-07: 서버 구현·자동 테스트 완료, **실제 두 Google 계정 검증 대기**. 초대 화면/링크 소비는 SHARE-06, 사람별 금융 자료 매핑·공유 쓰기는 SHARE-05다. 이번 작업에서는 화면·운영 계정·금융 파일·공용 서버 설정을 변경하지 않았다. 아래 API는 웹 인증 모드에서만 사용한다. 기존 `/api/google/shared/status`, `connect`, `picker`, `connection`은 활성 배우자에게도 **자기 계정의 파일 권한**만 허용한다. 파일 생성/선택/가구 연결은 여전히 고정 오너만 가능하며 배우자의 기존 금융 API 접근 차단도 유지한다.

API 계약 (`/api/auth/invitations` 기준):

| 경로 | 권한과 결과 |
|---|---|
| `POST /` (실제 경로는 끝 `/` 없는 기본 경로) | 오너 세션·기존 CSRF, `{email}`. 공통 파일 연결 이후만 발급. `invitation`, `code`, `url` 반환. 링크는 `/#invite=<code>`이며 **SHARE-06에서 소비할 계약**으로 현재 화면에 수락 기능은 없음 |
| `GET /` (끝 `/` 없는 기본 경로) | 오너만 최신 50개 상태 확인. 원문 코드는 재표시하지 않음. 만료 초대는 expired/cleanup pending으로 표시 |
| `POST /accept` | 로그인 전 가능. `{code}`, 동일 Origin 및 `X-Retire-Invite: 1` 필요. Google `authorization_url`·HttpOnly 일회용 흐름 쿠키 반환 |
| 기존 `/api/auth/google/callback` | `invite.` state로 분기. 서명/nonce/PKCE·브라우저·대상 이메일·Google sub·파일 동의 확인. 완료 시 일반 세션, 중간 실패 시 별도 가입 대기 쿠키와 `/?invitation=pending` 복귀 |
| `GET /join` | 가입 대기 쿠키 필요. 동일 파일 ID·진행 상태·가입 전용 CSRF 반환. 금융 자료/일반 세션 없음 |
| `POST /resume` | 가입 대기 쿠키·동일 Origin·`X-Retire-Invite: 1`·가입 전용 `X-Retire-CSRF`. 같은 초대·파일의 공유/접근 확인을 재개. 성공 시 가입과 일반 세션 발급 |
| `POST /picker` | resume과 같은 보호. 배우자의 단기 access token·Picker 설정·고정 파일 ID 반환. refresh token 미반환. 해당 파일을 Picker에서 승인한 뒤 resume 호출; 임의 파일 ID를 가입 API에 전달해 교체할 수 없음 |
| `DELETE /{id}` | 오너 세션·기존 CSRF. 가입 전 취소/만료 정리 재시도. 이미 가입한 초대 취소는 409 |
| `POST /{id}/revoke` | 오너 세션·기존 CSRF. 가입 후 접근 해제/공유 정리 재시도. 멤버십·모든 세션·파일 토큰/대기 흐름을 먼저 차단한 뒤 Drive 정리 |
| `POST /{id}/confirm-cleanup` | 오너·CSRF·`{confirmed_in_drive: true}`. 오너가 Drive에서 직접 확인/정리한 취소·해제 건만. 서버도 전체 권한 목록에서 해당 직접 공유가 사라졌는지 재확인하며 확인 주체·시각을 별도 저장. Google 쓰기 없음 |

초대는 256비트 무작위 코드의 해시만 인증 DB(0600)에 보관한다. 48시간 만료, 한 번 수락, 오너/배우자 각 한 명이며 이메일은 앞뒤 공백·대소문자만 정규화한다(점/플러스 별칭을 추측하지 않음). 발급 시도는 가구당 5회/시간, 코드 검증·재개는 각각 60회/10분으로 SQLite에 제한 기록을 남긴다. OAuth 흐름은 10분, 가입 대기 자격은 20분이며 만료 후 같은 미사용 초대에서 Google 본인 확인을 다시 한다. 최초 대상의 검증된 sub가 연결되면 이메일이 같아도 다른 sub로 바꿀 수 없다. 새 멤버십은 새로운 ID를 쓰므로 해제 전 쿠키가 재초대로 살아나지 않는다.

공유는 기존 가구 파일의 `user/writer`만 만든다. 이메일 알림은 보내지 않으며 오너 양도도 없다. 파일 작업 잠금은 기존 공통 시트와 공유해 프로세스 간 생성/취소/공유를 직렬화한다. Google 공유 성공만으로 입장시키지 않고 배우자 본인의 `drive.file` 토큰으로 **동일 파일의 편집 접근·양식**을 확인한 뒤 멤버십/초대 소진/일반 세션을 한 트랜잭션으로 만든다. 파일 접근 승인이 부족하면 가입은 대기 상태이며 Picker 승인 후 재개한다. [공식 permissions.create](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create)

실패와 복구:

- 공유 POST 전에 전송 시도를 영구 기록한다. 명확한 거절은 자격/설정 해결 후 재요청 가능하지만 응답 유실·불확실한 결과는 전체 권한 목록을 조회하며 POST를 반복하지 않는다. 생성 ID를 받은 경우에만 앱 생성 권한으로 기록한다. 응답 유실 뒤 발견한 권한은 출처 불확실로 구분한다.
- `cleanup=pending`이면 앱 접근은 이미 차단되었고 Drive 오류/다른 작업이 남은 상태다. 같은 cancel/revoke를 다시 호출한다. `attention`이면 앱 생성 여부 불명·외부 변경 등으로 자동 삭제를 보류한 상태다. 오너가 Drive에서 직접 공유를 정리한 후 재시도하며, 전송 결과 자체가 끝내 보이지 않으면 `confirm-cleanup`으로 **수동 확인 근거를 남겨** 종료한다. 완료 전 새 초대를 막는다.
- 앱이 확실히 만든 권한만 삭제한다. 원래 있던 공유·그룹/도메인/공개 접근은 변경하지 않고 `residual_access`로 남을 수 있음을 알린다. `cleanup=done`은 앱 권한 정리의 결과이며 모든 Google 접근이 사라졌다는 뜻은 아니다. 완료 기록은 되돌리지 않아 오래된 해제 재요청이 새 초대의 같은 Google 권한 ID를 지우지 않는다. [권한 목록/페이지](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/list), [권한 삭제](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/delete)
- 만료/취소된 가입 대기 흐름은 가입할 수 없다. 만료 후 이미 부여된 공유는 오너 목록의 expired/pending 상태에서 cancel로 정리한다. 이번 구현에는 주기적 정리 작업이 없다.

실제 실행한 검수(2026-11-07):

```sh
.venv/bin/python -m pytest -q tests/test_household_invites.py
.venv/bin/python -m pytest -q
RETIRE_AUTH_ALLOW_HTTP=1 .venv/bin/python -m backend.auth_config
git diff --check
```

전용 **39 passed**, 최종 전체 Python **567 passed**. 임시 인증 DB·합성 RSA 서명·가짜 Google HTTP를 사용했다. 대상/서명/만료/취소/코드·콜백 재사용·동시 수락, 초대 없는 로그인, 동일 파일 복원, 다른 프로세스 잠금, 공유/로컬 커밋 실패 후 재개, Picker·CSRF·자기 토큰 분리, 해제 중 동시 수락, 모든 세션 차단, 삭제 응답 유실, 기존/불명 공유 보존, 수동 확인, 재초대 후 과거 해제 재요청을 검증했다. 기존 시트 검수의 배우자 상태 조회 거부 기대값은 이번에 허용한 계약에 맞췄고 파일 생성 차단은 유지했다. OAuth JSON 읽기 전용 설정·diff 검사 통과. 이번 전용 UI/브라우저 검수는 없으며 이전 SHARE-02/03의 브라우저 결과를 이번 결과로 세지 않는다.

남은 실검증과 다음 조치:

1. 운영 가구/금융 파일을 바꾸지 않는 별도 비공개 검수 저장소·테스트 시트에서 오너와 배우자 두 계정의 Google 동의를 준비한다. 현재 오너 OAuth 설정 검사는 통과했고 기존 동의를 다시 설정하라는 뜻은 아니다. OAuth 테스트 앱이라면 배우자 테스트 사용자 등록 여부는 운영자가 확인한다. 실제 계정 인증/외부 설정 변경은 이번에 수행하지 않았다.
2. 해당 테스트 파일을 오너로 연결한 뒤 API로 지정 이메일 초대 → 배우자 실제 Google 수락 → Drive writer 및 배우자 본인 파일 접근 → 로그아웃/재로그인 시 같은 파일을 확인한다. 공유와 앱 승인이 별개이므로 필요한 경우 같은 OAuth 프로젝트의 Picker 키·프로젝트 번호를 설정하고 동일 파일을 승인한다. 이번 로컬 세션에는 두 Picker 환경변수가 없으며 화면은 SHARE-06 범위다.
3. 같은 테스트 파일에서 제3자/재사용 차단과 중간 실패 재개, 접근 해제 후 모든 앱 세션 차단·Drive 직접 권한 삭제를 확인한다. 그룹/도메인 등 잔존 접근은 별도 표시하고 테스트 자료만 정리한다. 이 실제 절차는 SHARE-06 화면 준비 후 SHARE-07에서 수행한다. 미검증인 동안 SHARE-07은 완료 처리하지 않는다. SHARE-04는 서버 구현/자동 검수 기준으로 완료하며, SHARE-05~07 실행은 이번 정정에서 시작하지 않았다.

## SHARE-05 공유 자료·이전·복구 API와 검수

2026-11-09 서버·이전 도구 구현 및 격리 검수: 전용59개, 전체 Python630개 통과. [상세 스키마/원천/API/복구·검수 보고서](research/SHARE_05_VALIDATION.md). 설정 키가 없어도 재현 가능하며 임시 금융 자료와 가짜 Google HTTP만 쓴다.

```sh
.venv/bin/python -m pytest -q tests/test_shared_data.py
.venv/bin/python -m pytest -q
```

API 기준 경로는 `/api/shared-data`. 오너의 `POST /migration/preview` → 원천/건수/합계/명의/충돌 확인 → `POST /migration/commit` 순서다. 미리보기는 백업만 만들며 Google 자료를 변경하지 않는다. 확정에는 UUID `operation_id`, 반환된 `preview_id`, 모든 충돌의 local/sheet 선택이 필요하다. 이전 이후 `GET /api/shared-data`의 고정 멤버 상태와 revision을 받아 `POST /save`에 변경 항목과 expected_revision을 보낸다. 요청 UUID는 답변이 불확실할 때 새로 만들지 말고 같은 본문으로 재조회한다.

오류 복구는 오너의 `GET /recovery`와 `GET /recovery/{backup_id}`로 대조한 뒤 `POST /recovery`에 새 operation_id·현재 expected_revision·backup_id·before/proposed 선택을 보낸다. 백업은 인증 DB 옆 `shared-data-backups`에 0700/0600으로 보관하며 체크섬을 검사한다. 원본 로컬 DB·파일과 기존 두 시트 탭을 지우지 않고, 같은 파일에 새 공유 기록을 추가한다. 현재 자료/명의/상대방 편집 허용을 확인하지 않고 자동 복구하지 않는다.

2026-11-09 SHARE-06에서 홈 조회·본인 이름/나이·편집 허용·이전/복구 대조 화면을 연결했다. 기존 워크북 등록/저장·보유종목·연금/부동산 계산과 계획 편집은 아직 공유 API 미전환이다. **실제 운영 가구에서 자료 이전 API를 먼저 실행하지 않는다.** 이전 시작 뒤 기존 로컬 금융 API는 409, 배우자의 기존 API는 403으로 차단하는 경계를 유지한다. 같은 파일의 `공유자료_v1`이 새 원천이며 옛 자산/보유종목 탭을 계속 편집하는 흐름으로 안내하지 않는다. 화면의 나/배우자만 viewer를 따르고, 은퇴 기준·공동 지분은 고정 ID를 따른다.

SHARE-07에서 실제 두 계정의 drive.file 동의·Picker 승인(필요 시)·별도 시트로 두 기기 일치·동시 저장/직접 편집·백업/복구·접근 해제·HTTPS를 확인한다. 자동 검수와 실제 연결 검수를 혼동하지 않는다. 이번 세션은 해당 후속 작업이나 운영 금융 자료 이전·외부 설정 변경을 수행하지 않았다.

## SHARE-06 공유 설정 화면과 검수

2026-11-09 화면 구현·격리 검수 완료. 시트 연결 창의 공통 시트/우리 자료/배우자 초대에서 파일 생성·Picker 선택·동의 복원·초대/해제·이전 대조/복구를 다룬다. 초대 링크는 `/#invite=<code>`이며 같은 탭 재진입도 처리한다. 가입 재개 후 새 서버 세션을 읽고, 편집 허용 저장 실패 시 체크와 서버 권한은 기존 값으로 유지된다.

주 대화에서 공유8개·인증7개 브라우저 및 웹 빌드 통과. 1440/390/360px·키보드·합성 두 사람의 명의/지분/재방문을 확인했다. [명령·검수 근거·남은 제품 연결](research/SHARE_06_VALIDATION.md). 실제 Google 두 계정/Picker 설정·승인·두 기기 통합은 SHARE-07 미결이며, 위 SHARE-05의 전체 금융 화면 전환 미결도 그대로 남는다.

## SHARE-07 사전 점검·통합 검수

2026-11-09: 점검 도구/합성 자동 회귀 완료, **실제 두 계정 통합은 검증 대기**. [검수 결과·금융 화면 구현 미결·운영자 준비·실제 검수표](research/SHARE_07_VALIDATION.md). 신규39·전체Python674·임시 서버 자체 점검·웹 빌드 통과. 이번 실행기의 socket bind EPERM로 브라우저 재실행은 못 했으며, 앞 단계 브라우저 결과를 재사용해 이번 통과로 표시하지 않는다.

```sh
.venv/bin/python -m pytest -q tests/test_share_preflight.py tests/test_share_integration.py
RETIRE_AUTH_MODE=web RETIRE_AUTH_ALLOW_HTTP=1 .venv/bin/python -m backend.shared_preflight --target local
.venv/bin/python -m backend.shared_preflight --target https
```

설정 점검은 서비스와 같은 환경에서 실행한다. 값/비밀값을 출력하거나 DB/Google/설정을 변경하지 않는다. 종료0은 정적 설정 통과만 의미하며 실제 계정·Picker·TLS는 `not_run`이다. 현재 셸에서는 OAuth 파일 검사는 통과했으나 Picker 두 변수·HTTPS 원본이 준비되지 않았다. 실행 중인 제품 서버 설정에 대한 판단은 아니다.

실제 검수는 별도 체크아웃/호스트의 합성 금융 자료·별도 인증 DB·별도 테스트 시트에서 한다. `RETIRE_AUTH_DB`만 바꾸어서는 고정 경로 금융 DB까지 분리되지 않는다. 기존 `share-server.py`는 가짜 제공자 전용이다. 전체 금융 화면 공유 전환과 실제 두 계정/권한/복구/HTTPS 검수가 끝나기 전 운영 자료를 이전하거나 SHARE-07을 완료 처리하지 않는다.

## Shrimp 작업 관리

2026-11-07 설치. **[Shrimp 작업 화면 열기](http://127.0.0.1:9998/?lang=ko&profile=retire-together)**에서 작업을 확인하고 현재 ChatGPT 구독으로 로그인한 로컬 Codex에 실행을 맡길 수 있다. 공식 Task Viewer에 이 프로젝트용 연결 기능을 추가했다. 작업 상태는 기존 MCP 파일을 읽으며, 제품 로그인 기능의 완료 여부와 도구 설치 완료는 별개다.

### 화면에서 쓰는 법

1. 위 링크를 열면 **둘이서은퇴 → 작업** 목록이 나온다. 상단의 전체·대기·진행 중·완료 숫자로 현황을 본다. `PENDING`은 아직 시작하지 않은 **대기** 상태다.
2. **작업 이름을 클릭**하면 해야 할 일·구현 가이드·검증 기준이 나온다. 목록으로 돌아갈 때는 `Back to Tasks`를 누른다. 검색창에는 작업 이름이나 `SHARE-02` 같은 번호를 넣는다.
3. 작업 왼쪽 **체크박스**를 선택하고 목록 위 **‘선택 작업 실행’**을 누른다. Codex에 자동 배정되어 선택한 작업만 선행 순서에 따라 하나씩 실행한다. **‘Codex에 배정’**만 누르면 담당자 표시만 저장하며 모델 호출·개발은 시작하지 않는다.
4. 실행 카드에서 **‘현재 작업’**과 **‘당시 결과’·실행 시각**을 구분한다. 다른 대화에서 완료한 작업도 현재 상태와 완료 근거가 반영되므로 예전 ‘확인 필요’만 보고 다시 실행하지 않는다. **‘당시 실행 내용 보기’**는 옛 답변/로그 원문을 보여 준다. **‘알림 접기’**(기존 ‘확인했어요’)를 누르면 알림이 접힌 **‘확인한 실행 기록’**으로 이동하고 새로고침 후에도 유지된다. 작업 완료 처리·재실행·코드 되돌리기는 하지 않는다. 오류/중단된 작업은 알림을 접어도 위에 남는 **‘이 작업 다시 실행’**으로 해당 작업만 실행할 수 있다. 다른 체크박스 선택은 이 버튼에 포함되지 않는다. **‘실행 중지’**는 현재 실행과 남은 대기열을 멈추며 이미 변경된 파일은 유지한다. 미완료 선행 작업이 있으면 함께 선택하거나 먼저 끝내야 한다.
5. **‘연결 테스트’**는 실제 구독으로 작업 목록을 읽고 응답하는 검사다. 소량의 구독 사용량이 쓰이며 작업 내용·상태는 바꾸지 않는다. 연결되지 않으면 터미널에서 `codex login`으로 ChatGPT 계정에 로그인한다.

대화에서 **“SHARE-02 시작해줘”**라고 요청하는 방법도 유지한다. 행 오른쪽 **🤖 버튼**은 요청 문구를 복사하는 기존 기능이다. 웹 실행은 새로운 로컬 Codex 세션이며 이 대화의 내용을 자동으로 이어받지 않으므로 요구사항·작업표·인계 문서가 실행 문맥이다. 별도 OpenAI API 키는 사용하지 않고 구독의 사용 한도가 적용된다. [OpenAI 인증 안내](https://learn.chatgpt.com/docs/auth)

화면은 자동 새로고침으로 작업 상태를 다시 읽는다. 상단 새로고침 버튼으로 즉시 갱신할 수도 있다. 한국어로 설정했지만 공식 화면의 일부 버튼과 상태는 영어로 표시된다. 화면에서 할 일과 내용을 확인하고, 구현·테스트가 끝났을 때 Codex가 완료 근거와 작업 상태를 기록하는 흐름으로 사용한다.

작업 원본이 `in_progress`인 경우 최신 실행 결과에 따라 화면 표시를 나눈다. **‘확인 대기’**는 실행이 끝났지만 완료 검증/필요 조치가 남은 `blocked`, **‘재실행 필요’**는 시간 초과 등 오류(`failed`)·사용자 중지·서버 중단이다. 후자는 사용자 승인을 기다린다는 뜻이 아니다. 실행 카드·목록·상세·상단 집계에서 실제 ‘진행 중’과 구분한다. 알림을 접어도 표시는 남으며, 재실행 중에는 진행 중으로 바뀌고 검증 후 완료되면 완료로 바뀐다. 원본 상태나 의존성 검사는 바꾸지 않으므로 선행 작업 검증을 건너뛰지 않는다.

주소가 열리지 않으면 “쉬림프 화면 다시 열어줘”라고 요청하거나 프로젝트 폴더에서 `sh scripts/shrimp-viewer.sh`를 실행한다. 웹 화면은 이 컴퓨터의 9998번 포트에 있고 제품 화면은 기존 5180번을 그대로 사용한다. [공식 Task Viewer 안내](https://github.com/cjo4m06/mcp-shrimp-task-manager/tree/main/tools/task-viewer)

버튼이 보이지 않으면 브라우저를 새로고침한다. 연결 코드 갱신 후에는 `sh scripts/shrimp-viewer.sh --restart`로 전용 뷰어만 다시 시작한다. 실행 중에는 재시작을 거부하므로 먼저 완료하거나 화면에서 중지한다. 실행 상태는 2초마다, 작업 표는 기존 자동 새로고침 주기로 갱신한다.

### 구독 실행의 범위와 기록

- 실행기·화면 확장 원본: `scripts/shrimp-codex/`. 공식 설치본은 고정 버전을 확인한 후 `install.mjs`로 확장한다. 별도 수동 변경이 감지되면 덮어쓰지 않는다.
- 배정·실행 기록: `data/local/shrimp-runner/state.json`. 작업 원본 `tasks.json`과 분리하며 금융 자료·자격 증명을 저장하지 않는다. 로그에는 개발 중 파일/명령 내용이 포함될 수 있으므로 공유 전 확인한다.
- `codex exec`를 작업 폴더의 `workspace-write` 샌드박스로 실행한다. API 키·외부 토큰·부모 대화 ID를 전달하지 않으며 ChatGPT 인증만 허용한다. 전체 권한 우회는 사용하지 않는다.
- 웹에서 명시적으로 실행한 작업을 위해 해당 자식 프로세스에서만 Shrimp `list_tasks/get_task_detail/execute_task/verify_task/update_task`를 허용한다. 연결 테스트는 `list_tasks`만 허용한다. 전역 승인 설정은 변경하지 않는다. 그 외 추가 권한이 필요하면 작업은 ‘확인 필요’로 멈추고 다음 작업을 진행하지 않는다. [MCP 도구별 설정](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- 실행 중 웹 편집을 막고 한 번에 하나만 실행한다. 다른 Codex/Claude 세션이나 MCP 클라이언트의 동시 쓰기까지 잠그지는 않으므로 같은 작업은 한 세션에서만 진행한다. 중단 후에는 변경 내용과 인계를 확인한다.
- 서버 재시작 시 남은 작업을 자동 재실행하지 않는다. 기존 실행 프로세스가 살아 있으면 새 실행을 차단한다. 자식 프로세스 성공만으로 완료 처리하지 않고 Shrimp의 완료 상태·검증 요약·최종 응답을 함께 확인한다.

검수 명령: `node --test scripts/shrimp-codex/runner.test.mjs`, `node scripts/shrimp-codex/browser-check.mjs`. 브라우저 검수의 실제 작업 배정·실행 요청은 모의 응답으로 처리한다. `--live`를 붙이면 읽기 전용 구독 연결 검사를 추가하며 실제 구독 사용량이 발생한다.

`node scripts/shrimp-codex/live-smoke.mjs`는 별도 임시 작업 저장소와 폴더에서 실제 구독으로 샘플 파일 작성·셸 검증·MCP 착수/완료 기록까지 검사한다. 2026-11-07 이 검사와 브라우저 검수·실행기/HTTP 10개를 통과했다. 실제 제품 기능의 완료 검증은 해당 작업에서 별도로 수행한다.

### 대화에서 쓰는 법

같은 작업공간에서 새 Codex 대화를 열고 다음처럼 요청한다. 도구가 보이지 않으면 앱의 MCP 설정에서 `retire-together-shrimp`가 활성인지 확인한 후 프로젝트를 다시 연다. CLI에서는 `/mcp`로 현재 연결을 확인할 수 있다. 프로젝트 MCP 설정과 CLI 확인 방법은 [공식 OpenAI 문서](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)를 따른다.

| 하고 싶은 일 | 이렇게 요청 |
|---|---|
| 할 일과 진행 상황 보기 | “쉬림프로 둘이서은퇴 할 일과 진행 상황 보여줘.” |
| 다음 작업 확인만 하기 | “선행 작업을 확인해서 지금 시작할 수 있는 작업을 알려줘.” |
| 작업 하나 구현하기 | “쉬림프의 SHARE-02를 시작해줘. 기존 인계 문서를 확인하고 구현·테스트까지 해줘.” |
| 새 요구사항 등록하기 | “구글 연결 실패 후 재시도 동작을 기존 작업에 반영해줘. 중복 작업은 만들지 말아줘.” |
| 작업을 더 작게 나누기 | “SHARE-05의 데이터 이전 작업을 검증 가능한 단계로 나눠줘.” |
| 완료와 근거 남기기 | “실제 테스트 결과를 확인하고 완료 처리해줘. 작업표와 인계 문서도 갱신해줘.” |
| 다음 대화에서 이어하기 | “쉬림프에서 진행 중 작업과 인계 내용을 읽고 이어서 해줘.” |

기본 순서는 **목록 확인 → 다음 작업 선택 → 구현 → 테스트 → 완료 근거 기록**이다. 현재 첫 작업은 `SHARE-02 구글 웹 로그인·서버 세션·가구·고정 오너`다. ‘다음 작업 알려줘’는 조회이며 ‘시작해줘’가 실제 구현 요청이다. 작업 상태를 완료로 바꾸는 것만으로 구현이 검증되는 것은 아니다.

시범 중 상태의 원본은 `AGENT_DESIGN.md` §0이다. Shrimp와 문서를 함께 갱신하고 파일 담당은 `DEV_HANDOFF.md`를 따른다. 이 버전은 여러 프로세스의 동시 쓰기를 잠그지 않으므로 작업 상태를 바꾸는 세션은 하나만 둔다. 작업 전체 초기화·프로젝트 규칙 자동 생성은 기본 연결에서 노출하지 않는다.

### 터미널에서 바로 확인

아래 명령은 모두 `dev_agents/retire-together/`에서 실행한다. 현재 대화에서 MCP가 아직 로드되지 않았어도 사용할 수 있다.

```sh
node scripts/shrimp-tasks.mjs list
node scripts/shrimp-tasks.mjs verify
codex mcp get retire-together-shrimp
```

`list`는 현재 작업을 보여 준다. `verify`는 MCP 도구·작업 의존성·재시작 복원을 확인하고, 임시 작업만 만들어 미완료 선행 작업 차단을 검사한다. 실제 작업의 진행 상태는 바꾸지 않는다. `node scripts/shrimp-tasks.mjs seed`는 문서의 로그인 작업 중 빠진 것만 추가하며, 기존 상태·메모를 덮어쓰지 않는다. 이후 작업 분해로 목록이 달라지면 `verify`의 최초 여섯 작업 가정도 함께 조정한다.

### 설치 위치와 복원

- 공식 소스: [cjo4m06/mcp-shrimp-task-manager](https://github.com/cjo4m06/mcp-shrimp-task-manager), 패키지 1.0.21, 설치 커밋 `8a3be6bced310c7b660e5cfc3f42e4e5e45f2f61`.
- 실행 파일: `.tools/shrimp-task-manager/dist/index.js`. Node.js가 필요하며 설치 환경은 Node 24.19.0이다.
- MCP 런처: `scripts/shrimp-mcp.sh`. 작업 저장소를 프로젝트에 고정하고 앱의 `.env`를 읽지 않는다. MCP에 내장된 간이 GUI는 끄고 공식 Task Viewer를 별도로 사용한다.
- 웹 화면: `scripts/shrimp-viewer.sh` → `.tools/shrimp-task-manager/tools/task-viewer/server.js`. 빌드한 화면을 127.0.0.1:9998에서 제공한다. 프로젝트 목록은 `~/.shrimp-task-viewer-settings.json`, 뷰어 설정은 `~/.shrimp-task-viewer-global-settings.json`. 두 파일은 사용자 승인 후 생성했으며 모델 API 키는 등록하지 않았다.
- 작업·이력: `data/local/shrimp/`. 설치본과 작업 데이터는 Git에서 제외한다. Shrimp가 이 폴더 안에 자체 Git 이력을 만들지만 원격 백업은 아니므로 보존하려면 이 폴더 전체를 별도로 백업한다. 금융 데이터·토큰은 넣지 않는다.
- Codex 설정: 작업공간 루트의 `.codex/config.toml`, 서버 이름 `retire-together-shrimp`. 현재 PC의 절대 경로를 쓰므로 폴더 이동 시 `args`와 `cwd`를 바꾼다. 전역 설정은 변경하지 않았다. 로컬 MCP 도구 15개 중 작업 계획·조회·실행·검증·수정 관련 10개를 연결했다.

새 컴퓨터에서 설치본을 복원할 때는 다음 순서로 실행한다. 기존 설치 폴더가 있으면 그 폴더를 지우거나 덮어쓰기 전에 상태를 확인한다.

```sh
git clone https://github.com/cjo4m06/mcp-shrimp-task-manager.git .tools/shrimp-task-manager
git -C .tools/shrimp-task-manager checkout 8a3be6bced310c7b660e5cfc3f42e4e5e45f2f61
npm --prefix .tools/shrimp-task-manager ci --ignore-scripts --no-audit --no-fund
npm --prefix .tools/shrimp-task-manager run build
node scripts/shrimp-tasks.mjs seed
node scripts/shrimp-tasks.mjs verify
```

기존 진행 상태를 복원하려면 `seed` 전에 백업한 `data/local/shrimp/`를 복구한다. MCP 설정은 이 컴퓨터에서 등록한 것과 같은 서버 이름·런처·작업 경로를 사용한다. 설치와 조회에는 별도 모델 API 키를 추가하지 않았다.

웹 화면을 복원하려면 아래 명령도 실행하고 화면에서 ‘프로젝트 추가’를 눌러 `data/local/shrimp/tasks.json`의 절대 경로와 둘이서은퇴 프로젝트 폴더를 지정한다. 또는 위 사용자 홈의 뷰어 설정 파일을 백업에서 복원하고 경로를 맞춘다.

```sh
npm --prefix .tools/shrimp-task-manager/tools/task-viewer ci --ignore-scripts --no-audit --no-fund
node scripts/shrimp-codex/install.mjs
npm --prefix .tools/shrimp-task-manager/tools/task-viewer run build
sh scripts/shrimp-viewer.sh
```
