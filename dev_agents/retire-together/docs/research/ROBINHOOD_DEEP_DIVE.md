# Robinhood 심층 조사 — 둘이서은퇴에 가져올 것

조사일: 2026-10-28 · 범위: 보유·포트폴리오 화면, 가족 기능, AI 요약, 리밸런싱, 디자인 원칙 · 원칙: 공식 도움말·발표·공시를 우선, 글로 확인한 것만 적는다. 화면 이미지는 보지 못했다. 이전 조사: `STOCK_APPS_REFERENCE.md` §1.

## 한 줄 요약

Robinhood는 2026년 들어 "거래 앱"에서 "가족 자산 관리 앱"으로 방향을 넓히고 있다(가족 허브, 다른 증권사 계좌 통합, 운용형 계좌의 성과 설명). 우리에게 가장 쓸모 있는 것은 네 가지다. 종목의 '내 보유' 여섯 칸, 계좌 통합 화면의 "잔고 변화는 수익이 아니다"라는 구분, 포트폴리오 요약의 네 칸 구조, 가족 허브의 권한 모델.

---

## 1. 보유·종목 화면

**종목 상세 순서** (지원 문서 "Viewing stock details", 날짜 표기 없음, 2026-10 열람)
차트(1일~5년, 눌러서 그 시점 값) → **Position(내 보유)** → 정기 투자 → 회사 소개 → 지표 → 변동성 → 뉴스 → 애널리스트 의견 → 공매도 → 매매 동향 → 재무 → 실적(예상 EPS vs 실제 EPS) → 관련 목록 → 함께 보유한 종목("추천이 아님" 명시) → 내 매매 내역.

**Position 여섯 칸** (보유했을 때만 나타남)
| 칸 | 뜻 |
|---|---|
| Shares | 보유 수량 |
| Market value | 평가금액 |
| Average cost | 1주 평균 매입가 |
| Portfolio diversity | 내 포트폴리오에서 이 종목 비중 |
| Today's return | 오늘 손익 (주식은 그 거래일 기준) |
| Total return | 보유 시작 후 손익, 지금 판다고 가정 |

- 평균단가는 "참고용 추정치, 세금 계산에 쓰지 말라". 원가를 모르면 `N/A`, 처리 중이면 `-`. — 지원 문서 "Crypto average cost"
- 홈 보유 목록 한 줄의 배치와 정렬 방식은 공식 문서에서 확인 못 함.

## 2. 계좌 통합 — Portfolio Overview (2026-03 전 고객 출시)

- 다른 증권사·은퇴·암호화폐 계좌를 연결해 Robinhood 계좌와 함께 본다. 보여 주는 것: 전체 보유 합계, 자산 종류별 배분(현금·주식·ETF·펀드 등), 연결 계좌별 금액. 연결은 Plaid가 처리하고 자격 증명은 Robinhood가 보지 않는다. 외부 계좌는 하루 한 번 갱신. — 지원 "Portfolio Overview"
- **중요한 구분:** 이 화면의 차트는 "전체 잔고의 변화이며 입금·출금이 섞여 있고, 투자 수익을 나타내지 않는다"고 명시한다. — 같은 문서. 2020년 포트폴리오 화면 개편 때도 "수익률은 순투자금 기준이라 입출금에 영향받지 않는다"고 설명했다. — Benzinga 2020-10
- 2025 디자인 비평(Pratt Institute 학생 비평): 포트폴리오 화면에 자산 배분 표시가 없어 분산 정도를 판단하려면 화면을 떠나야 한다, 기간 직접 지정이 없다. 제안은 펼치는 배분 원형 차트. 공식 변경 아님.

## 3. 가족 — Robinhood for Families (2026-03-04 발표)

- **가족 허브**(올해 안 출시 예정): 가족 구성원별로 계좌를 묶어 한 화면에 보여 준다. 다른 성인을 초대해 **어떤 계좌를 보게 할지 고르고, 권한을 '보기만'부터 '전권'까지** 정한다.
- 자녀 명의 계좌(즉시), 신탁 계좌(올해 안). 운용형(Strategies) 계좌에 **Returns hub**: 시간에 따른 성과, **무엇이 결과를 만들었나**, 기준 지수 비교, 장기 맥락.
- 부부 공동 계좌, 배우자 전용 기능, 목표 설정, AI 비서는 이 발표에 없다. — newsroom "Take Flight"

## 4. AI 요약 — Cortex Digests (Gold 회원, 2025 여름부터 순차)

- **Portfolio Digest 네 칸:** 시장 배경 / 내 평가액 변화에 가장 크게 기여한 종목(return drivers) / 가장 크게 움직인 종목(top movers) / 다가올 일정(실적·거시지표·촉매).
- 기준 시점: 주식은 **직전 거래일 종가 이후**. 비교선 **SPY를 보유와 상관없이 항상** 함께 그린다. 차트에서 내 포트폴리오는 "You".
- 재료: 시세, 속보, 리서치, 애널리스트 의견. 분할·합병 중인 종목은 잠시 빠진다. IRA(은퇴 계좌)는 제외.
- 고지: "정보 제공용, 리서치·매수매도 추천·투자 조언 아님, 정확성 보장 안 함". 사실과 해석을 화면에서 어떻게 나누는지는 문서에 없다(확인 못 함). — 지원 "Cortex Digests"

## 5. 리밸런싱 — Robinhood Strategies (운용형)

- 매일 점검, 필요하면 리밸런싱, 최소 월 1회. — NerdWallet 리뷰 2026
- 예정된 출금이 리밸런싱보다 우선(출금을 위해 매도할 수 있음). 투자 성향을 바꾸면 30일 동안 리밸런싱하지 않는다(미국 wash sale 회피). 성향을 바꾸면 계좌 검토가 시작된다. — Form ADV Part 2 공시
- 이전 계좌 옮길 때 보유·세금 단위를 검토해 "재투자 vs 세금 영향"을 비교한 선택지를 준다(2026-03). — newsroom "Take Flight"
- Robinhood 가이드가 잦은 리밸런싱을 경계하고 임계치 방식을 권한다는 기사(TheStreet)가 있으나 원문은 열람 차단으로 확인 못 함.

## 6. 디자인 원칙 (Google Design 사례 연구, 2016년경)

- 색이 상태를 말한다: 포트폴리오가 좋으면 초록 그래프, 종목은 방향에 따라 초록↔빨강. **장이 닫히면 배경이 흰색에서 어두운 회색으로** 바뀐다 — 글을 읽지 않아도 "지금 시장 상태"를 안다.
- 카드에는 적은 정보만 먼저, 누르면 깊게. 큰 숫자 하나와 그래프. 값이 바뀌면 숫자와 그래프가 움직인다.
- 오래된 자료라 현재 화면과 다를 수 있다. 미국은 상승 초록·하락 빨강이고, 우리는 한국 관례(상승 빨강·하락 파랑)를 따른다.

---

## 우리에게 적용할 것

| # | 가져올 것 | Robinhood 근거 | 우리 화면·작업 | 크기 | 주의 |
|---|---|---|---|---|---|
| 1 | **"넣은 돈"과 "불어난 돈"을 나눠 보여 주기** | Portfolio Overview: 잔고 차트는 입출금이 섞여 수익이 아니다 | 홈·우리 자산·연금: 평가금액 = 매입(납입) + 손익. 연금은 납입이 계속 들어와서 잔고가 늘어도 수익이 아닐 수 있다 | 작음(매입금액 저장은 이미 함) | 매입금액을 모르는 종목은 "모름"으로, 추정하지 않는다 |
| 2 | 종목 '내 보유' 여섯 칸 + 평균단가 모름 표시 | Position 영역 | 종목 행·주식 탭 상세. 지금 다섯 칸 있음, **오늘 손익**만 없음 | 중간(전일 종가 필요 — `tools/market` 확장) | 평균단가는 참고용, 세금 계산 아님 |
| 3 | **어제 이후 요약 네 칸** | Portfolio Digest | 주식 탭 "어제부터": 시장 배경(설명) / 내 손익 기여 상위 / 크게 움직인 종목 / 다가올 일정. 기여도·등락은 **코드가 계산**, 설명만 Agent | 큼 | 예측·추천 금지, "사실 / 해석" 칸을 나눠 Robinhood보다 한 걸음 더 |
| 4 | 비교선 하나를 항상 같이 | Digest의 SPY 상시 비교 | 연금 성과 옆에 **우리 전략 목표 비율 그대로 굴렸을 때** 또는 KOSPI200·S&P500 | 중간 | 비교선 선택은 사용자 결정 |
| 5 | **가족 권한: 계좌별로 보기만 / 수정 가능** | 가족 허브 초대·권한 | SHARE-01 부부 공유 설계: 배우자 초대 → 계좌별 공개 범위 → 보기만/편집 | 큼(로그인 필요) | 지금은 로컬, 구글 로그인 뒤 |
| 6 | 결과를 만든 원인 설명 | Strategies Returns hub "what drove results" | 리밸런싱 "왜 지금" 문단과 결정 기록 화면 | 중간 | 숫자는 엔진, 문장은 Agent |
| 7 | 오래된 자료는 색으로 | 장 마감 시 회색 배경 | 계좌 기준일이 오래되면(예: 30일) 그 계좌 카드를 회색 처리하고 "다시 등록" 안내 | 작음 | 기준은 `rules/`에 |
| 8 | 전략 바꾼 직후 주문 제안 보류 | Strategies: 성향 변경 후 30일 리밸런싱 안 함 | 비율을 바꾼 직후 바로 매도·매수표를 내지 않고 한 번 확인 | 작음 | 미국 세금 규칙 때문이라 우리 이유는 다름 — 사용자 결정 |

가져오지 않을 것: IRA 3% 매치·조기 배당(미국 제도·회사 혜택), 매매 동향·공매도·옵션 변동성(거래용), Gold 같은 유료 구독 구조.

## 확인 못 한 것

- 홈 보유 목록 한 줄의 실제 배치·정렬, 현재 앱의 색 규칙(공식 문서 없음, 디자인 사례는 2016년경).
- Strategies가 리밸런싱 매매를 고객에게 어떻게 설명하는지(공식 도움말 못 찾음).
- 가족 허브의 실제 화면(아직 출시 전).
- Digest가 사실과 AI 해석을 화면에서 구분하는지.

## 출처

- 종목 상세: https://robinhood.com/support/articles/360001380846/viewing-stock-detail-pages/
- 평균단가: https://robinhood.com/us/en/support/articles/crypto-average-cost/
- Cortex Digests: https://www.robinhood.com/us/en/support/articles/cortex-digests
- Portfolio Overview: https://robinhood.com/us/en/support/articles/portfolio-overview/
- 가족·Strategies·계좌 통합 발표(2026-03-04): https://robinhood.com/newsroom/robinhood-unveils-the-future-of-family-finance-at-robinhood-presents-take-flight/
- Strategies 공시(Form ADV Part 2): https://cdn.robinhood.com/assets/robinhood/legal/RAM_Brochure_and_Brochure_Supplements.pdf
- Strategies 리뷰(NerdWallet 2026): https://www.nerdwallet.com/investing/reviews/robinhood-strategies
- 수익률 계산 변경(Benzinga 2020-10): https://benzinga.com/fintech/20/10/18135227/robinhood-makes-it-easier-for-investors-to-track-performance-with-new-display
- 디자인 사례(Google Design, 2016년경): https://design.google/library/robinhood-investing-material
- 디자인 비평(Pratt, 2025-02): https://ixd.prattsi.org/2025/02/design-critique-robinhood-ios-app/
- HOOD Summit 2025: https://robinhood.com/newsroom/hood-summit-2025-news/

## 적용 결과 (2026-10-28)

| # | 상태 | 어디에 |
|---|---|---|
| 1 넣은 돈 / 불어난 돈 | 적용 | 우리 자산·주식의 '종목 잔고' 패널. 매입금액 아는 종목만, 모르면 "매입 모름". 홈 카드는 아직(Codex 화면, DEV_HANDOFF에 계약) |
| 2 내 보유 여섯 칸 + 오늘 손익 | 적용 | 종목 행: 수량·평균단가·평가금액·매입·총 손익·수익률·비중, "현재가로 보기"를 켜면 오늘 손익·등락률 |
| 3 어제 이후 요약 | 일부 | 손익 기여 상위·크게 움직인 종목(시세 사실). 시장 배경·다가올 일정은 뉴스 연결 뒤 |
| 4 비교선 | 못 함 | 가격 이력(일별 평가액)이 없다. 잔고를 날짜별로 쌓고 시세 이력을 받은 뒤 |
| 5 부부 권한 | 설계만 | 로그인(SHARE-01) 뒤 |
| 6 결과 원인 설명 | 다음 | 리밸런싱 '왜 지금'(Agent) 작업 때 |
| 7 오래된 잔고 회색 | 적용 | `rules/holdings.yaml` stale_days(기본 31일) 넘으면 계좌·종목 회색 + 다시 등록 |
| 8 전략 변경 직후 보류 | 사용자 결정 대기 | — |
| 추가: 정렬 옵션 | 적용 | Robinhood 'Sort by'와 같은 항목(평가금액·오늘 손익·오늘 등락률·총 손익·수익률·이름) |
| 추가: 입출금은 수익 아님 | 적용(문구·계산) | Robinhood 'Using charts': 입출금 제외, Modified Dietz 영향 — 우리는 기간 수익률 대신 매입 대비 손익만 계산 |

추가 출처: 'Using charts' https://robinhood.com/us/en/support/articles/using-charts/ · 'Investing tools' https://robinhood.com/us/en/support/articles/investing-tools/ · 'About Robinhood Strategies' https://robinhood.com/us/en/support/articles/about-strategies/ · 'Strategies FAQ' https://robinhood.com/us/en/support/articles/strategies-faq/

