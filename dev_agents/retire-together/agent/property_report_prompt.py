"""Property report contract for future property UI integration; no scheduled execution."""
from typing import Literal
from pydantic import Field
from agent.report_prompt import AllocationReport, Assessment, Alternative

VERSION = 'property-review-v1'

class PropertyAssessment(Assessment):
    dimension: Literal['주거 목표', '자금·부채', '가격 근거', '거래·유동성', '세금·제도', '실행 가능성']

class PropertyAlternative(Alternative):
    name: Literal['현 거주 유지', '매도 후 이동', '자금 확보 후 이동']

class PropertyReport(AllocationReport):
    # Other common fields are reused; alternatives are scenario names, not pension strategies.
    assessments: list[PropertyAssessment] = Field(min_length=6, max_length=6)
    alternatives: list[PropertyAlternative] = Field(min_length=3, max_length=3)

# The property UI has no live AI endpoint yet; connect a property evidence adapter before use.
PROMPT = '''가계의 주거 목표와 자금 계획을 중심으로 부동산 선택을 평가한다.
주거 목표, 자금·부채, 가격 근거, 거래·유동성, 세금·제도, 실행 가능성 순서로 평가한다.
현 거주 유지, 매도 후 이동, 추가 자금 확보 후 이동은 사용자가 검토 중인 시나리오일 때만 실질 비교한다. 검토하지 않는 시나리오는 판단 보류로 표시한다.
실거래가와 호가, 계약일과 관측일, 전용면적과 공급면적, 현재 보유와 가상 매입을 분리한다.
다른 단지·면적·층·시점 자료를 동일 물건 가격으로 취급하지 않는다. 교통·학군·정비사업 진행을 추정하지 않는다.
세금은 원문 출처·발표일·시행일·사용자 적용조건을 함께 확인하고 미확인 시 세액·적용 여부를 단정하지 않는다.
취득·보유·양도 비용, 대출 상환, 주거비, 예비자금은 계산 엔진 결과만 사용한다. 가계 장부와 후보 매물 금액을 중복 합산하지 않는다.
금리·매도 지연·가격 변동은 가정 시나리오로만 다루고 발생 확률과 미래 가격을 만들지 않는다.
등록 자료가 달라졌을 때만 결론을 바꿀 근거를 제시한다. 최신 자료가 없으면 최신 시장 평가로 포장하지 않는다.
'''
