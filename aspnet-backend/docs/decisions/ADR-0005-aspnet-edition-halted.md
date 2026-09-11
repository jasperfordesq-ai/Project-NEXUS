# ADR-0005: The ASP.NET Edition Is Paused

Date accepted: 2026-09-11

Status: **Maintained reference - accepted; suspends ADR-0003's delivery sequencing**

Relationship to ADR-0003: the commercial reason recorded in
[ADR-0003](ADR-0003-aspnet-is-a-committed-deliverable.md) — public-sector buyers
who require a .NET stack — is **not withdrawn**. What changes is sequencing: the
edition is paused until the rest of the platform is more mature. ADR-0004's
definition of journey equivalence stays correct as a method and applies again
when work resumes.

## Decision

The owner paused development of the ASP.NET edition on 11 September 2026. In the
owner's words, in order: "Ignore the ASP.NET backend. We have halted development
on that." — "we can't afford to be wasting any credits on the ASP.NET edition" —
and, clarifying: **"ASP.NET is not abandoned. We're just halting development on
that for now until the rest of the platform is more mature."**

So: **paused, not abandoned.** The code, its documents, its certification ledger
and its ADRs stay in the repository exactly as they are, so that resuming is a
matter of switching CI back on, not of rediscovery.

Concretely:

- No agent or contributor reads, tests, builds, fixes, audits or plans work in
  `aspnet-backend/` unless the owner re-opens the edition explicitly.
- The four ASP.NET jobs in `.github/workflows/platform-contracts.yml`
  (`aspnet-build`, `aspnet-api-tests`, `aspnet-messaging-tests`,
  `aspnet-docker-build`) are pinned `if: false`, so they run on no trigger,
  including the weekly schedule and manual dispatch. The `Web UK …` jobs in the
  same workflow are untouched: they gate the production accessible frontend.
- The ASP.NET markdown-link pass in the `Static contract inventory` job is
  removed; the Web UK pass stays.
- The local development containers `nexus-aspnet-dev-api`, `nexus-aspnet-dev-db`
  and `nexus-aspnet-dev-rabbitmq` are stopped (not removed).
- `AGENTS.md`, `react-frontend/CLAUDE.md`, `docs/REACT-DUAL-BACKEND.md` and this
  directory's `README.md` state the halt at the top and mark their ASP.NET
  content as historical.
- The code stays in the repository as a snapshot. Deleting it is a separate
  decision; nothing depends on its absence, and its presence costs nothing once
  CI ignores it.

## What is unchanged

- Laravel is the production backend and the only API contract (it always was the
  production default; ADR-0003 only ever described sequencing).
- The React frontend's backend-neutrality rule stands on its own merits and is
  still enforced by `npm --prefix react-frontend run check:backend-guardrails`:
  no backend-specific branch in a page or component.
- The deployment isolation rule stands: `aspnet-backend/` is not in the Laravel
  blue/green deploy scope.
- The dead ASP.NET production deployment described in `docs/PLATFORM-MONOREPO.md`
  (`nexus-backend-*`, `nexus-uk-*` containers, no successful database backup
  since 2026-03-08) is a separate, pre-existing fact and is not changed by this
  record. Read-only inspection of it stays allowed; anything that writes,
  restarts or redeploys still needs explicit owner authorisation.

## Why record this rather than just stop

ADR-0003 exists because an unrecorded change of framing cost the workstream weeks.
The reverse is equally costly: guides that still call the edition "committed"
would keep sending agents into `aspnet-backend/` and keep the ~92-runner-minute
test matrix alive on every scheduled sweep. The two-factor review of
11 September 2026 (security register engagement E-004) spent planning time mapping
the ASP.NET two-factor code before the owner clarified the position; that time is
the concrete reason this record exists.

## State of the edition at the halt (for whoever re-opens it)

From the E-004 planning map, working tree of 11 September 2026, so the next
person does not rediscover it:

- Two-factor: no challenge-based setup (the `totp_setup` challenge is emitted but
  never consumed, so forced administrator enrolment cannot complete), no
  authenticator-code replay protection, no remembered devices, eight-digit
  numeric recovery codes, no session revocation on disable or reset, no MFA claim
  on the JWT, challenge store process-local.
- Certification score at the halt: see `JOURNEY_CERTIFICATION_LEDGER.md`
  (unchanged since its last update); nothing certified.
- The passkey user-verification and token changes committed on 2026-09-11
  (`d75419561`) were the last code landed.

## What resumes the edition

An explicit owner instruction, expected when the rest of the platform is more
mature. On resuming: restore the four `if:` conditions in
`platform-contracts.yml` from the commit that pinned them, start the
`nexus-aspnet-dev-*` containers, re-read ADR-0003 (the reason) and ADR-0004 (the
method), and treat the two-factor list above as the first work items.
