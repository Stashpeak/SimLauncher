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
      className={`glass-surface-elevated overflow-hidden relative rounded-[16px] text-left px-[18px] py-[16px] min-w-[260px] max-w-[380px] text-(--text-primary) shadow-[0_4px_18px_#00000060] transition-all duration-250 ease-out ${isDismissing ? 'opacity-0 translate-x-5 scale-95' : 'opacity-100 translate-x-0 scale-100'}`}
      onClick={() => onDismiss(toast.id)}
      style={{
        animation: isDismissing ? 'none' : 'notifSlideIn 0.25s ease forwards'
      }}
    >
      {toast.message}
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 h-1 w-full"
        style={{
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
        <div className="fixed right-[25px] bottom-[25px] flex flex-col gap-3 z-[9999]">
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
