# 로그인 첫 화면 배경 생성 기록

- 생성일: 2026-11-07
- 방식: 내장 image_gen 도구, 새 이미지 생성(photorealistic-natural). 별도 API 키/CLI 미사용.
- 용도: 로그인 진입 화면의 바다·두 사람 배경. 사용자 제공 웹 화면은 배치/분위기 참고이며 인물 신원·문구·브랜드를 복제하지 않았다.
- 최종 자산: `web/public/retirement-coast-login-v1.png`
- 원본: `/Users/eongyeonglee/.codex/generated_images/01a1b134-f7de-7c11-b16f-9c2010a43ddb/exec-80b6d772-f748-4c21-9216-04385dd8f5e7.png`
- 검수: 두 사람이 벤치에 앉아 바다를 보는 구도, 텍스트/로고 없는 이미지 확인. 웹에서는 CSS로 명도·크롭만 조정.
- 화면 확인: `http://127.0.0.1:5180/?view=welcome`. 로그인한 사용자는 ‘나의 가계 노트 열기’로 돌아가며 세션을 유지한다. 비로그인 사용자는 기존 Google 인증을 거친다.

## 로고 리디자인

- 이름: 나란한 내일. 두 사람의 머리·연결된 어깨 곡선과 하나의 수평선으로 구성한다.
- 심볼 원본: `web/src/assets/retire-together-mark.svg`. 로고는 기존 벡터 시스템에 맞춰 코드로 제작했으며 이미지 생성 도구로 만들지 않았다.
- 워드마크: 공용 `Brand` 컴포넌트의 ‘둘이서 은퇴’ 표기와 `brand.css`. 기존 주색·배경 설정은 보존하며 이전 로고 선택은 버전 2의 새 기본 심볼로 이전한다.
- 적용 위치: 로그인, 공용 앱 헤더/사이드바/풋터, 파비콘. 단색 SVG라 밝고 어두운 배경에서 각각 브랜드 색/흰색을 쓴다.

## 최종 프롬프트

```text
Create a cinematic editorial photograph for the full-screen login hero of "Retire Together", a Korean couple's retirement planning app. Landscape composition, 16:9.
Scene: a quiet beautiful coastal overlook in Korea at the end of a summer afternoon, muted teal sea, distant hazy islands, natural grasses, weathered wood deck and a simple wooden bench. A relaxed Korean couple in their late 50s/early 60s sit close together on the bench, seen from behind, looking out to the sea, wearing understated cream and soft sage casual linen clothes. Authentic, intimate, hopeful everyday retirement, no luxury staging.
Composition: wide environmental photograph. The couple and bench are in the lower middle around 46% horizontal and 75% vertical, modestly sized so the beautiful landscape dominates. Leave the upper-left 50% mostly quiet sky and distant sea, with low visual detail for large white website headline text to be placed later. Keep the right 35% calm sea/soft foliage for an overlaid login panel. Horizon near 45% height, warm sunlit edge, gently dark pine foreground.
Style: premium travel magazine photography, natural anatomy, subtle film grain, realistic sea and linen textures, subdued pine-green, sea teal, warm sand and pale golden light. Beautiful natural light, not oversaturated, no dramatic orange sunset.
No text, no typography, no UI, no logos, no watermarks, no borders. Generate only the background photograph.
```
