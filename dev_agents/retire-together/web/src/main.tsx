import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { Workbook } from './workbook/Workbook'
import './theme.css'   // 예전 화면 CSS도 이 안에서 legacy 레이어로 불러온다

// 첫 화면은 엑셀 워크북(2026-10-28 사용자 확정). 예전 카드형 화면은 '다른 버전으로 보기' — 그 화면들의 주소(#home 등)로 들어가면 예전 화면.
const CLASSIC = ['home', 'assets', 'pension', 'stocks', 'property', 'rebalance']
const isClassic = () => CLASSIC.includes(location.hash.slice(1))

function Root() {
  const [classic, setClassic] = useState(isClassic)
  useEffect(() => { const h = () => setClassic(isClassic()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h) }, [])
  if (!classic) return <Workbook onClassic={() => { location.hash = 'home' }}/>
  return <><App/><button className="wb-back" onClick={() => { history.pushState(null, '', location.pathname); setClassic(false) }}>엑셀 보기로</button></>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>)
