import { useEffect, type ReactNode } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { ProfileBehaviorSection } from './profile-editor/ProfileBehaviorSection'
import { ProfileEditorActions } from './profile-editor/ProfileEditorActions'
import { ProfileNameSection } from './profile-editor/ProfileNameSection'
import { ProfileUtilitiesSection } from './profile-editor/ProfileUtilitiesSection'
import { ProcessTrackingSection } from './profile-editor/ProcessTrackingSection'
import { useAppDirty } from '../contexts/AppDirtyContext'
import { useProfileEditor, type ProfileEditorProps } from '../hooks/useProfileEditor'

// The unsaved-changes bar lives at the App level now (#423) so it can pin to
// the viewport bottom even when the editor card itself doesn't overflow the
// scroll container. ProfileEditor's dirty state still flows into
// AppDirtyContext via reportProfileEditorDirty, and the app-level bar reacts
// to that.

export function ProfileEditor(props: ProfileEditorProps): ReactNode {
  const editor = useProfileEditor(props)
  const {
    reportProfileEditorDirty,
    registerSaveHandler,
    registerDiscardHandler,
    registerProfileEditorCloseRequestHandler
  } = useAppDirty()
  const scopeId = `${props.gameKey}:${props.activeProfileId}`
  const { onClose } = props
  const { isDirty, handleSave, handleCloseAttempt } = editor

  useEffect(() => {
    reportProfileEditorDirty(scopeId, isDirty)
    return () => {
      reportProfileEditorDirty(scopeId, false)
    }
  }, [scopeId, isDirty, reportProfileEditorDirty])

  useEffect(() => {
    if (!isDirty) {
      registerSaveHandler('profile-editor', null)
      return
    }
    registerSaveHandler('profile-editor', () => handleSave(false))
    return () => {
      registerSaveHandler('profile-editor', null)
    }
  }, [isDirty, handleSave, registerSaveHandler])

  useEffect(() => {
    // Only register the discard handler when this editor actually has dirty
    // state. Otherwise a Settings-scope discard would invoke onClose() here
    // and close a clean-but-open profile editor in the hidden Games pane,
    // dropping user context for no reason.
    if (!isDirty) {
      registerDiscardHandler('profile-editor', null)
      return
    }
    registerDiscardHandler('profile-editor', () => {
      onClose()
    })
    return () => {
      registerDiscardHandler('profile-editor', null)
    }
  }, [isDirty, onClose, registerDiscardHandler])

  useEffect(() => {
    // Always route external close requests (GameRow toggle X, etc.) through
    // handleCloseAttempt so the editor's own dirty-confirm dialog fires when
    // there are unsaved edits. Without this the X button just unmounts the
    // editor and silently drops user changes (#427).
    registerProfileEditorCloseRequestHandler(() => {
      handleCloseAttempt()
    })
    return () => {
      registerProfileEditorCloseRequestHandler(null)
    }
  }, [handleCloseAttempt, registerProfileEditorCloseRequestHandler])

  if (editor.loading) return null

  return (
    <div className="glass-surface-elevated animate-fade-slide relative rounded-[20px] p-5">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-(--text-primary)">Edit Profile</h2>
      </div>

      <div className="space-y-5">
        <ProfileNameSection
          profileName={editor.profileName}
          onProfileNameChange={editor.setProfileName}
        />

        <ProfileUtilitiesSection
          appPaths={editor.appPaths}
          appNames={editor.appNames}
          appIconCache={editor.appIconCache}
          failedIcons={editor.failedIcons}
          fetchingIcons={editor.fetchingIcons}
          dragUtilityId={editor.dragUtilityId}
          dropTarget={editor.dropTarget}
          utilityByKey={editor.utilityByKey}
          availableUtilities={editor.availableUtilities}
          enabledUtilityEntries={editor.enabledUtilityEntries}
          disabledUtilityEntries={editor.disabledUtilityEntries}
          onToggleUtility={editor.handleToggleUtility}
          onMoveEnabledUtility={editor.moveEnabledUtility}
          onStartUtilityDrag={editor.startUtilityDrag}
          onDropTargetChange={editor.setDropTarget}
          onDragUtilityIdChange={editor.setDragUtilityId}
          onIconFailed={editor.handleIconFailed}
        />

        <ProfileBehaviorSection
          launchAutomatically={editor.launchAutomatically}
          trackingEnabled={editor.trackingEnabled}
          onLaunchAutomaticallyChange={editor.setLaunchAutomatically}
          onTrackingEnabledChange={editor.setTrackingEnabled}
        />

        <ProcessTrackingSection
          killControlsEnabled={editor.killControlsEnabled}
          relaunchControlsEnabled={editor.relaunchControlsEnabled}
          trackedProcessPaths={editor.trackedProcessPaths}
          onKillControlsEnabledChange={editor.setKillControlsEnabled}
          onRelaunchControlsEnabledChange={editor.setRelaunchControlsEnabled}
          onAddTrackedProcess={editor.handleAddTrackedProcess}
          onBrowseTrackedProcess={editor.handleBrowseTrackedProcess}
          onRemoveTrackedProcess={editor.handleRemoveTrackedProcess}
        />

        <ProfileEditorActions
          isDirty={editor.isDirty}
          canDeleteProfile={editor.profileCount > 1}
          onSave={() => editor.handleSave(false)}
          onCloseAttempt={editor.handleCloseAttempt}
          onDeleteProfile={editor.handleDeleteProfile}
        />
      </div>

      <ConfirmDialog
        isOpen={editor.showConfirm}
        title="Unsaved Changes"
        message="You have unsaved changes in this profile. Do you want to save them before leaving?"
        onSave={() => editor.handleSave(false)}
        onDiscard={() => {
          editor.setShowConfirm(false)
          props.onClose()
        }}
        onCancel={() => editor.setShowConfirm(false)}
      />

      <ConfirmDialog
        isOpen={editor.showLaunchConfirm}
        title="Unsaved Changes"
        message="You have unsaved changes in this profile. Do you want to save them before launching?"
        saveLabel="Save Changes & Launch"
        discardLabel="Launch Without Saving"
        onSave={() => editor.handleSave(true)}
        onDiscard={editor.handleDiscardAndLaunch}
        onCancel={() => editor.setShowLaunchConfirm(false)}
      />

      <ConfirmDialog
        isOpen={editor.profileDeleteConfirm !== null}
        title="Delete Profile"
        message={`Delete profile "${editor.profileDeleteConfirm?.profileName || ''}"?`}
        saveLabel="Delete Profile"
        discardLabel="Keep Profile"
        saveClassName="danger-action"
        discardClassName="neutral-action"
        onSave={editor.confirmDeleteProfile}
        onDiscard={() => editor.setProfileDeleteConfirm(null)}
        onCancel={() => editor.setProfileDeleteConfirm(null)}
      />
    </div>
  )
}
