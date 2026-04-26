import { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="relative flex flex-col items-center justify-center py-20 px-8 text-center animate-fade-slide">
      {/* Decorative background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-(--accent-glow) rounded-full blur-[100px] pointer-events-none opacity-20" />

      <div className="relative glass-surface-elevated max-w-md w-full rounded-3xl p-10 flex flex-col items-center gap-6 shadow-2xl">
        {/* Icon Container */}
        <div className="relative">
          <div className="absolute inset-0 bg-(--accent) opacity-20 rounded-full blur-2xl animate-pulse" />
          <div className="relative h-20 w-20 flex items-center justify-center bg-(--glass-bg-elevated) border border-(--glass-border) rounded-2xl text-(--accent) shadow-inner">
            {icon}
          </div>
        </div>

        {/* Text Content */}
        <div className="space-y-3">
          <h2 className="text-2xl font-black italic tracking-tighter uppercase leading-tight">
            {title}
          </h2>
          <p className="text-sm text-(--text-secondary) leading-relaxed">{description}</p>
        </div>
        {/* Action Button */}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="accent-surface-action action-hover-scale w-full cursor-pointer py-3 text-sm font-semibold rounded-xl flex items-center justify-center gap-2 mt-2"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}
