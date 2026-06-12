import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
  createSettingsObjectVersions,
  getSettingsObjectChangesDuringSave
} from '../src/renderer/src/components/settings/saveRace'

// The change map drives which object records are pushed back into renderer
// state after a save: a field edited while the save was in flight must NOT be
// overwritten with the pre-save trimmed copy (see useSettingsSave). The dirty
// baseline itself always uses the saved records, so concurrent edits stay
// visibly dirty.

test('no edits during save reports every field unchanged', () => {
  const versionsAtSave = createSettingsObjectVersions()

  assert.deepEqual(getSettingsObjectChangesDuringSave(versionsAtSave, versionsAtSave), {
    appPaths: false,
    appNames: false,
    appArgs: false,
    gamePaths: false
  })
})

test('only the fields edited during the save are flagged as changed', () => {
  const versionsAtSave = createSettingsObjectVersions()
  const currentVersions = {
    ...versionsAtSave,
    appPaths: versionsAtSave.appPaths + 1,
    gamePaths: versionsAtSave.gamePaths + 2
  }

  assert.deepEqual(getSettingsObjectChangesDuringSave(versionsAtSave, currentVersions), {
    appPaths: true,
    appNames: false,
    appArgs: false,
    gamePaths: true
  })
})
