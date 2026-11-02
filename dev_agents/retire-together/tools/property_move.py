"""갈아타기 자금 비교. 원 단위 정수, CALCULATION_RULES §6-M. 외부 조회/저장 없음."""
from datetime import date


def move_budget(*, sale_value: int, loans: int, deposit: int, sale_costs: int | None,
                cash: int | None, new_loan: int, price: int | None, purchase_costs: int | None,
                monthly: int, target_month: str | None, today: date | None = None) -> dict:
    numbers = (sale_value, loans, deposit, sale_costs, cash, new_loan, price, purchase_costs, monthly)
    if any(n is not None and (type(n) is not int or n < 0) for n in numbers):
        raise ValueError("금액은 0 이상의 정수여야 합니다")
    today = today or date.today()
    months = None
    if target_month:
        y, m = map(int, target_month.split("-"))
        if not 1 <= m <= 12:
            raise ValueError("목표 월을 확인해 주세요")
        months = max(0, (y - today.year) * 12 + m - today.month)
    sale_net = sale_value - loans - deposit - (sale_costs or 0)
    own = sale_net + cash if cash is not None else None
    total = price + (purchase_costs or 0) if price else None
    gap = max(0, total - own - new_loan) if total is not None and own is not None else None
    savings = monthly * months if months is not None else None
    return {
        "sale_value": sale_value, "loans": loans, "deposit": deposit, "sale_net": sale_net,
        "own_funds": own, "total_needed": total, "gap": gap,
        "coverage": round(min(100, max(0, own / total * 100)), 1) if total and own is not None else None,
        "months": months, "future_savings": savings,
        "future_gap": max(0, gap - savings) if gap is not None and savings is not None else None,
        "required_monthly": (gap + months - 1) // months if gap is not None and months else None,
        "surplus": max(0, own + new_loan - total) if own is not None and total is not None else None,
        "costs_complete": sale_costs is not None and purchase_costs is not None,
    }


def price_gap(*, home_value: int, target_price: int) -> int:
    """격차 = 목표 집 가격 − 팔 집 평가액(전체). 둘 다 집 전체 기준이며 비용·대출은 넣지 않는다.
    갈아타기 추적의 기준 숫자 — 집값 자체가 아니라 이 차이가 벌어지는지 좁혀지는지를 본다."""
    if type(home_value) is not int or type(target_price) is not int or home_value < 0 or target_price < 0:
        raise ValueError("금액은 0 이상의 정수여야 합니다")
    return target_price - home_value
