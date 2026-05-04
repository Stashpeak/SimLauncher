import { useCallback, useState } from 'react'
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

export function useConfigIO({ notify, onConfigImported }: UseConfigIOArgs) {
  const [exportingConfig, setExportingConfig] = useState(false)
  const [importingConfig, setImportingConfig] = useState(false)
  const [importConfirmOpen, setImportConfirmOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<{
    token: string
    filePath?: string
    summary: ConfigImportPreviewSummary
  } | null>(null)

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
