"""tools — Agent가 호출하는 도구. 순수 함수. LLM은 계산하지 않는다.

워크플로우 순서 (docs/AGENT_DESIGN.md §1):
  0. assets.load_accounts / load_pools   계좌·풀(합산/계좌별, 리밸런싱/매수만) 선택
  1. parse_balance.parse_capture / load_holdings_csv   캡처·CSV → 보유 내역 (처음 등록·수량 변경 때만)
  2. market.resolve_ticker / fetch_prices   종목코드, 오늘 현재가 (공개 시세, 매번)
  3. assets.tag_holdings / check_constraints   자산군 태깅, 레버리지·인버스 검증
  4. strategy.load_strategy   목표 비율·임계치·최소 거래 (rules/strategies.yaml)
  5. rebalance.compute_rebalance   비중·편차·발동·매도/매수 수량  ← 핵심 엔진
  6. order_sheet.orders_table / classes_table   주문표·비율 표
  7. explain.headline / why_now   "왜 지금" (템플릿 → 회의 후 Agent 생성)
  8. decisions.record_decision / read_decisions   수락·거절·사유 기록, 다음 제안에 반영
  9. (2단계) 자동주문 — 없음, 드라이런만

  store.save_holdings / load_holdings   계좌별 스냅샷 파일 저장·최신 합치기
  register.main   캡처 → 파싱 → 종목코드 → CSV·엑셀 (처음 등록)
  cli.main   위 순서를 한 줄 명령으로 (전략 → 비율 → 주문표 → 설명)
"""
