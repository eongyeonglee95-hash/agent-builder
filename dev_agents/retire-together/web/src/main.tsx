import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { Workbook } from './workbook/Workbook'
import { AuthGate } from './auth/AuthGate'
import './ux-refinements.css'
import './theme.css'   // 예전 화면 CSS도 이 안에서 legacy 레이어로 불러온다

// 2026-11-07 사용자 지정: 첫 화면은 메인. 표는 명시적인 #sheet-* 주소로 연다.
const CLASSIC = ['home', 'assets', 'pension', 'stocks', 'property', 'rebalance']
const isClassic = () => !location.hash || CLASSIC.includes(location.hash.slice(1))

function Root() {
  const [classic, setClassic] = useState(isClassic)
  useEffect(() => { const h = () => setClassic(isClassic()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h) }, [])
  if (!classic) return <Workbook onClassic={() => { location.hash = 'home' }}/>
  return <><App/><button className="wb-back" onClick={() => { location.hash = 'sheet-summary' }}>표로 보기</button></>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate><Root/></AuthGate></React.StrictMode>)
