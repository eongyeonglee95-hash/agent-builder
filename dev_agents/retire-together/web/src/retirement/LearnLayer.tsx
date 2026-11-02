import type { ReactNode } from 'react'
import { BookOpen, ExternalLink, Info } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Result, Row } from '../workbook/retirement'
import { accruedDb, amount, capital, extra, LAYERS, manWon, PEOPLE, streams, type Scope } from './presentation'
import './learn-layer.css'

// "이 연금 알아두기" — 층을 눌렀을 때 공부할 수 있는 한 페이지 (2026-11-02 사용자 요청).
// 규칙의 원문은 docs/TAX_RULES.md(§1~§7, 확인일 2026-10-26 / §7 2026-11-02)와 rules/pension.yaml. 여기 문장은 그 요약이며
// 숫자를 새로 계산하지 않는다 — 두 분 숫자는 서버(/api/retirement) 값을 읽어 한도와 나란히 놓기만 한다. 추천 문장 없음.

type Props = { layer: number; data: Result; row: Row | undefined; owner: Scope; close: () => void }
const SOURCES: Record<number, [string, string][]> = {
  1: [['국민연금공단 — 노령연금·조기/연기·유족연금', 'https://www.nps.or.kr'], ['소득세법 §20의3·§47의2 (공적연금 과세·연금소득공제)', 'https://www.law.go.kr/법령/소득세법'], ['국민건강보험법 시행규칙 별표 1의2 (피부양자 소득요건)', 'https://korea.legal/wiki/국민건강보험법-시행규칙-별표-1의2']],
  2: [['소득세법 §129①5의3 (퇴직소득 연금수령 70/60/50%)', 'https://www.law.go.kr/법령/소득세법'], ['소득세법 시행령 §40의2 (연금수령한도·연금수령연차)', 'https://www.law.go.kr/법령/소득세법시행령'], ['국세청 연금소득 원천징수 안내', 'https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?mi=6608&cntntsId=7888']],
  3: [['소득세법 §14③9·§64의4·§129①5의2 (1,500만 기준선·세율)', 'https://www.law.go.kr/법령/소득세법'], ['국세청 연금소득 원천징수 안내', 'https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?mi=6608&cntntsId=7888']],
  4: [['소득세법 시행령 §25③·④ (연금보험 비과세 요건)', 'https://www.law.go.kr/법령/소득세법시행령'], ['조세특례제한법 §91의18 (ISA)', 'https://www.law.go.kr/법령/조세특례제한법/제91조의18']],
}
const CHECKED = { rules: '2026-10-26', national: '2026-11-02' }

export function LearnLayer({ layer, data, row, owner, close }: Props) {
  const L = LAYERS[layer - 1]
  const money = (won: number | null | undefined) => won == null ? '—' : `${manWon(won)} 원`
  const monthly = (won: number | null | undefined) => won == null ? '—' : `${(won / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만 원`
  const people = PEOPLE.filter(([who]) => data.used[who] && (owner === 'together' || owner === who))
  const nat = (who: Scope) => streams(data, who, 1)[0]
  const dependentLimit = 20_000_000, privateLimit = 15_000_000
  return <Dialog open onOpenChange={open => { if (!open) close() }}>
    <DialogContent className="learn-dialog max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle><BookOpen size={18}/> {layer}층 · {L.name} 알아두기</DialogTitle><DialogDescription>{L.description}</DialogDescription></DialogHeader>
      <div className="learn-body">

        {layer === 1 && <>
          <Section title="이게 뭐예요">
            <p>나라가 운영하는 연금. <b>죽을 때까지</b> 나오고 <b>매년 물가만큼 오릅니다.</b> 받기 시작하는 법정 나이는 출생연도에 따라 61~65세(1969년생부터 65세).</p>
            <p>공단·통합연금포털의 "예상연금액"은 보통 <b>만 60세까지 지금처럼 계속 낸다고 가정</b>한 숫자예요. 60세 전에 그만두면 줄고, 소득이 오르거나 60세 뒤에도 임의계속가입으로 더 내면 늘어납니다.</p>
          </Section>
          <Section title="두 분 숫자">
            <table className="learn-table"><thead><tr><th/><th>월액(오늘 돈)</th><th>연간</th><th>시작</th><th>건강보험 피부양자 기준 2,000만</th></tr></thead><tbody>
              {people.map(([who, label]) => { const s = nat(who); const yearly = (data.plan[who]?.national_monthly ?? 0) * 12; return <tr key={who}><td>{label}</td><td>{monthly(data.plan[who]?.national_monthly)}</td><td>{money(yearly)}</td><td>{s ? `${s.start_age}세 · ${s.start_year}년` : '—'}</td><td className={yearly > dependentLimit ? 'is-over' : ''}>{yearly ? yearly > dependentLimit ? `넘음 (+${money(yearly - dependentLimit)})` : `이내 (여유 ${money(dependentLimit - yearly)})` : '—'}</td></tr> })}
            </tbody></table>
            <p className="learn-note">언제 받을지(조기·연기)와 한 사람이 먼저 떠났을 때(유족연금)는 층 말풍선의 비교표에서 두 분 숫자로 볼 수 있어요.</p>
          </Section>
          <Section title="세금은 이렇게">
            <ul>
              <li><b>2002년 이후에 낸 보험료</b>에서 나오는 부분만 과세해요. 그 전 납입분 비율만큼은 비과세.</li>
              <li>과세 대상에 <b>연금소득공제</b>(350만 원까지 전액, 최대 900만 원)와 기본공제가 붙어서, 국민연금만 월 170만 원 수준이면 세금은 <b>연 수십만 원</b> 정도예요. 정확한 금액은 2002년 이전 납입 비율에 따라 달라집니다.</li>
              <li>공단이 매달 간이세액표로 떼고 주고, 다음 해 1월에 정산합니다. 사적연금의 1,500만 원 기준선과는 <b>별개</b>(합치지 않음).</li>
            </ul>
          </Section>
          <Section title="꼭 알아둘 것" tone="warn">
            <ul>
              <li><b>건강보험 피부양자.</b> 공적연금 등 소득이 <b>연 2,000만 원</b>을 넘으면 자녀·배우자의 피부양자로 남을 수 없고 지역가입자가 돼 <b>매달 보험료</b>가 생겨요(소득·재산 기준, 세대 단위). 국민연금만 월 약 167만 원이면 넘습니다. {people.some(([who]) => (data.plan[who]?.national_monthly ?? 0) * 12 > dependentLimit) ? <b>두 분 중 넘는 분이 있어요 — 세금보다 이게 더 클 수 있습니다.</b> : null} 퇴직연금·개인연금 같은 사적연금은 이 기준에 안 들어가요. 보험료 추정은 아직 앱에 없어요.</li>
              <li><b>유족연금은 택1.</b> 한 사람이 떠나면 남은 사람은 ‘내 노령연금 + 유족연금의 30%’ 또는 ‘유족연금만(사망자 월액의 40~60%)’ 중 하나만.</li>
              <li><b>기초연금</b>(65세 이상 소득 하위 70%)은 소득인정액 기준이라 계산에 넣지 않았어요. 받게 되면 덤.</li>
            </ul>
          </Section>
        </>}

        {layer === 2 && <>
          <Section title="이게 뭐예요">
            <p>회사가 쌓아 주는 연금. <b>DB</b>(확정급여)는 회사가 ‘퇴직 직전 평균임금 × 근속연수’를 약속하는 방식, <b>DC</b>(확정기여)·<b>IRP</b>는 내 계좌에 돈이 들어와 내가 굴리는 방식이에요. 퇴직금은 IRP로 받아서 55세 이후 연금으로 나눠 받을 수 있어요.</p>
          </Section>
          <Section title="두 분 숫자">
            <table className="learn-table"><thead><tr><th/><th>지금 확정된 DB 퇴직금</th><th>DC·IRP 계좌</th><th>{row?.year ?? ''}년 월 수령(계산)</th></tr></thead><tbody>
              {people.map(([who, label]) => <tr key={who}><td>{label}</td><td>{accruedDb(data, who) ? money(accruedDb(data, who)) : '—'}</td><td>{capital(data, who, 2) == null ? '없음' : money(capital(data, who, 2))}</td><td>{streams(data, who, 2).length ? monthly(amount(row, who, 2)) : '—'}</td></tr>)}
            </tbody></table>
          </Section>
          <Section title="세금은 이렇게">
            <ul>
              <li>퇴직금에는 <b>퇴직소득세</b>가 붙는데, 근속연수 공제가 커서 원래도 낮은 편이에요.</li>
              <li>일시금 대신 <b>연금으로 나눠 받으면</b> 그 퇴직소득세의 <b>70%</b>만 내요(1~10년차). 11~20년차는 <b>60%</b>, 21년차부터는 <b>50%</b>(2026년부터). 즉 30~50% 깎아 줍니다.</li>
              <li>퇴직금에서 나온 연금은 사적연금 <b>1,500만 원 기준선에 들어가지 않아요.</b> 운용수익 부분만 연금소득세(5.5~3.3%).</li>
            </ul>
          </Section>
          <Section title="꼭 알아둘 것" tone="warn">
            <ul>
              <li>중간에 <b>목돈으로 꺼내면</b> 그 금액은 ‘연금외수령’이 되어 깎아 주던 혜택이 사라지고 퇴직소득세가 그대로 붙어요.</li>
              <li>연간 <b>연금수령한도</b>(계좌 평가액 ÷ (11 − 연금수령연차) × 120%)를 넘는 인출도 혜택이 없어요. 11년차부터는 한도 없음.</li>
              <li>DB 금액은 ‘지금 그만두면’ 기준이라 월급·근속이 늘면 커집니다. 퇴직하면 IRP로 들어오니 그때 DB 입력을 0으로 바꿔 두 번 세지 않게 해 주세요.</li>
            </ul>
          </Section>
        </>}

        {layer === 3 && <>
          <Section title="이게 뭐예요">
            <p>내가 직접 넣는 <b>세제적격</b> 연금 — 연금저축(펀드·보험·신탁)과 IRP 개인 납입분. 넣을 때 <b>세액공제</b>(연금저축 600만, IRP 합산 900만 원까지 · 16.5% 또는 13.2%)를 받는 대신, 받을 때 <b>연금소득세</b>를 내는 구조예요.</p>
          </Section>
          <Section title="두 분 숫자">
            <table className="learn-table"><thead><tr><th/><th>지금 적립금</th><th>{row?.year ?? ''}년 월 수령(계산)</th><th>연간</th><th>1,500만 기준선</th></tr></thead><tbody>
              {people.map(([who, label]) => { const m = streams(data, who, 3).length ? amount(row, who, 3) ?? 0 : 0; const yearly = m * 12; return <tr key={who}><td>{label}</td><td>{capital(data, who, 3) == null ? '없음' : money(capital(data, who, 3))}</td><td>{m ? monthly(m) : '—'}</td><td>{m ? money(yearly) : '—'}</td><td className={yearly > privateLimit ? 'is-over' : ''}>{m ? yearly > privateLimit ? `넘음 (+${money(yearly - privateLimit)})` : `이내 · ${Math.round(yearly / privateLimit * 100)}% 사용` : '—'}</td></tr> })}
            </tbody></table>
            <p className="learn-note">기준선은 <b>사람마다 따로</b>예요(부부면 합쳐서 3,000만). 월 125만 원까지는 저율 과세로 끝납니다.</p>
          </Section>
          <Section title="세금은 이렇게">
            <ul>
              <li>연 1,500만 원 이하: <b>연금소득세만</b> — 55~69세 <b>5.5%</b>, 70대 <b>4.4%</b>, 80세부터 <b>3.3%</b>. 종신형으로 받으면 3.3%(2026년부터).</li>
              <li>연 1,500만 원을 넘으면 <b>그 해 전액</b>이 종합과세(6.6~49.5%)와 16.5% 분리과세 중 선택 대상이 돼요. ‘넘은 부분만’이 아니라 전체 방식이 바뀌는 문턱입니다. 다른 소득이 적으면 종합과세가 더 낮을 수도 있어서 두 경우를 다 봐야 해요.</li>
              <li>세액공제를 안 받은 납입 원금은 비과세, 퇴직금에서 온 돈은 별도 트랙 — 둘 다 1,500만 계산에 안 들어가요.</li>
            </ul>
          </Section>
          <Section title="꼭 알아둘 것" tone="warn">
            <ul>
              <li><b>55세 이후, 가입 5년 뒤부터, 10년 이상 나눠서</b> 받아야 연금이에요. 그 전에 깨거나 한도를 넘겨 꺼내면 <b>기타소득세 16.5%</b>.</li>
              <li>연간 연금수령한도 = 계좌 평가액 ÷ (11 − 연금수령연차) × 120%. 11년차부터 없음.</li>
              <li>ISA 만기 돈을 여기로 옮기면 이전액의 10%(최대 300만 원)를 그 해 추가 공제받아요.</li>
            </ul>
          </Section>
        </>}

        {layer === 4 && <>
          <Section title="이게 뭐예요">
            <p>연금 제도 밖에 있지만 은퇴에 쓰기로 한 돈 — <b>세제비적격 연금보험</b>(일반·변액연금보험), <b>ISA</b>, 그 밖의 투자. 넣을 때 세액공제가 없는 대신 <b>받을 때 연금소득세가 없고, 해지해도 토해 낼 공제가 없어요.</b> 그래서 ‘매달의 연금’이면서 ‘급할 때 꺼내는 목돈’도 됩니다.</p>
          </Section>
          <Section title="두 분 숫자">
            <table className="learn-table"><thead><tr><th/><th>등록한 금액</th><th>월로 나눠 쓰면 ({row?.year ?? ''}년)</th></tr></thead><tbody>
              {people.map(([who, label]) => <tr key={who}><td>{label}</td><td>{capital(data, who, 4) == null ? '없음' : money(capital(data, who, 4))}</td><td>{streams(data, who, 4).length ? monthly(extra(row, who)) : '—'}</td></tr>)}
            </tbody></table>
            <p className="learn-note">요약 카드의 기본 합계에는 넣지 않고 ‘월급으로 나눠 쓰면 / 목돈으로 두면’ 두 숫자로 따로 보여 줘요. 어느 쪽이 맞는지는 두 분이 정합니다.</p>
          </Section>
          <Section title="세금은 이렇게">
            <ul>
              <li><b>연금보험(세제비적격)</b>: 요건을 채우면 보험차익 <b>비과세</b>. 월적립식은 계약 10년 이상 + 5년 이상 납입 + 월 보험료 150만 원 이내, 일시납은 10년 이상 + 1억 원 이내, 종신형은 55세 이후 사망 시까지 수령 등. 요건이 안 되면 이자소득세 15.4%, 금융소득 연 2,000만 원 넘으면 종합과세.</li>
              <li><b>ISA</b>: 순이익 200만 원(서민형 400만 원)까지 비과세, 넘는 부분 9.9% 분리과세. 3년 의무가입. 만기 자금을 연금저축·IRP로 옮기면 10%(최대 300만 원) 추가 세액공제.</li>
              <li>비과세 소득은 1,500만 원 기준선에도, 건강보험 피부양자 소득에도 <b>들어가지 않아요.</b></li>
            </ul>
          </Section>
          <Section title="꼭 알아둘 것" tone="warn">
            <ul>
              <li>해지가 자유로운 대신 <b>해지환급금</b>은 낸 돈보다 적을 수 있어요(특히 초기). ‘지금 해지하면 얼마’는 보험사 앱에서 확인 — 곧 계약별로 적어 둘 수 있게 할 예정.</li>
              <li>연금보험 비과세는 <b>요건 체크</b>가 전부예요. 월 150만 원 넘게 넣거나 10년 전에 깨면 혜택이 사라집니다.</li>
              <li>이 층은 노후의 <b>목돈 지출</b>(의료비·자녀·집 수리)을 받아 주는 역할도 합니다. 전부 월급으로 바꿔 쓰면 그 여유가 없어져요.</li>
            </ul>
          </Section>
        </>}

        <div className="learn-sources"><p><Info size={13}/>기준: 세법 확인 {CHECKED.rules}{layer === 1 ? ` · 국민연금·건강보험 확인 ${CHECKED.national}` : ''}. 원문은 저장소 <code>docs/TAX_RULES.md</code>. 세법은 매년 바뀌어요 — 숫자가 맞는지 1월마다 다시 확인합니다. 이 페이지는 설명이지 추천이 아닙니다.</p>
          <ul>{(SOURCES[layer] ?? []).map(([label, href]) => <li key={href}><a href={href} target="_blank" rel="noreferrer">{label}<ExternalLink size={11}/></a></li>)}</ul></div>
      </div>
    </DialogContent>
  </Dialog>
}

function Section({ title, tone, children }: { title: string; tone?: 'warn'; children: ReactNode }) {
  return <section className={`learn-section${tone ? ` is-${tone}` : ''}`}><h3>{title}</h3>{children}</section>
}
