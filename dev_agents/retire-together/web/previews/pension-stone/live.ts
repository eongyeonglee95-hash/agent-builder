// Reuse the complete authenticated app: registration, editing, calculation and
// age navigation keep their existing components, callbacks and server contracts.
if (!location.hash) history.replaceState(null, '', `${location.pathname}${location.search}#pension`)
await import('../../src/main')
await import('./live.css')
