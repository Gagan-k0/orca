# Knowledge Base — Orca IDE + Baton Integration

> Comprehensive reference of everything built, why, and how it works.
> Auto-generated from the integration work done through 2026-08-09.

---

## 1. Project Overview

**Goal**: Integrate [Baton](https://github.com/Rakshan001/Baton-Multi-Agent-)'s multi-agent coordination features into [Orca IDE](https://github.com/stablyai/orca) via a single "Start Baton" button — zero external terminal steps.

**What Orca is**: An Electron desktop IDE that runs multiple CLI coding agents (Claude Code, Codex, Gemini, Cursor, etc.) side-by-side, each in its own git worktree. ~35 agents supported. Built with Electron 43 + React 19 + TypeScript + Zustand.

**What Baton is**: A zero-dependency Node.js coordination hub + knowledge base for multi-agent coding. Provides knowledge graph (graphify), SSE-based realtime dashboard, edit-signal coordination, session handoff, memory, skills, and code review.

**Key design decision**: Rather than reimplementing Baton's features inside Orca, we **embed the real Baton daemon + dashboard via iframe**. This means zero hallucination risk — all Baton features work exactly as they do standalone.

---

## 2. Architecture

```
Orca Main Process (Electron)
┌─────────────────────────────────────────────────────────┐
│  baton-manager.ts                                       │
│  - Locates Baton repo (BATON_REPO env → sibling dirs)  │
│  - First-run: npm install + build (one-time)            │
│  - KB init on current project                           │
│  - Writes universal BATON_SKILLS.md at project root     │
│  - Spawns: node dist/cli.js serve --write --port 7077   │
│  - Health-polls /api/meta until 200                      │
│  - Kills daemon on app quit                             │
│                                                         │
│  baton-ipc.ts                                           │
│  - baton:start → retry-wrapped full setup pipeline      │
│  - baton:stop  → kill daemon                            │
│  - baton:status → state query (statusOverride aware)    │
│  - baton:onStatusChange → push events to renderer       │
└────────────────────┬────────────────────────────────────┘
                     │ child_process.spawn()
                     ▼
Baton Daemon (127.0.0.1:7077)
┌─────────────────────────────────────────────────────────┐
│  /api/kb, /api/kb/graph, /api/memory, /api/skills      │
│  /api/events (SSE), /api/status, /api/signals ...       │
│  Full React SPA dashboard served at /                   │
│  Node.js HTTP server — zero dependencies                │
└─────────────────────────────────────────────────────────┘
                     ▲
                     │ http://127.0.0.1:7077 (iframe)
                     │
Orca Renderer (React)
┌─────────────────────────────────────────────────────────┐
│  BatonPanel.tsx                                         │
│  [Start Baton] ←→ [● Running :7077] [Stop]              │
│  <iframe src="http://127.0.0.1:7077">                   │
│  Full dashboard: KG, Memory, Skills, Signals, Reviews  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Files Created / Modified

### New files (all in `orca/src/`)

| File | Purpose |
|------|---------|
| `main/baton/baton-manager.ts` | Core lifecycle: locate Baton repo, bootstrap (npm install + build), KB init, write universal `BATON_SKILLS.md`, spawn/kill daemon, health poll, orphan kill (`killOrphanedDaemon`), status tracking (`statusOverride`) |
| `main/baton/baton-ipc.ts` | IPC handler registration: `baton:start` (retry-wrapped orchestration), `baton:stop`, `baton:status`, push `baton:onStatusChange` events |
| `renderer/src/store/baton-store.ts` | Zustand standalone store: listens to `baton:onStatusChange` push, exposes `startBaton` / `stopBaton` / `refreshStatus` |
| `renderer/src/components/right-sidebar/BatonPanel.tsx` | UI panel: Start button → progress spinner (streams setup output) → iframe dashboard → Stop bar; error + retry |

### Modified files

| File | Change |
|------|--------|
| `main/ipc/register-core-handlers.ts` | Imports + calls `registerBatonHandlers()` |
| `main/index.ts` | `killDaemonIfRunning()` in `app.on('will-quit')` to free port 7077 |
| `preload/index.ts` | `window.api.baton` bridge: `start()`, `stop()`, `status()`, `onStatusChange()` |
| `preload/api-types.ts` | `PreloadApi.baton` type definition |
| `shared/types.ts` | `'baton'` added to `RightSidebarTab` union |
| `renderer/src/store/right-sidebar-route.ts` | `'baton'` in `normalizeRightSidebarRoute()` |
| `renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx` | Renders `BatonPanel` for `'baton'` tab |
| `renderer/src/components/right-sidebar/index.tsx` | Baton icon in activity bar items |
| `main/runtime/rpc/methods/client-ui-schemas.ts` | `'baton'` added to `STATIC_RIGHT_SIDEBAR_TABS` array |

---

## 4. Setup Pipeline (what "Start Baton" does)

When the user clicks **Start Baton**, this runs in the main process (with retry — max2 attempts):

```
Attempt 1:
  1. killOrphanedDaemon(7077)         — netstat + taskkill any process on port
  2. getBatonRepo()                    — resolve Baton repo path
  3. bootstrapBaton()                  — skip if dist/cli.js exists; else npm install + build
  4. initializeKB()                    — node dist/cli.js setup <project> --yes --local --no-mcp --no-docs
  5. installSkills()                   — write universal BATON_SKILLS.md (see §5)
  6. findAvailablePort(7077)           — probe for free port (fallback: 7078, 7079...)
  7. startDaemon()                     — spawn serve --write --port <port>
  8. healthPoll()                      — GET /api/meta every 500ms, 30s timeout

If step 7-8 fails → retry from step 1 (attempt 2).
```

Each step pushes progress to the renderer via `baton:onStatusChange`. The `statusOverride` variable ensures progress lines don't reset the pipeline status to `'stopped'`.

---

## 5. Universal Skills File (`BATON_SKILLS.md`)

### Problem
Baton's `skills install <id>` only writes to 3 agent-specific directories:
- Claude → `.claude/skills/<id>/SKILL.md`
- Cursor → `.cursor/rules/<id>.mdc`
- Antigravity → `.agents/skills/<id>/SKILL.md`

Other agents (Codex, Gemini, aider, opencode, Copilot...) get nothing.

### Solution
A single root-level `BATON_SKILLS.md` (~142 KB) containing all12 bundled playbooks, readable by every coding agent.

### What's written
```
<project>/
  BATON_SKILLS.md          ← ONE file, all12 skills
  AGENTS.md                ← pointer appended: "see BATON_SKILLS.md"
```

### Contents
- **10 file-backed skills**: full playbook from `dist/skills/bundled/<id>/SKILL.md` (frontmatter stripped)
- **2 inline skills** (map-codebase, safe-refactor): stub pointing to Baton dashboard

### Cleanup
Old per-agent entries (`<project>/.claude/skills/<id>/`, `<project>/.cursor/rules/<id>.mdc`, `<project>/.agents/skills/<id>/`) are surgically removed using `rm(path, { recursive: true, force: true })` for each bundled skill ID.

---

## 6. Bugs Found & Fixed

### Bug 1: Wrong Baton repo path
**Symptom**: `getBatonRepo()` picked a stale July clone at `Desktop\Baton-Multi-Agent-` instead of the working one at `Desktop\Gagan\Baton-Multi-Agent-`.

**Root cause**: Old code used `resolve(__dirname, '..', '..', '..')` which from the chunked `out/main/chunks/` build lands in the wrong parent directory. The candidate path then resolved to the wrong sibling.

**Fix**: Changed to `app.getAppPath()` which reliably returns the orca project root in dev + packaged. Second candidate is the hardcoded absolute path as fallback.

### Bug 2: `skills install --all` CLI syntax error
**Symptom**: `node dist/cli.js skills install --all` exits with code 1 ("missing required argument 'id'").

**Root cause**: Baton's `skills install` takes ONE `<id>`. The `--all` flag means "into every agent" (already the default). No bulk install-all exists.

**Fix**: Enumerate bundled skill IDs via `skills list` output (regex: `/\[bundled\]\s+([A-Za-z0-9._-]+)/g`), then install each individually. Later replaced entirely with the universal file approach.

### Bug 3: "Auto-refresh then shows setup failed"
**Symptom**: Panel sometimes refreshes automatically mid-setup and then displays "Setup failed".

**Root cause**: `onProgress` in `baton-ipc.ts` called `getState()`, which inferred status solely from `daemonProcess` (`daemonProcess ? 'running' : 'stopped'`). During setup `daemonProcess` is null, so the first progress line clobbered the pipeline status (`bootstrapping`/`initializing-kb`) back to `'stopped'`. When the panel remounted (sidebar tab switch), `refreshStatus()` queried `getState()` → got `'stopped'` → showed the Start button again, then the eventual failure landed as "Setup failed".

**Fix**: Added `statusOverride` variable in `baton-manager.ts`. `notifyStatus()` stores the last explicit status. `getState()` uses `statusOverride` when no daemon is alive. Overrides are reset to `'stopped'` in `stopDaemon()` and `killDaemonIfRunning()`.

### Bug 4: Orphaned daemon on port 7077
**Symptom**: After force-killing Orca (bypassing `will-quit` cleanup), the Baton daemon lingers on port 7077. Next Start Baton fails because the port is already held.

**Fix**: Added `killOrphanedDaemon(port)` — runs `netstat -ano | findstr :<port> | findstr LISTENING` → `taskkill /PID <pid> /F`. Called before each setup attempt. Windows-specific (fine — target platform).

### Bug 5: Intermittent setup failures
**Symptom**: First-run setup occasionally fails due to file locks during npm install, port contention, or transient issues.

**Fix**: `handleStartBaton` now retries the full pipeline once (`MAX_ATTEMPTS = 2`). Each attempt first calls `killOrphanedDaemon()` to ensure the port is free.

---

## 7. Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Embed real Baton daemon via iframe | Zero reimplemented features; all Baton features work as-is; small integration surface |
| Universal `BATON_SKILLS.md` instead of per-agent dirs | Covers all agents (not just claude/cursor/antigravity); one file to maintain |
| `statusOverride` for pipeline status | Prevents progress lines from resetting the pipeline status to 'stopped' mid-setup |
| Retry loop with orphan cleanup | Handles intermittent Windows file locks and port contention |
| `app.getAppPath()` for repo resolution | Reliable in dev + packaged; avoids `__dirname` walk issues with chunked builds |
| Port fallback via `findAvailablePort()` | Handles port 7077 already in use by another process |
| Surgical per-agent cleanup | Only removes Baton-installed entries, never the user's own skills |
| `will-quit` handler for daemon cleanup | Ensures port 7077 is freed when Orca closes normally |

---

## 8. How to Test

### Quick verification
1. Open Orca → right sidebar → Baton tab
2. Click **Start Baton**
3. Watch stages: bootstrapping → KB init → writing skills file → starting daemon
4. Dashboard loads in iframe at `http://127.0.0.1:<port>`
5. Verify `BATON_SKILLS.md` exists at project root (~142 KB)
6. Verify `AGENTS.md` has "Baton Skills" section appended
7. Verify no `.claude/`, `.cursor/`, `.agents/` directories were created
8. Click **Stop** → daemon killed, iframe gone

### Stress test
- Force-kill Orca while Baton is running → restart → orphaned daemon should be cleaned up automatically
- Run Start Baton twice → should work (idempotent — KB init skips if already done, skills file is overwritten)

---

## 9. Known Caveats

| Caveat | Detail |
|--------|--------|
| Port 7077 orphaned on force-kill | `killOrphanedDaemon()` handles this on next start, but the daemon lingers until then |
| `pnpm dev` needs bypass on Windows | `ensure-native-runtime.mjs` tries to rebuild `windows-native-registry` (needs Visual Studio). Bypass: `node config/scripts/run-electron-vite-dev.mjs` directly |
| electron-vite5 main-process hot-reload | Main process changes don't auto-recompile in dev; must restart the dev server |
| `BATON_SKILLS.md` is ~142 KB | Large but acceptable; agents search by section, not read entirely |
| `killOrphanedDaemon` is Windows-only | Uses `netstat` + `taskkill`; would need `lsof` + `kill` on macOS/Linux |
| Inline skills (map-codebase, safe-refactor) | Only have a stub in `BATON_SKILLS.md`; full playbooks available in Baton dashboard |
| Orca remote is upstream | Can't push orca changes to GitHub; committed locally only. Code-editor repo tracks progress. |

---

## 10. Baton Features Available

Because the iframe embeds the **real Baton dashboard**, all these features work immediately:

| Feature | Description |
|---------|-------------|
| **Knowledge Graph** | Codebase intelligence — agents navigate a graph instead of grepping. `CODEBASE.md` at project root. |
| **Memory** | Evidence-anchored shared facts pinned to commits/file hashes; stale on change. |
| **Skills** | Reusable agent playbooks. Now written to `BATON_SKILLS.md` (universal file). |
| **Code Review** | Three-axis review (Standards/Spec/Security) with refute-before-report. |
| **Edit Signals** | Live "who's editing what" coordination across worktrees. |
| **Bug Recurrence** | `baton bugs "<symptom>"` checks if a bug was fixed before and re-broken. |
| **Context Pack** | Token-cheap brief export for external chatbots. |
| **KB Export** | Download/share knowledge packs; committed `kb/` for teammates. |

---

## 11. Source Repos

| Repo | Location | Remote |
|------|----------|--------|
| Orca IDE | `C:\Users\lenovo\Desktop\Gagan\orca` | `stablyai/orca` (upstream, no push) |
| Baton | `C:\Users\lenovo\Desktop\Gagan\Baton-Multi-Agent-` | `Rakshan001/Baton-Multi-Agent-` |
| Code-editor (tracking) | `C:\Users\lenovo\Desktop\Gagan\Code-editor` | `Gagan-k0/Code-editor.git` (pushable) |

---

*Last updated: 2026-08-09*
