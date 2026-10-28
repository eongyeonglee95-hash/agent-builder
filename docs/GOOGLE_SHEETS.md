# 구글 시트 연결 — 자산 데이터의 원천 (SHEET-01)

갱신: 2026-10-27. 사용자 결정(DECISIONS 2026-10-27): 자산 데이터는 두 분의 구글 시트에 있고 앱은 시트를 읽어 계산·표시한다. 사진·직접 입력·파일로 등록한 결과도 시트에 쓰인다. 시트에서 직접 고치면 앱에 그대로 반영된다.

## 두 분이 직접 해야 하는 것 (한 번만, 10분)

앱이 구글 시트를 읽고 쓰려면 구글이 발급하는 "OAuth 클라이언트"가 필요하다. 이건 구글 계정 주인만 만들 수 있다. 비용은 없다.

1. https://console.cloud.google.com 에 시트를 둘 구글 계정으로 로그인한다.
2. 위쪽 프로젝트 선택 → **새 프로젝트** → 이름 `둘이서은퇴` → 만들기.
3. 왼쪽 메뉴 **API 및 서비스 → 라이브러리** → `Google Sheets API` 검색 → **사용**.
4. **API 및 서비스 → OAuth 동의 화면** → 사용자 유형 **외부** → 앱 이름 `둘이서은퇴`, 지원 이메일은 본인 → 저장. 범위는 비워 두고 다음 → **테스트 사용자**에 두 분의 Gmail 주소를 추가 → 저장. (게시하지 않고 "테스트" 상태로 두면 된다. 테스트 사용자만 로그인할 수 있다.)
5. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID** → 애플리케이션 유형 **데스크톱 앱** → 이름 아무거나 → 만들기 → **JSON 다운로드**.
6. 앱을 열고 머리글의 **로컬 저장** 배지(또는 설정)를 눌러 "구글 시트 연결" 창을 연다.
   1. 1단계: 내려받은 JSON 파일 내용을 그대로 붙여 넣고 **열쇠 저장**.
   2. 2단계: **구글로 연결하기** → 브라우저에 구글 로그인 창이 열린다. 4단계에서 넣은 계정으로 로그인하고 "확인되지 않은 앱" 경고가 나오면 **계속** → 시트 권한 **허용**. 창에 "연결됐어요"가 보이면 닫는다.
   3. 3단계: **새 시트 만들기**(권장) 또는 이미 쓰는 시트 주소를 붙여 넣고 **이 시트 쓰기**.
7. 머리글 배지가 **구글 시트**로 바뀌면 끝. 로컬에 등록해 둔 자산이 있으면 비어 있는 시트로 자동으로 옮겨진다.

배우자 컴퓨터에서도 같은 시트를 쓰려면: 같은 JSON을 붙여 넣고(한 프로젝트를 같이 씀), 2단계에서 배우자 계정으로 로그인하고, 3단계에서 같은 시트 주소를 붙여 넣는다. 시트는 구글 드라이브에서 배우자에게 **편집자**로 공유해 둔다.

## 시트 모양

시트 `둘이서은퇴`에 탭 두 개. 1행은 머리글이며 앱이 읽을 때 이름을 확인한다 — 열 이름을 바꾸거나 순서를 바꾸면 "머리글이 앱 양식과 달라요"가 뜬다. 열은 끝에만 추가한다.

| 탭 | 열 | 뜻 |
|---|---|---|
| `자산` | id, owner, pocket, assetClass, name, account, account_id, amount, as_of, source, version, updated_at, request_id, parent_id, valuation_source, share_percent | '우리 자산' 표의 한 줄. owner는 me/partner/joint, pocket은 retirement/cash/property/debt, assetClass는 stock/long_bond/mid_bond/gold/commodity/cash/property/mixed/debt, amount는 원 단위 정수, as_of는 `2026-10-27` 문자열. source는 manual(직접 입력)/capture(사진)/file(파일). version은 앱이 올린다 — 시트에서 고칠 때는 그대로 두면 된다 |
| `보유종목` | account_id, ticker_name, ticker, qty, price, as_of, updated_at | 사진·파일로 등록한 계좌의 종목 단위 잔고. 리밸런싱 엔진이 쓰는 모양과 같다(`tools/parse_balance.HOLDING_COLUMNS`) |

시트에서 직접 할 수 있는 것: 금액·이름·기준일 고치기, 줄 지우기, 직접 입력 자산 줄 추가(id는 아무 고유 문자열, version 1). 앱은 몇 초 안에 반영한다(읽기 캐시 5초).
하면 안 되는 것: 1행 머리글 바꾸기, 탭 이름 바꾸기, 같은 id를 두 줄에 쓰기.

## 앱 쪽 구조

- `tools/sheets.py`: 시트 API 클라이언트(읽기·쓰기·탭 보장), OAuth 토큰 저장/갱신(`data/local/google/`), 시트 만들기/지정. 테스트용 `MemorySheets`.
- `backend/ledger.py`: 시트가 연결돼 있으면 `SheetStore`(시트가 원천), 아니면 None → `backend/storage.py`가 SQLite를 쓴다. 저장 규칙(버전 충돌·세부 자산·중복 계좌)은 두 저장소가 같다.
- `backend/google_api.py`: `/api/google/status · client-secret · connect · spreadsheet · connection`.
- `backend/registration.py`: `/api/register/accounts · capture · file · commit` — 사진·파일 등록(REG-01). 저장 때 `data/snapshots`(엔진용)와 시트 `보유종목` 탭에 함께 쓴다.
- 내 정보·배우자 정보(프로필)는 시트가 아니라 로컬 SQLite에 둔다(Claude 가정, DECISIONS 참조).
- 테스트·브라우저 테스트는 `RETIRE_SHEETS=off`로 시트를 절대 열지 않는다.

## 안 될 때

- "권한이 없어요": 로그인한 계정으로 그 시트를 열 수 있는지(공유) 확인. 연결 끊고 다시 연결.
- "확인되지 않은 앱": 4단계 테스트 사용자에 그 계정이 있는지 확인. 경고 화면에서 **고급 → 둘이서은퇴(안전하지 않음)으로 이동**을 눌러도 된다(본인이 만든 앱이다).
- 토큰이 만료되면 앱이 자동 갱신한다. 테스트 앱의 refresh token은 구글 정책상 7일마다 만료될 수 있다 — 그러면 2단계를 다시 한다. 동의 화면을 "프로덕션"으로 게시하면(검토 없이 가능, 경고만 뜸) 7일 제한이 없어진다.
