# OpenHuman vs Orca IDE — Feature Comparison

> Side-by-side comparison of [OpenHuman](https://github.com/tinyhumansai/openhuman) (36k+ stars, GPL-3.0) and [Orca IDE](https://github.com/stablyai/orca) (MIT) as of August 2026.

---

## At a Glance

| | **OpenHuman** | **Orca IDE** |
|---|---|---|
| **What it is** | Personal AI super intelligence — memory, orchestration, research, meetings, media, messaging | AI coding orchestrator — runs multiple CLI coding agents side-by-side in isolated worktrees |
| **Primary audience** | Power users wanting a personal AI assistant (coding + life + research) | Developers who want to orchestrate multiple coding agents on one codebase |
| **Tech stack** | Rust (Tauri) + web frontend | Electron (TypeScript) + React |
| **License** | GPL-3.0 | MIT |
| **GitHub stars** | ~36,100 | Growing (stablyai/orca) |
| **Status** | Early beta | v1.4.177-rc.0, ships daily |
| **Memory** | SQLite + Markdown tree + Obsidian vault mirror | None natively (now has Baton's memory via integration) |

---

## Feature Comparison

### Memory & Knowledge

| Feature | OpenHuman | Orca |
|---------|-----------|------|
| Persistent memory | ✅ Memory Tree (scored Markdown in SQLite + Obsidian vault) | ❌ None natively |
| Evidence-anchored facts | ❌ | ✅ Via Baton integration |
| Knowledge graph | ✅ Implicit via memory tree | ✅ Via Baton graphify integration |
| Auto-fetch / background sync | ✅ 20-min loop | ❌ |
| Obsidian vault mirroring | ✅ Direct edit support | ❌ |
| Token compression | ✅ TokenJuice (80% reduction) | ❌ |
| Cross-session memory | ✅ Built-in | ✅ Via Baton memory module |
| Context export for chatbots | ❌ | ✅ Via Baton Context Pack |

### Agent Orchestration

| Feature | OpenHuman | Orca |
|---------|-----------|------|
| Multi-agent support | ✅ Agent fleet with delegation | ✅ 35+ agents side-by-side |
| Agent execution model | ✅ Graph-based with checkpoints, pause/resume | ✅ Each agent in isolated git worktree |
| Agent-to-agent communication | ✅ Signal-protocol E2E encrypted | ❌ (Baton handoff not selected) |
| Visual workflow builder | ✅ tinyflows (n8n/Zapier inspired) | ❌ |
| Worktree isolation | ❌ | ✅ Core architecture — each agent gets its own git worktree |
| Agent variety | Orchestrates Claude Code, Codex, OpenClaw, Hermes | 35+ agents: Claude, Codex, Gemini, Cursor, Copilot, Grok, Qwen, etc. |
| Agent routing by task type | ❌ | ❌ (Baton routing not selected) |
| Replayable run journals | ✅ Per-call cost data | ❌ |

### Coding-Specific

| Feature | OpenHuman | Orca |
|---------|-----------|------|
| Built-in code editor | ✅ Coder toolset | ✅ Monaco editor + xterm |
| Worktree-per-agent | ❌ | ✅ Core differentiator |
| Skills / playbooks | ✅ 90,000+ community skills | ✅ Via Baton's 12 bundled skills |
| Code review | ❌ | ✅ Via Baton (3-axis: Standards/Spec/Security) |
| Edit signals / conflict detection | ❌ | ✅ Via Baton edit signals |
| Bug recurrence check | ❌ | ✅ Via Baton bugs module |
| KB export / knowledge packs | ❌ | ✅ Via Baton KB export |

### Communication & Integration

| Feature | OpenHuman | Orca |
|---------|-----------|------|
| Messaging channels | ✅ 17 (Telegram, Discord, Slack, WhatsApp, Signal, iMessage, email) | ❌ |
| OAuth integrations | ✅ 100+ (Gmail, Notion, GitHub, Slack...) | ❌ |
| MCP servers | ✅ 5,000+ | Partial (via agent CLIs) |
| Meeting agents | ✅ Auto-join Meet/Zoom/Teams/Webex with transcription | ❌ |
| Image/video generation | ✅ Seedream/SeedEdit/Veo | ❌ |
| Voice input | ✅ In-process Whisper | ❌ |

### Privacy & Security

| Feature | OpenHuman | Orca |
|---------|-----------|------|
| On-device storage | ✅ Encrypted, OS keyring | ✅ Local Electron app |
| Privacy mode | ✅ One-switch, Rust-enforced | ❌ |
| Approval gates | ✅ Before external actions | ✅ (Orca user approval system) |
| Sandboxing | ✅ Opt-in | ✅ Agent isolation via worktrees |

### UI & UX

| Feature | OpenHuman | Orca |
|---------|-----------|------|
| Desktop app | ✅ Tauri (Rust) | ✅ Electron |
| Terminal integration | Via coder toolset | ✅ Full xterm.js terminal per agent |
| Theme system | ✅ 5 families + visual editor | ✅ Design tokens (Tailwind) |
| Mascot / personality | ✅ "The Tet" speaks and reacts | ❌ |
| Mobile companion | ❌ | ✅ Expo React Native (iOS/Android) |
| Relay / remote access | ❌ | ✅ Built-in relay service |

---

## Architecture Comparison

```
OpenHuman                          Orca IDE
─────────────                      ────────
┌──────────────────┐               ┌──────────────────┐
│  Tauri (Rust)    │               │  Electron (TS)   │
│  ┌─────────────┐ │               │  ┌─────────────┐ │
│  │ Memory Tree │ │               │  │ Agent Mgmt  │ │
│  │ (SQLite+MD) │ │               │  │ (35+ agents)│ │
│  ├─────────────┤ │               │  ├─────────────┤ │
│  │ Subconscious│ │               │  │ Worktrees   │ │
│  │ (background)│ │               │  │ (git isolat)│ │
│  ├─────────────┤ │               │  ├─────────────┤ │
│  │ tinyagents  │ │               │  │ Baton daemon│ │
│  │ (graph exec)│ │               │  │ (KG/Memory/ │ │
│  ├─────────────┤ │               │  │  Skills/etc)│ │
│  │ tinyflows   │ │               │  ├─────────────┤ │
│  │ (workflows) │ │               │  │ Monaco +    │ │
│  ├─────────────┤ │               │  │ xterm       │ │
│  │ Integrations│ │               │  │ (editor+term)│ │
│  │ (100+ OAuth)│ │               │  └─────────────┘ │
│  └─────────────┘ │               └──────────────────┘
└──────────────────┘
```

---

## Key Philosophical Differences

| Dimension | OpenHuman | Orca |
|-----------|-----------|------|
| **Scope** | Everything (coding + life + research + meetings + media) | Coding only, but deeply |
| **Agent model** | Agents as workers in a fleet, delegated by orchestrator | Agents as peers, each in their own worktree, user picks which to use |
| **Memory philosophy** | Central memory tree with Obsidian mirror — one brain | Project-scoped knowledge base (Baton) — per-repo intelligence |
| **Isolation** | Process-level (sandboxing) | Git-level (worktrees) — each agent can edit independently |
| **Build** | Rust (Tauri) — native performance, smaller binary | Electron — faster iteration, larger binary, richer terminal |
| **Community** | 90k+ skills marketplace, 5k+ MCP servers | 35+ integrated agent CLIs |

---

## When to Use Which

**Choose OpenHuman if:**
- You want a personal AI assistant (not just coding)
- You need memory that persists across all tasks (coding + research + life)
- You want integrated messaging (Telegram, Slack, WhatsApp)
- You need meeting automation (auto-join Zoom/Meet with transcription)
- You want image/video generation built in
- You prefer Rust-native performance

**Choose Orca if:**
- You want to run multiple coding agents on the same codebase
- Git worktree isolation is important (each agent edits independently)
- You need a full terminal + Monaco editor experience
- You want to orchestrate 35+ different CLI agents (Claude, Codex, Gemini, etc.)
- You need mobile companion support
- You want MIT licensing

**Both together (what we built):**
- Orca IDE as the coding environment
- Baton integration for knowledge graph, memory, skills, code review, edit signals
- This gives Orca the persistent memory and knowledge intelligence it lacked

---

*Comparison based on OpenHuman's public README and Orca's source code as of August 2026.*
