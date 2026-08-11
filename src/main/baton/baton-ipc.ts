/**
 * IPC handler registration for Baton integration.
 *
 * Exposes baton:start, baton:stop, baton:status to the renderer.
 * Pushes baton:onStatusChange on every state transition.
 */
import { ipcMain, BrowserWindow } from 'electron'
import {
  getBatonRepo,
  bootstrapBaton,
  initializeKB,
  installSkills,
  startDaemon,
  killDaemonIfRunning,
  killOrphanedDaemon,
  findAvailablePort,
  getState,
  setStatusCallback,
  applyPlanIfPresent,
  saveReviewIfPresent,
  mergeSettingsTask,
  startTailscale,
  startSshTunnel,
  getNetworkOpts,
  setNetworkOpts,
  DEFAULT_PORT,
  type BatonManagerState,
  type BatonStatus
} from './baton-manager'

function getMainWindow(): BrowserWindow | null {
  const allWindows = BrowserWindow.getAllWindows()
  return allWindows.find((w) => !w.isDestroyed()) ?? null
}

function pushStatus(state: BatonManagerState): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('baton:onStatusChange', state)
  }
}

/**
 * Full orchestration: bootstrap → KB init → plan apply (run-once) →
 * review save (run-once) → skills install → merge (run-once) →
 * daemon start → network ops (if enabled).
 * Runs in the main process, streams progress via baton:onStatusChange push.
 */
async function handleStartBaton(
  _event: unknown,
  args: { projectRoot: string }
): Promise<{ ok: boolean; error?: string }> {
  const { projectRoot } = args
  if (!projectRoot) return { ok: false, error: 'No project root provided' }

  const progressState = (status: BatonStatus, progress: string): BatonManagerState => ({
    status,
    port: null,
    pid: null,
    batonRepo: null,
    error: null,
    progress
  })

  const onProgress = (line: string): void => {
    // Preserve the current pipeline status (getState keeps it via statusOverride).
    const current = getState()
    pushStatus({ ...current, progress: line })
  }

  // Why retry: intermittent first-run failures (file lock during npm install, a
  // daemon that briefly held the port) clear on a second pass. Each attempt
  // first reclaims any port an orphaned daemon is holding.
  const MAX_ATTEMPTS = 2
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      killOrphanedDaemon(DEFAULT_PORT)

      // 1. Resolve Baton repo
      const batonRepo = await getBatonRepo()
      if (!batonRepo) {
        return { ok: false, error: 'Baton not found. Set BATON_REPO env or ensure Baton-Multi-Agent- is a sibling of Orca.' }
      }

      pushStatus(progressState('bootstrapping', attempt > 1 ? `Retrying setup (${attempt}/${MAX_ATTEMPTS})...` : 'Checking Baton build...'))

      // 2. Bootstrap (skip if already built)
      await bootstrapBaton(batonRepo, onProgress)

      pushStatus(progressState('initializing-kb', 'Building knowledge graph...'))

      // 3. Initialize KB (kb init — builds graph, CODEBASE.md, .mcp.json)
      await initializeKB(batonRepo, projectRoot, onProgress)

      // 4. Apply plan files if present (run-once per project)
      await applyPlanIfPresent(batonRepo, projectRoot, onProgress)

      // 5. Save review findings if present (run-once per project)
      await saveReviewIfPresent(batonRepo, projectRoot, onProgress)

      pushStatus(progressState('installing-skills', 'Installing skills...'))

      // 6. Write universal skills file
      await installSkills(batonRepo, projectRoot, onProgress)

      // 7. Merge settings-dark-mode if task exists (run-once per project)
      await mergeSettingsTask(batonRepo, projectRoot, onProgress)

      pushStatus(progressState('starting', 'Starting daemon...'))

      // 8. Find available port and start daemon
      const port = await findAvailablePort(DEFAULT_PORT)
      await startDaemon(batonRepo, projectRoot, port)

      // 9. Network ops — tailscale + SSH tunnel (if toggle enabled, fire-and-forget)
      const netOpts = getNetworkOpts()
      if (netOpts.enabled) {
        pushStatus(progressState('starting-network', 'Starting network access...'))
        await startTailscale(onProgress)
        await startSshTunnel(netOpts.sshUser, onProgress)
      }

      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (attempt < MAX_ATTEMPTS) continue
      pushStatus({ status: 'error', port: null, pid: null, batonRepo: null, error: msg, progress: '' })
      return { ok: false, error: msg }
    }
  }

  return { ok: false, error: 'Setup failed after retries' }
}

function handleStopBaton(): { ok: boolean } {
  killDaemonIfRunning()
  return { ok: true }
}

function handleBatonStatus(): BatonManagerState {
  return getState()
}

/** Register all Baton IPC handlers. Safe to call once. */
export function registerBatonHandlers(): void {
  ipcMain.handle('baton:start', handleStartBaton)
  ipcMain.handle('baton:stop', handleStopBaton)
  ipcMain.handle('baton:status', handleBatonStatus)
  ipcMain.handle('baton:getNetworkOpts', () => getNetworkOpts())
  ipcMain.handle('baton:setNetworkOpts', (_e, opts: { enabled?: boolean; sshUser?: string }) => {
    setNetworkOpts(opts)
    return { ok: true }
  })

  // Wire up the status push callback
  setStatusCallback(pushStatus)
}
