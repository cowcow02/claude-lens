#!/usr/bin/env bash
#
# Claude Lens — one-line installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/cowcow02/claude-lens/master/install.sh | bash
#
# What it does:
#   1. Checks for Node.js >= 20 and pnpm (guides you to install if missing)
#   2. Checks for ~/.claude/projects (your Claude Code data)
#   3. Clones claude-lens into ~/claude-lens (or a custom dir)
#   4. Installs dependencies
#   5. Starts the dev server on port 3321
#   6. Opens http://localhost:3321 in your browser
#

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="${CLAUDE_LENS_DIR:-$HOME/claude-lens}"
REPO="https://github.com/cowcow02/claude-lens.git"
PORT=3321

info()  { echo -e "${CYAN}→${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*"; exit 1; }

echo ""
echo -e "${BOLD}Claude Lens${NC} — local dashboard for Claude Code sessions"
echo -e "${DIM}https://github.com/cowcow02/claude-lens${NC}"
echo ""

# ─── Check Node.js ────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install it from https://nodejs.org (v20+)"
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  fail "Node.js $NODE_VERSION found, but v20+ is required. Upgrade at https://nodejs.org"
fi
ok "Node.js $(node -v)"

# ─── Check pnpm ──────────────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found. Installing via corepack..."
  if command -v corepack &>/dev/null; then
    corepack enable
    corepack prepare pnpm@latest --activate
  else
    info "Installing pnpm via npm..."
    npm install -g pnpm
  fi
  if ! command -v pnpm &>/dev/null; then
    fail "Could not install pnpm. Install manually: https://pnpm.io/installation"
  fi
fi
ok "pnpm $(pnpm -v)"

# ─── Check Claude Code data ──────────────────────────────────────
CLAUDE_DIR="$HOME/.claude/projects"
if [ -d "$CLAUDE_DIR" ]; then
  SESSION_COUNT=$(find "$CLAUDE_DIR" -name "*.jsonl" 2>/dev/null | wc -l | tr -d ' ')
  ok "Found $SESSION_COUNT session files in ~/.claude/projects"
else
  warn "No ~/.claude/projects found — dashboard will be empty until you run Claude Code"
fi

# ─── Clone or update ─────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing installation at $INSTALL_DIR..."
  cd "$INSTALL_DIR"
  git pull --ff-only origin master 2>/dev/null || warn "Could not pull latest (offline?)"
else
  info "Cloning claude-lens to $INSTALL_DIR..."
  git clone --depth 1 "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
ok "Source ready at $INSTALL_DIR"

# ─── Install dependencies ────────────────────────────────────────
info "Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
ok "Dependencies installed"

# ─── Build parser ────────────────────────────────────────────────
info "Building parser..."
pnpm -F @claude-lens/parser build >/dev/null 2>&1
ok "Parser built"

# ─── Start server ────────────────────────────────────────────────
info "Starting dashboard on http://localhost:$PORT ..."
echo ""

# Open browser after a short delay (background)
(sleep 4 && {
  if command -v open &>/dev/null; then
    open "http://localhost:$PORT"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:$PORT"
  else
    echo -e "${CYAN}→${NC} Open http://localhost:$PORT in your browser"
  fi
}) &

# Run in foreground so Ctrl+C stops it cleanly
pnpm -F @claude-lens/web dev
