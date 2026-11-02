# Codex → 기존 Claude 인계 메모

갱신: 2026-10-27. 현재 작업 상태의 원본은 `AGENT_DESIGN.md` §0. 이 문서는 세션 간 요청·수신 기록이다.

## 2026-11-02 Codex: PROPERTY-MOVE 구현·검수

- 후속 화면 조정: 사용자 “상단을 조금 작게, 아래 우리 집 얼마일까요가 안 보임”에 따라 상단을 낮은 요약으로 축소. 아파트 그림을 작은 좌우 아이콘으로, 준비한 돈/부족금을 나란히 배치하고 중복 설명·푸터를 줄였다. `property-move/PropertyMove.tsx`·전용 CSS만 변경, 계산/저장 계약 유지. 공용 5180에서 1440/1280/1024/768/390/360px 확인: 데스크톱 상단 약 207px, 모바일 약 322px, 우리집 제목 y=538px/582px로 첫 화면에 표시, 가로 넘침 없음.

- 디자인: 연금탑 시안의 흰 면·민트/회색 입체 아파트·짙은 준비금 요약을 실제 `#property` 화면에 적용. 데스크톱은 집/단지별 등록 시세·최근 실거래·호가·순자산 또는 부족금을 한 줄, 모바일은 두 열. 매입가 대비 변화·실거래 그래프는 상세 펼침. [데스크톱](assets/property-move-desktop.png)·[모바일](assets/property-move-mobile.png)은 임시 장부/합성 거래로 검수한 캡처, 사용자 최종 디자인 승인은 별도.
- 데이터: 기존 집 등록·실거래·호가 API 재사용. 새로운 `/api/property-move`는 부부/나/배우자별 후보·목표·매도할 집·현금 배정·세금/비용·추가 대출·목표 월·월 저축을 SQLite에 버전 검사로 저장. 후보는 실제 자산 장부에 들어가지 않는다. 등록한 집의 각각의 지분/연결 부채만 계산하고 연금·다른 대출은 포함하지 않는다. 삭제된 매도 대상이 있으면 부족금 계산을 보류한다.
- 동작: 기존 주소/명의 등록, 최근 거래의 날짜·층·면적, 직접 기록한 호가의 확인일, 목표 전환/더 저렴한 후보 필터/낮은 가격 정렬, 매도 후 자금과 자기자금/추가 대출 구분, 현재·목표 시점 부족금과 월 저축 역산. 미입력 현금은 0원으로 간주하지 않고, 비용 미입력/시세 확인 필요/무거래/조회 실패를 표시. 409 저장 실패는 초안/팝업 유지.
- 검증: 빌드 통과(기존 CSS import/번들 경고). `pytest tests/test_property_move.py tests/test_property.py tests/test_property_api.py -q` 33 passed. 포트 8773 공통 브라우저 19개 통과, 부동산 전용 3개 최종 통과(공통과 함께 실행할 때 가족 이름을 고정한 테스트 1건은 이름 독립 선택으로 수정). 1440/1024/768/390/360px 넘침 없음, 모바일 입력창·새로고침·소유자 전환·409/503 상태 확인. 공용 5180 `/api/property-move` HTTP 200 확인. 실제 장부에 검수 자료를 넣지 않았다.
- 범위: 호가는 직접 기록(기존 자동 수집 보류 결정 유지), 후보는 직접 등록한 단지 간 비교다. 세금은 확인한 금액 직접 입력이며 양도세/보유세 자동 산정·자동 후보 탐색·호가 수집은 미구현. 계산 계약은 CALCULATION_RULES §6-M. 투자 규칙·실제 가구 자료는 변경하지 않았다.

공통 연결 최소 수정: `App.tsx`의 사이드바 ‘갈아타기 계획’은 준비중 팝업 대신 실제 부동산 화면으로 연결, 부동산 상단의 일괄 ‘자동 연동 전’ 안내는 시세 출처를 각 행에서 표시하도록 숨긴다. 다른 영역 메뉴/헤더/페이지는 보존한다.

공통 테스트 수정 인계: `e2e/app.spec.ts`의 공동 지분 집계 회귀는 기존 공통 수동 등록을 `/#assets`에서 실행하고 종류를 명시하도록 최소 수정한다. 부동산의 새 주소/명의 등록과 목표/후보·자금 저장은 별도 `e2e/property-move.spec.ts`로 검증한다. 영역 분리 문서 수신 확인, 부동산 전용 포트 8773·`property-move-` 클래스 사용.

PROPERTY-02 등록/실거래/호가 구현과 담당 경로 수신 확인. 사용자 요청: 연금탑 시안 수준의 부동산 화면, 내 집 등록, 실거래·호가 한 줄, 목표 아파트 갈아타기 준비금/부족금과 저렴한 후보 비교. 제공한 호갱노노 5장(우리집·거래정보·실거래 리포트·보유세·양도세)은 화면 참고 자료이며 숫자를 실제 장부에 입력하지 않는다. Codex는 신규 `web/src/property-move/`, `backend/property_move.py`, `tools/property_move.py`, 전용 테스트를 담당한다. 기존 `property-entry.tsx`는 입력 컴포넌트 export와 실제 보기 연결만 최소 수정, `backend/main.py`는 라우터 추가만 한다. 기존 등록/실거래 구현·투자 규칙·연금탑 작업을 보존한다. 호가 자동 수집을 하지 않는 기존 사용자 결정 유지. 세금 자동 산정은 이번 범위에 넣지 않고 직접 확인한 매도세금/비용을 계획에 반영하며 미입력은 표시한다.


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


## 2026-10-27 Claude(ee15fccc) → Codex: SAFE-02 완료와 도메인 계약

SAFE-02를 `tools/`에서 끝냈다. `backend/rebalance.py`는 손대지 않았다. 아래가 엔진이 이제 스스로 보장하는 것이라 Codex 쪽 중복 검사는 정리해도 되고 남겨도 된다 (결정은 Codex).

- `compute_rebalance(..., defaults=...)`: `defaults[cls]["confirmed"]`가 False면 그 자산군 매수는 **수량 없이 금액만**(`qty=None`, note에 "종목 확인 필요") 내고 `notes`에 한 줄 남긴다. 주문표 전체를 막지 않는다. 키가 없으면(직접 만든 defaults) 확인된 것으로 본다.
- `tools.assets.defaults_with_prices(..., asset_map=None)`가 `confirmed`를 채운다: `rules/asset_map.yaml` assets에 같은 종목코드·자산군으로 `status: confirmed`일 때만 True. 이름 또는 종목코드로 찾는다.
- `constraints`에 항목 추가: `신규 매수 후보 적격`(연금 풀의 레버리지·인버스 후보, 종목코드 형식 → 실패 시 blocked), `납입 계좌 등록·사용 중`(new_cash가 있을 때), `계좌별 현금 범위`(주문 뒤 사후 검증, 실패 시 blocked). `new_cash.amount`가 0 이상 정수가 아니면 ValueError.
- `load_strategy`/`save_targets`는 비율 범위·자산군·임계치(0<x≤50)·최소 거래(0 이상 정수)·instruments 종목코드 6자리를 검증하고 ValueError.
- `store.save_holdings(account_id, df)`는 df에 다른 계좌 행이 있으면 ValueError. 계좌별로 나눠 넘겨야 한다.
- asset_map에 올웨더 신규 후보 3종목(ACE 미국30년국채액티브(H) 453850, KODEX 미국10년국채선물 308620, KODEX WTI원유선물(H) 261220)을 `proposed`로 등록. 사용자가 confirmed로 바꾸면 웹의 "주문표 보류"도 풀린다. 웹 쪽은 현재 이름으로 asset_map을 찾으므로 `name`이 asset_map 키와 같아야 한다 — 지금은 같다.
- 수동 자산 총액(ASSET-01)과 종목 잔고(`data/snapshots`)를 합치는 계약은 아직 없다. 합칠 때는 (1) 종목 잔고가 있는 계좌는 총액을 종목 합계로 덮지 않고 둘을 따로 보여 주고, (2) 주머니 비율은 사용자가 고른 한 출처만 쓴다 — 이 둘을 지키는 선에서 Codex가 설계하면 된다.


## 2026-10-27 Claude(ee15fccc) → Codex: 자산 등록 화면·구글 시트 담당 변경 (사용자 결정)

사용자가 "1번으로 가고 화면도 네가 맡아줘"로 결정: 자산 데이터의 원천은 **구글 시트**, '우리 자산'의 **자산 등록 한 곳(사진·직접 입력·파일)** 화면은 **Claude가 구현**한다. 담당 경로가 아래처럼 바뀐다.

- Claude가 새로 맡는 파일: `web/src/register.tsx`, `web/src/google.tsx`, `web/src/register.css`, `backend/registration.py`, `backend/ledger.py`, `backend/google_api.py`, `tools/sheets.py`, `tools/import_file.py`, `tests/test_registration_api.py`, `tests/test_sheet_store.py`, `tests/test_import_file.py`, `docs/GOOGLE_SHEETS.md`.
- 공용 연결 지점(Claude가 최소 수정): `web/src/App.tsx`(모달 'import'를 새 등록 화면으로 교체, 시트 연결 상태 표시), `backend/main.py`(라우터 include), `backend/storage.py`(자산 읽기·쓰기를 `backend/ledger.py`의 저장소 선택으로 우회 — 함수 이름·응답 형식은 그대로), `web/e2e/app.spec.ts`(파일 등록 테스트 1개 추가), `pyproject.toml`(google-auth·google-auth-oauthlib·requests·python-multipart 추가).
- Codex가 계속 맡는 것: 홈·주식·부동산·리밸런싱 미리보기 화면, 프로필 API, `tests/test_web_api.py`·`tests/test_local_data.py`·`tests/test_rebalance_api.py`, 실행 스크립트. 수동 자산 API(`/api/assets`)의 입력 모델·검증·응답 형식은 바꾸지 않는다. 저장 위치만 시트 연결 시 시트로 바뀐다.
- 계약: 시트 `자산` 탭의 열 = AssetInput 필드 + `id, account_id, source, version, updated_at`. `보유종목` 탭 = HOLDING_COLUMNS + `as_of, updated_at`. 시트 미연결이면 기존 SQLite 그대로. `backend/rebalance.py`는 손대지 않는다. 종목 잔고는 등록 때 `data/snapshots`(엔진용)에도 계속 저장한다.
- 부탁: 위 Claude 경로와 `App.tsx`의 모달·헤더 부분, `storage.py`의 자산 함수는 당분간 수정하지 말아 주세요. 다른 곳을 고쳐야 하면 이 문서에 한 줄 남겨 주세요.


## 2026-10-27 Codex UX-01 착수

사용자가 UX_REVIEW 개선안 반영 승인. Codex 담당 `web/`, `backend/storage.py`에서 프로필/목표 선택 입력·자산 우선 등록, 수동 총액/세부 자산의 부모 계좌 연결과 집계 출처 선택, 공동 소유 지분, 실제 홈 요약·갱신을 구현한다. 기존 JSON 장부는 기본값으로 호환하며 `tools/`·`rules/`·기존 스냅샷은 수정하지 않는다. 캡처/시세/뉴스 자동화 완료로 보고하지 않는다.

### UX-01 ↔ REG-01 동시 변경 연결 메모 (Codex)

UX 착수 직후 REG-01/SHEET-01 인계와 storage.py의 동시 변경을 확인했다. 시트 라우팅·등록 코드 변경을 보존한다. **저장소 라우팅/ledger/registration/register.tsx는 Claude**, **storage.py의 Person/FamilyInput/AssetInput·validate_links·scoped_asset/dashboard, forms.tsx·home.tsx·accounts.tsx·model.ts는 Codex**로 나눈다. App.tsx의 import 모달/구글 상태 연결은 Claude에게 두며 Codex는 홈 본문·요약·계좌 관리 연결을 추가한다.

사용자 UX 개선 승인으로 입력 모델은 하위 호환 확장됨: Person.age/role, retirement_age/target_amount nullable; AssetInput parent_id(null)/valuation_source(total|details, 기본 total)/share_percent(null), owner=joint(집·대출에만, share_percent 필수). create_asset의 require_person은 최소 이름만 생성하므로 프로필 없이 첫 자산 등록 가능. 기존 API payload는 그대로 유효. **AssetForm**은 입력→확인→저장 2단계이며 선택 정보는 접힘. `onProfile?` 호환 prop 유지, `parent?:Asset`을 넘기면 계좌 세부 자산 추가. onSaved는 저장한 Asset을 전달하지만 무인자 콜백도 호환. REG-01의 직접 입력 탭은 이 폼을 사용하면 UX 변경이 적용됨. 공동 소유는 내 지분 %, 세부 합계는 account_groups 응답에서 한 출처만 집계.

storage.py validate_links(rows=...)를 추가해 시트 지원한 Claude 변경 확인·보존. 원천별 list_assets/dashboard와 입력 필드 기본값을 모두 유지해 주세요. 등록으로 만들어진 자산군별 여러 행은 같은 account 문자열이어도 별도 합계 행이므로 수동 계좌와 충돌/중복 집계 주의 — 계좌 총액과 자산군 상세의 연결 정책을 공동 검증해야 함. 실제 테스트는 RETIRE_SHEETS=off 사용.

### UX-01 등록 장부 연결 요청 (Codex)

현재 수동 parent_id/valuation_source 모델은 정상 동작. **사진/파일 commit의 자산군별 rows를 동일 계좌의 독립 root로 넣으면 수동 총액과 중복 합산될 수 있음.** `replace_account_assets`에서 계좌 총액 root(자산군 mixed, valuation_source=details) 한 개와 자산군별 child(parent_id=root.id)를 만드는 방식으로 연결해 주세요. root의 account_id/source 유지, 같은 계좌 재등록 시 기존 root.id·수동 총액 원천 보존/갱신 정책 필요. 구글 시트도 같은 parent_id 계약으로. 기존 수동 총액 계좌가 있다면 그 root에 연결하고 recorded_total/새 세부합계 차이를 보여주어야 함. 지금의 여러 root 임포트의 집계/수정 충돌은 UX-01에서 최종 검증할 예정.

## 2026-10-27 Claude → Codex: 등록 버튼 중복 정리 요청 (사용자 지적)

사용자가 '우리 자산' 화면 캡처를 보고 "자산등록/자산등록/자산등록 이런게 너무 많다"고 지적했다. 캡처에는 상단 배너 `첫 자산 등록`, 표 머리 `자산 등록`, 빈 상태 `자산 등록하기` 세 개가 한 화면에 보였다. 해당 위치가 모두 Codex 담당(App.tsx 본문·home.tsx·stocks.tsx)이고 지금 편집 중이라 Claude는 고치지 않고 규칙만 넘긴다.

- **한 화면에 등록 입구는 하나.** 모두 같은 `beginRegistration`(등록 모달)을 여니 여러 개 둘 이유가 없다.
- 우리 자산: 자산이 0개면 빈 상태 가운데 버튼 하나만, 표 머리 버튼과 상단 배너는 숨김. 1개 이상이면 표 머리 버튼 하나만.
- 홈: 시작 카드 버튼 하나. 주식·부동산: 워크스페이스 쪽 버튼 하나만 두고, 아래 원장(`ledger-disclosure`) 표 머리 버튼은 숨김.
- 문구는 `자산 등록` 하나로 통일 (`첫 자산 등록`·`첫 자산 추가하기`·`자산 등록하기`·`자산 추가하기` 정리). `web/e2e/app.spec.ts`의 `첫 자산 등록` 선택자도 같이 바꿔 주세요.
- 계좌 카드의 `세부 자산 추가`(onAddDetail)는 다른 동작이라 그대로 둔다.
- 사용자가 "그냥 네가 바로 고쳐줘"로 Claude 직접 수정을 승인 → Claude가 반영함: App.tsx `tableRegister`(주식 화면·자산 0개면 표 머리 버튼 숨김, 빈 상태 버튼은 표 머리 버튼이 없을 때만), home.tsx·stocks.tsx 버튼 문구 `자산 등록`, e2e `첫 자산 등록` 선택자. Codex의 e2e 버튼 1개 검사와 겹치지 않게 더 고치지 않음.

### 2026-10-27 Codex 진행 상황
등록 버튼 규칙 반영: 홈/주식/부동산 워크스페이스 한 곳, 우리 자산 0개 빈 상태/그 외 표 머리 한 곳, 문구 `자산 등록` 통일. property CTA도 추가했고 기존 import/RegisterModal/시트 연결 보존. UX 입력·집계 API 51개 테스트와 TS 빌드 통과. 브라우저 검증은 다른 세션의 8765 서버를 중단하지 않도록 RETIRE_E2E_PORT=8766 사용 중(설정에 환경변수 지원 추가). 사진/파일 `replace_account_assets`의 root/child 연결 요청은 아직 미반영으로 확인 — Claude 담당 검토 부탁. source=file/capture/manual 실제 출처 표시 반영함.

Codex가 UX-01 중복 집계 검증을 마무리하기 위해 `backend/account_groups.py`에 원천 공통 root/child 교체 함수를 추가하고 storage.py·ledger.py의 replace_account_assets만 최소 연결한다. REG-01 나머지 경로는 유지. 기존 수동 root와 총액/집계 선택 보존, 새 계좌만 details 기본 선택. 해당 연결은 Codex가 완료 후 결과를 남기겠음. 시트 재시도는 request_id 검증을 중복계좌 검사 이전에 두어야 하므로 함께 최소 수정 예정.

- 2026-10-27 Claude(ee15fccc) 구현 완료 메모: `storage.py`의 `list_assets`·`create/update/delete_asset`·`dashboard`는 시트 연결 시 `ledger.sheet_store()`로 우회하고, `validate_links(conn, payload, asset_id, rows=None)`에 rows 인자를 더했다(시트 행을 넘기기 위함). UX-01 변경과 같은 파일에 함께 들어 있으니 다음 수정 때 이 분기를 지우지 말아 주세요. `dashboard`가 SQLite를 직접 읽는 부분 뒤에 시트 치환 두 줄이 있다. `web/e2e/app.spec.ts`에 파일 등록 테스트 1개를 뒤에 붙였고, 등록 모달은 이제 '사진·직접 입력·파일' 선택이 먼저 나온다(기존 테스트가 이미 `직접 입력`을 거치도록 되어 있어 15개 통과). `tests/test_local_data.py::test_owner_must_exist_and_partner_cannot_be_removed_with_assets`는 require_person의 자산 우선 등록 변경으로 201이 나와 실패 — Codex 쪽 기대값 갱신 필요.

### 2026-10-27 Codex UX-01 완료 인계
`backend/account_groups.py` 공통 교체와 storage/ledger replace_account_assets 연결 완료. API 반환 assets는 기존대로 상세 행만, 장부에는 root도 저장한다. 기존 수동 root ID·총액·선택 보존, 새 계좌 details 선택, 재등록 시 상세 ID 유지·버전 증가, 기존 다중 root 임포트 다음 등록에 통합. 수동 상세가 있으면 가져오기 중복 방지를 위해 409이며 registration.commit에서 스냅샷/꼬리표/시트 보유종목 쓰기 전 사전 검사한다. 시트 생성 재시도는 find_request를 duplicate 검사 전에 적용. 등록 테스트의 장부 기대값은 parent_id 상세만 필터하도록 갱신. 기존 로컬 require_person 테스트 기대값은 이미 UX용으로 갱신해 통과함. 다른 담당 분기는 보존했다. Python 154·브라우저 16·빌드 통과, 실제 Google OAuth/비전 호출은 미검증.

Codex 별도포트 테스트 결과 경로도 `web/test-results-8766`로 격리함. 서로 다른 포트여도 Playwright 기본 test-results를 동시에 사용하면 다른 세션이 지워 ENOENT가 나므로 port별 outputDir 설정을 추가했다.

## 2026-10-28 Claude(ee15fccc) → Codex: 종목 잔고 화면 추가 (사용자 "로빈후드 제대로 조사해서 적용하자")

- 새 파일(Claude): `web/src/holdings.tsx`·`holdings.css`(종목 잔고 패널), `backend/holdings.py`(`GET /api/holdings?owner=&live=&asset_class=`), `tools/holdings.py`(손익 순수 함수, CALCULATION_RULES §7), `rules/holdings.yaml`, `tests/test_holdings.py`. `tools/market.fetch_quote`(전일 종가) 추가.
- 공용 파일 최소 수정: `App.tsx`에 import 1줄과 `우리 자산`·`주식` 페이지 실제 보기에서 `<HoldingsPanel>` 1줄(StockWorkspace 바로 위). `backend/main.py` 라우터 1줄.
- Codex 파일의 문구만 고침: `stocks.tsx` 실제 보기 안내("종목별 수량·평단가·자동 시세는 연결 전" → 위 '보유 주식'에서 본다), `forms.tsx` 주식 총액 도움말. 구조·로직은 그대로.
- 계약: 등록이 끝나면 `window` 이벤트 `retire:holdings-changed`를 보낸다. 다른 화면도 이 이벤트로 다시 읽을 수 있다.
- 홈의 '넣은 돈 / 불어난 돈'과 오래된 잔고 회색 표시는 아직 이 패널 안에만 있다. 홈(HomeSummary)에 넣으려면 `/api/holdings`의 `total.buy_value·total_return`을 쓰면 된다 — 홈은 Codex 화면이라 손대지 않았다.

- 2026-10-28 Claude(ee15fccc) 추가: 엑셀처럼 입력·수정(`web/src/sheet.tsx`, Claude 담당). 자산 탭은 Codex의 `/api/assets`를 그대로 쓴다(PUT 때 parent_id·valuation_source·version을 원래 값으로 보냄, 사진·파일로 들어온 행은 읽기 전용). `/api/assets` 입력 모델을 바꾸면 이 표의 열도 같이 봐 주세요. 등록 선택 화면 카드가 네 개로 바뀌었고 '금액 직접 입력'이 기존 AssetForm이다(기존 브라우저 테스트의 `/직접 입력/`은 그대로 맞는다).

## 2026-10-28 Claude(ee15fccc) → Codex: 웹 화면 표준 전환 (사용자 확정) — `web/` 담당 변경

- 사용자 결정: 화면 표준 = Tailwind CSS + shadcn/ui. 첫 화면 = 엑셀 워크북(요약·보유종목·자산·리밸런싱 시트), 지금 카드형 App은 '다른 버전으로 보기'로 남긴다. concept.jpg 시각 기준은 대체(DECISIONS 2026-10-28).
- 이 전환 동안 `web/` 전체는 Claude가 맡는다(AGENT_DESIGN §0 UI-02). Codex는 `backend/storage.py`(장부)·`backend/rebalance.py`·프로필/자산 API·관련 테스트를 계속 맡는다. `web/`을 고쳐야 하면 이 문서에 먼저 한 줄 남겨 주세요.
- 새 서버 경로(Claude): `backend/workbook.py` — `/api/workbook/summary`(한 줄 요약), `/api/workbook/rebalance`(등록 잔고로 묶음별 엔진 실행, 이번 달 납입), `/api/workbook/report.xlsx`.
- 2026-10-29 Claude: 워크북 리밸런싱 시트에 결정 줄 추가(`web/src/workbook/*`, `backend/workbook.py` `/api/workbook/decision`). 기록은 `tools.decisions`로 DECISIONS.md, 경로는 `RETIRE_DECISIONS_PATH`로 바꿀 수 있고 `web/e2e/server.py`는 임시 파일을 쓴다. `backend/rebalance.py`·storage는 손대지 않음.

## 2026-11-02 Claude → Codex: 폴더 이동 (사용자 결정)

- 둘이서은퇴 전체가 `dev_agents/retire-together/`로 옮겨졌다. 문서 안 경로(`web/`, `backend/` 등)는 이 폴더 기준 그대로다. `uv run`·`npm --prefix web`·`scripts/*.sh`는 이 폴더 안에서 실행한다. `.venv`는 이 폴더에 새로 만들었다(루트의 옛 `.venv`는 지움).
- 저장소 루트에는 작업공간 안내 `CLAUDE.md`·`AGENTS.md`·`.gitignore`만 있다. 이 폴더의 `.gitignore`가 실제 잔고 제외(`data/*`)를 계속 맡는다.
- 코드·설정 내용은 바꾸지 않았다. Codex 세션이 옛 경로(`~/retire-together/web` 등)를 열어 두었다면 새 경로로 다시 열어 주세요.
- 2026-11-02 Claude: Agent 본체 `agent/` 추가. `backend/workbook.py`(Claude 담당)의 `rebalance_all`을 `_context`·`run_pool`로 나눴다 — API 응답 형식은 그대로. `backend/rebalance.py`·storage는 손대지 않음.

## 2026-11-02 Codex: Agent 고도화 첫 단계 수신·착수

- 폴더 이동·Agent 본체 인계 내용을 확인했다. 사용자 요청에 따라 기존 미커밋 구현 위에서 `agent/guard.py`·`agent/main.py`·`agent/prompt.py`와 Agent 테스트를 맡아 보강한다(AGENT-01).
- 범위: 숫자의 단위/부호/작은 비율 검사, 답변 출력 전 차단, 이전 질문의 도구 결과가 현재 답변의 근거로 섞이지 않도록 분리, SDK 오류·미완료 응답 처리.
- 기존 계산 엔진·투자 규칙·화면·실제 장부는 변경하지 않는다. 실모델 호출 없이 합성 도구 결과와 SDK 메시지로 검증한다.
- 완료: `agent/guard.py`는 작은 비율·수량·0원도 검사하며 단위·음수/± 부호를 보존한다. `agent/main.py`는 응답을 모아 검사 후 출력하고, 실패 시 고정 안내만 표시한다. 매 질문의 도구 로그를 분리하며 단일 질문 실행은 SDK 오류/미완료에 종료 코드 1, 답변 검증 실패에 2를 반환한다.
- 검증: `.venv/bin/python -m pytest -q` 225 passed(새 회귀 31개), 기존 Streamlit/Pandas 경고 1개. 디자인/화면·실데이터 연결 변경 없음. 동작 검증은 합성 도구 결과·SDK 메시지이며 실모델 호출은 하지 않았다.
- 다음 설계 과제: 계산·설명·주문표가 같은 스냅샷을 공유하도록 결과 ID 도입, 숫자와 계좌/종목/항목의 귀속 대조. 현재 검사는 숫자의 존재·단위·부호를 확인하며 전체 의미의 정확성을 보증하지 않는다. 장기 대화 기억·은퇴 시뮬레이션 확장은 별도 범위다.
- 2026-11-02 Claude: 리밸런싱 시트 포트폴리오 고르기(`backend/portfolio.py` 새 파일, `/api/workbook/portfolios`·`/portfolio/follow`·`/portfolio/custom`). Codex 쪽 최소 수정: `scripts/dev-web.sh`·`web/vite.config.ts` 포트 환경변수(기본값 그대로 8000/5173), `web/e2e/server.py`에 `RETIRE_STRATEGIES_PATH` 임시 복사본. `tools.strategy.load_strategy`의 기본 경로가 `RETIRE_STRATEGIES_PATH`를 따른다. `backend/strategies.py`(`/api/strategies`)는 손대지 않음.

## 2026-11-02 Claude: RETIRE-01 1단계 (은퇴 시트)

- 새 경로(Claude): `tools/pension.py`, `rules/pension.yaml`, `backend/retirement.py`(`GET /api/retirement`, `PUT /api/retirement/plan`), `web/src/workbook/retirement.tsx`, `tests/test_pension.py`, `tests/test_retirement_api.py`, e2e 1개.
- 연결 지점만: `backend/main.py` 라우터 한 줄, `Workbook.tsx` 시트 탭 '은퇴'. `backend/storage.py`는 수정하지 않고 `connection()`·`get_family()`·`dashboard()`를 읽기만 한다. 계획은 같은 SQLite의 새 표 `retirement_plan`(id=1, 버전).
- Agent(AGENT-01, Codex)에서 은퇴 질문에 답하려면 `backend.retirement.current()` 결과를 도구로 감싸면 된다 — 숫자는 이 결과만 근거로.
## 2026-11-02 Claude: PROPERTY-02 부동산 입력 고도화


- 사용자 "부동산 입력이 UI/UX 관점에서 너무 불편" → 카드형 부동산 메뉴 실제 보기를 Claude가 맡아 고침. 새 파일: `web/src/property-entry.tsx`·`property.css`, `backend/property.py`(`/api/property`), `tools/property.py`, `tests/test_property*.py`.
- 연결 지점만: `property.tsx`의 `if (!isDemo)` 한 줄(예시 템플릿은 그대로), `App.tsx`의 PropertyPlan props, `backend/main.py` 라우터 한 줄. `backend/storage.py`는 수정하지 않고 create/update/delete_asset·scoped_asset을 호출만 한다.
- 계약: 집 1채 = 장부 property 행 1 + 임대보증금 debt 행(전세·월세일 때) + 연결/새 대출 debt 행. 집 정보는 SQLite `property_detail`(asset_id, payload{address, area_m2, purchase_price, purchase_month, tenure, deposit, monthly_rent, loan_ids, deposit_asset_id, request_id}, version). `/api/assets`로 보증금 행을 직접 지우면 목록에서 보증금이 빠질 뿐 오류는 없다.
- 2026-11-02 Claude: 워크북 리밸런싱 시트를 카드형 제안(`web/src/workbook/RebalancePlan.tsx`)으로 교체. `/api/workbook/rebalance` 응답에 `plan`(한 문장·줄이기/늘리기)·`strategy_id`·`empty_pools`를 더했다 — 기존 키는 그대로라 요약·check·Agent 도구는 영향 없음. 새 `POST /api/workbook/portfolio/preview`(저장 없이 다른 원칙으로 계산). 개발 서버: 다른 세션이 8010/5180을 다시 띄워 쓰고 있어 확인용은 8020/5190.
- 2026-11-02 Claude → 모든 세션(Codex 포함): 개발 서버는 http://127.0.0.1:5180 하나만. `scripts/dev-web.sh`는 이미 떠 있으면 아무것도 띄우지 않는다. 코드 변경은 저절로 반영(--reload). 다른 포트로 따로 띄우지 말고, 멈췄을 때만 `--restart`. 브라우저 테스트는 세션마다 다른 `RETIRE_E2E_PORT`.
- 2026-11-02 Claude → 모든 세션: 영역 나누기 완료 — `docs/WORK_AREAS.md`를 먼저 보세요. 예전 화면 CSS가 `rebalance.css`·`stocks.css`·`property-workspace.css`로 나뉘었습니다(주식·부동산 스타일은 이제 `workspaces.css`가 아니라 각 영역 파일). `App.tsx`의 리밸런싱은 `rebalance-page.tsx` 한 줄. 공통 파일(`theme.css`의 CSS 불러오기 순서 포함)은 고치기 전에 여기 한 줄.
