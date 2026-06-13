import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// Fresh module per test so the module-level listener/buffer state is reset.
async function freshModule() {
  vi.resetModules()
  return await import('../../src/renderer/src/lib/globalErrors')
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('buffers errors emitted before a listener subscribes, then flushes them on subscribe', async () => {
  const { installGlobalErrorHandlers, subscribeGlobalErrors } = await freshModule()
  installGlobalErrorHandlers()

  window.dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') }))

  const messages: string[] = []
  subscribeGlobalErrors((message) => messages.push(message))

  expect(messages).toHaveLength(1)
})

test('delivers errors to a subscribed listener and stops after unsubscribe', async () => {
  const { installGlobalErrorHandlers, subscribeGlobalErrors } = await freshModule()
  installGlobalErrorHandlers()

  const messages: string[] = []
  const unsubscribe = subscribeGlobalErrors((message) => messages.push(message))

  window.dispatchEvent(new ErrorEvent('error', { message: 'first' }))
  expect(messages).toHaveLength(1)

  unsubscribe()
  window.dispatchEvent(new ErrorEvent('error', { message: 'second' }))
  expect(messages).toHaveLength(1)
})

test('surfaces unhandled promise rejections to the listener', async () => {
  const { installGlobalErrorHandlers, subscribeGlobalErrors } = await freshModule()
  installGlobalErrorHandlers()

  const messages: string[] = []
  subscribeGlobalErrors((message) => messages.push(message))

  const event = new Event('unhandledrejection') as Event & { reason?: unknown }
  event.reason = new Error('rejected')
  window.dispatchEvent(event)

  expect(messages).toHaveLength(1)
})
