import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../local-data'
import type { Cell } from './ReadGrid'

// '은퇴' 시트 (RETIRE-01). 위: 입력 칸(나·배우자), 아래: 연도별 월 수령액(세전·오늘 돈). 계산은 전부 서버(tools/pension.py).
// 적립금은 '자산' 시트의 노후 주머니를 그대로 쓴다 — 여기서 다시 받지 않는다.

type PersonPlan = { retire_age: number | null; national_monthly: number; national_start_age: number | null; private_start_age: number | null; irp_annual: number; savings_annual: number; db_lump: number; db_monthly_wage: number; db_accrued: number }
type Plan = { me: PersonPlan; partner: PersonPlan; monthly_need: number | null; return_rate: number | null; inflation: number | null; version: number }
type Db = { years_left: number; lump_at_retire: number }
type Used = { age: number; retire_age: number; national_start_age: number; private_start_age: number; balances: Record<string, number>; db: Db | null }
type Row = { year: number; ages: Record<string, number>; retired: boolean; total_real: number; layers_real: Record<string, number>; need_real?: number | null; gap_real?: number | null }
type Result = { plan: Plan; used: Partial<Record<'me' | 'partner', Used>>; missing: string[]; error: string | null; line: string; base_year: number
  assumptions: { return_rate: number; inflation: number; end_age: number; start_age_min: number; min_payout_years: number }
  projection: { rows: Row[]; summary: { retire_year: number | null; streams: { person: string; label: string; start_year: number; principal: number }[] } } | null }

const WHO = [['me', '나'], ['partner', '배우자']] as const
const num = (v: string) => { const n = Number(v.replace(/[^\d]/g, '')); return v.trim() === '' ? null : n }

export function useRetirementRows({ rev, onChanged, onError }: { rev: number; onChanged: (msg: string) => void; onError: (msg: string) => void }): { rows: Cell[][]; line: string | null } {
  const [data, setData] = useState<Result | null>(null)
  const load = useCallback(async () => {
    try { setData(await api<Result>('/retirement')) } catch (e) { onError(e instanceof Error ? e.message : '은퇴 계획을 불러오지 못했어요.') }
  }, [onError])
  useEffect(() => { load() }, [load, rev])

  const save = useCallback(async (next: Plan) => {
    try { setData(await api<Result>('/retirement/plan', 'PUT', next)); onChanged('은퇴 계획을 저장하고 다시 계산했어요.') }
    catch (e) { onError(e instanceof Error ? e.message : '저장하지 못했어요.'); load() }
  }, [onChanged, onError, load])

  const rows = useMemo<Cell[][]>(() => {
    if (!data) return []
    const p = data.plan, a = data.assumptions
    const setP = (who: 'me' | 'partner', k: keyof PersonPlan, v: string, zero: boolean) => {
      const n = num(v)
      if ((p[who][k] ?? null) === (zero ? n ?? 0 : n)) return
      save({ ...p, [who]: { ...p[who], [k]: zero ? n ?? 0 : n } })
    }
    const setH = (k: 'monthly_need' | 'return_rate' | 'inflation', v: string) => {
      const t = v.trim(), n = k === 'monthly_need' ? num(t) : t === '' ? null : Number(t.replace('%', '')) / 100
      if (n !== null && Number.isNaN(n)) return onError('숫자로 입력해 주세요.')
      if ((p[k] ?? null) === n) return
      save({ ...p, [k]: n })
    }
    const W = 8
    const out: Cell[][] = []
    out.push([{ v: data.line, span: W, bold: true, tone: data.error ? 'up' : undefined }])
    out.push([{ span: W }])
    out.push([{ v: '입력 — 빈 칸은 기본값(회색 글씨)으로 계산해요', section: true, span: W }])
    out.push([{ v: '항목', head: true }, { v: '나', head: true }, { v: '배우자', head: true }, { v: '설명', head: true, span: W - 3 }])
    const read = (label: string, f: (u: Used) => number | null, note: string) =>
      out.push([{ v: label }, ...WHO.map(([k]) => { const u = data.used[k]; return u ? { v: f(u), fmt: 'won' as const, tone: 'muted' as const } : { v: '—', tone: 'muted' as const } }), { v: note, span: W - 3, tone: 'muted' }])
    const edit = (label: string, k: keyof PersonPlan, zero: boolean, ph: (u?: Used) => string, note: string, text = false) =>
      out.push([{ v: label }, ...WHO.map(([w, wl]) => ({ v: '', edit: { text, label: `${wl} ${label}`, value: p[w][k] == null || (zero && !p[w][k]) ? '' : String(p[w][k]), placeholder: ph(data.used[w]), onCommit: (v: string) => setP(w, k, v, zero) } })), { v: note, span: W - 3, tone: 'muted' }])
    const dbRow = (label: string, note: string) =>
      out.push([{ v: label, bold: true }, ...WHO.map(([k]) => { const d = data.used[k]?.db; return d ? { v: d.lump_at_retire, fmt: 'won' as const, bold: true } : { v: '—', tone: 'muted' as const } }), { v: note, span: W - 3, tone: 'muted' }])
    out.push([{ v: '만 나이' }, ...WHO.map(([k]) => ({ v: data.used[k]?.age ?? '—', tone: 'muted' as const })), { v: '‘다른 버전으로 보기 → 내 정보’에서 바꿔요', span: W - 3, tone: 'muted' }])
    edit('은퇴 나이', 'retire_age', false, u => u ? String(u.retire_age) : '', '비우면 내 정보의 은퇴 목표(나 기준). 배우자는 같은 해')
    edit('국민연금 월액(오늘 돈)', 'national_monthly', true, () => '0', '국민연금공단 ‘내 연금 알아보기’의 예상 월액')
    edit('국민연금 개시 나이', 'national_start_age', false, u => u ? String(u.national_start_age) : '', '비우면 출생연도 기준')
    out.push([{ v: '퇴직연금 (DB형)', section: true, span: W }])
    edit('월급 (최근 3개월 평균)', 'db_monthly_wage', true, () => '0', '급여명세 3개월 총액 ÷ 3')
    edit('지금 쌓인 퇴직금', 'db_accrued', true, () => '0', '회사 인사시스템 ‘예상 퇴직금 조회’ 금액')
    dbRow('→ 은퇴 때 퇴직금', '지금 퇴직금 + 월급 × 남은 근무 연수 (오늘 돈)')
    if (WHO.some(([k]) => (data.used[k]?.balances['2'] ?? 0) > 0 || p[k].irp_annual > 0)) {
      read('IRP 적립금', u => u.balances['2'] ?? 0, '‘자산’ 시트의 IRP 계좌 합계')
      edit('IRP 연 납입', 'irp_annual', true, () => '0', '은퇴 나이까지')
    }
    out.push([{ v: '개인연금', section: true, span: W }])
    read('연금저축 적립금', u => u.balances['3'] ?? 0, '‘자산’ 시트의 연금저축 계좌 합계')
    edit('연금저축 연 납입', 'savings_annual', true, () => '0', '은퇴 나이까지')
    out.push([{ v: '받는 방법 · 생활비', section: true, span: W }])
    edit('연금 받기 시작 나이', 'private_start_age', false, u => u ? String(u.private_start_age) : '', `퇴직연금·연금저축. ${a.start_age_min}세 이상, ${a.end_age}세까지 나눠 받기`)
    out.push([{ v: '은퇴 후 월 생활비(오늘 돈)' }, { v: '', span: 2, edit: { label: '은퇴 후 부부 월 생활비', value: p.monthly_need == null ? '' : String(p.monthly_need), placeholder: '비우면 비교 안 함', onCommit: v => setH('monthly_need', v) } }, { v: '부부 합계', span: W - 3, tone: 'muted' }])
    out.push([{ v: '연 수익률 · 물가' }, { v: '', edit: { text: true, label: '연 수익률(%)', value: p.return_rate == null ? '' : String(+(p.return_rate * 100).toFixed(2)), placeholder: `${a.return_rate * 100}%`, onCommit: v => setH('return_rate', v) } },
      { v: '', edit: { text: true, label: '물가상승률(%)', value: p.inflation == null ? '' : String(+(p.inflation * 100).toFixed(2)), placeholder: `${a.inflation * 100}%`, onCommit: v => setH('inflation', v) } }, { v: '수익률 · 물가 (%). 비우면 기본값', span: W - 3, tone: 'muted' }])
    out.push([{ span: W }])

    const pr = data.projection
    out.push([{ v: '연도별 월 수령액 — 세전, 오늘 돈 기준', section: true, span: W }])
    if (!pr) { out.push([{ v: data.error ?? (data.missing.length ? `먼저 입력해 주세요: ${data.missing.join(', ')}` : '계산할 값이 없어요.'), span: W, tone: 'muted' }]); return out }
    const hasNeed = data.plan.monthly_need != null
    out.push(['연도', '나이(나·배우자)', '국민연금', '퇴직연금', '개인연금', '합계', hasNeed ? '생활비 대비' : '', ''].map(v => ({ v, head: true })))
    const starts = pr.summary.streams.map(s => s.start_year)
    const from = Math.min(pr.summary.retire_year ?? Infinity, ...starts, data.base_year + 60)
    const shown = pr.rows.filter(r => r.year >= from)
    const max = Math.max(1, ...shown.map(r => r.total_real), data.plan.monthly_need ?? 0)
    for (const r of shown) {
      const ages = WHO.filter(([k]) => r.ages[k] != null).map(([k]) => r.ages[k]).join(' · ')
      const startNote = pr.summary.streams.filter(s => s.start_year === r.year).map(s => `${s.person === 'me' ? '나' : '배우자'} ${s.label} 시작`).join(', ')
      out.push([{ v: `${r.year}${r.year === pr.summary.retire_year ? ' 은퇴' : ''}`, bold: r.year === pr.summary.retire_year, tone: r.retired ? undefined : 'muted' }, { v: ages, tone: 'muted' },
        { v: r.layers_real['1'] || null, fmt: 'won' }, { v: r.layers_real['2'] || null, fmt: 'won' }, { v: r.layers_real['3'] || null, fmt: 'won' },
        { v: r.total_real, fmt: 'won', bold: true },
        hasNeed && r.gap_real != null ? { v: r.gap_real, fmt: 'signed', tone: 'auto' } : { v: '' },
        { v: startNote, tone: 'muted', bar: { pct: r.total_real / max * 100, color: 'var(--cls-long-bond)' } }])
    }
    out.push([{ span: W }])
    out.push([{ v: `가정: 연 수익률 ${(a.return_rate * 100).toFixed(1)}% · 물가 ${(a.inflation * 100).toFixed(1)}% · 사적연금은 ${a.end_age}세까지 매달 같은 금액(확정기간형) · 국민연금은 물가만큼 올라 오늘 돈으로는 같아요.`, span: W, tone: 'muted' }])
    out.push([{ v: '세금(연금소득세)·연금수령한도·ISA·현금 주머니는 아직 넣지 않았어요. 예측이 아니라 입력한 가정으로 계산한 값이에요.', span: W, tone: 'muted' }])
    return out
  }, [data, save, onError])

  return { rows, line: data?.line ?? null }
}
