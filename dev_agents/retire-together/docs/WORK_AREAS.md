# 작업 영역 — 세션이 겹치지 않게 (2026-11-02 사용자 요청)

리밸런싱·주식·부동산·은퇴를 서로 다른 세션이 동시에 작업할 때 **각자 자기 영역 파일만** 고친다. 공통 파일은 작게, 고치기 전에 `DEV_HANDOFF.md`에 한 줄 남긴다.
경로는 `dev_agents/retire-together/` 기준. 담당 세션이 바뀌면 이 표를 고친다.

## 영역별 파일

| 영역 | 화면 (`web/src/`) | 스타일 | 서버·계산 | 테스트 | 브라우저 테스트 포트 |
|---|---|---|---|---|---|
| **리밸런싱** | `workbook/RebalancePlan.tsx`, `rebalance-page.tsx`, `rebalance.tsx`(CSV 미리보기) | `rebalance.css` | `backend/plan.py`, `backend/portfolio.py`, `backend/rebalance.py`, `backend/workbook.py`의 rebalance·decision 부분, `tools/rebalance.py`·`strategy.py`·`explain.py`·`order_sheet.py`·`decisions.py`, `rules/strategies.yaml`, `agent/` | `test_plan.py`, `test_portfolio.py`, `test_rebalance*.py`, `test_workbook.py`, `test_agent*.py`, `test_safety.py` | `RETIRE_E2E_PORT=8771` |
| **주식** | `stocks.tsx`, `holdings.tsx` | `stocks.css`, `holdings.css` | `backend/holdings.py`, `tools/holdings.py`, `tools/market.py`, `rules/holdings.yaml` | `test_holdings.py`, `test_market.py` | `8772` |
| **부동산** | `property.tsx`, `property-entry.tsx`, `property-move/*` | `property-workspace.css`(예전 화면), `property.css`(입력), `property-move/property-move.css`(갈아타기) | `backend/property.py`, `backend/property_move.py`, `tools/property.py`, `tools/property_move.py` | `test_property*.py`, `e2e/property-move.spec.ts` | `8773` |
| **은퇴** | `retirement/*`, `workbook/retirement.tsx` | `retirement/retirement-tower.css` | `backend/retirement.py`, `tools/pension.py`, `rules/pension.yaml` | `test_pension.py`, `test_retirement_api.py`, `e2e/pension-tower.spec.ts` | `8774` |

## 공통 (여러 영역이 같이 쓴다 — 고치기 전 DEV_HANDOFF에 한 줄)

- 틀: `App.tsx`(페이지마다 **한 줄**만 — `{page === 'x' && <XPage …/>}`. 페이지 내용은 영역 파일에), `main.tsx`, `workbook/Workbook.tsx`(시트 탭 연결만), `workbook/ReadGrid.tsx`
- 디자인: `theme.css`(토큰·CSS 불러오기 순서), `styles.css`·`workspaces.css`·`experience.css`(예전 화면 공통), `components.tsx`, `components/ui/*`
- 데이터: `model.ts`, `local-data.ts`, `backend/main.py`(라우터 한 줄씩), `backend/storage.py`·`ledger.py`·`registration.py`, `rules/accounts.yaml`·`asset_map.yaml`
- 등록·홈·내 정보: `register*`, `sheet*`, `google.tsx`, `home.tsx`, `forms.tsx`, `accounts.tsx`
- 공용 브라우저 테스트 `e2e/app.spec.ts` — 새 테스트는 영역 파일 `e2e/<영역>.spec.ts`에 만든다

## 규칙

1. 새 스타일은 영역 CSS에. 클래스 이름은 영역 접두어로 시작한다(리밸런싱 `rb-`·`strategy-`·`allocation-`, 주식 `stock-`·`position-`·`news-`, 부동산 `property-`·`pe-`·`home-`, 은퇴 `pension-`·`tower-`). 공통 클래스를 영역 화면에서 다르게 보이게 하려면 영역 CSS에서 영역 클래스와 함께 덮어쓴다(공통 규칙은 그대로).
2. Tailwind 화면(워크북 쪽)은 `theme.css` 토큰만 쓴다. 토큰을 더하는 건 공통 변경이다.
3. 커밋은 자기 영역 파일만 경로를 지정해 담는다(`git add <경로>`). 다른 세션의 미커밋 변경을 같이 담지 않는다.
4. 개발 서버는 하나(http://127.0.0.1:5180, `scripts/dev-web.sh`). 브라우저 테스트는 위 표의 영역 포트를 쓴다.
5. `CHANGELOG.md`·`DEV_HANDOFF.md`·`DECISIONS.md`는 쓰기 직전에 다시 읽고 자기 줄만 더한다.

## 나눈 기록

- 2026-11-02 Claude: 예전 화면 CSS를 영역별로 나눔 — `styles.css`에서 리밸런싱 규칙 73개를 `rebalance.css`로, `workspaces.css`에서 주식 87개를 `stocks.css`·부동산 107개를 `property-workspace.css`로. 여러 영역 이름이 섞인 규칙은 공통에 남김. 규칙 본문 1,115개가 옮기기 전후 같고, 예전 화면 20장(5개 페이지 × 예시/실제 × 1440/390) 스크린샷이 픽셀 단위로 같음을 확인(다른 세션의 동시 변경 화면 제외). 예전 리밸런싱 페이지 내용을 `App.tsx`에서 `rebalance-page.tsx`로 옮김.
