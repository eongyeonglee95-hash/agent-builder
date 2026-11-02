# 보유 9종목의 자산군 분류 근거 (미래에셋 연금저축, me_pension)
기준일: 2026-10-27 · 상태: 초안

## 요약 (5줄 이내)
- 9종목 모두 국내 상장 ETF이고 레버리지·인버스가 아니므로 연금저축 편입 제약(REBALANCING_RULES §3)에 걸리는 종목은 없다. 미래에셋 TIGER 3종은 운용사 페이지의 "개인연금·퇴직연금" 태그로 확인했고, KODEX·ACE 6종은 운용사 공식 페이지를 열지 못해 구조(국내 상장·비레버리지)로만 판단했다.
- 주식 6종: 넓은 지수(S&P500 ×2, 나스닥100)는 core, 테마·특정국(차이나휴머노이드 ×2, 인도타타그룹)은 satellite 후보. 금 2종은 모두 KRX 금현물지수를 따르는 실물형 → gold/core.
- 핵심 질문 ACE 종합채권(AA-이상)액티브: 펀드 듀레이션 4.74년, 보유채권 듀레이션 5.97년(2026-08-31), 기초지수 듀레이션 4.87년(2026-06-10). 올웨더 정의(중기채 7~10년물, 장기채 20~25년물)와 비교하면 장기채(국내 30년물 ETF 듀레이션 15~26년)와는 멀고, 중기채(10년물 ETF 듀레이션 7.3~7.8년)보다도 짧다. 듀레이션 기준으로는 mid_bond 쪽이며, 이를 중기채로 "볼지"는 사용자 결정.
- 총보수는 2026-10-23 기준 펀ETF 표시값. 주식형 넓은 지수는 0.0047~0.0068%, 테마는 0.45~0.49%, 금현물은 0.15~0.19%, 종합채권은 0.02%.

## 종목별 근거 (표 + 단락)

| 종목 (코드) | 운용사 | 기초지수 | 상장일 | 총보수(운용보수) | 환헤지 | 듀레이션·구조 | 자산군 근거 한 줄 | role 후보 | 연금저축 적격 |
|---|---|---|---|---|---|---|---|---|---|
| KODEX 차이나휴머노이드로봇 (0048K0) | 삼성자산운용 | Solactive China Humanoid Robotics Index (CNH) (Price Return) [1] | 2025-05-13 [1] | 0.45% (0.404%) [1] | 환노출형 [1] | 중국 휴머노이드 로봇 주식 (상위 5종목 합 33.5%) [1] | 특정국·테마 주식 | satellite | 국내 상장·비레버리지 → 가능 (운용사 연금 태그는 미확인) |
| TIGER KRX금현물 (0072R0) | 미래에셋자산운용 | KRX 금현물지수 [2][3] | 2025-06-24 [2][3] | 0.15% (운용 0.109 / 지정참가 0.001 / 신탁 0.02 / 일반사무 0.02) [3] | "환헤지를 하지 아니함" [3] | 금 현물 99.99 1kg 100.0% (2026-08-31) [2] | KRX 금현물 실물 보유 | core | 개인연금·퇴직연금 태그 [3]; 연금 리스트 개인연금 100% / 퇴직연금 70% [18] |
| TIGER 미국S&P500 (360750) | 미래에셋자산운용 | S&P 500 [4][5] | 2020-08-07 [4][5] | 0.0068% (0.0002%) [4][5] | "환헤지를 하지 아니함" [5] | 미국 대형주 500 (상위: 엔비디아 7.8%, 애플 7.7%) [4] | 넓은 주식 지수 | core | 개인연금·퇴직연금 태그 [5] |
| ACE 미국나스닥100 (367380) | 한국투자신탁운용 | NASDAQ 100 [6] | 2020-10-29 [6] | 0.0062% (0.0001%) [6] | 환노출형 [6] | 나스닥 비금융 대형 100 (상위: 엔비디아 8.1%, 애플 8.1%) [6] | 넓은 주식 지수(성장주 편중) | core (사용자가 satellite로 볼 수도) | 국내 상장·비레버리지 → 가능 (운용사 태그 미확인) |
| KODEX 인도타타그룹 (477730) | 삼성자산운용 | Nifty India Corporate Group Index - Tata Group 25% Cap (Price Return) [7] | 2024-05-08 [7] | 0.45% (0.419%) [7] | 환노출형 [7] | 타타그룹 10종목 (TCS 24.8%, Titan 17.5%) [7] | 특정국·특정 기업집단 주식 | satellite | 국내 상장·비레버리지 → 가능 (운용사 태그 미확인) |
| TIGER 차이나휴머노이드로봇 (0053L0) | 미래에셋자산운용 | Mirae Asset China Humanoid Robot 지수(PR) [8][9] | 2025-05-27 [8][9] | 0.49% (운용 0.439 / 지정참가 0.001 / 신탁 0.025 / 일반사무 0.025) [9] | "환헤지를 하지 아니함" [9] | 중국·홍콩 휴머노이드 주식 (Xpeng 9.4%, UBTech 9.1%) [8] | 특정국·테마 주식 | satellite | 개인연금·퇴직연금 태그 [9] |
| ACE 종합채권(AA-이상)액티브 (356540) | 한국투자신탁운용 | KIS 종합채권 AA-이상 총수익 지수 [10] | 2020-07-21 [10] | 0.02% (0.009%) [10] | 해당 없음(원화 채권) | 펀드 듀레이션 4.74년 / 보유채권 5.97년 (2026-08-31) [10]; 지수 듀레이션 4.87년 (2026-06-10) [11] | 국내 우량 종합채권, 듀레이션 5년 안팎 | core | 국내 상장·비레버리지 → 가능 (운용사 태그 미확인) |
| ACE 미국S&P500 (360200) | 한국투자신탁운용 | S&P 500 [12] | 2020-08-07 [12] | 0.0047% (0.0001%) [12] | 환노출형 [12] | 미국 대형주 500 [12] | 넓은 주식 지수 | core | 국내 상장·비레버리지 → 가능 (운용사 태그 미확인) |
| ACE KRX금현물 (411060) | 한국투자신탁운용 | KRX 금현물지수 [13] | 2021-12-15 [13] | 0.19% (0.135%) [13] | 환노출형 [13] | 금 현물 99.99 1kg 99.9% + 원화현금 0.1% [13] | KRX 금현물 실물 보유 | core | 국내 상장·비레버리지 → 가능 (운용사 태그 미확인) |

순자산(2026-10-23, 펀ETF): 0048K0 1,207억 [1] · 0072R0 10,681억 [2] · 360750 207,325억 [4] · 367380 33,757억 [6] · 477730 203억 [7] · 0053L0 2,092억 [8] · 356540 11,473억 [10] · 360200 38,773억 [12] · 411060 35,785억 [13].

### KODEX 차이나휴머노이드로봇 (0048K0)
삼성자산운용. 기초지수는 Solactive China Humanoid Robotics Index (CNH) (Price Return), 2025-05-13 상장, 총보수 연 0.45%, 환노출형 [1]. 구성 상위는 Leader Harmonious Drive Systems 7.5%, Shenzhen Inovance 6.8%, Zhejiang Sanhua 6.7% 등 중국 본토 로봇 부품·완제품 기업 [1]. 자산군은 stock. 특정 국가의 단일 테마라서 role은 satellite 후보. 연금저축 적격은 국내 상장이고 레버리지·인버스가 아니라는 구조에서만 판단했고, 운용사 공식 페이지의 연금 태그는 열지 못했다(미확인).

### TIGER KRX금현물 (0072R0)
미래에셋자산운용. KRX 금현물지수 추종, 2025-06-24 상장, 총보수 연 0.15% [2][3]. 운용사 페이지는 "이 투자신탁은 환헤지를 시행하지 않습니다", 기초자산인 금현물에 자산총액 60% 이상 투자라고 적고 있다 [3]. 구성종목은 금 현물 99.99 1kg 100.0% (2026-08-31) [2]. 선물이 아닌 실물 구조이므로 gold/core. 운용사 페이지에 개인연금·퇴직연금 태그가 있고, 연금 투자 가능 리스트에 개인연금 100%, 퇴직연금 70%로 표기 [18].

### TIGER 미국S&P500 (360750)
미래에셋자산운용. S&P 500 추종, 2020-08-07 상장, 총보수 연 0.0068%, 환헤지 안 함 [4][5]. 순자산 207,325억원 (2026-10-23) [4]. 넓은 지수 → stock/core. 운용사 페이지 개인연금·퇴직연금 태그 [5].

### ACE 미국나스닥100 (367380)
한국투자신탁운용. NASDAQ 100 추종, 2020-10-29 상장, 총보수 연 0.0062%, 환노출형 [6]. 100종목의 넓은 지수라 core 후보로 두었지만 S&P500과 상위 종목(엔비디아·애플·마이크로소프트·아마존)이 겹치고 성장주 편중이라는 사실은 적어 둔다 [4][6]. satellite로 볼지는 사용자 결정. 연금 태그는 미확인(구조상 적격).

### KODEX 인도타타그룹 (477730)
삼성자산운용. Nifty India Corporate Group Index - Tata Group 25% Cap (Price Return) 추종, 2024-05-08 상장, 총보수 연 0.45%, 환노출형 [7]. 구성은 10종목이며 TCS 24.8%, Titan 17.5%, Tata Steel 13.9% [7]. 순자산 203억원, 거래량 11,228주 (2026-10-23) [7]. 특정국·특정 기업집단 → stock/satellite. 연금 태그 미확인(구조상 적격).

### TIGER 차이나휴머노이드로봇 (0053L0)
미래에셋자산운용. Mirae Asset China Humanoid Robot 지수(PR) 추종, 2025-05-27 상장, 총보수 연 0.49%, 환헤지 안 함 [8][9]. 상위 종목 Xpeng 9.4%, UBTech 9.1%, Dobot 8.4% [8]. KODEX 0048K0와 같은 테마이지만 지수 산출사와 구성이 다르다(0048K0는 Solactive, 본토 A주 중심; 0053L0는 미래에셋 자체 지수, 홍콩 상장 포함) [1][8]. stock/satellite. 개인연금·퇴직연금 태그 [9].

### ACE 종합채권(AA-이상)액티브 (356540) — 중기채인가 장기채인가
한국투자신탁운용. 기초(비교)지수 KIS 종합채권 AA-이상 총수익 지수, 2020-07-21 상장, 총보수 연 0.02% [10]. 원화 채권이라 환헤지 개념이 없다.

듀레이션 사실:
- 펀드 듀레이션 4.74년, 보유채권 듀레이션 5.97년 (2026-08-31 기준, 펀ETF·금융투자협회 데이터) [10].
- 기초지수(KIS 종합채권지수 AA- 이상)의 듀레이션 4.87년, 만기수익률 3.97% (2026-06-10 기준; KCGI자산운용 펀드 출시 보도에서 인용한 수치라 단서로만) [11]. 같은 기사: "KIS 종합채권지수는 국고채와 통화안정증권, 회사채, 금융채 등 다양한 종류의 우량 채권으로 구성된다" [11].
- 보유 상위 종목은 2055·2054·2052·2031년 만기 국고채이지만 각 2~3.6%로 분산되어 있고, 전체 듀레이션은 5년 안팎 [10].
- 운용사 공식 상품 페이지(aceetf.co.kr)는 스크립트 렌더링이라 열지 못했다. 운용사 페이지의 듀레이션 수치는 미확인.

올웨더 정의와 비교(정의 출처는 §미확인 참고):
- 올웨더(Tony Robbins가 소개한 All Seasons)의 중기채는 7~10년물 미국 국채, 장기채는 20~25년물 미국 국채.
- 국내 ETF로 환산하면 10년물 국고채 ETF의 펀드 듀레이션은 7.27~7.84년 (ACE 국고채10년 7.48, KIWOOM 국고채10년 7.27, RISE 국고채10년액티브 7.84; 2026-08-31) [14][15][16], 30년물 국고채 ETF는 15.67~25.44년 (SOL 15.67, KODEX 18.44, RISE Enhanced 21.9, TIGER 스트립 25.44) [17][19][20][21].
- ACE 종합채권의 4.74년은 장기채 구간(15년 이상)과 멀고, 중기채 구간(7년 안팎)보다도 짧다. 또 국채만이 아니라 통안채·회사채·금융채가 섞인 종합지수다 [11].
- 따라서 "mid_bond로 두되, 올웨더 원형의 중기채(10년물 국채)보다 듀레이션이 2~3년 짧고 신용채가 섞여 있다"는 것이 사실 관계. 이 종목을 그대로 중기채로 쓸지, 10년물 국고채 ETF(long-bond-commodity-candidates.md의 mid_bond 후보)로 바꿀지는 사용자 결정.

### ACE 미국S&P500 (360200)
한국투자신탁운용. S&P 500 추종, 2020-08-07 상장, 총보수 연 0.0047%, 환노출형, 순자산 38,773억원 [12]. TIGER 360750과 같은 지수·같은 환노출이므로 풀 합산 시 같은 자산군(stock)으로 묶인다 (REBALANCING_RULES §1-1). stock/core. 연금 태그 미확인(구조상 적격).

### ACE KRX금현물 (411060)
한국투자신탁운용. KRX 금현물지수 추종, 2021-12-15 상장, 총보수 연 0.19%, 환노출형 [13]. 구성 금 현물 99.99 1kg 99.9% [13]. TIGER 0072R0와 같은 지수·같은 실물 구조이고 총보수만 0.19% vs 0.15% 차이 [2][13]. gold/core. 연금 태그 미확인(구조상 적격).

## 우리 적용 — asset_map.yaml 후보 값 (사용자 확인 전)
현재 `rules/asset_map.yaml`의 proposed 값과 같다. 바뀐 것은 note(근거 한 줄)뿐. 아래는 제안이며 사용자가 확인한 뒤 status를 confirmed로 바꾼다.

```yaml
assets:
  "KODEX 차이나휴머노이":
    ticker: "0048K0"
    full_name: KODEX 차이나휴머노이드로봇
    asset_class: stock
    role: satellite
    note: "Solactive China Humanoid Robotics 지수, 중국 테마 주식, 환노출, 총보수 0.45%"
  "TIGER KRX금현물":
    ticker: "0072R0"
    asset_class: gold
    role: core
    note: "KRX 금현물지수, 금 현물 100% 실물형, 환헤지 없음, 총보수 0.15%"
  "TIGER 미국S&P500":
    ticker: "360750"
    asset_class: stock
    role: core
    note: "S&P 500, 환노출, 총보수 0.0068%"
  "ACE 미국나스닥100":
    ticker: "367380"
    asset_class: stock
    role: core            # 성장주 편중 — satellite로 볼지 사용자 결정
    note: "NASDAQ 100, 환노출, 총보수 0.0062%"
  "KODEX 인도타타그룹":
    ticker: "477730"
    asset_class: stock
    role: satellite
    note: "Nifty India Tata Group 25% Cap, 인도 타타그룹 10종목, 환노출, 총보수 0.45%"
  "TIGER 차이나휴머노이":
    ticker: "0053L0"
    full_name: TIGER 차이나휴머노이드로봇
    asset_class: stock
    role: satellite
    note: "Mirae Asset China Humanoid Robot 지수, 중국·홍콩 테마 주식, 환노출, 총보수 0.49%"
  "ACE 종합채권(AA-이상)":
    ticker: "356540"
    full_name: ACE 종합채권(AA-이상)액티브
    asset_class: mid_bond   # 펀드 듀레이션 4.74년(2026-08-31) — 장기채(15년+)와 멀고 10년물(7.5년)보다 짧음. 중기채로 쓸지 사용자 결정
    role: core
    note: "KIS 종합채권 AA-이상 TR, 국고·통안·회사채 혼합, 펀드 듀레이션 4.74년, 총보수 0.02%"
  "ACE 미국S&P500":
    ticker: "360200"
    asset_class: stock
    role: core
    note: "S&P 500, 환노출, 총보수 0.0047%"
  "ACE KRX금현물":
    ticker: "411060"
    asset_class: gold
    role: core
    note: "KRX 금현물지수, 금 현물 99.9% 실물형, 환노출, 총보수 0.19%"
```

## 미확인 · 열린 질문
- **ACE 종합채권을 mid_bond로 둘지** (듀레이션 4.74년 vs 올웨더 중기채 7~10년물). 대안은 10년물 국고채 ETF로 교체. 사용자 결정.
- 올웨더 "중기채 7~10년 / 장기채 20~25년" 정의의 원문 페이지(nasdaq.com Tony Robbins 기사)는 타임아웃으로 열지 못했다. 검색 요약에서만 확인. 2026-10-27 재시도, 미확인: tonyrobbins.com 페이지에는 만기 정의가 없었고 [24], 검색에서도 1차 출처(저자 사이트·책)가 나오지 않았다. 책 확인 항목으로 둔다. robberger.com은 비율(30/40/15/7.5/7.5)만 있고 만기 정의가 없다 [22].
- 한국투자신탁운용(aceetf.co.kr)·삼성자산운용(samsungfund.com) 공식 상품 페이지는 스크립트 렌더링이라 열지 못했다. ACE·KODEX 6종의 수치는 펀ETF(funetf.co.kr) 값. 펀ETF는 삼성자산운용이 운영하며 "금융투자협회 및 데이터 정보 제공사(KG제로인, 코스콤, 연합인포맥스, 모닝스타 등)로부터 수신한 데이터"라고 밝히고 있다 [23]. 운용사 1차 페이지로 재확인 필요. 2026-10-27 재시도, 미확인(이유: 스크립트 렌더링): 한투 ACE 페이지는 기초지수·총보수 칸이 비어 있는 껍데기만 내려왔고 [25], 삼성 KODEX 페이지는 요청한 상품 데이터가 없었으며 [26], 금융투자협회 공시는 조회 화면만 열렸다 [27]. 한투 사이트가 부르는 내부 API 주소는 코드에서 확인했으나 직접 호출은 하지 않았다. 운용사 PDF(간이투자설명서) 주소도 찾지 못했다. 6종(367380, 356540, 360200, 411060, 0048K0, 477730)의 기초지수·총보수는 계속 펀ETF 값이다.
- ACE·KODEX 6종의 연금저축 적격은 구조(국내 상장·비레버리지)로만 판단. 운용사 연금 태그 미확인. 2026-10-27 재시도, 미확인(운용사 페이지 미렌더링). 참고: 한투 담당자는 레버리지형을 제외한 ACE 미국국채 ETF가 퇴직연금 100% 투자 가능하다고 말했으나(2025-08 기사) 이 6종과는 다른 상품이다.
- 총보수는 2026-10-23 기준 표시값이며 실부담비용(기타비용·매매수수료 포함)은 미확인.
- ACE 미국나스닥100을 core로 둘지 satellite로 둘지.

## 출처 (열어본 페이지만, 날짜)
모두 2026-10-26 열람.
1. 펀ETF KODEX 차이나휴머노이드로봇 — https://www.funetf.co.kr/product/etf/view/KR70048K0004
2. 펀ETF TIGER KRX금현물 — https://www.funetf.co.kr/product/etf/view/KR70072R0006
3. 미래에셋 TIGER KRX금현물 상품 페이지 — http://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR70072R0006
4. 펀ETF TIGER 미국S&P500 — https://www.funetf.co.kr/product/etf/view/KR7360750004
5. 미래에셋 TIGER 미국S&P500 상품 페이지 — http://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR7360750004
6. 펀ETF ACE 미국나스닥100 — https://www.funetf.co.kr/product/etf/view/KR7367380003
7. 펀ETF KODEX 인도타타그룹 — https://www.funetf.co.kr/product/etf/view/KR7477730006
8. 펀ETF TIGER 차이나휴머노이드로봇 — https://www.funetf.co.kr/product/etf/view/KR70053L0005
9. 미래에셋 TIGER 차이나휴머노이드로봇 상품 페이지 — http://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR70053L0005
10. 펀ETF ACE 종합채권(AA-이상)액티브 — https://www.funetf.co.kr/product/etf/view/KR7356540005
11. 헤럴드경제 2026-06-11 "KCGI자산운용, '코리아종합채권펀드' 출시" (KIS 종합채권지수 AA- 이상 듀레이션 4.87년, 2026-06-10 기준; 단서) — https://www.heraldk.com/article/2026061117000074339
12. 펀ETF ACE 미국S&P500 — https://www.funetf.co.kr/product/etf/view/KR7360200000
13. 펀ETF ACE KRX금현물 — https://www.funetf.co.kr/product/etf/view/KR7411060007
14. 펀ETF ACE 국고채10년 — https://www.funetf.co.kr/product/etf/view/KR7365780006
15. 펀ETF KIWOOM 국고채10년 — https://www.funetf.co.kr/product/etf/view/KR7148070006
16. 펀ETF RISE 국고채10년액티브 — https://www.funetf.co.kr/product/etf/view/KR7481430007
17. 펀ETF SOL 국고채30년액티브 — https://www.funetf.co.kr/product/etf/view/KR7474390002
18. 미래에셋 TIGER 연금 투자 가능 리스트(원자재/부동산/통화) — https://investments.miraeasset.com/tigeretf/ko/pension/commodities-investment-currencies/list.do
19. 펀ETF KODEX 국고채30년액티브 — https://www.funetf.co.kr/product/etf/view/KR7439870007
20. 펀ETF RISE KIS국고채30년Enhanced — https://www.funetf.co.kr/product/etf/view/KR7385560008
21. 펀ETF TIGER 국고채30년스트립액티브 — https://www.funetf.co.kr/product/etf/view/KR7451530000
22. robberger.com Ray Dalio All Weather Portfolio (비율만) — https://robberger.com/portfolios/ray-dalio-all-weather-portfolio/
23. 펀ETF 첫 화면(운영 주체·데이터 출처 문구) — https://www.funetf.co.kr/
2026-10-27 추가 열람:
24. tonyrobbins.com (All Seasons 만기 정의 없음) — https://www.tonyrobbins.com/stories/podcast/ray-dalio-money-master-the-game/
25. 한투 ACE 상품 페이지(값 비어 있음) — https://www.aceetf.co.kr/fund/K55101DU6458
26. 삼성 KODEX 상품 페이지 시도(해당 상품 데이터 없음) — https://www.samsungfund.com/etf/product/view.do?id=2ETFV3
27. 금융투자협회 공시(조회 화면만) — https://dis.kofia.or.kr/

## 변경 이력
- 2026-10-26: 초기 작성
- 2026-10-27: 미확인 항목 후속 조사 — 해결 0건, 미확인 3건 재시도 실패(운용사 1차 페이지, ACE·KODEX 연금 태그, 올웨더 만기 정의). 사용자 결정 항목과 총보수 실부담비용 항목은 손대지 않음
