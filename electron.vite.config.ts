import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

// Packaged builds load the renderer via file:// where webRequest.onHeadersReceived
// does not apply, so the prod CSP must live in a meta tag. The dev build can't
// carry the same meta tag because Vite's React plugin injects an inline HMR
// preamble that strict 'script-src self' would block; dev relies on the matching
// header injected by src/main/security.ts instead.
const PROD_RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'self'"
].join('; ')

function injectProductionCsp(): Plugin {
  return {
    name: 'inject-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${PROD_RENDERER_CSP}" />`
      return html.replace(
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        `<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    ${meta}`
      )
    }
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react({}), tailwindcss({}), injectProductionCsp()]
  }
})
