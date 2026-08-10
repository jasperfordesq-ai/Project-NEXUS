# Docker Contract - NEXUS UK Frontend

Last reviewed: 2026-07-15

Status: **Maintained reference - local Web UK container contract only**

## Source of Truth

**Docker is the supported application-runtime environment.**

The `compose.yml` file defines local development and a local production-image
profile. It is not an approved production deployment specification. The pinned
host Node version may be used for `npm test`, lint, build, generators, and the
isolated accessibility fixture; do not run an undocumented native Express/XAMPP
application stack.

### Why The Application Runtime Uses Docker

- **Consistency** - Same checked-in local runtime for all developers
- **No dependency conflicts** - Node.js, Sass, etc. are containerized
- **Simple onboarding** - Just `docker compose up`
- **Container fidelity** - Exercises the image/runtime pattern without claiming production certification

## Quick Reference

| Item | Value |
|------|-------|
| Container name | `nexus-uk-frontend-dev` |
| Host port | `5180` |
| Container port | `3001` |
| URL | http://localhost:5180 |
| Backend API | http://host.docker.internal:8090 |
| Health check | http://localhost:5180/health |

## Commands

### Start (Development)
```bash
docker compose up
```
Or detached:
```bash
docker compose up -d
```

### Stop
```bash
docker compose down
```

### Rebuild (after Dockerfile changes)
```bash
docker compose up --build
```

### View logs
```bash
docker compose logs -f
```

### Start (Local production-image profile)
```bash
docker compose --profile prod up
```

This command is for local image/runtime checks only. It does not authorize
deployment and does not establish backend-switching certification.

## Port Mapping

| Service | Host Port | Container Port | Notes |
|---------|-----------|----------------|-------|
| UK Frontend | 5180 | 3001 | Port 5273 was formerly the root React service, removed 2026-08-09 |

## Backend URL Rules

| Environment | Target variables |
|-------------|------------------|
| Docker (default) | `ACCESSIBLE_BACKEND_TARGET=laravel`, `LARAVEL_BASE_URL=http://host.docker.internal:8090` |
| Host verification tooling | `ACCESSIBLE_BACKEND_TARGET=laravel`, `LARAVEL_BASE_URL=http://127.0.0.1:8090`; safe isolated tests replace this with their own mock |

The Docker environment uses `host.docker.internal` to reach Laravel running on
the host machine. This is configured in `.env.docker` and **should not be
changed to ASP.NET** unless doing explicit future compatibility work. ASP.NET is
not certified as a shared accessible backend.

This frontend workstream must not modify either backend. Laravel Blade and the
Laravel API define Web UK behaviour and contracts; ASP.NET is a separate future
compatibility target owned by another workstream. The ordinary Laravel database
is not a disposable mutation fixture and must not be migrated or repaired from
Web UK work.

## Root Production Override Is Not Certified

The repository-root `compose.prod.yml` currently sets Web UK's
`API_BASE_URL=http://api:8080`, which points at the ASP.NET service. This is a
legacy/uncertified override, not an approved production path and not evidence
that the unchanged frontend passes against ASP.NET. Do not run or deploy that
Web UK service definition as production work from this workstream. Any future
production action must first follow the repository-root
`.claude/production-containers.md`, use an explicitly approved deployment plan,
and cite banked unchanged-Web-UK ASP.NET certification.

## File Structure

```
compose.yml       # Source of truth for Docker setup
Dockerfile        # Multi-stage build (dev + prod targets)
.env.docker       # Docker-only environment variables
.env              # Non-Docker environment variables (fallback)
.dockerignore     # Files excluded from Docker context
```

## Development Workflow

### Hot Reload

In development mode, the following directories are mounted as volumes:
- `./src` → `/app/src`
- `./public` → `/app/public`

Changes to these directories trigger automatic reload via nodemon and sass watch.

### CSS Changes

CSS changes are automatically recompiled when you modify files in `src/assets/scss/`.

### Adding Dependencies

After modifying `package.json`:
```bash
docker compose up --build
```

## Instructions for AI Tools

When working on this project:

1. **Inspect current listeners/containers** instead of assuming Docker is running
2. **Use port 5180** for testing the UK frontend
3. **Laravel backend is at** `http://host.docker.internal:8090` from container perspective
4. **Use `docker compose` commands** (not `docker-compose`)
5. **Check container health** with `docker compose ps` or `curl http://localhost:5180/health`

### Verifying Setup

```bash
# Check container is running
docker ps --filter "name=nexus-uk-frontend"

# Check frontend responds
curl http://localhost:5180/health

# Check Laravel backend reachable from container
docker exec nexus-uk-frontend-dev wget -qO- http://host.docker.internal:8090
```

## Troubleshooting

### Port 5180 already in use
```bash
# Find what's using the port
netstat -ano | findstr :5180  # Windows
lsof -i :5180                 # macOS/Linux

# Or change the port in compose.yml
```

### Backend not reachable
1. Verify Laravel is running on port 8090
2. Check `host.docker.internal` resolves: `docker exec nexus-uk-frontend-dev ping host.docker.internal`
3. On Linux, ensure `extra_hosts` is set in compose.yml (already configured)

### Container won't start
```bash
# Check logs
docker compose logs nexus-uk-frontend

# Rebuild from scratch
docker compose down
docker compose up --build
```

### CSS not updating
```bash
# Check sass watch is running
docker compose logs -f | grep sass

# Force rebuild
docker compose up --build
```
