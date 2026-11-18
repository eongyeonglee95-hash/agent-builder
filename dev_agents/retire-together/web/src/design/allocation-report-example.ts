import type { AllocationAnalysis } from '@/workbook/AllocationReport'
export const allocationReportExample: AllocationAnalysis = {
  headline: '성장 자산의 역할은 분명하지만, 인출 여력은 따로 확인해야 해요.',
  summary: '합성 예시입니다. 주식 중심의 배분을 평가할 때 목표 비중뿐 아니라 생활비와 은퇴 시점도 함께 봅니다.',
  findings: [
    { title: '계좌 수와 분산은 달라요.', evidence: '여러 계좌가 같은 자산군을 보유한 예시', implication: '계좌를 합쳐 공통 위험을 살펴봐야 해요.' },
    { title: '생활비와 투자 자금을 구분해요.', evidence: '현금성 자산 확인 전인 예시', implication: '일반 투자계좌 잔고만으로 비상자금이 충분하다고 볼 수 없어요.' },
  ],
  assessments: ['목표 적합성', '집중·중복 위험', '유동성·부채', '은퇴 인출', '충격 대응', '실행 가능성'].map(dimension => ({ dimension, status: '조건부', judgment: '입력된 목표와 사용 시점을 함께 확인해야 해요.', evidence: '합성 자료의 조건부 평가입니다.', condition: '사용자가 목표와 자료를 확인하면 판단이 달라질 수 있어요.' })),
  alternatives: ['박곰희', '올웨더', 'K-올웨더'].map(name => ({ name, fit: '사용자가 정한 목표와 등록 비율을 대조해요.', tradeoff: '역할과 위험을 함께 비교해요.', prerequisite: '책 원문과 적용 비율을 먼저 확인해요.' })),
  actions: ['먼저 확인', '다음 결정', '계속 점검'].map(timing => ({ timing, action: '필요한 자료와 판단 기준을 확인해요.', reason: '실행에 앞서 근거를 갖추기 위해서예요.', completion: '확인한 자료와 사용자 선택이 남아 있어요.' })),
  questions: [{ question: '은퇴 직후 생활비는 어떻게 마련할 계획인가요?', impact: '인출 시점과 투자 기간을 구분할 수 있어요.' }],
}
