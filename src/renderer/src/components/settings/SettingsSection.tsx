import { useId, type ReactNode } from 'react'
import type { SettingsSectionKey } from './types'

interface SettingsSectionProps {
  title: string
  // Stable key used to deep-link/scroll to this section (data-section anchor).
  sectionKey: SettingsSectionKey
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  dirty?: boolean
}

export function SettingsSection({
  title,
  sectionKey,
  open,
  onOpenChange,
  children,
  dirty
}: SettingsSectionProps): ReactNode {
  const regionId = useId()
  return (
    // scroll-mt-16 leaves room for the absolute header so a scrolled-to section
    // heading isn't tucked behind it (#642 deep-link auto-scroll).
    <section data-section={sectionKey} className="scroll-mt-16 space-y-4">
      {/* Heading WRAPS the button (WAI-ARIA accordion pattern). A button has
          presentational children, so a heading placed *inside* it is stripped
          from the accessibility tree — wrapping keeps the section title in the
          heading outline while the button stays the disclosure control. The h2
          is bare: Tailwind preflight zeroes heading margin/font, so this is
          visually neutral; the visual styling lives on the inner <span>. */}
      <h2>
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className="flex w-full cursor-pointer items-center gap-2 px-1"
          aria-expanded={open}
          aria-controls={regionId}
        >
          <span className="flex flex-1 items-center gap-2 text-left text-sm font-semibold uppercase tracking-wider text-(--accent-text)">
            {title}
            {dirty && (
              <span
                className="status-dot h-1.5 w-1.5 shrink-0 rounded-full bg-(--accent)"
                title="Unsaved changes"
                aria-label="Unsaved changes in this section"
              />
            )}
          </span>
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
      </h2>
      <div
        id={regionId}
        role="region"
        aria-label={title}
        className={`grid transition-all duration-300 ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        {/* inert removes the collapsed content from tab order and assistive tech without unmounting it,
            preserving React state (e.g. unsaved text inputs) across open/close. overflow-hidden is
            only applied when collapsed so animation can clip the expanding content. */}
        <div className={open ? undefined : 'overflow-hidden'} inert={open ? undefined : true}>
          <div className="glass-surface rounded-2xl flex flex-col pt-1 overflow-hidden">
            {children}
          </div>
        </div>
      </div>
    </section>
  )
}
