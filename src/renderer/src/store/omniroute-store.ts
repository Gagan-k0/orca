/**
 * Zustand store for OmniRoute server state in the renderer.
 * Listens to omniroute:onStatusChange push events from main process.
 */
import { create } from 'zustand'

export type OmniRouteStatus = 'idle' | 'setup' | 'bootstrapping' | 'starting' | 'running' | 'error'

interface OmniRouteState {
  status: OmniRouteStatus
  port: number | null
  pid: number | null
  error: string | null
  progress: string
  startOmniRoute: () => Promise<void>
  stopOmniRoute: () => Promise<void>
  submitSetup: (values: { initialPassword: string; anthropicApiKey?: string }) => Promise<{ ok: boolean; error?: string }>
  refreshStatus: () => Promise<void>
}

let listenerInstalled = false

function installListener(): void {
  if (listenerInstalled) return
  listenerInstalled = true

  // Listen for main-process status push events
  window.api.omniroute.onStatusChange((state: {
    status: OmniRouteStatus
    port: number | null
    pid: number | null
    error: string | null
    progress: string
  }) => {
    useOmniRouteStore.setState({
      status: state.status,
      port: state.port,
      pid: state.pid,
      error: state.error,
      progress: state.progress
    })
  })
}

export const useOmniRouteStore = create<OmniRouteState>()((set) => {
  installListener()

  return {
    status: 'idle',
    port: null,
    pid: null,
    error: null,
    progress: '',

    startOmniRoute: async () => {
      set({ status: 'starting', error: null, progress: 'Starting OmniRoute...' })
      try {
        const result = await window.api.omniroute.start()
        if (!result.ok) {
          set({ status: 'error', error: result.error ?? 'Unknown error' })
        }
        // status will be pushed via onStatusChange listener
      } catch (err) {
        set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    },

    stopOmniRoute: async () => {
      set({ status: 'idle', error: null, progress: '' })
      try {
        await window.api.omniroute.stop()
      } catch { /* ignore */ }
    },

    submitSetup: async (values: { initialPassword: string; anthropicApiKey?: string }) => {
      try {
        const result = await window.api.omniroute.setup(values)
        if (!result.ok) {
          return { ok: false, error: result.error ?? 'Setup failed' }
        }
        // After successful setup, auto-start OmniRoute
        const startResult = await window.api.omniroute.start()
        if (!startResult.ok) {
          return { ok: false, error: startResult.error ?? 'Start failed after setup' }
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    refreshStatus: async () => {
      try {
        const state = await window.api.omniroute.status()
        set({
          status: state.status,
          port: state.port,
          pid: state.pid,
          error: state.error,
          progress: state.progress
        })
      } catch { /* ignore */ }
    }
  }
})
