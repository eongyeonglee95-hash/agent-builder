import { useState } from 'react'
import { Settings } from 'lucide-react'
import { Modal } from '../components'
import { GoogleSheetPanel } from '../google'

export function ConnectionSettings({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(() => location.hash === '#sheet-connection' || new URLSearchParams(location.search).has('sheet_connection'))
  function close() {
    setOpen(false)
    const url = new URL(location.href)
    url.searchParams.delete('sheet_connection')
    if (url.hash === '#sheet-connection') url.hash = 'sheet-assets'
    history.replaceState(null, '', url.pathname + url.search + url.hash)
  }
  return <>
    <button className="secondary-button" onClick={() => setOpen(true)}><Settings size={16}/>연결 설정</button>
    {open && <Modal title="연결 설정" onClose={close}><GoogleSheetPanel onChanged={onChanged}/></Modal>}
  </>
}
