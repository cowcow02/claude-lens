# Claude Lens

**Local-only, open-source dashboard for [Claude Code](https://claude.com/claude-code) sessions.**

Read your `~/.claude/projects/*.jsonl` transcripts and visualize everything — activity heatmaps, per-project stats, parallel runs, PR shipping metrics, and a beautiful session transcript view modeled on Claude's own managed-agents UI.

Nothing leaves your machine.

## Why another one?

There are [several](https://github.com/ryoppippi/ccusage) [excellent](https://github.com/chiphuyen/sniffly) [Claude Code](https://github.com/FlorianBruniaux/ccboard) [dashboards](https://github.com/d-kimuson/claude-code-viewer) already — `ccusage` (CLI), `sniffly` (error taxonomy), `ccboard` (feature-dense TUI+web), `claude-code-viewer` (PWA). This one focuses on two things they don't do well:

1. **Parallel agent run detection.** No existing tool robustly detects when you had 2+ Claude Code sessions running simultaneously (against worktrees, multi-agent fleets, etc.). We compute this via sweep-line over session intervals and surface peaks + contiguous windows.
2. **Per-session PR shipping attribution.** Claude Code's OTEL emits a `pull_request.count` metric, but nobody links individual sessions to the PR that resulted from them. We scan Bash tool calls for `gh pr create`, pull the `--title`, and plot PRs against session position — so you can measure *"how early in the session did Claude ship the PR?"* as a proxy for how well your harness is tuned.

Plus: a full transcript UI modeled on Claude's managed-agents view (mini-map timeline, turn collapsing, pretty tool cards), because nobody else makes reading a session a pleasant experience.

## What you get

### Dashboard

- **GitHub-style contribution heatmap** — every day you coded with Claude, colored by activity
- **Daily activity chart** — switch between sessions, tool calls, turns, and token breakdowns
- **High-level metrics** — sessions, air-time, tool calls, token usage, avg turns, parallel peaks
- **Parallel run detection** — see when you had multiple Claude Code sessions running at once
- **Top projects** and **recent sessions** at a glance

### Per-project view

- Everything above, but scoped to a single project
- **PR shipping metrics** — detected from `gh pr create` tool calls, with timeline positioning (how early in the session did Claude ship the PR?)
- Full session list for that project

### Session list

- Cards showing first user prompt + last agent conclusion
- Filter by project, sort by newest / longest / most-tokens

### Session detail

Modeled on Claude's managed-agents Sessions view:

- **Mini-map timeline** — adaptive, selectable, scroll-tracked
- **Turns mode** — collapses agent work between user inputs into compact "turn" cards with first message, middle steps, and heuristic-selected conclusion
- **Pretty tool cards** — diff view for Edit, file path + content for Write, command block for Bash, compact summaries for Grep/Glob/Skill/TodoWrite/MCP tools
- **Markdown rendering** for agent messages via `react-markdown` + `remark-gfm`
- **Token chips** with fresh-input / cached breakdown tooltips
- **Sliding drawer** for per-row details

## Quickstart

**One-liner** (checks Node/pnpm, clones, installs, opens browser):

```bash
curl -fsSL https://raw.githubusercontent.com/cowcow02/claude-lens/master/install.sh | bash
```

**Or manually** (requires [pnpm](https://pnpm.io) and Node 20+):

```bash
git clone https://github.com/cowcow02/claude-lens.git
cd claude-lens && pnpm install && pnpm dev
# → http://localhost:3321
```

That's it. The app reads `~/.claude/projects/*.jsonl` directly — no database, no auth, no cloud.

## Architecture

This is a small pnpm/turbo monorepo:

```
claude-lens/
├── packages/
│   └── parser/        # @claude-lens/parser — pure JSONL parser + analytics
└── apps/
    └── web/           # Next.js 16 + React 19 + Tailwind v4 dashboard
```

### The parser package

[`@claude-lens/parser`](./packages/parser/README.md) is a standalone npm package (not yet published) that turns raw Claude Code JSONL lines into:

- **Structured events** (`SessionEvent[]`) with roles, timestamps, offsets, token usage
- **Presentation rows** (`PresentationRow[]`) — noise filtered, tool calls merged, task notifications parsed
- **Mega rows** (`MegaRow[]`) — collapsing agent loops into "turns" between user inputs
- **Analytics** — daily buckets, parallel-run detection, PR detection, high-level metrics, project rollups

It's pure (no fs, no network), so you can use it in any JS runtime. A filesystem subpath at `@claude-lens/parser/fs` scans `~/.claude/projects` in Node.

### The viewer app

`apps/web` is a standard Next.js 16 App Router app. It reads sessions on the server (RSC) and passes them to small client components for interactivity (heatmap hovers, chart metric switching, sidebar pinning). No database, no API server.

## Features

### Smart parsing

- **Token dedup** — Claude Code splits one API response into multiple JSONL lines, each carrying identical `usage`. The parser sums once per `message.id` so totals aren't doubled.
- **Out-of-order timestamps** — Attachments can flush after their triggering event with earlier timestamps. Session bounds use `min(ts)`, not `first(ts)`.
- **Task-notification codas** — Background `gh pr create` replies like "Acknowledged" are skipped when picking a turn's "conclusion" message.
- **Slash-command prettification** — `<command-name>/implement</command-name><command-args>AGE-9</command-args>` renders as `/implement AGE-9`.
- **Skill-injection hiding** — Skill docs auto-injected as user blocks are filtered out.

### Parallel run detection

Sweep-line algorithm over session `[start, end]` intervals finds peaks and contiguous parallel regions. Useful if you run multiple Claude sessions (git worktrees, multi-agent fleets, etc.).

### PR shipping metrics

Scans Bash tool calls for `gh pr create`, extracts titles from `--title "..."`, and plots them against session duration — so you can measure "on average, how early does Claude ship the PR?" as a proxy for how well your harness is tuned.

### Air-time

Not "wall-clock duration" — the summed event-to-event gap under an idle threshold (default 3min), approximating how long the agent was actually moving vs. waiting for user input.

### Pinned projects

Projects you pin (star-button in the sidebar) get promoted to a "Pinned" section at the top. Persisted in `localStorage` — no server state.

## Configuration

Zero config by default. The scanner reads `~/.claude/projects` via `DEFAULT_ROOT` in `@claude-lens/parser/fs`; if your setup is different, fork and override.

## Development

```bash
pnpm install
pnpm dev                      # start the web app (port 3321)
pnpm -F @claude-lens/parser test        # run parser tests
pnpm typecheck                # typecheck everything
pnpm build                    # build the web app + parser
```

## Privacy

Everything runs on `localhost:3321` against your local filesystem. Nothing is sent anywhere. Session transcripts never leave your machine.

## Roadmap

Informed by a scan of the Claude Code dashboard ecosystem ([ccusage](https://github.com/ryoppippi/ccusage), [sniffly](https://github.com/chiphuyen/sniffly), [ccboard](https://github.com/FlorianBruniaux/ccboard), [claude-code-viewer](https://github.com/d-kimuson/claude-code-viewer), [codedash](https://github.com/vakovalskii/codedash), [tokscale](https://github.com/junhoyeo/tokscale), [claude-code-otel](https://github.com/ColeMurray/claude-code-otel)):

**Unique differentiators to lean into**
- [x] Parallel agent run detection (sweep-line over session intervals)
- [x] Per-session PR shipping attribution with "position in session" metric
- [ ] Cross-repo organization rollup (monorepo + related packages + infra as one unit)
- [ ] Friction analytics: which slash commands fail most, where you interrupt Claude, which tool calls retry most

**Ecosystem-proven features worth stealing**
- [ ] Token cost estimation using LiteLLM pricing data (Opus vs Sonnet vs Haiku, cache-write 1.25x/2x, cache-read 0.1x) — *borrowed from ccusage, tokscale*
- [ ] Error-type classification (content-not-found, tool failure, rate limit) — *borrowed from sniffly*
- [ ] Session bookmarks + tags — *borrowed from ccboard, codedash*
- [ ] Full-text FTS5 search across all sessions — *borrowed from ccboard*
- [ ] Session replay with play/pause slider — *borrowed from codedash*
- [ ] Streak stats on the heatmap — *borrowed from codedash*
- [ ] Model-switch timeline per session — *borrowed from ccboard*
- [ ] Audit log for credential leaks / destructive commands — *borrowed from ccboard*
- [ ] Git commit correlation: interleave commits with session messages — *borrowed from amac0/ClaudeCodeJSONLParser, simonw/claude-code-transcripts*
- [ ] Live status badges via hook injection (Running / WaitingInput / Stopped) — *borrowed from ccboard, agents-observe*
- [ ] `npx @claude-lens/web` distribution — *borrowed from ccusage pattern*

**Infrastructure**
- [ ] SQLite cache at `~/.claude/claude-lens.db` with mtime-based incremental scan (ccboard reports 89x speedup over raw rescans)
- [ ] Scan additional session paths: `~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/projects/` (phuryn does this)
- [ ] Command palette (`⌘K`) for quick session lookup
- [ ] Compare two sessions side-by-side
- [ ] Export session as markdown / PDF
- [ ] Per-tool usage breakdown charts
- [ ] Zod-strict parsing for zero data loss on schema drift (d-kimuson pattern)

## License

[MIT](./LICENSE)

## Credits

Built on top of [Claude Code](https://claude.com/claude-code), [Next.js 16](https://nextjs.org), [Tailwind v4](https://tailwindcss.com), [lucide-react](https://lucide.dev), [react-markdown](https://github.com/remarkjs/react-markdown), and [remark-gfm](https://github.com/remarkjs/remark-gfm).
