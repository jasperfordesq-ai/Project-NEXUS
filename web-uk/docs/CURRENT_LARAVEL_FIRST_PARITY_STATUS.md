# Current Laravel-First Accessible Frontend Status

Last audited: 2026-07-15 18:24 +01:00

Status: **Canonical current — sole Web UK coordination and scoring source**

<!-- doc-consistency: WEBUK_CURRENT_BANKED_SCORE=663/1000 -->

This is the sole current coordination and scoring document for `apps/web-uk`.
Read it before starting, resuming, or reporting accessible-frontend work. It
overrides older route, test, localization, and readiness counts in every
narrative handoff, while `BLADE_COMPONENT_PORT_AUDIT.md` remains the detailed
evidence ledger. `CURRENT_WEB_UK_HANDOFF.md` is a historical archive and must
never be used as a current resume, queue, count, or scoring source.

The root
[`ADR-0001`](../../../docs/decisions/ADR-0001-contract-identical-backends.md)
is binding for the later backend switch: ASP.NET must be externally
contract-identical to Laravel for this unchanged frontend. Web UK must not carry
an ASP.NET-specific workaround.

Development is paused. Read the root
[`PROJECT_PAUSE_HANDOFF_2026-07-15.md`](../../../docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md)
before using this queue. This page records the next packages but does not
authorize a session to start them.

## Current Goal Scope Correction

The active Web UK goal was corrected on 2026-07-15. Frontend completion no
longer depends on provisioning or using a disposable Laravel environment. The
four evidence tracks are now deliberately separate:

1. **Source-derived Web UK implementation parity:** required. Inspect Laravel
   Blade and backend source read-only, implement only in `apps/web-uk/**`, and
   prove behavior with static analysis, mocked contract tests, and Web UK-owned
   fixtures.
2. **Manual Web UK accessibility:** required. Exercise keyboard, focus,
   error-summary, no-JS, zoom/reflow, forced-colour, and screen-reader behavior
   against isolated Web UK fixtures without logging in to or mutating Laravel.
3. **Live Laravel runtime certification:** optional and outside this goal. Do
   not provision, request, or use a disposable Laravel environment unless the
   user separately authorizes that future workstream.
4. **ASP.NET switchability:** separate future backend-owned proof. It neither
   defines nor blocks Laravel-first Web UK implementation.

The frozen `663/1000` bank below remains an accurate record of the previous
fixed-rubric certification audit; it has not been rescored. It must not be used
as the completion percentage for the corrected frontend goal because 200 of
its points measure the now-optional live Laravel runtime track. At that same
snapshot, the already-audited source-derived implementation/hardening rows total
`628/650` (`99 + 292 + 190 + 47`), and manual accessibility remains separately
recorded as `35/150`. These are disaggregated historical results, not a new
audit or a claim of completion.

For status reporting, call the fixed-rubric certification snapshot **Web UK
Baseline W1** and the corrected source-owned goal **Web UK Goal W2**. W1 remains
`663/1000`. W2 has no percentage until a new complete audit defines and applies
its rubric. Report its finish line as **three explicit gates: one bounded
manual-accessibility evidence/fix package, one upstream accessibility-copy
parity decision, and one fixed-rubric W2 scoring/certification transaction**.
Do not silently convert W1 to a smaller denominator or describe either value as
“about finished.”

## Goal And Source Of Truth

`apps/web-uk` must become a complete observable-behaviour clone of the Laravel
Blade accessible frontend while retaining the Express/Nunjucks/GOV.UK Frontend
stack. In this documentation, "full-stack frontend" means the server-rendered
web application owns browser routes, Nunjucks rendering, sessions, CSRF,
progressive enhancement, form handling, redirects, and backend API mediation.
It does not own backend business logic, database schema, or persistence.

- Product/UI source of truth: Laravel Blade defines browser routes, links,
  layout, navigation, content hierarchy, forms, validation presentation,
  redirects, tenant behaviour, and workflows:
  `C:\platforms\htdocs\staging\accessible-frontend`
- Backend-contract source of truth: the Laravel backend defines HTTP methods and
  paths, request/response shapes, status codes, auth, roles, modules, uploads,
  downloads, persistence, and side effects:
  `C:\platforms\htdocs\staging`
- Target frontend: `C:\platforms\htdocs\asp.net-backend\apps\web-uk`
- Canonical public mount: `/{tenantSlug}/accessible`
- Canonical Hour Timebank evidence URL: `/hour-timebank/accessible` (and nested
  paths beneath it)
- Legacy `/{tenantSlug}/alpha`: redirect compatibility only
- Never use `/hour-timebank/alpha` as a comparison, browser-test, or evidence
  URL; it exists only to verify the legacy redirect.
- Current contract source: Laravel source, read-only
- Future second backend: ASP.NET, incomplete, not authoritative, and not
  certified

Laravel source and every Laravel database/environment are read-only from this
workstream. Do not solve a missing Laravel API by inventing frontend-only
behaviour, editing Laravel, running Laravel migrations, altering its schema,
querying its database directly, or performing database cleanup. Do not run live
login, mutation, upload, download, destructive, or cleanup tests against
Laravel. Verify state-changing frontend behavior from the read-only source
contract with mocked tests, static analysis, and Web UK-owned fixtures. Live
Laravel runtime certification is optional separate work, not a frontend
completion dependency.

ASP.NET is not a source of truth for this frontend and is not part of the
frontend implementation loop. Do not inspect it to decide frontend behaviour
and do not modify its controllers, services,
entities, tests, or migrations. The separate ASP.NET parity workstream must
make that backend satisfy the already-established Laravel contract. Later
switching proof must change backend configuration only and rerun the same
unchanged Web UK suite.

## Future Concurrent-Session Ownership (When Explicitly Resumed)

No session is authorized by this document while development is paused. If the
user explicitly resumes concurrent work, the accessible-frontend session owns
`apps/web-uk/**` only. The ASP.NET contract-identity session owns backend work,
including `src/Nexus.Api/**`, `tests/Nexus.Api.Tests/**`, and backend
migrations. During authorized concurrent work:

1. Run `git status --short` and `git log -1 --oneline` before every slice.
2. Preserve every unrelated dirty file. Never reset, restore, move, or stage it.
3. Stage explicit `apps/web-uk/...` paths; never use `git add -A` or
   `git commit -a`.
4. Keep one bounded frontend behavior and its evidence in each commit.
5. Recheck `HEAD` and the scoped diff immediately before staging because both
   sessions share this working directory.
6. If an unexpected `apps/web-uk` change appears, inspect ownership before
   editing the same file.
7. Do not recreate `apps/react-frontend` (deleted 2026-08-09) or touch any
   production container.

## Local Laravel Boundary Incident

This workstream violated the read-only boundary three times. The first incident
applied existing Laravel migrations and left mutation residue in the ordinary
local MariaDB database. After the 2026-07-13 recovery, the long-running frontend
session again used that restored production-derived snapshot for authenticated
settings changes and create/edit/delete/upload smoke journeys. The later phase
did not run Laravel migrations or change Laravel source, and its tests attempted
cleanup, but those facts do not make the writes acceptable or prove the snapshot
was unchanged.

On 2026-07-14 the later incident was repaired through an operator-approved
recovery. Before
repair, the local database was preserved outside both repositories as
`C:\platforms\backups\nexus-laravel-incident-20260714\local-before-recovery_20260714_043458.sql.gz`
and verified by gzip, dump-completion marker, and SHA-256. A new consistent,
single-transaction production dump was created read-only at
`/opt/nexus-php/backups/manual_backup_20260714_043554.sql.gz`, copied to
`C:\platforms\backups\nexus-laravel-incident-20260714\manual_backup_20260714_043554.sql.gz`,
and verified at both locations with SHA-256
`c5d93cd95424d22d981c41ca3ebe6fb73a75a993d18aeaf56145897a9eb606d8`.

The local `nexus` database was dropped and recreated only in the local Docker
Desktop context, then restored directly from that verified production dump.
No Laravel migration, schema-generation command, ASP.NET database operation, or
production data mutation was run. Production and restored-local fingerprints
match at 723 base tables, 286 migration rows, 11 tenants, and 360 users; both use
`utf8mb4_unicode_ci`. The local MariaDB event scheduler is off, and the Laravel
app and database returned healthy. The Laravel repository still matches
`origin/main` and retains only its pre-existing
`react-frontend/package-lock.json` modification and untracked `.codex/` path.

An independent safety refresh on 2026-07-14 created another read-only,
single-transaction production dump at
`/opt/nexus-php/backups/production-safety-20260714T043334Z.sql.gz`. Its external
workstation copy is
`C:\platforms\backups\nexus-laravel-incident-20260714\production-safety-20260714T043334Z.sql.gz`;
it is outside both repositories. Remote and local SHA-256 are both
`17523ce4183f41349d63f0732f593ca7ed58b04bc21bb9aa1025ea4667817163`.
The dump passed gzip and completion-marker checks and a full isolated MariaDB
restore. Fresh read-only inventories agree at 723 base tables, 286 rows in the
legacy `migrations` registry, 385 rows in `laravel_migrations`, 11 tenants, 360
users, and zero disposable `Codex` groups. A scan of every text-like column in
the ordinary local snapshot also returned zero `Codex` matches. Because the
ordinary local database already matches this fresh production inventory, it was
not dropped or reimported again during the independent refresh.

The third incident occurred later on 2026-07-14 when the complete
`test:accessibility` aggregate was incorrectly treated as read-only. Its login
journey submitted invalid credentials to ordinary local Laravel; Laravel's
failed-login limiter inserted two email-keyed attempt rows plus IP-keyed attempt
records. Frontend verification stopped immediately. Before repair, the affected
local database was preserved outside both repositories at
`C:\platforms\backups\nexus-laravel-incident-20260714\local-before-accessibility-recovery-20260714T050657Z.sql.gz`.
That forensic dump passed gzip and completion-marker checks and has SHA-256
`2c84cdf0c3842f72150c36a2f5e487abda026d15c8f54b76ea214fe4b859d070`.
The local `nexus` database was then dropped, recreated, and restored wholesale
from the independently verified production safety dump above; no individual row
cleanup was attempted. Post-restore read-only verification reports 723 base
tables, 286 legacy migration rows, 385 Laravel migration rows, 11 tenants, 360
users, zero matching failed-login email rows, both questioned migrations in
batch 96, the event scheduler off, and healthy database/application containers.
A fresh scan of 3,028 text-like columns reports zero `Codex` matches. The HTTP
health probe was inconclusive, so container health is recorded without claiming
a successful HTTP health response.

Consequences for this workstream:

- do not apply or roll back any Laravel migration;
- do not delete or repair any Laravel row;
- treat the ordinary local Laravel database as a confidential, production-data
  snapshot for read-only comparison, never as a disposable certification
  fixture;
- do not provision or run live Laravel mutation certification as part of the
  active Web UK goal. If the user explicitly authorizes that separate future
  workstream, it must never target the ordinary local database.

Do not append another general progress narrative to
`CURRENT_WEB_UK_HANDOFF.md`. Update this file only when the source SHAs,
blocker set, route-gap set, or certification state materially changes. Put
detailed row evidence in `BLADE_COMPONENT_PORT_AUDIT.md` in the same scoped
commit as the implementation it describes.

## Current Fixed-Rubric Re-audit

The current banked baseline is Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` with published Web UK
`2e92f89ee03177af02f0f16b669591604d3e6403`, audited at
`2026-07-15T07:09:13+01:00`; scoring record `b5b2c0a7` banked that snapshot. The
saved-search, Event Template pagination, shared-pagination, and shared empty-
state/back-link closures are included. Later published Web UK work remains
unscored as a block; ASP.NET backend files and its score remain outside this
workstream.

### Repository-State Boundary

- **Banked baseline:** Laravel `903d03d3db78bbf87129ad35728be3b72819acaf`
  with published Web UK `2e92f89ee03177af02f0f16b669591604d3e6403` and
  scoring record `b5b2c0a7`. This complete fixed-rubric re-audit supersedes the
  660-point checkpoint.
- **Published but unscored:** 38 later Web UK commits from `6b8b2725` through
  `6864f7be` are published; 29 contain product/test work. They include contract
  assertions, isolated accessibility controls, source-owned completion-track
  corrections, and production-build hardening. The generated-artifact refresh
  at `a3f18f06` records its dirty-state caveat. No later commit is converted
  into points until a complete audit names its rubric, evidence, deductions,
  and new total.
- **Published audit and public-copy delta:** documentation transaction `2d933f7c`
  removes part of the unsupported public keyboard/screen-reader assurance,
  updates focused tests, and replaces stale Web UK user/developer
  documentation. Follow-up `9a3337eb` corrects the local container contract.
  The audit reconciliation containing this page also withholds the remaining
  `accessibility.commitment_body` and `home.supporting_text` claims, which say
  the unmanually-certified service works well with keyboards and screen
  readers. Audit reconciliation `7339918b` and the publication-status
  transaction containing this page publish that delta, but it adds zero points
  until included in the next complete W2 audit.
- **Current repository boundary:** `origin/main` contains schema merge
  `df8c8b96c80804785e9c84f9f7c75337088d6024`, audit reconciliation
  `7339918be78148e4e5322aa69a1934e8f1b280c6`, and the publication-status
  transaction containing this page. The latest pre-audit Web UK product commit
  is `6864f7be`; the later published Web UK delta is the audit/public-copy/test
  correction above. All active task worktrees are clean. The delta remains
  unscored; unrelated backend/schema work contributes no Web UK points.

### Current Verification Gates

| Measure | Audited result | Meaning |
|---|---:|---|
| Laravel accessible HTML routes | 689 | Current source inventory at the named Laravel SHA |
| Web UK routes | 695 | Includes deliberate local compatibility routes |
| Matched Laravel routes | 688/689 (99.85%) | Declaration coverage only |
| Missing Laravel routes | 1 | Event offline check-in code generation |
| Extra Web UK routes | 5 | Four 404 tombstones plus one binary proxy |
| Ignored infrastructure routes | 3 | Health/root infrastructure |
| Jest | 55/55 suites, 1,755/1,755 tests at `6864f7be`; post-`2d933f7c` focused legal/accessibility proof 2/2 and generator/document proof 3 suites, 10/10 tests | The complete uninterrupted `--runInBand` run took 204.59 seconds at the named pre-audit Web UK product boundary. It was not rerun after the now-published audit changed the legal route, accessibility template, and focused test; do not present it as a current aggregate. |
| Brand, lint, and CSS | Passed | Current source gates |
| Locale catalog shape | 11 locales, 36 namespaces, 8,837 keys | Zero missing/extra structural keys |
| Static locale usage | 7,629 references, 5,814 unique keys, 0 unresolved | Complete post-suppression current-reference audit |
| Template localization | 322 templates, 0 conservative matches | Current hard-coded-copy audit |
| Blade marker check | Current rerun unavailable because Laravel port 8088 is not listening; preceding product `e2918257` passed 19/19 | Public GET marker comparison only; not screenshot or visual certification |
| Automated accessibility | The corrected isolated command enforces the finite safe selection and passes 24/24: 14 public structure/axe cases, 4 keyboard/focus/client-validation/reflow/forced-colour cases, and 6 default-English narrow-reflow/no-JavaScript cases. Its GET/HEAD-only mock rejected the earlier accidental authenticated login POST; caller-supplied grep arguments cannot widen the command to stateful cases. Product `b6166484` provides the manual-inspection mode over the same random-loopback fixture. | Current safe-fixture automated evidence is green. The browser connection has since been repaired, but the directed keyboard/zoom/visual and screen-reader package has not yet been performed; no manual outcome is claimed. Live Laravel and the stateful aggregate are outside Goal W2. |
| Frontend API consumer ledger | 668 contracts: 451 OpenAPI matches, 217 unmatched, 0 dynamic; all 217 unmatched contracts resolve to direct Laravel route declarations omitted from OpenAPI; 370 are state-changing and 0 lack detected tests. The finite direct-assertion manifest is complete: 0 rows and 0 helpers remain without direct assertions. | Static/mock ownership evidence. Every consumer helper now has direct mocked contract proof without using live Laravel. |
| Source-owned production hardening | Fail-closed production secrets, Redis-only persistent sessions, readiness-aware health, backend request deadlines, non-root image execution, lockfile-exact non-interactive installs, digest-pinnable Node base image, complete runtime assets, and fail-closed release/rollback documentation are implemented. Focused proof passes 4/4 suites and 79/79 tests; the production target builds; the resulting image runs as `appuser` and refuses unsafe configuration before listening; production dependency audit reports 0 vulnerabilities. | The frontend-owned hardening package is complete. Actual deployment, shared-session/failover observation, and release authorization remain a separate operations gate and do not block this goal. |

The table above preserves the named audit result. Under the corrected goal, the
absence of a disposable Laravel listener does not block Web UK implementation
or safe-fixture accessibility. Paired live-Laravel screenshots and the stateful
aggregate belong to the optional runtime track; representative Web UK visual
and manual review remains required through isolated frontend fixtures.

### Current Banked Score

| Fixed rubric | Earned | Exact deduction |
|---|---:|---|
| Route/inventory representation | 99/100 | -1: Laravel exposes no safe equivalent frontend contract for the offline signed Event check-in-code POST. |
| Observable Blade/workflow implementation | 292/300 | -8: Event moderation queue membership/order/`is_online` and check-in behavior remain upstream contract boundaries. Saved search, shared pagination, and shared empty-state/back-link rows are now implementation-closed. |
| API contract/state coverage plus static/mock verification | 190/200 | -10: exhaustive field-shape, publication, auth/role, status/error, and side-effect assertions are not complete for every significant contract. |
| Disposable Laravel runtime certification | 0/200 | -200: no separately provisioned and verified disposable Laravel application/database/storage environment exists, so live mutation/upload/download/destructive certification is open. |
| Screenshot/manual accessibility/WCAG certification | 35/150 | -40: no representative screenshot comparison set; -30: no screen-reader speech-output sign-off; -25: manual keyboard/no-JS/zoom/reflow/forced-colour coverage is incomplete; -20: the current full accessibility aggregate is not certified. |
| Production hardening and reproducible docs | 47/50 | -3: the implemented Redis-session, fail-closed secret, timeout/failure, readiness, and release controls still need deployed-environment proof. |
| **Laravel-first banked score** | **663/1000 (66.3%)** | Implementation-only subtotal is 581/600 (96.8%); it must never be reported as overall certification. |

The score moves **660 -> 663 (+3)** at this named snapshot. The three previously
deducted default-English component rows are implementation-closed by the
published saved-search recovery, exhaustive 34-pair pagination audit and cursor
fix, and final localized empty-state/back-link correction. Runtime stays 0/200
and manual/accessibility remains 35/150, so the score does not imply that the
frontend is ready for production.

ASP.NET switchability is not included in these 663 points. It remains a
separate backend-owned certification: the unchanged Web UK code must pass
against ASP.NET by configuration change only after that backend is ready.

### Finite P0/P1 Completion Queue

The corrected frontend-owned finish line has three explicit gates. Optional
live Laravel runtime work and future ASP.NET switching are not in this queue:

1. **P0 - Safe-fixture manual accessibility:** complete representative Web UK
   visual review plus keyboard, no-JS, zoom/reflow, forced-colour, focus/error,
   and screen-reader sign-off using only the isolated Web UK fixture server and
   mocked states. The enforced automated subset is green at 24/24. The browser
   connection is repaired, but directed manual and screen-reader review remains
   open and must be recorded without converting automated evidence into manual
   sign-off.
2. **P0 - Accessibility-copy source/parity decision:** Laravel Blade currently
   renders public keyboard/screen-reader assurances that the open manual package
   has not established. Web UK withholds those claims rather than publishing
   unsupported assurances, creating a deliberate observable-copy deviation.
   After gate 1, either evidence must support restoring the exact claims or the
   Laravel accessible-content owner must correct/approve the source contract.
   This audit did not modify the Laravel repository.
3. **P0 - Fixed-rubric W2 certification:** after any accessibility findings are
   fixed, the copy-parity decision is resolved, and the checkout is clean,
   define the W2 denominator and run the complete
   exact-SHA audit, record every deduction, and only then assign a W2
   percentage. This is a scoring gate, not an additional implementation
   package.
The source-contract assertion package is complete. The generated manifest now
contains zero rows: direct mocked tests exercise every previously outstanding
admin Job, Event/calendar/export, Exchange, Feed hashtag, Help/Knowledge Base,
Legal, Listing-tag, Match, Member, onboarding, Poll, Skill-taxonomy, Resource,
Event Template, and Wallet helper/path family. OpenAPI publication remains a
Laravel API-owner decision and does not block Web UK.

Two Laravel source-contract gaps remain recorded but do not block unrelated or
otherwise complete Web UK work: Event moderation queue membership/order plus
`is_online`, and the missing safe Event check-in-code POST. Web UK must not
fabricate either contract.

Checkpoint footer: W1 frozen bank `663/1,000`; W2 percentage `not assigned`;
frontend blocker owner `Web UK plus Laravel accessible-content owner/user`;
remaining evidence/fix package count `1`; remaining source-decision count `1`;
remaining scoring transaction count `1`; remaining finish-line gate count `3`.
Next tasks: start the isolated manual
browser; review representative default-English pages at desktop and 320 CSS
pixels; complete keyboard/focus/no-JS/zoom/forced-colour checks; capture
screen-reader findings; fix and re-verify any concrete accessibility
regression; resolve the public-copy source decision without silently diverging
from Laravel; then perform the fixed-rubric W2 audit before reporting a
completion percentage.

The exact Windows Update interruption and the pre-restart product boundary are
recorded in
[`RESTART_INCIDENT_2026-07-15.md`](../../../docs/RESTART_INCIDENT_2026-07-15.md).

## Superseded Dated Evidence Archive

Everything below this divider is append-only dated implementation evidence.
Its repeated statements that the bank remained 622/1000 were true before this
complete re-audit and are now historical. They do not override the current
score, repository boundary, or queue above, even where an old heading or
sentence used the word "current".

## 2026-07-15 Event Index Significant States

Frozen evidence refreshed at `2026-07-15T00:48:29.0651782+01:00` against
Laravel `903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`55aec02b6bb50290355762e1f037e65d2380a086`. The Event index now mirrors
Blade's calendar-feed and subscription links, 12-row collection request,
step-free venue filter, active-filter detection, and cursor preservation. Its
feature-disabled state now renders Blade's Event-specific `403` page and makes
no Event collection, category, or moderation request instead of falling into
the generic forbidden document.

Focused route/render/API proof passes `5/5`; the uninterrupted complete
non-mutating gate passes `52/52` suites and `1,695/1,695` tests. Brand, lint,
CSS, route matrix, API ledger, locale structure/static keys/templates, scoped
diff, and a fresh-current-container `19/19` canonical Blade marker comparison
are green. The generated inventory remains `688/689` matched routes and `668`
frontend contracts: `451` OpenAPI matches, `217` direct Laravel declarations
omitted from OpenAPI, zero undeclared or dynamic consumers, and `370`
state-changing contracts. No Laravel database, migration, authentication,
mutation, upload, download, cleanup, or production operation was performed.
This component-audit improvement remains published and unscored, so the frozen
bank remains `622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-15 Canonical Event Index Cards

Frozen evidence refreshed at `2026-07-15T00:52:55.5824862+01:00` against
Laravel `903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`211d45e3`. Event index cards now consume both Laravel's canonical nested
`schedule`, `location`, `metrics`, `relationship`, and `primary_image`
projection and its legacy flat compatibility projection. Canonical all-day
ranges use Blade's exclusive-end to inclusive-end conversion, event timezone,
All day label, zero-preserving attendee count, interested count, backend-origin
image, and relationship/contract data attributes. Nested locations no longer
risk rendering as `[object Object]`.

Focused legacy/canonical/filter proof passes `3/3`; the uninterrupted complete
non-mutating gate passes `52/52` suites and `1,696/1,696` tests. Brand, lint,
static-key, 322-template, generated route/API, and scoped diff gates are green.
No Laravel request, database, migration, authentication, mutation, upload,
download, cleanup, container, or production operation was performed for this
card-projection slice. It remains published and unscored, and the frozen bank
remains `622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-15 Event Archive Index States

Frozen evidence refreshed at `2026-07-15T00:57:56.5661904+01:00` against
Laravel `903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`0e24bbee`. The Event index now renders Blade's exact archived/deleted success
banner and archive-failure error summary from the bounded query states. These
states suppress the stale generic flash banner, preventing duplicate success
copy and restoring Blade's `event-archived-title` relationship.

Focused success/failure proof passes `1/1`; the uninterrupted complete
non-mutating gate passes `52/52` suites and `1,697/1,697` tests. Lint, generated
route/API, and scoped diff gates are green. No Laravel request, database,
migration, authentication, mutation, upload, download, cleanup, container, or
production operation was performed. This significant-state improvement remains
published and unscored, so the frozen bank remains `622/1,000` pending a
complete fixed-rubric re-audit.

## 2026-07-15 Saved Jobs Status Boundary

Frozen evidence refreshed at `2026-07-15T01:48:49.0540051+01:00` against
Laravel `903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`10538f3ddb7c79a053c00b6746fd8a63112c1337`. The Saved opportunities page now
renders only Blade's bounded `unsaved` success state, with the exact
`saved-status` labelling relationship and one catalog-backed message. Other
recognised Jobs status tokens no longer leak a generic banner onto the page.
The template-localization audit also uses Node-18-compatible Map grouping
instead of unsupported `Object.groupBy`.

Focused saved-state and audit proof is green. The uninterrupted complete
non-mutating gate passes `52/52` suites and `1,698/1,698` tests; brand, lint,
CSS, route inventory, API ledger, locale shape/static/template audits, scoped
diff, and the fresh canonical `19/19` Blade marker comparison are green. Route
inventory remains `688/689`; the ledger remains 668 contracts with 451 exact
OpenAPI matches, 217 direct Laravel declarations omitted from OpenAPI, zero
undeclared or dynamic consumers, 370 state-changing contracts, and zero rows
without tests. No Laravel authentication, database, migration, mutation,
upload, download, cleanup, or production operation was performed. This
component-audit improvement remains published and unscored, so the frozen bank
remains `622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-15 Listings Index Status Boundary

Frozen evidence refreshed at `2026-07-15T02:28:56+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`8db1c4ef1a5b959b29a51309a7df7cd475fde703`. The Listings index now renders
only Blade's bounded `listing-deleted` success state, with the exact
`listing-deleted-title` labelling relationship and catalog-backed deletion
copy. Invented create/update success states, exchange/delete error states, and
flash fallbacks no longer leak onto the browse page; unrelated tokens render
no banner.

Focused proof passes. Docker memory pressure prevented one uninterrupted
aggregate, so the complete non-mutating 1,699-assertion inventory was verified
as 51/52 suites and 1,698/1,699 assertions in a clean host-memory checkout plus
the separately green canonical-path tenant-source suite/assertion. Brand,
lint, CSS, locale shape/static/template audits, scoped diff, and the canonical
19/19 Blade-marker comparison are green. Static localization resolves 7,606
references and 5,799 unique keys with zero unresolved; 322 templates have zero
conservative matches. Route and API consumers were unchanged by this slice.
No Laravel authentication, database, migration, mutation, upload, download,
cleanup, or production operation was performed. This component-audit
improvement remains published and unscored, so the frozen bank remains
`622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-15 Listing Detail Status Boundary

Frozen evidence refreshed at `2026-07-15T02:37:37+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`89264d2ff6bf7f50569f846e811efa47cb577490`. Listing detail now separates
Blade's created/updated/delete-failed, saved/unsaved/renewed, action-failure,
and exchange-disabled/own-listing status families with their exact roles,
title IDs, error-summary structure, and catalog copy. Hard-coded success
flashes no longer override or outlive the bounded query state. Current Blade
does not render report outcome tokens on this page, so Web UK now leaves those
tokens silent while preserving honest secondary tag/image failure feedback.

Focused status and partial-failure proof passes. The complete non-mutating
1,700-assertion inventory is green as 51/52 suites and 1,699/1,700 assertions
in the clean host-memory checkout plus the separately green canonical-path
tenant-source suite/assertion. Brand, lint, CSS, locale shape/static/template
audits, scoped diff, and the canonical 19/19 Blade-marker comparison are green.
Static localization resolves 7,617 references and 5,804 unique keys with zero
unresolved; 322 templates have zero conservative matches. Route and API
consumers were unchanged. No Laravel authentication, database, migration,
mutation, upload, download, cleanup, or production operation was performed.
This component-audit improvement remains published and unscored, so the frozen
bank remains `622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-15 Feed Index Status Boundary

Frozen evidence refreshed at `2026-07-15T02:44:08+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`e2918257b16a322264774796cb513623b8e32899`. Feed index feedback is now
limited to the success, compose-error, and action-error query tokens rendered
by current `feed.blade.php`. Arbitrary session flash values from unrelated
routes are no longer consumed or exposed above Feed.

Focused success/unrelated-token proof passes. The complete non-mutating
1,701-assertion inventory is green as 51/52 suites and 1,700/1,701 assertions
in the host-memory checkout plus the separately green canonical-path tenant-
source suite/assertion. Brand, lint, CSS, locale shape/static/template audits,
scoped diff, and the canonical 19/19 Blade-marker comparison are green. Static
localization remains 7,617 references and 5,804 unique keys with zero
unresolved; 322 templates have zero conservative matches. Route and API
consumers were unchanged. No Laravel authentication, database, migration,
mutation, upload, download, cleanup, or production operation was performed.
The Markdown link gate passes 130 relative links across 74 files. The root-
owned documentation-consistency checker remains stale at 663/448/215 and
therefore rejects the current generated 668/451/217 ledger; this Web UK slice
does not rewrite truthful current evidence to satisfy that historical pin.
This component-audit improvement remains published and unscored, so the frozen
bank remains `622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-15 Direct-Message Inbox Status Boundary

Frozen evidence refreshed at `2026-07-15T05:28:10+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`81d456ba432afe7fcf6ec56687aa94419f43c757`. The direct-message inbox now
renders only Blade's archived/restored outcomes, with the exact
`messages-status-title` label relationship, success role, and catalog copy.
Arbitrary success flash values from unrelated routes are no longer consumed or
exposed on the inbox.

Focused populated/restored and unrelated-state proof passes `2/2`. The complete
non-mutating 1,702-assertion inventory is green as 51/52 suites and
1,701/1,702 assertions in the host-memory checkout plus the separately green
canonical-path tenant-source suite/assertion. Brand, lint, CSS, and locale
shape/static/template audits are green; static localization resolves 7,618
references and 5,804 unique keys with zero unresolved, and 322 templates have
zero conservative matches. The current public marker rerun was unavailable
because the read-only Laravel service at port 8088 was not listening while Web
UK returned 200; preceding product `e2918257` passed 19/19. Route and API
consumers were unchanged. No Laravel authentication, database, migration,
mutation, upload, download, cleanup, container, or production operation was
performed. This component-audit improvement remains published and unscored, so
the frozen bank remains `622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-15 Group Index And Detail Status Families

Frozen evidence refreshed at `2026-07-15T05:40:57+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`21fa17343e373e9db5b652b0380976b56a0ab5ec`. The Groups index now renders only
Blade's bounded `group-deleted` outcome with `groups-status`. Group detail
retains the create/update/join/leave and safeguarding/error families and now
also renders the previously missing feed-compose outcomes with Blade's
`grp-feed-status` success relationship or paragraph error summary. Both pages
ignore unrelated query tokens and no longer consume arbitrary session flash.

Focused status-family and safeguarding proof passes `2/2`. The complete
non-mutating 1,703-assertion inventory is green as 51/52 suites and
1,702/1,703 assertions in the host-memory checkout plus the separately green
canonical-path tenant-source suite/assertion. Brand, lint, CSS, and locale
shape/static/template audits are green; static localization resolves 7,625
references and 5,805 unique keys with zero unresolved, and 322 templates have
zero conservative matches. Laravel port 8088 remains unavailable while Web UK
returns 200, so the public marker gate is not rerun. Route and API consumers
were unchanged. No Laravel authentication, database, migration, mutation,
upload, download, cleanup, container, or production operation was performed.
This component-audit improvement remains published and unscored, so the frozen
bank remains `622/1,000` pending a complete fixed-rubric re-audit.

Package-10 progress: the Listing index/detail/form, Feed hashtag/permalink, and
Message conversations component rows, plus Groups index/forms/detail, are now
implementation-closed or assigned to explicit upstream/certification owners.
Their remaining side-effect/runtime, manual-accessibility, tag-persistence and
group-reaction projections, and backend-switching proof belongs to the
disposable-runtime packages, package 11, Laravel API ownership, and the separate
ASP.NET readiness score; this classification adds no banked points.

### Superseded Pre-Correction P0/P1 Completion Queue

The following 12-package queue is historical and is not a current resume list.
Its disposable-runtime packages were removed from the active frontend goal by
the scope correction at the top of this document. Do not expand it
with route-by-route Arabic tests or cosmetic exploration; split a package only
when a concrete regression requires an independently publishable fix.

1. **P0 - Disposable environment:** provision and verify an isolated Laravel
   application/database/storage environment that cannot address the ordinary
   production-derived database; record identifiers, schema/source SHA, and
   reset proof. Owner: environment/operator.
2. **P0 - Runtime foundation:** run the current authentication, tenant, role,
   module/feature, empty/populated, validation, and authorization matrix only
   in that disposable environment. Owner: Web UK after item 1.
3. **P0 - Identity/value side effects:** certify account/profile/settings,
   sessions/passkeys, wallet/transfers/donations, messaging/connections, and
   cleanup. Owner: Web UK after item 1.
4. **P0 - Community side effects:** certify feed, comments/reactions, groups,
   generic listings, events, polls, goals, and cleanup. Owner: Web UK after
   item 1.
5. **P0 - Commerce/work side effects:** certify marketplace, jobs,
   volunteering, organisations, podcasts, resources, uploads/downloads, and
   cleanup. Owner: Web UK after item 1.
6. **P0 - Privileged/export side effects:** certify administrator/owner
   actions, moderation, binary exports, destructive confirmations, and final
   absence. Owner: Web UK after item 1.
7. **P0 - Event moderation boundary:** obtain a Laravel API projection with
   Blade-equivalent queue membership, submission order, and `is_online`, then
   consume it unchanged in Web UK. Owner: Laravel backend/API workstream.
8. **P0 - Event check-in boundary:** obtain a safe Laravel offline signed-code
   contract or an explicit source-contract decision for
   `POST /events/{id}/check-in/code`. Owner: Laravel backend/API workstream.
9. **P1 - API ledger closure:** Web UK consumer resolution is complete: zero
   consumers lack a direct Laravel declaration and zero are dynamically
   unresolved. Decide whether the 216 declared routes require OpenAPI
   publication. Owner: Laravel API owner for the remaining OpenAPI decision.
10. **P1 - Component-audit closure:** finish the remaining default-English
    significant-state rows and mark each closed, upstream-blocked, or
    certification-only with evidence. Owner: Web UK.
11. **P1 - Visual and manual WCAG:** capture the representative Blade/Web UK
    screenshot set and complete keyboard, no-JS, zoom/reflow, forced-colour,
    focus/error, and screen-reader sign-off. Owner: accessibility reviewer with
    Web UK support.
12. **P1 - Production hardening:** persistent Redis session configuration,
    fail-closed production secrets, request timeout/abort implementation, Redis-
    aware readiness, and the fail-closed release runbook are published. Lift
    the documented deployment hold explicitly and prove those controls in a
    deployed environment. Owner: operations with Web UK support.

The generated route matrix was refreshed against the same route inventories
and reports the counts above. It remains declaration evidence, not runtime or
workflow certification.

## Frontend-Consumer API Ledger

`npm run api:ledger` now generates
`docs/generated/frontend-api-consumer-ledger.json` and its Markdown index from
the current `src/lib/api.js`, actual Web UK source consumers, test references,
and Laravel's read-only `openapi.json`. Every JSON row records method/path,
request-scoped tenant authority, auth/role boundary, request and response shape,
status/error behavior, redirects, side effects, cleanup requirements, Laravel
operation/controller metadata, frontend consumers, and detected tests.

The current static inventory contains 667 consumed contracts. It matches 451
method/path pairs to Laravel OpenAPI, leaves 216 without an exact OpenAPI match,
and has no dynamically unresolved method/path callsites. Every unmatched row
resolves to a direct Laravel route declaration. It also classifies 370
rows as state-changing and therefore requiring disposable-
environment runtime proof. An unmatched row may be an OpenAPI documentation
gap, a frontend contract gap, or a generator-normalization gap; it is not proof
that Laravel lacks the endpoint. A detected test reference is not proof that
the test asserts the full contract. These unresolved classifications are now a
concrete reconciliation queue rather than hidden readiness debt.

Focused generator proof passes 2 suites and 7 tests. The latest complete Web UK
gate is recorded in the top snapshot rather than duplicated here. Brand, lint,
CSS, route matrix, ledger regeneration, locale sync/shape, static-key
resolution, and the 322-template zero-match audit are green. A fresh
current-checkout `visual:blade` run passed all 19/19
unauthenticated GET comparisons at the canonical `/hour-timebank/accessible`
mount. This remains a text-marker spotcheck, not screenshot or visual
certification.

## API Ledger Root Contract Classification

The ledger generator now distinguishes an explicit empty wrapper child path
from an unknown path. Root calls such as `GET /api/v2/coupons`,
`POST /api/v2/courses`, and `PUT /api/v2/users/me` are no longer collapsed into
`/{dynamic}` buckets. A focused generator regression proves that a root wrapper
call matches its Laravel OpenAPI operation.

This correction reduces dynamic rows from 17 to 9 and separates one previously
collapsed contract, producing 591 total contracts, 377 exact OpenAPI matches,
205 unmatched rows, 284 state-changing rows, and zero rows without detected
tests. It improves evidence accuracy but earns no completion points by itself:
the fixed banked score remains 622/1000 until a real contract, workflow, or
certification gap closes.

A follow-up makes the finite Feed hashtag search/trending reads and Event
submit/publish transitions explicit at their callsites. Existing four-case
hashtag and two-transition behavior proof remains green. The current inventory
therefore separates 593 contracts, matches 381 to OpenAPI, and leaves 205
unmatched plus 7 genuinely dynamic rows. This is still classification accuracy,
not a new product capability, so the banked score does not move.

The generator now also resolves two-hop route aliases such as
`runAction -> callApi -> callIdeationApi` and suppresses the internal generic
calls once their finite callers are expanded. Focused multi-hop generator proof
passes. This exposes 52 contracts previously hidden inside dispatcher buckets:
the current ledger contains 645 contracts, 419 OpenAPI matches, 223 unmatched
rows, 349 state-changing rows, 3 genuinely dynamic dispatchers, and zero rows
without detected tests. The frozen score remains unchanged because this is a
more accurate inventory, not a completed workflow or certification gate.

Object-configured dispatchers are now expanded as well: a finite caller such as
`runOpportunityAction(req, res, { method, path, data })` resolves those literal
properties through the same wrapper chain. Focused proof passes. The current
ledger therefore records 647 contracts, 422 OpenAPI matches, 223 unmatched
rows, 352 state-changing rows, and only 2 branch-built dynamic dispatchers.

The final branch-built exchange and Event dispatchers are now finite at source.
Exchange accept, decline, start, complete, confirm, and cancel helpers own
explicit Laravel method/path pairs; Event Safety, Agenda, and registration-form
branches likewise call explicit method/path pairs after retaining their existing
validation and payload construction. Focused API, exchange, Safety, Agenda, and
registration proof passes. The ledger now records 662 contracts, 439 exact
OpenAPI matches, 223 unmatched rows, 369 state-changing rows, zero dynamic
rows, and zero rows without detected tests. This closes dynamic classification,
not the unmatched-contract or disposable-runtime queues, so the frozen banked
score remains 622/1000.

## Event Broadcast Contract Correction

Event Communications history, schedule, cancel, and retry now use Laravel's
top-level `/api/v2/event-broadcasts/{broadcastId}` resource. They previously
passed `/event-broadcasts/...` through the Event helper, which incorrectly
produced `/api/v2/events/event-broadcasts/...`; mocked route tests asserted only
the child path and therefore did not expose the bad prefix. A dedicated
backend-neutral helper now owns the exact top-level Laravel prefix, preserves
bearer and idempotency headers, and exposes schedule, cancel, and retry as finite
contracts. Focused API and Event Communications proof passes. The ledger now
records 663 contracts, 441 exact OpenAPI matches, 222 unmatched rows, 369
state-changing rows, zero dynamic rows, and zero rows without detected tests.
This closes one concrete contract regression but does not by itself certify
live delivery side effects or the broader unmatched queue; the banked score
remains 622/1000 pending the next complete scored audit.

## Event Registration Contract Classification

The remaining recent Event ledger gaps are now concrete. Registration form
publish/fork and invitation campaign issue/schedule/cancel use explicit Laravel
method/path pairs instead of action-parameter placeholders. Registration answer
export now has a dedicated binary helper for Laravel's exact
`POST /api/v2/events/{id}/registration-product/submissions/export` contract;
the generic download wrapper previously caused the ledger to misclassify that
consumer as GET even though runtime correctly overrode the method. Focused API,
form, campaign, review, and export proof passes. The ledger now records 663
contracts, 444 exact OpenAPI matches, 219 unmatched rows, 370 state-changing
rows, zero dynamic rows, and zero rows without detected tests. All current
recent-Event consumer rows now have concrete method/path classification. This
is static/mock contract closure, not disposable mutation/export certification,
so the banked score remains 622/1000.

## Public Authentication Required-State Parity

The default-English login form now exposes native `required` states for email,
password, and the root-domain community-code field, matching the Laravel Blade
controls while retaining Web UK's progressive client validation. Rendered-output
regression coverage proves the attributes. A read-only browser audit against a
fresh local Web UK process also confirmed one main landmark and H1, valid home
heading progression, no duplicate IDs, unnamed controls, empty links, missing
image alternatives, or horizontal overflow, plus clean home/login reflow at
320 CSS pixels. Synthetic Tab traversal did not move focus in the browser-control
environment, so keyboard order, focus visibility, screen-reader output, and the
remaining manual WCAG matrix are still explicitly uncertified. This evidence
does not change the banked 622/1000 score without a complete rubric re-audit.
The reset-password form also now matches Blade's deliberate native-state
contract: both password controls disable spellcheck and only the confirmation
control carries `required`. Focused rendered-output coverage protects those
exact attributes without widening the source contract.

## Password Reset Request Confirmation Parity

Checkpoint frozen at `2026-07-14T12:21:00+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK base
`1871130ed5dff15e5333f4110d46f44395c1ae53`. Both bases matched
`origin/main`; this checkpoint's Web UK change was in flight and the only other
dirty files belonged to the separate ASP.NET workstream.

The mounted forgot-password `forgot-sent` state now matches Blade's deliberate
standalone confirmation page instead of rendering an in-page notification
banner above the request form. It has one `Check your email` H1, the large
confirmation detail, mounted resend and sign-in links, no request form, and the
source back link. The ordinary request state also restores Blade's large lead
paragraph. Malformed addresses now retain Blade's linked email error without
calling Laravel, while a rate-limited response remains in the page-level error
summary without incorrectly marking the email field invalid. Focused
confirmation proof passed `3/3` suites and `804/804` tests; focused validation
proof passed `2/2` suites and `789/789` tests. The complete gate remained
`49/49` suites and `1,653/1,653` tests after both changes. The complete
non-mutating checkpoint also retains route inventory `688/689`, API ledger
`663/444/219/0`, 11-locale
catalog sync/shape, `7,341` static references with `0` unresolved, the
322-template zero-match audit, and the current 19/19 Blade marker comparison.
No Laravel mutation/runtime smoke ran. This closes one concrete
default-English significant state but does not remove the complete 14-point
component-audit deduction, so the banked score remains `622/1000` pending a
complete rubric re-audit.

## Two-Factor Login Workflow Parity

Checkpoint frozen at `2026-07-14T12:42:00.9631927+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK base
`8f63d2bc39f8bac1c19bc7d982e33e225f7145ec`. Both bases matched
`origin/main`; this checkpoint's Web UK change was in flight and the remaining
dirty files belonged to the separate ASP.NET workstream.

The mounted two-factor login state now accepts Laravel backup codes instead of
forcing a numeric six-digit pattern, exposes Blade's backup-code choice, and
shows the trusted-device choice only when Laravel's login response permits it.
Web UK preserves Laravel's configured trusted-device duration, submits
`use_backup_code` and `trust_device` to the exact verification contract, and
forces `trust_device=false` when the backend disables that capability. The
page also restores Blade's top back link, large lead paragraph, code-linked
error summary, and inline error/ARIA relationship. Focused verification passed
`4/4` suites and `1,014/1,014` tests. The complete non-mutating gate passed
`49/49` suites and `1,654/1,654` tests, brand, lint, CSS, route inventory
`688/689`, API ledger `663/444/219/0`, all localization audits, and the
refreshed 19/19 canonical Blade marker comparison. No Laravel login,
verification, mutation, database, or migration operation ran. This closes a
concrete default-English authentication substate but does not remove the full
14-point component-state deduction without a complete rubric re-audit, so the
banked score remains `622/1000`.

## Login Error And Verification-Resend State Parity

Checkpoint frozen at `2026-07-14T13:08:25.2667233+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK base
`76d758a8982b08258026b9ba04e5a662c4d5d95d`; both matched `origin/main`
before this Web UK-only slice.

The default-English login page now preserves Blade's significant error-state
structure, not only its translated messages. Failed credentials link the error
summary to the email input and render the matching inline error/ARIA
description. Unverified and pending accounts link to and render Blade's
resend-verification email form with the submitted address preserved. Two-factor
required/expired, rate-limited, and suspended states link to main content and do
not falsely mark the email field invalid. Direct Laravel error codes now carry
the same explicit state into rendering. Focused verification passed `3/3`
suites and `801/801` tests; the complete gate passed `49/49` suites and
`1,655/1,655` tests with green brand, lint, CSS, and localization audits. No
Laravel request, mutation, database, or migration operation ran. This closes
another concrete authentication substate but does not independently remove the
complete component-state deduction, so the banked score remains `622/1000`.

## Parallel Session-Rotation Retry Parity

Checkpoint frozen at `2026-07-14T13:18:32.5468960+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK base
`8193cd3870432688e397c6a5681d190fa2e1f58f`; both matched `origin/main`
before this Web UK-only slice.

Laravel refresh credentials are single-use. Web UK's retry-on-401 path now
uses the same tenant-scoped, digest-keyed in-process rotation lock as its
pre-route expiry path, so parallel requests cannot independently spend the
same refresh credential. Focused concurrency proof launches two simultaneous
401 retries and verifies one Laravel refresh call, two successful handler
retries, and the complete rotated access/refresh cookie state on both
responses. The focused session gate passes `8/8`. No Laravel request,
mutation, database, or migration operation ran. The complete non-mutating gate
passes `49/49` suites and `1,656/1,656` tests with green brand, lint, CSS,
route inventory `688/689`, API ledger `663/444/219/0`, 11-locale catalog
sync/shape, `7,347` static references with zero unresolved keys, and the
322-template zero-match audit. This fixes a concrete session-hardening
regression risk but does not change the banked `622/1000` score without a
complete rubric re-audit.

## Logout Confirmation State Parity

Checkpoint frozen at `2026-07-14T13:24:14.8139762+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK base
`a45568158a72bfcb3a501f35392a8a3b2e5e67ed`; both matched `origin/main`
before this Web UK-only slice.

Successful logout now redirects through the active accessible mount to
`/login?status=signed-out`, matching Laravel Blade instead of silently
discarding its already-supported confirmation state. Focused mounted proof
passes `69/69` and verifies the visible `You have signed out.` success banner
after the complete local cookie set is cleared. The mocked route still submits
both access and refresh credentials to Laravel's logout contract; no Laravel
request, mutation, database, or migration operation ran. The complete
non-mutating gate remains green at `49/49` suites and `1,656/1,656` tests with
green lint and branding. This closes one default-English authentication state
but does not independently remove the complete component-state deduction, so
the banked score remains `622/1000`.

## Account-Deletion Revocation Evidence

Checkpoint frozen at `2026-07-14T13:29:33.0546716+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK base
`183c8e7b2750c5a4e9d0dbc3b191e69ae92b5bb2`; both matched `origin/main`
before this Web UK-only slice.

Laravel's hardened erasure contract revokes every active session before
returning `logout_required: true`. Web UK now requires that exact evidence
before clearing its own cache, Express session, and auth cookies. Missing or
false evidence fails closed to the deletion form and preserves the signed-in
session rather than presenting a false successful sign-out. Focused coverage
passes `12/12` across missing, false, success, error, mounted, and cookie
states. No Laravel request, erasure, database, or migration operation ran.
The uninterrupted full rerun passes `49/49` suites and `1,659/1,659` tests.
This strengthens a destructive identity boundary but does not change the
banked `622/1000` score without a complete rubric re-audit.

## Revoked-Session Success Confirmation Parity

Checkpoint frozen at `2026-07-14T13:43:46.0480638+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK base
`091de6c911e60f373da8ec04a563d87dd2ac51a5`; both matched `origin/main`
before this Web UK-only slice.

Password change and TOTP disable atomically revoke Laravel sessions, so Web UK
must clear its local cookies and Express session. Their former success
redirects targeted protected pages and therefore immediately collapsed into
an auth-required redirect without showing the result. Both now use mounted
signed-out login states while preserving Laravel's exact `Your password has
been changed.` and `Two-step verification has been turned off.` success copy.
Focused route/status proof passes `25/25` plus `2/2`. No Laravel credential
mutation, request, database, or migration operation ran. This closes two
observable default-English identity states but does not independently remove
the complete component-state deduction, so the banked score remains
`622/1000`. The uninterrupted complete gate passes `49/49` suites and
`1,661/1,661` tests, and lint is green.

## Group Conversation Ledger Path Reconciliation

Checkpoint frozen at `2026-07-14T14:32:02.9843843+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK base
`bba2afad65cee2b91996b7e6cc1c0774582ea7ba`; both matched `origin/main`
before this Web UK-only slice.

The group-conversation message read now keeps its method/path template static
at the API callsite while a helper builds only the query string. Runtime output
is unchanged at
`GET /api/v2/conversations/{id}/messages?per_page=50&direction=older...`, and
focused rendered-contract proof passes `1/1`. The ledger now records that real
path instead of the false `/api/v2/conversations/{param}` path. Laravel declares
the real route in `routes/api.php`, but its OpenAPI file omits it, so the honest
aggregate remains `663/445/218/0`; this is a reconciled OpenAPI-documentation gap,
not a frontend path defect. No Laravel request, mutation, database, migration,
upload, or download operation ran, and the banked score remains `622/1000`.

## Podcast Method-Spoof Ledger Reconciliation

Checkpoint frozen at `2026-07-14T14:13:51.7066412+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK base
`9c5fb1a46c40e4986c8f973075164b1d74bd101d`; both matched `origin/main`
before this Web UK-only slice.

The consumer-ledger generator now treats a multipart `POST` carrying Laravel's
`_method=PUT` field as the effective `PUT` contract. This preserves Web UK's
PHP-compatible podcast audio upload transport while matching the declared
`PUT /api/v2/podcasts/{showId}/episodes/{episodeId}` operation. Focused
method-spoof proof passes `1/1`; the combined generator gate passes `4/4` in
the current worktree. Regeneration reports `663` contracts, `445`
exact OpenAPI matches, `218` unmatched rows, `0` dynamic rows, and `370`
state-changing rows. No Laravel request, mutation, database, migration, upload,
or download operation ran. This reconciles one false ledger mismatch but does
not independently change the frozen API-depth deduction, so the banked score
remains `622/1000`.

## Podcast Episode Visibility Labels

Podcast studio episode visibility selects now follow Blade's exact catalog
mapping: only `inherit` uses `episode_visibility_inherit`; `public`, `members`,
and `private` use the show-level visibility labels. This prevents nonexistent
dynamic translation keys from appearing as option text. Focused default-English
render proof passes 1/1, the full Jest gate remains 49/49 suites and 1,637/1,637
tests, and lint, localization-key, template-localization, CSS, and brand gates
are green. No Laravel request, upload, mutation, or database access was used.

## Marketplace Collection And Pickup-Slot Refresh

Buyer collections and seller pickup-slot pages now mirror current Blade copy,
caption hierarchy, status labels, collection-window formatting, QR guidance,
visually hidden table caption, form sections, controls, warnings, and actions
through Laravel's exact commerce catalogs. The older invented collection
description and `Picked up`/`No show` labels are replaced by Blade's `Collected`
and `Missed` contract. Focused rendered proof passes 3/3 after correcting one
route-harness regression; the final full Jest rerun passes 49/49 suites and
1,637/1,637 tests. Lint, localization-key, template-localization, CSS, and brand
gates are green. No Laravel request, mutation, upload, or database access ran.

## Marketplace Advanced Search Refresh

Marketplace advanced search now follows current Blade for its caption, complete
filter labels and options, `condition[]` checkbox field contract, actions,
empty/results states, and minimal result-card hierarchy. It no longer renders
the richer browse card inside search results or carries older hard-coded form
copy. Focused default-English render proof passes 1/1; the final full Jest gate
passes 49/49 suites and 1,637/1,637 tests. Lint, localization-key,
template-localization, CSS, and brand gates are green. No Laravel request,
mutation, upload, or database access ran.

## Marketplace Listing Detail Refresh

Marketplace listing detail now mirrors current Blade's caption, gallery
alternatives and new-tab announcement, multiline description, location label,
offer/save actions, seller-message action, and report action. The Web UK-only
query-status banner was removed because Blade does not render it on this page.
Focused default-English detail and hybrid-price proof passes 2/2; the complete
Jest gate passes 49/49 suites and 1,637/1,637 tests. Lint, CSS, brand, the
7,189-reference / 5,487-unique-key zero-unresolved audit, and the 322-template
zero-match audit are green. No Laravel request, mutation, upload, download, or
database access ran.

## Marketplace Order Dashboard Refresh

Buyer and seller order dashboards now follow Blade's exact captions, tabs,
status labels, summaries, notification banners, action copy, confirmation and
cancellation warnings, and rating controls through Laravel's commerce and
safeguarding catalogs. Paid orders no longer expose the cancellation action
that Blade reserves for `pending_payment`; rating failures now preserve
Laravel's policy-unavailable and interaction-restricted outcomes. Focused
dashboard/action proof passes 3/3, the title-localization gate passes 29/29, and
the complete Jest gate passes 49/49 suites and 1,640/1,640 tests. Lint, CSS,
brand, route, ledger, 7,234-reference / 5,523-unique-key zero-unresolved locale,
and 322-template zero-match gates are green. No Laravel request, mutation,
upload, download, or database access ran.

## Marketplace Seller Profile Refresh

Seller profiles now follow Blade's exact back link, caption, summary labels,
localized rating and sales text, month-and-year membership date, listing
heading, and empty state. Sales totals follow Blade by appearing only when the
profile also has ratings. Web UK no longer treats Laravel's email-verification
field as Blade's identity-verification badge; because the current seller API
does not expose Blade's `id_verified` evidence, that trust tag fails closed and
remains an upstream contract gap. Focused seller-state proof passes 2/2, and the
complete Jest gate passes 49/49 suites and 1,641/1,641 tests. Lint, CSS, brand,
route, ledger, 7,239-reference / 5,530-unique-key zero-unresolved locale, and
322-template zero-match gates are green. No Laravel request or database access
ran.

## Marketplace Seller Coupon Workflow Refresh

Seller coupon list, create, and edit now follow Blade's exact default-English
commerce catalogs, caption hierarchy, notification and error-summary semantics,
visually hidden table caption, discount formatting, status tags, radio IDs,
optional labels, controls, and destructive warning. The seller coupon family
now fails closed before an API call when `merchant_coupons` is disabled.

Create and update apply Blade's title plus positive non-BOGO discount validation,
preserve zero as a valid minimum order, and replay bounded submitted values once
after local or Laravel `422` rejection. Focused coupon proof passes 6/6; the
complete Jest gate passes 49/49 suites and 1,643/1,643 tests. Brand, lint, CSS,
route, 19/19 current-source Blade markers, 7,280-reference / 5,565-unique-key
zero-unresolved locale, and 322-template zero-match gates are green. The ledger
now records 586 contracts: 371 OpenAPI matches, 198 unmatched, 17 dynamic, and
280 state-changing. No live coupon mutation or database access ran.

## Marketplace Merchant Onboarding Refresh

Merchant onboarding now uses Laravel's actual
`/api/v2/merchant-onboarding` contract instead of the incorrect
`/api/v2/marketplace/merchant-onboarding` prefix. Submission follows Blade's
`step-1`, optional `step-2`, then `complete` sequence, so business registration
and address data are no longer silently discarded. The page now uses Blade's
exact default-English hierarchy, copy, control IDs, banners, validation order,
and one-use bounded input replay after local or Laravel rejection.

Focused onboarding, API, localization, and ledger proof is green; the complete
Jest gate passes 49/49 suites and 1,645/1,645 tests. Brand, lint, CSS, route,
19/19 current-source Blade markers, 7,304-reference / 5,586-unique-key
zero-unresolved locale, and 322-template zero-match gates are green. The ledger
records 589 contracts: 371 OpenAPI matches, 201 unmatched, 17 dynamic, and 283
state-changing. Verification used mocks and read-only public GET comparisons;
no Laravel mutation or database access ran.

## Marketplace Listing Report Workflow Refresh

The listing-report page now mirrors Blade's exact default-English catalog,
caption and summary hierarchy, reason labels and IDs, warning action, cancel
link, error summary, inline errors, and described textarea. Local validation
distinguishes the required reason and description instead of collapsing both
into one message, and bounded submitted values replay once after local or
Laravel `422` rejection. Unexpected Laravel failures now return to listing
detail with Blade's `report-failed` outcome rather than inventing an error state
on the form page.

Focused report render, validation, replay, API rejection, generic failure, and
successful contract proof passes 3/3. The complete Jest gate passes 49/49
suites and 1,646/1,646 tests. Brand, lint, CSS, route, 19/19 current-source
Blade markers, 7,315-reference / 5,594-unique-key zero-unresolved locale, and
322-template zero-match gates are green. The ledger records 590 contracts: 371
OpenAPI matches, 202 unmatched, 17 dynamic, and 284 state-changing. No live
report was submitted and no Laravel database access occurred.

## Marketplace My Listings Ownership And Blade Refresh

The signed My listings page now loads the authenticated Laravel profile first
and calls the Laravel marketplace index with
`limit=100&user_id={authenticatedUserId}`. Laravel accepts that own-listings
filter only when it matches the bearer identity. A missing profile ID now fails
closed before any listings request, rather than falling back to the unscoped
browse collection and potentially showing other sellers' records.

The page now uses Blade's exact default-English caption, description, create
action, status banner, tab labels, tab-specific empty states, and view, edit,
renew, and delete labels instead of hard-coded copy and unrelated Jobs keys.
Focused render/contract and missing-identity proof passes 2/2. The complete
Jest gate passes 49/49 suites and 1,646/1,646 tests; brand, lint, CSS, route,
7,322-reference / 5,602-unique-key zero-unresolved locale, and 322-template
zero-match gates are green. The ledger remains 590 contracts: 371 OpenAPI
matches, 202 unmatched, 17 dynamic, and 284 state-changing. No Laravel
mutation, database access, upload, or download ran.

## Marketplace Saved Items Refresh

Saved items now uses Blade's exact default-English caption, title,
description, empty state, remove action, and success-banner structure through
the Laravel commerce catalog. The page accepts only Blade's `unsaved` outcome;
unrelated marketplace query statuses no longer leak into this surface. The
existing authenticated read remains Laravel's canonical
`GET /api/v2/marketplace/listings/saved?limit=50`, and unsave retains the exact
hidden `redirect_to=saved` contract.

Focused populated/empty/status proof passes 2/2. The complete Jest gate passes
49/49 suites and 1,647/1,647 tests; lint and the 7,328-reference /
5,607-unique-key zero-unresolved locale and 322-template zero-match audits are
green. The route matrix remains 688/689 and the ledger remains 590 contracts,
with no untested consumer. No Laravel mutation or database access ran.

## Marketplace Free Items Refresh

Free items now uses Blade's exact default-English caption, title, description,
and empty state through the Laravel commerce catalog. Its sub-navigation state
also matches Blade: the source assigns the `free` active key but exposes no
Free tab, so Web UK no longer incorrectly highlights Browse. The authenticated
read remains Laravel's canonical
`GET /api/v2/marketplace/listings/free?limit=50`.

Focused populated/empty/navigation proof passes 2/2. The complete Jest gate
passes 49/49 suites and 1,648/1,648 tests; lint and the 7,332-reference /
5,611-unique-key zero-unresolved locale and 322-template zero-match audits are
green. Route/API inventories are unchanged, and no Laravel mutation or
database access ran.

## Marketplace Category Browse Contract And Blade Refresh

Category browsing now resolves the Laravel category first and sends its
numeric ID as `category_id` to the marketplace index while preserving `q`.
The previous `category={slug}` parameter is not part of Laravel's index
contract and could return unfiltered marketplace results. Unknown slugs now
return 404 after the categories read and before any listing collection call.

The page also uses Blade's exact default-English back link, caption, plural
count, search label/hint/action, and empty-state hierarchy. Focused filtered
render and unknown-category fail-closed proof passes 2/2. The complete Jest
gate passes 49/49 suites and 1,649/1,649 tests; lint and the 7,339-reference /
5,618-unique-key zero-unresolved locale and 322-template zero-match audits are
green. Route/API inventories remain unchanged, and no Laravel mutation or
database access ran.

## Marketplace Browse Card Refresh

The marketplace index now follows Blade's browse-card presentation rather
than reusing listing-detail pricing. A listing with both cash and time-credit
prices shows only its time-credit price with Blade's blue tag in browse,
advanced-search, and shared collection cards; detail and checkout retain the
intentional hybrid cash-or-credit wording and purple tag. The index category
list also uses Blade's exact class set, and query-status data remains
request-localized for controller compatibility without rendering the generic
banner that is absent from the Blade index. Browse and shared collection cards
now also prefer Laravel's `image.thumbnail_url` over the full image URL exactly
like Blade, while detail keeps the full gallery projection.

Focused browse, hybrid-detail, and 64-case status-localization proof passes
66/66, and the broader marketplace proof passes 43/43. The complete Jest gate
passes 49/49 suites and 1,649/1,649 tests; lint,
the 7,337-reference / 5,618-unique-key zero-unresolved locale audit, and the
322-template zero-match audit are green. The route matrix remains 688/689 and
the ledger remains 590 contracts with no untested consumer. No Laravel
request, mutation, database access, upload, or download ran.

## Marketplace Offer Workflow Refresh

The offer form and offer dashboard now follow Blade's exact commerce copy,
summary and notification semantics, monetary-only asking-price rule, status and
counterparty labels, actions, and empty states. Laravel's `is_own` projection
now blocks owners from opening the offer form. Invalid or API-rejected offers
replay bounded amount and message values once, with Blade's field-linked error
summary; the explicit offer POST is now represented in the consumer ledger.
Focused default-English proof passes 4/4, and the complete Jest gate passes
49/49 suites and 1,639/1,639 tests. Lint, CSS, brand, route, ledger,
7,212-reference / 5,507-unique-key zero-unresolved locale, and 322-template
zero-match gates are green. No Laravel request, mutation, upload, download, or
database access ran.

## Marketplace Listing Form Refresh

Marketplace create/edit now mirrors Blade's default-English form hierarchy and
exact commerce catalog instead of using invented copy and unrelated translation
keys. The create default uses the tenant bootstrap currency rather than fixed
EUR, safe input and Blade's three local validation errors survive the no-JavaScript
redirect, and edit no longer sends `status=active`, which could otherwise
reactivate a sold or expired listing. The extra multipart image control and parser
were removed because current Blade exposes no image field on this form; historical
image-upload proof remains API evidence, not current accessible-UI parity.

Focused Marketplace proof passes, and the full non-mutating gate remains
48/48 suites and 1,632/1,632 tests. Lint, brand, 7,046 static references / 5,364
unique keys / zero unresolved keys, and the 320-template zero-match audit are
green. No Laravel runtime or database mutation was run.

## Generic Listings Form Refresh

Generic listing create/edit now follows current Blade form behaviour instead of
tenant flags that Blade does not use to hide offer/request choices or skill
tags. The form omits service type and category when Blade omits them, uses the
exact catalog hints and primary validation messages, includes Blade's no-JS AI
description helper and edit-page delete warning/action, and removes invented
minimum-length, image-size, and layout copy. The description textarea exposes
both the standard and AI helper hints to assistive technology.

The AI helper now preserves bounded form values in one-use session state,
places Laravel's returned suggestion into the description field, and returns
to the mounted create/edit URL with the exact status banner. Core persistence,
skill-tag synchronization, upload, and delete boundaries remain mocked contract
coverage only. The full local gate is green at 48/48 suites and 1,633/1,633
tests, with lint, branding, CSS, locale, template, and route-matrix checks also
green. No Laravel runtime request, database write, migration, upload, download,
or destructive action was run for this slice.

## Rotating Authentication Session Refresh

Web UK now follows Laravel's current rotating-session contract across login,
two-factor completion, refresh, and logout. A successful session requires the
complete access/refresh pair plus Laravel-declared access and refresh lifetimes;
cookies use those exact lifetimes. Optional-auth and protected pages refresh a
missing or expiring JWT before route handling, preserve mounted tenant authority,
and serialize single-use refreshes behind a SHA-256-derived in-process key.

Temporary backend failures preserve the refresh cookie for a later attempt while
withholding an expired access token from the current request. Authoritative
credential failures clear the complete local pair. Logout submits the refresh
token even after access expiry so Laravel can revoke the token family. Mocked
contract coverage is green within the 48-suite, 1,615-test aggregate. No live login, refresh,
logout, Laravel runtime smoke, database write, or migration was run for this
slice because the ordinary Laravel database is the protected production-derived
snapshot.

## Passkey Reauthentication And Session Revocation

Passkey rename and removal now match Laravel's current high-risk-action
boundary. Both forms require the current password; Web UK exchanges it through
`POST /api/webauthn/security-confirm` and submits the returned short-lived
confirmation token to the requested operation. Missing or rejected passwords,
missing credentials, and the last-sign-in-method guard remain distinct,
localized settings errors. A successful removal must include Laravel's
`sessions_revoked` evidence; Web UK then invalidates its session, clears the
complete cookie pair, and shows the Blade success message on sign-in. Mocked
contract proof covers these paths. No real passkey, session, or database record
was changed.

Laravel also revokes every access, refresh-family, and Sanctum session after a
successful password change or TOTP disable. Web UK now invalidates its local
session and clears the complete cookie pair after either success instead of
carrying visibly authenticated but server-revoked credentials into the next
request. Password failures read Laravel's standard `errors[0].code` envelope,
preserving distinct incorrect, reused, weak, and generic states. These paths are
mock-certified only; no account credential or factor was changed.

## Direct Marketplace Checkout Refresh

Current Laravel commit `fed93dfd1` hardened direct marketplace purchasing. Web
UK now follows that Blade/API contract: the GET loads seller shipping options
and available pickup slots, filters paid shipping for free or time-credit-only
orders, and issues a session-bound idempotency key. The POST rejects forged or
stale keys before any order call, re-reads authoritative checkout data, requires
a cash/time-credit choice for hybrid listings, validates delivery and pickup
choices, and sends the exact order fields. The form now uses the source catalog,
field-linked error summary, old-input replay, delivery prices, localized pickup
times and remaining capacity, and suppresses confirmation when a shipping-only
listing has no option. Focused mocked contract proof covers the successful and
failure paths; no live order or database mutation was run.

The accepted-offer POST now applies the same trust boundary: it derives the
listing from the authenticated accepted-offer collection, ignores a forged
submitted listing ID, and revalidates offer-scoped shipping and pickup choices
before creating an order.

Marketplace prices now also mirror Laravel's dedicated money formatter: labels
use uppercase stored currency codes, comma grouping, and the same Stripe
zero-decimal currency list. Focused proof covers `JPY 1,200` without a false
`.00` suffix alongside the existing GBP and hybrid cases.

## Podcast Browse And Studio Capability Refresh

Current Laravel podcast browse metadata now drives Web UK category choices and
numeric pagination. Search, sort, validated category, and page filters survive
every tenant-safe page link; an unknown category is removed and the browse is
reissued without the invalid filter, matching Blade's tenant category
allow-list. Browse and detail artwork now carry Blade's
`referrerpolicy="no-referrer"`, and card descriptions use the same bounded
plain-text presentation.

The browse Studio link and Studio create button are no longer unconditional.
Web UK consumes `/api/v2/podcasts/mine` capability metadata, preserves access
for an existing author, and rejects a direct create-form request when the
backend says another show cannot be created. Focused default-English proof
covers permitted and denied states, invalid categories, preserved pagination,
and artwork hardening. The full non-mutating gate passes 47/47 suites and
1,604/1,604 tests; brand, lint, CSS, locale shape, static-key resolution,
template localization, route matrix, and `git diff --check` are green. No local
Laravel smoke or live mutation ran against the production-derived database.

## Podcast Show Metadata And Artwork Refresh

Podcast create and manage now mirror Blade's show fields: create-only slug,
artwork, language, author, owner email, copyright, funding URL, explicit-content
flag, and configuration-aware visibility choices. New-show defaults use the
signed-in profile and request locale where Laravel's API exposes them. Show
metadata continues through JSON `POST`/`PUT`; artwork uses Laravel's dedicated
multipart `POST /api/v2/podcasts/{id}/artwork` contract with field `image`.

Web UK now parses only the two show multipart paths before CSRF validation and
caps artwork at Laravel ImageUploader's 8 MB limit. Temporary files are removed
on every outcome. If create metadata succeeds but artwork is rejected, the user
is sent to the created show's manage page with a save-failure state rather than
being told the show does not exist. Mocked proof covers create, update, upload,
and rejected-artwork recovery without calling a live mutation endpoint. The
full gate is 47/47 suites and 1,604/1,604 tests; 6,868 static references resolve
to 5,241 unique keys with zero unresolved keys, and all 316 templates have zero
conservative localization matches.

## Podcast Episode Metadata And Cover Refresh

Podcast episode create and edit now mirror Blade's full default-English field
set: create-only slug, summary and description, episode/season/duration values,
hosted audio or external audio URL, MIME and byte metadata, type, visibility,
explicit flag, schedule, configuration-gated transcript and chapters, and
optional cover artwork. Episode edit posts to Blade's existing show-update
action with hidden `episode_id`; Web UK dispatches that form to Laravel's JSON
or method-spoofed multipart episode update contract rather than inventing an
extra accessible route. Covers use the dedicated
`POST /api/v2/podcasts/{showId}/episodes/{episodeId}/cover` endpoint with field
`image`.

Audio parsing follows Laravel's current 250 MB default ceiling while still
enforcing the tenant-advertised lower limit; covers retain the 8 MB image cap,
and temporary files are removed on every outcome. If create succeeds and the
separate cover call fails, the manage-page recovery state says saving failed
instead of falsely saying the episode was not created. Mocked proof covers
JSON and multipart create/update, metadata, cover upload, and rejected-cover
recovery. No live Laravel mutation ran. The full gate is 47/47 suites and
1,605/1,605 tests; 6,889 static references resolve to 5,253 unique keys with
zero unresolved keys, all 317 templates have zero conservative localization
matches, and the route matrix remains 683/689 matched with five documented
extras.

Podcast subscription toggles now omit `notify_new_episodes` exactly as Blade
does. Laravel therefore applies its authoritative default of enabling new-
episode notifications when a subscription is created, instead of Web UK
silently storing `false`. Mocked action proof covers subscribe, unsubscribe,
failure, and the exact payload boundary; no live subscription was changed.

## Podcast Backend-Relative Media Refresh

Podcast artwork, RSS feeds, hosted audio, and episode covers now preserve
Blade's backend-origin behaviour when Laravel returns a root-relative path.
Web UK resolves those paths against the configured Laravel origin instead of
its own origin, while retaining validated absolute HTTP(S) media URLs. This
prevents otherwise valid uploaded media and RSS links from becoming broken on
the separate Web UK host.

Focused mocked browse, detail, episode, and studio proof passes 12/12. No live
Laravel request, media upload/download, database write, or migration was run.

## Event Moderation Workflow

Tenant administrators can now open Blade's Event moderation route, review the
current admin API's pending-review root events, and complete the separate approve or reject
confirmation workflows. Web UK uses Laravel's `/api/v2/admin/events` list,
detail, approve, and reject contracts; non-admin API denial fails closed. Queue
and decision responses carry Blade's private/no-store, noindex, same-origin
referrer, and auth/cookie variance headers. The Events index exposes the queue
link only when a signed admin probe succeeds.

The default-English queue, status banners, card metadata, pagination, decision
summaries, warnings, field-linked errors, confirmation controls, and mounted
redirects follow Blade. Approval requires the exact confirmation value;
rejection additionally requires a trimmed reason of at most 2,000 characters.
Focused mocked queue/decision/action proof is green, including exact API-client
paths and payloads, the mounted Events-index link, and a 403 fail-closed state.
The full non-mutating gate passes 48/48 suites and 1,635/1,635 tests. The
generated matrix is now 688/689 matched, leaving only offline check-in code
generation as an undeclared route. No live
Laravel moderation read or mutation, database write, or migration was run.

This route family is implemented but not contract-identical certification.
Laravel's admin Event list filters publication state and canonical roots, but it
does not join the pending moderation queue and orders by Event creation time
rather than queue submission time. Its projection also omits Blade's
`is_online` field. Queue membership/order and online-only location therefore
remain upstream contract gaps; Web UK does not synthesize either value.

## Event Agenda Presentation Refresh

Event Agenda now follows Blade's full default-English running-order and editing
presentation rather than a reduced session form. Display and input times use the
agenda timezone; new-session start/end values follow the event start and
one-hour-or-event-end default. Scheduled sessions show track, room, capacity,
speakers, resources, registration/full states, boundary-aware move controls,
edit/cancel details, and cancelled history.

The editor retains linked-member speaker IDs and sends Laravel's exact
`user_id`/`display_name` plus `role_label` contract, preventing an edit from
silently converting a linked member into an external speaker. It exposes
Blade's minimum five speaker and three resource rows while preserving larger
API projections. Focused mocked render, timezone/default, boundary-control,
linked-speaker, exact-payload, withdrawal, and failure-summary proof passes 3/3.
The static gate passes 48/48 suites and 1,635/1,635 tests; brand, lint, CSS,
route-matrix, locale, template-localization, and scoped diff checks are green.
The later complete accessibility aggregate was not safe: its login journey made
the failed-login writes recorded in the incident section. It is not Agenda
failure evidence and is not a green certification result.

## Event Detail Attendee Roster Refresh

Event detail now consumes Laravel's canonical attendee projection in Blade's
single flat reading-order list. It renders the member display name or localized
unknown-member fallback, trusted backend-relative avatar or initial placeholder,
and the same going/interested/not-going status mapping and tag colours as Blade;
the previous grouped headings and invented member-profile links are removed.

The request now uses Blade's 50-row `status=all` contract, forwards the opaque
`attendees_cursor`, preserves other query parameters on the `rel="next"` link,
and distinguishes a failed roster load from a genuinely empty roster. The
failure summary matches Blade's content while retaining Web UK's established
focusable-error-summary convention. Mocked proof covers canonical rows, cursor
encoding, query preservation, empty and failed reads, and asset resolution.
The full non-mutating gate passes 47/47 suites and 1,607/1,607 tests; lint,
branding, 6,891 static references / 5,254 unique keys / zero unresolved keys,
the 317-template zero-match audit, diff check, and the unchanged 683/689 route
matrix are green. No Laravel runtime or database mutation was run.

## Event Registration Questionnaire Refresh

The attendee questionnaire now selects only Laravel's first invited, confirmed,
or pending registration, renders the published form description, and matches
Blade's short text, long text, single-choice, multiple-choice, consent, and
waiver controls. Native required state remains disabled for conditional
questions; configured length and selection constraints are bounded by Blade's
500/10,000-character hard limits. Invalid no-JavaScript submissions preserve
answers, render field-linked summary and inline errors, and stop before either
registration-product mutation call. Issued and accepted invitations now use
Blade's summary cards, localized type/status, issued-only Accept action, and
empty state instead of a bare action form. Guest capture now matches Blade's
name, email, telephone, ticket-entitlement, privacy, and notification fields;
guest summaries localize status and expose the labelled, confirmed cancellation
form only for captured guests. Focused Event Registration proof passes 8/8; the
organizer policy and form lists now also show Blade's description, status,
revision, event-timezone-local inputs, required controls, and form versions.
Double-brace Laravel catalogue placeholders interpolate without visible braces.
Organizer submission, campaign, and guest collections now expose Blade's
previous/next navigation while preserving sibling collection parameters and
returning to the matching section anchor.
Submission review/export, campaign, attendance, and retention controls now use
Blade's GOV.UK form groups, module hooks, explicit submit semantics, and checkbox
modules; incomplete policy status fails closed to localized copy.
The form editor now exposes Blade's governed classification, help, required,
validation, consent/waiver version, conditional visibility, guidance, and cancel
controls instead of hiding fields already supported by the Laravel contract.
Invalid or handled-conflict editor submissions now replay all authoring values
with Blade's localized error summary; incomplete input stops before mutation.
The full non-mutating gate passes 48/48 suites and 1,631/1,631 tests with green lint,
brand, CSS, route, and localization gates. No Laravel runtime or database
mutation was run.

## Localization P0 Closed In Current Slice

The previously identified raw-key risk is fixed and guarded. The generator now
imports every Laravel `event_*.php` catalog plus `safeguarding.php` alongside `govuk_alpha*.php`, and
the runtime resolves namespaces from the generated catalog rather than a fixed
allowlist.

Event analytics, communications, calendar, recurrence, registration, and
template references now use the current Laravel Blade keys. The complete-static
key gate scans Web UK source and fails when a literal `t()` or `tc()` reference
does not resolve in the English generated catalog.

A fresh proof run records:

- 11 locales, 36 namespaces, and 8,837 keys per locale;
- zero missing or extra keys in every locale;
- 6,854 complete static references and 5,230 unique referenced keys;
- zero unresolved complete static references;
- 315 templates and zero conservative hard-coded-copy matches;
- an English and Irish Event-template library render with no raw key leakage;
- focused Event and Jobs-response localization/operation proof and full
  47/47-suite, 1,603/1,603-test proof;
- green brand, lint, CSS, and `git diff --check` gates.

The live Blade marker comparator also uses the canonical
`/{tenantSlug}/accessible` Laravel mount and passed 19/19. `/alpha` remains a
legacy redirect-compatibility route and must not be used as the comparison
source.

The existing `locales:audit-templates` command looks for conservative
hard-coded English matches; it does not prove that referenced keys resolve.
The new `locales:audit-keys` command supplies that separate proof. Dynamic keys
still require focused route rendering because no static scanner can prove
runtime values.

Do not claim complete localization parity merely from this gate: backend-authored
copy, dynamic-key families, English-identical source values, contextual quality,
and manual language review remain separate evidence boundaries.

## Remaining Event Route And Contract Gaps

The five Event moderation browser routes are now implemented through Laravel's
real admin Event list/detail/approve/reject APIs:

- `GET /events/moderation`
- `GET /events/moderation/{id}/approve`
- `GET /events/moderation/{id}/reject`
- `POST /events/moderation/{id}/approve`
- `POST /events/moderation/{id}/reject`

They close declaration coverage but not exact contract certification. The API
list uses Event publication state and Event creation order; Blade uses pending
moderation-queue rows and queue-submission order. The API projection also omits
`is_online`. Do not mark this route family contract-identical until Laravel
exposes equivalent queue membership, ordering, and presentation data.

The only remaining undeclared Laravel browser route is:

- `POST /events/{id}/check-in/code`

Blade's offline signed-code form resolves the attendee and current attendance
version server-side. The existing offline-scan API instead requires a device
secret, expected attendance version, and idempotency key. Exact parity needs a
safe Laravel online-scan contract or an intentional source-contract change.

Record these as upstream API-boundary gaps. Do not hide them with synthetic
success, unsafe orchestration, or a generic preparation page.

## Superseded Pre-Correction Certification Work

This section records the older combined-certification framing. It is retained
only as dated evidence and must not override the current three-package queue.
Disposable Laravel provisioning and live Laravel mutation certification are no
longer part of the active Web UK goal.

After the localization P0, the remaining priority order is:

1. The repaired ordinary local Laravel database is a contract-current but
   confidential production snapshot, not a destructive test fixture. Provision
   a dedicated disposable clone before rerunning the Event mutation gate or
   exhaustive Laravel mutation smoke; never run those gates against the
   production-derived local database. "All quarters classified" is not the same
   as all checks passing.
2. Continue reconciling recent Event flows and unresolved component-audit rows.
   The July 14 Messages, Group create/detail, onboarding, and Feed/Groups/Wallet
   pagination slices are published and should not be repeated without a new
   concrete source mismatch.
3. Compare significant states per route: guest, member, owner, tenant admin,
   feature-disabled, empty, populated, validation failure, authorization
   failure, pagination, mutation, upload, and download.
4. Add representative screenshot/layout comparison. `visual:blade` is a
   normalized marker check only.
5. Complete manual keyboard, screen-reader, focus-order, error-summary, no-JS,
   zoom/reflow, forced-colour, and disabled-user evidence.
6. Track the 216 direct Laravel route declarations omitted from OpenAPI and
   obtain an API-owner publication decision. Web UK now has zero consumers
   without a direct Laravel declaration. Do not count declaration
   classification or a test-file reference as behavioral certification.
7. Obtain explicit release authorization and deployed proof for the published
   persistent Redis session/readiness, production-only secret/configuration,
   and request-timeout controls using the fail-closed release runbook.

ASP.NET proof is a separate later gate, not remaining frontend implementation
work. First certify the frontend against Laravel. When the separate backend
parity workstream declares ASP.NET ready, change only backend configuration and
run the same evidence suite; do not introduce an ASP.NET-specific frontend
adapter.

## Current Verification Gate

From the repository root:

```powershell
npm --prefix apps/web-uk run brand:check
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk test -- --runInBand
npm --prefix apps/web-uk run build:css
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk run api:ledger
npm --prefix apps/web-uk run locales:sync
npm --prefix apps/web-uk run locales:audit
npm --prefix apps/web-uk run locales:audit-keys
npm --prefix apps/web-uk run locales:audit-templates -- --summary
npm --prefix apps/web-uk run visual:blade
git diff --check -- apps/web-uk
```

The command block above is the ordinary static/read-only gate. The complete
`test:accessibility` aggregate, `smoke:laravel:local`, every `*:mutation:*`
command, authenticated settings journey, upload/download check, and
`smoke:federation:local` are forbidden in the active frontend-cloning goal
against every Laravel environment. Browser testing for this goal uses only the
enforced isolated selection and Web UK-owned/mock states.

Record the exact Laravel and Web UK SHAs, fixture identity, commands, pass/fail
counts, retained failures, and cleanup result. Route equality, a focused test,
or a stale listener is not certification.

## 2026-07-14 API Consumer Contract Correction

Frozen evidence at 2026-07-14 14:50 +01:00: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`; published Web UK parent and
`origin/main` `27c6f2fe04471e095f2568f31829d8ccb0072370`. This slice corrects three
concrete Laravel-contract regressions: invalid ideation campaign linking no
longer calls the synthetic `/ideation-campaigns/0/challenges` endpoint and now
uses Blade's detail-page redirects; the current-member activity dashboard uses
`/api/v2/users/me/activity/dashboard`; and application-history caption lookup
uses `/api/v2/jobs/my-applications?per_page=100` instead of the undeclared jobs
applications collection.

The complete non-mutating gate passes 50/50 suites and 1,663/1,663 tests, plus
green brand, lint, CSS, route-matrix, locale-structure, template-localization,
19/19 Blade marker, and diff checks. The API ledger remains 663 contracts but
improves to 448 OpenAPI matches, 215 unmatched, and zero dynamic unresolved.
Five inspected residual anomalies are static path-builder opacity around valid
Laravel routes, not demonstrated runtime defects. No Laravel source, database,
migration, mutation, upload, download, cleanup, or production operation was
performed. This published slice remains unscored: the fixed bank is 622/1,000
until a complete rubric re-audit explicitly replaces that baseline.

## 2026-07-14 Backend Request Timeout Hardening

Frozen evidence at 2026-07-14 15:06 +01:00: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`; published Web UK
`d158964e6d61f0306d9773926f2c281e150cab3b` and `origin/main` at the same
commit. Web UK's shared JSON and binary backend transports now enforce one
configurable 15-second deadline, bounded to 1-120 seconds, compose with an
existing caller abort signal, abort response-body reads as well as connection
setup, clear completed deadlines, and map timeout failures into the established
safe `ApiOfflineError` 503 path. `API_REQUEST_TIMEOUT_MS` is recorded in the
example environment.

Focused transport proof passes 217/217 tests. The complete non-mutating gate
passes 51/51 suites and 1,666/1,666 tests, plus green brand, lint, CSS,
route-matrix, API-ledger, locale-structure, template-localization, 19/19 Blade
marker, and diff checks. No Laravel source, database, migration, mutation,
upload, download, cleanup, or production operation was performed. This closes
the implementation part of the timeout/abort subgap but does not certify
production deployment behavior or change the frozen 622/1,000 bank without a
complete rubric re-audit; persistent-session and production-secret proof remain
open in package 12.

## 2026-07-14 Laravel Route-Declaration Classification

Frozen evidence at 2026-07-14 15:25 +01:00: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`; published Web UK
`beb7285e` with its parent `1731e755` already on `origin/main`. The frontend
consumer ledger now hashes and indexes uncommented direct method/path
declarations from Laravel `routes/api.php` separately from OpenAPI. It does not
promote those declarations to OpenAPI matches or behavioral certification.

The 663-contract denominator is unchanged: 448 exact OpenAPI matches, 215
OpenAPI-unmatched consumers, zero dynamic consumers, and zero consumers without
detected tests. The 215 are now finitely split into 210 exact direct Laravel
route declarations omitted from OpenAPI and five consumers whose path-builder
shape still prevents a direct declaration match. Focused generator proof passes
5/5; the complete non-mutating gate passes 51/51 suites and 1,667/1,667 tests,
with green lint, brand, CSS, route, localization, 19/19 Blade marker, and diff
checks. No Laravel source, database, migration, mutation, upload, download,
cleanup, or production operation was performed. This improves evidence
classification only; the frozen bank remains 622/1,000 pending a complete
rubric re-audit.

## 2026-07-14 Attached Event Poll Parity

Frozen evidence at `2026-07-14T20:02:09.0937158+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`023625ead3294eea8118548966893e4427d99460`. Signed Event detail now loads the
event-scoped poll list, resolves each full poll through Laravel's detail
contract, rejects a mismatched event identity, and renders Blade's open ballot,
closed results, already-voted ballot-secrecy, and no-options states. Result
percentages use the source rounded accessible label, leading and own-choice
tags are preserved, and vote success/failure outcomes use the exact Event
catalog.

Focused rendered/status proof passes `1/1`; lint, brand, CSS, route, API-ledger,
static-key, 322-template, and diff checks are green. The current complete Jest
attempt is not green: `51/52` suites and `1,675/1,676` tests passed, including
the new Event-poll case, while the unrelated group multipart-upload case first
exceeded its 10-second ceiling and then reproduced as host `ENOBUFS`/timeout in
isolation. No Laravel database, migration, mutation, upload, download,
container, or production operation ran. Anonymous attached-poll rendering
remains constrained by Laravel's bearer-authenticated poll API. This published
component-audit improvement remains unscored, so the frozen bank remains
`622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-14 Active Subnavigation Styling Parity

Frozen evidence at `2026-07-14T19:36:58.3485698+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`288beba0ca198cef51b5d8ba376b7b1e57731e7b`. The server-switched Volunteering
sections and Wallet transaction filters now apply Blade's
`govuk-link--no-visited-state` class only to the active `aria-current="page"`
link, preventing visited-link colour from obscuring the current section.

Focused rendered proof passes `2/2`; the complete non-mutating gate passes
`52/52` suites and `1,675/1,675` tests. Brand, lint, CSS, route, API-ledger,
locale-shape, static-key, 322-template, and diff checks are green. No Laravel
request, database, migration, mutation, upload, download, container, or
production operation ran. This published component-audit improvement remains
unscored, so the frozen bank remains `622/1,000` pending a complete fixed-rubric
re-audit.

## 2026-07-14 Premium Currency Display Parity

Frozen evidence at `2026-07-14T19:20:56.0397627+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`a742239483c6bc6c5837bd586e5f03be8c7afe91`. Premium tier prices now match
Blade's tenant-currency contract: EUR, USD, and GBP use their source symbols,
other valid ISO codes use a code prefix, and the default is EUR. The monthly
and yearly summary also uses Blade's same-line middle-dot separator.

Focused premium workflow proof passes 6/6, including configured GBP and EUR
fallback rendering. The complete non-mutating gate passes 52/52 suites and
1,675/1,675 tests; brand, lint, CSS, route, API-ledger, locale, 322-template
zero-match, 19/19 canonical Blade-marker, and diff checks are green. No Laravel
database, migration, mutation, upload, download, container, or production
operation was performed. This published component-audit improvement remains
unscored, so the frozen bank remains 622/1,000 pending a complete fixed-rubric
re-audit.

## 2026-07-14 Blog RSS Contract Parity

Frozen evidence at `2026-07-14T19:10:08.9779730+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`c60f9cf78762f094fa0eacfe65f708dd894eb096`. Blog RSS now matches Blade's
tenant-named channel, absolute mount-aware links, permalink GUIDs, optional RFC-
822 publication dates, request language, and XML escaping for backend-authored
channel/item text.

Focused hostile-character feed proof passes 1/1, and the complete non-mutating
gate passes 52/52 suites and 1,675/1,675 tests. Brand, lint, CSS, route, API-
ledger, locale, 322-template zero-match, 19/19 canonical Blade-marker, and diff
checks are green. No Laravel request, database, migration, mutation, container,
or production operation was performed. This published component-audit
improvement remains unscored, so the frozen bank remains 622/1,000 pending a
complete fixed-rubric re-audit.

## 2026-07-14 Plain-Text Source-Markup Parity

Frozen evidence at `2026-07-14T19:01:53.3409172+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`b9319e97e25ac9fd4ef2507302549b5e77ebbbd4`. Podcast summaries, episode
summaries, Group discussion openers, and discussion replies now follow Blade's
plain-text boundary: source markup is removed before line-break rendering
instead of appearing as escaped tags to members.

Focused populated-state rendering passes 3/3, and the complete non-mutating
gate passes 52/52 suites and 1,674/1,674 tests. Brand, lint, CSS, route, API-
ledger, locale, 322-template zero-match, 19/19 canonical Blade-marker, and diff
checks are green. No Laravel request, database, migration, mutation, container,
or production operation was performed. This published component-audit
improvement remains unscored, so the frozen bank remains 622/1,000 pending a
complete fixed-rubric re-audit.

## 2026-07-14 Course Review Metadata Parity

Frozen evidence at `2026-07-14T18:51:47.9085221+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`8fdffac18e8a7177842dc0b1fca3ff27d494eb28`. Course ratings now render Blade's
filled/empty star string and one-decimal average instead of a repeated raw
number and ASCII placeholders. Review metadata now uses Blade's middle-dot
separator and request-localized full-month date.

Focused course-family rendering passes 1/1, and the complete non-mutating gate
passes 52/52 suites and 1,674/1,674 tests. Brand, lint, CSS, route, API-ledger,
locale, 322-template zero-match, 19/19 canonical Blade-marker, and diff checks
are green. No Laravel request, database, migration, mutation, container, or
production operation was performed. This published component-audit improvement
remains unscored, so the frozen bank remains 622/1,000 pending a complete fixed-
rubric re-audit.

## 2026-07-14 Course Enrolment State Parity

Frozen evidence at `2026-07-14T18:40:08.2346593+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`2f405b073b60a28c57692a3b8c9c4128ef54f1d7`. Successful course enrolment now
uses Blade's confirmation panel rather than the generic notification banner.
The enrolled inset no longer adds the Web UK-only `Continue learning` link.

Focused course-family rendering passes 1/1, and the complete non-mutating gate
passes 52/52 suites and 1,674/1,674 tests. Brand, lint, CSS, route, API-ledger,
locale, 322-template zero-match, 19/19 canonical Blade-marker, and diff checks
are green. No Laravel request, database, migration, mutation, container, or
production operation was performed. This published component-audit improvement
remains unscored, so the frozen bank remains 622/1,000 pending a complete fixed-
rubric re-audit.

## 2026-07-14 Trusted CMS Surface Sanitization

Frozen evidence at `2026-07-14T18:27:49.2338856+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`2bfa8baeedc2fdc6e8e190f66d913c08783abcb3`. Knowledge Base articles and Blog
posts now pass through the shared Laravel-aligned CMS HTML allowlist at the Web
UK route boundary. Managed legal documents use the same boundary with images
disabled, matching Laravel's legal-document write policy. Safe formatting is
preserved while scripts, inline handlers, unsafe URL schemes, and unsupported
attributes are removed.

Focused rendered proof passes 3/3, `npm audit` reports zero known
vulnerabilities, and the complete non-mutating gate passes 52/52 suites and
1,674/1,674 tests. Brand, lint, CSS, route, API-ledger, locale, 322-template
zero-match, 19/19 canonical Blade-marker, and diff checks are green. No Laravel
request, database, migration, mutation, container, or production operation was
performed. This published component-audit improvement remains unscored, so the
frozen bank remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Advanced Search Result Boundary Parity

Frozen evidence at `2026-07-14T23:02:52.2403732+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`05e1f03fa947d904cad642d3ac73fca4835fb858`. Advanced Search now normalizes
listing, member, Event, and Group result fields with Blade's trimming,
null-coalescing, positive-ID, and zero-preserving rules before rendering. This
prevents blank source headings, invalid negative/zero links, false fallback
biographies or dates, and a nonzero fallback replacing `members_count: 0`.

Focused default-English proof passes `3/3`; the uninterrupted complete
non-mutating gate passes `52/52` suites and `1,684/1,684` tests. Lint, brand,
CSS, route matrix, API ledger, locale structure/static keys/templates, and
`19/19` canonical Blade markers are green. The marker comparison used public
read-only GETs only; no Laravel database, migration, mutation, upload,
download, container, or production operation was performed. This published
component-audit improvement remains unscored, so the frozen bank remains
`622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-14 Organisation Directory Result Boundary Parity

Frozen evidence refreshed at `2026-07-14T23:16:45.4304010+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`b0a853b55384c3152331ac7b858d23b3c4e544d8`. Both Organisation directory views
now trim card names before using Blade's title fallback. The richer browse view
also follows Blade's description and website presence rules and preserves
authoritative zero statistics instead of promoting API-only `excerpt` or
falling through to nonzero aliases.

Focused default-English directory/browse proof passes `5/5`; the uninterrupted
complete non-mutating gate passes `52/52` suites and `1,686/1,686` tests. Lint, brand,
CSS, route matrix, API ledger, locale structure/static keys/templates, and
`19/19` canonical Blade markers are green. The marker comparison used public
read-only GETs only; no Laravel database, migration, mutation, upload,
download, container, or production operation was performed. This published
component-audit improvement remains unscored, so the frozen bank remains
`622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-14 Organisation Jobs Metadata Parity

Frozen evidence refreshed at `2026-07-14T23:24:20.3693979+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`33063a71`. The organisation jobs page now applies Blade's trimmed-name fallback
and emits the same optional Organization JSON-LD fields with script-safe JSON
serialization and a Unicode-safe 300-character description boundary. The jobs
collection remains intentionally empty: current Laravel source does not cross
volunteer-organisation identifiers into the separate job-vacancy organisation
model, so Web UK makes no invented jobs API call.

Focused organisation-jobs proof passes `4/4`; the uninterrupted complete
non-mutating gate passes `52/52` suites and `1,687/1,687` tests. Lint, brand,
CSS, route matrix, API ledger, locale structure/static keys/templates, and
`19/19` canonical Blade markers are green. The marker comparison used public
read-only GETs only; no Laravel database, migration, mutation, upload,
download, container, or production operation was performed. This published
component-audit improvement remains unscored, so the frozen bank remains
`622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-14 Organisation Opportunity Apply Boundaries

Frozen evidence refreshed at `2026-07-14T23:27:57.2811264+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`00740c88`. The organisation-context apply page now matches Blade's trimming
and fallback boundaries for opportunity titles and organisation names. It also
uses only the authoritative positive numeric `organization_id` for the
organisation back link, so aliases or malformed IDs cannot create a link that
Laravel would not render; the already-applied state remains form-free.

Focused default-English proof passes `2/2`; the uninterrupted complete
non-mutating gate passes `52/52` suites and `1,688/1,688` tests. Lint, route
matrix, and API ledger are green. No Laravel database, migration, mutation,
upload, download, container, or production operation was performed. This
published component-audit improvement remains unscored, so the frozen bank
remains `622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-14 Organisation Registration Unicode Boundaries

Frozen evidence refreshed at `2026-07-14T23:32:28.0608459+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`fd99edaa`. Server-side registration validation now measures organisation name
and description length by Unicode characters like Laravel `mb_strlen`, rather
than JavaScript UTF-16 code units. The create payload also applies Laravel's
255-character Unicode-safe name truncation even when a client bypasses the
HTML `maxlength` boundary.

Focused validation/payload proof passes `3/3`; the uninterrupted complete
non-mutating gate passes `52/52` suites and `1,689/1,689` tests. Lint, route
matrix, and API ledger are green. No Laravel database, migration, mutation,
upload, download, container, or production operation was performed. This
published contract improvement remains unscored, so the frozen bank remains
`622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-14 Organisation Manage Row Boundaries

Frozen evidence refreshed at `2026-07-14T23:37:24.7643501+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`7b180e41`. Manage rows now follow Blade's identity, display-name, and role
boundaries: rows with empty IDs are skipped, names are trimmed before the
source fallback, and management controls require the authoritative
`member_role` rather than an API-only `role` alias.

Focused default-English normal/boundary proof passes `2/2`; the uninterrupted
complete non-mutating gate passes `52/52` suites and `1,690/1,690` tests. Lint,
route matrix, and API ledger are green. No Laravel database, migration,
mutation, upload, download, container, or production operation was performed.
This published component-audit improvement remains unscored, so the frozen
bank remains `622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-14 Organisation Detail Result Boundaries

Frozen evidence refreshed at `2026-07-14T23:42:56.7571941+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`2ec1d706`. Organisation detail now matches Blade's trimmed name/description,
email precedence, and case-sensitive website-scheme boundaries. Opportunity
cards require positive numeric IDs, trim titles before fallback, and apply a
Unicode-safe trimmed 180-character description limit; whitespace-only review
comments are omitted.

Focused signed/normal/empty/boundary proof passes `4/4`; the uninterrupted
complete non-mutating gate passes `52/52` suites and `1,691/1,691` tests. Lint,
route matrix, and API ledger are green. No Laravel database, migration,
mutation, upload, download, container, or production operation was performed.
This published component-audit improvement remains unscored, so the frozen
bank remains `622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-14 Saved Jobs Card Contract Boundaries

Frozen evidence refreshed at `2026-07-14T23:48:06.8402727+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`97de2746`. Shared Jobs cards now use Blade's integer ID/count casts,
authoritative organisation/creator and boolean fields, and en-dash salary
ranges instead of accepting API-only aliases or fractional visible counts.

Focused saved-page populated/boundary/unsigned/failure proof passes `4/4`.
The first complete run exposed one stale hyphenated salary assertion; after
correcting that expectation to current Blade, the uninterrupted rerun passes
`52/52` suites and `1,692/1,692` tests. Lint, route matrix, and API ledger are
green. No Laravel database, migration, mutation, upload, download, container,
or production operation was performed. This published component-audit
improvement remains unscored, so the frozen bank remains `622/1,000` pending a
complete fixed-rubric re-audit.

## 2026-07-14 Filtered Messages Identity Boundary

Frozen evidence refreshed at `2026-07-14T23:52:27.3002461+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`0dbc4a47`. The direct-message inbox now filters against Laravel's raw partner
name boundary while retaining the localized accessible display fallback.
Blank-identity conversations therefore remain reachable under an active name
filter, while named non-matches remain excluded like Blade.

Focused archived/paginated, whitespace-fallback, and filtered-identity proof
passes `3/3`; the uninterrupted complete non-mutating gate passes `52/52`
suites and `1,693/1,693` tests. Lint, route matrix, and API ledger are green.
No Laravel database, migration, mutation, upload, download, container, or
production operation was performed. This published component-audit improvement
remains unscored, so the frozen bank remains `622/1,000` pending a complete
fixed-rubric re-audit.

## 2026-07-14 Group Conversation Create Feature Gate

Frozen evidence refreshed at `2026-07-14T23:56:48.4201878+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`87a7903e`. Group-conversation creation now applies Laravel's `connections`
feature gate before authentication and API access. Both GET
`/messages/groups/new` and a CSRF-valid POST `/messages/groups` fail closed with
403 when disabled; no member search, resolution, or create call runs.

Focused normal and feature-disabled GET/POST proof passes `2/2`; the
uninterrupted complete non-mutating gate passes `52/52` suites and
`1,694/1,694` tests. Lint, route matrix, and API ledger are green. No Laravel
database, migration, mutation, upload, download, container, or production
operation was performed. This published authorization improvement remains
unscored, so the frozen bank remains `622/1,000` pending a complete fixed-rubric
re-audit.

## 2026-07-15 Group Conversation Reaction Projection

Frozen evidence refreshed at `2026-07-15T00:03:36.8597012+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`67f21908`. Group detail now performs Laravel's best-effort
`GET /api/v2/messages/reactions/batch` read for the rendered message IDs,
shows the returned aggregate emoji counts, and marks the signed-in viewer's
reported reactions as primary remove controls with the exact accessible copy.
Other emoji controls remain secondary add actions, and a reaction-read failure
does not take down the conversation page.

Focused group-detail proof passes `1/1`; the uninterrupted complete
non-mutating gate passes `52/52` suites and `1,694/1,694` tests. Lint, route
matrix, and API ledger are green. The API's direct-message authorization query
does not certify complete group-participant reaction visibility, so that
runtime limitation remains explicit. No Laravel database, migration, mutation,
upload, download, container, or production operation was performed. This
published component-audit improvement remains unscored, so the frozen bank
remains `622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-15 Listing Exchange Numeric Contract

Frozen evidence refreshed at `2026-07-15T00:08:18.3485790+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`c918ebfc`. The listing exchange-request POST now mirrors Blade's PHP numeric
projection: a missing proposed-hours field defaults to `1`, a present
non-numeric value casts to zero and clamps to `0.25`, valid values clamp to
`0.25..24`, and non-empty preparation time uses the source float cast without
Web UK's former invented 24-hour cap.

Focused normal and adversarial payload proof passes `1/1`; the uninterrupted
complete non-mutating gate passes `52/52` suites and `1,694/1,694` tests. Lint,
route matrix, and API ledger are green. No Laravel request, database,
migration, mutation, upload, download, container, or production operation was
performed. This published contract improvement remains unscored, so the frozen
bank remains `622/1,000` pending a complete fixed-rubric re-audit.

## 2026-07-15 Feed Error States

Frozen evidence refreshed at `2026-07-15T00:29:43.2652967+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`732b05e4`. Feed `post-empty` and `post-failed` states now match Blade's single
field-linked error summary, inline content error, error textarea styling, and
`aria-describedby` relationship. Other Feed action failures use Blade's
localized error title instead of the shared partial's non-source `Important`
heading. Collection failures now use Blade's localized load-error banner in
the results position and suppress the false empty-feed result that Web UK
previously rendered beneath the failure.

Signed-out Feed POSTs now reach the explicit per-action checks instead of a
mount-level login redirect overriding Laravel's workflow. Post creation returns
to the public Feed without a mutation, while engagement actions preserve the
anchored Feed-local `auth-required` state. The public Feed renders only its
normal authentication banner for that state, and every Feed POST handler still
fails before an API call when no signed token exists.

Focused compose, load-failure, and signed-out workflow proofs each pass `1/1`;
the uninterrupted complete non-mutating gate passes `52/52` suites and
`1,695/1,695` tests. Lint, route matrix, and API ledger are green. No Laravel
request, database, migration, mutation, upload, download, container, or
production operation was performed. This published component-audit improvement
remains unscored, so the frozen bank remains `622/1,000` pending a complete
fixed-rubric re-audit.

## 2026-07-14 Listing Report Validation Replay

Frozen evidence refreshed at `2026-07-14T20:36:59.8522902+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`130837c494f0accbdf9c5edbad4bed21dabfb633`. Listing report POST now enforces
authentication before validation, matches Blade's exact request-locale reason
labels and validation copy, and preserves bounded reason/details input through
a one-use session replay. The error summary and field error share the source
`#reason-inappropriate` destination; invalid input never reaches Laravel's
report API. Owner self-reports now use the shared request-locale 403 surface
matching Laravel's `abort(403)` instead of an invented Listing-specific page,
and no report controls render in that state.

Focused signed, unsigned, rendered-error, replay, and owner-denial proof passes
3/3. The uninterrupted complete non-mutating gate passes 52/52 suites and
1,678/1,678
tests. Lint, branding, CSS, the 7,462-reference / 5,697-unique-key zero-
unresolved locale audit, the 322-template zero-match audit, and diff checks are
green. No Laravel request, database, migration, mutation, container, or
production operation was performed. This published component-audit improvement
remains unscored, so the frozen bank remains 622/1,000 pending a complete
fixed-rubric re-audit.

## 2026-07-14 Job Employer-Brand Blade Parity

Frozen evidence at `2026-07-14T21:11:39.7536590+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`751cc24cc190c145994a9307d5405e833503f171`. The mounted employer-brand page
now matches Blade's catalog navigation/headings/counts, member metadata,
opportunity cards, inset empty states, and employer-review hierarchy. It
removes the invented intro and load warning, and restores accessible average,
dimension, and per-review progress indicators with source ARIA labels. API
methods and paths are unchanged.

Focused rendered proof passes 1/1. The uninterrupted complete non-mutating gate
passes 52/52 suites and 1,679/1,679 tests. Lint, branding, CSS, the 7,556-
reference / 5,780-unique-key zero-unresolved locale audit, the 322-template
zero-match audit, and diff checks are green. No Laravel request, database,
migration, mutation, container, or production operation was performed. This
published component-audit improvement remains unscored, so the frozen bank
remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Job Talent-Search Catalog Parity

Frozen evidence at `2026-07-14T21:06:15.6970594+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`f3771c6719faaf7de52aa067490946e71c2ec80d`. The mounted Job talent-search page
now uses Blade's exact request-locale catalog for navigation, heading,
description, filters, actions, prompt/empty/result states, last-active metadata,
and continuation link. The result metadata also restores Blade's middot
separator. API methods, paths, filters, and pagination are unchanged.

Focused rendered proof passes 1/1. The uninterrupted complete non-mutating gate
passes 52/52 suites and 1,679/1,679 tests. Lint, branding, CSS, the 7,543-
reference / 5,769-unique-key zero-unresolved locale audit, the 322-template
zero-match audit, and diff checks are green. No Laravel request, database,
migration, mutation, container, or production operation was performed. This
published component-audit improvement remains unscored, so the frozen bank
remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Job Applicants Blade Parity

Frozen evidence at `2026-07-14T21:02:05.7103908+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`4f259c192edf76ceb1afda8708cd69259db0c3da`. The owner Applicants page now
matches Blade's request-locale headings, analytics labels, applicant/stage
fallbacks, applied-date and multiline cover-letter presentation, and update
action. A failed applicant collection now renders Laravel's management-denial
403 instead of an invented partial page; the optional analytics read remains
non-fatal like Blade. API methods, paths, and mutation payloads are unchanged.

Focused populated/auth/denial proof passes 3/3. After an outer-shell timeout
produced no terminal result, the uninterrupted wider-bound complete
non-mutating rerun passed 52/52 suites and 1,679/1,679 tests. Lint, branding,
CSS, the 7,529-reference / 5,757-unique-key zero-unresolved locale audit, the
322-template zero-match audit, and diff checks are green. No Laravel request,
database, migration, mutation, container, or production operation was
performed. This published component-audit improvement remains unscored, so the
frozen bank remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Job Pipeline Blade Parity

Frozen evidence at `2026-07-14T20:50:55.2911619+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`cae3a5cdd85b09832b3a49c03b3c3154bc0bf8a0`. The owner Job pipeline now
matches Blade's request-locale catalog, applicants back destination, full-list
link styling, labelled stage sections, plural candidate counts, empty states,
localized stage controls, candidate-card nesting, and CV presentation. API
methods, paths, and mutation payloads are unchanged.

Focused rendered proof passes 1/1. The uninterrupted complete non-mutating gate
passes 52/52 suites and 1,678/1,678 tests. Lint, branding, CSS, the 7,524-
reference / 5,753-unique-key zero-unresolved locale audit, the 322-template
zero-match audit, and diff checks are green. No Laravel request, database,
migration, mutation, container, or production operation was performed. This
published component-audit improvement remains unscored, so the frozen bank
remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Job Analytics Blade Parity

Frozen evidence at `2026-07-14T20:45:18.2403419+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`19896de857889b5448345a4e1e3baa652d9cae3c`. The owner Job analytics page now
matches Blade's request-locale catalog, link-list hierarchy, conditional metric
and referral rows, table/progress semantics, stage labels and percentages, and
complete prediction metadata and comparison tags. API methods and paths are
unchanged.

Focused rendered proof passes 1/1. The uninterrupted complete non-mutating gate
passes 52/52 suites and 1,678/1,678 tests. Lint, branding, CSS, the 7,513-
reference / 5,742-unique-key zero-unresolved locale audit, the 322-template
zero-match audit, and diff checks are green. No Laravel request, database,
migration, mutation, container, or production operation was performed. This
published component-audit improvement remains unscored, so the frozen bank
remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Listing Exchange-Request Catalog Parity

Frozen evidence at `2026-07-14T20:20:46.7415665+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`35f182804d4eeaf9d7d15384b0d345dee887151f`. The signed Listing exchange-
request page now uses Blade's exact request-locale catalog for its title,
navigation, Listing summary labels and values, balance context and warning,
failure states, and hours control. Its API method, payload, and redirects are
unchanged.

Focused signed/unsigned/mounted proof passes 1/1, and the uninterrupted
complete non-mutating gate passes 52/52 suites and 1,676/1,676 tests. Lint, the
7,452-reference / 5,685-unique-key zero-unresolved locale audit, the 322-
template zero-match audit, and diff checks are green. No Laravel request,
database, migration, mutation, container, or production operation was
performed. This published component-audit improvement remains unscored, so the
frozen bank remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Frontend Consumer Resolution Closure

Frozen evidence at `2026-07-14T15:41:44.1400523+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`b7b42c2ab9e17a042aa8b72eb34c1c4595868fb0`. The ledger now models the
gamification helper's Laravel achievement-prefix exception and exposes fixed
endpoint prefixes directly at the remaining marketplace, matches, wallet, and
volunteering call sites without changing their runtime requests.

The generated inventory now contains 667 contracts: 451 exact OpenAPI matches,
216 direct Laravel route declarations omitted from OpenAPI, zero consumers
without a Laravel declaration, zero dynamically unresolved consumers, 370
state-changing contracts, and zero state-changing consumers without detected
static/mock proof. Focused proof is green. The uninterrupted complete
non-mutating gate passes 51/51 suites and 1,668/1,668 tests, plus green lint,
brand, CSS, route matrix, ledger, locale structure/static keys/templates, and
19/19 Blade marker comparisons. No Laravel source, database, migration,
mutation, upload, download, cleanup, or production operation was performed.
The remaining OpenAPI publication decision belongs to the Laravel API owner;
this published implementation remains unscored, so the frozen bank remains
622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Default-English Pagination Cue Parity

Frozen evidence at `2026-07-14T16:00:36.6066693+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`428dad62b2ff21ee2136b6ab71469826ec39e99b`. Blog, Knowledge Base,
Federation connections, Events, direct-conversation history, Volunteering
browse, and Volunteering applications now reproduce Blade's directional
pagination icons; Blog also restores Blade's middot metadata separator.

Focused rendered proof passes 7/7. The uninterrupted complete non-mutating gate
passes 51/51 suites and 1,668/1,668 tests, plus green lint, brand, CSS, route
matrix, API ledger, locale structure/static keys/templates, and 19/19 Blade
marker comparisons. No Laravel source, database, migration, mutation, upload,
download, cleanup, or production operation was performed. This closes a
bounded part of component-audit package 10 but remains unscored, so the frozen
bank remains 622/1,000 pending a complete fixed-rubric re-audit.

A focused follow-up at `2026-07-14T16:03:45.6250428+01:00`, Web UK
`e2768391bca8f18d11be20d17c111173e6b83786`, completes the Blog index metadata
sequence: cards now show Blade's `category · date · reading time` and omit the
extra author byline. Focused rendering, lint, template localization, and diff
checks pass; the immediately preceding 51/51, 1,668/1,668 complete gate remains
the aggregate evidence for this adjacent source-parity correction.

## 2026-07-14 Blog Article Metadata Parity

Frozen evidence at `2026-07-14T16:13:04.3484360+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`31be5f793280a5727789efd42981ea58418d42d9`. Blog detail pages now match
Blade's visible metadata sequence and consume the Laravel article's meta title,
description, canonical URL, Open Graph fields, publication/modified timestamps,
and Article JSON-LD. Canonical URLs accept HTTP(S) only and JSON-LD is serialized
for safe inline-script output.

Focused Blog rendering, lint, template-localization, and diff checks pass. The
immediately preceding complete non-mutating gate remains 51/51 suites and
1,668/1,668 tests. No Laravel source, database, migration, mutation, upload,
download, cleanup, or production operation was performed. This remains an
unscored component-audit improvement; the frozen bank stays 622/1,000 pending a
complete fixed-rubric re-audit.

## 2026-07-14 Knowledge Base Date Parity

Frozen evidence at `2026-07-14T16:16:46.7902766+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`2b9ba620dc08a422040c7039d4c5138437b28b91`. Knowledge Base article metadata
now matches Blade by displaying the backend date substring before `T`; the
former locale-formatted date and its inverse regression assertion are removed.

Focused Knowledge Base rendering passes 2/2 with green lint,
template-localization, and diff checks. The immediately preceding complete gate
remains 51/51 suites and 1,668/1,668 tests. No Laravel source, database,
migration, mutation, upload, download, cleanup, or production operation was
performed. This is an unscored component-audit improvement; the frozen bank
remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Persistent Production Session Hardening

Frozen evidence at `2026-07-14T16:29:56.5110142+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`8cad6728d74643c4786c46c052516af122adcebd`. Production now fails closed when
cookie or session secrets are missing, short, placeholder values, or identical;
it requires a Redis or Redis-TLS session store and does not start the HTTP
listener until the Redis connection succeeds. Test and development environments
explicitly retain the in-memory store.

The focused production-session proof passes 5/5. The uninterrupted complete
non-mutating gate passes 52/52 suites and 1,672/1,672 tests, plus green lint,
brand, CSS, route matrix, API ledger, locale structure/static keys/templates,
and 19/19 Blade marker comparisons. The dependency audit reports zero known
vulnerabilities. No live Redis or deployed environment was used, so deployed
session persistence, secret/configuration, and request-timeout proof remain an
operations-owned certification item. No Laravel source, database, migration,
mutation, cleanup, or production operation was performed. This published
implementation remains unscored; the frozen bank remains 622/1,000 pending a
complete fixed-rubric re-audit.

## 2026-07-14 Session-Store Readiness

Frozen evidence at `2026-07-14T16:38:58.4751822+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`7fae732dd52b94964e1d3d60b430450405ddd80b`. The readiness endpoint now returns
`503 NOT READY` whenever the required production Redis client is not ready,
instead of reporting a healthy container after session persistence is lost.
Development and test environments retain their existing in-memory readiness.

Focused readiness proof passes 73/73 tests with green lint. The uninterrupted
complete non-mutating gate remains green at 52/52 suites and 1,672/1,672 tests.
No live Redis, deployed environment, Laravel source, database, migration,
mutation, cleanup, container, or production operation was used. Deployed
session persistence and failure/recovery proof remain operations-owned, so this
published hardening improvement is unscored and the frozen bank remains
622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Production Release Runbook

Frozen evidence at `2026-07-14T16:40:53.8240977+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`99a754d24e0c93272743ce495f39772dff191dd2`. The published fail-closed runbook
now defines immutable SHA/digest capture, complete release gates, the disposable
Laravel boundary, production secrets and Redis requirements, two-replica
session/restart/failure-recovery proof, explicit approval, rollback triggers,
and exact-SHA post-release evidence.

The runbook explicitly preserves the current Web UK deployment hold, rejects
the root ASP.NET production override as an approved path, and grants no
production or Laravel authority. Markdown link and diff checks pass. The root
documentation-consistency checker still contains stale ledger expectations and
reports 4 issues against the current generated 667/451/216 inventory; that
root-owned checker was not changed. No Laravel source, database, migration,
mutation, container, or production operation was performed. Deployed proof
remains operations-owned, so the frozen bank remains 622/1,000 pending a
complete fixed-rubric re-audit.

## 2026-07-14 Connection Removal Confirmation Parity

Frozen evidence at `2026-07-14T16:49:21.2457718+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`77adb9ea5d7dec23a8b53564d8664fa65d0dac6c`. Accepted-connection removal and
sent-request cancellation on both canonical Connections views now follow
Blade's no-JavaScript destructive-action pattern: a closed details disclosure,
visible irreversible-action warning, localized warning prefix, and warning-
styled final submit control.

Focused default-English rendering passes 2/2. The complete non-mutating Jest
gate passes 52/52 suites and 1,672/1,672 tests; lint, the 322-template zero-match
localization audit, and diff checks are green. No Laravel source, database,
migration, mutation, container, or production operation was performed. This
published component-audit improvement remains unscored, so the frozen bank
remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Complete Non-Mutating Checkpoint

Frozen evidence at `2026-07-14T17:53:37.0182866+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, Web UK product commit
`d05a3caff85981d1da9bf4883a64dbc2a25143cb`, and verification/provenance commit
`66f192002b4c9ab81f0d387f27283eeb12143c4a`. The first full Jest run exposed
one stale source guard that still required the member-profile star display
removed by the Blade review-card slice. The guard was narrowed to require the
current localized rating tag plus assistive copy; its focused rerun passed 1/1,
then the uninterrupted full Jest rerun passed 52/52 suites and 1,674/1,674
tests.

Brand, lint, CSS, route matrix, API ledger, locale structure, template
localization, and diff checks are green. The refreshed matrix remains 688/689
matched declarations; the ledger remains 667 contracts, 451 OpenAPI matches,
216 direct Laravel route declarations omitted from OpenAPI, and zero undeclared
or dynamically unresolved consumers. Locale structure remains 11 locales, 36
namespaces, and 8,837 keys; 322 templates have zero conservative matches. Blade
marker comparison passes 19/19 at the canonical `/hour-timebank/accessible`
mount. No accessibility/login, mutation, upload, download, destructive,
Laravel-database, container, or production operation was performed. These
published improvements remain unscored, so the frozen bank remains 622/1,000
pending a complete fixed-rubric re-audit.

## 2026-07-14 Interactive Details Initialization Parity

Frozen evidence at `2026-07-14T16:52:15.1610135+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`075e7325a12742f032c766d275f6b14a0a1344e5`. Jobs alert deletion, Event
publication and waitlist-offer decline, and own-message edit/delete disclosures
now include Blade's GOV.UK details module hook while retaining their native
no-JavaScript behavior.

Focused source proof passes 1/1 with green lint, the 322-template zero-match
localization audit, and diff checks. The immediately preceding complete gate is
green at 52/52 suites and 1,672/1,672 tests. No Laravel source, database,
migration, mutation, container, or production operation was performed. This
published component-audit improvement remains unscored, so the frozen bank
remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Dashboard Feed Permalink Parity

Frozen evidence at `2026-07-14T16:58:26.8328721+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`9f456c23224694b5e46553ef24115ae7f33460fb`. Recent Dashboard feed rows now
follow Blade's destination rule: positive-ID posts link to their
`/feed/posts/{id}` permalink, while non-post activity falls back to `/feed`.

Focused default-English rendering passes 1/1 with green lint, the 322-template
zero-match localization audit, and diff checks. The immediately preceding
complete gate is green at 52/52 suites and 1,672/1,672 tests. No Laravel source,
database, migration, mutation, container, or production operation was
performed. This published component-audit improvement remains unscored, so the
frozen bank remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Course Content Rendering Parity

Frozen evidence at `2026-07-14T18:16:08.3275701+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`b1c33aa2aa6a53e659d74636b877c826b467c8ea`. Course detail now follows Blade's
plain-text summary boundary instead of displaying source markup as text. Text
lesson bodies now preserve Laravel-approved CMS formatting while stripping
scripts, inline event handlers, unsafe URL schemes, and unsupported attributes.

Focused course-family rendering passes 1/1, and the complete non-mutating gate
passes 52/52 suites and 1,674/1,674 tests. Brand, lint, CSS, route, API-ledger,
locale, 322-template zero-match, 19/19 canonical Blade-marker, and diff checks
are green. No Laravel request, database, migration, mutation, container, or
production operation was performed. This published component-audit improvement
remains unscored, so the frozen bank remains 622/1,000 pending a complete fixed-
rubric re-audit.

## 2026-07-14 Member Review Card Parity

Frozen evidence at `2026-07-14T17:33:51.9417448+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`49c248e5c3c0670e5ea4487349fe742a840b4cf6`. Member-profile reviews now match
Blade's GOV.UK card list, localized `Review by` heading, blue `n out of 5` tag,
assistive rating copy, and comment body. The legacy star display and invented
review date header are removed.

Focused default-English profile rendering passes 1/1 with green lint, the
322-template zero-match localization audit, and diff checks. The immediately
preceding complete gate is green at 52/52 suites and 1,672/1,672 tests. No
Laravel source, database, migration, mutation, container, or production
operation was performed. This published component-audit improvement remains
unscored, so the frozen bank remains 622/1,000 pending a complete fixed-rubric
re-audit.

## 2026-07-14 Cookie Hide-Link Semantics

Frozen evidence at `2026-07-14T17:39:20.8158201+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`d05a3caff85981d1da9bf4883a64dbc2a25143cb`. The cookie confirmation banner's
`Hide cookie message` control now retains its native link role like Blade; the
incorrect `role="button"` override is removed.

Focused shell-partial proof passes 15/15 with green lint, the 322-template zero-
match localization audit, and diff checks. The immediately preceding complete
gate is green at 52/52 suites and 1,672/1,672 tests. No Laravel source, database,
migration, mutation, container, or production operation was performed. This
published component-audit improvement remains unscored, so the frozen bank
remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Wallet And Rating Choice Parity

Frozen evidence at `2026-07-14T17:08:21.6695120+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`95baf23fe0551c440b0c4be843a598c0c5a129ba`. Both wallet transfer views now
require Blade's irreversible-transfer confirmation checkbox, and the Exchange
review form now starts with Blade's disabled `Choose a rating` option instead
of preselecting a score.

Focused rendered/source proof passes 3/3 with green lint, the 322-template
zero-match localization audit, and diff checks. The immediately preceding
complete gate is green at 52/52 suites and 1,672/1,672 tests. No Laravel source,
database, migration, mutation, container, or production operation was
performed. This published component-audit improvement remains unscored, so the
frozen bank remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Poll Deletion Confirmation Parity

Frozen evidence at `2026-07-14T17:14:07.7319045+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`db1bd3a3a520a126ffa9f10f037c8a1741bb9e48`. Owner delete actions on open,
ranked, and closed poll cards now follow Blade's no-JavaScript destructive
pattern: a closed details disclosure, irreversible-action warning, and an
explicit final delete button. The former direct open-poll delete form is gone,
and closed owner polls now expose the source action.

The focused seven-page poll journey passes 1/1 with green lint, the 322-template
zero-match localization audit, and diff checks. The immediately preceding
complete gate is green at 52/52 suites and 1,672/1,672 tests. No Laravel source,
database, migration, mutation, container, or production operation was
performed. This published component-audit improvement remains unscored, so the
frozen bank remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Member Transfer And Review Choice Parity

Frozen evidence at `2026-07-14T17:21:22.9377534+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`b792dcd2a45f95d8d0a90e764780107acb7c8267`. Member-profile credit transfers
now require Blade's irreversible-transfer confirmation checkbox. Pending Review
ratings no longer preselect five stars: every option is required and exposes
Blade's localized `n out of 5` label. The Reviews average uses the same Laravel
rating catalog instead of concatenating a hard-coded `/ 5` suffix.

Focused default-English member and Reviews rendering passes 2/2 with green
lint, the 322-template zero-match localization audit, and diff checks. The
immediately preceding complete gate is green at 52/52 suites and 1,672/1,672
tests. No Laravel source, database, migration, mutation, container, or
production operation was performed. This published component-audit improvement
remains unscored, so the frozen bank remains 622/1,000 pending a complete
fixed-rubric re-audit.

## 2026-07-14 Group Exchange Back-Link Parity

Frozen evidence at `2026-07-14T17:25:33.9827133+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`dc332c2e2225a3688ff719f1557db06829e4faf6`. Group Exchange detail now restores
Blade's `Back to exchanges` link before the page caption and heading, using the
tenant-aware URL helper.

The focused list/create/detail render passes 1/1 with green lint, the
322-template zero-match localization audit, and diff checks. The immediately
preceding complete gate is green at 52/52 suites and 1,672/1,672 tests. No
Laravel source, database, migration, mutation, container, or production
operation was performed. This published component-audit improvement remains
unscored, so the frozen bank remains 622/1,000 pending a complete fixed-rubric
re-audit.

## 2026-07-14 Account Deletion Error-Summary Order

Frozen evidence at `2026-07-14T17:27:50.4364954+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and Web UK product commit
`259877acae51d55ae4e204bfe7fe561c71b61f1f`. Account-deletion validation now
renders the GOV.UK error summary before the page H1, matching Blade's focus-on-
load content order instead of placing the summary beneath the heading.

Focused signed/unsigned rendering passes 1/1 with green lint, the 322-template
zero-match localization audit, and diff checks. The immediately preceding
complete gate is green at 52/52 suites and 1,672/1,672 tests. No Laravel source,
database, migration, mutation, container, or production operation was
performed. This published component-audit improvement remains unscored, so the
frozen bank remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Help Centre CMS HTML Sanitization

Frozen evidence at `2026-07-14T18:07:31.0510456+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`ea7b5bb6cf96db923593d5a29c20c176a0fa169b`. Help Centre FAQ answers now pass
through a Laravel-aligned CMS HTML allowlist before trusted rendering. Supported
formatting and safe links remain available; scripts, inline event handlers,
unsafe URL schemes, and unsupported attributes are removed, and new-window
links receive `noopener noreferrer`.

The focused Help Centre render passes 1/1, `npm audit` reports zero known
vulnerabilities, and the complete non-mutating gate passes 52/52 suites and
1,674/1,674 tests. Brand, lint, CSS, route, API-ledger, locale, 322-template
zero-match, 19/19 canonical Blade-marker, and diff checks are green. No Laravel
request, database, migration, mutation, container, or production operation was
performed. This published component-audit improvement remains unscored, so the
frozen bank remains 622/1,000 pending a complete fixed-rubric re-audit.

## 2026-07-14 Listing Analytics Catalog Parity

Frozen evidence at `2026-07-14T20:14:16.2373626+01:00` against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and published Web UK product commit
`65e079426a5edebe4f56ea2ec8135254f9ca3acc`. The owner Listing analytics page
now uses the exact Laravel `govuk_alpha_listings.analytics` catalog for its
title, navigation, period controls, metrics, empty states, table captions,
progress labels, trend copy, and contact-method labels. Its API and data
projection are unchanged.

Focused owner-page proof passes 1/1, and the uninterrupted complete
non-mutating gate passes 52/52 suites and 1,676/1,676 tests. Lint, branding,
CSS, the 7,436-reference / 5,679-unique-key zero-unresolved locale audit, the
322-template zero-match audit, and diff checks are green. No Laravel request,
database, migration, mutation, container, or production operation was
performed. This published component-audit improvement remains unscored, so the
frozen bank remains 622/1,000 pending a complete fixed-rubric re-audit.
