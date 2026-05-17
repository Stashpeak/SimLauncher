import { app, session } from 'electron'

const DEV_CSP = [
  "default-src 'self'",
  // Vite's React plugin injects an inline HMR preamble in dev that needs
  // 'unsafe-inline'. The packaged build has no inline scripts and keeps a
  // strict script-src via the meta tag injected by electron.vite.config.ts.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "base-uri 'self'"
].join('; ')

// webRequest.onHeadersReceived does not apply to file:// loads, so the
// packaged renderer (loaded via loadFile) cannot receive a response-header
// CSP. The packaged CSP is delivered through a meta tag injected at build
// time (see electron.vite.config.ts). This header injection covers the dev
// renderer served from Vite's HTTP server, where it also provides
// frame-ancestors enforcement that the meta tag cannot.
export function registerContentSecurityPolicy() {
  if (app.isPackaged) {
    return
  }

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame') {
      callback({ responseHeaders: details.responseHeaders })
      return
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [DEV_CSP]
      }
    })
  })
}
