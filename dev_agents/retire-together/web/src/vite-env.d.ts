/// <reference types="vite/client" />
declare module 'virtual:retire-strategies' {
  const strategies: import('./model').Strategy[]
  export default strategies
}
