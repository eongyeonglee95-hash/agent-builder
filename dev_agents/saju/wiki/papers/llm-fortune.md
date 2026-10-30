# LLM과 명리·점술

기준일: 2026-10-30 · 상태: 초안

## 요약

- 八字 LLM 벤치마크가 2025~2026년에 여럿 나왔다(BaZi 인물 시뮬레이션 2025, BaziQA 2026, Li & Huang 2026). MingLi-Bench는 GitHub 프로젝트만 있고 논문은 없다.
- 차트를 미리 계산해 주어도 대회 문제(4지선다)에서 최신 모델의 정답률은 32~37%다. 우연(25%)보다는 높지만 여유가 크지 않다(BaziQA).
- 규칙을 "아는 것"과 "적용하는 것"은 다르다. 이론 문항이 사례 문항보다 16.60~29.56%p 높다. 12운성·납음은 평균 89%대지만 직업·가족관계 사례는 37~38%다(Li & Huang 2026).
- 계산을 코드로 하고 LLM에 넘기면 낫다는 근거가 있다. 기호 추론+LLM이 일반 LLM보다 30.3~62.6% 정확했고, 틀린 八字를 넣으면 20~45% 떨어졌다(Zheng 외 2025). 입력 차트가 맞아야 해석도 맞다는 뜻이다.
- 이용자 연구 셋(중국, 2026)에 공통된 결과: 사람들은 LLM 운세를 정서적 지지로 쓰고, 원하는 답이 나올 때까지 다시 묻고, 정확성 판단은 바넘 효과와 확증편향의 영향을 받는다.

## 연구 정리

### 1. 벤치마크·성능 연구

| 연구 | 데이터 | 설정 | 주요 결과 | 한계(저자 명시 포함) |
|---|---|---|---|---|
| Chen & Liu(2026), "BaziQA-Benchmark: Evaluating Symbolic and Temporally Compositional Reasoning in Large Language Models", arXiv:2602.12889 | 세계 명리사 대회(2021~2025) 공식 문제 200개, 연도마다 8명 × 5문항, 4지선다 | **미리 계산한 차트를 제공**, 다회차 대화 | 정답률(매크로 평균): DeepSeek-Chat-V3 36.7%, DeepSeek-R1 34.1%, GPT-5.1-Chat 32.5%, Gemini-2.5-Flash 32.4%, Gemini-3-Pro 32.1%. 전부 25%보다 유의하게 높음(p<10⁻⁷). 정확한 시기 짚기, 여러 조건 동시 판단에서 체계적으로 실패. 어떤 모델도 못 푼 문항이 있음 | 동료심사 미표기. 구조화 추론 프로토콜(SRP)은 모델·영역마다 효과가 들쭉날쭉(예: 2025년 DeepSeek-R1 성격 -20.0%p, 연운 +10.0%p) |
| Li & Huang(2026), "Knowing the Rules, Applying the Rules: Evaluating Language Models on Traditional Chinese Bazi", arXiv:2610.05682 | 중국어 4지선다 3,000문항(이론 14유형, 사례 11유형), 최종 2,492문항 | 6개 시스템 | 전체 정답률 63.20~75.56%. 이론이 사례보다 모든 시스템에서 높음(차이 16.60~29.56%p). 12운성 89.10%, 납음 88.62%, 신살 기초 75.96%, 대운 84.62%, **직업 36.98%, 가족관계 38.19%**. 무효 응답 306건 중 258건이 사례 문항 | 정답지를 **모델이 만들고 모델이 검증**했고 전문가 전수 검증 없음. 최종 문항을 평가 대상 모델로 골랐음. 점수는 "정답지와의 일치"이지 실제 예측력이 아님 |
| Zheng 외(2025), "BaZi-Based Character Simulation Benchmark: Evaluating AI on Temporal and Persona Reasoning", arXiv:2510.23337 (WordPlay Workshop 2025) | 실제 사람의 재물·건강·가족·직업·관계 사건을 질의응답으로 만든 데이터 | 기호 八字 추론 + LLM(BaZi-LLM) vs DeepSeek-v3, GPT-5-mini | 정확도 30.3~62.6% 향상. 틀린 八字를 넣으면 20~45% 하락 | 초록 기준. 표본 크기·정답 기준 검증 방법은 초록에 없음 |
| MingLi-Bench (DestinyLinker, GitHub, MIT) | 세계 명리사 대회(2022~2025) 160문항, 八字·紫微, 12개 생활 영역 | `--astro`로 iztro 차트 주입, `--cot` | README에 **결과 수치 없음** | 논문 없음. README는 BaziQA를 참고 문헌으로 연결 |
| imly-sudo/bazi-llm-benchmark (GitHub) | 절기 경계 ±4시간 50개 샘플 | LLM 단독 排盘 | 7개 모델 30~65%라고 적었으나 저자 스스로 "추정치" | research/05 기록. 참고만 |

### 2. 이용자·사회 연구

| 연구 | 방법 | 결과 |
|---|---|---|
| Ling, Zheng, Cao, LC(2026), "'Re-Tell the Fortune so I Can Believe It': How Chinese User Communities Engage with and Interpret GenAI-based Fortune-Telling", arXiv:2603.27784, CSCW 2026 채택 | 정기 이용자 22명 면담 + 커뮤니티 게시물 1,842건 3주 디지털 민족지 | 심리적 위로를 찾는 사람이 AI의 결정 조언을 특히 잘 받아들임. 접근성·편리함은 좋지만 "신비감"은 부족하다고 봄. **원하는 답이 나올 때까지 다시 묻고**, 공유하며 해석을 강화 |
| Li, Wang, Chen, Hong(2026), "Divination by Prompt: LLM-Mediated Xuanxue on Chinese Social Media", arXiv:2606.12418 | 샤오훙슈 게시물·댓글 2만3천여 건 + 이용자·전문 점술가 32명 면담 | 주제는 연애·직업·시험·게임 뽑기. 이용자가 함께 프롬프트를 다듬음. 정확성 평가는 긍정 쪽으로 기울고, 저자들은 바넘 효과·확증편향과 연결. 반복 시도·모델 간 비교. 전문 점술가는 LLM에 "영력"이 없다고 봄 |
| Lin, Li, Ma, Lyu, Peng(2026), "Understanding Fortunetelling with Large Language Models in China", arXiv:2607.15626, ICWSM 2027 채택 | 게시물 1,045건 + 20명 면담 | 주제: 연애 27.08%, 직업 22.78%, 총운 16.08%, 학업 10.91%, 재물 9.86%, 건강 4.59%. 반응: 놀람 34.45%, 걱정 3.64%. 신뢰도: 회의 36.08%, 신뢰 28.42%. 결과가 믿음·결정을 바꾸는 일은 드물고 작은 행동 조정이 있음. 면담자 확신 변화 평균 9.53점(SD 8.84). 저자 설계 제안: 성찰 질문, 일지, "재미/결정 지원" 모드 구분, 민감 정보 경고 |
| Lee, Pataranutaporn, Amores, Maes(2024), arXiv:2408.06602 | 238명 실험 | AI 예측을 믿는 정도가 점성술 예측을 믿는 정도와 양의 상관. [과학적 검증](validity-skepticism.md) 참고 |

### 3. 실패 양상

| 실패 | 근거 | 우리 구조에서의 대응 |
|---|---|---|
| 계산 환각(만세력·절기 경계) | LLM 단독 排盘 추정 30~65%(약한 근거, research/05). 주요 벤치마크가 모두 차트를 미리 계산해 줌 | 계산은 라이브러리로만(research/03) |
| 틀린 입력에 민감 | 틀린 八字 → 20~45% 하락(Zheng 외 2025) | 차트 검증 테스트, 시각 모를 때 시주 생략 |
| 규칙 결합 실패 | 이론 > 사례, 차이 16.60~29.56%p(Li & Huang 2026). 다중 조건·시기 특정 실패(BaziQA) | 합충·용신 판단도 코드로. LLM은 판단된 결과만 문장화 |
| 일관성 부족 | 같은 질문을 반복하면 다른 답 → 이용자가 원하는 답이 나올 때까지 다시 묻기(Ling 외, Li 외) | 같은 입력 → 같은 결과(캐시·고정 시드·구조화 출력) |
| 바넘·아첨 | 정확성 평가가 바넘 효과·확증편향 영향(Li 외 2026) | 바넘 감지 지표([설계 시사점](design-implications.md)) |

### 4. 개선 방법과 측정 결과

- **도구 호출·결정론 계산**: 측정된 개선은 Zheng 외(2025)의 기호 추론 결합 30.3~62.6%가 유일하다. BaziQA·MingLi-Bench는 처음부터 차트를 주어 계산 오류를 분리한다.
- **구조화 추론 순서(SRP)**: BaziQA에서 효과가 모델·영역마다 엇갈림. 일관된 개선 근거 아님.
- **추론 모드**: Li & Huang에서 DeepSeek 추론 켬/끔 비교 시 이론 +6.53·+12.20%p, 사례 -3.67·+1.27%p. 저자는 인과로 해석하지 말라고 함.
- **RAG(고전 검색)**: 명리 분야에서 RAG 효과를 측정한 논문은 **미확인**.

## 관점 차이

- 벤치마크 정답은 "대회 출제자/교재의 정답"이다. 실제 인생 예측력과 다르다(Li & Huang 저자 명시). 점수가 높아도 "잘 맞히는 AI"라는 뜻이 아니다.
- 이용자 연구는 모두 중국 사례다. 한국 이용자 연구는 **미확인**.

## 해석에서 쓰이는 방식

- 우리 설계(계산은 코드, LLM은 해석 문장만)는 위 연구들과 방향이 같다.
- LLM에게 "용신 판단"까지 맡기면 사례 적용 약점(직업·가족 37~38%)이 그대로 들어온다. 판단은 해석표 YAML·코드로 내리고, LLM은 그 결과를 쉬운 말로 풀어주는 데만 쓴다.
- 평가셋은 MingLi-Bench처럼 "계산 정확도"와 "해석 추론"을 분리해 잰다.

## 우리 적용 — 사용자 확인 전 후보

```yaml
llm_role:
  allowed: ["판단 결과를 문장으로", "근거 항목 설명"]
  forbidden: ["간지 계산", "용신·격국 판단", "대운 시기 계산"]
consistency:
  same_input_same_output: true     # 다시 묻기로 답 바꾸기 방지
eval:
  split: ["chart_accuracy", "rule_application", "barnum_similarity"]
  benchmark_refs: ["BaziQA(200, 차트 제공)", "MingLi-Bench(160)"]
```

## 미확인 · 열린 질문

- 명리·점술 분야 RAG 효과 측정 논문.
- 한국어 사주 LLM 평가·이용자 연구.
- 타로·서양 점성 LLM의 동료심사 논문(이번에 ACL Anthology 등에서 확인하지 못함).
- MingLi-Bench 결과 수치.

## 출처 (열어본 것만, 2026-10-30)

- BaziQA: https://arxiv.org/abs/2602.12889 , https://arxiv.org/html/2602.12889
- Li & Huang: https://arxiv.org/abs/2610.05682 , https://arxiv.org/html/2610.05682
- Zheng 외: https://arxiv.org/abs/2510.23337
- MingLi-Bench README: https://raw.githubusercontent.com/DestinyLinker/MingLi-Bench/main/README.md
- Ling 외: https://arxiv.org/abs/2603.27784
- Li 외: https://arxiv.org/abs/2606.12418
- Lin 외: https://arxiv.org/abs/2607.15626 , https://arxiv.org/html/2607.15626
- Lee 외: https://arxiv.org/abs/2408.06602

## 변경 이력

- 2026-10-30 초안 작성
