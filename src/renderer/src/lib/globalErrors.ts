// The React ErrorBoundary only catches errors thrown during React
// render/lifecycle. Async rejections, event-handler throws, and anything thrown
// outside the render tree escape it — in a production build (DevTools closed)
// that leaves an uncaught error in a window the user can't see, with no Reload
// affordance. These handlers log every such error (so none is silently lost)
// and bridge a user-facing message to the toast system once it has mounted.

type GlobalErrorListener = (message: string) => void

const GENERIC_MESSAGE = 'Something went wrong. If the app misbehaves, reload it.'

let listener: GlobalErrorListener | null = null
const buffered: string[] = []

function emit(message: string): void {
  if (listener) {
    listener(message)
  } else {
    // Buffer until the toast system subscribes so an early-boot error survives.
    buffered.push(message)
  }
}

/**
 * Subscribe the toast system to global (non-React) errors, flushing anything
 * buffered before the listener was ready. Returns an unsubscribe.
 */
export function subscribeGlobalErrors(fn: GlobalErrorListener): () => void {
  listener = fn
  if (buffered.length > 0) {
    buffered.splice(0).forEach((message) => fn(message))
  }
  return () => {
    if (listener === fn) {
      listener = null
    }
  }
}

/**
 * Install window-level `error` and `unhandledrejection` handlers. Idempotent in
 * practice (called once from the renderer entry point).
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    console.error('Uncaught error', event.error ?? event.message)
    emit(GENERIC_MESSAGE)
  })
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection', event.reason)
    emit(GENERIC_MESSAGE)
  })
}
