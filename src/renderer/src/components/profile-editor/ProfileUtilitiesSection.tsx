import type { DragEvent, ReactNode } from 'react'
import type { ProfileUtility, Utility } from '../../lib/config'
import { Toggle } from '../Toggle'
import { Tooltip } from '../Tooltip'

interface ProfileUtilitiesSectionProps {
  appPaths: Record<string, string>
  appNames: Record<string, string>
  appIconCache: Record<string, string>
  failedIcons: Record<string, boolean>
  fetchingIcons: boolean
  dragUtilityId: string | null
  dropTarget: { id: string; placement: 'before' | 'after' } | null
  utilityByKey: Map<string, Utility>
  availableUtilities: Utility[]
  enabledUtilityEntries: ProfileUtility[]
  disabledUtilityEntries: ProfileUtility[]
  onToggleUtility: (key: string) => void
  onMoveEnabledUtility: (draggedId: string, targetId: string, placement: 'before' | 'after') => void
  onStartUtilityDrag: (event: DragEvent<HTMLDivElement>, utilityKey: string) => void
  onDropTargetChange: (dropTarget: { id: string; placement: 'before' | 'after' } | null) => void
  onDragUtilityIdChange: (utilityId: string | null) => void
  onIconFailed: (utilityKey: string) => void
}

export function ProfileUtilitiesSection(props: ProfileUtilitiesSectionProps): ReactNode {
  const { availableUtilities, enabledUtilityEntries, disabledUtilityEntries } = props

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-(--text-muted)">
        Utilities to launch
      </p>

      {availableUtilities.length > 0 ? (
        <div className="space-y-3">
          {enabledUtilityEntries.length > 0 && (
            <div className="grid grid-cols-1 gap-2.5">
              {enabledUtilityEntries.map((entry, index) =>
                renderUtilityRow(props, entry, true, index)
              )}
            </div>
          )}
          {disabledUtilityEntries.length > 0 && (
            <div className="grid grid-cols-1 gap-2.5 border-t border-(--glass-border) pt-3 sm:grid-cols-2">
              {disabledUtilityEntries.map((entry) => renderUtilityRow(props, entry, false))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-(--glass-border) bg-(--glass-bg)">
          <p className="text-sm text-(--text-muted)">No utilities configured in Settings</p>
        </div>
      )}
    </div>
  )
}

// Extracted as a plain function (not a component) to avoid React treating each
// drag-and-drop row re-render as a remount, which would cancel any in-progress
// drag. The props object is passed explicitly so there's no closure staleness.
function renderUtilityRow(
  props: ProfileUtilitiesSectionProps,
  entry: ProfileUtility,
  isEnabled: boolean,
  orderIndex?: number
) {
  const utility = props.utilityByKey.get(entry.id)

  if (!utility) return null

  const label = props.appNames[utility.key] || utility.name
  const iconPath = props.appPaths[utility.key]?.toLowerCase()
  const icon = iconPath ? props.appIconCache[iconPath] : null
  const dropPlacement = props.dropTarget?.id === utility.key ? props.dropTarget.placement : null

  return (
    <div
      key={utility.key}
      draggable={isEnabled}
      onDragStart={(event) => props.onStartUtilityDrag(event, utility.key)}
      onDragOver={(event) => {
        if (isEnabled && props.dragUtilityId && props.dragUtilityId !== utility.key) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          const bounds = event.currentTarget.getBoundingClientRect()
          const placement = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
          props.onDropTargetChange({ id: utility.key, placement })
        }
      }}
      onDragLeave={(event) => {
        // Only clear when the pointer actually leaves this row's subtree.
        // Without the contains() check, dragging over a child element (e.g.
        // the icon) fires dragLeave on the row and flickers the drop indicator.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          props.onDropTargetChange(props.dropTarget?.id === utility.key ? null : props.dropTarget)
        }
      }}
      onDrop={(event) => {
        event.preventDefault()
        if (props.dragUtilityId && dropPlacement) {
          props.onMoveEnabledUtility(props.dragUtilityId, utility.key, dropPlacement)
          props.onDragUtilityIdChange(null)
          props.onDropTargetChange(null)
        }
      }}
      onDragEnd={() => {
        props.onDragUtilityIdChange(null)
        props.onDropTargetChange(null)
      }}
      className={`accent-subtle-hover group relative flex items-center justify-between rounded-xl bg-(--glass-bg) p-3 ${isEnabled ? 'cursor-grab active:cursor-grabbing' : 'opacity-55'} ${props.dragUtilityId === utility.key ? 'ring-1 ring-(--accent)/35 shadow-[0_0_18px_-14px_var(--accent)]' : ''}`}
    >
      {dropPlacement && (
        <span
          className={`pointer-events-none absolute left-3 right-3 h-0.5 rounded-full bg-(--accent) shadow-[0_0_10px_var(--accent-glow)] ${dropPlacement === 'before' ? '-top-1.5' : '-bottom-1.5'}`}
        />
      )}
      <div className="flex min-w-0 items-center gap-3">
        {isEnabled && typeof orderIndex === 'number' && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-(--accent)/15 text-[11px] font-black tabular-nums text-(--accent)">
            {orderIndex + 1}
          </span>
        )}
        <Tooltip label="Drag to reorder">
          <div
            className={`icon-action flex h-6 w-5 shrink-0 items-center justify-center rounded ${isEnabled ? 'cursor-grab group-active:cursor-grabbing' : ''}`}
            aria-hidden="true"
          >
            <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
              <circle cx="3" cy="3" r="1.2" />
              <circle cx="9" cy="3" r="1.2" />
              <circle cx="3" cy="8" r="1.2" />
              <circle cx="9" cy="8" r="1.2" />
              <circle cx="3" cy="13" r="1.2" />
              <circle cx="9" cy="13" r="1.2" />
            </svg>
          </div>
        </Tooltip>
        <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
          {icon && !props.failedIcons[utility.key] ? (
            <img
              src={icon}
              alt=""
              className="h-full w-full object-contain animate-fade-slide"
              onError={() => props.onIconFailed(utility.key)}
            />
          ) : props.fetchingIcons && !props.failedIcons[utility.key] ? (
            <div className="h-full w-full skeleton-icon animate-pulse" />
          ) : (
            <div className="fallback-initial-icon flex h-full w-full items-center justify-center rounded text-[8px] font-black uppercase transition-colors">
              {label.slice(0, 2)}
            </div>
          )}
        </div>
        <span className="min-w-0 line-clamp-1 text-sm font-medium opacity-80">{label}</span>
      </div>
      <span data-no-row-drag="true">
        <Toggle
          checked={isEnabled}
          onChange={() => props.onToggleUtility(utility.key)}
          aria-label={label}
        />
      </span>
    </div>
  )
}
