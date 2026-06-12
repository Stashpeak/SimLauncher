import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  applyImportConfig,
  cancelImportConfig,
  exportConfig,
  previewImportConfig
} from '../../lib/store'
import { ConfirmDialog } from '../ConfirmDialog'
import { ImportPreviewDialog, type ConfigImportPreviewSummary } from './ImportPreviewDialog'

interface UseConfigIOArgs {
  notify: (message: string, type: 'success' | 'error' | 'warn', duration?: number) => void
  onConfigImported?: () => void
}

export interface UseConfigIOResult {
  exportingConfig: boolean
  importingConfig: boolean
  handleExportConfig: () => Promise<void>
  handleImportConfig: () => Promise<void>
  configImportDialogs: ReactNode
}

export function useConfigIO({ notify, onConfigImported }: UseConfigIOArgs): UseConfigIOResult {
  const [exportingConfig, setExportingConfig] = useState(false)
  const [importingConfig, setImportingConfig] = useState(false)
  const [importConfirmOpen, setImportConfirmOpen] = useState(false)
  // The preview token is issued by the main process to tie the preview step to
  // the subsequent apply/cancel call. It must be forwarded unmodified; if the
  // dialog is dismissed without applying, cancelImportConfig must be called so
  // the main process can clean up any temporary files associated with the token.
  const [importPreview, setImportPreview] = useState<{
    token: string
    filePath?: string
    summary: ConfigImportPreviewSummary
  } | null>(null)

  // Unmount with the preview dialog still open (e.g. the SettingsProvider
  // remounts) would otherwise leave the token armed main-side until its TTL
  // expires — release it eagerly (#500). Ref mirror because the unmount
  // cleanup closes over the first render's state.
  const importPreviewTokenRef = useRef<string | null>(null)
  importPreviewTokenRef.current = importPreview?.token ?? null
  useEffect(() => {
    return () => {
      if (importPreviewTokenRef.current) {
        void cancelImportConfig(importPreviewTokenRef.current)
      }
    }
  }, [])

  const handleExportConfig = useCallback(async () => {
    setExportingConfig(true)

    try {
      const result = await exportConfig()

      if (result.success) {
        notify('Config exported', 'success', 2500)
      } else if (!result.canceled) {
        notify(result.error || 'Failed to export config', 'error')
      }
    } catch (err) {
      notify('Failed to export config', 'error')
      console.error(err)
    } finally {
      setExportingConfig(false)
    }
  }, [notify])

  // Show a "this will replace all settings" warning before opening the file
  // picker — avoids an accidental destructive import via a mis-click.
  const handleImportConfig = useCallback(async () => {
    setImportConfirmOpen(true)
  }, [])

  const handleConfirmImportConfig = useCallback(async () => {
    setImportConfirmOpen(false)
    setImportingConfig(true)

    try {
      const result = await previewImportConfig()

      if (result.success && result.token && result.summary) {
        setImportPreview({
          token: result.token,
          filePath: result.filePath,
          summary: result.summary
        })
      } else if (!result.canceled) {
        notify(result.error || 'Failed to preview config import', 'error')
      }
    } catch (err) {
      notify('Failed to preview config import', 'error')
      console.error(err)
    } finally {
      setImportingConfig(false)
    }
  }, [notify])

  const handleApplyImportConfig = useCallback(async () => {
    if (!importPreview) return

    setImportingConfig(true)

    try {
      const result = await applyImportConfig(importPreview.token)

      if (result.success) {
        setImportPreview(null)
        onConfigImported?.()
        notify('Config imported', 'success', 2500)
      } else {
        notify(result.error || 'Failed to import config', 'error')
      }
    } catch (err) {
      notify('Failed to import config', 'error')
      console.error(err)
    } finally {
      setImportingConfig(false)
    }
  }, [importPreview, notify, onConfigImported])

  const handleCancelImportConfig = useCallback(() => {
    if (importPreview) {
      void cancelImportConfig(importPreview.token)
    }

    setImportPreview(null)
  }, [importPreview])

  const configImportDialogs = (
    <>
      <ConfirmDialog
        isOpen={importConfirmOpen}
        title="Import Config"
        message="Importing a config file will replace your current SimLauncher settings. Continue?"
        saveLabel="Import Config"
        discardLabel="Cancel Import"
        saveClassName="danger-action"
        discardClassName="neutral-action"
        onSave={handleConfirmImportConfig}
        onDiscard={() => setImportConfirmOpen(false)}
        onCancel={() => setImportConfirmOpen(false)}
      />

      <ImportPreviewDialog
        isOpen={importPreview !== null}
        filePath={importPreview?.filePath}
        summary={importPreview?.summary}
        onImport={handleApplyImportConfig}
        onCancel={handleCancelImportConfig}
      />
    </>
  )

  return {
    exportingConfig,
    importingConfig,
    handleExportConfig,
    handleImportConfig,
    configImportDialogs
  }
}
