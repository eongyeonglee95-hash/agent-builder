"""개인연금 수령액 기준의 확인 안내. 실제 과세대상/세액 판정과 구별한다."""
from pathlib import Path

import yaml

RULES_PATH = Path(__file__).resolve().parents[1] / 'rules' / 'pension_tax.yaml'


def load_tax_notice_rules() -> dict:
    return yaml.safe_load(RULES_PATH.read_text(encoding='utf-8'))


def private_pension_tax_checks(items: list[dict], rules: dict) -> list[dict]:
    """한 해의 사람별 3층 명목 월액×12를 비교. 합산/현재가치/세액 계산은 하지 않는다.

    3층에는 과세제외 원금이 섞일 수 있고 2층은 DB/DC/IRP 재원이 미분리다.
    따라서 표시가 없더라도 저율 과세를 확정하지 않으며, 초과도 확인 필요 상태다.
    """
    checks = []
    for person in ('me', 'partner'):
        annual = sum(item['nominal'] for item in items if item['person'] == person and item['layer'] == 3) * 12
        if annual > rules['annual_threshold']:
            checks.append({'person': person, 'annual_nominal': annual})
    return checks
