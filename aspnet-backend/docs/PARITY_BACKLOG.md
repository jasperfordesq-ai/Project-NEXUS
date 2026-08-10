# Laravel Parity Implementation Backlog

Last reviewed: 2026-07-13

Status: **Maintained reference — generation method with a historical rollup**

Canonical source: `C:\platforms\htdocs\staging` (read-only).

This document summarizes the generated implementation backlog. The full row-level
backlog is intentionally ignored by git and regenerated under
`artifacts/parity/backlog/` from the current API, schema, frontend, and
localization parity artifacts.

The committed rollup below is a historical planning snapshot, not the current
completion queue or score. Use `CURRENT_ASPNET_CONTRACT_STATUS.md` for current
status. Regenerate every source artifact and the exporter before using backlog
counts for planning.

## Historical Generated Rollup (2026-07-13)

Generated with `scripts/export-laravel-parity-backlog.ps1` on 2026-07-13 after
refreshing the API and schema artifacts and reusing the current frontend and
localization artifacts.

| Metric | Count |
| --- | ---: |
| Total open backlog items | 6,424 |
| P0 items | 80 |
| P1 items | 6,340 |
| P2 items | 4 |
| API items | 51 |
| Schema items | 263 |
| Frontend items | 532 |
| Localization items | 5,578 |

These counts are not a parity score. They are implementation queue inputs
derived from static comparison artifacts.

## Area Rollup

| Area | Items |
| --- | ---: |
| Localization | 4,672 |
| Verein / Clubs | 669 |
| Accessible frontend | 466 |
| Unclassified parity gap | 250 |
| Mailchimp-like communications | 161 |
| Caring Community / National KISS | 115 |
| Marketplace / commerce | 74 |
| Partner API / portal | 39 |
| Identity verification providers | 35 |
| Regional Analytics | 6 |

At that snapshot, P0 contained 53 items, led by Verein/Clubs schema and accessible
route work, marketplace commerce, and Partner API. The P0 bucket means "implement or triage before admin
polish"; it does not mean every item is ready for one-commit implementation.

## Generated Artifacts

The exporter writes:

```text
artifacts/parity/backlog/parity-backlog.json
artifacts/parity/backlog/parity-backlog.csv
artifacts/parity/backlog/parity-backlog.md
```

Regenerate from the current comparison artifacts with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-export-laravel-parity-backlog.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\export-laravel-parity-backlog.ps1
```

If source artifacts are stale, rerun the source comparators first:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\compare-laravel-api-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\compare-laravel-schema-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\compare-laravel-frontend-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\compare-laravel-localization-parity.ps1
```

## Priority Semantics

- **P0**: missing API contracts and former-exclusion foundations that block
  user-facing workflows or accessible parity.
- **P1**: schema, frontend, namespace, and key gaps needed to complete module
  workflows after the blocking contracts are understood.
- **P2**: locale-level completion and lower-risk translation coverage that
  should close before any final parity claim.

## Consumption Rules

- Treat backlog rows as evidence-backed starting points, not automatic
  implementation instructions.
- Read the Laravel source path before implementing a row.
- Prefer batches that close a workflow end-to-end: API contract, schema,
  frontend route, localization, tests, and docs.
- React backlog rows are not actionable in this repository. `apps/react-frontend/`
  was deleted on 2026-08-09 and must not be recreated to "close" them.
- Treat `C:\platforms\htdocs\staging\react-frontend` as the canonical React
  frontend contract target. Backend work should make ASP.NET expose the same API
  methods, paths, `/api/v2` aliases, payloads, response envelopes, auth/tenant
  behavior, upload behavior, realtime config, and status codes expected by that
  frontend.
- Keep `apps/web-uk/` as the accessible frontend target unless the user narrows
  the task to backend-only work.
- Preserve ASP.NET Core, EF Core/PostgreSQL, JWT, tenant isolation, CORS,
  FIDO2/WebAuthn, AGPL, and production-container invariants.

## Acceptance Criteria

- Every backlog item is either implemented, intentionally aliased, replaced by a
  documented equivalent .NET workflow, or explicitly deferred by product
  decision outside this technical parity goal.
- API items include auth, tenant isolation, validation, response shape, error
  shape, and regression tests.
- Schema items include EF mappings, migrations, indexes/constraints where
  required, and tenant-safety verification.
- React frontend items are satisfied by proving the Laravel React frontend can
  run the certified workflow against ASP.NET through contract-identical backend
  contracts. Proof requires a route/API matrix, ASP.NET regression tests, and
  runtime smoke tests.
- Accessible frontend items include route/view behavior, API wiring, feature
  gates, localization, and accessibility checks.
- Localization items include namespace/key aliases where direct filename parity
  is not the right .NET target.
