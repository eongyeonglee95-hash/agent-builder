import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './components/ui/button'
import { SectionMenu } from './components/ui/section-menu'
import { ObservationBoard } from './property-move/ObservationBoard'
import type { Owner } from './model'

const menus = [
  { id: 'move', label: '내 부동산' },
  { id: 'brief', label: '브리핑' }, { id: 'market', label: '시장 관측' },
  { id: 'watch', label: '관심 단지' }, { id: 'map', label: '관심 지도' },
  { id: 'signals', label: '급매 관측' }, { id: 'voices', label: '팔로우' },
  { id: 'journal', label: '주간·월간' }, { id: 'research', label: '리서치 노트' },
] as const
function lastPage() {
  try {
    const saved = sessionStorage.getItem('property-menu')
    return menus.some(m => m.id === saved) ? saved! : 'move'
  } catch { return 'move' }
}

// Keep the Sites document isolated: its global event handlers, dialogs, exports and
// existing localStorage records continue to work without modifying the asset ledger.
export function PropertyObservatory({ children, owner, hidden }: { children: ReactNode; owner: Owner; hidden: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const [page, setPage] = useState(lastPage)
  const [source] = useState(() => `/previews/property-observatory/index.html?embedded=1#${page === 'move' ? 'brief' : page}`)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => () => cleanup.current?.(), [])
  useEffect(() => { try { sessionStorage.setItem('property-menu', page) } catch { /* Storage may be disabled. */ } }, [page])
  useEffect(() => {
    if (ready) return
    const timer = window.setTimeout(() => setFailed(true), 15000)
    return () => window.clearTimeout(timer)
  }, [ready, attempt])

  function connect() {
    cleanup.current?.()
    const win = frame.current?.contentWindow
    const doc = frame.current?.contentDocument
    if (!win || !doc?.querySelector('#main')) { setFailed(true); return }
    doc.documentElement.dataset.embedded = 'true'
    const syncTheme = () => {
      const styles = getComputedStyle(document.documentElement)
      // Copy computed values, including user-selected theme and typography tokens.
      for (const name of Array.from(styles)) {
        if (/^--(grey-|text-|background$|foreground$|border$|input$|ring$|up|down)/.test(name)) doc.documentElement.style.setProperty(name, styles.getPropertyValue(name))
      }
    }
    const syncPage = () => {
      const id = win.location.hash.slice(1)
      setPage(id === 'compare' ? 'watch' : id === 'reports' ? 'journal' : menus.some(m => m.id === id) ? id : 'brief')
    }
    const checkReady = () => {
      if (doc.querySelector('#main')?.childElementCount) { setReady(true); setFailed(false) }
    }
    syncTheme(); checkReady()
    const themeObserver = new MutationObserver(syncTheme)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
    const contentObserver = new MutationObserver(checkReady)
    contentObserver.observe(doc.querySelector('#main')!, { childList: true })
    win.addEventListener('hashchange', syncPage)
    cleanup.current = () => { themeObserver.disconnect(); contentObserver.disconnect(); win.removeEventListener('hashchange', syncPage) }
  }

  function navigate(id: string) {
    setPage(id)
    if (!['move', 'brief', 'watch'].includes(id) && frame.current?.contentWindow) frame.current.contentWindow.location.replace(`/previews/property-observatory/index.html?embedded=1#${id}`)
  }

  return <section className="min-w-0 space-y-4 font-sans text-sm text-grey-900" aria-label="부동산 관측실">
    <SectionMenu label="부동산 메뉴" items={menus} value={page} onChange={navigate}/>
    <div hidden={['move', 'brief', 'watch'].includes(page)}>
      {!ready && !failed && <p role="status" className="py-4 text-sm text-grey-600">불러오는 중…</p>}
      {failed && <div role="alert" className="flex items-center gap-3 py-4 text-sm text-destructive">관측실을 불러오지 못했어요. 다시 열어 주세요.<Button variant="outline" size="sm" onClick={() => { setFailed(false); setReady(false); setAttempt(n => n + 1) }}>다시 열기</Button></div>}
      <iframe key={attempt} ref={frame} src={source} onLoad={connect} onError={() => setFailed(true)}
        title="부동산 관측실 화면" className="block h-[78dvh] min-h-96 w-full rounded-md border border-grey-200 bg-background"
        style={{ visibility: ready ? 'visible' : 'hidden' }}/>
    </div>
    {page === 'move' && children}
    {(page === 'brief' || page === 'watch') && <ObservationBoard key={`${owner}:${page}`} owner={owner} hidden={hidden} brief={page === 'brief'} onManage={() => navigate('move')}/>}
  </section>
}
