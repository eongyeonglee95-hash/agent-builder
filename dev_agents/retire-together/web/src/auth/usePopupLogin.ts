import { useEffect, useRef, useState } from 'react'

export type LoginSession = { email: string; role: string; csrf_token: string }
export const loginErrorText = (code: string) => code === 'not_member'
  ? '이 가계 노트에 등록된 계정이 아닙니다. 오너 계정으로 다시 로그인해 주세요.'
  : '로그인이 취소되었거나 완료되지 않았습니다. 다시 시도해 주세요.'

export function usePopupLogin(onSession: (session: LoginSession) => void, onError: (error: string) => void) {
  const [waiting, setWaiting] = useState(false)
  const [notice, setNotice] = useState('')
  const callbacks = useRef({ onSession, onError })
  callbacks.current = { onSession, onError }
  const running = useRef<{ popup: Window; stop: () => void } | null>(null)
  useEffect(() => () => running.current?.stop(), [])

  function start(path = '/api/auth/google/login') {
    if (running.current && !running.current.popup.closed) { running.current.popup.focus(); return }
    running.current?.stop()
    callbacks.current.onError(''); setNotice('')
    const url = new URL(path, location.origin)
    url.searchParams.set('popup', '1')
    const popup = window.open(url.href, 'retire-google-login', 'popup,width=520,height=680')
    if (!popup) { location.assign(path); return }
    setWaiting(true)
    const started = Date.now()
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let request: AbortController | null = null
    const stop = () => {
      stopped = true
      clearTimeout(timer); request?.abort()
      window.removeEventListener('message', receive)
      try { if (!popup.closed) popup.close() } catch { /* COOP can sever the handle. */ }
      running.current = null
    }
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== popup || event.data?.type !== 'retire:login-result') return
      if (['failed', 'not_member'].includes(event.data.error)) {
        stop(); setWaiting(false); setNotice('')
        callbacks.current.onError(loginErrorText(event.data.error))
      }
      // A success message alone never authenticates: the poll reads the HttpOnly session.
    }
    window.addEventListener('message', receive)
    running.current = { popup, stop }
    const poll = async () => {
      if (stopped) return
      if (Date.now() - started > 10 * 60 * 1000) {
        stop(); setWaiting(false); setNotice('')
        callbacks.current.onError('로그인 시간이 지났습니다. 다시 시도해 주세요.'); return
      }
      request = new AbortController()
      const timeout = setTimeout(() => request?.abort(), 5000)
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store', signal: request.signal })
        if (response.ok) {
          const session: LoginSession = await response.json()
          if (!stopped) {
            stop(); setWaiting(false); setNotice(''); callbacks.current.onSession(session)
          }
          return
        }
      } catch { /* Temporary connection errors can recover during the popup flow. */ }
      finally { clearTimeout(timeout) }
      if (stopped) return
      // Google may report a closed WindowProxy while its window is still open.
      // Continue checking the session; allow an explicit retry instead of trusting that flag.
      if (popup.closed) setNotice('로그인이 완료되지 않았다면 Google로 로그인을 다시 눌러 주세요.')
      timer = setTimeout(poll, 1000)
    }
    void poll()
  }
  return { start, waiting, notice }
}
