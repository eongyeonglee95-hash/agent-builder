// Credentials stay in this call's memory; never put them in storage, URLs or logs.
export type PickerCredentials = { access_token: string; developer_key: string; app_id: string; origin: string; spreadsheet_id?: string }
type PickerResult = { action: string; docs?: { id: string }[] }
type Picker = { setVisible: (visible: boolean) => void; dispose: () => void }
type Builder = {
  setOAuthToken: (v: string) => Builder; setDeveloperKey: (v: string) => Builder
  setAppId: (v: string) => Builder; setOrigin: (v: string) => Builder
  setLocale: (v: string) => Builder; setTitle: (v: string) => Builder
  setSize: (w: number, h: number) => Builder; addView: (v: unknown) => Builder
  setCallback: (v: (data: PickerResult) => void) => Builder; build: () => Picker
}
declare global {
  interface Window {
    gapi?: { load: (name: string, options: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }) => void }
    google?: { picker: { PickerBuilder: new () => Builder; DocsView: new (id: string) => unknown; ViewId: { SPREADSHEETS: string } } }
  }
}
let loader: Promise<void> | undefined
function loadPicker() {
  if (window.google?.picker) return Promise.resolve()
  if (loader) return loader
  loader = new Promise<void>((resolve, reject) => {
    let script: HTMLScriptElement | undefined
    const timer = setTimeout(failed, 12000)
    function failed() { clearTimeout(timer); script?.remove(); reject(new Error('Google 파일 선택창을 열지 못했어요. 연결을 확인하고 다시 시도해 주세요.')) }
    function loaded() {
      if (!window.gapi) { failed(); return }
      window.gapi.load('picker', { callback: () => { clearTimeout(timer); resolve() }, onerror: failed, timeout: 10000, ontimeout: failed })
    }
    if (window.gapi) loaded()
    else { script = document.createElement('script'); script.src = 'https://apis.google.com/js/api.js'; script.async = true; script.onload = loaded; script.onerror = failed; document.head.append(script) }
  }).catch(error => { loader = undefined; throw error })
  return loader
}

export async function chooseSheet(credentials: PickerCredentials): Promise<string | null> {
  if (credentials.origin !== location.origin || !/^\d+$/.test(credentials.app_id) || !credentials.developer_key || !credentials.access_token) throw new Error('파일 선택 설정을 확인해 주세요. 운영자가 같은 Google 프로젝트의 Picker 설정을 준비해야 합니다.')
  await loadPicker()
  const google = window.google!.picker
  const focus = document.activeElement as HTMLElement | null
  // A native app dialog otherwise makes Google's sibling iframe inert.
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
  if (dialog) { dialog.close(); dialog.setAttribute('open', '') }
  try {
    return await new Promise<string | null>((resolve, reject) => {
      let picker: Picker | undefined
      const finish = (id: string | null, error?: Error) => {
        clearTimeout(timer); window.removeEventListener('pagehide', abandoned)
        picker?.dispose()
        if (error) reject(error); else resolve(id)
      }
      const abandoned = () => finish(null)
      const timer = setTimeout(() => finish(null, new Error('파일 선택 시간이 지났어요. 다시 열어 주세요.')), 300000)
      window.addEventListener('pagehide', abandoned, { once: true })
      try {
        picker = new google.PickerBuilder().setOAuthToken(credentials.access_token)
          .setDeveloperKey(credentials.developer_key).setAppId(credentials.app_id)
          .setOrigin(credentials.origin).setLocale('ko').setTitle('우리 집 공통 시트 선택')
          .setSize(Math.min(900, innerWidth - 16), Math.min(650, innerHeight - 32))
          .addView(new google.DocsView(google.ViewId.SPREADSHEETS))
          .setCallback(data => {
            if (data.action === 'cancel') finish(null)
            else if (data.action === 'picked') {
              const id = data.docs?.[0]?.id
              if (!id || !/^[\w-]{20,200}$/.test(id)) finish(null, new Error('선택한 시트를 확인하지 못했어요. 다시 선택해 주세요.'))
              else if (credentials.spreadsheet_id && id !== credentials.spreadsheet_id) finish(null, new Error('이미 연결된 우리 집 공통 시트를 선택해 주세요. 다른 파일로 바꾸지 않았어요.'))
              else finish(id)
            } else if (data.action === 'error') finish(null, new Error('파일 선택에 실패했어요. 다시 시도해 주세요.'))
          }).build()
        picker.setVisible(true)
      } catch { finish(null, new Error('파일 선택창을 열지 못했어요. 다시 시도해 주세요.')) }
    })
  } finally {
    if (dialog?.isConnected) { dialog.removeAttribute('open'); dialog.showModal() }
    focus?.focus()
  }
}
