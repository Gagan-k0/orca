/**
 * Baton daemon lifecycle manager for Orca IDE.
 *
 * Locates the Baton repo, runs first-time bootstrap (npm install + build),
 * initializes KB on the current project, installs skills, spawns the daemon,
 * health-polls it, and kills it on shutdown.
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Startup marker — tracks one-shot steps per project                  */
/* ------------------------------------------------------------------ */

interface StartupMarker {
  version: number
  planAppliedAt: string | null
  reviewSavedAt: string | null
  mergedAt: string | null
}

const STARTER_MARKER: StartupMarker = { version: 1, planAppliedAt: null, reviewSavedAt: null, mergedAt: null }

function markerPath(projectRoot: string): string {
  return join(projectRoot, '.baton', 'orca-startup.json')
}

async function loadStartupMarker(projectRoot: string): Promise<StartupMarker> {
  try {
    const raw = await readFile(markerPath(projectRoot), 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && parsed.version === 1) return { ...STARTER_MARKER, ...parsed }
  } catch { /* first run or corrupt — start fresh */ }
  return { ...STARTER_MARKER }
}

async function saveStartupMarker(projectRoot: string, patch: Partial<StartupMarker>): Promise<void> {
  const marker = await loadStartupMarker(projectRoot)
  const updated = { ...marker, ...patch }
  const path = markerPath(projectRoot)
  try {
    const dir = join(projectRoot, '.baton')
    await mkdir(dir, { recursive: true })
    await writeFile(path, JSON.stringify(updated, null, 2) + '\n', 'utf-8')
  } catch { /* non-critical — marker save failure doesn't block setup */ }
}

/* ------------------------------------------------------------------ */
/* Network opts — in-memory toggle (off by default, no persistence)    */
/* ------------------------------------------------------------------ */

interface NetworkOpts {
  enabled: boolean
  sshUser: string
}

let networkOpts: NetworkOpts = { enabled: false, sshUser: '' }

export function getNetworkOpts(): NetworkOpts {
  return { ...networkOpts }
}

export function setNetworkOpts(opts: Partial<NetworkOpts>): void {
  networkOpts = { ...networkOpts, ...opts }
}

export interface BatonManagerState {
  status: BatonStatus
  port: number | null
  pid: number | null
  batonRepo: string | null
  error: string | null
  /** Latest progress line (setup output, KB build output, etc.) */
  progress: string
}

export interface BatonProcess {
  child: ChildProcess
  port: number
  pid: number
}

type StatusCallback = (state: BatonManagerState) => void

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let daemonProcess: BatonProcess | null = null
let statusCallback: StatusCallback | null = null
/** Last explicit status pushed. getState() uses it while no daemon is alive so
 *  progress lines during setup don't clobber 'bootstrapping' with 'stopped'. */
let statusOverride: BatonStatus | null = null
export const DEFAULT_PORT = 7077

/* ------------------------------------------------------------------ */
/* Status reporting                                                    */
/* ------------------------------------------------------------------ */

function notifyStatus(state: BatonManagerState): void {
  statusOverride = state.status
  statusCallback?.(state)
}

export function setStatusCallback(cb: StatusCallback | null): void {
  statusCallback = cb
}

export function getState(): BatonManagerState {
  return {
    // Why not just daemonProcess ? 'running' : 'stopped': progress lines fired
    // during setup must not reset the status to 'stopped' mid-pipeline (which
    // looked like the panel "refreshing" and then failing). Prefer the last
    // explicit status, falling back to 'stopped' only when nothing ran.
    status: daemonProcess ? 'running' : (statusOverride ?? 'stopped'),
    port: daemonProcess?.port ?? null,
    pid: daemonProcess?.pid ?? null,
    batonRepo: null,
    error: null,
    progress: ''
  }
}

/* ------------------------------------------------------------------ */
/* Baton repo resolution                                               */
/* ------------------------------------------------------------------ */

/**
 * Locate the Baton-Multi-Agent- repo in order of priority:
 * 1. BATON_REPO env var
 * 2. Sibling directory next to Orca app
 * 3. Sibling directory next to Orca's git root
 */
export async function getBatonRepo(): Promise<string | null> {
  const envRepo = process.env.BATON_REPO
  if (envRepo && existsSync(join(envRepo, 'dist', 'cli.js'))) return envRepo

  // Packaged .exe: Baton bundled as extraResources at resourcesPath/baton
  if (app.isPackaged && process.resourcesPath) {
    const packaged = join(process.resourcesPath, 'baton')
    if (existsSync(join(packaged, 'dist', 'cli.js'))) return packaged
  }

  // Why app.getAppPath() (not a __dirname walk): the main-process bundle is
  // chunked under out/main/chunks, so walking up from __dirname lands in the
  // wrong directory in dev and picks a stale sibling Baton clone. getAppPath()
  // reliably returns the Orca app root.
  const orcaAppPath = app.getAppPath()
  const candidates = [
    join(orcaAppPath, '..', 'Baton-Multi-Agent-'),
    // Absolute fallback for dev layout: C:\Users\lenovo\Desktop\Gagan\Baton-Multi-Agent-
    'C:\\Users\\lenovo\\Desktop\\Gagan\\Baton-Multi-Agent-'
  ]

  for (const candidate of candidates) {
    const cliPath = join(candidate, 'dist', 'cli.js')
    if (existsSync(cliPath)) return candidate
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Bootstrap (first-run: npm install + build)                          */
/* ------------------------------------------------------------------ */

export async function bootstrapBaton(
  batonRepo: string,
  onProgress: (line: string) => void
): Promise<void> {
  const cliPath = join(batonRepo, 'dist', 'cli.js')
  if (existsSync(cliPath)) {
    onProgress('Baton already built — skipping bootstrap')
    return
  }

  // Packaged bundles ship pre-built dist/ — no npm/build needed
  if (app.isPackaged) {
    onProgress('Baton bundled — skipping bootstrap')
    return
  }

  notifyStatus({ status: 'bootstrapping', port: null, pid: null, batonRepo, error: null, progress: 'Installing Baton dependencies...' })
  onProgress('Installing Baton dependencies...')

  // npm install (root)
  await runCommand('npm', ['install', '--no-audit', '--no-fund'], batonRepo, onProgress)

  notifyStatus({ status: 'bootstrapping', port: null, pid: null, batonRepo, error: null, progress: 'Building Baton backend...' })
  onProgress('Building Baton backend...')
  await runCommand('npm', ['run', 'build'], batonRepo, onProgress)

  // Web dashboard install + build
  const webDir = join(batonRepo, 'web')
  if (existsSync(join(webDir, 'package.json'))) {
    onProgress('Installing web dashboard dependencies...')
    await runCommand('npm', ['install', '--no-audit', '--no-fund'], webDir, onProgress)
    onProgress('Building web dashboard...')
    await runCommand('npm', ['run', 'build'], webDir, onProgress)
  }

  if (!existsSync(cliPath)) {
    throw new Error('Baton bootstrap failed — dist/cli.js not found after build')
  }
  onProgress('Baton bootstrap complete')
}

/* ------------------------------------------------------------------ */
/* KB initialization                                                   */
/* ------------------------------------------------------------------ */

export async function initializeKB(
  batonRepo: string,
  projectRoot: string,
  onProgress: (line: string) => void
): Promise<void> {
  // Packaged bundles skip KB init for fast startup — the daemon builds it on-demand
  if (app.isPackaged) {
    onProgress('Baton bundled — skipping KB init')
    return
  }

  notifyStatus({ status: 'initializing-kb', port: null, pid: null, batonRepo, error: null, progress: 'Building knowledge graph...' })
  onProgress('Initializing knowledge base...')

  const cliPath = join(batonRepo, 'dist', 'cli.js')
  // kb init --local: share=false (no git commit), mcp=true, docs=true (agents learn Baton protocols)
  await runCommand(process.execPath, [cliPath, 'kb', 'init', projectRoot, '--local'], projectRoot, onProgress, { ELECTRON_RUN_AS_NODE: '1' })

  onProgress('Knowledge base initialized')
}

/* ------------------------------------------------------------------ */
/* Skills installation                                                 */
/* ------------------------------------------------------------------ */

export async function installSkills(
  batonRepo: string,
  projectRoot: string,
  onProgress: (line: string) => void
): Promise<void> {
  notifyStatus({ status: 'installing-skills', port: null, pid: null, batonRepo, error: null, progress: 'Writing universal skills file...' })
  onProgress('Writing universal skills file...')

  const cliPath = join(batonRepo, 'dist', 'cli.js')

  // Enumerate bundled skill ids from the catalog (there is no bulk install).
  const listOutput = await runCommandCollect(process.execPath, [cliPath, 'skills', 'list'], projectRoot, { ELECTRON_RUN_AS_NODE: '1' })
  const skillIds = [
    ...new Set(Array.from(listOutput.matchAll(/\[bundled\]\s+([A-Za-z0-9._-]+)/g), (m) => m[1]))
  ]

  if (skillIds.length === 0) {
    onProgress('No bundled skills found')
    return
  }

  // Clear per-agent entries Baton's `skills install` may have written on earlier
  // runs (.claude/skills/<id>/, .cursor/rules/<id>.mdc, .agents/skills/<id>/),
  // so only the universal file remains. Surgically — never the whole skill dir,
  // which may hold the user's own skills.
  for (const id of skillIds) {
    for (const p of [
      join(projectRoot, '.claude', 'skills', id),
      join(projectRoot, '.cursor', 'rules', `${id}.mdc`),
      join(projectRoot, '.agents', 'skills', id)
    ]) {
      try { await rm(p, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }

  // Why a single file instead of `skills install <id>` per agent: the CLI only
  // writes to claude/cursor/antigravity skill dirs (.claude/, .cursor/,
  // .agents/) and leaves other agents (Codex, Gemini, aider, opencode, ...)
  // without the playbooks. One root-level BATON_SKILLS.md every agent can read
  // covers all of them with zero per-agent directories.
  const bundledDir = join(batonRepo, 'dist', 'skills', 'bundled')
  let content = `# Baton Skills\n\n`
  content += `Coordination playbooks auto-installed by the Orca Baton integration.\n`
  content += `All coding agents (Claude Code, Codex, Cursor, Copilot, Gemini, aider, opencode, ...) can read this file. Do not edit by hand.\n\n`

  for (const id of skillIds) {
    const skillPath = join(bundledDir, id, 'SKILL.md')
    if (existsSync(skillPath)) {
      // File-backed skill: strip frontmatter, keep the full playbook body.
      const raw = await readFile(skillPath, 'utf-8')
      const body = raw.replace(/^---[\s\S]*?---\s*/, '').trim()
      content += `---\n\n## ${id}\n\n${body}\n\n`
    } else {
      // Inline skill (no SKILL.md on disk) — point at the dashboard playbook.
      content += `---\n\n## ${id}\n\n_Inline playbook — see the Baton dashboard Skills tab for the full definition._\n\n`
    }
  }

  await writeFile(join(projectRoot, 'BATON_SKILLS.md'), content, 'utf-8')
  onProgress(`${skillIds.length} skills written to BATON_SKILLS.md`)

  // Point every agent at it via AGENTS.md (created when missing).
  const agentsMd = join(projectRoot, 'AGENTS.md')
  const ref = `\n## Baton Skills\n\nThis project has Baton coordination playbooks in \`BATON_SKILLS.md\` (auto-generated, do not edit). Read it before starting work.\n`
  const existing = existsSync(agentsMd) ? await readFile(agentsMd, 'utf-8') : ''
  if (!existing.includes('BATON_SKILLS.md')) {
    await appendFile(agentsMd, ref, 'utf-8')
  }
  onProgress('Skills installed')
}

/* ------------------------------------------------------------------ */
/* Daemon start / stop                                                 */
/* ------------------------------------------------------------------ */

/**
 * Kill any process holding `port` that we did not spawn (orphaned Baton
 * daemon left by a force-killed Orca, bypassing the will-quit cleanup).
 */
export function killOrphanedDaemon(port: number = DEFAULT_PORT): void {
  try {
    const lines = execSync(
      `netstat -ano | findstr :${port} | findstr LISTENING`,
      { encoding: 'utf8', windowsHide: true }
    )
    const match = lines.match(/(\d+)\s*$/m)
    if (match) {
      const pid = Number(match[1])
      if (pid > 0 && pid !== process.pid) {
        try { execSync(`taskkill /PID ${pid} /F`, { encoding: 'utf8', windowsHide: true }) } catch { /* already gone */ }
      }
    }
  } catch {
    // No listener on the port — nothing to kill
  }
}

export async function startDaemon(
  batonRepo: string,
  projectRoot: string,
  port: number = DEFAULT_PORT
): Promise<BatonProcess> {
  // Kill existing daemon if running
  if (daemonProcess) {
    await stopDaemon(daemonProcess)
  }

  notifyStatus({ status: 'starting', port, pid: null, batonRepo, error: null, progress: 'Starting Baton daemon...' })

  // ELECTRON_RUN_AS_NODE makes the bundled Electron binary behave as plain Node.js.
  // Without it, a packaged .exe cannot find 'node' on PATH and the daemon fails to start.
  const cliPath = join(batonRepo, 'dist', 'cli.js')
  const child = spawn(process.execPath, [cliPath, 'serve', '--write', '--port', String(port)], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production' },
    detached: false
  })

  const proc: BatonProcess = { child, port, pid: child.pid ?? 0 }
  daemonProcess = proc

  // Log stdout/stderr for debugging
  child.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) console.log(`[baton-daemon] ${line}`)
  })
  child.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) console.error(`[baton-daemon] ${line}`)
  })

  child.on('exit', (code) => {
    console.log(`[baton-daemon] exited with code ${code}`)
    daemonProcess = null
    notifyStatus({ status: 'stopped', port: null, pid: null, batonRepo, error: null, progress: '' })
  })

  child.on('error', (err) => {
    console.error(`[baton-daemon] spawn error:`, err.message)
    daemonProcess = null
    notifyStatus({ status: 'error', port: null, pid: null, batonRepo, error: err.message, progress: '' })
  })

  // Health poll — wait for the daemon to respond
  await healthPoll(port, 30_000)

  notifyStatus({ status: 'running', port, pid: proc.pid, batonRepo, error: null, progress: 'Baton daemon is running' })
  return proc
}

export async function stopDaemon(proc: BatonProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    const { child } = proc
    if (!child || !child.pid) {
      daemonProcess = null
      resolve()
      return
    }

    let resolved = false
    const done = () => {
      if (!resolved) { resolved = true; resolve() }
    }

    child.on('exit', done)
    child.on('error', done)

    // Try SIGTERM first
    try { child.kill('SIGTERM') } catch { /* already dead */ }

    // SIGKILL after 5s if still alive
    setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already dead */ }
      setTimeout(done, 2000)
    }, 5000)
  }).then(() => {
    daemonProcess = null
    statusOverride = 'stopped'
  })
}

export function killDaemonIfRunning(): void {
  if (daemonProcess) {
    try { daemonProcess.child.kill('SIGTERM') } catch { /* ignore */ }
    daemonProcess = null
  }
  statusOverride = 'stopped'
}

/* ------------------------------------------------------------------ */
/* Port finding                                                        */
/* ------------------------------------------------------------------ */

async function findAvailablePort(start: number): Promise<number> {
  // Simple probe — try to create a server on the port
  const { createServer } = await import('node:net')
  return new Promise((resolve) => {
    const s = createServer()
    s.once('error', () => resolve(findAvailablePort(start + 1)))
    s.once('listening', () => { s.close(() => resolve(start)) })
    s.listen(start, '127.0.0.1')
  })
}

export { findAvailablePort }

/* ------------------------------------------------------------------ */
/* Health poll                                                         */
/* ------------------------------------------------------------------ */

async function healthPoll(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/meta`, {
        signal: AbortSignal.timeout(3000)
      })
      if (res.ok) return
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`Baton daemon did not respond within ${timeoutMs}ms on port ${port}`)
}

/* ------------------------------------------------------------------ */
/* Command runner                                                      */
/* ------------------------------------------------------------------ */

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  onProgress: (line: string) => void,
  env?: Record<string, string>
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', ...env }
    })

    child.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) onProgress(line)
    })
    child.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) onProgress(line)
    })

    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

/** Like runCommand but captures stdout/stderr and returns it (for parsing, not progress). */
function runCommandCollect(
  cmd: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', ...env }
    })

    let out = ''
    const onData = (data: Buffer) => { out += data.toString() }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    child.on('exit', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

/* ------------------------------------------------------------------ */
/* One-shot steps: plan apply / review save / merge (run once)         */
/* ------------------------------------------------------------------ */

export async function applyPlanIfPresent(
  batonRepo: string,
  projectRoot: string,
  onProgress: (line: string) => void
): Promise<void> {
  if (app.isPackaged) return // skip in packaged mode
  const marker = await loadStartupMarker(projectRoot)
  if (marker.planAppliedAt) { onProgress('Plan already applied — skipping'); return }

  notifyStatus({ status: 'applying-plan', port: null, pid: null, batonRepo, error: null, progress: 'Checking for plan files...' })

  const plansDir = join(projectRoot, 'baton', 'plans')
  const cliPath = join(batonRepo, 'dist', 'cli.js')

  try {
    // list plan files (.md only, skip README.md)
    const entries = await import('node:fs/promises').then(fs => fs.readdir(plansDir).catch(() => [] as string[]))
    const plans = entries.filter(f => f.endsWith('.md') && !f.toLowerCase().includes('readme'))

    if (plans.length === 0) { onProgress('No plan files found — skipping plan apply'); return }

    for (const plan of plans) {
      onProgress(`Applying plan: ${plan}`)
      await runCommand(process.execPath, [cliPath, 'plan', 'apply', join(plansDir, plan)], projectRoot, onProgress, { ELECTRON_RUN_AS_NODE: '1' })
    }
    await saveStartupMarker(projectRoot, { planAppliedAt: new Date().toISOString() })
    onProgress(`${plans.length} plan(s) applied`)
  } catch {
    onProgress('Plan apply failed or unavailable — continuing')
  }
}

export async function saveReviewIfPresent(
  batonRepo: string,
  projectRoot: string,
  onProgress: (line: string) => void
): Promise<void> {
  if (app.isPackaged) return
  const marker = await loadStartupMarker(projectRoot)
  if (marker.reviewSavedAt) { onProgress('Review already saved — skipping'); return }

  notifyStatus({ status: 'saving-review', port: null, pid: null, batonRepo, error: null, progress: 'Checking for review findings...' })

  const reviewsDir = join(projectRoot, 'baton', 'reviews')
  const cliPath = join(batonRepo, 'dist', 'cli.js')

  try {
    const entries = await import('node:fs/promises').then(fs => fs.readdir(reviewsDir).catch(() => [] as string[]))
    const findings = entries.filter(f => f.endsWith('.json'))

    if (findings.length === 0) { onProgress('No review findings — skipping review save'); return }

    for (const file of findings) {
      const slug = file.replace('.json', '')
      const filePath = join(reviewsDir, file)
      onProgress(`Saving review: ${slug}`)
      // runCommand pipes findings JSON via stdin: baton review save <slug> < <file>
      await runCommandWithStdin(cliPath, ['review', 'save', slug], filePath, projectRoot, onProgress, { ELECTRON_RUN_AS_NODE: '1' })
    }
    await saveStartupMarker(projectRoot, { reviewSavedAt: new Date().toISOString() })
    onProgress(`${findings.length} review(s) saved`)
  } catch {
    onProgress('Review save failed or unavailable — continuing')
  }
}

/** Like runCommand but pipes a file into the child's stdin. */
async function runCommandWithStdin(
  cmd: string,
  args: string[],
  stdinFile: string,
  cwd: string,
  onProgress: (line: string) => void,
  env?: Record<string, string>
): Promise<void> {
  const input = await readFile(stdinFile, 'utf-8').catch(() => '')
  if (!input) { onProgress(`No input for ${stdinFile} — skipping`); return }

  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', ...env }
    })

    child.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) onProgress(line)
    })
    child.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) onProgress(line)
    })

    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited with code ${code}`))
    })
    child.on('error', reject)

    child.stdin?.write(input)
    child.stdin?.end()
  })
}

export async function mergeSettingsTask(
  batonRepo: string,
  projectRoot: string,
  onProgress: (line: string) => void
): Promise<void> {
  if (app.isPackaged) return
  const marker = await loadStartupMarker(projectRoot)
  if (marker.mergedAt) { onProgress('Already merged — skipping'); return }

  notifyStatus({ status: 'merging', port: null, pid: null, batonRepo, error: null, progress: 'Checking merge: settings-dark-mode...' })

  const cliPath = join(batonRepo, 'dist', 'cli.js')
  const SLUG = 'settings-dark-mode'

  try {
    // Check if the task exists by reading the task list
    const listOut = await runCommandCollect(process.execPath, [cliPath, 'ls', '--json'], projectRoot, { ELECTRON_RUN_AS_NODE: '1' })
    const tasks = JSON.parse(listOut || '[]')
    const exists = Array.isArray(tasks) && tasks.some((t: { slug?: string }) => t.slug === SLUG)

    if (!exists) {
      onProgress(`No '${SLUG}' task found — skipping merge`)
      return
    }

    onProgress(`Merging task: ${SLUG}`)
    await runCommand(process.execPath, [cliPath, 'merge', SLUG], projectRoot, onProgress, { ELECTRON_RUN_AS_NODE: '1' })
    await saveStartupMarker(projectRoot, { mergedAt: new Date().toISOString() })
    onProgress(`Merged: ${SLUG}`)
  } catch {
    onProgress('Merge skipped (task not found or merge failed) — continuing')
  }
}

/* ------------------------------------------------------------------ */
/* Network ops: tailscale + SSH tunnel (fire-and-forget)               */
/* ------------------------------------------------------------------ */

export async function startTailscale(
  onProgress: (line: string) => void
): Promise<void> {
  notifyStatus({ status: 'starting-network', port: null, pid: null, batonRepo: null, error: null, progress: 'Starting Tailscale...' })

  try {
    await runCommand('tailscale', ['up'], process.cwd(), onProgress)
    onProgress('Tailscale connected')
  } catch {
    onProgress('Tailscale start failed or not installed — continuing')
  }
}

export async function startSshTunnel(
  user: string,
  onProgress: (line: string) => void
): Promise<void> {
  notifyStatus({ status: 'starting-network', port: null, pid: null, batonRepo: null, error: null, progress: `Starting SSH tunnel to ${user}@192.168.1.7...` })

  if (!user) {
    onProgress('No SSH username configured — skipping tunnel')
    return
  }

  try {
    // Fire-and-forget: ssh -N hangs forever (it's a tunnel, no shell)
    spawn('ssh', ['-N', '-L', '7077:localhost:7077', `${user}@192.168.1.7`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env }
    })
    onProgress(`SSH tunnel started → ${user}@192.168.1.7:7077`)
  } catch {
    onProgress('SSH tunnel failed — continuing')
  }
}
