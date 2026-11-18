import './extra-pension-summary.css'

/** Two alternative uses of layer 4; the combined monthly amount is separate. */
export function ExtraPensionSummary({ monthly, capital, combined, combinedWon }: {
  monthly: string
  capital: string
  combined?: string
  combinedWon?: number
}) {
  return <section className="tower-extra-summary" data-testid="pension-extra" aria-label="4층 추가연금 활용">
    <h3>4층 추가연금</h3>
    <dl>
      <div><dt>연금으로 받기</dt><dd>{monthly}</dd></div>
      <div><dt>목돈으로 보유</dt><dd>{capital}</dd></div>
    </dl>
    {combined !== undefined && <div className="tower-extra-combined"><span>4층 포함 월 연금</span><strong data-testid="pension-total-with-extra" data-won={combinedWon}>{combined}</strong></div>}
  </section>
}
