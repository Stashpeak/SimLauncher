import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

type ToastType = 'success' | 'warn' | 'error'

interface Toast {
  id: number
  message: string
  type: ToastType
  duration: number
}

interface NotifyContextValue {
  notify: (message: string, type: ToastType, durationMs?: number) => void
}

export const NotifyContext = createContext<NotifyContextValue | null>(null)

const TOAST_PROGRESS_CLASSES: Record<ToastType, string> = {
  success: 'toast-progress-success',
  warn: 'toast-progress-warn',
  error: 'toast-progress-error'
}

let toastId = 0

function getPathName(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath
}

function formatLaunchErrorToast(data: unknown) {
  if (!data || typeof data !== 'object') {
    return 'App launch failed'
  }

  const { app, error } = data as { app?: unknown; error?: unknown }
  const appName = typeof app === 'string' ? getPathName(app) : 'App'
  const errorMessage = typeof error === 'string' && error.trim().length > 0 ? error : 'Unknown launch error'

  return `${appName} failed to launch: ${errorMessage}`
}

function ToastCard({
  toast,
  isDismissing,
  onDismiss
}: {
  toast: Toast
  isDismissing: boolean
  onDismiss: (id: number) => void
}) {
  const progressRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration)
    return () => window.clearTimeout(timer)
  }, [onDismiss, toast.duration, toast.id])

  useEffect(() => {
    const progressElement = progressRef.current

    if (!progressElement) {
      return undefined
    }

    const animation = progressElement.animate([{ width: '100%' }, { width: '0%' }], {
      duration: toast.duration,
      easing: 'linear',
      fill: 'forwards'
    })

    return () => animation.cancel()
  }, [toast.duration, toast.id])

  return (
    <button
      type="button"
      className={`toast-card glass-surface-elevated overflow-hidden relative rounded-[16px] text-left px-[18px] py-[16px] min-w-[260px] max-w-[380px] text-(--text-primary) shadow-[0_4px_18px_#00000060] transition-all duration-250 ease-out ${isDismissing ? 'toast-card-dismissing opacity-0 translate-x-5 scale-95' : 'opacity-100 translate-x-0 scale-100'}`}
      onClick={() => onDismiss(toast.id)}
    >
      {toast.message}
      <span
        ref={progressRef}
        aria-hidden="true"
        className={`toast-progress absolute bottom-0 left-0 h-1 w-full ${TOAST_PROGRESS_CLASSES[toast.type]}`}
      />
    </button>
  )
}

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dismissingToastIds, setDismissingToastIds] = useState<Set<number>>(() => new Set())
  const dismissTimersRef = useRef<Map<number, number>>(new Map())

  const removeToast = useCallback((id: number) => {
    const dismissTimer = dismissTimersRef.current.get(id)

    if (dismissTimer) {
      window.clearTimeout(dismissTimer)
      dismissTimersRef.current.delete(id)
    }

    setToasts((current) => current.filter((toast) => toast.id !== id))
    setDismissingToastIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }, [])

  const dismissToast = useCallback((id: number) => {
    if (dismissTimersRef.current.has(id)) {
      return
    }

    setDismissingToastIds((current) => new Set(current).add(id))
    const timer = window.setTimeout(() => {
      dismissTimersRef.current.delete(id)
      removeToast(id)
    }, 250)

    dismissTimersRef.current.set(id, timer)
  }, [removeToast])

  useEffect(() => {
    return () => {
      dismissTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      dismissTimersRef.current.clear()
    }
  }, [])

  const notify = useCallback<NotifyContextValue['notify']>((message, type, durationMs = 3000) => {
    const toast: Toast = {
      id: ++toastId,
      message,
      type,
      duration: durationMs
    }

    setToasts((current) => [...current, toast])
  }, [])

  useEffect(() => {
    return window.electronAPI.onAppLaunchError((data) => {
      notify(formatLaunchErrorToast(data), 'error', 5000)
    })
  }, [notify])

  const value = useMemo(() => ({ notify }), [notify])

  return (
    <NotifyContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="fixed right-[25px] bottom-[25px] flex flex-col gap-3 z-9999">
          {toasts.map((toast) => (
            <ToastCard
              key={toast.id}
              toast={toast}
              isDismissing={dismissingToastIds.has(toast.id)}
              onDismiss={dismissToast}
            />
          ))}
        </div>,
        document.body
      )}
    </NotifyContext.Provider>
  )
}

export function useNotify() {
  const context = useContext(NotifyContext)

  if (!context) {
    throw new Error('useNotify must be used within NotifyProvider')
  }

  return context
}
