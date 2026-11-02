# 화면 테마 참고 리서치 — 스프레드시트 · 금융 앱 · shadcn 테마

조사일: 2026-10-28 · 범위: Tailwind CSS + shadcn/ui로 바꾸면서 "엑셀처럼 여는 통합 문서(요약 / 보유종목 / 자산 / 리밸런싱 탭)"와 "다른 버전으로 보기"에 쓸 색·글꼴·표 규칙.
원칙: 출처 글에서 확인한 값만 적는다. 화면 이미지는 보지 못했다. 공식 문서가 아니라 제3자가 추정한 값은 "비공식"이라고 표시하고, 확인하지 못한 것은 "확인 못 함"으로 적었다.
겹치지 않게: 증권사 화면의 정보 순서는 `STOCK_APPS_REFERENCE.md`, Robinhood는 `ROBINHOOD_DEEP_DIVE.md`에 있다. 이 문서는 색·글꼴·표 모양만 다룬다.

## 한 줄 요약
회색 10단계와 빨강·파랑은 토스 디자인 시스템(TDS) 공개 문서의 값을 그대로 쓸 수 있다. 다만 TDS red500·blue500은 흰 바탕에서 대비가 3.71:1이어서, 13px 표 숫자에는 한 단계 진한 700(5.26 / 5.41:1)을 쓴다. 글꼴은 Pretendard(OFL, Inter 기반)를 쓰고 숫자는 고정폭으로 맞춘다. shadcn 기본 모양이 나는 이유는 대부분 기본값(14px 글자, `p-2` 칸, `hover:bg-muted/50`, 무채색 neutral 회색, 0.625rem 모서리)을 그대로 두기 때문이다. 이 값들을 우리 토큰으로 바꾸면 기본 모양에서 벗어난다.

---

## A. 스프레드시트형 제품

**무엇을 봤나**
- **excelstock.kr**: 엑셀 창을 통째로 흉내 낸다. 파일 이름 제목줄(`…KPI_종합보고_6월마감.xlsx`)과 자동 저장 토글, 리본 탭(파일·홈·삽입…), 리본 묶음(클립보드·글꼴·맞춤…), 칸 주소 상자 `A2`와 `fx`, 열 문자 A–L과 줄 번호 1–200이 있다. 표 머리는 `종목 | 현재가 | 등락액 | 등락률 | 거래대금 순 | 시가총액`이고, 값은 `1,487,000원 | +146,000원 | +10.89%`처럼 단위와 부호를 붙여 적는다. 엑셀이 아닌 요소(지수 띠, 차트, 댓글)도 함께 있다. 색과 CSS는 글로 추출되지 않아 확인 못 함. [excelstock.kr](https://excelstock.kr) (2026-10-28 열람)
- **Google Sheets**: 기본 줄 높이가 21px이라는 설명이 여러 곳에 있지만 모두 제3자 글이다. 기본 격자선 색의 hex 값은 찾지 못했다. [thebricks — row height](https://thebricks.com/resources/guide-how-to-see-row-height-in-google-sheets) (2025, 비공식)
- **Excel**: 2023년 중반부터 기본 글꼴이 Aptos Narrow 11이다. 좁은 글꼴이라 칸 안에 숫자가 더 많이 들어간다. [Office Watch, 2023](https://office-watch.com/2023/excel-365-new-default-styles/). 기본 줄 높이 15pt(글자 크기 + 4pt)라는 말은 포럼 글에만 있어 확인 못 함 ([Xero product ideas](https://productideas.xero.com/forums/967133-reports-tax/suggestions/49964172-reporting-excel-export-adjust-default-row-heigh)).
- **Airtable**: 줄 높이를 Short / Medium / Tall / Extra Tall 네 단계로 고르고, 새 보기는 가장 촘촘한 Short가 기본이다. 머리줄 높이는 줄 높이와 따로 조절한다. [Airtable 지원 — Grid view](https://support.airtable.com/docs/airtable-grid-view) (날짜 표기 없음, 2026-10 열람)
- **Notion**: 2022-04-14부터 줄바꿈을 열마다 켜고 끈다(열 머리 → "Wrap column"). 줄 높이와 격자선 설정은 확인 못 함. [Notion 릴리스 2022-04-14](https://www.notion.com/releases/2022-04-14)
- **Quadratic**: Rust/WASM에 WebGL 캔버스로 격자를 그리고 60fps를 목표로 한다고만 적혀 있다. 표 모양에 관한 설계 글은 찾지 못했다. [quadratichq.com/technology](https://quadratichq.com/technology)
- **Rows.com**: 디자인 관련 공식 글을 찾지 못했다(확인 못 함).
- **Kubera**(순자산 추적): "자산 하나 = 줄 하나 추가"이고, 줄마다 은행·증권 연결이나 시세를 붙일 수 있다. 리뷰에서는 "스프레드시트 같은 깔끔한 대시보드"라고 평한다. [Kubera 블로그](https://kubera.com/blog/using-excel-or-google-sheets-for-tracking-net-worth) (제조사 주장), [Jean Galea 리뷰](https://jeangalea.com/kubera-review)

**가져올 결정**
1. 엑셀 보기에는 칸 느낌(열 문자, 줄 번호, 격자, 선택 테두리, 칸 주소와 `fx`, 아래 시트 탭)만 가져온다. excelstock처럼 리본·파일 제목줄·자동 저장까지 흉내 내지는 않는다. 사용자도 "겉모양 흉내는 원하지 않음"이라고 했다(`SCREEN_REFERENCE.md` 2026-10-28).
2. 줄 높이는 Airtable처럼 촘촘한 것을 기본으로 한다. 엑셀 보기는 시트 기본값과 같은 21px대, "다른 버전"은 두 줄 종목 행에 맞춘다. 둘 다 머리줄 높이는 따로 둔다.
3. 금액 칸은 excelstock처럼 부호를 늘 붙인다(`+146,000`, `+10.89%`). 색을 못 보는 사람도 부호로 상승과 하락을 구분할 수 있다.
4. Kubera처럼 "새 자산 = 새 줄"로 한다. 지금 엑셀 보기의 "빈 줄이 늘 아래에 있음"과 같은 방식이다.
5. 숫자 칸은 오른쪽 정렬과 고정폭 숫자로 맞춘다. Tailwind의 `tabular-nums`는 `font-variant-numeric: tabular-nums`이고, 공식 예시에서도 합계 칸에 `text-right tabular-nums`를 함께 쓴다. [Tailwind — font-variant-numeric](https://tailwindcss.com/docs/font-variant-numeric)

## B. 금융 앱의 시각 체계

**무엇을 봤나**
- **토스 디자인 시스템(TDS) 색상** — 공개 문서이고 `@toss/tds-colors` 패키지로 배포된다. [TDS Mobile — Colors](https://tossmini-docs.toss.im/tds-mobile/foundation/colors/) (2026-10-28 열람)
  - grey50 `#f9fafb` · 100 `#f2f4f6` · 200 `#e5e8eb` · 300 `#d1d6db` · 400 `#b0b8c1` · 500 `#8b95a1` · 600 `#6b7684` · 700 `#4e5968` · 800 `#333d4b` · 900 `#191f28`
  - red500 `#f04452` · 600 `#e42939` · 700 `#d22030` · 800 `#bc1b2a` / blue500 `#3182f6` · 600 `#2272eb` · 700 `#1b64da` · 800 `#1957c2`
  - background `#FFFFFF`. greyBackground는 hex가 아니라 `lightThemeGrey100`이라는 이름으로만 적혀 있다(grey100 `#f2f4f6`으로 추정, 확인 못 함).
  - 회색은 순수 무채색이 아니라 푸른 기가 조금 섞인 회색이다(값에서 읽은 것). 투명도 회색(greyOpacity50~900)도 있다. 예: greyOpacity100 = `#022047` 5%.
- **TDS 타이포그래피** — 주 단계는 7개다. Typography 1~7 = 30/40, 26/35, 22/31, 20/29, 17/25.5, 15/22.5, 13/19.5(px, 글자/줄 높이). 사이에 sub 단계 13개가 더 있다(12/18, 11/16.5 등). 11px는 "건너뛰어도 되는 정보"용으로 적혀 있다. 글꼴 이름은 문서에 없다. [TDS Mobile — Typography](https://tossmini-docs.toss.im/tds-mobile/foundation/typography/)
- **Toss Product Sans** — 산돌과 함께 2020년 여름에 시작했다. 숫자·영문은 한글보다 살짝 두껍고 크게 그렸고, 4·1·7의 윗부분을 넓혔다. **고정폭 숫자와 가변폭 숫자를 둘 다 넣었고**, 실시간 수치나 주식 수처럼 바뀌는 숫자에는 고정폭을 쓴다. 외부 사용 라이선스는 글에 없어 확인 못 함. 따라서 우리는 쓰지 않는다. [토스피드, 2021-10-08](https://toss.im/tossfeed/article/beginning-of-tps)
- **Pretendard** — Inter(라틴) + 본고딕(한글) + M PLUS 1p(가나) 기반이다. 9가지 굵기와 가변 글꼴이 있고 SIL OFL이라 상업적으로 써도 된다. 권장 글꼴 목록은 `"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Helvetica Neue", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", …이모지…, sans-serif`이다. 가변 다이내믹 서브셋이 가장 가볍다. [GitHub orioncactus/pretendard](https://github.com/orioncactus/pretendard) (v1.3.9). tnum(고정폭 숫자) 지원 여부는 문서에서 확인 못 함. Inter가 tnum을 가지고 있어서 될 가능성이 높지만, 실제 화면에서 확인해야 한다.
- **Wanted Sans** — 원티드랩, 한글은 본고딕 기반, OFL-1.1, 7가지 굵기와 가변 글꼴. 숫자 기능은 확인 못 함. [GitHub wanteddev/wanted-sans](https://github.com/wanteddev/wanted-sans). **SUIT**는 이번에 열어 보지 못했다(확인 못 함).
- **Linear**(무채색 규율) — 테마 변수 98개를 **기본색·강조색·대비** 3개로 줄였다. HSL 대신 LCH로 계산해 같은 명도가 색상과 관계없이 비슷한 밝기로 보이게 했다. 강조색(파랑)이 전체 색 계산에 주는 영향은 **일부러 줄였다**. 라이트 모드의 글자와 아이콘은 더 진하게 했다. [Linear, 2024-03-28](https://linear.app/now/how-we-redesigned-the-linear-ui)
- **Sharesight** — 성과 보고서는 총수익을 자본이득 / 배당 / 환차익으로 나눠 금액과 %로 보여 주고, %와 금액을 토글로 바꾼다. Excel·Google Sheets로 내보낼 수 있다. [Sharesight 블로그](https://www.sharesight.com/blog/track-your-investments-with-sharesights-performance-report/)
- **Mercury · Ramp** — 공식 디자인 글은 찾지 못했다. 제3자가 역추적한 값(Mercury 남색 `#5266eb`, Ramp 형광 노랑 등)은 출처마다 서로 달라 쓰지 않는다. ([shadcn.io/design/mercury](https://www.shadcn.io/design/mercury), [kombai Ramp](https://kombai.com/gallery/design-systems/ramp-kombai/) — 비공식). 공통적으로 "거의 흑백 + 강조색 하나"라고 설명하지만 확인 못 함.
- **Copilot Money · Monarch** — 이번 조사 범위에서 열지 못했다(확인 못 함).

**가져올 결정**
1. 회색은 TDS 10단계를 **TDS 이름 그대로** 쓴다. 다른 이름으로 바꿔 부르면 출처를 대조하기 어렵다(아래 "현재 theme.css와 다른 점" 참고).
2. 보조 글자는 grey600 `#6b7684`(흰 바탕 대비 4.62:1)를 쓴다. grey500 `#8b95a1`은 3.04:1이어서 13px 글자에는 부족하다. 대비 값은 WCAG 공식으로 직접 계산했다.
3. 상승은 빨강, 하락은 파랑이다. 표 안의 작은 숫자에는 red700 `#d22030`(5.26:1)과 blue700 `#1b64da`(5.41:1)를 쓴다. 큰 요약 숫자(22px 이상)에는 500을 써도 된다(3.71:1, 큰 글자 기준 3:1 이상).
4. 강조색은 Linear처럼 하나만 두고 적게 쓴다. 파랑은 하락에 이미 쓰고 있으므로 버튼에 파랑을 쓰지 않는다. 주 버튼은 진한 글자색(grey900)으로 칠한다.
5. 숫자는 Toss Product Sans 글의 기준을 따른다. 표·목록처럼 위아래로 비교하는 숫자는 고정폭, 혼자 크게 보여 주는 합계는 가변폭이어도 된다.
6. 요약 한 줄은 Sharesight처럼 "총손익 = 평가손익 + 배당" 식으로 분해할 수 있게 둔다. 계산은 엔진이 하고 화면은 표시만 한다.

## C. shadcn/ui를 기본 모양에서 벗어나게 테마하기

**무엇을 봤나**
- **공식 테마 방식** — 컴포넌트는 역할 변수(`background/foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `chart-1~5`, `sidebar-*`, `radius`)만 참조한다. Tailwind v4에서는 `@theme inline`에서 `--color-primary: var(--primary)`처럼 연결하고, 반경 단계는 `--radius`에서 계산한다. 새 토큰은 `:root`와 `.dark`에 정의한 뒤 `@theme inline`에 노출한다. 기본 회색 계열은 Neutral·Stone·Zinc·Mauve·Olive·Mist·Taupe 중에서 고른다. [shadcn — Theming](https://ui.shadcn.com/docs/theming) (2026-10-28 열람)
- **기본값(= "shadcn 티"의 근원)** — `--radius: 0.625rem`, `--background: oklch(1 0 0)`, `--foreground: oklch(0.145 0 0)`, `--primary: oklch(0.205 0 0)`. 모두 채도 0인 무채색이다. [같은 문서](https://ui.shadcn.com/docs/theming)
- **Table 기본 클래스** — Table `w-full caption-bottom text-sm`(14px), TableHead `h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground`, TableCell `p-2 align-middle whitespace-nowrap`, TableRow `border-b transition-colors hover:bg-muted/50 … data-[state=selected]:bg-muted`. [shadcn-ui/ui table.tsx (new-york-v4)](https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/table.tsx). Data Table은 TanStack Table 위에 만든다. [shadcn — Data Table](https://ui.shadcn.com/docs/components/data-table)
- **Tailwind v4 색 덮어쓰기** — `@theme { --color-*: initial; }`로 기본 팔레트를 통째로 지운 뒤 필요한 색만 정의할 수 있다. 기본 팔레트의 일부만 지울 수도 있다(`--color-lime-*: initial`). 참고로 기본 `gray`는 푸른 기가 있는 OKLCH 값이다(예: gray-100 `oklch(96.7% 0.003 264.542)`). `neutral`은 채도 0이다(neutral-100 `oklch(97% 0 0)`). [Tailwind — Colors](https://tailwindcss.com/docs/colors)
- **tweakcn** — shadcn/ui와 Tailwind용 시각적 테마 편집기이고 프리셋이 있다는 것까지만 확인했다. 조절 항목과 내보내기 형식(v4 OKLCH 등)은 페이지가 글로 추출되지 않아 확인 못 함. [GitHub jnsahaj/tweakcn](https://github.com/jnsahaj/tweakcn)
- **shadcn 위에 테마를 입힌 유명 사이트 사례** — 출처가 있는 공식 사례 글은 찾지 못했다(확인 못 함).

**가져올 결정 (기본 모양에서 벗어나는 레시피)**
1. 회색을 무채색 neutral에서 TDS의 푸른 회색으로 바꾼다. 이것만으로도 "기본 shadcn" 인상이 가장 크게 바뀐다.
2. `@theme`에서 `--color-*: initial`로 Tailwind 기본 팔레트를 지운다. 그러면 `bg-purple-500` 같은 색은 코드에 쓸 수 없고, 쓸 수 있는 색은 우리 토큰뿐이다. 지금 CSS에 색이 529개나 쌓인 원인을 막는 장치가 된다.
3. Table 기본값을 덮어쓴다. 글자는 14px → 13px, 숫자 칸은 `text-right tabular-nums`, 머리줄은 `font-medium text-foreground` 대신 grey600 보조 글자로, 마우스를 올렸을 때 `hover:bg-muted/50` 대신 grey50, 선택 줄 `bg-muted` 대신 아래 선택색으로 바꾼다.
4. `--radius`는 0.625rem보다 작게 잡는다. 엑셀 보기 격자 안은 0으로 둔다.
5. 그림자를 쓰지 않는다. 면은 흰색과 grey100 바탕의 차이로만 나눈다(토스식, 사용자 메모와 같음).
6. `chart-1~5`는 쓰지 않고 자산군 6색 토큰으로 바꾼다.

---

## 우리 테마 제안

표기: **[출처]** 원문 값 · **[우리]** 우리가 정한 값(이유 함께) · 대비는 흰 바탕 기준 WCAG 계산값.

| 토큰 | 값 | 근거 |
|---|---|---|
| 글꼴 | `"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Helvetica Neue", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif` | [출처] Pretendard 권장 목록(이모지 글꼴은 생략) |
| 숫자 | 표·목록 `tabular-nums`, 큰 합계 하나는 기본 | [출처] Toss Product Sans 글 · [우리] Pretendard tnum은 화면에서 확인 필요 |
| 글자 7단계 | 12/18 · 13/19.5 · 15/22.5 · 17/25.5 · 20/29 · 22/31 · 30/40 (px) | [출처] TDS Typography 1·3·4·5·6·7 + sub12. [우리] 26은 빼고 표 머리·보조용 12를 넣음. 11px은 TDS가 "건너뛰어도 됨"으로 분류해서 뺌 |
| 회색 | grey50 `#f9fafb` · 100 `#f2f4f6` · 200 `#e5e8eb` · 300 `#d1d6db` · 400 `#b0b8c1` · 500 `#8b95a1` · 600 `#6b7684` · 700 `#4e5968` · 800 `#333d4b` · 900 `#191f28` | [출처] TDS |
| 역할 | 바탕 grey100 · 면 `#ffffff` · 글자 grey900(16.56:1) · 보조 글자 grey600(4.62:1) · 선 grey200 · 입력 테두리 grey300 · 비활성 글자 grey500 | [우리] TDS 값을 역할에 배정. 보조 글자를 grey500으로 하면 3.04:1이라 부족 |
| 주 버튼 | 바탕 grey900, 글자 흰색 | [우리] 파랑은 하락에 쓰므로 버튼과 겹치지 않게 |
| 강조색 1개 | 엑셀 초록 `#217346` — 엑셀 보기의 선택 테두리·현재 시트 탭에만 사용(5.82:1) | [우리] 기존 `sheet.css` 값을 유지. 이 값이 Excel 공식 색이라는 출처는 확인 못 함 |
| 상승(이익) | 표 숫자 red700 `#d22030`(5.26:1) · 큰 숫자 red500 `#f04452` · 옅은 바탕 red50 `#ffeeee` | [출처] TDS 값 · [우리] 크기별 단계 선택 |
| 하락(손실) | 표 숫자 blue700 `#1b64da`(5.41:1) · 큰 숫자 blue500 `#3182f6` · 옅은 바탕 blue50 `#e8f3ff` | [출처] TDS 값 · [우리] 크기별 단계 선택 |
| 오류 칸 | red700 글자 + red50 바탕 | [우리] 빨강을 따로 늘리지 않음. 상승 빨강과는 위치(칸 표시 삼각형)로 구분 |
| 자산군 6색 | 주식 `#5985ec` · 장기채 `#42b3aa` · 중기채 `#8ed2c8` · 금 `#e6ba69` · 원자재 `#d397b5` · 현금 `#b0b8c1` | [우리] 지금 화면에서 쓰는 값을 유지(출처 없음). **주의: 주식 파랑이 하락 파랑과 헷갈릴 수 있다.** 바꿀지는 사용자 결정 |
| 모서리 | 기본 6px(0.375rem), 시트 격자 0 | [우리] shadcn 기본 0.625rem보다 작게. 표가 중심인 화면이라 |
| 그림자 | 없음 | [우리] 토스식 평평한 면(사용자 메모) |
| 엑셀 보기 격자선 | grey200 `#e5e8eb` | [우리] 회색을 한 계열로 맞춤. 지금 `#e1e1e1`/`#d4d4d4`는 다른 계열의 회색 |
| 엑셀 보기 머리(열 문자·줄 번호) | 바탕 grey50, 글자 grey600 12px, 현재 선택한 열·줄은 grey200 바탕 | [우리] |
| 엑셀 보기 선택 | 테두리 2px `#217346`, 범위 선택 바탕은 초록을 옅게 | [우리] 옅은 초록 값은 기존 `#e8f2ec`. 출처 확인 못 함 |
| 줄 높이 | 엑셀 보기 28px(글자 13/19.5 + 위아래 여백), 다른 버전 두 줄 행 56px 이상 | [우리] Sheets 21px(비공식)보다 조금 크게. 한글 13px와 마우스 조작을 고려 |

**현재 `web/src/theme.css`와 다른 점(실제로 고칠지는 구현 담당이 판단)**
- `--gray-500: #b0b8c1`, `--gray-700: #8b95a1`, `--gray-800: #4e5968`은 TDS에서는 각각 grey400·500·700이다. 이름이 한 칸씩 어긋나 있고 grey600·800이 빠져 있다.
- `--muted-foreground: #8b95a1`은 3.04:1이다. grey600 `#6b7684`(4.62:1)를 권한다.
- `--up #f04452`·`--down #3182f6`은 13px 표 숫자에서 3.71:1이다. 표 안에서는 700 단계를 권한다.
- `--destructive: #e5484d`는 TDS 값이 아니다(출처 확인 못 함).
- 글자 단계 11px(`--text-2xs`)은 TDS가 "건너뛰어도 됨"으로 분류한 크기다.

## 피할 것
- 점이 달린 알약 배지, 그라데이션 아이콘·배경, 보라 그라데이션, 영문 머리글("OUR NEXT CHAPTER", "STAY WITH YOUR PLAN"), "왜 이렇게 했는지" 설명 카드(사용자 메모 2026-10-28). 지금 `App.tsx`에 `eyebrow`·`soft-icon`이 남아 있다.
- shadcn 기본값을 그대로 쓰는 것: 무채색 neutral, 0.625rem 모서리, 14px 표 글자, `hover:bg-muted/50`, `chart-1~5`.
- Tailwind 기본 팔레트를 열어 두는 것(`bg-blue-500` 같은 색이 다시 쌓인다). `--color-*: initial`로 막는다.
- 엑셀 리본·메뉴·파일 제목줄 흉내(excelstock식 전체 복제).
- 파랑을 버튼·링크·자산군·하락에 동시에 쓰는 것. 의미가 하나여야 한다.
- 화면마다 다른 회색(`#e1e1e1`, `#d4d4d4`, `#edf0f4`, `#f6f7f9` 등이 섞여 있음). 회색은 TDS 한 계열만 쓴다.
- 비공식 역추적 값(Mercury·Ramp hex)을 출처처럼 쓰는 것.

## 확인 못 한 것
- Google Sheets 격자선·선택색 hex, Excel 기본 줄 높이·격자선 색·초록 `#217346`의 공식 출처.
- excelstock.kr의 실제 색·글꼴(화면 이미지를 보지 못했다).
- Rows.com, Quadratic, Notion 표의 줄 높이·격자 설계 문서.
- Mercury, Ramp, Copilot Money, Monarch의 공식 색·글꼴. SUIT 글꼴.
- Pretendard·Wanted Sans의 tnum(고정폭 숫자) 지원 여부. Toss Product Sans의 외부 사용 라이선스.
- TDS greyBackground의 hex(`lightThemeGrey100`이라는 이름만 있음). TDS 다크 모드 값.
- tweakcn의 조절 항목·내보내기 형식. shadcn을 커스텀 테마로 쓴 공식 사례 글.
