# 요리 Agent — 오늘의 식탁 (수리)

PLUS US 요리 Agent 실습 폴더. 집·회사 어디서든 이어서 작업할 수 있게 git에 올린다.
둘이서은퇴(retire-together) 제품과는 관계없는 개인 실습이다.

## 원본 기획 (노션)

- [PLUS US — 요리 Agent](https://app.notion.com/p/PLUS-US-Agent-4062d2f5eb908181a4aacc62b9b97f8a) — 상위 페이지. 요리 전문가 풀 20명 조사, 주간 팔로우업, A·B·C 시안 고민
- [오늘의 식탁 — 가족일정형 요리 서비스 상세 기획 v0.1](https://app.notion.com/p/v0-1-4072d2f5eb90813b8a4df2d3c000ff23) — C안(가족 일정형) 상세 기획. 2026-10-28 초안
- [전문가 마스터 DB](https://app.notion.com/p/a2e511f957f94c85be482550b612a09e) — 한 행 = 전문가 1명. 채널·도서·협의 창구·분류 태그

기획 요약은 [PLAN.md](PLAN.md). 노션이 원본이고, PLAN.md는 작업할 때 빨리 보려는 정리본이다. 둘이 다르면 노션을 따른다.

## 폴더 구성

| 경로 | 내용 |
| --- | --- |
| `PLAN.md` | 상세 기획 v0.1 정리 (시나리오, 화면, 판단표, MVP 범위, 검증 가설) |
| `prototype.html` | A·B·C 시안 이미지를 보고 만든 첫 체험용 목업. 브라우저로 바로 연다 |
| `sample-images/` | A(전문가와 함께)·B(취향으로 찾는)·C(가족 일정에 맞춘) 시안 이미지 |

## 진행 상황 (2026-10-28)

- [x] 시안 이미지 3장 기반 목업 (`prototype.html`)
- [x] 상세 기획 v0.1 정리 (`PLAN.md`)
- [ ] 목업을 C안 기준으로 고도화 — 과업 T1~T5가 실제로 진행되는 모바일 웹 프로토타입
- [ ] 수리 판단 규칙(5장)을 코드로 분리하고, LLM은 설명 문장·질문 응답에만 사용
- [ ] Claude API 키 등록 후 대화 부분 연결
- [ ] 오픈베타플랫폼 v2(`~/lifeCanvasLab/open-beta-platform-v2`) 등록 방식 확인 — 1단계 아이디어 트랙(A·B·C 투표), 2단계 디지털 프로덕트 트랙(C안 MVP)

## 관련 위치

- 처음 작업한 곳: `~/lifeCanvasLab/agent-canvas/workspace/cooking-agent/` (회사 PC에만 있음, 이 폴더가 최신)
- 오픈베타플랫폼 v2: `~/lifeCanvasLab/open-beta-platform-v2/`
