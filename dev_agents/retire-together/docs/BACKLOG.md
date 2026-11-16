# BACKLOG — 둘이서은퇴 할 일 한곳

할 일의 원본. **기능 영역 → 작업 → 한 번에 끝낼 단계**로 나눈다. 세션을 시작하면 이 파일만 보고 고른다.
옛 근거(작업표·UX 검토·인계 메모)는 `archive/`에 있다. 결정은 `DECISIONS.md`.

- 기준: 2026-11-16. 11-02 UX 검토 항목은 코드로 다시 확인해 반영함
- 상태 표시: `[ ]` 할 일 · `[사용자]` 사용자가 해야 함 · `[결정]` 사용자가 정해야 진행 · `[보류]` 결정으로 미룸
- 우선: **P0** 잘못된 정보를 보여줌 / **P1** 불편·흐름 끊김 / **P2** 있으면 좋음
- 단계 하나 = 커밋 하나 크기. 끝나면 `[x]`로 바꾸고, 작업이 다 끝나면 작업을 지운다(기록은 커밋 메시지)
- 새 할 일은 해당 영역 맨 아래에 같은 모양(작업 ID · 우선 · 단계 · 파일 · 끝난 기준)으로 추가

---

## 1. 등록·데이터 연결

파일: `register*`, `sheet*`, `google.tsx`, `backend/registration.py`, `tools/kiwoom.py`, `tools/parse_balance.py`, `rules/accounts.yaml`

### REG-PRICE · P1 · 모든 계좌 현재가를 키움 시세로
지금 "현재가 반영"은 웹 시세(`tools/market.py`). 키움 시세 TR로 미래에셋 연금 ETF 가격도 받는다.
- [ ] 1. 키움 공식 명세에서 현재가 TR 확인(ka10001 주식기본정보 등)·호출 한도 정리 → `docs/wiki/sources/broker-apis.md`에 한 단락
- [ ] 2. `tools/kiwoom.py`에 `quote(code)` — 응답 → {price, prev_close, 기준 시각}, 초당 한도 지키며 여러 종목 → 끝난 기준: 가짜 응답 단위 테스트
- [ ] 3. `tools/market.py`의 시세 출처를 "키움 키가 있으면 키움, 실패하면 지금 방식"으로 → 기존 `test_market.py` 통과 + 키움 경로 테스트
- [ ] 4. 화면에 시세 출처·시각 표시("키움 · 10:42") — `holdings.tsx`·워크북 요약 줄
- [ ] 5. 실제 키로 연금 계좌 ETF 5개 시세 확인(장중·장마감 각각)
- [ ] 6. 미국 종목은 종목코드 칸이 KRX 6자리 전용이라 비워 둠 → "현재가 반영"이 미국 종목엔 안 먹는다. 해외 티커 칸(또는 `us:AMZN` 형식)을 정하고 키움 해외 시세로

### REG-POOL-LINK · P1 · 새 계좌 등록 → 리밸런싱 묶음 설정으로 이어지기
지금 계좌를 새로 만들면 묶음(pool)이 없어 리밸런싱에 안 나온다.
- [ ] 1. 연금 계좌(연금저축·IRP·ISA) 저장 직후 "이 계좌를 어떻게 관리할까요?" 단계 — 혼자/다른 계좌와 합쳐서, 원칙, 리밸런싱/매수만 (`register.tsx`)
- [ ] 2. 서버: 계좌의 pool 지정·새 pool 만들기 API (`backend/registration.py` 또는 `portfolio.py`, `tools/assets.save_accounts`)
- [ ] 3. 현금 주머니 계좌(키움 일반 등)는 이 단계를 건너뜀
- [ ] 4. 테스트: 새 연금 계좌 등록 → 묶음 설정 → 워크북 리밸런싱에 그 계좌가 나옴(API + 브라우저 1개)

### REG-HISTORY · P2 · 키움 잔고 매일 기록 → 현금 주머니 추이
- [ ] 1. 자동 갱신 때 날짜별 스냅샷은 이미 쌓임(`data/snapshots/me_kiwoom_general/`) — 예수금도 날짜별로 남기기
- [ ] 2. 추이 API(날짜·평가금액·예수금) + 작은 선 그래프(자산 시트 또는 주식 메뉴)

### REG-KEY-UI · P2 [보류] · 화면에서 증권사 키 입력
로컬 사용이라 보류(DECISIONS 2026-11-16). 배우자 키움처럼 키가 둘 이상이 될 때 다시 본다.

### REG-PENSION-CAPTURE · P2 [보류] · 퇴직연금·국민연금 캡처 가져오기
자동 조회 API 없음(DECISIONS 2026-11-02).

## 2. 리밸런싱

파일: `workbook/RebalancePlan.tsx`, `rebalance-page.tsx`, `rebalance.tsx`, `backend/plan.py`·`portfolio.py`·`rebalance.py`·`workbook.py`, `tools/rebalance.py`, `rules/strategies*`

### RB-STATUS · P0 · 계산 못 한 묶음을 "모두 범위 안"으로 말하지 않기
확인(11-16): `backend/workbook.py` 요약 줄이 오류 묶음·분류 없는 묶음을 건너뛰고 "리밸런싱: 모두 범위 안"이라고 쓴다. 묶음에 안 들어간 연금 계좌도 언급이 없다.
- [ ] 1. 묶음 상태를 네 가지로 계산하는 순수 함수: 범위 안 / 조정 필요 / 계산 못 함(이유) / 묶음 없음 계좌 (`backend/workbook.py` 또는 `plan.py`) + 단위 테스트
- [ ] 2. 한 줄 요약에 반영: "리밸런싱: 1개 조정 필요 · 1개 잔고 확인 필요" — "모두 범위 안"은 전부 계산됐을 때만
- [ ] 3. `RebalancePlan.tsx` 상단 문구도 같은 상태로(지금 "모든 묶음이 목표 범위 안이에요")
- [ ] 4. Agent 도구가 읽는 문구(`workbook.py` 248행 메시지)도 같은 규칙

### RB-ORDER-ACCOUNT · P1 · 주문표에 주문할 계좌 표시
확인(11-16): 서버 주문에는 `account_id`가 있지만 워크북 `Order` 타입·목록에 계좌가 없다. 지금 묶음은 계좌 하나씩이라 영향은 작지만 합산 묶음이 생기면 필요.
- [ ] 1. `/workbook/rebalance` 응답 주문에 계좌 이름 포함 확인/추가
- [ ] 2. 주문 목록을 계좌별로 묶고 순서는 매도 → 매수 (`RebalancePlan.tsx`)
- [ ] 3. 수량·금액·가격 기준 시각 표시

### RB-APPLY · P1 · 원칙 "비교"와 "적용" 분리
확인(11-16): 미리보기 → "바꾸기" 흐름은 있지만, 원칙 고르기(`PrincipleSelect`)는 고르자마자 `/portfolio/follow`로 저장된다.
- [ ] 1. 원칙 고르기는 미리보기만 열고 저장은 미리보기의 "바꾸기"에서만
- [ ] 2. 미리보기에 대상 묶음·계좌와 바뀌기 전후 비율 표시
- [ ] 3. 브라우저 테스트: 고르기만 하면 저장 안 됨, 바꾸기 누르면 저장

### RB-FLOW · P1 · 판정 → 납입금 → 주문표 → 기록 순서 정리
- [ ] 1. 화면 순서를 판정 한 줄 → 이번에 넣을 돈·계좌 → 자산군별 현재/목표/차이 → 계좌별 주문표로 재배치
- [ ] 2. 기록 버튼 세 개 구분: "직접 주문할게요"(기록만) / "이번엔 넘기기" / "거래했어요 → 잔고 갱신"(등록·키움 갱신으로 연결)
- [ ] 3. 기록만으로는 보유량·완료 표시를 바꾸지 않음을 화면에 명시

### RB-PROPOSED · P1 [결정] · 확인 안 된 종목 6개
`rules/asset_map.yaml`의 `status: proposed` 6개(올웨더 신규 후보 장기채·중기채·원자재 등). 확인 전에는 해당 묶음의 주문표가 보류된다.
- [결정] 1. 사용자가 6개 각각 확인/교체 → `confirmed`로
- [ ] 2. 화면에서 "확인 필요한 종목 N개" 안내와 확인 버튼(지금은 YAML 직접 수정)

### RB-SETTINGS · P1 · 예전 Streamlit 설정 화면에만 있던 4가지를 웹으로
2026-11-16 Streamlit(`app/`)을 지우면서 웹에 없던 기능. 그전까지는 YAML을 직접 고친다(코드는 커밋 `1c4315f`의 `app/pages.py` 참고).
- [ ] 1. 묶음 만들기·계좌를 묶음에 넣기·계좌 사용 켜기/끄기 — `tools/assets.save_accounts` (REG-POOL-LINK와 같은 API를 쓴다)
- [ ] 2. 묶음 운용 방식 바꾸기(리밸런싱 / 매수만) — `tools/assets.set_pool_mode`
- [ ] 3. 자산군 기본 종목 고르기(후보 중 선택 → `confirmed`) — `asset_map.yaml class_defaults`, RB-PROPOSED 2단계와 합친다
- [ ] 4. 등록된 종목의 자산군·역할(핵심/위성) 꼬리표 고치기 — `tools/assets.upsert_asset_tags`, 자산 시트에서

### RB-INTO-PENSION · P2 [보류] · 리밸런싱을 연금 화면 안으로
DECISIONS 2026-11-02.

### RB-AUTO-ORDER · 후속 [보류] · 승인형 자동주문
한투 연금계좌(2027 개설) 뒤. 제안 ID·사용자 승인·유효시간·중복 방지·체결 대사·중단 장치 필요(`archive/ARCHITECTURE_REVIEW.md`). LLM에 주문 권한 없음.

## 3. 연금·은퇴

파일: `retirement/*`, `workbook/retirement.tsx`, `backend/retirement.py`, `tools/pension.py`, `rules/pension.yaml`

### RET-OWNER · P1 · 은퇴 화면의 나/배우자 선택
확인(11-16): `useRetirementRows`는 owner를 받지 않는다(가구 계산). 탑 화면은 owner를 받으니 어디까지 개인 기준인지 화면마다 다를 수 있다.
- [ ] 1. 화면에서 "나"를 골랐을 때 탑·그래프·은퇴 시트 숫자가 각각 무엇인지 확인해 표로 정리
- [ ] 2. [결정] 개인 보기를 둘지(내 연금 기여분 vs 가구 생활비) 아니면 "부부 계획"으로 고정할지
- [ ] 3. 정한 대로 선택기 끄기 또는 개인 기여분 계산·표시

### RET-INPUT · P1 · 입력을 네 묶음으로, 연금 화면 안에서 끝내기
- [ ] 1. 은퇴 나이 등 프로필 수정을 연금 화면 안에서(지금은 다른 화면 안내)
- [ ] 2. 입력을 우리 목표(은퇴 나이·생활비) / 현재 연금 / 앞으로 납입 / 계산 가정(접힘)으로 나누기 — `PlanDialog.tsx`
- [ ] 3. 미입력과 0원 구분, 기본값 쓰는 칸에 "기본값" 표시
- [ ] 4. 가구 공통 가정(수익률·물가)을 나/배우자 열과 분리

### RET-COMPARE · P1 · 가정 바꿔보기 → 비교 → 저장
- [ ] 1. 저장 안 하는 미리보기 계산 API(가정만 바꿔서) — `backend/retirement.py`
- [ ] 2. 지금 계획과 나란히(은퇴 직후 월액·부족 기간) 보여주고 "이 계획으로 저장"·"원래대로"
- [ ] 3. 테스트: 바꿔보기만 하면 저장된 계획 그대로

### RET-TAX-WARN · P1 · 선택 나이별 세금 경고·세후 영향 (설계 확정, 구현 전)
설계는 `PENSION_TAX_DESIGN.md`(2026-11-07 사용자 확인). 지금 있는 것은 개인별 3층 연액이 기준선을 넘을 때 띄우는 "세금 확인" 배지까지.
- [ ] 1. 설계 문서의 검수 묶음 순서대로 첫 단계 고르기(경고 심각도·자료 완성도 분리부터)

### RET-NEXT-CALC · P2 · 계산 넓히기
- [ ] 1. 연금 수령 세금(세후 월액) — `TAX_RULES.md` 기준 순수 함수 + 테스트
- [ ] 2. 연금 수령한도
- [ ] 3. ISA 만기 자금 반영
- [ ] 4. 은퇴~연금 개시 사이를 현금 주머니로 메우는 브리지 계산

### RET-DC-IRP · P2 [보류] · DC·IRP 입력 다시 열기
부부 둘 다 DB형이라 숨김(DECISIONS 2026-11-02).

## 4. 주식

파일: `stocks.tsx`, `holdings.tsx`, `backend/holdings.py`, `tools/holdings.py`, `tools/market.py`

### STK-REAL · P1 · 주식 메뉴를 실제 보유 종목으로
지금은 가상 종목 템플릿.
- [ ] 1. 실제 보기에서 가상 카드 대신 `/api/holdings` 종목(등록 잔고·키움 자동 갱신) 사용
- [ ] 2. 종목 카드: 보유 수량·평단가·현재가·평가금액·손익·수익률, 계좌 이름
- [ ] 3. 같은 종목이 여러 계좌에 있으면 합쳐 보기/계좌별 보기
- [ ] 4. REG-PRICE가 끝나면 현재가를 키움 시세로

### STK-NEWS · P2 · 종목 뉴스
- [ ] 1. 뉴스 출처 조사(공식·저작권·호출 조건) → 위키 한 페이지
- [ ] 2. 어제부터의 보유 종목 뉴스 모으기(출처·발표 시각)
- [ ] 3. 요약은 사실·해석·불확실 구분, 예측·추천 표현 금지

## 5. 부동산

파일: `property.tsx`, `property-entry.tsx`, `property-move/*`, `backend/property*.py`, `tools/property*.py`

### PROP-SELL-FORM · P1 · 팔 집 입력을 세 칸으로
- [ ] 1. `property-entry.tsx`에서 매도 예상가·남은 대출·산 날짜만 먼저 보이고 나머지는 접기
- [ ] 2. 기존 저장 필드는 그대로 보존(편집 저장 시 사라지지 않게) + 테스트

### PROP-TOTAL · P1 [결정] · "토탈"이 무슨 뜻인지
- [결정] 1. 갈아타기 화면의 전체 자금 합계에 무엇을 넣을지(집 매도금·현금 주머니·연금 제외 등) 사용자 확인
- [ ] 2. 정한 규칙을 `CALCULATION_RULES.md` §6-M에 쓰고 계산·테스트 반영

### PROP-AUTO · P2 [보류] · 세금 자동 계산·후보 자동 탐색·호가 자동 수집
호가 자동 수집 보류 결정 유지.

## 6. 홈·화면 공통

파일: `home.tsx`, `App.tsx`, `main.tsx`, `workbook/Workbook.tsx`, `theme.css`

### UI-HOME · P1 · 홈을 "지금 상태 + 다음 할 일" 먼저
- [ ] 1. 맨 위: 인사·나/배우자/부부 선택·자료 기준일, 큰 소개 이미지는 줄이기
- [ ] 2. 은퇴 계획 요약 한 칸: 은퇴 직후 월액·목표 생활비·부족 기간(정보 없으면 "필요한 정보 N개" 버튼)
- [ ] 3. "이번 점검" 하나로: 묶음 없는 계좌 → 빠진 정보 → 오래된 잔고 → 리밸런싱 필요 순, 누르면 그 화면·그 계좌로
- [ ] 4. 순자산·노후 주머니·현금 주머니 요약, 최근 기록은 아래로
- [ ] 5. 모바일 높이 재기(지금 3,273px) — 할 일이 첫 화면 안에

### UI-TWO-VIEWS · P1 · 엑셀 보기·카드 보기를 같은 일의 두 보기로
- [ ] 1. 전환할 때 사람 선택·현재 작업(시트/메뉴)을 이어받기 — 예: 엑셀 리밸런싱 → 카드 리밸런싱
- [ ] 2. 두 보기에 같은 기능이 있는지 표로 정리하고 빠진 쪽 채우기 목록 만들기

### UI-MOBILE · P1 · 모바일
- [ ] 1. 은퇴 표(1,210px)를 모바일에선 요약·세로 입력으로, 연도표만 가로 스크롤
- [ ] 2. 카드형 "표로 보기" 버튼이 하단 탭과 겹치는지 확인 → 상단 메뉴로
- [ ] 3. 390·360px에서 핵심 숫자를 좌우 이동 없이 읽는지 브라우저 테스트

### UI-MIGRATE · P2 · 예전 화면을 새 표준(Tailwind+shadcn)으로
- [ ] 1. 화면별 남은 목록 만들기(홈·자산·주식·부동산·리밸런싱)
- [ ] 2. 한 화면씩 옮기기 — 색·글자 크기는 `theme.css` 토큰만

### UI-DS · P2 · 디자인 시스템 따라잡기 (`DESIGN_SYSTEM.md` §8)
- [ ] 1. 화면 파일마다 있는 won·pct·man 함수(약 15곳)를 `lib/format.ts`로
- [ ] 2. 편집 시트 `sheet.css`의 엑셀 회색·맑은 고딕을 `sheet-*`·`grey-*` 토큰으로(워크북 읽기 표와 같은 회색)
- [ ] 3. ReadGrid `pct` 칸: 수익률은 부호, 비중은 부호 없음으로 나누기(지금은 둘 다 부호 없음)
- [ ] 4. 새 코드에 #hex·임의 크기가 들어오지 않게 검사 스크립트(점검표 1번 자동화)
- [ ] 5. [결정] 주식 색(파랑)이 하락 파랑과 비슷 — 바꿀지

### UI-MENU · P2 · 메뉴 정리
- [ ] 홈 / 자산 / 연금 / 주식 / 부동산 (+설정). 메뉴 이름은 "연금"(DECISIONS 2026-11-02)

### UI-SHADE · P2 · 자산군 묶음 음영
- [ ] 묶음 영역에 그 자산군 색의 아주 옅은 바탕, 다크 모드 대비 유지(SCREEN_REFERENCE)

## 7. Agent (대화)

파일: `agent/*`, Agent 도구(`tools/`), `tests/test_agent*`

### AGT-WHY · P2 · 주문표 옆 "왜 지금"
- [ ] 1. 코드가 만든 근거(편차·임계치·지난 결정)를 먼저 표시
- [ ] 2. 그 옆에서 Agent에게 묻기: 이 결과의 이유 / 지난 보류 사유 / 더 넣어야 할 정보 — 설정·금액·기록 화면을 대신하지 않음

### AGT-STUDY · P2 · single-agent → sub-agent 나누기 학습
- [ ] 지금 Agent 구조 정리 → 어디부터 sub-agent로 나눌지 메모(`AGENT_DESIGN.md`)

## 8. 리서치·규칙 (위키)

파일: `docs/wiki/`, `docs/*_RULES.md` — 절차는 `/wiki-research`

### RES-KIM · P1 [결정] · 김성일 전략 (A)/(B)/(C) 중 고르기
- [결정] 사용자 확인 → 정하면 `rules/` 전략 YAML 반영 여부 따로 결정(`wiki/sources/pension-knowledge-sources.md`)

### RES-UNCONFIRMED · P2 · 위키 "미확인" 다시 보기
- [ ] 10개 페이지의 미확인 항목 목록 뽑기 → 다시 확인할 것만 `/wiki-research update`
  (broker-apis, pension-account-rules, tax-rules-sources, market-data-sources, 전략 3종, 종목 분류, 장기채·원자재 후보, 연금 지식 출처)

### RES-KIS · P2 [보류] · 한투 연금저축(22) 조회 TR·주문 수용
실계좌 소액으로만 확인 가능 — 2027 계좌 개설 뒤.

### RES-IRP · P2 [보류] · IRP 코드 설계 2건
IRP 단계로 보류(DECISIONS 2026-10-26).

## 9. 부부 공유·운영

설계는 `GOOGLE_SHEETS.md`. 2026-11-09까지 Shrimp로 관리하던 작업이고 지금은 여기가 원본이다. 옛 상세는 `archive/AGENT_HISTORY.md` §0.
끝난 것(자동 검수까지): SHARE-02 로그인·세션·고정 오너, SHARE-03 공통 시트(실제 Google 파일 API 확인), SHARE-04 배우자 초대 서버, SHARE-05 자료 공유·이전 도구, SHARE-06 초대·수락·재연결 화면.

### SHARE-07 · P1 · 금융 화면 공유 연결과 두 계정 통합 검수
점검 도구·자동 회귀는 끝남. 워크북·종목·연금·부동산 화면은 아직 공유 API로 안 바뀜. 근거 `research/SHARE_07_VALIDATION.md`·`SHARE_06_VALIDATION.md`.
- [ ] 1. 화면별 공유 API 미전환 범위 확인 → 영역별 작업으로 나누기
- [ ] 2. 금융 화면 연결
- [사용자] 3. 실제 두 계정·두 기기: Picker·공유/수락/해제·이전/복구·HTTPS 확인

## 10. 증권사 연결·리포트 (2026-11-14~15 Codex 백로그에서 옮김, 원문 `archive/backlog-codex-2026-11-15.md`)

### KIS-MCP-01 · P2 · 한국투자 MCP 조회 연결 (설치 끝, 키 대기)
조회 전용으로 제한한 공식 MCP(`~/.local/share/mcp/kis-trading-mcp`, Codex 서버 `kis_readonly`).
- [사용자] 1. 한국투자 API 신청 → `~/KIS/config/kis_devlp.yaml`에 키 입력(채팅·저장소에 넣지 않음)
- [ ] 2. 실제 잔고·평가액을 증권사 원본과 대조

### KIWOOM-MCP-01 · P2 · 키움 공식 MCP (설치 끝, 키 대기)
앱 안 키움 REST 연결(2026-11-16, REG-PRICE 등)과 별개로 Codex용 MCP. 겹치면 하나로 정리한다.
- [사용자] 1. 로컬 Codex 설정에 키·real 모드

### PENSION-BROKER-01 · P2 [사용자] · 연금저축·IRP 증권사 API 지원 확인
2026-11-14 사용자: 한국투자를 기본 연동 대상, 키움 병행. 공개자료 조사는 끝, 실조회·실주문은 미검증.
- [사용자] 개인연금22/퇴직연금29의 ETF 주문·정정/취소 TR·제한·수수료 확인(외부 문의는 사용자가 요청할 때만)

### DATA-FLOW · P1 · 입력 → 주문표 → 결정 기록 연결 확인
- [ ] 계좌 스냅샷 자동 로드·현재가·총액/종목 중복 집계를 실제 구현과 대조해 남은 범위 확정 → 재현 가능한 검수

### PROPERTY-REPORT-ROUTINE · P2 · 부동산 주간/월간 리포트 루틴 (시범 운영, Claude)
관심 단지 24곳을 매주 월 09:00·매달 16일 09:00 조사해 Claude Docs로(루틴은 claude.ai/code/routines, 저장소 밖).
- [ ] 1. 2026-11-14 시험 실행 결과(문서 생성·"확인 못 함" 비율) 보고 프롬프트 손보기
- [ ] 2. 정기 실행 2회 이상, 숫자마다 출처·기준일, 예측 표현 없음

### PROPERTY-TAB-REDESIGN · P1 [결정] · 부동산 탭 재설계 (Claude)
띠(매물 증감) + 시장/팔로잉 보드/단지 상세/리포트 4탭. 시안 https://claude.ai/artifact/NujGAaseJe2KmyrkpcQ5ws
- [결정] 1. 보드 기본 보기 · 띠 항목 · 리포트 요일 · 격차 계산을 어디까지 숨길지
- [ ] 2. 토큰만으로 구현, `/api/property-move/watch` 실데이터로 1440/390px 검수. PROPERTY-OBSERVATORY-SITE와 겹치는 부분은 결정 때 정리

### PROPERTY-REPORT-SOURCES · P2 · 정기 리포트 수집 (설계 끝)
- [ ] `research/real_estate/REPORT_COLLECTION_PLAN.md`에서 우선 출처·주기 정하기 → 발행일/관측일·이전 호 변화 추적

### REPORT-AI-01 · P2 · 부동산·연금 주간/월간 리포트 (OpenAI API, 2026-11-14 방향 확인)
앞단 점검 끝(2026-11-15). 부족한 것: 보고서 입력 고정본, 입출금 반영 운용수익률, 통화·환율·소수 수량.
- [ ] ① 공통 입력·자료 완전성 기준 ② 합성 자료로 기간 비교 ③ 고정본 ④ 주간·월간 템플릿. 숫자는 코드/DB, 전략·주문 원칙 유지

### SPENDING-SAMSUNG · [보류] · 삼성카드 소비 절감
사용자 보류(2026-11-09). 재개 요청 전 손대지 않는다.

---

## 사용자 화면 검수 대기 (구현 끝)

- [사용자] UI-01 홈 · UX-01 첫 자산 등록 · REG-01 캡처 등록(실제 캡처) · SHEET-01 구글 시트(실제 OAuth) · FLOW-01 등록→주문표→결정
- [사용자] RETIRE-01 은퇴 시트 · PENSION-TOWER 연금탑
- [사용자] PROPERTY-MARKET-INPUT · PROPERTY-ANALYSIS-HERO · PROPERTY-MOVE
- [사용자] HOME-DESIGN 원본 대시보드 복구 · PERSONAL-CONTRIBUTIONS 3층 납입 계획(2026-11-07)
- [결정] PROPERTY-OBSERVATORY-SITE 부동산 관측실 시안(`sites/property-observatory/`, `web/public/previews/property-observatory/`) · PROPERTY-RESEARCH-CONCEPTS(`web/public/previews/property-futures.html`) 확인
- [결정] DESIGN-DIRECTIONS 4방향 디자인 시안(소나무·모래빛·인디고·흑연) 중 고르기 — `web/public/previews/design-directions.html`
