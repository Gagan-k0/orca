/**
 * Auto-starts Baton daemon when a project is available on IDE launch.
 * Fire-and-forget: runs once per project root; user can still stop/restart via BatonPanel.
 */
import { useEffect, useRef } from 'react'
import { useActiveWorktree } from '@/store/selectors'
import { useBatonStore } from '@/store/baton-store'

export default function BatonAutoStart(): React.JSX.Element | null {
  const activeWorktree = useActiveWorktree()
  const startBaton = useBatonStore((s) => s.startBaton)
  const status = useBatonStore((s) => s.status)
  const autoStartedForRef = useRef<string | null>(null)

  useEffect(() => {
    const projectRoot = activeWorktree?.path
    if (!projectRoot) return
    // Only auto-start once per project root; never if already running/busy.
    if (autoStartedForRef.current === projectRoot) return
    if (status !== 'stopped') return

    autoStartedForRef.current = projectRoot
    void startBaton(projectRoot)
  }, [activeWorktree?.path, status, startBaton])

  return null
}
