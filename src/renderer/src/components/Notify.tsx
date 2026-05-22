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
import { getPathDisplayName } from '../../../shared/path'
import { isRecord } from '../lib/config'
import { onAppLaunchError, onProcessNameMismatchWarning } from '../lib/electron'
import { CheckIcon, WarningTriangleIcon, ErrorIcon } from './icons'

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

function formatLaunchErrorToast(data: unknown) {
  if (!isRecord(data)) {
    return 'App launch failed'
  }

  const { app, error } = data
  const appName = typeof app === 'string' ? getPathDisplayName(app) : 'App'
  const errorMessage =
    typeof error === 'string' && error.trim().length > 0 ? error : 'Unknown launch error'

  return `${appName} failed to launch: ${errorMessage}`
}

function formatProcessNameMismatchToast(data: unknown) {
  if (!isRecord(data)) {
    return 'A launched app may be running under a different process name.'
  }

  const { warning } = data
  return typeof warning === 'string' && warning.trim().length > 0
    ? warning
    : 'A launched app may be running under a different process name.'
}

const TOAST_ICONS: Record<ToastType, ReactNode> = {
  success: <CheckIcon width={18} height={18} />,
  warn: <WarningTriangleIcon width={18} height={18} />,
  error: <ErrorIcon width={18} height={18} />
}

const TOAST_STYLES: Record<ToastType, string> = {
  success:
    'border-(--success-border) text-(--success-text) [--glass-surface-fill:color-mix(in_srgb,var(--success-surface),var(--glass-bg-elevated))]',
  warn: 'border-(--warning-border) text-(--warning-text) [--glass-surface-fill:color-mix(in_srgb,var(--warning-surface),var(--glass-bg-elevated))]',
  error:
    'border-(--danger-border) text-(--danger-text) [--glass-surface-fill:color-mix(in_srgb,var(--danger-surface),var(--glass-bg-elevated))]'
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
      className={`toast-card glass-surface overflow-hidden relative rounded-[18px] text-left px-[16px] py-[14px] min-w-[280px] max-w-[400px] shadow-[0_8px_30px_#00000050] transition-all duration-250 ease-out ${TOAST_STYLES[toast.type]} ${isDismissing ? 'toast-card-dismissing opacity-0 translate-x-5 scale-95' : 'opacity-100 translate-x-0 scale-100'}`}
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
    const dismissTimers = dismissTimersRef.current

    return () => {
      dismissTimers.forEach((timer) => window.clearTimeout(timer))
      dismissTimers.clear()
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
    return onAppLaunchError((data: unknown) => {
      notify(formatLaunchErrorToast(data), 'error', 5000)
    })
  }, [notify])

  useEffect(() => {
    return onProcessNameMismatchWarning((data: unknown) => {
      notify(formatProcessNameMismatchToast(data), 'warn', 5000)
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
