import { Plus, Minus } from 'lucide-react'
export type AllocationAnalysis = {
  headline: string; summary: string
  findings: { title: string; evidence: string; implication: string }[]
  assessments: { dimension: string; status: string; judgment: string; evidence: string; condition: string }[]
  alternatives: { name: string; fit: string; tradeoff: string; prerequisite: string }[]
  actions: { timing: string; action: string; reason: string; completion: string }[]
  questions: { question: string; impact: string }[]
}

export function AllocationReport({ analysis }: { analysis: AllocationAnalysis }) {
  return <article className="text-grey-900">
    <header className="grid gap-4 border-b border-grey-300 pb-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <h4 className="max-w-prose text-2xl font-bold leading-snug tracking-tight">{analysis.headline}</h4>
      <p className="text-sm leading-relaxed text-grey-700">{analysis.summary}</p>
    </header>
    <div className="grid gap-x-6 divide-y divide-grey-200 py-2 md:grid-cols-3 md:divide-y-0">
      {analysis.findings.map((f, i) => <section key={i} className="py-4"><h5 className="text-base font-bold leading-snug">{f.title}</h5><p className="mt-2 text-sm leading-relaxed text-grey-700">{f.implication}</p><p className="mt-3 text-xs leading-relaxed text-grey-600">근거 · {f.evidence.replaceAll('retirement_outlook', '저장한 은퇴 계획')}</p></section>)}
    </div>
    <section className="border-t border-grey-300 pt-4">
      <h4 className="mb-3 text-lg font-bold">배분의 적합성을 판단하는 여섯 가지 관점</h4>
      <div className="hidden grid-cols-[140px_100px_minmax(0,1fr)] gap-4 border-b border-grey-300 pb-2 text-xs text-grey-600 md:grid"><span>평가 관점</span><span>판단 근거 상태</span><span>핵심 판단 · 펼치면 근거와 조건</span></div>
      {analysis.assessments.map(a => <details key={a.dimension} className="group border-b border-grey-200 py-3">
        <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 focus-visible:outline-2 md:grid-cols-[140px_100px_minmax(0,1fr)]">
          <span className="text-sm font-semibold">{a.dimension}</span><span className="text-xs leading-6 text-grey-600">{a.status}</span>
          <span className="col-span-2 flex justify-between gap-3 text-sm leading-relaxed md:col-span-1">{a.judgment}<Plus aria-hidden="true" className="size-4 shrink-0 text-grey-600 group-open:hidden"/><Minus aria-hidden="true" className="hidden size-4 shrink-0 text-grey-600 group-open:inline"/></span>
        </summary>
        <dl className="mt-3 grid gap-3 bg-grey-100 p-3 text-sm leading-relaxed md:ml-0 lg:grid-cols-2"><div><dt className="font-semibold">판단 근거</dt><dd className="mt-1 text-grey-700">{a.evidence}</dd></div><div><dt className="font-semibold">결론이 달라지는 조건</dt><dd className="mt-1 text-grey-700">{a.condition}</dd></div></dl>
      </details>)}
      <p className="mt-2 text-xs text-grey-600">‘확인됨’은 근거가 있다는 뜻이며, 안전하거나 적합하다는 등급은 아니에요.</p>
    </section>
    <details className="mt-5 border-t border-grey-300 pt-4"><summary className="cursor-pointer text-lg font-bold focus-visible:outline-2">세 전략이 내 자산에서 맡을 역할</summary>
      <div className="mt-3 divide-y divide-grey-200">{analysis.alternatives.map(a => <section key={a.name} className="grid gap-3 py-4 md:grid-cols-[120px_minmax(0,1fr)]"><h5 className="text-base font-bold">{a.name}</h5><dl className="grid gap-3 text-sm leading-relaxed lg:grid-cols-3"><div><dt className="font-semibold">맞을 수 있는 조건</dt><dd className="mt-1 text-grey-700">{a.fit}</dd></div><div><dt className="font-semibold">얻는 점과 감수할 점</dt><dd className="mt-1 text-grey-700">{a.tradeoff}</dd></div><div><dt className="font-semibold">선택 전에 확인</dt><dd className="mt-1 text-grey-700">{a.prerequisite}</dd></div></dl></section>)}</div>
    </details>
    <section className="mt-5 border-t border-grey-300 pt-4"><h4 className="mb-3 text-lg font-bold">지금 결정할 일</h4>
      <ol className="divide-y divide-grey-200">{analysis.actions.map(a => <li key={a.timing} className="grid gap-2 py-3 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)]"><span className="text-sm font-semibold text-grey-600">{a.timing}</span><div><h5 className="text-sm font-bold">{a.action}</h5><p className="mt-1 text-sm leading-relaxed text-grey-700">{a.reason}</p></div><p className="text-sm leading-relaxed text-grey-600">확인 기준 · {a.completion}</p></li>)}</ol>
    </section>
    <details className="mt-5 border-t border-grey-300 pt-4"><summary className="cursor-pointer text-sm font-semibold focus-visible:outline-2">더 정확한 평가를 위해 필요한 답변</summary><dl className="mt-2 divide-y divide-grey-200">{analysis.questions.map(q => <div key={q.question} className="py-3"><dt className="text-sm font-semibold">{q.question}</dt><dd className="mt-1 text-sm leading-relaxed text-grey-600">{q.impact}</dd></div>)}</dl></details>
  </article>
}
