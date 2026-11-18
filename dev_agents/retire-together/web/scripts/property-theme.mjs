import { readFile, writeFile } from 'node:fs/promises'

// Standalone preview uses the same token source as the app, never a second palette.
const theme = await readFile(new URL('../src/theme.css', import.meta.url), 'utf8')
const root = theme.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1]
const type = theme.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1]
if (!root || !type) throw new Error('theme.css token blocks not found')
const textTokens = [...type.matchAll(/--text-[\w-]+\s*:[^;]+;/g)].map(m => m[0]).join('\n')
await writeFile(new URL('../public/previews/property-observatory/theme-tokens.css', import.meta.url),
  `/* Generated from src/theme.css by scripts/property-theme.mjs. */\n:root {${root}\n${textTokens}\n}\n`)
