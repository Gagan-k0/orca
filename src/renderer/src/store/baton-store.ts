/**
 * Zustand store for Baton daemon state in the renderer.
 * Listens to baton:onStatusChange push events from main process.
 */
import { create } from 'zustand'

export type BatonStatus =
  | 'stopped'
  | 'bootstrapping'
  | 'initializing-kb'
  | 'installing-skills'
  | 'applying-plan'
  | 'saving-review'
  | 'merging'
  | 'starting-network'
  | 'starting'
  | 'running'
  | 'error'

interface BatonState {
  status: BatonStatus
  port: number | null
  pid: number | null
  error: string | null
  progress: string
  networkEnabled: boolean
  sshUser: string
  startBaton: (projectRoot: string) => Promise<void>
  stopBaton: () => Promise<void>
  refreshStatus: () => Promise<void>
  setNetworkOpts: (opts: { enabled?: boolean; sshUser?: string }) => Promise<void>
  loadNetworkOpts: () => Promise<void>
}

let listenerInstalled = false

function installListener(): void {
  if (listenerInstalled) return
  listenerInstalled = true

  // Listen for main-process status push events
  window.api.baton.onStatusChange((state: {
    status: BatonStatus
    port: number | null
    pid: number | null
    error: string | null
    progress: string
  }) => {
    useBatonStore.setState({
      status: state.status,
      port: state.port,
      pid: state.pid,
      error: state.error,
      progress: state.progress
    })
  })
}

export const useBatonStore = create<BatonState>()((set) => {
  installListener()

  return {
    status: 'stopped',
    port: null,
    pid: null,
    error: null,
    progress: '',
    networkEnabled: false,
    sshUser: '',

    startBaton: async (projectRoot: string) => {
      set({ status: 'bootstrapping', error: null, progress: 'Starting...' })
      try {
        const result = await window.api.baton.start({ projectRoot })
        if (!result.ok) {
          set({ status: 'error', error: result.error ?? 'Unknown error' })
        }
        // status will be pushed via onStatusChange listener
      } catch (err) {
        set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    },

    stopBaton: async () => {
      set({ status: 'stopped', error: null, progress: '' })
      try {
        await window.api.baton.stop()
      } catch { /* ignore */ }
    },

    refreshStatus: async () => {
      try {
        const state = await window.api.baton.status()
        set({
          status: state.status,
          port: state.port,
          pid: state.pid,
          error: state.error,
          progress: state.progress
        })
      } catch { /* ignore */ }
    },

    setNetworkOpts: async (opts) => {
      try {
        await window.api.baton.setNetworkOpts(opts)
        const current = useBatonStore.getState()
        set({
          networkEnabled: opts.enabled ?? current.networkEnabled,
          sshUser: opts.sshUser ?? current.sshUser
        })
      } catch { /* ignore */ }
    },

    loadNetworkOpts: async () => {
      try {
        const opts = await window.api.baton.getNetworkOpts()
        set({ networkEnabled: opts.enabled, sshUser: opts.sshUser })
      } catch { /* ignore */ }
    }
  }
})
