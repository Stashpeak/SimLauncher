import type { ReactNode } from 'react'

interface StickySaveBarProps {
  isDirty: boolean
  onSave: () => void
  saveLabel?: string
  secondaryLabel?: string
  onSecondary?: () => void
  ariaLabel?: string
  extra?: ReactNode
}

/**
 * A reusable sticky action bar that pins itself to the bottom of its scroll
 * container while there are unsaved changes. The bar slides in only when
 * `isDirty` is true so it never obscures the layout when nothing needs saving.
 *
 * The component must be rendered inside a positioned (relative/absolute)
 * ancestor for `position: sticky` to anchor to the visible viewport bottom
 * of that scroll container.
 */
export function StickySaveBar({
  isDirty,
  onSave,
  saveLabel = 'Save Changes',
  secondaryLabel,
  onSecondary,
  ariaLabel,
  extra
}: StickySaveBarProps): ReactNode {
  if (!isDirty) {
    return null
  }

  return (
    <div
      className="sticky bottom-0 z-30 -mx-1 mt-4 animate-fade-slide px-1 pb-2 pt-3"
      role="region"
      aria-label={ariaLabel ?? 'Unsaved changes'}
    >
      <div className="glass-surface-elevated flex items-center gap-3 rounded-2xl border border-(--glass-border) p-3 shadow-[0_12px_30px_#00000040] backdrop-blur-xl">
        <span className="flex h-2 w-2 shrink-0 items-center justify-center">
          <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-(--accent) opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-(--accent)" />
        </span>
        <span className="min-w-0 flex-1 text-xs font-medium text-(--text-secondary)">
          You have unsaved changes.
        </span>
        {extra}
        {secondaryLabel && onSecondary && (
          <button
            type="button"
            onClick={onSecondary}
            className="neutral-action action-hover-scale cursor-pointer rounded-xl px-4 py-2 text-xs font-semibold"
          >
            {secondaryLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          className="accent-surface-action action-hover-scale cursor-pointer rounded-xl px-4 py-2 text-xs font-bold"
        >
          {saveLabel}
        </button>
      </div>
    </div>
  )
}
