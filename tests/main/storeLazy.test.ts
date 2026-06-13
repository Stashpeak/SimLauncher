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

/**
 * #516 (Codex P2, follow-up): the lazy Proxy must forward reads with the real
 * instance as the receiver, not the Proxy itself. electron-store exposes `.store`
 * (and `.path`/`.size`) as getters that read private (`#`) fields; invoking such a
 * getter with `this` = Proxy throws because the Proxy isn't a Conf instance. The
 * config import rollback snapshot and the config export both read `store.store`,
 * so a wrong receiver would crash those paths at runtime.
 */
test('store getters reading private fields work through the lazy Proxy (#516)', async () => {
  vi.resetModules()
  vi.doMock('electron-store', () => ({
    default: class MockStore {
      // Mirror electron-store: `store` is a getter backed by a private field, so
      // it throws if called with a `this` that isn't a real instance.
      #data: Record<string, unknown> = {}
      get store(): Record<string, unknown> {
        return { ...this.#data }
      }
      get(key: string): unknown {
        return this.#data[key]
      }
      set(key: string, value: unknown): void {
        this.#data[key] = value
      }
    }
  }))

  const { store } = await import('../../src/main/store')

  store.set('themeMode', 'dark')

  // Reading the `store` getter through the Proxy must not throw (it did when the
  // Proxy was passed as the getter's receiver) and must reflect the backing data.
  expect(() => store.store).not.toThrow()
  expect(store.store).toEqual({ themeMode: 'dark' })

  vi.doUnmock('electron-store')
})
