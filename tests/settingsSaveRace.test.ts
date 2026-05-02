import assert from 'node:assert/strict'

import {
  createSettingsObjectVersions,
  getSettingsObjectChangesDuringSave,
  resolveSettingsObjectsAfterSave,
  type SettingsObjectRecords
} from '../src/renderer/src/components/settings/saveRace'

const savedObjects: SettingsObjectRecords = {
  appPaths: { crewChief: 'C:\\Apps\\CrewChief.exe' },
  appNames: { custom1: 'Spotter' },
  appArgs: { custom1: '--old' },
  gamePaths: { ams2: 'C:\\Games\\AMS2.exe' }
}

const latestObjects: SettingsObjectRecords = {
  appPaths: { crewChief: 'D:\\Apps\\CrewChief.exe' },
  appNames: { custom1: 'Telemetry' },
  appArgs: { custom1: '--new' },
  gamePaths: { ams2: 'D:\\Games\\AMS2.exe' }
}

test('settings save race resolution keeps app path edits made while save is in flight', () => {
  const versionsAtSave = createSettingsObjectVersions()
  const currentVersions = { ...versionsAtSave, appPaths: versionsAtSave.appPaths + 1 }
  const changedDuringSave = getSettingsObjectChangesDuringSave(versionsAtSave, currentVersions)

  const resolved = resolveSettingsObjectsAfterSave({
    savedObjects,
    latestObjects,
    changedDuringSave
  })

  assert.deepEqual(resolved.appPaths, latestObjects.appPaths)
  assert.deepEqual(resolved.appNames, savedObjects.appNames)
  assert.deepEqual(resolved.appArgs, savedObjects.appArgs)
  assert.deepEqual(resolved.gamePaths, savedObjects.gamePaths)
})

test('settings save race resolution keeps game path edits made while save is in flight', () => {
  const versionsAtSave = createSettingsObjectVersions()
  const currentVersions = { ...versionsAtSave, gamePaths: versionsAtSave.gamePaths + 1 }
  const changedDuringSave = getSettingsObjectChangesDuringSave(versionsAtSave, currentVersions)

  const resolved = resolveSettingsObjectsAfterSave({
    savedObjects,
    latestObjects,
    changedDuringSave
  })

  assert.deepEqual(resolved.gamePaths, latestObjects.gamePaths)
  assert.deepEqual(resolved.appPaths, savedObjects.appPaths)
})

test('settings save race resolution keeps app name edits made while save is in flight', () => {
  const versionsAtSave = createSettingsObjectVersions()
  const currentVersions = { ...versionsAtSave, appNames: versionsAtSave.appNames + 1 }
  const changedDuringSave = getSettingsObjectChangesDuringSave(versionsAtSave, currentVersions)

  const resolved = resolveSettingsObjectsAfterSave({
    savedObjects,
    latestObjects,
    changedDuringSave
  })

  assert.deepEqual(resolved.appNames, latestObjects.appNames)
  assert.deepEqual(resolved.appArgs, savedObjects.appArgs)
})

test('settings save race resolution keeps app argument edits made while save is in flight', () => {
  const versionsAtSave = createSettingsObjectVersions()
  const currentVersions = { ...versionsAtSave, appArgs: versionsAtSave.appArgs + 1 }
  const changedDuringSave = getSettingsObjectChangesDuringSave(versionsAtSave, currentVersions)

  const resolved = resolveSettingsObjectsAfterSave({
    savedObjects,
    latestObjects,
    changedDuringSave
  })

  assert.deepEqual(resolved.appArgs, latestObjects.appArgs)
  assert.deepEqual(resolved.appNames, savedObjects.appNames)
})
