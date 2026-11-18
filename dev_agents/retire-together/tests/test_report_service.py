import json
import pytest
from agent.report_prompt import AllocationReport
from tools import report_service as service, report_ai


def sample():
    return {'headline': '성장 자산의 역할과 생활비 여력을 함께 확인해야 해요.', 'summary': '계좌의 수보다 공통 위험과 사용할 자금을 구분하는 것이 중요해요.',
        'findings': [{'title': '현금 여력은 별도 확인이 필요해요.', 'evidence': '생활비 자료 미확인', 'implication': '인출 여력을 판단하기 어려워요.'} for _ in range(2)],
        'assessments': [{'dimension': d, 'status': '판단 보류', 'judgment': '추가 자료가 필요해요.', 'evidence': '사용자 입력 미확인', 'condition': '자료를 확인하면 판단할 수 있어요.'} for d in ['목표 적합성','집중·중복 위험','유동성·부채','은퇴 인출','충격 대응','실행 가능성']],
        'alternatives': [{'name': n, 'fit': '목표 확인 후 판단해요.', 'tradeoff': '감내 가능한 위험을 확인해요.', 'prerequisite': '등록 비율을 확인해요.'} for n in ['박곰희','올웨더','K-올웨더']],
        'actions': [{'timing': t, 'action': '자료를 확인해요.', 'reason': '판단 근거가 필요해요.', 'completion': '사용자가 확인한 자료가 있어요.'} for t in ['먼저 확인','다음 결정','계속 점검']],
        'questions': [{'question': '생활비는 얼마인가요?', 'impact': '인출 여력을 판단할 수 있어요.'}]}


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(service, 'DB_PATH', tmp_path/'reports.sqlite3')
    monkeypatch.setattr(report_ai, 'settings', lambda: {'RETIRE_REPORT_MODEL': 'test'})
    calls=[]
    def generate(*args):
        calls.append(args)
        return json.dumps(sample(),ensure_ascii=False)
    monkeypatch.setattr(report_ai, 'generate', generate)
    return calls


def evaluate(facts=None, prompt='test'):
    return service.evaluate(domain='pension', version='test', prompt=prompt, schema=AllocationReport, facts=facts or {'data': 'test'})


def test_identical_input_reuses_result_and_different_inputs_invalidate(setup):
    first,meta=evaluate({'a': 'one', 'b': 'two'})
    second,meta=evaluate({'b': 'two', 'a': 'one'})
    assert first==second and meta['cache_hit'] and len(setup)==1
    evaluate({'a': 'changed'})
    evaluate(prompt='new evaluation criteria')
    assert len(setup)==3


def test_duplicate_assessments_rejected_not_cached(setup, monkeypatch):
    result=sample();result['assessments'][1]=result['assessments'][0]
    monkeypatch.setattr(report_ai, 'generate', lambda *args: json.dumps(result,ensure_ascii=False))
    with pytest.raises(report_ai.ReportAIError): evaluate()
    with service.sqlite3.connect(service.DB_PATH) as db:
        assert db.execute('SELECT COUNT(*) FROM reports').fetchone()[0]==0


def test_invented_amount_rejected(setup, monkeypatch):
    result=sample();result['summary']='예상 손실은 987,654,321원이에요.'
    monkeypatch.setattr(report_ai,'generate',lambda *args:json.dumps(result,ensure_ascii=False))
    with pytest.raises(report_ai.ReportAIError): evaluate()


def test_property_contract_reuses_policy_without_pension_strategy_names():
    from agent.property_report_prompt import PropertyReport
    result=sample()
    for row,name in zip(result['assessments'],['주거 목표','자금·부채','가격 근거','거래·유동성','세금·제도','실행 가능성']): row['dimension']=name
    for row,name in zip(result['alternatives'],['현 거주 유지','매도 후 이동','자금 확보 후 이동']): row['name']=name
    assert PropertyReport.model_validate(result)


def test_numeric_formatting_is_allowed_but_not_new_units_or_values():
    assert service.verified_answer('부동산 29억원', '부동산 29.00억원')
    assert not service.verified_answer('부동산 29억원', '비중 29.00%')
    assert not service.verified_answer('부동산 30억원', '부동산 29.00억원')
