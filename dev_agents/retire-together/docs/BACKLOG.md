# BACKLOG — 둘이서은퇴 할 일 한곳

흩어져 있던 할 일을 **기능 영역별로** 모은 목록. 영역 나누기는 `WORK_AREAS.md`와 같다(세션은 자기 영역 표만 보면 된다).
작업 상태의 원본은 계속 `AGENT_DESIGN.md` §0 작업표, 근거는 `UX_REVIEW.md`·`DEV_HANDOFF.md`·`DECISIONS.md`. 이 파일은 "다음에 뭘 할지"만 본다.

- 기준: 2026-11-16 (각 문서에서 모음. `UX_REVIEW` 항목은 2026-11-02 검토 기준이라 이미 고쳐졌을 수 있음 → **확인 필요** 표시)
- 상태: `할 일` · `확인 필요`(지금도 문제인지 먼저 확인) · `검수 대기`(구현 끝, 사용자가 화면 확인) · `보류`(사용자 결정으로 미룸) · `결정 필요`(사용자가 정해야 진행)
- 우선: P0 잘못된 정보·흐름이 끊김 / P1 불편 / P2 있으면 좋음
- 끝나면 줄을 지우고 CHANGELOG에 한 줄. 새 할 일은 해당 영역 표 맨 아래에 추가

---

## 1. 등록·데이터 연결 (계좌·잔고 가져오기)

파일: `register*`, `sheet*`, `google.tsx`, `backend/registration.py`, `tools/kiwoom.py`, `tools/parse_balance.py`, `rules/accounts.yaml`

| 우선 | 할 일 | 상태 | 출처 |
|---|---|---|---|
| P0 | 루미르(키움) 자산군 골라 첫 등록 — 이후 자동 갱신이 묻지 않고 돈다 | 할 일(사용자) | 2026-11-16 |
| P1 | 모든 계좌 현재가를 키움 시세로 — 지금 "현재가 반영"은 웹 시세(`tools/market.py`). 키움 ka10001 등으로 미래에셋 연금 ETF 가격도 공식 시세로 | 할 일 | 2026-11-16 대화 |
| P1 | 새 계좌 등록 → "어떤 기준으로 관리할까요?"(리밸런싱 묶음·전략) 단계로 이어지기. 지금은 등록해도 묶음 0개 | 확인 필요 | UX_REVIEW P0 |
| P2 | 키움 잔고 하루 한 번 기록 → 현금 주머니 추이 그래프 | 할 일 | 2026-11-16 대화 |
| P2 | 화면에서 증권사 키 입력(설정 → 증권사 연결) — 배우자 키움 등 키가 둘 이상일 때 | 보류(로컬 사용) | DECISIONS 2026-11-16 |
| P2 | 퇴직연금·국민연금 캡처 가져오기 (자동 조회 API 없음) | 보류 | DECISIONS 2026-11-02 |
| — | 실제 캡처로 등록 검수 · 구글 시트 실제 OAuth 연결 검수 | 검수 대기 | §0 REG-01·SHEET-01 |

## 2. 리밸런싱

파일: `workbook/RebalancePlan.tsx`, `rebalance-page.tsx`, `rebalance.tsx`, `backend/plan.py`·`portfolio.py`·`rebalance.py`·`workbook.py`, `tools/rebalance.py`, `rules/strategies*`

| 우선 | 할 일 | 상태 | 출처 |
|---|---|---|---|
| P0 | 묶음이 하나도 없거나 계산 못 한 계좌를 "모두 범위 안"으로 표시하지 않기 — 미설정·자료 부족·계산 실패·범위 안을 따로 (`workbook.py` 한 줄 요약 209·248행이 아직 "모두 범위 안" 문구) | 확인 필요 | UX_REVIEW P0 |
| P0 | 워크북 주문표에 **주문할 계좌** 열 — 여러 계좌를 합산하는 묶음에서 어느 앱에서 주문할지 | 확인 필요 | UX_REVIEW P0 |
| P1 | 판정 → 이번 납입금 → 계좌별 주문표 → "직접 주문 예정 기록 / 이번엔 보류 / 거래 후 잔고 갱신" 순서로 정리 | 할 일 | UX_REVIEW 구현 순서 4 |
| P1 | 원칙 "비교 중"과 "지금 적용 중" 분리 — 워크북 "이걸로"가 바로 저장되는 문제. 적용 전 대상 묶음·변경 전후 보여주기 | 할 일 | UX_REVIEW P1 |
| P1 | asset_map의 `proposed` 종목 6개 확인(올웨더 신규 후보 장기채·중기채·원자재 등) — 확인 전엔 주문표 보류 | 결정 필요 | DEV_HANDOFF·`rules/asset_map.yaml` |
| P2 | 리밸런싱을 연금 화면 안으로 합치기 | 보류 | DECISIONS 2026-11-02 |
| 후속 | 승인형 자동주문(한투 연금, 2027 계좌 개설 뒤) — 제안 ID·승인·유효시간·중복 방지·체결 대사·중단 장치 | 보류 | ARCHITECTURE_REVIEW §자동주문 |

## 3. 연금·은퇴

파일: `retirement/*`, `workbook/retirement.tsx`, `backend/retirement.py`, `tools/pension.py`, `rules/pension.yaml`

| 우선 | 할 일 | 상태 | 출처 |
|---|---|---|---|
| P0 | 카드형(다른 버전) 연금 화면이 `/api/retirement`와 안 이어져 "미입력·준비 중"으로 보임 — 두 보기가 같은 계획 공유 | 확인 필요 | UX_REVIEW P0 |
| P1 | 은퇴 시트의 "나/배우자" 선택이 계산에 안 먹음 — 가구 계산이면 선택기를 끄고 "부부 계획" 표시 | 확인 필요 | UX_REVIEW P1 |
| P1 | 은퇴 나이 등 프로필 수정을 연금 화면 안에서 / 입력을 우리 목표·현재 연금·앞으로 납입·계산 가정 네 묶음으로 | 할 일 | UX_REVIEW §연금·은퇴 |
| P1 | "바꿔보기"(가정 수정)를 저장된 계획과 나란히 비교 → "이 계획으로 저장"·되돌리기 | 할 일 | UX_REVIEW §연금·은퇴 |
| P2 | 세금·연금 수령한도·ISA·현금 주머니 브리지(은퇴~연금 개시 사이) 계산 | 할 일 | §0 RETIRE-01 다음 단계 |
| P2 | DC·IRP 입력 다시 열기 (지금은 부부 둘 다 DB형이라 숨김) | 보류 | DECISIONS 2026-11-02 |
| — | 연금탑·석탑 채색·월 수령액 중심 화면·은퇴 시트 | 검수 대기 | §0 PENSION-TOWER·RETIRE-01 |

## 4. 주식

파일: `stocks.tsx`, `holdings.tsx`, `backend/holdings.py`, `tools/holdings.py`, `tools/market.py`

| 우선 | 할 일 | 상태 | 출처 |
|---|---|---|---|
| P1 | 주식 메뉴를 가상 종목 템플릿에서 실제 보유 종목으로 — 평단가·현재가·손익·수익률 (등록 잔고·키움 잔고 사용) | 할 일 | §0 STOCK-01, SCREEN_REFERENCE |
| P2 | 어제부터의 종목 뉴스(출처·발표 시각) 모으기, 사실·추론·불확실성 구분. 시세·뉴스 출처 먼저 확인 | 할 일 | SCREEN_REFERENCE 사용자 추가 요구 |

## 5. 부동산

파일: `property.tsx`, `property-entry.tsx`, `property-move/*`, `backend/property*.py`, `tools/property*.py`

| 우선 | 할 일 | 상태 | 출처 |
|---|---|---|---|
| P1 | 팔 집 입력을 매도 예상가·남은 대출·산 날짜 세 칸으로 접기 (`property-entry.tsx`) | 할 일 | DEV_HANDOFF 2026-11-02 |
| P1 | 사용자가 말한 "토탈"의 의미 확인 → 전체 자금 계산 규칙 | 결정 필요 | DEV_HANDOFF Codex 2026-11-02 |
| P2 | 양도세·보유세 자동 계산, 후보 자동 탐색, 호가 자동 수집 | 보류 | DEV_HANDOFF(호가 수집 보류 결정) |
| — | 단지·평형 등록, 분석 히어로, 갈아타기 대시보드 | 검수 대기 | §0 PROPERTY-MARKET-INPUT·ANALYSIS-HERO·MOVE |

## 6. 홈·화면 공통

파일: `home.tsx`, `App.tsx`, `main.tsx`, `workbook/Workbook.tsx`, `theme.css`

| 우선 | 할 일 | 상태 | 출처 |
|---|---|---|---|
| P0 | 워크북에서 리밸런싱 탭을 연 채 새로고침하면 `#rebalance` 주소 때문에 카드형으로 바뀜(`main.tsx` CLASSIC 목록과 워크북 해시 충돌, 자산도 같은 구조) | 확인 필요 | UX_REVIEW P0 |
| P1 | 홈 순서: 인사·기준일 → 은퇴 계획 요약(부족 기간) → 지금 할 일 하나 → 순자산 요약 → 최근 기록. 알림과 월 체크리스트를 "이번 점검" 하나로 | 할 일 | UX_REVIEW §홈 |
| P1 | 엑셀 보기·카드 보기를 같은 일의 두 보기로 — 전환해도 사람·계좌·가정·작업 단계 유지 | 할 일 | UX_REVIEW §두 보기 |
| P1 | 모바일: 은퇴 표 가로 이동 없이 요약·세로 입력, 카드형 "엑셀 보기로" 버튼이 하단 탭과 겹침 | 할 일 | UX_REVIEW P1·§모바일 |
| P2 | 예전 화면을 새 화면 표준(Tailwind+shadcn)으로 옮기기 | 할 일 | §0 UI-02 |
| P2 | 메뉴 정리: 홈 / 자산 / 연금 / 주식 / 부동산 (+설정) | 할 일 | AGENT_DESIGN §2, DECISIONS 2026-11-02 |
| P2 | 자산군 묶음에 그 색의 옅은 바탕 음영 | 할 일 | SCREEN_REFERENCE 사용자 요청 |
| — | 홈 컨셉·첫 자산 등록 흐름 | 검수 대기 | §0 UI-01·UX-01 |

## 7. Agent (대화)

파일: `agent/*`, `tools/`(Agent 도구), `tests/test_agent*`

| 우선 | 할 일 | 상태 | 출처 |
|---|---|---|---|
| P2 | 화면의 주문표 옆 "왜 지금"에서 Agent로 — 이 결과의 이유·지난 보류 사유·추가 입력 안내 (설정·금액 확인·결정 기록 화면을 대신하지 않음) | 할 일 | UX_REVIEW §리밸런싱 |
| P2 | single-agent 이해 → 어디부터 sub-agent로 나눌지 (스터디) | 할 일 | AGENT_DESIGN §0 |

## 8. 리서치·규칙 (위키)

파일: `docs/wiki/`, `docs/*_RULES.md` — 절차는 `/wiki-research`

| 우선 | 할 일 | 상태 | 출처 |
|---|---|---|---|
| P1 | 김성일 (A)/(B)/(C) 후보 중 사용자 확인 | 결정 필요 | §0 RESEARCH-01 |
| P2 | 위키 "미확인" 항목 다시 보기 — 10개 페이지(broker-apis, pension-account-rules, tax-rules-sources, market-data-sources, 전략 3종, 종목 분류 등) | 할 일 | `docs/wiki/**` |
| P2 | KIS 연금계좌(22) 조회 TR·주문 수용 여부 — 실계좌 소액 확인만 가능 | 보류(2027 계좌 개설) | wiki broker-apis |
| P2 | IRP 코드 설계 2건 | 보류(IRP 단계) | DECISIONS 2026-10-26 |

## 9. 부부 공유·운영

| 우선 | 할 일 | 상태 | 출처 |
|---|---|---|---|
| 후속 | 부부 인증·가구/계좌 권한·세션·HTTPS·복구 (구글 로그인으로 사용자 구분, 가구 ID) | 보류(사용 범위 확인 필요) | §0 SHARE-01, DECISIONS 2026-10-27 |

---

## 사용자 검수 대기 모음 (구현은 끝, 화면 확인만)

UI-01 홈 · UX-01 첫 등록 · REG-01 캡처 등록 · SHEET-01 구글 시트 · FLOW-01 등록→주문표→결정 · RETIRE-01 은퇴 시트 · PENSION-TOWER 연금탑 · PROPERTY-MARKET-INPUT · PROPERTY-ANALYSIS-HERO · PROPERTY-MOVE
