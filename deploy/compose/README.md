# Docker Compose deployment

Runs the team server + Postgres + Caddy (TLS termination) on any Linux host.

## Setup

```bash
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD, BASE_URL, and DOMAIN
docker compose up -d
```

Caddy auto-provisions a TLS certificate for `DOMAIN`. If you're running locally without a domain, leave `DOMAIN` unset and access the server at `http://localhost:3322` (Caddy binds to `localhost` by default via `{$DOMAIN:localhost}`).

## Build context

The Dockerfile is built from the monorepo root (`../..`), so run `docker compose` from this directory or pass `-f deploy/compose/docker-compose.yml` from the repo root.
