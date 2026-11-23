import type { ReactNode } from 'react'
import './page-hero.css'

export type HeroMetric = { label: string; value: ReactNode; detail?: ReactNode; tone?: 'up' | 'down'; primary?: boolean }

/** A single first-read surface: identity, scope/actions, core data, then navigation. */
export function PageHero({ title, context, actions, metrics, children, footer, note, label }: {
  title: string; context?: ReactNode; actions?: ReactNode; metrics?: HeroMetric[]
  children?: ReactNode; footer?: ReactNode; note?: ReactNode; label?: string
}) {
  return <section className="page-hero" aria-label={label ?? `${title} 요약`}>
    <header className="page-hero-heading"><div className="page-hero-identity"><h1>{title}</h1>{context && <div className="page-hero-context">{context}</div>}</div>{actions && <div className="page-hero-actions">{actions}</div>}</header>
    {!!metrics?.length && <dl className="page-hero-metrics">{metrics.map(metric => <div key={metric.label} data-primary={metric.primary || undefined}><dt>{metric.label}</dt><dd className={metric.tone ? `page-hero-${metric.tone}` : undefined}>{metric.value}</dd>{metric.detail && <div className="page-hero-detail">{metric.detail}</div>}</div>)}</dl>}
    {children}
    {note && <div className="page-hero-note">{note}</div>}
    {footer && <div className="page-hero-footer">{footer}</div>}
  </section>
}
