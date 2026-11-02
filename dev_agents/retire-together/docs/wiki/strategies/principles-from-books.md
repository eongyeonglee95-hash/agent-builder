# 책에서 배운 리밸런싱 원칙 — "왜 지금" 설명 재료
기준일: 2026-10-26 · 상태: 초안

용도: `docs/REBALANCING_RULES.md` §4의 설명 재료 후보. §4에 이미 있는 네 가지(위험 수준 유지 / 비율 무너지면 하락장 손실 커짐 / 리밸런싱 보너스 / 연금계좌는 과세이연)에 **더할** 원칙만 적는다. Agent는 이 재료를 요약해 쓰되 예측·추천 문장은 만들지 않는다. 어느 원칙을 §4에 넣을지는 사용자가 정한다.

## 원칙 목록

### 1. 리밸런싱의 목적은 수익이 아니라 목표 배분 대비 위험을 줄이는 것
- 누가·어디서: Vanguard 리서치 (Jaconetti·Kinniry·Zilbering), 「Best practices for portfolio rebalancing」 2010-07 (AAII Journal 2011-05 재수록)
- 요지: 자산군 수익이 달라지면 배분이 처음 정한 것에서 멀어지므로, 원래의 위험·수익 특성을 되찾기 위해 되돌린다. 1926~2009 미국 주식·채권 데이터로 월/분기/연 리밸런싱을 비교했을 때 위험조정수익은 의미 있게 다르지 않았고, 한 번도 안 한 60/40은 주식 84% 이상으로 흘러갔다.
- 숫자: 결론 문장은 "연 1회 또는 반기 점검 + 5%p 임계치"가 위험 통제와 비용 사이의 합리적 균형. 세금·비용이 크면 연 1회 선호.
- 출처: https://indexacapital.com/bundles/unaiadvisor/docs/papers/2010-Vanguard-Best-practices-for-portfolio-rebalancing.pdf (원문 PDF 미러), https://aaii.com/journal/article/best-practices-for-portfolio-rebalancing
- 제품 연결: 우리 기본 ±5%p가 이 결론과 같은 숫자. 설명문에 "흔히 쓰는 기준"으로 붙일 수 있음.

### 2. 새 돈(납입·분배금)으로 먼저 맞추면 비용 없이 위험 통제 효과 대부분을 얻는다
- 누가·어디서: Vanguard 같은 논문, "Rebalance with portfolio cash flows" 절
- 요지: 배당·이자·신규 납입을 가장 부족한 자산군에 넣는 방식이 위험 통제 효과를 대부분 가져가면서 거래 비용을 줄였다.
- 출처: 위 1과 같음
- 제품 연결: `REBALANCING_RULES.md` §2 "신규 납입이 있으면 매도 없이 매수만으로 맞추는 안 먼저"의 근거.

### 3. 리밸런싱 보너스는 변동성 크고 상관 낮은 자산 쌍에서 크고, 크기는 연 0.5%p 안팎
- 누가·어디서: William Bernstein, 「The Rebalancing Bonus: Theory and Practice」 (efficientfrontier.com, 1996)
- 요지: 되돌림으로 얻는 초과수익은 두 자산의 분산 평균에서 공분산을 뺀 만큼에 비례한다. 1926~94 미국 주식·장기채 연 1회 리밸런싱 예시에서 8.34% vs 7.85%(가중평균) → 0.49%p. 주기는 월·분기·연 중 어느 것도 일관되게 우세하지 않음.
- 출처: http://www.efficientfrontier.com/ef/996/rebal.htm
- 제품 연결: §4의 "리밸런싱 보너스"에 **크기 감각**(작다)과 조건(상관 낮은 자산)을 붙이는 재료. 과장 방지용.

### 4. 경제의 네 계절에 위험을 똑같이 나눈다 — 예측하지 않기 위해
- 누가·어디서: Bridgewater Associates, 「The All Weather Story」 2012-01
- 요지: 성장·물가가 기대보다 높거나 낮은 네 국면에 같은 위험을 배분하면 어떤 깜짝 변화가 와도 한 국면이 포트폴리오를 지배하지 않는다. 투자자는 성장·물가를 신뢰성 있게 예측할 수 없다는 전제. 직접 인용(한 번): "built for surprises in general, not specific surprises".
- 출처: https://www.bridgewater.com/research-and-insights/the-all-weather-story
- 제품 연결: "왜 비율을 지키나"의 근거. 비율이 무너지면 특정 국면에 위험이 쏠린다는 설명으로 변환 가능.

### 5. 달러가 아니라 위험을 나눈다 — 주식은 채권보다 약 3배 변동
- 누가·어디서: Tony Robbins, 『Money: Master the Game』의 All Seasons 설명 (tonyrobbins.com 블로그 「The End of the Bull Market」)
- 요지: 60/40처럼 금액을 나누면 위험의 대부분이 주식에서 나와 주식이 빠질 때 전체가 빠진다. 달리오는 주식 변동성을 채권의 약 3배로 보고 네 국면에 위험을 25%씩 두도록 설계했다. 로빈스 판 All Seasons 비율은 주식 30 / 장기국채 40 / 중기국채 15 / 금 7.5 / 원자재 7.5, 리밸런싱은 "at least annually".
- 출처: https://www.tonyrobbins.com/blog/the-end-of-the-bull-market
- 제품 연결: `strategies.yaml`의 `all_weather` 비율과 같은 숫자의 출처. 설명문에 "주식 편차 5%p는 채권 5%p보다 위험 기여가 크다"는 식으로 쓸 수 있음(수치화는 CALCULATION_RULES에 맡김).

### 6. 분산의 핵심은 종목 수가 아니라 상관이 낮은 수익원의 수
- 누가·어디서: Ray Dalio, 본인 유튜브 영상(2023-04, Fortune 보도)
- 요지: 서로 상관이 낮은 좋은 투자 10~15개면 수익을 크게 줄이지 않고 위험을 최대 80%까지 줄일 수 있다고 말함. 소수 종목에 집중하는 접근은 "knock you out"(직접 인용, 한 번). 같은 주식시장 안에서 종목만 늘리는 것은 분산이 아니라는 취지.
- 출처: https://www.fortune.com/2023/04/18/chatgpt-ray-dalio-bridgewater-associates-prmopted-question-investing (영상 https://www.youtube.com/watch?v=MiM_cam7pPE 를 보도; 영상 자체는 열지 않음)
- 제품 연결: 한 자산군이 커졌을 때 "분산이 깨졌다"는 설명의 근거. 80% 숫자는 보도 인용이므로 설명문에는 숫자 없이 쓰는 편이 안전.

### 7. 시장 타이밍을 맞힐 수 없으니 규칙대로 되돌린다 — 약세장 MDD 한 자릿수가 목표
- 누가·어디서: 김성일, 주간동아 인터뷰 2022-06-25
- 요지: 상승·하락을 맞힐 수 없기 때문에 자산배분이 필요하고, 리밸런싱은 "한 달에 한 번 정도"면 적당하다고 말함. 2022년 상반기 약세장에서 K-올웨더 −4.9%(MDD 4.9%)였고, 저자는 약세장에서 MDD가 한 자릿수인 점을 의미 있게 본다. 2000-01~2021-08 백테스트 연 7.3%, MDD 8%.
- 출처: https://v.daum.net/v/EEjyPz3N25
- 제품 연결: "지금 리밸런싱하는 이유는 예측이 아니라 규칙"이라는 문장의 근거. 숫자는 K-올웨더 전략을 쓰는 풀에서만 인용.

### 8. 연금은 '행동장치' — 스스로 제약을 걸어 규칙을 지키게 한다
- 누가·어디서: 김성일, 『마법의 연금 굴리기』 개정판(2023) 2장 "연금은 내 행동장치"; 『마법의 돈 굴리기』(2017)는 "잃지 않는 것"을 첫 원칙으로
- 요지: 연금계좌의 인출 제한을 장기 투자 규칙을 지키게 하는 장치로 본다(목차 제목과 독자 밑줄 p.48 "행동장치는 원하는 결과를 얻기 위해 스스로 행동에 제약을 가하는 것"). 자세한 논지는 **책 2장 확인 필요**.
- 출처: https://m.yes24.com/Goods/Detail/123185295 (목차), https://m.yes24.com/Goods/Detail/122769876 (독자 밑줄), https://ebook-product.kyobobook.co.kr/dig/epd/ebook/E000003243097 (『마법의 돈 굴리기』 소개)
- 제품 연결: §4의 "연금계좌는 과세이연" 옆에 "연금계좌는 규칙을 지키기 쉬운 계좌"라는 재료로. Agent가 사용자 대신 규칙을 바꾸지 않는다는 제품 원칙과도 맞음.

## 출처 (열어본 페이지만, 2026-10-26 열람)
- Vanguard 2010 PDF 미러: https://indexacapital.com/bundles/unaiadvisor/docs/papers/2010-Vanguard-Best-practices-for-portfolio-rebalancing.pdf
- AAII 재수록(2011-05): https://aaii.com/journal/article/best-practices-for-portfolio-rebalancing
- Bernstein, The Rebalancing Bonus: http://www.efficientfrontier.com/ef/996/rebal.htm
- Bridgewater, The All Weather Story (2012-01): https://www.bridgewater.com/research-and-insights/the-all-weather-story
- tonyrobbins.com, The End of the Bull Market (All Seasons 설명): https://www.tonyrobbins.com/blog/the-end-of-the-bull-market
- Fortune 2023-04-18 (달리오 영상 보도): https://www.fortune.com/2023/04/18/chatgpt-ray-dalio-bridgewater-associates-prmopted-question-investing
- 주간동아 2022-06-25 김성일 인터뷰(다음 전재): https://v.daum.net/v/EEjyPz3N25
- 『마법의 연금 굴리기』 개정판 목차·밑줄: https://m.yes24.com/Goods/Detail/123185295 , https://m.yes24.com/Goods/Detail/122769876
- 『마법의 돈 굴리기』 소개: https://ebook-product.kyobobook.co.kr/dig/epd/ebook/E000003243097
- 열지 못한 것: CNBC 2018-12-11 달리오 All Seasons 기사(403), 매일경제 원문(크롤러 차단) — 인용하지 않음

## 변경 이력
- 2026-10-26: 초기 작성
