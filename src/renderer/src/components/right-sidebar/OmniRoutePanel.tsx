import { useOmniRouteStore } from '@/store/omniroute-store'
import { Route, RefreshCw, Square, AlertCircle, CheckCircle2, Loader2, Play, Settings } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * OmniRoute panel — embeds the full OmniRoute dashboard via iframe.
 * OmniRoute auto-starts with the IDE in the main process; this panel surfaces
 * the live status and gives refresh / stop / retry controls.
 */
export default function OmniRoutePanel(): React.JSX.Element {
  const { status, port, error, progress, startOmniRoute, stopOmniRoute, refreshStatus } =
    useOmniRouteStore()
  const [iframeKey, setIframeKey] = useState(0)

  // On mount, check current server status
  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const handleRefresh = useCallback(() => {
    setIframeKey((k) => k + 1)
  }, [])

  const isBusy = status === 'bootstrapping' || status === 'starting'
  const isRunning = status === 'running' && port != null
  const isError = status === 'error'
  const needsSetup = status === 'setup'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Route size={16} className="shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">OmniRoute</span>

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

          {needsSetup && (
            <span className="flex items-center gap-1 text-xs text-amber-500">
              <Settings size={12} />
              Setup needed
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
        /* Live OmniRoute dashboard iframe */
        <OmniRouteIframe key={iframeKey} port={port} />
      ) : (
        /* Startup / idle / error states */
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          {isBusy ? (
            <>
              <Loader2 size={32} className="animate-spin text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Starting OmniRoute...</p>
                {progress && (
                  <p className="mt-1 max-w-xs truncate text-xs text-muted-foreground" title={progress}>
                    {progress}
                  </p>
                )}
              </div>
            </>
          ) : needsSetup ? (
            <>
              <Settings size={48} className="text-amber-500 opacity-50" />
              <div className="text-center">
                <p className="text-sm font-medium">Setup Required</p>
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                  Configure the admin password before starting OmniRoute.
                  A setup dialog should appear shortly.
                </p>
              </div>
            </>
          ) : isError ? (
            <>
              <AlertCircle size={32} className="text-rose-500" />
              <div className="text-center">
                <p className="text-sm font-medium text-rose-500">Failed to start</p>
                {error && (
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">{error}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void startOmniRoute()}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <RefreshCw size={14} />
                Retry
              </button>
            </>
          ) : (
            <>
              <Route size={48} className="opacity-30" />
              <div className="text-center">
                <p className="text-sm font-medium">OmniRoute</p>
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                  AI router — 290+ providers, auto fallback, MCP &amp; A2A
                </p>
              </div>
              <button
                type="button"
                onClick={() => void startOmniRoute()}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Play size={14} />
                Start OmniRoute
              </button>
            </>
          )}
        </div>
      )}

      {/* Stop button (bottom bar, only when running) */}
      {isRunning && (
        <div className="flex border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={() => void stopOmniRoute()}
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

function OmniRouteIframe({ port }: { port: number }): React.JSX.Element {
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
        title="OmniRoute Dashboard"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  )
}
