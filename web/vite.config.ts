import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

// Publish only strategy display fields. Account configuration and personal files
// are deliberately outside this read-only, explicit build-time allowlist.
const strategyPath = fileURLToPath(new URL('../rules/strategies.yaml', import.meta.url))
const assetMapPath = fileURLToPath(new URL('../rules/asset_map.yaml', import.meta.url))
export default defineConfig({
  plugins: [react(), {
    name: 'retirement-strategy-display',
    resolveId(id) { if (id === 'virtual:retire-strategies') return '\0retire-strategies' },
    load(id) {
      if (id !== '\0retire-strategies') return
      this.addWatchFile(strategyPath)
      this.addWatchFile(assetMapPath)
      const { strategies } = parse(readFileSync(strategyPath, 'utf8'))
      const { class_defaults: defaults = {} } = parse(readFileSync(assetMapPath, 'utf8'))
      const result = Object.entries(strategies).filter(([key]) => key !== 'custom').map(([id, item]) => {
        const s = item as { name: string; targets: Record<string, number>; labels?: Record<string, string>; instruments?: Record<string, { name: string; ticker: string }>; threshold_pp: number }
        const targets = Object.entries(s.targets)
        if (targets.length && (targets.some(([, value]) => !Number.isFinite(value) || value < 0 || value > 100) || Math.abs(targets.reduce((sum, [, value]) => sum + value, 0) - 100) > .001)) {
          throw new Error(`Invalid strategy display weights: ${id}`)
        }
        return { id, name: s.name, targets: s.targets, labels: s.labels ?? {}, threshold: s.threshold_pp,
          examples: targets.map(([key]) => {
            const instrument = s.instruments?.[key] ?? defaults[key]
            return { assetClass: key, name: instrument?.name ?? null, ticker: instrument?.ticker ?? null }
          }) }
      })
      return `export default ${JSON.stringify(result)}`
    },
  }],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } } /* keep Host = 127.0.0.1:5173 so the API's Origin/Host check passes in dev */ },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
})
