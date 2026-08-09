/**
 * First-run setup dialog for OmniRoute.
 * Collects the INITIAL_PASSWORD (admin dashboard password) and optionally
 * other configuration keys before the server starts.
 */
import { useState, useCallback, type FormEvent } from 'react'
import { Route, Eye, EyeOff, ArrowRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { useOmniRouteStore, type OmniRouteStatus } from '@/store/omniroute-store'

export function OmniRouteSetupDialog(): React.JSX.Element {
  const status = useOmniRouteStore((s) => s.status)
  const submitSetup = useOmniRouteStore((s) => s.submitSetup)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOpen = status === 'setup'

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    if (!password.trim()) { setError('Password is required.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password === 'CHANGEME') { setError('Choose a password other than CHANGEME.'); return }
    setSubmitting(true)
    setError(null)
    const result = await submitSetup({ initialPassword: password.trim() })
    if (!result.ok) {
      setError(result.error ?? 'Setup failed')
      setSubmitting(false)
    }
    // On success, status changes → dialog closes automatically
  }, [password, confirm, submitSetup])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) setError(null) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Route size={18} />
            OmniRoute Initial Setup
          </DialogTitle>
          <DialogDescription>
            Set the admin password for the OmniRoute dashboard. This is used to log in
            to the dashboard at <code>http://127.0.0.1:20128</code>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 pt-2">
          {/* Password field */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Admin Password
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter a strong password"
                autoFocus
                className="w-full rounded-md border border-border bg-background px-3 py-2 pr-10 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Confirm field */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Confirm Password
            </label>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter the password"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          {error && (
            <p className="text-xs text-rose-500">{error}</p>
          )}

          <DialogFooter className="flex-row justify-end gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Configure & Start'}
              <ArrowRight size={14} />
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
