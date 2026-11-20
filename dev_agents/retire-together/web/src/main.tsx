import { ConnectionSettings } from './auth/ConnectionSettings'
import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { Workbook } from './workbook/Workbook'
import { AuthGate, useAuth } from './auth/AuthGate'
import './ux-refinements.css'
import SharedWorkbook from './auth/SharedWorkbook'
import { api } from './local-data'
import { DesignSystem } from './design/DesignSystem'
import './theme.css'   // 예전 화면 CSS도 이 안에서 legacy 레이어로 불러온다

// 2026-11-07 사용자 지정: 첫 화면은 메인. 표는 명시적인 #sheet-* 주소로 연다.
const CLASSIC = ['home', 'assets', 'pension', 'stocks', 'property', 'rebalance', 'household']
const isClassic = () => !new URLSearchParams(location.search).has('sheet_connection') && (!location.hash || CLASSIC.includes(location.hash.slice(1)))
const isDesign = () => location.hash.startsWith('#design')   // 디자인 견본 — docs/DESIGN_SYSTEM.md

function WorkbookRoute() {
  const { mode, session } = useAuth()
  const [shared, setShared] = useState<boolean | null>(mode === 'local' ? false : null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (mode === 'local') return
    const controller = new AbortController()
    void api<{ data_started: boolean }>('/google/shared/status', 'GET', undefined, controller.signal)
      .then(async status => { if (status.data_started) await api('/shared-data', 'GET', undefined, controller.signal); if (!controller.signal.aborted) setShared(status.data_started || session?.role === 'partner') })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [mode, session?.role])
  if (error) return <main><h1>자산 관리</h1><p role="alert">{error}</p><ConnectionSettings onChanged={() => location.reload()}/><a href="#assets">우리 자산으로 돌아가기</a></main>
  if (shared === null) return <p role="status">저장 위치를 확인하는 중…</p>
  return shared && session?.role !== 'owner' ? <SharedWorkbook/> : <Workbook shared={shared} onClassic={() => { location.hash = 'home' }}/>
}

function Root() {
  const [classic, setClassic] = useState(isClassic)
  const [design, setDesign] = useState(isDesign)
  useEffect(() => { const h = () => { setClassic(isClassic()); setDesign(isDesign()) }; window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h) }, [])
  if (design) return <DesignSystem/>
  if (!classic) return <WorkbookRoute/>
  return <App/>   // '표로 보기'는 사이드바 아래(App.tsx) — 화면 위에 띄우면 아래 내용과 겹친다 (2026-11-18)
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate><Root/></AuthGate></React.StrictMode>)
