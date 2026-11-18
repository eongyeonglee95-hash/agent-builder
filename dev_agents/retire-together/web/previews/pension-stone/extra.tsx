import { createRoot } from 'react-dom/client'
import { ExtraPensionSummary } from '../../src/retirement/ExtraPensionSummary'
import '../../src/theme.css'
import './extra-preview.css'

createRoot(document.getElementById('root')!).render(<main className="extra-copy-preview">
  <p>문구 시안 · 예시 금액</p>
  <ExtraPensionSummary monthly="월 30만 원" capital="7,200만 원" combined="월 300만 원"/>
  <a href="./index.html#pension">내 연금 화면에서 보기</a>
</main>)
