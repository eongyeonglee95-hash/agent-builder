# 전체 화면 디자인 시스템 점검 — 2026-11-23

## 범위와 적용

전체 web/src TSX·CSS 소스를 점검했다. 홈, 자산, 연금, 리밸런싱, 주식, 부동산, 가계부, 워크북, 연결·초대·등록 폼을 대상으로 공통 요소를 수정했다.

- 구형 primary/secondary/danger 버튼 86개를 공통 Button으로 이전했다.
- 일반 입력 73개를 Input으로, HTML 선택창 38개를 NativeSelect로 이전했다. ReadGrid 셀 편집기는 별도 유지한다.
- 기본 팔레트와 같은 직접 지정 색, 구형 본문·선·바탕 색을 theme.css 역할 토큰으로 연결했다.
- 10–24px 범위의 일반 본문 크기를 공통 글자 토큰에 맞췄다. 큰 금액·로고·그래픽은 기존 계층을 유지한다.
- 공통 Button의 배경/전경 조합이 구형 CSS에 덮이지 않도록 호환 규칙을 추가했다.
- 기준 집·조회 기간을 같은 줄에 놓고 공통 Select를 사용했다.
- 디자인 견본의 실제 글자 크기 설명을 수정하고 NativeSelect 견본을 추가했다.

## 검증 범위

전용 임시 데이터 서버에서 1440px/390px, 주요 9개 경로를 방문해 화면 캡처·런타임 오류·공통 버튼 적용·글자/배경 구분을 확인한다. 견본 입력과 선택 변경도 확인한다. 실제 사용자 구글 시트 데이터와 모든 팝업 상태를 재현한 검증은 아니다.

## 유지한 전용 동작

표 셀 편집기, 체크박스·라디오·파일·범위 입력, 지도 마커, 차트 범례, 내비게이션 버튼은 일반 저장 버튼과 역할이 다르다. 네이티브 요소 자체는 결함으로 취급하지 않는다.

## 남아 있는 개별 색상 — 완전 통합으로 오인하지 않기

아래는 직접 색상 지정의 잔여 위치다. 브랜드·지도·차트·일러스트 및 과거 화면 스타일이 섞여 있다. 숫자는 위반 확정 수가 아니라 추가 검토 대상 수다. 전체 CSS가 100% 토큰화되었다고 보지 않는다.

| 파일 | 직접 색 지정 |
|---|---:|
| `web/src/styles.css` | 238 |
| `web/src/property-workspace.css` | 111 |
| `web/src/stocks.css` | 77 |
| `web/src/register.css` | 61 |
| `web/src/experience.css` | 56 |
| `web/src/sheet.css` | 48 |
| `web/src/rebalance.css` | 45 |
| `web/src/property.css` | 24 |
| `web/src/shell-theme.css` | 15 |
| `web/src/property-move/research-board.css` | 13 |
| `web/src/register.tsx` | 10 |
| `web/src/components.tsx` | 9 |
| `web/src/property-move/InterestMap.tsx` | 9 |
| `web/src/property-move/ResearchBoard.tsx` | 6 |
| `web/src/holdings.css` | 3 |
| `web/src/App.tsx` | 1 |
| `web/src/holdings.tsx` | 1 |
| `web/src/brand-mode.css` | 1 |

## 실행 결과

- 프로덕션 빌드 통과.
- 공통 디자인 브라우저 검사 2개 통과: 9개 경로 × 1440/390px 캡처, 런타임 오류 없음, 버튼 전경/배경 구분, 입력·선택 변경.
- 기존 asset-management 검사 중 2개는 이미 사라진 `자산 관리` 버튼을 찾다가 실패. 현재 메뉴는 `표로 보기`이며 이번 작업에서 이름을 바꾸지 않았다. 이 결과를 전체 테스트 통과로 표기하지 않는다.
- 캡처 검토 중 소유자 선택창에 테두리가 두 겹이 된 것을 확인해 외부 장식 테두리·중복 화살표를 제거했다.
