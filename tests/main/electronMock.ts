import { vi } from 'vitest'

type MockIpcHandler = (...args: unknown[]) => unknown | Promise<unknown>
type MockEventHandler = (...args: unknown[]) => void

export const __ipcHandlers: Record<string, MockIpcHandler> = {}

class MockEventTarget {
  private listeners = new Map<string, MockEventHandler[]>()

  private add(event: string, handler: MockEventHandler) {
    const existing = this.listeners.get(event) ?? []
    existing.push(handler)
    this.listeners.set(event, existing)
  }

  private remove(event: string, handler: MockEventHandler) {
    const existing = this.listeners.get(event) ?? []
    const index = existing.indexOf(handler)
    if (index >= 0) existing.splice(index, 1)
  }

  on = vi.fn((event: string, handler: MockEventHandler) => {
    this.add(event, handler)
    return this
  })

  once = vi.fn((event: string, handler: MockEventHandler) => {
    const wrapped = (...args: unknown[]) => {
      this.remove(event, wrapped)
      handler(...args)
    }
    this.add(event, wrapped)
    return this
  })

  emit(event: string, ...args: unknown[]) {
    for (const handler of [...(this.listeners.get(event) ?? [])]) {
      handler(...args)
    }
  }
}

class MockWebContents extends MockEventTarget {
  send = vi.fn()
  setWindowOpenHandler = vi.fn()
  setZoomFactor = vi.fn()
  getZoomFactor = vi.fn(() => 1)
  isLoading = vi.fn(() => false)
}

export class BrowserWindow extends MockEventTarget {
  static instances: BrowserWindow[] = []

  static getAllWindows() {
    return BrowserWindow.instances.filter((w) => !w.destroyed)
  }

  options: Record<string, unknown>
  webContents = new MockWebContents()
  private visible = false
  private minimized = false
  private destroyed = false

  constructor(options: Record<string, unknown> = {}) {
    super()
    this.options = options
    BrowserWindow.instances.push(this)
  }

  show = vi.fn(() => {
    this.visible = true
    this.minimized = false
  })

  hide = vi.fn(() => {
    this.visible = false
  })

  focus = vi.fn()

  minimize = vi.fn(() => {
    this.minimized = true
  })

  restore = vi.fn(() => {
    this.minimized = false
  })

  close = vi.fn()

  destroy = vi.fn(() => {
    this.destroyed = true
  })

  isVisible = vi.fn(() => this.visible)
  isMinimized = vi.fn(() => this.minimized)
  isDestroyed = vi.fn(() => this.destroyed)
  isMaximized = vi.fn(() => false)
  getBounds = vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 }))
  loadFile = vi.fn()
  loadURL = vi.fn()
}

export const screen = {
  getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }))
}

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
