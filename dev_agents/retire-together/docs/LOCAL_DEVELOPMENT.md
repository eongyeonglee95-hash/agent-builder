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
- 나머지 개인/등록/설정/다운로드/문서 API도 공통 세션 검사 대상. 쓰기에는 동일한 CSRF 검사가 적용되며 `X-Retire-Local`은 웹 인증을 대신하지 않는다. SHARE-04/05의 권한/사람 매핑 전에는 기존 금융 API를 오너에게만 허용한다. 웹 모드의 `/api/google/*`는 기존 InstalledAppFlow/공용 토큰 사용 방지를 위해 409로 차단한다.

세션은 무작위 불투명 쿠키·서버에는 해시만 저장하며 12시간 절대 만료다. HTTPS 쿠키는 `__Host-`·Secure·HttpOnly·SameSite=Lax·Path=/, 로컬 HTTP는 별도 이름과 명시적 허용을 쓴다. Google 로그인은 `openid email`만 요청하고 ID/access/refresh 토큰을 영구 저장하지 않는다. Drive/Sheets 자격 증명 분리는 SHARE-03 범위다. Uvicorn 접근 로그의 `/api/auth/*` 쿼리는 제거한다. 향후 외부 HTTPS 프록시를 붙일 때도 콜백 쿼리를 기록하지 않고, 정확한 Host/HTTPS 전달·신뢰할 프록시 범위를 운영 설정으로 확인해야 한다. 이번에는 배포/프록시 설정을 변경하지 않았다.

검수 명령:

```sh
.venv/bin/python -m pytest -q tests/test_web_auth.py tests/test_web_api.py tests/test_local_data.py
.venv/bin/python -m pytest -q
RETIRE_AUTH_BROWSER_TEST=1 RETIRE_E2E_PORT=8779 npm --prefix web run test:e2e -- --config auth.playwright.config.ts
```

Python 인증 전용 51개, 전체 444개 통과. 합성 RSA 서명/가짜 Google HTTP·임시 DB로 서명/issuer/audience/만료/nonce·state 재사용·동시 초기화·고정 오너 변경·CSRF·재로그인·로그아웃·세션 만료/비활성화를 검사했다. 추가 저장 경로 테스트의 첫 실행은 빈 프로필 fixture 처리 오류 1건이었고 수정 후 전체 통과했다. 전용 브라우저 테스트는 Google 이동을 가짜 응답으로 대체하고 별도 임시 인증/금융 DB만 사용한다. 초기 Shrimp 실행에서 포트 제한으로 멈췄던 브라우저 검수는 후속 로컬 세션에서 완료했다. 기존 리디렉션 모킹을 별도 localhost 가짜 제공자로 교체해 외부 요청 없이 4개 검사(로그인·UI 저장·재로그인·로그아웃, 제3자/취소, 설정 실패/재시도, 업로드 CSRF/세션 만료)를 통과했다. 인증/API Python 105개와 빌드도 통과했다. 추가 기존 앱 회귀는 19개 중 17개 통과하며, 2개는 기존 계좌 선택자의 합계 셀 중복 매칭과 변경된 개인연금 입력창의 옛 필드 선택자 불일치로 실패했다. 관련 제품 UI는 이 작업에서 변경하지 않았다. 후속 팝업/메인 전환까지 인증/API Python 108개·인증 브라우저 6개·메인/표 전환 1개를 통과했다. 실제 최초 Google 로그인과 활성 오너 세션도 확인하여 SHARE-02를 완료했다. 실제 계정으로 새 팝업 재로그인은 자동 검수 결과와 구분한다. UI 디자인 검수·공통 시트 연결·두 계정 통합 완료를 이 결과로 대신하지 않는다.

## Shrimp 작업 관리

2026-11-07 설치. **[Shrimp 작업 화면 열기](http://127.0.0.1:9998/?lang=ko&profile=retire-together)**에서 작업을 확인하고 현재 ChatGPT 구독으로 로그인한 로컬 Codex에 실행을 맡길 수 있다. 공식 Task Viewer에 이 프로젝트용 연결 기능을 추가했다. 작업 상태는 기존 MCP 파일을 읽으며, 제품 로그인 기능의 완료 여부와 도구 설치 완료는 별개다.

### 화면에서 쓰는 법

1. 위 링크를 열면 **둘이서은퇴 → 작업** 목록이 나온다. 상단의 전체·대기·진행 중·완료 숫자로 현황을 본다. `PENDING`은 아직 시작하지 않은 **대기** 상태다.
2. **작업 이름을 클릭**하면 해야 할 일·구현 가이드·검증 기준이 나온다. 목록으로 돌아갈 때는 `Back to Tasks`를 누른다. 검색창에는 작업 이름이나 `SHARE-02` 같은 번호를 넣는다.
3. 작업 왼쪽 **체크박스**를 선택하고 목록 위 **‘선택 작업 실행’**을 누른다. Codex에 자동 배정되어 선택한 작업만 선행 순서에 따라 하나씩 실행한다. **‘Codex에 배정’**만 누르면 담당자 표시만 저장하며 모델 호출·개발은 시작하지 않는다.
4. **‘실행 내용 보기’**에서 진행·결과를 확인한다. **‘실행 중지’**는 현재 실행과 남은 대기열을 멈추며 이미 변경된 파일은 유지한다. ‘확인 필요’·‘실행 오류’이면 설명을 확인하고 필요한 정보를 보완한 뒤 다시 실행한다. 미완료 선행 작업이 있으면 함께 선택하거나 먼저 끝내야 한다.
5. **‘연결 테스트’**는 실제 구독으로 작업 목록을 읽고 응답하는 검사다. 소량의 구독 사용량이 쓰이며 작업 내용·상태는 바꾸지 않는다. 연결되지 않으면 터미널에서 `codex login`으로 ChatGPT 계정에 로그인한다.

대화에서 **“SHARE-02 시작해줘”**라고 요청하는 방법도 유지한다. 행 오른쪽 **🤖 버튼**은 요청 문구를 복사하는 기존 기능이다. 웹 실행은 새로운 로컬 Codex 세션이며 이 대화의 내용을 자동으로 이어받지 않으므로 요구사항·작업표·인계 문서가 실행 문맥이다. 별도 OpenAI API 키는 사용하지 않고 구독의 사용 한도가 적용된다. [OpenAI 인증 안내](https://learn.chatgpt.com/docs/auth)

화면은 자동 새로고침으로 작업 상태를 다시 읽는다. 상단 새로고침 버튼으로 즉시 갱신할 수도 있다. 한국어로 설정했지만 공식 화면의 일부 버튼과 상태는 영어로 표시된다. 화면에서 할 일과 내용을 확인하고, 구현·테스트가 끝났을 때 Codex가 완료 근거와 작업 상태를 기록하는 흐름으로 사용한다.

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
