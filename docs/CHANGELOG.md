# CHANGELOG

## 2026-10-27
- Codex: 현재 코드 기반 UX_REVIEW.md 작성(기획 검토안). 첫 자산 등록/월 갱신 흐름, 프로필·분류 부담, 계좌 총액/종목 중복, 반복 정보·데이터 상태, 부부 공동 자산과 뉴스 근거를 우선 검토. 제품/코드 변경은 아직 반영하지 않음.
- Codex: 주식·부동산 화면 템플릿 구성. 주식 투자 저널/종목별 평단가·손익 예시/뉴스 필터·상세, 부동산 CSS 건축 일러스트/가상 목표 집·관심 선택/자금 가정 슬라이더. 실제 장부와 가상 시세·뉴스·자금 계획 분리. 빌드·브라우저 14개 통과, 외부 시세/뉴스/실거래 연결은 후속.
- (코드) SAFE-02: 신규 매수 후보 적격·전략 범위·계좌 전환 검증 — 기본 종목도 연금계좌 레버리지·인버스·종목코드 검사, asset_map 미확인 후보는 수량 없이 금액만, 납입 계좌 명시 선택·등록/활성 검증, 주문 후 계좌별 현금 범위 사후 검증, 전략 비율 항목별 범위·임계치·최소 거래 검증, 저장 함수가 다른 계좌 행 거부, 캡처 결과를 계좌에 묶고 전환 시 비움. 테스트 8개(103 passed). asset_map에 올웨더 후보 3종목 proposed 등록. REBALANCING §3 한 줄, DEV_HANDOFF 도메인 계약
- Codex: 주식·부동산 독립 메뉴/주소·소유자별 목록·등록 종류 기본값 추가, 모바일 더보기 연결. 부동산 지금 집→다음 집·향후 기능 구성 추가(실거래/뉴스/계산 미연결). 사용자 주식 평단가·현재가·손익·어제 뉴스/영향 요약 요구를 SCREEN_REFERENCE·작업표에 미구현으로 기록.
- docs/wiki/ 후속 조사(Sonnet 에이전트 4개): 10장 미확인 항목 중 22건 해결 — ACE 미국30년 듀레이션, RISE Enhanced 차입 구조, 종합원자재 ETF 없음, KIS 토큰·상품코드, 키움 연금 근거 없음, KRX Open API 조건, 감독규정 개정 없음, IRP 70% 완화 공식 문서 없음, 적격 TDF 기준 2026-04 개정, 조특법·소득세법 부칙. 수정 제안 추가(청년 IRP 15% 정정 등). YAML·RULES 변경 없음. DECISIONS: 구글 로그인은 다른 사람이 쓰게 될 때(방향)
- Codex: PROFILE/ASSET 로컬 저장 검증 및 기존 폼 빌드 오류 수정. API+웹 통합 실행, CSV 리밸런싱 드라이런 API/화면 연결(연금저축·업로드 가격·미확인 후보 주문표 보류), 입력/미등록 상태 스타일 보강. Python 95개·Playwright 7개·웹 빌드 통과. 현재 상태/한계는 AGENT_DESIGN §0·DEV_HANDOFF, 실행은 LOCAL_DEVELOPMENT.md.
- Codex: 컨셉 React 화면 구현 중. 사용자 추가 요청으로 PROFILE-01/ASSET-01(만 나이·성별·아내/남편 역할, 실제 자산 수동 등록·수정·삭제)을 우선 연결. DEV_HANDOFF로 기존 Claude에 담당 경로 전달, 추가 수신 확인 대기. Python/FastAPI 기반 및 의존성 추가.
- (코드) SAFE-01: 입력·저장·계좌 검증 — CSV 행별 검증(양의 정수·중복·계좌 ID 형식), 합계 대조를 수량×가격 기준으로(ReconcileResult, 화면 합계 없으면 검증 불가), 저장은 등록·활성 계좌만·빈 표 거부·경로 이탈 차단, 미등록·비활성 계좌면 주문표 중단. 테스트 5개. REBALANCING §3 한 줄
- AGENT_DESIGN §0: DATA/FLOW/RETIRE/SHARE를 보류했다가 사용자 번복으로 대기(계속 진행)로 복원. DECISIONS에 두 결정 모두 기록
- (코드) compute_rebalance: 전략이 cash 종목을 지정하면 cash도 매수(매도 없음). REBALANCING §1-2 한 줄, asset_map에 TIGER 미국달러SOFR 태깅, 테스트 1개
- strategies.yaml park_gomhee 국내주식 종목 KODEX 200(069500)으로. wiki 박곰희 열린 질문 9 해결
- strategies.yaml all_weather: 시그널스노우볼 해외 올웨더 템플릿으로 교체(30/15/40/8/7, 종목 5개). REBALANCING §4-1 사유 다시 씀(26일 결정 3건 뒤집음). DECISIONS 기록
- DECISIONS: 전략 카드 "예) 종목 + 면책 문구" 표시 방식 채택(시그널스노우볼 참고). 구현은 UI 트랙
- strategies.yaml park_gomhee: 책 비율(stock 70 / long_bond 20 / gold 5 / cash 5)·종목 4개·labels 반영. 이름 "박곰희 포트폴리오"로
- 사용자 승인으로 concept.jpg 기준 React/TypeScript/Vite + Python/FastAPI 전환·입력/보안 보강·컨셉 홈 우선 검수를 현재 계획으로 반영. CLAUDE/AGENTS, MASTER_CONTEXT/PRD, SCREEN_REFERENCE, AGENT_DESIGN §0을 정렬하고 이전 PoC 체크리스트를 이력으로 구분. Claude 리서치 보존·담당 경로·수신 확인 절차 명시. 구현 착수/수락은 별도 상태로 관리.
- wiki pension-knowledge-sources: 시그널스노우볼 앱 템플릿 6개(글로벌·국내 6:4, 해외·국내 올웨더, 단일 2) 캡처 기록. 국내 올웨더 금 15가 우리 선택과 같음, 면책 문구 참고, 종목 코드는 출처로 안 씀
- docs/wiki/sources/pension-knowledge-sources.md 신설: 연금 출처 지도(공공기관 > 연구소 > 저자 > 유튜버). 2026 신간 차경수 『연금 이야기』, 미래에셋 김동엽 연재, KODEX 액션북, 시그널스노우볼 참고 앱

## 2026-10-26
- wiki 박곰희: 사용자가 찍은 『박곰희 연금 부자 수업』 4장으로 비율(공격형=책 "박곰희 포트폴리오")·종목 7개·4개의 통장·월배당 포트 확정. YAML 후보 stock 70 / long_bond 20 / gold 5 / cash 5. YAML은 미변경
- 컨셉 이미지 기준 화면·구조·보안 검토를 ARCHITECTURE_REVIEW.md에 기록. 기존 테스트 18 통과/15 fixture 부재 실패, 합성 입력으로 파싱·저장 경로·주문 후보 검증 문제 확인. React/TypeScript + Python/FastAPI 전환은 제안 단계.
- wiki/strategies/kim-sungil-k-all-weather: 저자 본인 칼럼(교보 뉴스룸 4편 2026-10-12)으로 보강 — 국채 30년 장기채·현금성 예시 ETF(초단기채·CD/머니마켓)·월 1회 리밸런싱(밴드 없음) 확인. 2022·2023 보도(17.5/15)와 다른 구성(B: 4개 지역 주식 50·국채 30·금 20·현금 0~40)을 별도 YAML 후보로 추가. 책 본문 비율은 미확인 유지. YAML·RULES 변경 없음
- wiki/strategies/parkgomhee: 보강 시도 — 공격형 해외주식 25(합 100) 기사 2건으로 재확인, 임계치 없음 재확인. ETF 종목 유형·계좌별 구성은 미확인 유지(영상 페이지 자막 미노출, 책 확인 필요). YAML·RULES 변경 없음
- TAX_RULES: 위키 조문 대조 6건 반영(종신형 3.3%, 50% 구간 시기, 의료 인출 제외, 수령연차 기산점, ISA 주석, 출처 교체). REBALANCING §3 연금저축·IRP 근거 구체화, §4 설명 재료 4줄 추가(Vanguard·Bernstein·김성일). §2 밴드만 확정
- REBALANCING §4-1 신설: 원형에서 바꾼 것과 사유(금=원자재 15, 장기채 환노출, 중기채 추가 매수 국고채10년, 종목 선택 룰) — Agent 설명 재료. (코드) 전략별 자산군 표시 이름 `labels`(올웨더 gold → "금 (=원자재)") 화면·주문표 반영
- strategies.yaml 올웨더: 원자재 7.5 → 금에 합쳐 금 15 (사용자 결정, 원형과 다름을 주석에). (코드) 전략 지정 종목(instruments)은 보유 종목보다 먼저 산다. 올웨더 장기채 ACE 미국30년국채액티브(환노출)·중기채 ACE 국고채10년 지정, ACE 종합채권은 mid_bond 유지. 테스트 1개
- (코드) 기본 종목 2층 구조: strategies.yaml 전략별 `instruments`(자산군별 유형·종목) → 없으면 asset_map class_defaults. Strategy.instruments, defaults_with_prices(instruments=) 추가, 테스트 1개. REBALANCING §1-2 반영. asset_map: 보유 9종목 전부 confirmed, 금 기본 종목 ACE 확정
- REBALANCING §1-2 기본 종목 기준 순서 변경: 이미 많이 보유한 운용사 > 거래량 > 총보수 (사용자 룰). asset_map: 주식 core 3종(TIGER S&P500·ACE S&P500·ACE 나스닥100) confirmed
- docs/wiki/ 리서치 초안 10장: 투자 룰(달리오·김성일·박곰희·책 원칙), 상품(보유 9종목 근거·장기채/원자재 후보), 출처(세법 조문 대조·연금계좌 제도·증권사 API·시세 소스). YAML·RULES는 변경 없음, 수정 제안은 각 페이지에
- AGENT_DESIGN: 리서치 트랙 체크, 사용자 결정 5개 추가. MASTER_CONTEXT: 미래에셋 Open API 존재 주장 정정
- `/wiki-research update`를 Sonnet 전용 에이전트 `wiki-updater`(.claude/agents/)로 실행하도록 변경. 새 주제 조사는 세션 모델 유지
- docs/ 구조로 재편: MASTER_CONTEXT, SCREEN_REFERENCE, MASTER_PRD, AGENT_DESIGN, REBALANCING_RULES, TAX_RULES, CALCULATION_RULES, DECISIONS, CHANGELOG 생성
- TAX_RULES: 퇴직금 연금수령 과세 비율을 2단계(30/40% 감면)에서 3단계(실제수령연차 10년 이하 70% / 20년 이하 60% / 20년 초과 50% 과세)로 수정. "55세 즉시 개시" 하드코딩 금지 → 시나리오 비교. 1,500만원은 절벽이 아닌 기준선으로 표현 수정
- AGENT_DESIGN: Pension Rebalancing Agent 정의 고정, 내부 역할 표, 첫 PoC 1페이지(범위·제외·완료 기준·기술·일정)
- 자동매매(KIS API 연금계좌 조사 결과), 레거시 처리, 현금 주머니 구조 반영
- (Claude Code 세션) 확정 대기 기본값 확정, 수령 기간을 층별 종료 나이로 변경, 계좌 현황(미래에셋·키움·한투) 추가, 아이디에이션 회의(1~2주 뒤) 기준으로 PoC 일정을 "계산 함수 → Streamlit 홈 → 리밸런싱 화면 → Agent"로 조정, 전략 비율 원천을 rules/strategies.yaml로 통일, Agent 도구·컨텍스트 제한 명시, 워크플로우 0단계 계좌 선택(rules/accounts.yaml) 추가, 리밸런싱 HTML 목업(docs/assets/mockup-rebalancing.html) 반영 및 compute_rebalance 출력 데이터 계약 추가, 미래에셋 연금저축 (구)+(신) 합산 규칙과 캡처 입력 경로 반영, data/ 전체 git 제외, 입력 구조를 "보유 내역 1회 등록 + 현재가 공개 시세 조회"로 확정(fetch_prices tool 추가)
- (코드) 1주차 전반 완료: tools/ 9개 모듈, 테스트 15개 통과, 실제 잔고로 드라이런 주문표 생성. 리밸런싱 풀(pool)과 모드(리밸런싱/매수만)를 accounts.yaml에 추가, 첫 로그인 때 합산/따로를 고르는 "계좌 묶기" 화면을 SCREEN_REFERENCE에 추가
- (코드) 종목 역할 core/satellite(위성 먼저 매도, 핵심만 매수)와 완전 리밸런싱 옵션. 자산 시트(출처·음영·매입단가·필터)
- (코드) 설정(계좌 묶기)·입력(캡처 등록) 화면 완성. 화면 스모크 테스트 추가
- (코드) 2주차 리밸런싱 화면 완성(풀·전략·모드·납입·차트·주문표·결정 버튼). 종목 선택 규칙 §1-2와 class_defaults 추가, 엔진이 기본 종목으로 수량 계산
- docs/wiki/ 리서치 위키 폴더와 `/wiki-research` 프로젝트 스킬(새 주제·주기 갱신 절차) 추가
- (코드) Streamlit 메인 화면(홈·연금 샘플·메뉴) 1주차 후반 완료. 체크리스트에 '데이터 리서치 / llm-wiki' 트랙 분리
- (코드) 캡처 파싱(Claude 비전, Agent SDK) 실행: 캡처 6장 → 두 계좌 모두 화면 합계와 오차 0. 완료 기준 2 통과
- (문서) DECISIONS: 구글 시트 원천 확정과 자산 등록 화면 담당 변경(Claude). AGENT_DESIGN §0에 REG-01(자산 등록 한 곳: 사진·직접 입력·파일)·SHEET-01(구글 시트 원천) 추가, DEV_HANDOFF에 Codex 인계
- (문서) DEV_HANDOFF: 등록 버튼 중복 정리 규칙을 Codex에 전달 (한 화면에 등록 입구 하나, 문구 '자산 등록' 통일)
- (코드) REG-01 자산 등록 한 곳: `web/src/register.tsx`(사진·직접 입력·파일 → 확인 표 → 저장), `backend/registration.py`(/api/register/accounts·capture·file·commit), `tools/import_file.py`(CSV·엑셀 느슨한 머리글). 저장은 스냅샷(엔진)·종목 꼬리표·시트 보유종목·자산군별 자산 행
- (코드) SHEET-01 구글 시트 원천: `tools/sheets.py`(OAuth·시트 API·MemorySheets), `backend/ledger.py`(SheetStore), `backend/google_api.py`, `web/src/google.tsx`(연결 3단계·머리글 배지). storage의 자산 읽기·쓰기·대시보드가 시트 연결 시 시트를 쓴다. 테스트는 RETIRE_SHEETS=off
- (문서) `docs/GOOGLE_SHEETS.md` 추가(사용자 설정 순서·시트 모양·구조). AGENT_DESIGN §0 REG-01/SHEET-01 상태 갱신, LOCAL_DEVELOPMENT에 링크 한 줄

- (코드·문서, Codex UX-01) 자산 우선 등록·목표 선택·자동 기본 분류·저장 전 확인, 실제 홈 간소화·자료 갱신, 등록 버튼 단일화, 공동 소유 지분, 계좌 총액/세부 한 출처 집계와 사진/파일 재등록 연결. SQLite·메모리 시트·브라우저 검증, UX_REVIEW 실행 기록 갱신.
- (코드) REG-01 보완(사용자 피드백): 등록 때 계좌를 먼저 고르지 않는다. 캡처 전부를 한 번에 올리면 캡처 상단 계좌 이름으로 나누고(`parse_captures`, 다중 계좌 스키마) 등록 계좌에 이름으로 맞춘다(`match_account`). 모르는 계좌는 캡처 이름·증권사·종류를 미리 채운 '새 계좌로 추가'로 그 자리에서 만든다. 파일은 파일 이름으로 맞춰 본다
- (문서) SCREEN_REFERENCE에 자산 등록 확인 화면 기준 추가: 증권사 잔고 화면 레퍼런스, 자산군별 묶음, 나중에 자산군 음영(사용자 요청)
- (코드) REG-01 확인 화면 v2: 시안(증권사 잔고 화면 순서 + 평평한 꾸밈)대로 — 계좌별 평가금액·손익·합계 대조, 자산군 비중 막대, 자산군별 묶음, '주식을 나눠 보기'(국내·미국·신흥국·테마·배당·리츠), 종목은 읽기 전용 두 줄이고 누르면 그 줄만 고침. 매입금액·주식 구분 저장(스냅샷 buy_value, asset_map stock_group, 시트 보유종목 buy_value 열). 버그 수정: 저장 때 종목 역할을 core로 덮어쓰던 것 → 보내지 않으면 기존 역할 유지, TIGER 차이나휴머노이드로봇 satellite 복구
- (문서) `docs/research/STOCK_APPS_REFERENCE.md` 추가: 주식 탭 고도화용 레퍼런스(Robinhood·키움·Investing.com·토스증권·카카오페이증권의 보유 화면·종목 상세·뉴스·최근 기능, 가져올 후보 표, 확인 못 한 것)
- (문서) `docs/research/ROBINHOOD_DEEP_DIVE.md` 추가: 보유 여섯 칸, 계좌 통합(잔고 변화≠수익), 가족 허브 권한, Portfolio Digest 네 칸, Strategies 리밸런싱, 디자인 원칙과 우리 적용 후보 8개
- (코드) Robinhood 조사 적용: 우리 자산·주식에 '종목 잔고' 패널(`web/src/holdings.tsx`, `/api/holdings`, `tools/holdings.py`). 넣은 돈/불어난 돈 분리(매입금액 아는 종목만, 추정 안 함), 현재가로 보기(공개 시세·전일 종가 → 오늘 손익), 어제 종가 이후 손익 기여·등락 상위(시세 사실만), 정렬(평가금액·오늘 손익·오늘 등락률·총 손익·수익률·이름), 자산군별 묶기, 오래된 잔고 회색(rules/holdings.yaml stale_days). 매입금액이 없는 최신 잔고는 같은 계좌 이전 등록에서 종목·수량이 같을 때만 가져오고 *로 표시. CALCULATION_RULES §7 추가
- (코드) 엑셀처럼 입력·수정: `web/src/sheet.tsx`·`sheet.css`(보유종목·자산 두 탭 표, 붙여넣기, 키보드, 한글 IME), `/api/register/sheet`, `/api/register/template.xlsx`(빈 양식·지금 잔고 채운 양식, 고르는 칸), 파일의 계좌·자산군·주식 구분 열 읽기(한 파일 여러 계좌). 등록 방법 네 가지(사진·표로 입력·엑셀·CSV 파일·금액 직접 입력). SCREEN_REFERENCE 2026-10-28 엑셀처럼 절, DECISIONS 한 줄
- (코드) 화면 표준 Tailwind v4 + shadcn/ui 도입(`web/src/theme.css` 토큰, Pretendard, `src/components/ui/*`, `@/` 별칭). 첫 화면을 엑셀 워크북으로(`web/src/workbook/*`, `/api/workbook/summary·rebalance·report.xlsx`): 한 줄 요약, 요약·보유종목·자산·리밸런싱 시트, 이번 달 납입 입력 칸, 보고서 엑셀. 예전 화면은 '다른 버전으로 보기'(#home), 예전 CSS는 legacy 레이어. 브라우저 테스트의 첫 화면 주소를 /#home으로
- (문서) CLAUDE.md 시각 기준을 새 표준으로, SCREEN_REFERENCE 2026-10-28 화면 표준 절, `docs/research/UI_REFERENCES.md`(레퍼런스·토큰 근거), DECISIONS·AGENT_DESIGN UI-02·DEV_HANDOFF

