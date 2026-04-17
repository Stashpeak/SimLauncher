import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

const TOAST_COLORS: Record<ToastType, string> = {
  success: '#4ade80',
  warn: '#fbbf24',
  error: '#f43f5e'
}

let toastId = 0

function ToastCard({
  toast,
  isDismissing,
  onDismiss
}: {
  toast: Toast
  isDismissing: boolean
  onDismiss: (id: number) => void
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration)
    return () => window.clearTimeout(timer)
  }, [onDismiss, toast.duration, toast.id])

  return (
    <button
      type="button"
      className="glass-surface-elevated rounded-[16px] text-left"
      onClick={() => onDismiss(toast.id)}
      style={{
        minWidth: 260,
        maxWidth: 380,
        padding: '16px 18px',
        color: 'var(--text-primary)',
        boxShadow: '0 4px 18px #00000060',
        animation: 'notifSlideIn 0.25s ease forwards',
        opacity: isDismissing ? 0 : 1,
        overflow: 'hidden',
        position: 'relative',
        transform: isDismissing ? 'translateX(20px) scale(0.95)' : undefined,
        transition: 'opacity 250ms ease, transform 250ms ease'
      }}
    >
      {toast.message}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: 4,
          width: '100%',
          background: TOAST_COLORS[toast.type],
          animation: `notifProgress ${toast.duration}ms linear forwards`
        }}
      />
    </button>
  )
}

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dismissingToastIds, setDismissingToastIds] = useState<Set<number>>(() => new Set())

  const removeToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    setDismissingToastIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }, [])

  const dismissToast = useCallback((id: number) => {
    setDismissingToastIds((current) => new Set(current).add(id))
    window.setTimeout(() => removeToast(id), 250)
  }, [removeToast])

  const notify = useCallback<NotifyContextValue['notify']>((message, type, durationMs = 3000) => {
    const toast: Toast = {
      id: ++toastId,
      message,
      type,
      duration: durationMs
    }

    setToasts((current) => [...current, toast])
  }, [])

  const value = useMemo(() => ({ notify }), [notify])

  return (
    <NotifyContext.Provider value={value}>
      {children}
      {createPortal(
        <>
          <style>
            {`
              @keyframes notifSlideIn {
                0%   { opacity: 0; transform: translateX(30px) scale(0.92); }
                60%  { opacity: 1; transform: translateX(0px) scale(1.03); }
                100% { opacity: 1; transform: translateX(0px) scale(1.00); }
              }

              @keyframes notifProgress {
                from { width: 100%; }
                to   { width: 0%; }
              }
            `}
          </style>
          <div
            style={{
              position: 'fixed',
              right: 25,
              bottom: 25,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              zIndex: 9999
            }}
          >
            {toasts.map((toast) => (
              <ToastCard
                key={toast.id}
                toast={toast}
                isDismissing={dismissingToastIds.has(toast.id)}
                onDismiss={dismissToast}
              />
            ))}
          </div>
        </>,
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
