import { expect, test, vi } from 'vitest'

/**
 * #516 (Codex P2): the store must be built lazily on first access, not at import
 * time. index.ts imports `store` before requestSingleInstanceLock(); if building
 * the store (and its corrupt-config recovery, which can rewrite config.json) ran
 * at import, a second launch would quarantine/reset the live user's config and
 * exit. Deferring construction to first access — which only happens inside
 * functions that run after the lock — keeps a second instance from touching it.
 */
test('store construction is deferred until first access (#516)', async () => {
  vi.resetModules()
  let constructions = 0
  vi.doMock('electron-store', () => ({
    default: class MockStore {
      store: Record<string, unknown> = {}
      constructor() {
        constructions += 1
      }
      get(key: string): unknown {
        return this.store[key]
      }
      set(key: string, value: unknown): void {
        this.store[key] = value
      }
    }
  }))

  const { store } = await import('../../src/main/store')

  // Importing the module must NOT build the store.
  expect(constructions).toBe(0)

  // First access builds it exactly once...
  store.set('themeMode', 'light')
  expect(constructions).toBe(1)

  // ...and the same instance is reused on subsequent access.
  expect(store.get('themeMode')).toBe('light')
  expect(constructions).toBe(1)

  vi.doUnmock('electron-store')
})
