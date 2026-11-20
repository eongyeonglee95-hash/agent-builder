// 숫자 표기 한곳 — docs/DESIGN_SYSTEM.md "숫자 표기". 계산은 서버가 하고 화면은 여기 함수로 보여 주기만 한다.
// 새 화면은 파일마다 won/pct 를 따로 만들지 말고 여기서 가져온다.

export const MINUS = '−'          // 음수 기호는 유니코드 빼기(U+2212) — 하이픈보다 길어 표에서 잘 보인다
export const EMPTY = '—'          // 값이 없을 때(아직 모름). 0과 구분한다
export const MASK = '••••'        // 금액 숨기기

type Opt = { hidden?: boolean }
const n0 = (n: number) => Math.round(Math.abs(n)).toLocaleString('ko-KR')
const sign = (n: number, signed?: boolean) => (n < 0 ? MINUS : signed && n > 0 ? '+' : '')
const guard = (n: number | null | undefined, o?: Opt) => (o?.hidden ? MASK : n == null || Number.isNaN(n) ? EMPTY : null)

/** 1234567 → "1,234,567원". 표 칸처럼 머리에 단위가 있으면 unit:false */
export function won(n: number | null | undefined, o: Opt & { unit?: boolean; signed?: boolean } = {}): string {
  return guard(n, o) ?? `${sign(n!, o.signed)}${n0(n!)}${o.unit === false ? '' : '원'}`
}

/** 큰 금액 요약: 312,450,000 → "3억 1,245만원". 만원 아래는 반올림 */
export function manwon(n: number | null | undefined, o: Opt = {}): string {
  const g = guard(n, o); if (g) return g
  const r = Math.round(Math.abs(n!) / 10_000), eok = Math.floor(r / 10_000), man = r % 10_000
  const body = `${eok ? `${eok.toLocaleString('ko-KR')}억` : ''}${eok && man ? ' ' : ''}${man ? `${man.toLocaleString('ko-KR')}만` : ''}${!eok && !man ? '0' : ''}원`
  return `${n! < 0 && r ? MINUS : ''}${body}`
}

/** 수익률·비중: 3.149 → "+3.15%" (signed 기본). 비중처럼 부호가 필요 없으면 signed:false */
export function pct(n: number | null | undefined, o: Opt & { digits?: number; signed?: boolean } = {}): string {
  const g = guard(n, o); if (g) return g
  const d = o.digits ?? 2, v = Number(n!.toFixed(d))
  return `${sign(v, o.signed ?? true)}${Math.abs(v).toFixed(d)}%`
}

/** 비중 차이(퍼센트포인트): 1.24 → "+1.2%p" */
export function pp(n: number | null | undefined, o: Opt & { digits?: number } = {}): string {
  const g = guard(n, o); if (g) return g
  const d = o.digits ?? 1, v = Number(n!.toFixed(d))
  return `${sign(v, true)}${Math.abs(v).toFixed(d)}%p`
}

/** 수량: 153 → "153주" */
export function shares(n: number | null | undefined, o: Opt = {}): string {
  return guard(n, o) ?? `${n0(n!)}주`
}

/** 상승 빨강·하락 파랑. 0과 값 없음은 색 없음 */
export function tone(n: number | null | undefined): 'up' | 'down' | undefined {
  return n == null || !n ? undefined : n > 0 ? 'up' : 'down'
}

/** 날짜: "2026-11-16" → "2026.11.16" (화면 표기). 서버·저장은 ISO 그대로 */
export function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10).replaceAll('-', '.') : EMPTY
}

/** 단지 선택처럼 좁은 공간의 억 단위: 2,280,000,000 → 22.8억. 정확한 금액은 상세에 표시. */
export function eok(n: number | null | undefined, o: Opt = {}): string {
  return guard(n, o) ?? `${(n! / 100_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억`
}

/** 지수·일반 소수 수치. 결측값은 0과 구분한다. */
export function decimal(n: number | null | undefined, digits = 2): string {
  return guard(n) ?? `${sign(n!)}${Math.abs(n!).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}
