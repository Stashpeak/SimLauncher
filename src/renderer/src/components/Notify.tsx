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
import { onAppLaunchError } from '../lib/electron'

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
  const errorMessage =
    typeof error === 'string' && error.trim().length > 0 ? error : 'Unknown launch error'

  return `${appName} failed to launch: ${errorMessage}`
}

const TOAST_ICONS: Record<ToastType, ReactNode> = {
  success: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  warn: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  error: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

const TOAST_STYLES: Record<ToastType, string> = {
  success:
    'border-(--success-border) text-(--success-text) [--glass-surface-fill:var(--success-surface)]',
  warn: 'border-(--warning-border) text-(--warning-text) [--glass-surface-fill:var(--warning-surface)]',
  error:
    'border-(--danger-border) text-(--danger-text) [--glass-surface-fill:var(--danger-surface)]'
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
      className={`toast-card glass-surface overflow-hidden relative rounded-[18px] text-left border px-[16px] py-[14px] min-w-[280px] max-w-[400px] shadow-[0_8px_30px_#00000050] transition-all duration-250 ease-out ${TOAST_STYLES[toast.type]} ${isDismissing ? 'toast-card-dismissing opacity-0 translate-x-5 scale-95' : 'opacity-100 translate-x-0 scale-100'}`}
      onClick={() => onDismiss(toast.id)}
    >
      <div className="flex items-start gap-3.5">
        <span className="shrink-0 mt-0.5 opacity-90">{TOAST_ICONS[toast.type]}</span>
        <span className="flex-1 text-[13px] font-medium leading-tight">{toast.message}</span>
      </div>
      <span
        ref={progressRef}
        aria-hidden="true"
        className={`toast-progress absolute bottom-0 left-0 h-[3px] w-full opacity-30 ${TOAST_PROGRESS_CLASSES[toast.type]}`}
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

  const dismissToast = useCallback(
    (id: number) => {
      if (dismissTimersRef.current.has(id)) {
        return
      }

      setDismissingToastIds((current) => new Set(current).add(id))
      const timer = window.setTimeout(() => {
        dismissTimersRef.current.delete(id)
        removeToast(id)
      }, 250)

      dismissTimersRef.current.set(id, timer)
    },
    [removeToast]
  )

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
    return onAppLaunchError((data) => {
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
