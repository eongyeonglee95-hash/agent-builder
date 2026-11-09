import { randomBytes, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CodexRunner } from './runner.mjs'

export async function createCodexHandler({ root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), runner = new CodexRunner({ root }) } = {}) {
  await runner.init()
  const token = randomBytes(32).toString('hex')
  const reply = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(JSON.stringify(data)); return true
  }
  const handler = async (req, res) => {
    const host = req.headers.host ?? ''
    const origin = `http://${host}`
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || (req.headers.origin && req.headers.origin !== origin)
      || req.headers['sec-fetch-site'] === 'cross-site') return reply(res, 403, { error: '이 컴퓨터의 쉬림프 화면에서 요청해 주세요.' })
    const url = new URL(req.url, origin)
    if (!url.pathname.startsWith('/api/codex/')) {
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (req.headers.origin !== origin) return reply(res, 403, { error: '같은 화면에서 요청해 주세요.' })
        if (runner.busy) return reply(res, 409, { error: 'Codex 실행 중에는 작업 편집을 잠시 멈춥니다.' })
      }
      return false
    }
    try {
      if (req.method === 'GET' && url.pathname === '/api/codex/status') return reply(res, 200, { ...await runner.snapshot(), token })
      if (req.method !== 'POST') return reply(res, 405, { error: '지원하지 않는 요청입니다.' })
      const supplied = Buffer.from(req.headers['x-shrimp-codex-token'] ?? '')
      if (req.headers.origin !== origin || supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) return reply(res, 403, { error: '화면을 새로고침한 뒤 다시 시도해 주세요.' })
      if (!req.headers['content-type']?.startsWith('application/json')) return reply(res, 415, { error: 'JSON 요청이 필요합니다.' })
      let body = ''
      for await (const chunk of req) { body += chunk; if (body.length > 16384) return reply(res, 413, { error: '요청이 너무 큽니다.' }) }
      let input
      try { input = JSON.parse(body) } catch { return reply(res, 400, { error: '잘못된 JSON입니다.' }) }
      if (input.projectId !== 'retire-together') return reply(res, 400, { error: '둘이서은퇴 프로젝트에서만 사용할 수 있습니다.' })
      let result
      if (url.pathname === '/api/codex/assign') result = await runner.assign(input.taskIds)
      else if (url.pathname === '/api/codex/run') result = await runner.start(input.taskIds)
      else if (url.pathname === '/api/codex/check') result = await runner.start([], true)
      else if (url.pathname === '/api/codex/stop') result = await runner.cancel()
      else if (url.pathname === '/api/codex/acknowledge') result = await runner.acknowledge(input.jobId)
      else return reply(res, 404, { error: '없는 기능입니다.' })
      return reply(res, 200, result)
    } catch (error) { return reply(res, 409, { error: error.message }) }
  }
  handler.runner = runner
  return handler
}
