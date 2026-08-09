/**
 * IPC handler registration for OmniRoute integration.
 *
 * Exposes omniroute:start, omniroute:status and omniroute:stop to the renderer.
 * Status is pushed via omniroute:onStatusChange on every state transition.
 * Auto-start is handled in the main process, not via IPC — the start handler
 * exists so the panel can retry after a failure or restart after a manual stop.
 */
import { ipcMain, BrowserWindow } from 'electron'
import {
  getState,
  startOmniRoute,
  stopServerIfRunning,
  setStatusCallback,
  saveSetup,
  type OmniRouteManagerState
} from './omniroute-manager'

function getMainWindow(): BrowserWindow | null {
  const allWindows = BrowserWindow.getAllWindows()
  return allWindows.find((w) => !w.isDestroyed()) ?? null
}

function pushStatus(state: OmniRouteManagerState): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('omniroute:onStatusChange', state)
  }
}

function handleOmniRouteStatus(): OmniRouteManagerState {
  return getState()
}

async function handleStartOmniRoute(): Promise<{ ok: boolean; error?: string }> {
  return startOmniRoute()
}

async function handleStopOmniRoute(): Promise<{ ok: boolean }> {
  await stopServerIfRunning()
  return { ok: true }
}

async function handleOmniRouteSetup(values: { initialPassword: string }): Promise<{ ok: boolean; error?: string }> {
  const result = await saveSetup(values)
  return result
}

/** Register all OmniRoute IPC handlers. Safe to call once. */
export function registerOmniRouteHandlers(): void {
  ipcMain.handle('omniroute:start', handleStartOmniRoute)
  ipcMain.handle('omniroute:status', handleOmniRouteStatus)
  ipcMain.handle('omniroute:stop', handleStopOmniRoute)
  ipcMain.handle('omniroute:setup', (_event, values: { initialPassword: string }) => handleOmniRouteSetup(values))

  // Wire up the status push callback
  setStatusCallback(pushStatus)
}