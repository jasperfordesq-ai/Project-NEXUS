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
| Deployment path | **Built 2026-08-11, not exercised.** Container service, deploy-script support, `/version`, Apache include, domain inventory with a drift probe, and guards all exist. Nothing has been deployed and no cutover or rollback has been rehearsed. |
| Manual accessibility sign-off | **Partly done.** Keyboard, focus and reflow evidence exists. Screen-reader sign-off needs a human. |
| Blade retirement | **Not started.** A separate change with its own review, after a soak period. |

Current score: **631/1000** under rubric `WEBUK-W2-PROD-R1`. See the scoring
table below before comparing that with any earlier number.

## Prerequisites — four resolved, three still need owner answers

### ✅ Resolved

1. **Spare memory on the production VM — MEASURED 2026-08-11, and there is room.**
   The VM has 16 GB. Idle it uses 6.6 GB with 9.3 GB available. A deploy peaks at
   roughly 12.3 GB, because the React image build is given a 4 GB allowance and
   builds at the same time as the PHP image, while both colours stay running — so
   about 3 GB is spare at the worst moment.
   `web-uk` was then measured directly rather than estimated: **66.5 MB idle,
   71.3 MB peak** across ~260 requests over ten distinct templates, with the server
   process at 123 MB. Its limit is set to **384 MB** per colour, not the 512 MB
   originally planned — the measurement did not justify it.
   🔴 One separate finding worth knowing: the only out-of-memory kill on that
   machine (6 August) was the page-prerendering worker **hitting its own 3 GB
   container limit**, not the host running out. It sits at 99.99% of that limit
   permanently. More host memory would not have prevented it, and it has nothing to
   do with `web-uk`.
2. **Two free host ports** — **3500** (blue) and **3600** (green). Checked against
   the API ports (8090/8190), frontend ports (3000/3400/3100) and `web-uk`'s dev
   port (5180); a test asserts they stay distinct.
3. **A Redis database index that is not 0** — **index 4**. The Laravel cache store
   issues a flush, so sessions on index 0 would be destroyed by
   `php artisan cache:clear`, signing out every accessible-frontend user. The
   service refuses to start without this variable set.
4. **The list of community accessible domains** — no longer an owner task.
   `scripts/list-accessible-domains.sh` produces it read-only from the database,
   and `--check` probes each hostname's `/version` to report which frontend is
   actually serving it.

### Still needed from the owner

5. **`.claude/production-containers.md`.** `web-uk`'s own release runbook makes
   lifting its deployment hold conditional on a file that was never imported into
   this repository. As written, the hold cannot be lifted. Either import it or
   supersede it with a section in [DEPLOYMENT.md](DEPLOYMENT.md).
6. **Whether to publish per-tenant accessible domains** in the public uptime
   target list.
7. **An error-reporting project for `web-uk`.** Without one it would become an
   internet-facing production service with no error reporting. The service already
   reads a DSN if one is provided.

### 🔴 Also outstanding, and not an owner decision

**The Apache `Define` / `<IfDefine>` behaviour that makes rollback cheap is
unverified against the production Apache build.** The accessible vhost include
falls back to the PHP port when `NEXUS_WEBUK_PORT` is not defined, so that a
rollback to a release predating `web-uk` does not fail its own configuration test
and thereby abort the rollback. That must be confirmed with `apachectl configtest`
on the real server, in both states, **before** any cutover — not discovered during
a rollback.

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
