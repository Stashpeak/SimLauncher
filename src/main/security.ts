import { app, session } from 'electron'

const COMMON_CSP_DIRECTIVES = [
  "default-src 'self'",
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
]

function buildContentSecurityPolicy() {
  // Vite's React plugin injects an inline HMR preamble script in development
  // that requires 'unsafe-inline' to execute. Production builds are bundled
  // and load only external scripts from 'self', so the packaged app keeps a
  // strict script-src.
  const scriptSrc = app.isPackaged ? "script-src 'self'" : "script-src 'self' 'unsafe-inline'"

  return [...COMMON_CSP_DIRECTIVES, scriptSrc].join('; ')
}

// Injects CSP as an HTTP response header on the main document. frame-ancestors
// is only enforced when delivered via header (the spec ignores it inside a
// <meta http-equiv> tag), so the header is the canonical place for the full
// policy.
export function registerContentSecurityPolicy() {
  const policy = buildContentSecurityPolicy()

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame') {
      callback({ responseHeaders: details.responseHeaders })
      return
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
}
