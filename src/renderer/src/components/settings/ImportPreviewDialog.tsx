import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../../hooks/useFocusTrap'

/**
 * Summary produced by the main process during the import-preview step.
 * Only entries that contain executable paths or command-line arguments are
 * surfaced here — the user must explicitly trust these before the import is
 * applied, because they could point to arbitrary binaries.
 */
export interface ConfigImportPreviewSummary {
  changedKeys: string[]
  gamePaths: Array<{ key: string; path?: string; args?: string }>
  appPaths: Array<{ key: string; path?: string; args?: string }>
  trackedProcessPaths: Array<{ key: string; path?: string; args?: string }>
  customAppArgs: Array<{ key: string; path?: string; args?: string }>
  droppedCount: number
  warnings: string[]
}

interface ImportPreviewDialogProps {
  isOpen: boolean
  filePath?: string
  summary?: ConfigImportPreviewSummary
  onImport: () => void
  onCancel: () => void
}

function PreviewSection({
  title,
  items,
  valueKey
}: {
  title: string
  items: Array<{ key: string; path?: string; args?: string }>
  valueKey: 'path' | 'args'
}): ReactNode {
  if (items.length === 0) return null

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-(--text-muted)">{title}</h3>
      <ul className="max-h-28 space-y-1 overflow-auto rounded-xl bg-black/20 p-3 text-xs">
        {items.map((item, index) => (
          <li key={`${title}-${item.key}-${index}`} className="grid gap-1">
            <span className="font-semibold text-(--text-secondary)">{item.key}</span>
            <code className="break-all rounded-lg bg-black/20 px-2 py-1 text-(--text-primary)">
              {item[valueKey]}
            </code>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ImportPreviewDialog({
  isOpen,
  filePath,
  summary,
  onImport,
  onCancel
}: ImportPreviewDialogProps): ReactNode {
  const titleId = useId()
  const descId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  // The trap is conditional on `summary` being present because the dialog may
  // briefly be `isOpen: true` while the summary is still loading — activating
  // the trap on an empty container would immediately focus the wrong element.
  useFocusTrap(isOpen && !!summary, dialogRef, undefined, onCancel)

  if (!isOpen || !summary) return null

  const previewCount =
    summary.gamePaths.length +
    summary.appPaths.length +
    summary.trackedProcessPaths.length +
    summary.customAppArgs.length

  return createPortal(
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4 backdrop-blur-md">
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={onCancel} />

      {/* Focus is trapped and the background is inerted via useFocusTrap, so aria-modal is honest here. */}
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="glass-surface-elevated animate-fade-slide relative w-full max-w-2xl rounded-[24px] p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] isolation-auto"
      >
        <h2 id={titleId} className="mb-2 text-lg font-bold text-(--text-primary)">
          Trust Imported Config
        </h2>
        <p id={descId} className="mb-4 text-sm leading-relaxed text-(--text-secondary)">
          Review executable paths and custom arguments before replacing your current settings.
        </p>

        {filePath ? <p className="mb-4 break-all text-xs text-(--text-muted)">{filePath}</p> : null}

        <div className="mb-4 grid gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-(--text-secondary)">
          <span>{summary.changedKeys.length} settings keys will be imported.</span>
          <span>{previewCount} executable path or custom argument entries require trust.</span>
          {summary.droppedCount > 0 ? (
            <span>{summary.droppedCount} invalid entries were dropped.</span>
          ) : null}
        </div>

        <div className="mb-6 grid max-h-[50vh] gap-4 overflow-auto pr-1">
          <PreviewSection title="Game executable paths" items={summary.gamePaths} valueKey="path" />
          <PreviewSection title="App executable paths" items={summary.appPaths} valueKey="path" />
          <PreviewSection
            title="Tracked process paths"
            items={summary.trackedProcessPaths}
            valueKey="path"
          />
          <PreviewSection
            title="Custom app arguments"
            items={summary.customAppArgs}
            valueKey="args"
          />

          {summary.warnings.length > 0 ? (
            <ul className="space-y-1 rounded-xl border border-(--warning-border) bg-(--warning-surface) p-3 text-xs text-(--warning-text)">
              {summary.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onImport}
            className="danger-action action-hover-scale flex-1 cursor-pointer rounded-xl py-3 text-sm font-bold"
          >
            Trust and Import
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="neutral-action action-hover-scale flex-1 cursor-pointer rounded-xl py-3 text-sm font-semibold"
          >
            Cancel Import
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
