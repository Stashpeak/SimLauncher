import { beforeEach, expect, test, vi } from 'vitest'

type LaunchFailureResult = { success: false; error: string }

const mocks = vi.hoisted(() => ({
  storeData: { gamePaths: {} as Record<string, string> }
}))

vi.mock('../../src/main/store', () => ({
  store: {
    get: vi.fn((key: string, fallback?: unknown) => {
      if (key === 'gamePaths') {
        return mocks.storeData.gamePaths ?? fallback
      }
      return fallback
    })
  }
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.storeData = { gamePaths: { ac: 'C:/Games/AssettoCorsa.exe' } }
})

async function validate(gameKey: unknown) {
  const { validateGameKey } = await import('../../src/main/ipc/launch')
  return validateGameKey(gameKey) as LaunchFailureResult | undefined
}

test.each([
  'launch-profile',
  'relaunch-missing-profile',
  'get-profile-switch-diff',
  'switch-profile-apps',
  'kill-launched-apps'
])('%s rejects non-string gameKey arguments', async (channel) => {
  expect(channel).toBeTruthy()
  await expect(validate(42)).resolves.toEqual({
    success: false,
    error: 'Invalid argument'
  })
})

test.each([
  'launch-profile',
  'relaunch-missing-profile',
  'get-profile-switch-diff',
  'switch-profile-apps',
  'kill-launched-apps'
])('%s rejects unknown gameKey arguments', async (channel) => {
  expect(channel).toBeTruthy()
  await expect(validate('unknown')).resolves.toEqual({
    success: false,
    error: 'Unknown game key'
  })
})
