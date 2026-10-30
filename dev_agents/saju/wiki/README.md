# 명리 위키 (llm-wiki)

사람이 읽고 고치며, 나중에 해석 에이전트가 근거로 쓰는 명리학 지식. `research/`는 시장·기술 조사, `wiki/`는 명리 자체의 지식이다.

## 원칙

- **출처 우선순위**: 고전 원문(공유영역) → 학술 논문·학위논문 → 현대 저자 본인의 책 소개·강의 → 블로그(단서로만, 인용 안 함). 열어서 읽은 것만 인용한다.
- **학파 차이를 숨기지 않는다**: 같은 개념에 학파마다 다른 규칙이 있으면 나란히 적고, 우리가 고른 기본값은 "우리 적용"에만 쓴다.
- **책·번역서 내용은 요약**: 직접 인용은 15단어 이내 한 번. 현대 번역·해설서 문장은 옮기지 않는다(저작권, `research/04` 참고).
- **제안과 결정 분리**: 페이지 끝 "우리 적용"은 해석표 YAML(`rules/` 예정)에 들어갈 후보 값이다. 사용자 확인 전까지 후보.
- **예측·단정 표현 금지**: "이 사람은 이혼한다"가 아니라 "고전은 X 구성을 Y로 해석한다".
- 예시 사주는 라이브러리로 계산해 확인한 값만 쓴다(`research/03`).

## 페이지 형식 (`wiki/<폴더>/<slug>.md`)

```
# <제목>
기준일: YYYY-MM-DD · 상태: 초안 | 확인됨
## 요약 (5줄 이내)
## 개념 — 정의, 표, 계산 규칙
## 학파·문헌별 차이
## 해석에서 쓰이는 방식 — 신년운세 문장으로 이어지는 경로, 예시
## 우리 적용 — 해석표 YAML 후보 (사용자 확인 전)
## 미확인 · 열린 질문
## 출처 (열어본 것만, 날짜)
## 변경 이력
```

## 목차

### basics/ 기초 체계
- [음양오행](basics/yin-yang-five-elements.md)
- [천간 10](basics/heavenly-stems.md)
- [지지 12와 지장간](basics/earthly-branches.md)
- [60갑자와 납음](basics/sexagenary-cycle.md)
- [절기와 사주 세우기](basics/calendar-solar-terms.md)

### relations/ 관계 도구
- [십신](relations/ten-gods.md)
- [12운성](relations/twelve-stages.md)
- [천간 합·충](relations/stem-combinations-clashes.md)
- [지지 합·충·형·파·해](relations/branch-interactions.md)
- [신살](relations/shinsal.md)
- [공망](relations/gongmang.md)

### judgment/ 판단 체계
- [신강·신약](judgment/day-master-strength.md)
- [용신 (억부·조후·통관·병약·전왕)](judgment/useful-god.md)
- [격국](judgment/structures-gyeokguk.md)
- [조후와 궁통보감](judgment/climate-johu.md)
- [대운·세운·월운 읽기](judgment/luck-cycles.md)
- [신년운세 작성 절차](judgment/annual-fortune-method.md)

### sources/ 문헌·학파
- [고전 목록·판본·저작권](sources/classics.md)
- [학파 계보와 현대 한국 명리](sources/schools.md)
- [한국 실무 관행](sources/korean-practice.md)

### papers/ 논문
- [국내 학술 연구 지형](papers/academic-landscape-korea.md)
- [실증 연구 (성격·직업·건강)](papers/empirical-studies.md)
- [과학적 검증과 바넘 효과](papers/validity-skepticism.md)
- [LLM과 명리·점술](papers/llm-fortune.md)
- [설계 시사점](papers/design-implications.md)

## 변경 이력
- 2026-10-30 위키 골격과 목차
- 2026-10-30 26쪽 초안 완료(전부 상태: 초안). 세션 웹 검색 한도 소진으로 논문 인용이 relations·basics·sources에서 부족 — 각 페이지 "미확인" 절에 후속 검색어. 계산 검증 스크립트는 `research/verify_scripts/`
