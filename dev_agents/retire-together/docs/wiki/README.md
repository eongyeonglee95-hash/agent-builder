# llm-wiki — 리서치 위키

규칙·지식 중 "조사해서 알아낸 것"을 둔다. 제품 규칙은 `docs/*_RULES.md`, 숫자의 원천은 `rules/*.yaml`.
쓰고 갱신하는 절차는 `/wiki-research` 스킬 (`.claude/skills/wiki-research/SKILL.md`). 재확인(update)은 `wiki-updater` 에이전트(Sonnet).
페이지 끝 "우리 적용" 블록은 YAML 후보 값이다. YAML·RULES 반영은 사용자 확인 뒤.

## 목차
### strategies/ — 투자 룰 (저자별)
- `dalio-all-weather.md` — 달리오 올웨더. YAML의 30/40/15/7.5/7.5는 로빈스 책의 All Seasons 버전 (2026-10-26 초안)
- `kim-sungil-k-all-weather.md` — 김성일 K-올웨더(『ETF 처음공부』·『마법의 연금 굴리기』 개정판) 6자산 (2026-10-26 초안)
- `parkgomhee.md` — 박곰희 포트폴리오 수비형·공격형 (2026-10-26 초안)
- `principles-from-books.md` — 리밸런싱 원칙 8개, REBALANCING_RULES §4 설명 재료 후보 (2026-10-26 초안)

### products/ — ETF·계좌 상품
- `holdings-classification.md` — 보유 9종목 자산군·역할 근거, ACE 종합채권 듀레이션 (2026-10-26 초안)
- `long-bond-commodity-candidates.md` — 장기채·중기채·원자재 후보, 연금저축·퇴직연금 적격 (2026-10-26 초안)

### sources/ — 제도·데이터 출처
- `tax-rules-sources.md` — TAX_RULES 항목별 조문 대조, 수정 제안, 매년 1월 점검 루틴 (2026-10-26 초안)
- `pension-account-rules.md` — IRP 70% 한도 현황, 연금저축·ISA 상품 범위, 2027 개정 예정 (2026-10-26 초안)
- `broker-apis.md` — 미래에셋·KIS·키움 API의 연금계좌 지원 범위 (2026-10-26 초안)
- `market-data-sources.md` — 네이버·공공데이터포털·KRX·pykrx 시세 소스 비교 (2026-10-26 초안)
- `pension-knowledge-sources.md` — 연금저축·IRP·ISA 믿을 만한 출처: 공공기관·연구소·저자·유튜버, 2026년 위주, 쉽게 (2026-10-27 초안)
