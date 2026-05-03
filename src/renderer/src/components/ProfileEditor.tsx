import { ConfirmDialog } from './ConfirmDialog'
import { ProfileBehaviorSection } from './profile-editor/ProfileBehaviorSection'
import { ProfileEditorActions } from './profile-editor/ProfileEditorActions'
import { ProfileNameSection } from './profile-editor/ProfileNameSection'
import { ProfileUtilitiesSection } from './profile-editor/ProfileUtilitiesSection'
import { ProcessTrackingSection } from './profile-editor/ProcessTrackingSection'
import { useProfileEditor, type ProfileEditorProps } from '../hooks/useProfileEditor'

export function ProfileEditor(props: ProfileEditorProps) {
  const editor = useProfileEditor(props)

  if (editor.loading) return null

  return (
    <div className="glass-surface-elevated animate-fade-slide rounded-[20px] p-5">
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
          onSave={editor.handleSave}
          onCloseAttempt={editor.handleCloseAttempt}
          onDeleteProfile={editor.handleDeleteProfile}
        />
      </div>

      <ConfirmDialog
        isOpen={editor.showConfirm}
        title="Unsaved Changes"
        message="You have unsaved changes in this profile. Do you want to save them before leaving?"
        onSave={editor.handleSave}
        onDiscard={() => {
          editor.setShowConfirm(false)
          props.onClose()
        }}
        onCancel={() => editor.setShowConfirm(false)}
      />
    </div>
  )
}
