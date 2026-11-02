import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../local-data'
import type { Cell } from './ReadGrid'

// 리밸런싱 시트 맨 위 '포트폴리오' (2026-11-02 사용자 "올웨더/K-올웨더/박곰희 포트폴리오를 보여주고, 그 아래에 내가 선택하면 그 포트폴리오를
// 따라가고 아니면 개별로 저장되게", 이어서 "한번에 나오게 해주면 안 돼? 투자원칙 3개 기본을").
// 세 기본 포트폴리오 + 직접 설정을 한 표에 나란히(B~E열). 아래 묶음 줄의 버튼도 같은 열에 맞춘다.
// 비율·예시 종목은 서버(strategies.yaml)가 준 그대로. 따라가기·직접 설정 저장은 사용자가 누를 때만, 기록은 서버가 DECISIONS.md에 남긴다.

type PClass = { asset_class: string; label: string; target_pct: number; example: string | null; ticker: string | null; confirmed: boolean }
type PCard = { id: string; short: string; name: string; ready: boolean; error: string | null; pending_note: string | null; classes: PClass[] }
type PPool = { pool_id: string; label: string; strategy_id: string }
type Portfolios = { strategies: PCard[]; pools: PPool[]; examples_note: string }

const ORDER = ['all_weather', 'k_all_weather', 'park_gomhee', 'custom']   // B·C·D·E열
const CLASS_ORDER: [string, string][] = [['stock', '주식'], ['long_bond', '장기채'], ['mid_bond', '중기채'], ['gold', '금'], ['commodity', '원자재'], ['cash', '현금·달러']]

export function usePortfolioRows({ rev, onChanged, onError }: {
  rev: number; onChanged: (msg: string) => void; onError: (msg: string) => void
}): Cell[][] {
  const [data, setData] = useState<Portfolios | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api<Portfolios>('/workbook/portfolios')
      setData(d)
      const custom = d.strategies.find(s => s.id === 'custom')
      setDraft(Object.fromEntries((custom?.classes ?? []).map(c => [c.asset_class, c.target_pct ? String(c.target_pct) : ''])))
    } catch (e) { onError(e instanceof Error ? e.message : '포트폴리오를 불러오지 못했어요.') }
  }, [onError])
  useEffect(() => { load() }, [load, rev])

  const run = useCallback(async (fn: () => Promise<string>) => {
    setBusy(true)
    try { onChanged(await fn()); await load() }
    catch (e) { onError(e instanceof Error ? e.message : '저장하지 못했어요.') } finally { setBusy(false) }
  }, [onChanged, onError, load])

  return useMemo<Cell[][]>(() => {
    if (!data) return []
    const cards = ORDER.map(id => data.strategies.find(s => s.id === id)).filter((c): c is PCard => !!c)
    const byId = Object.fromEntries(cards.map(c => [c.id, c]))
    const cls = (id: string, k: string) => byId[id]?.classes.find(c => c.asset_class === k)
    const example = (id: string, k: string) => {
      const c = cls(id, k)
      if (!c?.target_pct || !c.example) return { v: '' }
      return { v: `${c.example} ${c.ticker ?? ''}`, tone: c.confirmed ? undefined : 'muted' } as Cell
    }
    const pctCell = (id: string, k: string): Cell => {
      const card = byId[id]
      if (!card) return {}
      if (id === 'custom') return { v: '', edit: { label: `직접 설정 ${k} 비율(%)`, value: draft[k] ?? '', placeholder: '0', onCommit: v => setDraft(d => ({ ...d, [k]: v })) } }
      if (!card.ready) return { v: '미정', tone: 'muted' }
      const p = cls(id, k)?.target_pct ?? 0
      return p ? { v: `${p}%`, bold: true } : { v: '—', tone: 'muted' }
    }

    const rows: Cell[][] = []
    rows.push([{ v: '투자 원칙 포트폴리오 — 목표 비율 비교', section: true, span: 7 }])
    rows.push(['자산군', ...cards.map(c => c.short), '올웨더 예시 종목', '박곰희 예시 종목'].map(v => ({ v, head: true })))
    for (const [k, label] of CLASS_ORDER) {
      rows.push([{ v: label }, ...ORDER.map(id => pctCell(id, k)), example('all_weather', k), example('park_gomhee', k)])
    }
    // 직접 설정 합계는 입력 안내용. 저장할 때 서버가 다시 검사한다(합 100·범위·자산군)
    const sum = Object.values(draft).reduce((a, v) => a + (Number(v) || 0), 0)
    const targets = Object.fromEntries(Object.entries(draft).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]))
    rows.push([{ v: '합계', bold: true }, ...ORDER.slice(0, 3).map<Cell>(id => byId[id]?.ready ? { v: '100%', bold: true } : { v: '미정', tone: 'muted' }),
      { v: `${sum}%`, bold: true, tone: sum === 100 ? undefined : 'up' },
      { btn: { label: '직접 설정 저장', primary: sum === 100, disabled: busy || sum !== 100,
        onClick: () => run(async () => { await api('/workbook/portfolio/custom', 'POST', { targets }); return '직접 설정 비율을 저장했어요.' }) } },
      { v: sum === 100 ? '저장한 뒤 아래 묶음 줄에서 고르세요.' : '직접 설정은 E열에 비율을 넣고 합을 100%로 맞추세요.', tone: 'muted' }])
    const k = byId['k_all_weather']
    if (k?.pending_note) rows.push([{ v: `K-올웨더: ${k.pending_note}`, span: 7, tone: 'muted' }])
    rows.push([{ v: `${data.examples_note} 회색 종목은 아직 '확인됨'이 아니라 주문표에 수량 없이 금액만 나와요.`, span: 7, tone: 'muted' }])
    rows.push([{ span: 7 }])

    rows.push([{ v: '묶음별로 따라갈 포트폴리오 — 누르면 바뀌고 기록돼요', section: true, span: 7 }])
    rows.push([{ v: '묶음', head: true }, ...cards.map(c => ({ v: c.short, head: true })), { v: '지금 따르는 것', head: true }, { v: '', head: true }])
    for (const p of data.pools) {
      const current = byId[p.strategy_id]?.short ?? p.strategy_id
      rows.push([{ v: p.label },
        ...ORDER.map<Cell>(id => {
          const card = byId[id]
          if (!card) return {}
          const same = p.strategy_id === id
          return { btn: { label: same ? '따르는 중' : '이걸로', primary: same, disabled: busy || same || !card.ready,
            onClick: () => run(async () => { await api('/workbook/portfolio/follow', 'POST', { pool_id: p.pool_id, strategy_id: id }); return `${p.label.split(' — ')[0]}이(가) 이제 ${card.short}를 따라가요.` }) } }
        }),
        { v: current, bold: true }, {}])
    }
    rows.push([{ v: `묶음마다 따로 고를 수 있어요.${byId['custom']?.ready ? '' : ' 직접 설정은 위 E열에 비율을 저장하면 고를 수 있어요.'} K-올웨더는 비율을 정하면 켜져요.`, span: 7, tone: 'muted' }])
    rows.push([{ span: 7 }])
    return rows
  }, [data, draft, busy, run])
}
