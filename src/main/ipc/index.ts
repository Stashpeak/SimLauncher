import { registerUpdaterHandlers } from '../updater'
import { registerWindowHandlers, sendToRenderer } from '../window'
import { registerConfigHandlers } from './config'
import { registerContextMenuHandlers } from './context-menu'
import { registerIconHandlers } from './icons'
import { registerLaunchHandlers } from './launch'

/**
 * Registers all ipcMain handlers for the application. Must be called once
 * during app initialisation, before the renderer is loaded.
 *
 * Ordering note: the individual register* calls are independent of each other
 * and may be reordered freely — none of them depend on another group being
 * registered first. The updater is passed `sendToRenderer` rather than
 * importing it directly so it stays decoupled from the window module at the
 * handler level.
 */
export function registerHandlers(): void {
  registerConfigHandlers()
  registerLaunchHandlers()
  registerIconHandlers()
  registerContextMenuHandlers()
  registerWindowHandlers()
  registerUpdaterHandlers(sendToRenderer)
}
