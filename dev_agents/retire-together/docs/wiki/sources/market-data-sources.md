# 공개 시세 소스 안정성 — 네이버 금융 · KRX · 공공데이터포털 · 라이브러리
기준일: 2026-10-27 · 상태: 초안

## 요약 (5줄 이내)
- `tools/market.py`는 네이버의 비공개(undocumented) JSON 두 개를 쓴다: 종목 검색 `ac.stock.naver.com/ac`, 현재가 `polling.finance.naver.com/api/realtime/domestic/stock/{code}`. 2026-10-26 둘 다 키 없이 200 응답. 네이버 이용약관(시행 2026-10-01)은 "사전 허락 없이 자동화된 수단(…스크래퍼 등)"으로 "이용자(사람)의 실제 이용을 전제로 하는" 취지에 맞지 않게 쓰는 것을 금지하고(조 번호 체계 없음: "주의사항" 절 불릿 6번째 항목, 2026-10-27 확인), `finance.naver.com/robots.txt`는 `Disallow: /`다.
- 공식 대안: 공공데이터포털 "금융위원회_증권상품시세정보"(ETF 시세: 종가·NAV·기초지수명·기초지수종가·순자산총액) — 무료, 서비스키, 일 1회 갱신(다음 영업일 13시 이후), 공공누리 4유형(상업적 이용 금지).
- KRX 정보데이터시스템(data.krx.co.kr)은 자동화 대량 조회를 감지해 IP를 차단하고 "KRX Open API(openapi.krx.co.kr) 등 공식 경로"를 안내한다(2026-10-26 접속에서 차단 안내 페이지 수신. 2026-10-27에는 메인·이용안내·약관 페이지가 정상 로드됨). 홈페이지 이용약관 제10조는 "자동화 수단을 이용하여 정보를 무단 수집·복제·배포하는 행위"를 금지한다.
- KRX Open API(2026-10-27 확인): ETF 일별매매정보(2010-01-04~) 제공. 회원가입(개인은 본인인증 또는 소셜 로그인)·인증키 신청(관리자 승인)·API별 활용신청(승인) 필요, 키당 일 10,000회, 이용기간 1년, **비상업 목적만**.
- pykrx(마지막 커밋 2026-09-30)는 KRX·네이버 스크래핑, FinanceDataReader(2026-05-13)는 기본 네이버. 둘 다 MIT, 유지보수는 개인.
- 종목명→코드는 네이버 자동완성 외에 공공데이터 ETF API(종목명 필드)와 FDR `StockListing('ETF/KR')`이 같은 일을 한다.

## 비교표

| 소스 | 공식 여부 | 제공 항목 | 지연 | 인증 | 변경 위험 | 라이선스 | 출처·확인일 |
|---|---|---|---|---|---|---|---|
| 네이버 `polling.finance.naver.com/api/realtime/...` (현재 사용) | 비공식(문서 없음) | 현재가(`closePrice`), 등락, 거래상태; 응답에 `pollingInterval: 70000` | 응답 `delayTime: 0` 표기 | 없음 | 약관상 자동화 금지 조항·robots `Disallow: /`. 차단·변경 공지 채널 없음 | 네이버 약관 | [N1][N2][N3] 2026-10-26 |
| 네이버 `ac.stock.naver.com/ac` (종목명→코드, 현재 사용) | 비공식 | 코드·종목명·시장·국가 | — | 없음 | 위와 같음. `/robots.txt` 요청은 "접근 오류" HTML | 네이버 약관 | [N1][N3] 2026-10-26 |
| 공공데이터포털 금융위원회_증권상품시세정보 (ETF/ETN/ELW) | 공식(원천 KRX) | 종가·시가·고가·저가·거래량·NAV·기초지수명·기초지수종가·순자산총액; 종목명·코드 | 일 1회, 기준일 다음 영업일 13시 이후 | 서비스키(자동승인), 개발계정 일 10,000건 | 낮음(2021-11-16 등록, 2026-09-07 수정) | 공공누리 4유형: 출처표시·상업적 이용 금지·변경 금지, 재배포 금지 | [D1] 2026-10-26 |
| 공공데이터포털 금융위원회_주식시세정보 | 공식(원천 KRX) | 주식·수익증권 등 시가·종가·고가·저가·거래량 | 일 1회(상동) | 서비스키, 일 10,000건 | 낮음 | 공공누리 4유형 | [D2] 2026-10-26 |
| 공공데이터포털 금융위원회_지수시세정보 | 공식 | 주가지수·채권지수·파생지수 시가·종가 등 (2020-01-01 이후) | 일 1회(상동) | 서비스키 | 2024-12-06 지수명 변경 이력 있음 | 공공누리 4유형 | [D3] 2026-10-26 |
| KRX 정보데이터시스템 data.krx.co.kr (화면) | 공식 | ETF 메뉴: 전종목 시세·전종목 등락률·개별종목 시세 추이·전종목 기본정보·개별종목 종합정보·투자자별 거래실적·PDF·ETF 상세검색·추적오차율 추이·괴리율 추이. 다운로드 EXCEL·CSV·PDF [X4] | 화면 기준(갱신 시각 미확인) | 이용약관상 "비회원"이 일부 서비스 이용 가능, 로그인 필요 메뉴 구분은 미확인 [X4]. pykrx README는 일부 로그인 필요 [L1] | 자동화 대량 조회 시 IP 차단 안내 [X1]; 약관 제10조②가 자동화 수단 무단 수집 금지 [X4] | KRX 홈페이지 이용약관(2026-08-29 시행) | [X1][X4][L1] 2026-10-26~27 |
| KRX Open API openapi.krx.co.kr | 공식 | "ETF 일별매매정보"(2010-01-04부터, 등록 2020-09-22·최근 수정 2026-01-16). 응답 필드 목록은 미확인(JS/명세서 파일) [X3] | 갱신 시각 미확인 | 인증키(요청 헤더 `AUTH_KEY`). 회원가입 후 키 신청·API별 활용신청, 모두 관리자 승인. 신청기간 1M/3M/6M/12M, 목적 선택(개인 연구·정보 취득·앱/웹 개발·기타) [X3] | 약관: 서비스 범위·횟수 변경·중단 가능(제8조) | 약관: 키당 일 10,000회(제8조④), 이용기간 1년(제5조③), **비상업 목적만**(제6조②), 화면에 "한국거래소 통계정보" 명시(제10조③), 12개월 미사용 키 삭제(제8조⑤) | [X2][X3] 2026-10-27 |
| 금융투자협회 ETF 공시(dis.kofia.or.kr) | 공식 | 미확인(JS, 본문 못 읽음) | — | 미확인 | — | — | 2026-10-26 (열었으나 본문 없음) |
| 운용사 상품 페이지(삼성자산운용 KODEX 200) | 공식 | 미확인(JS, 본문 못 읽음) | — | — | — | — | 2026-10-26 (열었으나 본문 없음) |
| pykrx | 비공식 라이브러리 | ETF 목록·OHLCV·NAV·괴리율·추적오차. 소스: data.krx.co.kr `getJsonData.cmd`(KrxWebIo) [L1] | KRX 화면과 동일 | 일부 KRX 로그인(`KRX_ID`/`KRX_PW`) | KRX 차단 가능성 README 명시 | MIT | [L1] 2026-10-26 |
| FinanceDataReader | 비공식 라이브러리 | 가격: 기본 NAVER `fchart.stock.naver.com/sise.nhn`, `KRX:` 접두어는 data.krx.co.kr `getJsonData.cmd`. `StockListing('ETF/KR')`: 네이버 `finance.naver.com/api/sise/etfItemList.nhn` [L3] | — | 없음 | 네이버·KRX 변경에 종속 | MIT | [L2] 2026-10-26 |

## 상세 (소스별 단락)

### 네이버 금융 (현재 `tools/market.py`)
- 코드가 쓰는 URL: `https://ac.stock.naver.com/ac?q={q}&target=stock`(종목 검색, `nationCode == "KOR"` 필터), `https://polling.finance.naver.com/api/realtime/domestic/stock/{code}`(현재가, `datas[0].closePrice`). User-Agent `Mozilla/5.0 (retire-together PoC)`, 종목 간 0.2초 대기 [N1].
- 2026-10-26 직접 호출 결과: polling 엔드포인트 200 `application/json`, 본문에 `"pollingInterval":70000`, `stockExchangeType.delayTime: 0`, `closePriceSendTime: "1630"`, `closePrice "85,995"`(KODEX 200). 자동완성 엔드포인트도 200 JSON. 두 호스트 모두 공식 문서·개발자 안내 페이지가 없다(네이버 개발자센터 API 아님) [N3].
- robots: `finance.naver.com/robots.txt` = `User-agent: * / Disallow: /`; `m.stock.naver.com/robots.txt` = `Disallow: /`(Yeti만 일부 Allow); `polling.finance.naver.com/robots.txt`는 404 JSON; `ac.stock.naver.com/robots.txt`는 "[접근 오류] 서비스에 접속할 수 없습니다" HTML [N3].
- 이용약관(네이버 서비스 이용약관, 시행일자 2026-10-01) 원문: "네이버의 사전 허락 없이 자동화된 수단(예: 매크로 프로그램, 로봇(봇), 스파이더, 스크래퍼 등)을 이용하여 … 이용자(사람)의 실제 이용을 전제로 하는 네이버 서비스의 제공 취지에 부합하지 않는 방식으로 네이버 서비스를 이용하거나 … 네이버의 기술적 조치를 무력화하려는 일체의 행위 … 를 시도해서는 안 됩니다." 조항 번호: 이 약관은 "제N조" 번호 없이 소제목+불릿으로 구성돼 있고, 위 문장은 소제목 "네이버 서비스 이용과 관련하여 몇 가지 주의사항이 있습니다" 아래 불릿 목록의 6번째 항목이다(HTML `a8` 앵커, 2026-10-27 원문 HTML 직접 확인) [N2]. 이 항목은 가입·로그인·게시·ID 수집·검색 질의 등 "이용자(사람)의 실제 이용을 전제로 하는" 서비스를 예로 든다.
- 호출 빈도 제한: 공식 수치 없음. 응답의 `pollingInterval 70000`(70초)이 네이버 화면이 쓰는 갱신 주기라는 것만 확인. 변경 이력: 공식 변경 공지 채널이 없어 이력을 확인할 수 없음. 제3자 스킬 문서들은 "undocumented", "URL scheme이 바뀔 수 있다"고만 적음 (열어보지 않아 출처에서 제외).
- 보도: 네이버가 2025년 6~7월 AI 크롤러 차단 코드를 전 서비스로 확대했다는 기사가 검색에 걸렸으나 열어보지 않아 미확인.

### 공공데이터포털(data.go.kr) 금융위원회 API
- 금융위원회_증권상품시세정보(ID 15094806): 오퍼레이션 3개(ETF 시세·ETN 시세·ELW 시세). 페이지 내 응답 명세에 `nav`, `nPptTotAmt`(순자산총액), `bssIdxIdxNm`(기초지수의 명칭), `bssIdxClpr`(기초지수의 종가), `basDt`, `srtnCd` 필드가 있고, 요청 파라미터로 "기초지수_지수명이 일치/포함하는 데이터 검색"이 있다. 설명: "데이터 갱신주기는 일 1회", 기준일 다음 영업일 13시 이후 반영, 실시간 아님(메타데이터 '업데이트 주기: 실시간' 표기와 불일치). 무료, 자동승인, 개발계정 일 10,000건, 운영계정은 활용사례 등록으로 증설. 공공누리 4유형(출처표시·상업적 이용 금지·변경 금지), "제3자 무단 제공·재배포 금지", 상업적 이용은 KRX Data Marketplace에서 유료 구매. 등록 2021-11-16, 수정 2026-09-07 [D1].
- 금융위원회_주식시세정보(ID 15094808): 주식·수익증권·신주인수권 4개 오퍼레이션, 시가·종가·고가·저가·거래량. 갱신·인증·라이선스는 위와 동일. 수정 2026-09-07 [D2].
- 금융위원회_지수시세정보(ID 15094807): 주가지수·채권지수·파생지수, 2020-01-01 이후. "2024년 12월 6일 이후 일부 지수명이 바뀌었으므로 활용자 가이드 확인" [D3].
- 보수(총보수)는 세 API 어디에도 항목이 없다 → 보수는 이 경로로 못 받는다.

### KRX
- data.krx.co.kr(KRX Data Marketplace): 2026-10-26에는 ETF 메뉴 URL을 열자 접속 제한 안내가 왔다. 원문: "자동화 수단을 통한 비정상 대량 조회가 감지되어 해당 IP의 접속이 일시적으로 제한되었습니다." 일괄 데이터는 "KRX Open API(openapi.krx.co.kr) 등 공식 경로를 이용해 주시기 바랍니다" [X1]. 2026-10-27에는 같은 사이트의 메인·이용안내·홈페이지 이용약관 페이지가 로그인 없이 열렸다(각 1회 요청) [X4].
- data.krx.co.kr 제공 범위(2026-10-27, 메인·이용안내 메뉴 트리): "기본 통계 … 다양한 다운로드(EXCEL, CSV, PDF) 방식을 제공". 증권상품 > ETF 메뉴: 전종목 시세, 전종목 등락률, 개별종목 시세 추이, 전종목 기본정보, 개별종목 종합정보, 투자자별 거래실적(전체·개별), PDF(Portfolio Deposit File), ETF 상세검색, 액티브ETF 실적·편입자산현황, 추적오차율 추이, 괴리율 추이, 장마감 괴리율 추이, 합성ETF 관련, 분기별 LP평가. 로그인 없이 되는 메뉴의 범위는 이용약관이 "비회원은 일부 서비스 이용"이라고만 적어 **미확인** [X4].
- data.krx.co.kr 홈페이지 이용약관(2026-08-29 시행): 제10조② "자동화 수단을 이용하여 정보를 무단 수집·복제·배포하는 행위" 금지, 제12조② 사이트 정보를 "거래소의 사전 허락 없이 복사·복제·배포·전송·공중송신" 금지 [X4].
- KRX Open API(openapi.krx.co.kr, 2026-10-27 서버 렌더링 페이지 열람): 서비스 이용방법 — STEP1 Data Marketplace 회원가입 후 로그인(법인 사업자 정보 / 개인 본인인증 또는 소셜 로그인), 인증키 신청(관리자 승인 후 사용 가능) → STEP2 서비스 목록·명세서·샘플 테스트 → STEP3 API 활용신청 후 관리자 승인대기 → STEP4 서비스 개시. 서비스 목록 > 증권상품 > "ETF 일별매매정보: ETF(상장지수펀드)의 매매정보 제공 ('10년01월04일 데이터부터 제공)", 등록일 2020/09/22·최근 수정일 2026/01/16. 인증키는 요청 헤더 `AUTH_KEY`에 전달. 신청 화면에 기간(1M·3M·6M·12M)과 목적(개인 연구·정보 취득·앱/웹 개발·기타) 선택 [X3].
- KRX Open API 이용약관(국문): 제5조③ 이용기간은 인증키 제공일부터 1년, 연장 1년 단위 / 제6조② "비상업적인 목적으로만 이용" / 제8조① 이용 가능 시간·횟수 지정 가능, ④ "하나의 키당 1일(매일 0시~24시) 10,000회 이하", ⑤ 12개월 미사용 키는 사전 공지 없이 삭제 / 제10조③ 결과로 화면을 만들면 "한국거래소 통계정보" 명시. 데이터 갱신 시각은 열어본 페이지에 없음 → 미확인 [X3]. 데이터 수신방법 페이지는 개인투자자가 "단순 참고 목적이 아닌 재배포 프로그램 개발 수익사업 활용" 등에 시세를 쓰려면 별도 계약이 필요하다고 안내한다 [X3].

### 라이브러리
- pykrx(`sharebook-kr/pykrx`, 마지막 커밋 2026-09-30, MIT): README "KRX와 네이버에서 데이터를 스크래핑", "데이터 저작권은 각 제공자에게", "도의적으로 무분별한 API 호출을 자제", 한 번에 많이 요청하면 KRX 서버가 차단할 수 있어 예제는 1초 지연. ETF 함수: `get_etf_ticker_list`, `get_etf_ohlcv_by_date/ticker`(NAV 열 포함), `get_etf_price_deviation`(괴리율), `get_etf_tracking_error`, `get_etf_portfolio_deposit_file`. 소스 `pykrx/website/krx/etx/core.py`의 ETF 클래스(`ETF_전종목기본종목`, `개별종목시세_ETF`, `전종목시세_ETF`)는 `KrxWebIo`를 상속하고, `krxio.py`의 요청 URL은 `https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd`(2026-10-27 확인). `pykrx/website/naver/`에도 모듈이 있으나 ETF 경로는 위 KRX 클래스다 [L1].
- FinanceDataReader(`FinanceData/FinanceDataReader`, 마지막 커밋 2026-05-13, MIT): 국내 가격은 기본 NAVER(2000년 이후), `KRX:` 접두어로 KRX, `StockListing('ETF/KR')`로 "한국 ETF 전종목" 목록 [L2]. 소스 코드(2026-10-27, `src/FinanceDataReader/`): `data.py`가 한국 종목 기본 리더로 `NaverDailyReader`를 쓰고(`KRX:` 접두어 시 `KrxDailyReader`), `naver/data.py`는 `https://fchart.stock.naver.com/sise.nhn?timeframe=day&count=6000&requestType=0&symbol=`을 요청한다. ETF 목록은 `naver/listing.py`의 `NaverEtfListing`이 `https://finance.naver.com/api/sise/etfItemList.nhn`을 요청한다. `krx/data.py`는 `http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd`에 POST한다(`KrxDailyReader` 세부 파라미터는 열어보지 않음) [L3]. 즉 FDR의 ETF 일별 시세 기본 경로는 네이버, KRX 경로는 data.krx.co.kr 화면 JSON이다.

### 그 밖에 열어봤으나 내용을 못 읽은 곳
- 금융투자협회 전자공시 ETF(dis.kofia.or.kr): 페이지 제목만 렌더링. 제공 항목·API 여부 미확인.
- 삼성자산운용 KODEX 200 상품 페이지(samsungfund.com … id=2ETF01): 네비게이션만 렌더링. iNAV·NAV·총보수 표시 여부 미확인.

## 우리 적용 — accounts.yaml `api:` 값·2단계 자동주문 설계에 주는 사실 (사용자 확인 전)
- 우리 용도(하루 한 번 종가·현재가, 종목명→코드):
  - **전일 종가·NAV·기초지수·순자산** → 공공데이터 증권상품시세정보 ETF 오퍼레이션이 전부 제공(다음 영업일 13시 이후, 서비스키 필요, 비상업 조건) [D1].
  - **장중 현재가** → 공식·무료 소스에서는 찾지 못함. 현재 쓰는 네이버 polling이 유일하게 확인된 경로이나 비공식·약관 조항 있음 [N2][N3]. 2단계 KIS 자동주문 때는 KIS 시세 API가 따로 있다(broker-apis.md).
  - **종목명→코드** → 네이버 자동완성(현재), 공공데이터 ETF API의 종목명 필드, FDR `StockListing('ETF/KR')` 세 곳에서 가능 [N1][D1][L2].
  - **총보수** → 이번에 확인한 어떤 API에도 없음. 운용사 페이지·KOFIA는 본문 미확인.
- `market.py`는 네트워크 실패 시 스냅샷 가격으로 폴백하도록 돼 있어, 네이버 차단 시 동작은 멈추지 않고 가격만 오래된 값이 된다(코드 docstring) [N1].

## 미확인 · 열린 질문
- 네이버 polling/ac 엔드포인트의 호출 빈도 제한 수치, 변경·차단 이력(공식 채널 없음).
- 해결(2026-10-27): 네이버 약관 해당 조항 위치 — 조 번호 없음, "주의사항" 소제목 아래 불릿 6번째 항목 [N2]. 개인 비상업 하루 수십 회 호출이 "사람의 실제 이용 전제"에 반하는지는 해석 문제(여기서 판단하지 않음).
- 해결(2026-10-27): KRX Open API 신청 조건·인증키·호출 한도·약관 — 회원가입+관리자 승인, `AUTH_KEY` 헤더, 키당 일 10,000회, 1년, 비상업 목적만 [X3]. 데이터 갱신 시각·응답 필드 목록은 2026-10-27 재시도, 미확인(서버 렌더링 페이지에 없음, 개발 명세서는 별도 다운로드 파일).
- data.krx.co.kr 화면의 로그인 필요 범위 — 2026-10-27 재시도, 부분 해결: ETF 다운로드 항목은 확인 [X4]. 로그인 없이 되는 메뉴 범위는 약관이 "비회원은 일부 서비스"로만 적어 미확인(메뉴별 시험은 약관 제10조 자동화 금지와 2026-10-26 차단 경험 때문에 하지 않음).
- 공공데이터 ETF API의 실제 응답 샘플(키 발급 후 확인 필요)과 "실시간" 메타데이터 표기 불일치의 의미.
- KOFIA ETF 공시, 운용사 iNAV 페이지의 제공 항목·자동 조회 가능 여부.
- 해결(2026-10-27): FDR의 ETF 일별 시세 소스 — 기본 네이버 `fchart.stock.naver.com/sise.nhn`, `KRX:` 접두어는 data.krx.co.kr `getJsonData.cmd` [L3]. pykrx ETF 데이터는 data.krx.co.kr [L1].

## 출처 (열어본 페이지만, 날짜)
- [N1] 저장소 `tools/market.py` (2026-10-26)
- [N2] 네이버 서비스 이용약관(시행일자 2026-10-01) — https://policy.naver.com/rules/service.html (2026-10-26, curl로 읽음; 2026-10-27 원문 HTML에서 조항 위치 재확인)
- [N3] 직접 호출: https://finance.naver.com/robots.txt, https://m.stock.naver.com/robots.txt, https://polling.finance.naver.com/robots.txt, https://ac.stock.naver.com/robots.txt, https://polling.finance.naver.com/api/realtime/domestic/stock/069500, https://ac.stock.naver.com/ac?q=KODEX%20200&target=stock, https://m.stock.naver.com/api/stock/069500/basic (2026-10-26)
- [D1] 공공데이터포털 금융위원회_증권상품시세정보 — https://www.data.go.kr/data/15094806/openapi.do (2026-10-26); 검색 목록 https://www.data.go.kr/tcs/dss/selectDataSetList.do?dType=API&keyword=증권상품시세정보 (2026-10-26)
- [D2] 공공데이터포털 금융위원회_주식시세정보 — https://www.data.go.kr/data/15094808/openapi.do (2026-10-26)
- [D3] 공공데이터포털 금융위원회_지수시세정보 — https://www.data.go.kr/data/15094807/openapi.do (2026-10-26)
- [X1] KRX 정보데이터시스템 ETF 메뉴(접속 제한 안내 페이지 수신) — https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201030101 (2026-10-26)
- [X2] KRX Open API — https://openapi.krx.co.kr/ (2026-10-26, 제목만 렌더링)
- [L1] sharebook-kr/pykrx README·`pykrx/website/krx/etx/core.py`·`krxio.py`·저장소 메타(마지막 커밋 2026-09-30) — https://github.com/sharebook-kr/pykrx (2026-10-26; `krxio.py`는 2026-10-27)
- [L2] FinanceData/FinanceDataReader README·저장소 메타(마지막 커밋 2026-05-13) — https://github.com/FinanceData/FinanceDataReader (2026-10-26)
- [L3] FinanceDataReader 소스 `src/FinanceDataReader/data.py`·`naver/data.py`·`naver/listing.py`·`krx/data.py` — https://github.com/FinanceData/FinanceDataReader (2026-10-27)
- [X3] KRX Open API 서비스 소개·이용방법·이용약관(국문)·서비스 목록·ETF 일별매매정보·데이터 수신방법 — https://openapi.krx.co.kr/contents/OPP/INFO/OPPINFO001.jsp , .../OPPINFO003.jsp , .../OPPINFO002.jsp , https://openapi.krx.co.kr/contents/OPP/INFO/service/OPPINFO004.cmd , https://openapi.krx.co.kr/contents/OPP/USES/service/OPPUSES003_S2.cmd?BO_ID=nrEpCLaZpoLCTzPUMxuF , https://openapi.krx.co.kr/contents/OPP/DATA/OPPDATA003.jsp (2026-10-27)
- [X4] KRX Data Marketplace 메인·이용안내·홈페이지 이용약관 — https://data.krx.co.kr/contents/MDC/MAIN/main/index.cmd , https://data.krx.co.kr/contents/MDC/INFO/informationController/MDCINFO002.cmd , .../MDCINFO003.cmd (2026-10-27)
- 열어봤으나 본문을 못 읽은 페이지: https://dis.kofia.or.kr/websquare/index.jsp?w2xPath=/wq/fundann/DISFundAnnETF.xml , https://www.samsungfund.com/etf/product/view.do?id=2ETF01 , https://www.data.go.kr/data/15150946/openapi.do(주식발행공시, 무관), https://www.data.go.kr/data/15151192/openapi.do(ESG증권상품, 무관) — 2026-10-26

## 변경 이력
- 2026-10-26: 초기 작성
- 2026-10-27: 후속 조사. KRX Open API(신청·키·일 10,000회·1년·비상업·ETF 일별매매정보), data.krx.co.kr ETF 메뉴·다운로드·약관 제10조, FDR·pykrx ETF 소스(네이버 fchart / data.krx.co.kr), 네이버 약관 조항 위치(번호 없음) 반영
