# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-container web panel that triggers on-demand deploys (`git pull` → `docker compose down` → `docker compose up -d --build`) for other docker-compose projects living under `/docker/` on the host, without needing SSH access. Vanilla Node/Express backend, no build step, no framework frontend (plain HTML/CSS/JS served as static files).

## Commands

All commands run from `backend/`:

```bash
npm install        # install dependencies
npm start           # node server.js — requires DEPLOY_TOKEN env var, min 32 chars
```

There is no test suite, lint config, or bundler in this repo. To run the whole stack as it runs in production, use `docker compose up -d --build` from the repo root (requires an external `npm` Docker network and a `.env` with `DEPLOY_TOKEN`).

Because the app manipulates real `docker compose` projects on disk, local testing generally means pointing `DOCKER_ROOT` at a scratch directory containing fake project folders with a `docker-compose.yml` each, rather than running against `/docker` directly.

## Architecture

Three backend modules, wired together in `backend/server.js`:

- **`src/auth.js`** — Bearer token auth (`requireAuth` middleware) checked against a single static `DEPLOY_TOKEN` env var via `crypto.timingSafeEqual`. There is no per-user login/session; the token is the only credential and is stored in the browser's `localStorage` by the frontend.
- **`src/discovery.js`** — `scanProjects()` walks `DOCKER_ROOT` (default `/docker`) each time it's called (no caching) and returns the whitelist of deployable projects. This is the single source of truth for what deploy targets exist — nothing is hardcoded or persisted elsewhere. Layout convention:
  - `/docker/<name>/docker-compose.yml` → type `fullstack`
  - `/docker/staticSite/<name>/docker-compose.yml` → type `static`
  - `/docker/wordpress/<name>/docker-compose.yml` → type `wordpress`
  - `deploy-panel` itself is excluded (`IGNORED_NAMES`) so the panel can't deploy over itself.
  - A project's `name` (e.g. `staticSite/mi-sitio`) is the identifier used everywhere else (API, locks, UI).
- **`src/jobs.js`** — Runs and tracks deploys in-memory (no DB, no persistence across restarts):
  - `DEPLOY_STEPS` is the fixed, ordered command list: `git pull --ff-only`, `docker compose down --rmi local`, `docker compose up -d --build`. **Order matters**: pull goes first on purpose so a failed pull never touches the running stack (zero downtime on pull failure). `--rmi local` on `down` removes the project's previously-built image right before `up --build` tags a new one with the same name — without it, the old image is left dangling (`<none>:<none>`) on every deploy instead of being replaced.
  - Each step spawns detached (`detached: true`, its own process group) so a timeout (`DEPLOY_STEP_TIMEOUT_MS`, default 20 min) can kill the whole process tree via `process.kill(-pid, signal)`, not just the direct child.
  - `locks` (a `Set` of project names) enforces one concurrent deploy per project (`409` if already locked) and `MAX_CONCURRENT_DEPLOYS` (default 2) caps total parallel deploys across all projects (`429` if at capacity).
  - Job output is streamed live to listeners (SSE `res` objects) as it's produced, and also buffered in `job.log` so a client connecting mid-deploy gets replay-then-live. Finished jobs are kept for `JOB_TTL_MS` (30 min) then evicted from the `jobs` Map.

**Request flow**: `GET /api/projects` and `POST /api/deploy` require the `Authorization: Bearer <DEPLOY_TOKEN>` header (checked by `requireAuth`). `POST /api/deploy` mints a job with its own short-lived, per-job `streamToken` (separate from `DEPLOY_TOKEN`) because the log stream endpoint (`GET /api/deploy/:jobId/stream`) is consumed via `EventSource`, which can't send custom headers — so that one route is authenticated by a token in the query string instead of the `Authorization` header.

**Frontend** (`backend/public/`): no framework, no build step. `app.js` gates the UI behind a token prompt, stores the token in `localStorage`, and re-sends it as a Bearer header on every `apiFetch` call. Deploy logs are rendered by subscribing to the SSE stream and appending `log` events to a `<pre>`-like output until a `done` event arrives.

## Security-relevant constraints to preserve

These aren't stylistic preferences — changing them changes the security posture described in `README.md`:

- The container is intentionally given root-equivalent host access (bind-mounted `/docker` + `/var/run/docker.sock`) so it can run `git`/`docker compose` against arbitrary host projects. `DEPLOY_TOKEN` is the only gate on that access — treat any change to `auth.js` or the token-checking logic as security-critical.
- Token comparisons must stay constant-time (`crypto.timingSafeEqual` via `safeEqual`) — don't replace with `===` or `includes`.
- The stream token is deliberately distinct from `DEPLOY_TOKEN` and scoped to a single job — don't reuse `DEPLOY_TOKEN` in a URL/query string.
- `DEPLOY_TOKEN` must stay ≥32 chars; the server intentionally refuses to start otherwise (see `server.js` startup checks).
- Rate limiting (20 req/min/IP on `/api/*`) and `app.set('trust proxy', 1)` assume exactly one reverse-proxy hop (Nginx Proxy Manager) in front of the container — adding another proxy layer without adjusting `trust proxy` would break client-IP-based rate limiting.
