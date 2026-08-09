# Implementation Plan: Minimal NEXUS Platform Monorepo

## Overview

Make the existing Laravel repository the platform repository without moving or
renaming any production Laravel, React, Blade, mobile, Docker, or deployment
paths. Import clean tracked snapshots of the experimental ASP.NET backend and
Web UK, then add isolated contract verification that cannot deploy either new
application.

## Architecture Decisions

- Keep Laravel at the repository root and preserve the existing production
  build and deployment layout byte-for-byte wherever possible.
- Import the ASP.NET backend as `aspnet-backend/` and Web UK as `web-uk/`.
- Do not import ASP.NET Git history, release tags, changelog, generated build
  output, local environment files, or repository-level deployment automation.
- Keep the former ASP.NET repository as the historical archive; this branch
  only contains a source snapshot.
- Add a separate contract workflow rather than changing the production CI path
  map or pre-deploy verifier.
- Do not bump the platform version, deploy, push, merge, rename, or archive a
  repository as part of this work.

## Task List

### Phase 1: Safety foundation

- [x] Create an isolated worktree and feature branch from current Laravel main.
- [ ] Record the source SHAs and an explicit import allowlist.
- [ ] Verify the allowlist contains no generated output or local secrets.

### Checkpoint: Safety foundation

- [ ] Original Laravel and ASP.NET worktrees remain clean and unchanged.
- [ ] Candidate changes exist only on `codex/platform-monorepo`.

### Phase 2: Snapshot import

- [ ] Import the ASP.NET backend as `aspnet-backend/`.
- [ ] Import Web UK as `web-uk/`.
- [ ] Add package-local instructions and provenance without importing the old
      changelog or repository history.

### Checkpoint: Imported applications

- [ ] ASP.NET solution builds and tests from its new path.
- [ ] Web UK installs, lints, builds, and tests from its new path.

### Phase 3: Contract workspace

- [ ] Make comparison tools resolve Laravel and ASP.NET roots inside the same
      checkout without machine-specific absolute paths.
- [ ] Add one local contract-verification entry point.
- [ ] Add a separate non-deploying GitHub Actions workflow for ASP.NET, Web UK,
      and static contract evidence.
- [ ] Exclude imported applications from Laravel Docker build contexts.

### Checkpoint: Contract workspace

- [ ] Static Laravel-to-ASP.NET comparison completes from a clean checkout.
- [ ] Both frontend backend-target configurations remain unchanged.
- [ ] Production compose services and Dockerfile paths are unchanged.

### Phase 4: Final verification and review

- [ ] Run the repository preflight checks applicable to changed paths.
- [ ] Review correctness, architecture, security, and performance.
- [ ] Confirm there are no secrets, generated outputs, or unintended files.
- [ ] Hand off the unmerged and unpushed branch for explicit user approval.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Laravel deployment begins packaging imported trees | Slower or incorrect production build | Add root `.dockerignore` exclusions and verify compose output/build inputs |
| Existing pre-deploy CI semantics change | Valid deploys blocked or checks skipped | Do not edit `.github/ci-paths.yml` or the pre-deploy verifier |
| Secrets or generated files enter the public repository | Security or repository bloat | Import only tracked allowlisted files and scan the staged diff |
| Cross-platform tooling retains absolute paths | CI works only on one workstation | Resolve roots relative to the repository and accept explicit overrides |
| Snapshot import obscures historical provenance | Harder archaeology | Record source repository URL and exact source SHA; retain the old repository as archive |

## Explicit Non-Goals

- No production deployment or container operation.
- No database access, migration, mutation, upload, or download.
- No movement of existing Laravel, React, Blade, or mobile files.
- No v1.6.0 release or version bump.
- No GitHub repository rename, archive, push, or pull request.

