// The CSRF token lives only in memory. Authentication stays in an HttpOnly cookie.
let mode: 'local' | 'web' = 'local'
let csrf = ''
type SheetContext = { sheet: string; revision: string }
let sharedContext: SheetContext | undefined
const contexts = new Map<string, SheetContext>()
const pending = new Map<string, { operation: string; context: SheetContext }>()
function contextKey(path: string) {
  const parts = path.split('/')
  return parts[2] === 'portfolios' ? 'portfolio' : parts[2] === 'workbook' ? parts.slice(2, 4).join('/').replace('portfolios', 'portfolio') : parts[2]
}

export const expiredEvent = 'retire:session-expired'

export function setAuthSession(nextMode: 'local' | 'web', token = '') {
  if (mode !== nextMode || csrf !== token) { sharedContext = undefined; contexts.clear(); pending.clear() }
  mode = nextMode
  csrf = token
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const url = new URL(path, location.origin)
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) throw new Error('앱 API 주소가 아닙니다.')
  const headers = new Headers(init.headers)
  headers.set('X-Retire-Local', '1')
  if (mode === 'web' && !['GET', 'HEAD', 'OPTIONS'].includes((init.method ?? 'GET').toUpperCase()) && csrf) {
    headers.set('X-Retire-CSRF', csrf)
  }
  const method = (init.method ?? 'GET').toUpperCase()
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  const group = contextKey(url.pathname)
  const context = contexts.get(group) ?? sharedContext
  let pendingKey = ''
  if (mode === 'web' && mutation && context && !url.pathname.startsWith('/api/shared-data') && !url.pathname.startsWith('/api/google/') && !url.pathname.startsWith('/api/auth/')) {
    pendingKey = `${method}:${url.pathname}${url.search}:${typeof init.body === 'string' ? init.body : ''}:${context.sheet}`
    const request = pending.get(pendingKey) ?? { operation: crypto.randomUUID(), context }
    pending.set(pendingKey, request)
    headers.set('X-Retire-Sheet', request.context.sheet)
    headers.set('X-Retire-Revision', request.context.revision)
    headers.set('X-Retire-Operation', request.operation)
  }
  const response = await fetch(url, { ...init, headers, credentials: 'same-origin' })
  if (pendingKey && response.status >= 400 && response.status < 500) pending.delete(pendingKey)
  if (response.ok) {
    if (pendingKey) pending.delete(pendingKey)
    const sheet = response.headers.get('X-Retire-Sheet')
    const revision = response.headers.get('X-Retire-Revision')
    if (sheet && revision) {
      sharedContext = { sheet, revision }; contexts.set(group, sharedContext)
    } else if (url.pathname === '/api/shared-data/dashboard' || url.pathname === '/api/shared-data') {
      const data = await response.clone().json()
      if (data.spreadsheet_id && data.revision) { sharedContext = { sheet: data.spreadsheet_id, revision: data.revision }; contexts.set('family', sharedContext) }
    }
    if (response.headers.get('X-Retire-Changed') === '1') window.dispatchEvent(new Event('retire:holdings-changed'))
  }
  if (mode === 'web' && response.status === 401) {
    csrf = ''
    window.dispatchEvent(new Event(expiredEvent))
  }
  return response
}
