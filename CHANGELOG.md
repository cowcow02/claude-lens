# Changelog

All notable changes to **claudelens** are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Plan utilization tracking

- **`cclens usage` command** — prints current 5h / 7d / Sonnet utilization as a colored terminal burndown. Data comes directly from Anthropic's `/api/oauth/usage` endpoint using the OAuth token Claude Code already stores in the macOS Keychain (`Claude Code-credentials`), so numbers match `/usage` exactly. `--save` appends the snapshot to `~/.cclens/usage.jsonl`.
- **`cclens daemon start|stop|status|logs`** — background poller that samples the usage endpoint every 5 minutes and appends to the same JSONL log. Detached child process, PID-managed, graceful SIGTERM shutdown, error logging to `~/.cclens/daemon.log`.
- **Sidebar usage widget** — always-visible, three thin progress bars showing the latest 5h / 7d / Sonnet utilization with reset countdowns (`resets in 3h14m` / `resets in 4d2h`). Click-through to `/usage`.
- **`/usage` dashboard page** — historical burndown charts per window, ordered 7d → 5h → Sonnet (collapsible):
  - **Burndown layout**: remaining budget (100% → 0%) on the Y-axis; dashed "sustainable burn" diagonal as reference; colored actual line; area fill; `now` marker; warning bands at <10% (danger) and <30% (caution).
  - **Inline header**: big percentage, on-track / slightly-behind / behind-schedule classification with exact delta, window span + reset countdown.
  - **Expand-to-fullscreen modal** with date range picker: Current cycle · 24H · 7D · 30D · 90D · Custom datetime range. "Current cycle" uses the exact same multi-cycle chart component as the others, just bounded to the latest cycle.
  - **Multi-cycle rendering** with vertical reset markers, per-cycle ideal diagonals, per-cycle peak dots with percentage labels, gap-aware polylines (>15 min gaps break the line instead of interpolating), data-point dots so isolated snapshots remain visible.
  - **Stats strip**: peak utilization, avg peak per cycle, complete cycles in range, data-point count.
  - **Interactive hover**: crosshair + tooltip with exact date, remaining %, used %, and delta from ideal.
  - **Full datetime range header** at the top of each chart card: `Apr 13 9:00 AM → Apr 13 2:00 PM (5h)`.
- **SSE live-updates** — `/api/events` now watches `~/.cclens/usage.jsonl` alongside `~/.claude/projects/`. New `usage-updated` event type flows through `LiveRefresher` so the sidebar widget and `/usage` page refresh within ~550ms of each daemon poll, no manual reload.
- **Mock data generator** (`scripts/generate-mock-usage.mjs`) — produces 30 days of realistic cycles with hour-of-day, day-of-week, burst-day, quiet-day, and weekly intensity factors. Backs up existing log first. Useful for UI development and screenshots.

### Added — CLI package

- **`packages/cli`** published as **`claudelens`** on npm — single package that bundles the CLI, parser, and the Next.js dashboard's standalone output. Global install (`npm install -g claudelens`) gets a fully-working dashboard. Two bin aliases ship together: `claudelens` (full name) and `cclens` (short alias for tab-completion). Both point to the same binary.
- **`claudelens start [--port N] [--no-open]`** (or `cclens start`) — spawns the dashboard server as a detached child, writes PID to `~/.cclens/pid`, opens the browser after a health check. `--no-open` skips the browser launch (useful during iterative rebuilds).
- **`claudelens stop`** — SIGTERM the server, clean up PID file.
- **`claudelens web [page] [--no-open]`** — convenience command that opens the dashboard in the browser, auto-starting the server if not running. Accepts a page path: `claudelens web usage`, `claudelens web sessions`.
- **`claudelens stats [--live] [-s YYYYMMDD] [--days N]`** — ccusage-style daily token usage table with model breakdown and cost estimation. `--live` is an auto-refreshing terminal TUI.
- **`claudelens update`** — force reinstall via `npm install -g claudelens@latest`. Auto-update check on every `claudelens start` (skipped in local-dev mode, guarded against re-exec loops).
- **Cost estimation** via a pricing table in `packages/cli/src/pricing.ts` mapping model prefixes (Opus / Sonnet / Haiku, both 3.x and 4.x) to per-million-token input / output / cache-read / cache-write rates. Unknown models show `—`.
- **Next.js standalone output** — `apps/web` builds as a self-contained `.next/standalone/` bundle; `scripts/prepare-cli.mjs` copies it + static assets + public/ into `packages/cli/app/` at release time. Gated behind `NEXT_OUTPUT=standalone` env var so local `next start` and dev mode still work.
- **GitHub Actions release workflow** (`.github/workflows/release.yml`) — tag-driven. Pushing `v*` triggers `pnpm test → pnpm build → prepare-cli → publish to npm → create GitHub Release`.
- **Version sync script** (`scripts/version-sync.mjs`) — runs via the `version` lifecycle hook to propagate the root package.json version to all sub-packages.
- **`CLAUDE.md`** — agent-facing project guide including the release process (so any Claude Code session can ship a release after completing user-facing work).

### Added — Dashboard improvements

- **Cards / Table view toggle** on `/sessions` and `/projects` with a new generic sortable `DataTable<T>` component (click column header to sort; re-click flips direction). Preference persists via `usePersistentBoolean` per page.
- **Shared `DashboardView` component** — the overview home and project-detail pages now render the same 6-card metric grid + heatmap + activity chart from one source. Pages supply their own headers, date-range filters, and supplementary sections.
- **6-card overview redesign** — tighter story, two-line subs, compact unit formatting, new ordering:
  - Sessions (turns + avg/session)
  - Agent time (per-day average + active day count)
  - Tool calls (avg/session + total sessions)
  - Parallelism (peak ×N + `% of agent time`)
  - Code changes (+XXk/−Yk + file count + total lines)
  - Est. cost (input / output tokens with B/M/k units)
- **"Active time" renamed to "Agent time"** across all user-facing labels (dashboard cards, activity chart, sessions/projects tables, timeline page). Clearer signal: this is the time the Claude agent was doing work.
- **Parallelism card** merges the old separate "Peak parallel" + "Parallel time" into one, freeing a slot and showing the more actionable `% of agent time` ratio.
- **Daily Activity chart** now has proper X and Y axes — gridlines at 0/25/50/75/100% of max with humanised value labels on the left, first-day/last-day/month-start labels along the bottom, explicit padding.
- **Metric tooltip** max-length trimmed to prevent the Parallelism tooltip from ballooning down the page.
- **Back-to-dashboard breadcrumbs removed** from `/usage` and `/parallelism` — the sidebar provides navigation.

### Added — Shared primitives

- **`usePersistentBoolean(key, default)`** hook — localStorage-backed boolean state with cross-window sync via a `storage` event listener and cross-component same-window sync via a custom `cclens:persistent-boolean` event. Powers the Sonnet show/hide (main page and sidebar stay in sync) and the cards/table view toggles.
- **`OptionalChart`** component — reusable wrapper for collapsible "advanced" chart cards, used by the Sonnet window on `/usage`.
- **`DataTable<T>`** — generic sortable table with sticky headers, row hover, click-to-navigate, and per-column `sortValue` + `render`.
- **`useViewToggle(storageKey)`** — cards/table segmented control factory built on top of `usePersistentBoolean`.

### Changed

- **Root workspace renamed** from `claude-lens` to `claude-lens-workspace` (private) so the published package name is free. The CLI package ships as **`claudelens`** with two bin aliases — `claudelens` (full name) and `cclens` (short alias for tab-completion speed). Both invoke the same binary.
- **State directory** moved to `~/.cclens/` (pid file, usage log, daemon log, config).
- **Environment variables** renamed: `CLAUDE_LENS_DATA_DIR` → `CCLENS_DATA_DIR`, `CLAUDE_LENS_PORT` → `CCLENS_PORT`.
- **Next.js standalone output** now lives inside the CLI package at `packages/cli/app/` rather than being served via `next start` directly.
- **Canonical project rollup** — sessions in git worktree subdirs (`/.worktrees/<name>`) now aggregate under their parent repo everywhere (sidebar, projects list, Gantt legend, project detail page). `groupByProject` and `listProjects` return `rawProjectDirs[]` + `worktreeCount` so the UI can show `+N wt` badges.
- **`airTimeMs` / `activeSegments`** now walk all timestamped events (not just conversational) so system / summary / sidechain events count toward agent time. Matches the Gantt chart's computation for consistency.
- **`dailyActivity`** now splits each session's active segments across every local day they touch, instead of bucketing all time to the start day.

### Fixed

- **`next start` broken by standalone output** — gated `output: "standalone"` behind `NEXT_OUTPUT=standalone` env var so local development (`pnpm dev`, `next start`) works again.
- **Auto-update re-exec loop** — the updater now detects local dev paths and sets an `__CCLENS_UPDATED` env guard on re-exec, preventing infinite restart loops when the published package shares a name with something unexpected.
- **Shell argument injection in re-exec** — replaced `execSync` string interpolation with `spawnSync` + argv array.
- **`forceUpdate` never actually reinstalling** — it used to early-return when already on latest; now always calls `npm install -g claudelens@latest` (useful when the install is corrupted).
- **Chart text distortion** — removed `preserveAspectRatio="none"` on usage charts. SVG viewBox aspect now matches the display width via CSS `aspect-ratio`, so axis labels render at correct proportions instead of being stretched horizontally.
- **Hydration mismatches** on time-relative spans (relative dates differ between SSR and client hydration) — added `suppressHydrationWarning` on all `formatRelative` call sites.
- **Gap interpolation in multi-cycle charts** — consecutive snapshots > 15 min apart now break the polyline instead of drawing a straight line across missing data. Data-point dots render underneath so isolated snapshots remain visible.
- **Port persistence** — PID file now stores `pid:port` so `cclens stop` and `getServerStatus` report the port the server actually started on (not whatever `CCLENS_PORT` env says).
- **Token usage dedup** — fallback to `message.id` alone when `requestId` is absent.
- **Slash-command detection** — checks raw content before `cleanText` strips `<command-name>` tags so `firstUserPreview` correctly skips slash commands.

## Pre-session baseline

Prior to this changelog's starting commit, `claude-lens` already had:

- pnpm / Turborepo monorepo with `@claude-lens/parser` and `apps/web`
- JSONL parser with event / presentation / mega rows
- Dashboard with metric cards, heatmap, daily activity, parallel run detection, PR attribution
- Session list, session detail with mini-map + turn collapsing + pretty tool cards
- Timeline (Gantt) page, project pages, sessions page
- Live-updating SSE bridge for session file changes
- `install.sh` one-liner installer

This changelog documents the transformation from that baseline into a published CLI + usage-tracking platform.
