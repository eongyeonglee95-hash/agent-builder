import type { ReactNode } from 'react'

export function ObservationRow({ title, subtitle, metrics, children }: {
  title: ReactNode; subtitle?: ReactNode
  metrics: { label: string; value: ReactNode; detail?: ReactNode }[]
  children?: ReactNode
}) {
  return <article className="min-w-0 border-b border-grey-200 bg-background p-4 last:border-b-0">
    <div className="grid min-w-0 gap-4 xl:grid-cols-5 xl:items-start">
      <div className="min-w-0"><div className="text-base font-semibold">{title}</div><div className="mt-1 text-xs text-grey-600">{subtitle}</div></div>
      <dl className={`grid min-w-0 grid-cols-2 gap-4 xl:col-span-4 ${metrics.length === 5 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
        {metrics.map(m => <div className="min-w-0 xl:text-right" key={m.label}><dt className="text-xs text-grey-600">{m.label}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{m.value}</dd>{m.detail && <dd className="mt-1 text-xs font-normal text-grey-600">{m.detail}</dd>}</div>)}
      </dl>
    </div>
    {children}
  </article>
}
