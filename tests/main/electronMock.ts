import { vi } from 'vitest'

type MockIpcHandler = (...args: unknown[]) => unknown | Promise<unknown>

export const __ipcHandlers: Record<string, MockIpcHandler> = {}

export const app = {
  getVersion: vi.fn().mockReturnValue('1.0.0'),
  isPackaged: false,
  setLoginItemSettings: vi.fn(),
  getAppPath: vi.fn().mockReturnValue(process.cwd())
}

export const dialog = {
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn()
}

export const ipcMain = {
  handle: vi.fn((channel: string, handler: MockIpcHandler) => {
    __ipcHandlers[channel] = handler
  })
}

export function clearIpcHandlers() {
  Object.keys(__ipcHandlers).forEach((channel) => delete __ipcHandlers[channel])
}
