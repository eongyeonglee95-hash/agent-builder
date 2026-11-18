import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, Download, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { ObservationRow } from '@/components/ui/observation-row'
import { SectionMenu } from '@/components/ui/section-menu'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ReadGrid, type Cell } from '@/workbook/ReadGrid'
import { MixRows } from '@/workbook/RebalancePlan'
import { classInfo } from '../model'
import { day, manwon, pct, pp, shares, won } from '@/lib/format'

// 디자인 견본 — 주소 #design. 문서는 docs/DESIGN_SYSTEM.md. 여기 있는 것은 모두 실제 컴포넌트·토큰이라 바꾸면 앱 전체에 같이 바뀐다.
// 새 컴포넌트·패턴을 만들면 이 페이지에도 한 칸 추가한다. 숫자는 모두 가짜 예시.

const SECTIONS = [
  ['color', '색'], ['type', '글자'], ['number', '숫자 표기'], ['button', '버튼'], ['form', '입력'],
  ['overlay', '메뉴·대화상자'], ['sheet', '엑셀 시트'], ['state', '상태 문구'], ['dont', '하지 말 것'],
] as const

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return <section id={id} className="scroll-mt-16 border-b border-grey-200 py-8">
    <h2 className="text-xl font-semibold">{title}</h2>
    {note && <p className="mt-1 text-sm text-grey-600">{note}</p>}
    <div className="mt-5">{children}</div>
  </section>
}

function Swatch({ token, label, note }: { token: string; label?: string; note?: string }) {
  const [hex, setHex] = useState('')
  useEffect(() => { setHex(getComputedStyle(document.documentElement).getPropertyValue(token).trim()) }, [token])
  return <div className="min-w-0">
    <div className="h-12 rounded-md border border-grey-200" style={{ background: `var(${token})` }}/>
    <div className="mt-1.5 truncate text-xs font-medium">{label ?? token.replace('--', '')}</div>
    <div className="truncate text-xs text-grey-600">{token} · {hex}</div>
    {note && <div className="truncate text-xs text-grey-500">{note}</div>}
  </div>
}

const grid = 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'
const TYPE: [string, string, string][] = [
  ['text-3xl', '30px', '화면 맨 위 큰 합계 하나'],
  ['text-2xl', '22px', '요약 숫자(카드 안)'],
  ['text-xl', '20px', '구역 제목'],
  ['text-lg', '17px', '대화상자 제목'],
  ['text-base', '15px', '본문·로고'],
  ['text-sm', '13px', '표·버튼·입력 — 가장 많이 씀'],
  ['text-xs', '12px', '표 머리·보조 설명·시트 탭 힌트'],
]

const EXAMPLES: [string, string, string][] = [
  ['won(11239428)', won(11239428), '잔고·평가금액'],
  ['won(-196888)', won(-196888), '음수는 − (U+2212)'],
  ['won(n, {signed:true})', won(146000, { signed: true }), '손익·변화량은 + 를 붙인다'],
  ['won(n, {unit:false})', won(4623502, { unit: false }), '표 칸 — 머리줄에 (원)'],
  ['manwon(312450000)', manwon(312450000), '큰 금액 요약 문장'],
  ['pct(3.149)', pct(3.149), '수익률 — 소수 2자리, 부호'],
  ['pct(41.2, {signed:false})', pct(41.2, { signed: false, digits: 1 }), '비중 — 부호 없음'],
  ['pp(-1.24)', pp(-1.24), '비중 차이'],
  ['shares(153)', shares(153), '수량'],
  ['won(null)', won(null), '값 없음(아직 모름) — 0과 다르다'],
  ['won(n, {hidden:true})', won(5000000, { hidden: true }), '금액 숨기기'],
  ['day("2026-11-16")', day('2026-11-16'), '기준일'],
]

function sampleRows(paid: string, setPaid: (v: string) => void): Cell[][] {
  const h = (v: string) => ({ v, head: true })
  return [
    [{ v: '주식 계좌', section: true, span: 6 }],
    [h('종목'), h('수량'), h('평가금액(원)'), h('평가손익(원)'), h('수익률'), h('비중')],
    [{ v: '아마존닷컴 (AMZN)' }, { v: 13 }, { v: 4623502, fmt: 'won' }, { v: 141132, fmt: 'signed', tone: 'auto' }, { v: 3.15, fmt: 'pct', tone: 'auto' }, { v: 41.1, fmt: 'pct', bar: { pct: 41.1, color: classInfo.stock.color } }],
    [{ v: '플래닛 랩스 (PL)' }, { v: 153 }, { v: 2799900, fmt: 'won' }, { v: -1757412, fmt: 'signed', tone: 'auto' }, { v: -38.55, fmt: 'pct', tone: 'auto' }, { v: 24.9, fmt: 'pct', bar: { pct: 24.9, color: classInfo.stock.color } }],
    [{ v: '예수금', tone: 'muted' }, { v: '' }, { v: 3241, fmt: 'won' }, { v: '' }, { v: '' }, { v: 0.03, fmt: 'pct', bar: { pct: 0.03, color: classInfo.cash.color } }],
    [{ v: '합계', bold: true }, { v: '' }, { v: 7426643, fmt: 'won', bold: true }, { v: -1616280, fmt: 'signed', tone: 'auto', bold: true }, { v: '' }, { v: '' }],
    [{ v: '이번 달 납입(입력 칸)' }, { edit: { value: paid, onCommit: setPaid, placeholder: '0', label: '이번 달 납입' }, span: 2 }, { v: '목표와 차이' }, { v: -1.2, fmt: 'pp', tone: 'auto' }, { btn: { label: '결정 기록', onClick: () => {}, primary: true } }],
  ]
}

export function DesignSystem() {
  const [section, setSection] = useState('brief')
  const [paid, setPaid] = useState('300000')
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState('')
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])

  return <TooltipProvider><div className="wb min-h-dvh bg-grey-100 text-grey-900">
    <header className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-grey-200 bg-white px-4">
      <span className="text-base font-semibold tracking-tight">둘이서은퇴</span>
      <span className="text-xs text-grey-600">디자인 견본</span>
      <nav className="ml-auto hidden gap-1 overflow-x-auto md:flex">{SECTIONS.map(([id, l]) =>
        <a key={id} href={`#design/${id}`} onClick={e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }) }}
          className="rounded-md px-2 py-1 text-sm text-grey-700 hover:bg-grey-100">{l}</a>)}</nav>
      <Button variant="ghost" size="sm" className="ml-auto h-8 text-grey-700 md:ml-0" onClick={() => { location.hash = "" }}>앱으로</Button>
    </header>

    <main className="mx-auto max-w-5xl bg-white px-4 sm:px-8">
      <div className="border-b border-grey-200 py-8">
        <h1 className="text-3xl font-bold tracking-tight">디자인 견본</h1>
        <p className="mt-2 max-w-2xl text-base text-grey-700">새 화면은 여기 있는 토큰·컴포넌트만으로 만들어요. 규칙과 이유는 <code className="rounded bg-grey-100 px-1 text-sm">docs/DESIGN_SYSTEM.md</code>.</p>
      </div>

      <Section id="rebalance" title="리밸런싱 비교표" note="계좌색 위 흰 비교표 · 현재/목표는 보조 정보 · 주문 금액 강조. 예시 데이터입니다.">
          <MixRows mix={[
            { asset_class: 'stock', label: '주식 (국내·해외·배당·리츠)', current_pct: 70, target_pct: 30, sell: 16000000, buy: 0 },
            { asset_class: 'long_bond', label: '장기채', current_pct: 0, target_pct: 40, sell: 0, buy: 16000000 },
            { asset_class: 'gold', label: '금', current_pct: 15, target_pct: 15, sell: 0, buy: 0 },
          ]} leftover={0}/>
        </Section>
        <Section id="color" title="색" note="회색은 토스 디자인 시스템 10단계. 빨강은 상승, 파랑은 하락에만 써요. 강조색은 엑셀 초록 하나, 시트 선택과 현재 탭에만.">
        <h3 className="mb-2 text-sm font-semibold">회색</h3>
        <div className={grid}>{[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map(n => <Swatch key={n} token={`--grey-${n}`} note={({ 100: '화면 바탕', 200: '선', 300: '입력 테두리', 500: '비활성 글자', 600: '보조 글자', 900: '본문·주 버튼' } as Record<number, string>)[n]}/>)}</div>
        <h3 className="mb-2 mt-6 text-sm font-semibold">상승·하락</h3>
        <div className={grid}>
          <Swatch token="--up" label="상승 (표 숫자)" note="대비 5.26:1"/><Swatch token="--up-big" label="상승 (22px 이상)"/><Swatch token="--up-soft" label="상승 옅은 바탕"/>
          <Swatch token="--down" label="하락 (표 숫자)" note="대비 5.41:1"/><Swatch token="--down-big" label="하락 (22px 이상)"/><Swatch token="--down-soft" label="하락 옅은 바탕"/>
        </div>
        <h3 className="mb-2 mt-6 text-sm font-semibold">자산군</h3>
        <div className={grid}>{Object.entries(classInfo).map(([k, c]) => <Swatch key={k} token={c.color.slice(4, -1)} label={c.label}/>)}</div>
        <h3 className="mb-2 mt-6 text-sm font-semibold">엑셀 시트·상태</h3>
        <div className={grid}>
          <Swatch token="--sheet-select" label="선택·현재 탭 (유일한 강조색)"/><Swatch token="--sheet-select-soft" label="선택 범위 바탕"/>
          <Swatch token="--sheet-line" label="격자선"/><Swatch token="--sheet-head" label="머리 바탕"/>
          <Swatch token="--input-soft" label="입력 칸 바탕"/><Swatch token="--destructive" label="오류·삭제"/>
        </div>
      </Section>

      <Section id="type" title="글자" note="Pretendard, 7단계만. 숫자는 고정폭(tabular-nums)이라 위아래 자리가 맞아요. 굵기는 보통(400)·중간(500)·진하게(600)·제목(700).">
        <div className="divide-y divide-grey-200">{TYPE.map(([cls, px, use]) =>
          <div key={cls} className="flex items-baseline gap-4 py-3">
            <span className="w-24 shrink-0 text-xs text-grey-600">{cls}<br/>{px}</span>
            <span className={`${cls} min-w-0 flex-1 truncate`}>우리 노후 1,124만원</span>
            <span className="hidden w-56 shrink-0 text-xs text-grey-600 sm:block">{use}</span>
          </div>)}</div>
      </Section>

      <Section id="number" title="숫자 표기" note="계산은 서버가, 표기는 web/src/lib/format.ts 한곳에서. 파일마다 won()을 새로 만들지 않아요.">
        <div className="overflow-x-auto rounded-md border border-grey-200">
          <table className="w-full text-sm">
            <thead className="bg-grey-50 text-xs text-grey-600"><tr><th className="px-3 py-2 text-left font-medium">함수</th><th className="px-3 py-2 text-right font-medium">결과</th><th className="px-3 py-2 text-left font-medium">언제</th></tr></thead>
            <tbody className="divide-y divide-grey-200">{EXAMPLES.map(([fn, out, when]) =>
              <tr key={fn}><td className="px-3 py-2 font-mono text-xs text-grey-700">{fn}</td><td className="px-3 py-2 text-right tabular-nums">{out}</td><td className="px-3 py-2 text-grey-600">{when}</td></tr>)}</tbody>
          </table>
        </div>
        <h3 className="mb-2 mt-6 text-sm font-semibold">Amount — 표 밖에서 숫자 한 개</h3>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div><div className="text-xs text-grey-600">키움 주식계좌</div><Amount value={11239428} className="text-3xl font-bold"/></div>
          <div><div className="text-xs text-grey-600">평가손익</div><Amount value={-1616280} fmt="signed" tone="auto" big className="text-2xl font-semibold"/></div>
          <div><div className="text-xs text-grey-600">수익률</div><Amount value={3.149} fmt="pct" tone="auto" className="text-sm"/></div>
          <div><div className="text-xs text-grey-600">숨김</div><Amount value={11239428} hidden className="text-2xl font-semibold"/></div>
        </div>
      </Section>

      <Section id="property-observation" title="단지 비교 행"><div className="overflow-hidden rounded-md border border-grey-200"><ObservationRow title="견본 아파트" subtitle="전용 84㎡" metrics={[{ label: '기록 호가', value: <Amount value={900000000} fmt="manwon"/>, detail: '2026.11.17' }, { label: '최근 실거래', value: <Amount value={880000000} fmt="manwon"/>, detail: '2026.10.01 · 8층' }, { label: '중간값', value: <Amount value={870000000} fmt="manwon"/>, detail: '12건' }, { label: '추가 자금', value: <Amount value={200000000} fmt="manwon"/> }]}/></div></Section>
      <Section id="property-menu" title="화면 안의 메뉴" note="부동산 관측실처럼 다른 작업으로 이동할 때 사용해요."><SectionMenu label="메뉴 견본" value={section} onChange={setSection} items={[{ id: 'brief', label: '브리핑' }, { id: 'watch', label: '관심 단지' }, { id: 'journal', label: '주간·월간' }]}/></Section>
      <Section id="button" title="버튼" note="한 화면에 진한 주 버튼은 하나. 나머지는 테두리(outline)나 조용한(ghost). 파란 버튼은 없어요 — 파랑은 하락.">
        <div className="flex flex-wrap items-center gap-2">
          <Button>저장</Button>
          <Button variant="outline">가져오기<ChevronDown className="size-3.5"/></Button>
          <Button variant="secondary">취소</Button>
          <Button variant="ghost" className="text-grey-700"><RefreshCw className="size-3.5"/>다시 불러오기</Button>
          <Button variant="link">자세히</Button>
          <Button variant="destructive"><Trash2 className="size-3.5"/>삭제</Button>
          <Button disabled>저장</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="xs">xs 24px · 표 안</Button><Button size="sm">sm 32px · 머리줄</Button><Button>기본 36px · 대화상자</Button><Button size="lg">lg 40px</Button>
          <Button size="icon-sm" variant="outline" aria-label="추가"><Plus/></Button>
        </div>
      </Section>

      <Section id="form" title="입력" note="이름표는 칸 위에. 금액은 오른쪽 정렬·숫자 키패드. 오류는 칸 아래 한 줄, 고칠 방법까지.">
        <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="ds-name">계좌 이름</Label><Input id="ds-name" placeholder="예: 키움 주식계좌"/></div>
          <div className="grid gap-1.5"><Label htmlFor="ds-amt">이번 달 납입(원)</Label><Input id="ds-amt" inputMode="numeric" className="text-right tabular-nums" defaultValue="300,000"/></div>
          <div className="grid gap-1.5"><Label>누구의 자산</Label>
            <Select defaultValue="me"><SelectTrigger className="w-full"><SelectValue/></SelectTrigger>
              <SelectContent><SelectItem value="together">부부 전체</SelectItem><SelectItem value="me">나</SelectItem><SelectItem value="partner">배우자</SelectItem></SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="ds-bad">수량</Label><Input id="ds-bad" aria-invalid defaultValue="-3" className="text-right"/>
            <p className="text-xs text-destructive">수량은 0보다 커야 해요. 판 종목이면 줄을 지워 주세요.</p></div>
          <label className="flex items-center gap-2 text-sm text-grey-700"><Checkbox defaultChecked/>현재가 반영</label>
        </div>
      </Section>

      <Section id="overlay" title="메뉴·대화상자" note="그림자는 떠 있는 층(메뉴·대화상자·알림)에만. 면 위 요소는 선과 바탕색 차이로 나눠요.">
        <div className="flex flex-wrap items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm">가져오기<ChevronDown className="size-3.5"/></Button></DropdownMenuTrigger>
            <DropdownMenuContent className="w-56"><DropdownMenuItem><RefreshCw className="size-4"/>키움에서 잔고 불러오기</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem><Download className="size-4"/>빈 엑셀 양식 받기</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={() => setOpen(true)}>대화상자 열기</Button>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="text-grey-700">툴팁</Button></TooltipTrigger><TooltipContent>D+2 추정예수금 — 결제 끝난 뒤 남는 현금</TooltipContent></Tooltip>
          <Button variant="outline" size="sm" onClick={() => setToast('키움 잔고를 새로 저장했어요.')}>알림 띄우기</Button>
        </div>
        <Tabs defaultValue="a" className="mt-6 max-w-md">
          <TabsList><TabsTrigger value="a">나</TabsTrigger><TabsTrigger value="b">배우자</TabsTrigger><TabsTrigger value="c">부부 전체</TabsTrigger></TabsList>
          <TabsContent value="a" className="text-sm text-grey-700">탭은 같은 화면 안에서 보는 대상만 바꿀 때.</TabsContent>
          <TabsContent value="b" className="text-sm text-grey-700">배우자 자산</TabsContent><TabsContent value="c" className="text-sm text-grey-700">부부 전체</TabsContent>
        </Tabs>
      </Section>

      <Section id="sheet" title="엑셀 시트" note="워크북의 읽기 표(ReadGrid). 칸을 누르고 방향키로 움직여 보세요. 숫자는 오른쪽, 머리줄에 단위, 노란 칸만 입력.">
        <div className="flex h-80 flex-col overflow-hidden rounded-md border border-grey-200">
          <ReadGrid label="견본 시트" widths={[190, 70, 120, 120, 90, 130]} rows={sampleRows(paid, setPaid)}/>
        </div>
      </Section>

      <Section id="state" title="상태 문구" note="해요체, 한 문장. 무슨 일이 있었는지 + 다음에 할 일. 영어·기술 용어·느낌표 없이.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-grey-200 p-4"><div className="text-xs text-grey-600">불러오는 중</div><p className="mt-1 flex items-center gap-2 text-sm"><RefreshCw className="size-3.5 animate-spin text-grey-600"/>불러오는 중…</p></div>
          <div className="rounded-md border border-grey-200 p-4"><div className="text-xs text-grey-600">비어 있음</div><p className="mt-1 text-sm">아직 등록한 계좌가 없어요.</p><Button size="sm" className="mt-2">계좌 등록</Button></div>
          <div className="rounded-md border border-grey-200 p-4"><div className="text-xs text-grey-600">오류</div><p className="mt-1 text-sm text-destructive">키움 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.</p></div>
          <div className="rounded-md border border-grey-200 p-4"><div className="text-xs text-grey-600">완료 알림 (3.5초)</div><div className="mt-2 inline-block rounded-md bg-grey-900 px-4 py-2 text-sm text-white">한 줄 요약을 복사했어요.</div></div>
        </div>
      </Section>

      <Section id="dont" title="하지 말 것" note="사용자 확정(2026-10-28): 증권사 잔고 화면·토스처럼. AI가 만든 티가 나는 장식은 빼요.">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['점 달린 알약 배지, 그라데이션 아이콘·배경', '글자와 숫자만, 선과 바탕으로 구역 나누기'],
            ['영문 머리글 (STAY WITH YOUR PLAN)', '한국어 제목 하나'],
            ['"왜 이렇게 했는지" 설명 카드', '필요하면 툴팁이나 칸 아래 한 줄'],
            ['파란 버튼·파란 링크', '진한 주 버튼, 파랑은 하락에만'],
            ['코드에 #hex 색, text-[13px] 같은 임의 크기', '토큰 클래스(text-sm, text-grey-600, bg-cls-stock)'],
            ['"이 ETF가 좋아요", "오를 거예요"', '사실과 계산 결과만'],
          ].map(([no, yes]) => <div key={no} className="grid gap-1 rounded-md border border-grey-200 p-4 text-sm">
            <span className="text-destructive">✕ {no}</span><span className="text-grey-700">○ {yes}</span></div>)}
        </div>
      </Section>
      <p className="py-8 text-xs text-grey-600">숫자는 모두 견본용 예시예요.</p>
    </main>

    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>키움에서 잔고 불러오기</DialogTitle><DialogDescription>합계가 키움과 다를 때만 이 확인 창이 떠요.</DialogDescription></DialogHeader>
        <div className="flex items-baseline justify-between text-sm"><span className="text-grey-600">키움 총평가</span><Amount value={11239428} className="text-lg font-semibold"/></div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>닫기</Button><Button onClick={() => { setOpen(false); setToast('저장했어요.') }}>저장</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {toast && <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-grey-900 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>}
  </div></TooltipProvider>
}
