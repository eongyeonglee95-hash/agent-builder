import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Bell, ChevronRight, LogOut, Settings, UserRound, Users } from 'lucide-react'
import { Brand, Modal } from '../components'
import { apiFetch, expiredEvent, setAuthSession } from './session'
import { loginErrorText, usePopupLogin } from './usePopupLogin'
import InvitationEntry, { invitationRoute } from './InvitationEntry'
import './auth.css'
import './account-menu.css'

type Session = { email: string; role: string; csrf_token: string }
type Status = { mode: 'local' | 'web'; login_enabled: boolean; initialized?: boolean }
const AuthContext = createContext<{ mode: 'local' | 'web'; session: Session | null }>({ mode: 'local', session: null })
export const useAuth = () => useContext(AuthContext)

export function AuthGate({ children }: { children: ReactNode }) {
  const [invitation, setInvitation] = useState(invitationRoute)
  const [invitationVisit, setInvitationVisit] = useState(0)
  useEffect(() => {
    const update = () => {
      setInvitation(invitationRoute())
      // A new link in the same tab must consume its code, even on the invite page.
      if (location.hash.startsWith('#invite=')) setInvitationVisit(visit => visit + 1)
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  const [welcomePreview, setWelcomePreview] = useState(() => new URL(location.href).searchParams.get('view') === 'welcome')
  function leaveWelcome() {
    const url = new URL(location.href)
    url.searchParams.delete('view')
    history.replaceState(null, '', url.pathname + url.search + url.hash)
    setWelcomePreview(false)
  }
  const [loginError, setLoginError] = useState(() => {
    const url = new URL(location.href)
    const code = url.searchParams.get('login_error')
    if (!code) return ''
    return loginErrorText(code)
  })
  useEffect(() => {
    const url = new URL(location.href)
    if (url.searchParams.has('login_error')) {
      url.searchParams.delete('login_error')
      history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
  }, [])
  const [status, setStatus] = useState<Status | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const popup = usePopupLogin(identity => {
    setAuthSession('web', identity.csrf_token)
    setSession(identity); setStatus({ mode: 'web', login_enabled: true, initialized: true }); setReady(true)
    leaveWelcome()
  }, setLoginError)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    setReady(false); setError('')
    async function load() {
      try {
        const response = await fetch('/api/auth/status', { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('로그인 설정을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.')
        const next: Status = await response.json()
        if (!['local', 'web'].includes(next.mode)) throw new Error('로그인 설정을 확인할 수 없습니다.')
        let identity: Session | null = null
        if (next.mode === 'web') {
          const result = await fetch('/api/auth/session', { signal: controller.signal, cache: 'no-store' })
          if (result.ok) identity = await result.json()
          else if (result.status !== 401) throw new Error('로그인 상태를 확인할 수 없습니다. 다시 시도해 주세요.')
        }
        if (controller.signal.aborted) return
        setAuthSession(next.mode, identity?.csrf_token)
        setStatus(next); setSession(identity); setReady(true)
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '연결을 확인해 주세요.')
        else if (controller.signal.reason?.name === 'AbortError') setError('서버 응답이 늦어지고 있습니다. 다시 시도해 주세요.')
      } finally { clearTimeout(timer) }
    }
    void load()
    return () => { controller.abort('unmount'); clearTimeout(timer) }
  }, [revision])
  useEffect(() => {
    const expired = () => { setAuthSession('web'); setSession(null); setStatus(s => s ? { ...s, initialized: true } : s) }
    window.addEventListener(expiredEvent, expired)
    return () => window.removeEventListener(expiredEvent, expired)
  }, [])
  const canEnter = ready && status && (status.mode === 'local' || session)
  if (ready && status?.mode === 'web' && invitation) return <InvitationEntry key={invitationVisit}/>
  if (canEnter && !welcomePreview) {
    return <AuthContext.Provider value={{ mode: status.mode, session }}>{children}</AuthContext.Provider>
  }
  return <main className="auth-page">
    <img className="auth-scenery" src="/retirement-coast-login-v1.png" alt="" fetchPriority="high"/>
    <header className="auth-header"><Brand/><span>함께 준비하는 은퇴</span></header>
    <div className="auth-content">
      <div className="auth-story">
        <p className="auth-eyebrow">LIFE, TOGETHER.</p>
        <h1>함께 준비한 오늘,<br/>둘이 누리는 내일.</h1>
        <p className="auth-story-copy">우리의 자산과 연금을 한곳에.<br/>함께 바라는 은퇴를 차근차근 준비해요.</p>
      </div>
      <section className="auth-card" aria-labelledby="auth-title">
    <p className="auth-card-eyebrow">OUR NEXT CHAPTER</p>
    <h2 id="auth-title">둘이서, 시작해 볼까요?</h2>
    <p className="auth-intro">구글 계정으로 우리의 가계 노트를 열어보세요.</p>
    {error ? <><p role="alert" className="auth-error">{error}</p><button className="auth-login" onClick={() => setRevision(v => v + 1)}>다시 확인</button></>
      : !ready ? <p role="status">로그인 상태를 확인하고 있어요…</p>
      : canEnter ? <><button className="auth-login" onClick={leaveWelcome}>나의 가계 노트 열기<ArrowRight size={18} aria-hidden="true"/></button><p className="auth-help">이어서 우리의 은퇴를 준비해요.</p></>
      : <>{loginError && <p className="auth-error" role="alert">{loginError}</p>}<a className="auth-login" href="/api/auth/google/login" onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault(); popup.start()
      }}>Google로 로그인<ArrowRight size={18} aria-hidden="true"/></a>
        {popup.waiting && <p className="auth-help" role="status">{popup.notice || '열린 구글 창에서 로그인을 마치면 이 화면이 바로 열립니다.'}</p>}
        {loginError && <a className="auth-help" href="/api/auth/google/login?choose=1" onClick={event => { event.preventDefault(); popup.start('/api/auth/google/login?choose=1') }}>다른 Google 계정 선택</a>}
        <p className="auth-help">{status?.initialized === false ? '처음 로그인하는 본인 계정이 이 가계 노트의 오너가 됩니다. 오너는 나중에 바꿀 수 없어요.' : '오너 또는 초대를 수락한 배우자의 구글 계정으로 로그인해 주세요.'}</p><a className="auth-help" href="#invite">초대 코드로 합류</a></>}
      </section>
    </div>
    <footer className="auth-footer"><span>우리의 속도로, 함께.</span><span>RETIRE TOGETHER</span></footer>
  </main>
}

type AccountMenuProps = {
  sidebar?: boolean
  onSheets?: () => void
  onProfile?: () => void
  onFamily?: () => void
  onNotifications?: () => void
  dataMode?: { isDemo: boolean; asOf: string; onChange: (demo: boolean) => void }
}

export function AccountMenu({ onProfile, onFamily, onNotifications, dataMode, sidebar = false, onSheets }: AccountMenuProps = {}) {
  const { mode, session } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!session && !onProfile && !onFamily && !onNotifications && !dataMode) return null
  function navigate(action: () => void) { setOpen(false); action() }
  async function logout() {
    setBusy(true); setError('')
    try {
      const response = await apiFetch('/api/auth/logout', { method: 'POST' })
      if (!response.ok) throw new Error('로그아웃하지 못했습니다. 다시 시도해 주세요.')
      setAuthSession('web')
      window.dispatchEvent(new Event(expiredEvent))
    } catch (e) { setError(e instanceof Error ? e.message : '연결을 확인해 주세요.') }
    finally { setBusy(false) }
  }
  return <><button className={sidebar ? "sidebar-account" : "auth-account"} aria-label={sidebar ? "우리 가족 · 설정" : "마이페이지"} aria-haspopup="dialog" onClick={() => setOpen(true)}><UserRound size={22} aria-hidden="true"/>{sidebar && <><span><strong>우리 가족 · 설정</strong><small>내 정보 · 연결 계정</small></span><ChevronRight size={16} aria-hidden="true"/></>}</button>
    {open && <Modal title={sidebar ? "우리 가족 · 설정" : "마이페이지"} onClose={() => setOpen(false)}><div className="account-page">
      <div className="account-identity"><UserRound size={28} aria-hidden="true"/><div><strong>{session ? 'Google 계정으로 로그인 중' : '이 컴퓨터의 가계 노트'}</strong><p>{session?.email ?? '저장된 내 정보와 자산을 관리해요.'}</p>{session && <span>{session.role === 'owner' ? '오너' : '배우자'}</span>}</div></div>
      <nav className="account-actions" aria-label="내 계정 관리">
        {onProfile && <button onClick={() => navigate(onProfile)}><Settings size={20} aria-hidden="true"/><span>내 정보 · 설정</span><ChevronRight size={18} aria-hidden="true"/></button>}
        {onFamily && <button onClick={() => navigate(onFamily)}><Users size={20} aria-hidden="true"/><span>우리 가족</span><ChevronRight size={18} aria-hidden="true"/></button>}
        {onSheets && <button onClick={() => navigate(onSheets)}><Settings size={20} aria-hidden="true"/><span>구글 시트 · 연결 관리</span><ChevronRight size={18} aria-hidden="true"/></button>}
        {onNotifications && <button onClick={() => navigate(onNotifications)}><Bell size={20} aria-hidden="true"/><span>알림 · 안내</span><ChevronRight size={18} aria-hidden="true"/></button>}
      </nav>
      {dataMode && <section className="account-view"><h3>화면에 보여줄 자료</h3><div role="group" aria-label="데이터 보기">
        <button aria-pressed={!dataMode.isDemo} onClick={() => navigate(() => dataMode.onChange(false))}>내 자산</button>
        <button aria-pressed={dataMode.isDemo} onClick={() => navigate(() => dataMode.onChange(true))}>예시 보기</button>
      </div><p>{dataMode.isDemo ? '지금은 예시 자료를 보고 있어요.' : dataMode.asOf === '미등록' ? '아직 등록한 자산이 없어요.' : `내 자산 · ${dataMode.asOf} 기준`}<br/>예시 보기로 바꿔도 내 자료는 그대로 보관돼요.</p></section>}
      {mode === 'web' && session && <button className="account-logout" disabled={busy} onClick={logout}><LogOut size={18} aria-hidden="true"/>{busy ? '로그아웃 중…' : '로그아웃'}</button>}
      {error && <p role="alert" className="auth-error">{error}</p>}
    </div></Modal>}
  </>
}
