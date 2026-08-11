# Accessible Frontend Takeover

Last reviewed: 2026-08-11

Project NEXUS has two accessible frontends. This page records the decision that
one replaces the other, which phase that changeover is in, and which document
answers which question. **It is stated once, here.** Every other document points
at this page rather than repeating a status claim that can go stale.

## The decision

On **2026-08-11** the owner decided that `web-uk` becomes the production
accessible frontend and the Laravel Blade accessible frontend retires.

Before that decision, `web-uk` was an uncertified candidate and Blade was the
deployed product. Documentation written in that period says so, and much of it
also *prohibits* replacing Blade. Those prohibitions were correct when written and
are now superseded by this page.

## The two frontends

| | Laravel Blade accessible frontend | `web-uk` |
|---|---|---|
| Location | `accessible-frontend/` plus `app/Http/Controllers/GovukAlpha/` | `web-uk/` |
| Stack | Laravel Blade, rendered by the PHP application | Node/Express + Nunjucks + GOV.UK Frontend, consuming the Laravel HTTP API |
| Served by | The Laravel/PHP application container | Its own container (not yet deployed) |
| Status | **Currently deployed.** Retires at the end of the changeover. | **Takes over.** Not yet deployed. |

Both are separate from `react-frontend/`, which is the main product UI and is not
affected by this changeover.

## Public URL shapes — both are preserved exactly

No public address changes. Two shapes exist and both keep working:

- `/{tenantSlug}/accessible/...` on the shared host
- slug-less paths on a community's own domain, resolved from the `Host` header

Legacy `/{tenantSlug}/alpha/...` paths permanently redirect to `/accessible/...`
and remain redirect-compatibility only. The internal Laravel route names,
namespaces and translation files still say `govuk_alpha`; that is an internal
name, not a public one.

## 🔴 Which phase are we in — Phase A

**Phase A: Blade is still deployed.** Therefore:

- Blade remains the **observable-behaviour specification**. Where `web-uk`
  disagrees with Blade about what a page does, Blade is right unless the
  difference is a recorded deliberate improvement.
- The route matrix under `web-uk/docs/generated/` is a **live drift alarm**: a
  route appearing in Blade and not in `web-uk` is a real gap.
- The Laravel **API** is the contract source of truth for methods, paths,
  request and response shapes, status codes, auth, roles, modules and side
  effects. That does not change in either phase.

**Phase B begins when Blade is decommissioned.** At that point `web-uk` owns
browser behaviour, the route matrix becomes a historical record rather than an
alarm, and the Laravel API remains the contract source of truth.

Anything you read elsewhere that says "Blade is the source of truth" without
qualification means the Phase A rule above.

## Where the changeover stands

| Piece | State |
|---|---|
| Route and page coverage | **Complete.** 707 of 707 Laravel accessible routes matched, 0 missing. The last gap — recording event attendance from a signed check-in code — was closed on 2026-08-11. |
| Legal acceptance enforcement | **Built.** Server-side enforcement, a `web-uk` interstitial, and a mobile acceptance screen. |
| Bot protection on the contact form | **Built.** The challenge renders on the contact form, and the platform-side configuration fault that silently disabled it is fixed. |
| Cookie-consent record keeping | **Built.** Anonymous visitors' choices are now recorded, as Blade already did. |
| Deployment path | **Not built.** No container service, no vhost, no rollback rehearsal. Blocked on the prerequisites below. |
| Manual accessibility sign-off | **Partly done.** Keyboard, focus and reflow evidence exists. Screen-reader sign-off needs a human. |
| Blade retirement | **Not started.** A separate change with its own review, after a soak period. |

Current score: **592/1000** under rubric `WEBUK-W2-PROD-R1`. See the scoring
table below before comparing that with any earlier number.

## Open prerequisites — these need owner answers

Deployment cannot be built past a certain point without these. They are not
discoverable from the repository.

1. **Spare memory on the production VM.** Adding `web-uk` to both deployment
   colours costs about 2 × 512 MB. An existing memory squeeze on that machine has
   already caused unrelated queue-worker crash loops, so this is the most likely
   way this work causes an outage somewhere else.
2. **Two free host ports** for the two colours.
3. **A Redis database index that is not 0.** The Laravel cache store issues a
   flush; if `web-uk` sessions shared index 0, clearing the Laravel cache would
   sign out every accessible-frontend user.
4. **The list of community accessible domains**, which is production data and
   forms the per-vhost checklist.
5. **`.claude/production-containers.md`.** `web-uk`'s own release runbook makes
   lifting its deployment hold conditional on a file that was never imported into
   this repository. As written, the hold cannot be lifted. Either import it or
   supersede it with a section in [DEPLOYMENT.md](DEPLOYMENT.md).
6. **Whether to publish per-tenant accessible domains** in the public uptime
   target list.
7. **An error-reporting project for `web-uk`.** Without one it would become an
   internet-facing production service with no error reporting.

## Documents that carry a status claim

Read this page first; then the specific document for its own subject. Paths under
`web-uk` are given as text rather than links because the published documentation
site builds only `docs/`.

| Document | What it is authoritative for | Watch out for |
|---|---|---|
| This page | The decision, the phase, the URL shapes, the prerequisites | — |
| `web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md` | The current score and its rubric | The only current scoring source |
| `web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` | The retired W1 audit trail | **Retired.** Its 663/1000 is not current and must not be quoted as such |
| `web-uk/docs/generated/accessible-route-matrix.*` | Route coverage | Generated. Regenerate rather than editing |
| `web-uk/docs/generated/frontend-api-consumer-ledger.*` | Which platform endpoints `web-uk` calls, and whether tests prove each request | Generated |
| `web-uk/docs/MANUAL_ACCESSIBILITY_EVIDENCE.md` | Directed manual and assistive-technology checks | An entry is evidence for exactly the page, browser, input method and viewport listed — not a conformance claim |
| `web-uk/docs/PRODUCTION_RELEASE_RUNBOOK.md` | The release procedure | Its hold references the missing file in prerequisite 5 |
| `web-uk/CLAUDE.md` and `web-uk/AGENTS.md` | Working rules inside `web-uk` | Written during the candidate period; the takeover supersedes their replacement prohibition |
| [PLATFORM-MONOREPO.md](PLATFORM-MONOREPO.md) | Repository boundaries and deployment isolation | Its ASP.NET warnings remain in force |
| [DEPLOYMENT.md](DEPLOYMENT.md) | How the platform deploys | Describes the Laravel/React path; the `web-uk` path is not built yet |
| `aspnet-backend/docs/CURRENT_ASPNET_CONTRACT_STATUS.md` | The ASP.NET backend score | A **different** rubric. Never add it to the `web-uk` score |

🔴 **On the ~185 lines elsewhere that still call `web-uk` a candidate.** They were
left as written, deliberately. They are dated evidence records carrying commit
SHAs: rewriting them would destroy the audit trail, "certified" is a property of a
rubric row rather than of a page, and a find-and-replace would also corrupt the
legitimate uses where "candidate" describes *Blade's* behaviour. Each affected
document instead carries one short status header pointing here, and the retired W1
document redirects readers from its own first screen — so a pointer to it lands on
a redirect rather than on a stale number.

## Scoring surface

Four separate scores exist in this repository. Each names its own rubric, and a
CI check refuses a score marker that does not.

| Score | Rubric | Value | Measures | Status |
|---|---|---|---|---|
| `web-uk` production readiness | `WEBUK-W2-PROD-R1` | 592/1000 | Is `web-uk` safe to serve, and can Blade retire? | **Current** |
| `web-uk` Laravel-first parity | `WEBUK-W1-FIXED-R1` | 663/1000 | How closely does the candidate clone Blade? | Retired 2026-08-11 |
| ASP.NET contract identity | `ASPNET-CONTRACT-R1` | 712/1000 | Is ASP.NET externally contract-identical to Laravel? | Paused since 2026-07-15 |
| Documentation health | `DOCS-HEALTH-D3-R1` | 1000/1000 index | Documentation and handoff quality | Not a product score |

🔴 **The current 592 is lower than the retired 663 and nothing regressed.** The
W1 rubric scored no deployment path, no cutover, no rollback and no Blade
retirement. Those 200 points enter the new denominator for the first time and
start near zero, while three previously-measured areas improved. The mandatory
mapping table in the W2 document accounts for every W1 row. Do not convert one
number into the other, and do not describe either as "nearly finished".

## What is still fenced off

The takeover lifts the pause on `web-uk` work. It lifts nothing else.

- **The ASP.NET backend stays paused**, and its database boundary stays closed.
  Its live database has had no successful backup since 2026-03-08 while the
  application runs migrations on every start, so restarting that service can
  irreversibly change live data with nothing to restore from. See
  [PLATFORM-MONOREPO.md](PLATFORM-MONOREPO.md).
- **Nothing is deployed without explicit authorisation.** Building the deployment
  path is not permission to use it.
