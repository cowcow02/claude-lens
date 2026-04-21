# Deploy Fleetlens Team Edition on Railway

Zero-config template (Postgres + team-server, every variable pre-filled):

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/sGuijx)

## What the template provisions

- `fleetlens-team-server` — the Next.js 16 server built from `packages/team-server/Dockerfile`, public domain auto-generated
- `Postgres` — Postgres 18 with a 5 GB volume at `/var/lib/postgresql/data`

## Everything is pre-wired

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (private network) |
| `BASE_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| `NODE_ENV` | `production` |
| `PORT` | `3322` |
| `RAILWAY_DOCKERFILE_PATH` | `packages/team-server/Dockerfile` |
| `FLEETLENS_ENCRYPTION_KEY` | `${{ secret(64, 'abcdef0123456789') }}` — unique per deploy |

Postgres variables (`POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, etc.) are all defaulted or auto-generated.

## First-run flow

1. Click the button → Railway provisions both services (~60–90s).
2. Open the generated `*.up.railway.app` URL → `/signup` loads.
3. The first account becomes the admin of team #1.
4. Admin creates invite links or toggles public signup in `/team/<slug>/settings`.
5. On the CLI: `fleetlens team join <server-url> <device-token>` to start pushing metrics.
