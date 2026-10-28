import { useCallback, useEffect, useRef, useState } from 'react'
import { classInfo, type Family, type Owner, type Snapshot } from './model'

export const emptySnapshot: Snapshot = { assets: [], debts: [], total: 0, retirement: 0, cash: 0, property: 0, debt: 0, net: 0, financial: 0, classes: [], count: 0, unclassified: 0, as_of: null }
export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, { method, signal, headers: { 'Content-Type': 'application/json', 'X-Retire-Local': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch (e) { if (signal?.aborted) throw e; throw new Error('저장 서버에 연결할 수 없습니다. 서버 실행 상태를 확인한 뒤 다시 시도해 주세요.') }
  if (!response.ok) {
    let detail: unknown
    try { detail = (await response.json()).detail } catch { /* A proxy can return a non-JSON error. */ }
    throw new Error(typeof detail === 'string' ? detail : response.status === 422 ? '입력한 나이·금액·기준일과 필수 항목을 다시 확인해 주세요.' : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  return response.status === 204 ? undefined as T : response.json()
}
export function useLocalData(owner: Owner) {
  const [family, setFamily] = useState<Family | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const loadedOwner = useRef(owner)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(v => v + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    if (loadedOwner.current !== owner) setSnapshot(emptySnapshot)
    loadedOwner.current = owner
    const timeout = setTimeout(() => controller.abort(new Error('요청 시간이 초과되었습니다. 다시 시도해 주세요.')), 8000)
    Promise.all([api<Family | null>('/family', 'GET', undefined, controller.signal), api<Snapshot>(`/dashboard?owner=${owner}`, 'GET', undefined, controller.signal)])
      .then(([nextFamily, data]) => {
        if (controller.signal.aborted) return
        setFamily(nextFamily)
        const classes = Object.entries(classInfo).filter(([key]) => key !== 'debt').map(([key, info]) => ({ key, ...info, amount: data.assets.filter(a => a.assetClass === key).reduce((n, a) => n + a.amount, 0) })).filter(a => a.amount > 0)
        setSnapshot({ ...data, classes })
      })
      .catch(e => { if (!controller.signal.aborted || controller.signal.reason instanceof Error) setError(e instanceof Error ? e.message : '자료를 불러오지 못했습니다.') })
      .finally(() => { clearTimeout(timeout); if (!controller.signal.aborted || controller.signal.reason instanceof Error) setLoading(false) })
    return () => { clearTimeout(timeout); controller.abort('navigation') }
  }, [owner, revision])
  return { family, snapshot, loading, error, refresh }
}
