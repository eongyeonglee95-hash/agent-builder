import { cn } from '@/lib/utils'
import { manwon, pct, pp, shares, tone as toneOf, won } from '@/lib/format'

// 금액·수익률 한 칸 — 고정폭 숫자, 상승 빨강·하락 파랑, 숨기기. 표 밖(카드·요약·대화상자)에서 숫자를 보여 줄 때 쓴다.
// 엑셀 시트 안은 ReadGrid 의 Cell(fmt·tone)을 쓴다. 규칙: docs/DESIGN_SYSTEM.md "숫자 표기"
type Fmt = 'won' | 'signed' | 'manwon' | 'pct' | 'pp' | 'shares'

export function Amount({ value, fmt = 'won', tone, big = false, hidden, className }: {
  value: number | null | undefined
  fmt?: Fmt
  /** auto = 부호로 색. 평가금액·잔고처럼 방향이 없는 숫자는 비워 둔다 */
  tone?: 'auto' | 'up' | 'down' | 'muted'
  /** 22px 이상 큰 숫자 — 상승·하락에 500 단계(더 밝은 색) */
  big?: boolean
  hidden?: boolean
  className?: string
}) {
  const text = fmt === 'won' ? won(value, { hidden })
    : fmt === 'signed' ? won(value, { hidden, signed: true })
    : fmt === 'manwon' ? manwon(value, { hidden })
    : fmt === 'pct' ? pct(value, { hidden })
    : fmt === 'pp' ? pp(value, { hidden })
    : shares(value, { hidden })
  const t = hidden ? undefined : tone === 'auto' ? toneOf(value) : tone
  return <span className={cn('tabular-nums whitespace-nowrap',
    t === 'up' && (big ? 'text-up-big' : 'text-up'),
    t === 'down' && (big ? 'text-down-big' : 'text-down'),
    t === 'muted' && 'text-grey-600', className)}>{text}</span>
}
