import { useActiveWorktree } from '@/store/selectors'
import { useBatonStore } from '@/store/baton-store'
import { Network, Play, Square, RefreshCw, AlertCircle, CheckCircle2, Loader2, ChevronDown, ChevronUp, Shield } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Baton integration panel — embeds the full Baton dashboard via iframe.
 * States: stopped (Start button) / bootstrapping / running (iframe) / error.
 */
export default function BatonPanel(): React.JSX.Element {
  const { status, port, error, progress, startBaton, stopBaton, refreshStatus, networkEnabled, sshUser, setNetworkOpts, loadNetworkOpts } = useBatonStore()
  const activeWorktree = useActiveWorktree()
  const projectRoot = activeWorktree?.path ?? ''
  const [iframeKey, setIframeKey] = useState(0)
  const [networkExpanded, setNetworkExpanded] = useState(false)
  const [localSshUser, setLocalSshUser] = useState(sshUser)

  // On mount, check current daemon status + load network opts
  useEffect(() => {
    void refreshStatus()
    void loadNetworkOpts()
  }, [refreshStatus, loadNetworkOpts])

  // Auto-start Baton when IDE opens with a project loaded
  useEffect(() => {
    if (projectRoot && status === 'stopped') {
      void startBaton(projectRoot)
    }
  }, [projectRoot, status, startBaton])

  // Keep local SSH field in sync when store loads
  useEffect(() => { setLocalSshUser(sshUser) }, [sshUser])

  const handleStart = useCallback(() => {
    if (!projectRoot) return
    // Persist the SSH user before starting so main process picks it up
    if (localSshUser !== sshUser) {
      void setNetworkOpts({ sshUser: localSshUser })
    }
    void startBaton(projectRoot)
  }, [projectRoot, startBaton, localSshUser, sshUser, setNetworkOpts])

  const handleStop = useCallback(() => {
    void stopBaton()
  }, [stopBaton])

  const handleRefresh = useCallback(() => {
    setIframeKey(k => k + 1)
  }, [])

  const isBusy = status === 'bootstrapping' || status === 'initializing-kb' || status === 'installing-skills' || status === 'applying-plan' || status === 'saving-review' || status === 'merging' || status === 'starting-network' || status === 'starting'
  const isRunning = status === 'running' && port != null
  const isError = status === 'error'

  if (!projectRoot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
        <Network size={32} className="opacity-50" />
        <p className="text-sm">Open a project to use Baton</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Network size={16} className="shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">Baton</span>

        <div className="ml-auto flex items-center gap-1.5">
          {isRunning && (
            <button
              type="button"
              onClick={handleRefresh}
              className="sidebar-toggle"
              title="Refresh dashboard"
            >
              <RefreshCw size={14} />
            </button>
          )}

          {isRunning && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <CheckCircle2 size={12} />
              Running :{port}
            </span>
          )}

          {isError && (
            <span className="flex items-center gap-1 text-xs text-rose-500">
              <AlertCircle size={12} />
              Error
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      {isRunning && port ? (
        /* Live Baton dashboard iframe */
        <BatonIframe key={iframeKey} port={port} />
      ) : (
        /* Setup / idle state */
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          {isBusy ? (
            <>
              <Loader2 size={32} className="animate-spin text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Setting up Baton...</p>
                {progress && (
                  <p className="mt-1 max-w-xs truncate text-xs text-muted-foreground" title={progress}>
                    {progress}
                  </p>
                )}
              </div>
            </>
          ) : isError ? (
            <>
              <AlertCircle size={32} className="text-rose-500" />
              <div className="text-center">
                <p className="text-sm font-medium text-rose-500">Setup failed</p>
                {error && (
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">{error}</p>
                )}
              </div>
              <button
                type="button"
                onClick={handleStart}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <RefreshCw size={14} />
                Retry
              </button>
            </>
          ) : (
            <>
              <Network size={48} className="opacity-30" />
              <div className="text-center">
                <p className="text-sm font-medium">Baton Dashboard</p>
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                  Knowledge graph, shared memory, skills, code review, and more
                </p>
              </div>
              <button
                type="button"
                onClick={handleStart}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Play size={14} />
                Start Baton
              </button>

              {/* Network toggle (collapsed by default) */}
              <div className="w-full max-w-xs">
                <button
                  type="button"
                  onClick={() => setNetworkExpanded(e => !e)}
                  className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Shield size={12} />
                  <span>Network Access</span>
                  <span className="ml-auto text-[10px] opacity-60">{networkEnabled ? 'ON' : 'OFF'}</span>
                  {networkExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>

                {networkExpanded && (
                  <div className="mt-2 space-y-2 rounded-md border border-border p-3">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={networkEnabled}
                        onChange={e => void setNetworkOpts({ enabled: e.target.checked })}
                        className="accent-primary"
                      />
                      Enable Tailscale + SSH tunnel
                    </label>
                    {networkEnabled && (
                      <input
                        type="text"
                        value={localSshUser}
                        onChange={e => setLocalSshUser(e.target.value)}
                        placeholder="SSH username (you)"
                        className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground"
                      />
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      Runs <code>tailscale up</code> then opens an SSH tunnel to 192.168.1.7:7077 for teammate access.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Stop button (bottom bar, only when running) */}
      {isRunning && (
        <div className="flex border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={handleStop}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Square size={12} />
            Stop
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Iframe component (separate to keep hook rules clean)               */
/* ------------------------------------------------------------------ */

function BatonIframe({ port }: { port: number }): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)

  return (
    <div className="relative flex-1 overflow-hidden">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={`http://127.0.0.1:${port}`}
        className="h-full w-full border-0"
        onLoad={() => setLoaded(true)}
        title="Baton Dashboard"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  )
}
