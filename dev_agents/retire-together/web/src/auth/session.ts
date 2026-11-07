// The CSRF token lives only in memory. Authentication stays in an HttpOnly cookie.
let mode: 'local' | 'web' = 'local'
let csrf = ''
export const expiredEvent = 'retire:session-expired'

export function setAuthSession(nextMode: 'local' | 'web', token = '') {
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
  const response = await fetch(url, { ...init, headers, credentials: 'same-origin' })
  if (mode === 'web' && response.status === 401) {
    csrf = ''
    window.dispatchEvent(new Event(expiredEvent))
  }
  return response
}
