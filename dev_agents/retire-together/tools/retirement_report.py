"""Read-only report exhibits using the existing retirement engine and schedule."""
from copy import deepcopy


def summarize(result):
    projection = result.get('projection')
    if not projection or result.get('missing') or result.get('error'):
        return {'available': False, 'missing': result.get('missing', []), 'error': result.get('error'), 'scenarios': []}
    summary = projection['summary']
    need = projection.get('monthly_need')
    selected = {summary.get('retire_year'), summary.get('all_started_year')}
    retired = [row for row in projection['rows'] if row['retired']]
    if retired:
        selected.add(retired[-1]['year'])
    milestones = [{'year': row['year'], 'income': row['total_real'], 'need': need,
                   'shortfall': max(0, need-row['total_real']) if need is not None else None}
                  for row in retired if row['year'] in selected]
    return {'available': True, 'milestones': milestones, 'assumptions': result['assumptions'],
            'monthly_need': need, 'retire_year': summary.get('retire_year'),
            'short_years': summary.get('short_years'), 'scenarios': [],
            'as_of': result.get('as_of'), 'missing': result.get('missing', []),
            'basis': '저장한 은퇴 계획 · 국민연금·퇴직연금·개인연금·추가연금 · 세전·현재 돈 가치'}


def build_outlook(plan, family, balances, year, rules, as_of, builder):
    base = builder(plan, family, balances, year, rules, as_of=as_of)
    out = summarize(base)
    if not plan.get('version'):
        return {'available': False, 'missing': ['은퇴 계획 저장'], 'scenarios': []}
    if not out['available']:
        return out
    schedule = base.get('savings_plans', {}).get('me', {})
    out['contribution_schedule'] = {k: schedule.get(k) for k in ('start_year', 'end_year', 'payments')}
    if not schedule.get('payments'):
        out['scenario_note'] = '현재 납입 일정에 남은 기간이 없어요. 은퇴 계획에서 납입 기간을 확인해 주세요.'
        return out
    for extra in rules.get('report_scenarios', {}).get('extra_monthly', []):
        modified = deepcopy(plan)
        modified.setdefault('me', {})['savings_annual'] = (plan.get('me', {}).get('savings_annual') or 0) + extra*12
        variant = summarize(builder(modified, family, balances, year, rules, as_of=as_of))
        if not variant['available']:
            continue
        first = variant['milestones'][0] if variant['milestones'] else None
        original = out['milestones'][0] if out['milestones'] else None
        if first and original:
            out['scenarios'].append({'extra_monthly': extra, 'income': first['income'],
                'increase': first['income']-original['income'], 'shortfall': first['shortfall'], 'year': first['year']})
    out['scenario_note'] = '내 연금저축의 저장된 납입 기간에 추가하는 비교 가정이에요. 월액을 연액으로 환산해 기존 연 단위 계산에 적용했어요. 납입 한도·세액공제·현재 가계 여유자금은 별도 확인이 필요해요.'
    return out


def current_outlook():
    from backend import retirement, storage
    from datetime import date
    today = date.today()
    return build_outlook(retirement.get_plan(), storage.get_family(), retirement.balances(), today.year,
                         retirement.load_pension_rules(), today, retirement.build)
