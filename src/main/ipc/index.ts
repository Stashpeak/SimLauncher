import { registerUpdaterHandlers } from '../updater'
import { registerWindowHandlers, sendToRenderer } from '../window'
import { registerConfigHandlers } from './config'
import { registerContextMenuHandlers } from './context-menu'
import { registerIconHandlers } from './icons'
import { registerLaunchHandlers } from './launch'

export function registerHandlers() {
  registerConfigHandlers()
  registerLaunchHandlers()
  registerIconHandlers()
  registerContextMenuHandlers()
  registerWindowHandlers()
  registerUpdaterHandlers(sendToRenderer)
}
