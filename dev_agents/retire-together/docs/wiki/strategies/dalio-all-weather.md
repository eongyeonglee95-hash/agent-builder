# 레이 달리오 올웨더(All Weather) — 원형의 투자 룰
기준일: 2026-10-27 · 상태: 초안

## 요약 (5줄 이내)
- "올웨더"는 두 가지가 섞여 불린다. ① Bridgewater가 1996년부터 운용하는 원래 **All Weather**(리스크 패리티, 레버리지 사용, 비율 비공개·가변) ② 달리오가 Tony Robbins 책 『Money: Master the Game』(2014) 인터뷰에서 개인용으로 단순화해 준 **All Seasons**(레버리지 없음, 고정 비율 30/40/15/7.5/7.5).
- `rules/strategies.yaml`의 `all_weather` 숫자(stock 30 / long_bond 40 / mid_bond 15 / gold 7.5 / commodity 7.5)는 ②All Seasons다. (2026-10-27 사용자 결정: YAML은 시그널스노우볼 앱 "해외 올웨더" 30/40/15/8/7 — 금·원자재만 반올림. 사유는 docs/DECISIONS.md) Robbins 공식 사이트에서 확인됨 ([출처 R1](#출처-열어본-페이지만-날짜)).
- 채권 정의도 Robbins 사이트 기준: 중기채 = 미국 국채 7~10년, 장기채 = 미국 국채 20~25년 ([R1](#출처-열어본-페이지만-날짜)).
- 리밸런싱: Robbins 사이트는 "최소 연 1회, 원래 비율로 되돌림"이라고 쓴다. 밴드(±n%p) 규칙은 1차 출처에서 **미확인**. `threshold_pp: 5`는 우리 가정값이다.
- 달리오의 이유: 경제 환경을 성장·물가 각각의 상승/하락 4가지로 나누고, 어느 환경이 올지 맞히지 않고 4개 환경에 **리스크를 균등**하게 배분한다 ([B1](#출처-열어본-페이지만-날짜)).

## 룰 — 저자가 정한 것

### 자산군과 비율

**(A) All Seasons — Robbins 책 버전 (개인 투자자용, 레버리지 없음)** — 출처 [R1]

| YAML 키 | 자산군 (Robbins 사이트 서술) | 비율 |
|---|---|---|
| stock | 미국 주식 (예: S&P 500 등 지수) | 30% |
| long_bond | 미국 장기 국채, 20~25년 만기 | 40% |
| mid_bond | 미국 중기 국채, 7~10년 만기 | 15% |
| gold | 금 | 7.5% |
| commodity | 원자재 | 7.5% |
| cash | (언급 없음) | 0% |

- 합계 100. 채권 55%, 금·원자재 15%.
- Robbins 사이트는 이 비율이 달리오와의 3시간 인터뷰에서 나온 것이고, 달리오가 레버리지 없이 실행할 수 있도록 단순화한 버전이라고 서술한다 [R1].
- 같은 페이지는 금·원자재를 넣는 이유를 "급격한 인플레이션 국면에서는 주식과 채권이 함께 손실을 볼 수 있어서"라고 적는다 [R1].
- 비율의 **원문(책 본문)** 은 열어보지 못했다 → "책 확인 필요" (『Money: Master the Game』 Section 5, 달리오 인터뷰 장).
- 2차 자료(CNBC 2018, Validea 등)는 열지 못했거나 비율이 서로 다르게 적혀 있어(금·원자재 5%씩, 금 대신 REITs 등) 인용하지 않는다.

**(B) Bridgewater 원래 All Weather (기관용, 리스크 패리티, 레버리지 사용)** — 출처 [B1][B2][B3]

- 고정 비율표가 **없다**. 4개 경제 환경 각각에 "같은 리스크"를 갖는 포트폴리오를 들고 있는 구조이며, 자산별 금액 비율은 리스크 추정에 따라 달라진다 [B1].
- 레버리지는 구현 도구다. Bridgewater 2004년 글은 저위험 자산(채권)을 레버리지해 주식과 같은 리스크 수준으로 맞추는 것을 "Leverage is the asset class equalizer."라고 쓴다 [B2].
- 공개 상품의 실제 노출(참고): SPDR Bridgewater All Weather ETF(ALLW, 2025-03-05 설정)는 2026-10-22 기준 글로벌 명목채 70.14% / 글로벌 주식 42.22% / 물가연동채 41.66% / 원자재 32.18%로, 합이 100%를 넘고(파생상품으로 레버리지), 목표 변동성 연 10~12%를 둔다 [B3]. 금은 별도 항목이 아니다.
- **A와 B의 차이 정리**: ① B는 레버리지·물가연동채를 쓰고 비율이 가변, A는 무레버리지 고정 비율 ② A에만 금 7.5%가 따로 있고 물가연동채가 없다 ③ B는 "리스크 25%씩", A는 그것을 금액 비율로 근사한 것이라고 Robbins 사이트가 설명한다 [R1].

### 리밸런싱 주기·임계치

| 항목 | 확인 내용 | 출처 |
|---|---|---|
| 주기 | "최소 연 1회" 리밸런싱. 비중이 커진 자산을 일부 팔아 원래 비율로 되돌린다 | [R1] |
| 밴드(임계치) | **미확인**. Robbins 사이트·Bridgewater 글 모두 ±n%p 규칙을 쓰지 않는다 | — |
| Bridgewater 운용 | 1996년 초기에는 "누군가의 파트타임 일로 가끔 리밸런싱"했다고만 서술. 주기 숫자 없음 | [B1] |
| ALLW ETF | Bridgewater가 **일일** 모델 포트폴리오를 제공하고 그에 맞춰 매매. 개인 투자자 규칙으로 쓰기엔 다른 성격 | [B3] |

- 책 본문에 "연 1회" 또는 다른 주기가 적혀 있는지는 "책 확인 필요".

### 적용 계좌·상품 (한국 연금계좌 구현 사례, 사실만)

제도 사실:
- 금융위원회 2017-11-21 보도자료: 연금저축계좌로 ETF 투자가 가능하되, "인버스·레버리지 ETF는 연금저축펀드 편입대상에서 제외" [K1].
- 미래에셋 TIGER 연금 안내(2026-10-26 열람): 개인연금(연금저축)은 레버리지/인버스 불가, **선물형 ETF 가능**, 위험자산 한도 없음. 퇴직연금(DC/IRP)은 선물형 ETF 불가, 위험자산 최대 70% [K2].

국내 상장 ETF로 각 자산군을 대체하는 사례(운용사 공식 페이지에서 확인된 것만, 추천 아님):
- **장기채(20~25년)**: 국내 상장 "미국30년국채" ETF들이 있다. 예: TIGER 미국30년국채스트립액티브(합성H) 458250, 기초지수 ICE BofA Long US Treasury Principal STRIPS Index, 태그 "개인연금 퇴직연금 100%" [K5]. 다른 운용사(ACE 453850, KODEX)도 같은 유형을 내놓았으나 상품 페이지가 로드되지 않아 세부 미확인. 원형의 "20~25년"과 달리 국내 상품은 대체로 잔존만기 20년 이상 지수를 쓴다(ACE 453850 검색 요약 기준, 페이지 본문 미확인).
- **금**: TIGER KRX금현물 0072R0(기초지수 KRX 금현물지수, 총보수 연 0.15%, 2025-06-24 상장)은 미래에셋 안내에서 개인연금 100% / 퇴직연금 70% [K3][K4]. 금선물(H) 계열은 개인연금 100% / 퇴직연금 불가 [K3].
- **원자재**: 개인연금에서는 TIGER 원유선물Enhanced(H) 130680, 농산물선물Enhanced(H) 137610, 금은선물(H) 139320 등 선물형이 100% 가능으로 표시, 퇴직연금은 불가 [K3]. 원형의 "원자재 바스켓"에 해당하는 광범위 원자재 지수 ETF가 연금저축에서 가능한지는 **미확인**.
- **과거 국내 구현 사례(언론)**: 머니투데이 2019-12-19 기사는 올웨더를 국내 ETF로 "TIGER 200 30% / KOSEF 국고채10년 40% / KINDEX 중기국고채 15% / KODEX 골드선물 15%"로 재구성한 예를 싣고, 원자재 ETF 고르기 어려워 금에 15%를 몰았다고 쓴다(기사 작성자 구성, 미국 국채 대신 한국 국채 사용) [K6]. 사실 서술일 뿐 우리 매핑과는 다르다.

### 저자가 말하는 이유
- **4계절**: 자산 가격을 움직이는 큰 힘은 성장과 물가이고, 각각이 기대 대비 상승/하락하는 네 환경이 있다. 어느 환경이 올지는 알 수 없으므로 네 환경 모두에 대비한다 [B1][R1].
- **환경별 자산** (Bridgewater 글 본문 기준): 성장 상승 → 주식, 성장 하락(디스인플레이션 침체) → 명목 국채, 물가 상승 → 원자재·물가연동채, 긴축기 → 현금이 상대적으로 유리하다고 서술 [B1].
- **리스크 균형**: 전통적 60/40은 금액은 균형이지만 리스크의 대부분이 주식에 있다(주식은 채권보다 변동성이 약 3배) — 그래서 금액이 아니라 리스크를 25%씩 나눈다 [B2][R1]. 그 결과가 채권 55%라는 큰 금액 비중이다.
- **목표**: 수익 극대화가 아니라 손실 최소화. 달리오는 모든 자산이 장기적으로 리스크 프리미엄만큼 오르므로, 환경 노출을 서로 상쇄시키고 프리미엄만 거두는 구조라고 설명한다 [B1][R1].

## 우리 적용 — strategies.yaml 후보 값 (사용자 확인 전)

```yaml
all_weather:
  name: 올웨더(달리오 원형 — Robbins 'All Seasons' 무레버리지 버전)
  targets:
    stock: 30        # 미국 주식 지수 (S&P 500 등). 원형은 미국 주식만 언급
    long_bond: 40    # 미국 국채 20~25년. 국내 대체 상품은 잔존만기 20년 이상 지수가 대부분
    mid_bond: 15     # 미국 국채 7~10년
    gold: 7.5        # 금
    commodity: 7.5   # 원자재(바스켓). 국내 연금저축에서 가능한 광범위 원자재 ETF는 미확인
  threshold_pp: 5    # 원형에 밴드 규칙 없음 → 우리 가정값 (출처 없음, 미확인)
  rebalance_cycle: yearly   # Robbins 사이트 "최소 연 1회" 기준. 키 이름은 사용자 결정
  source: "https://www.tonyrobbins.com/blog/the-end-of-the-bull-market"
```

- 현재 YAML 값과 비율은 **일치**. 바꿀 숫자 없음.
- 다른 점은 숫자가 아니라 정의다: long_bond/mid_bond를 "미국 국채 20~25년 / 7~10년"으로 명시할지, 그리고 cash 0%를 명시할지.
- `threshold_pp: 5`는 출처가 없으므로 주석에 "가정"이라고 적는 것을 제안.

## 미확인 · 열린 질문
1. **책 본문 확인 필요**: 『Money: Master the Game』(2014) 달리오 인터뷰 장의 정확한 비율·채권 만기·리밸런싱 문구. 현재는 Robbins 공식 사이트 글로 대체.
2. **밴드 임계치**: 원형에는 없다. ±5%p는 우리 가정. 연 1회 고정일 리밸런싱으로 갈지, 밴드로 갈지는 사용자 결정(REBALANCING_RULES.md).
3. **장기채 만기 불일치**: 원형 20~25년 vs 국내 상장 미국30년국채 ETF(20년 이상/STRIPS). 듀레이션이 더 길 수 있다는 점을 매핑 주석에 남길지.
4. **원자재 7.5%의 국내 대체**: 광범위 원자재 지수(S&P GSCI 전체 등) ETF가 연금저축에서 가능한지, 원유·농산물 단품 선물 ETF로 쪼갤지, 금에 합칠지(2019 기사 사례처럼) — 사용자 결정.
5. **환헤지**: 원형은 미국 투자자 기준(달러). 국내 상품은 (H) 헤지형/비헤지형이 갈린다. 원형에 환 규정은 없음.
6. **Bridgewater 원래 All Weather의 비율**은 공개된 고정값이 없다. "원형"이라는 이름을 YAML에 쓸 때 All Seasons라고 적는 게 정확.
7. CNBC 2018-12-11 기사, Validea 글, Dalio 본인 LinkedIn/Principles 글: 2026-10-27 재시도, 미확인. CNBC는 URL 두 가지(heres-ray-dalios-all-weather-portfolio, ray-dalio-this-investment-strategy-is-good-in-a-financial-crisis) 모두 403, Validea 지정 URL은 Page Not Found, 아카이브 도메인은 도구에서 차단. LinkedIn·Principles 사이트의 All Weather 설명 글은 검색에 나오지 않음. 값 변경 없음(비율은 [R1] 그대로).

## 출처 (열어본 페이지만, 날짜)

Bridgewater / 공식 상품
- [B1] Bridgewater Associates, "The All Weather Story" (2012-01), https://www.bridgewater.com/research-and-insights/the-all-weather-story — 2026-10-26 열람
- [B2] Greg Jensen, Jason Rotenberg (Bridgewater), "The Biggest Mistake in Investing" (2004-08-18), https://www.bridgewater.com/research-and-insights/the-biggest-mistake-in-investing — 2026-10-26 열람
- [B3] State Street, "SPDR Bridgewater All Weather ETF (ALLW)" 상품 페이지(노출 비율 2026-10-22 기준), https://www.ssga.com/us/en/intermediary/etfs/spdr-bridgewater-all-weather-etf-allw — 2026-10-26 열람

Robbins 공식
- [R1] tonyrobbins.com, "The End of the Bull Market • Ray Dalio"(게시일 표기 없음, 『Money: Master the Game』 인터뷰 기반), https://www.tonyrobbins.com/blog/the-end-of-the-bull-market — 2026-10-26 열람

한국 제도·상품
- [K1] 금융위원회 보도자료 "연금저축계좌를 통해 수수료가 낮고 장기투자에 적합한 ETF 투자가 가능해집니다"(2017-11-21), https://www.fsc.go.kr/no010101/72906 — 2026-10-26 열람
- [K2] 미래에셋자산운용 TIGER ETF, 연금 투자 가능 ETF 안내, https://investments.miraeasset.com/tigeretf/ko/pension/investment/list.do — 2026-10-26 열람
- [K3] 미래에셋자산운용 TIGER ETF, 연금 투자 가능 목록 — 원자재/부동산(리츠)/통화, https://investments.miraeasset.com/tigeretf/ko/pension/commodities-investment-currencies/list.do — 2026-10-26 열람
- [K4] 미래에셋자산운용, "TIGER KRX금현물 ETF 상장"(2025-06-20), https://investments.miraeasset.com/tigeretf/ko/insight/etf-insight/view.do?detailsKey=564 및 상품 페이지 https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR70072R0006 — 2026-10-26 열람
- [K5] 미래에셋자산운용, TIGER 미국30년국채스트립액티브(합성H) 상품 페이지, https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR7458250008 — 2026-10-26 열람
- [K6] 머니투데이, 김재현, "'최대 17%'…노후자금 수익률 높이는 3가지 방법"(2019-12-19), https://www.mt.co.kr/stock/2019/12/19/2019121813473480737 — 2026-10-26 열람 (언론 기사, 구현 사례로만)

열어봤으나 내용 확인 못함(출처로 쓰지 않음): ACE 미국30년국채액티브(H) 453850 상품 페이지(데이터 미로드), KODEX 미국30년국채액티브(H) 상품 페이지(데이터 미로드), CNBC 2018-12-11(403), validea.com(리다이렉트 후 내용 없음), 삼성자산운용 "연금, Kodex하다" 2026-1Q PDF(텍스트 추출 실패).

## 변경 이력
- 2026-10-27: 후속 조사 — CNBC·Validea·아카이브·Dalio 본인 글 재시도, 모두 미확인. 본문·값 변경 없음
- 2026-10-26: 초기 작성
