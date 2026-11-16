# AGENT_DESIGN — Agent 역할·워크플로우

최종 갱신: 2026-11-16 · 옛 실행 계획(§0)·PoC 이력(§2)은 `archive/AGENT_HISTORY.md`

## 구조 원칙
"겉으로는 Agent 하나, 안에서는 여러 역할과 도구로 분리."
- 사용자에게는 "연금 재배분 Agent" 하나로 보인다
- 내부는 메인 Agent 1개 + deterministic tools 여러 개. 멀티 에이전트는 첫 PoC에서 쓰지 않는다
- 기능이 커지면 일부 역할을 sub-agent로 승격. 단, 계산은 끝까지 코드 함수/룰 엔진 — LLM이 비중을 계산하는 구조는 신뢰성이 떨어진다
- 책임 분리: 숫자 → 코드/DB, 규칙 → wiki, 판단 조건 → deterministic logic, 설명/대화/기억 → Agent
- 스터디 관점: single-agent architecture를 먼저 이해하고, 그다음 "어디부터 sub-agent로 분리할지"를 학습

## 1. 첫 Agent 정의 (고정)
### Pension Rebalancing Agent
사용자가 정한 전략과 규칙을 기억하고, 새 잔고가 들어오면 현재 비중을 계산해 목표 비중과 비교하고, 재배분이 필요하면 매수·매도 수량을 산출하고, 왜 필요한지 설명하며, 사용자의 수락/거절을 다음 판단에 반영한다.

### 내부 역할 (PoC에서는 전부 tool, 추후 승격 후보)
| 역할 | PoC 형태 | 하는 일 | 승격 시점 |
|---|---|---|---|
| Input | tool `parse_balance` / `fetch_prices` | 캡처 이미지/CSV/시트 → 보유 내역(종목·수량·매입금액, 1회 등록) / 종목코드로 현재가 조회(공개 시세, 매번) | 입력 소스가 5개 이상, 오류 처리가 대화형이 되어야 할 때 |
| Tagging | tool `tag_assets` | 종목 → 자산군(주식·장기채·중기채·금·원자재·현금 등) + 계좌 태그(주머니/층/세제구분/레거시). 매핑표 우선, 없으면 LLM 분류 후 사용자 확인 | 신규 종목 분류 정확도가 문제될 때 |
| Strategy | tool `load_strategy` | 사용자가 선택한 전략의 목표 비율·임계치를 wiki/DB에서 로드 | (승격 불필요, 순수 조회) |
| Rebalancing Engine | tool `compute_rebalance` (순수 함수) | 현재 비중 계산, 목표와 비교, 발동 여부, 매수·매도 금액·수량 산출, 제도 제약 검증 | 절대 승격하지 않음 — 항상 코드 |
| Explanation | Agent 본체 (+ tool `explain_inputs`) | 편차·가정 하락장 손실 비교 수치를 받아 "왜 지금" 한 문단 생성 | 설명이 개인화·대화형으로 깊어질 때 |
| Action | tool `build_order_sheet` | 주문표(계좌·종목·매수/매도·수량·예상금액) 생성. 2단계에서 MCP/KIS API 실행 연결 | 자동주문 Level 1 이상 |
| Memory | tool `record_decision` / `read_decisions` | 수락/거절/사유를 DECISIONS.md(또는 DB)에 기록·조회 | — |

### 워크플로우 (한 바퀴)
0. 계좌 선택: 소유자(나/배우자) · 증권사 · 계좌 종류(연금저축/IRP/ISA/일반) + **풀**(합산할지 따로 갈지)과 풀의 **전략·모드**(리밸런싱 / 매수만). 처음 로그인 때 고르고 설정에서 바꾼다 (SCREEN_REFERENCE "계좌 묶기"). 목록은 `rules/accounts.yaml`. 모든 잔고 행은 이 세 칸을 달고 다닌다 (나중에 IRP·배우자 계좌 합산 시 구조를 안 바꾸기 위해). PoC는 설정 파일 고정, 로그인·가족 초대는 v1.5
1. 사용자: 그 계좌의 잔고 캡처 또는 CSV 투입 (+ "리밸런싱 봐줘")
2. `parse_balance` → 표
3. `tag_assets` → 자산군·계좌 태그 (미확정 항목은 사용자 확인)
4. `load_strategy` → 목표 비율·임계치·제약
5. `compute_rebalance` → 현재 비중, 편차, 발동 여부, 주문 금액·수량, 제약 검증 결과
6. 발동 시 `build_order_sheet` → 주문표 / 미발동 시 "이번엔 안 해도 됨" + 편차 현황
7. Agent: `explain_inputs` 수치로 "왜" 설명 작성, `read_decisions`로 지난 거절 사유 반영
8. 사용자 수락/거절/보류 + 사유 → `record_decision`
9. (2단계) 승인 시 KIS API 실행 → 로그

### `compute_rebalance` 출력 (화면·설명·주문표가 공유하는 데이터 계약)
목업 `docs/assets/mockup-rebalancing.html`의 각 영역이 그대로 이 구조에서 나온다. 1주차에 이 구조를 먼저 고정한다.
- `account`: 소유자·증권사·계좌종류, 잔고 기준일
- `strategy`: 전략 id·이름, 임계치, 최소 거래 금액
- `total_value`, `new_cash`(신규 납입)
- `classes[]`: 자산군별 목표 비중 t_i, 현재 비중 w_i, 편차 d_i(%p), 평가액, 발동 여부
- `triggered`: 하나라도 임계치를 넘었는지
- `constraints[]`: 제도 검증 항목(연금저축 ETF 적격, 레버리지·인버스 없음, IRP 70% 등)과 통과 여부. 하나라도 실패하면 주문표 없음 + 사유
- `orders[]`: 구분(매도/매수/생략) · 자산군 · 종목 · 수량 · 예상 금액 · 비고(편차, 납입금 포함, 생략 사유). 매도 먼저
- `explain_inputs`: L_now, L_target, 차이, 편차 최대 자산군, 과세이연 여부
- `last_decisions[]`: 같은 자산군에 대한 지난 수락/거절/보류와 사유

## 2. 향후 Agent 로드맵 (참고)
- 2단계: Action tool → KIS API MCP 서버, 승인형 자동주문
- 3단계: Pension Payout Simulator(4층 수령액), Tax Planner(수령 순서·1,500 기준선·브릿지)
- 4단계: Property Follow Agent(시세·뉴스·필요 자금 역산), Curator Agent(위키 갱신)
