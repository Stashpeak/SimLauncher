import type { ReactNode } from 'react'

interface SettingsSectionProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

export function SettingsSection({
  title,
  open,
  onOpenChange,
  children
}: SettingsSectionProps): ReactNode {
  return (
    <section className="space-y-4">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full cursor-pointer items-center gap-2 px-1"
        aria-expanded={open}
      >
        <h3 className="flex-1 text-left text-sm font-semibold uppercase tracking-wider text-(--accent)">
          {title}
        </h3>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-(--text-subtle) transition-transform duration-300 ${open ? 'rotate-0' : '-rotate-90'}`}
          aria-hidden="true"
        >
          <path d="M3 6l5 5 5-5" />
        </svg>
      </button>
      <div
        className={`grid transition-all duration-300 ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className={open ? undefined : 'overflow-hidden'} inert={open ? undefined : true}>
          <div className="glass-surface rounded-2xl flex flex-col pt-1 overflow-hidden">
            {children}
          </div>
        </div>
      </div>
    </section>
  )
}
