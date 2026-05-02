import assert from 'node:assert/strict'
import { test } from 'vitest'

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

test('resolveSettingsObjectsAfterSave returns savedObjects as dirty baseline when nothing changed during save', () => {
  const versionsAtSave = createSettingsObjectVersions()
  const changedDuringSave = getSettingsObjectChangesDuringSave(versionsAtSave, versionsAtSave)

  const resolved = resolveSettingsObjectsAfterSave({
    savedObjects,
    latestObjects,
    changedDuringSave
  })

  assert.deepEqual(resolved.appPaths, savedObjects.appPaths)
  assert.deepEqual(resolved.appNames, savedObjects.appNames)
  assert.deepEqual(resolved.appArgs, savedObjects.appArgs)
  assert.deepEqual(resolved.gamePaths, savedObjects.gamePaths)
})

test('resolveSettingsObjectsAfterSave returns savedObjects as dirty baseline when app paths changed during save', () => {
  const versionsAtSave = createSettingsObjectVersions()
  const currentVersions = { ...versionsAtSave, appPaths: versionsAtSave.appPaths + 1 }
  const changedDuringSave = getSettingsObjectChangesDuringSave(versionsAtSave, currentVersions)

  const resolved = resolveSettingsObjectsAfterSave({
    savedObjects,
    latestObjects,
    changedDuringSave
  })

  assert.deepEqual(resolved.appPaths, savedObjects.appPaths)
  assert.deepEqual(resolved.appNames, savedObjects.appNames)
  assert.deepEqual(resolved.appArgs, savedObjects.appArgs)
  assert.deepEqual(resolved.gamePaths, savedObjects.gamePaths)
})

test('resolveSettingsObjectsAfterSave returns savedObjects as dirty baseline when game paths changed during save', () => {
  const versionsAtSave = createSettingsObjectVersions()
  const currentVersions = { ...versionsAtSave, gamePaths: versionsAtSave.gamePaths + 1 }
  const changedDuringSave = getSettingsObjectChangesDuringSave(versionsAtSave, currentVersions)

  const resolved = resolveSettingsObjectsAfterSave({
    savedObjects,
    latestObjects,
    changedDuringSave
  })

  assert.deepEqual(resolved.gamePaths, savedObjects.gamePaths)
  assert.deepEqual(resolved.appPaths, savedObjects.appPaths)
})

test('resolveSettingsObjectsAfterSave returns savedObjects as dirty baseline when all fields changed during save', () => {
  const versionsAtSave = createSettingsObjectVersions()
  const currentVersions = {
    appPaths: versionsAtSave.appPaths + 1,
    appNames: versionsAtSave.appNames + 1,
    appArgs: versionsAtSave.appArgs + 1,
    gamePaths: versionsAtSave.gamePaths + 1
  }
  const changedDuringSave = getSettingsObjectChangesDuringSave(versionsAtSave, currentVersions)

  const resolved = resolveSettingsObjectsAfterSave({
    savedObjects,
    latestObjects,
    changedDuringSave
  })

  assert.deepEqual(resolved, savedObjects)
})
