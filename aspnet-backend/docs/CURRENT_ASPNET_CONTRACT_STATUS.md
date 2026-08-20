# Current ASP.NET Contract Status

Last verified: 2026-08-20 (restructured; evidence regenerated the same day —
see the Baseline table and the artifact links under it)

Status: **Canonical current - ASP.NET score and certification source**

<!-- doc-consistency: ASPNET_CURRENT_BANKED_SCORE=653/1000 -->
<!-- doc-consistency: ASPNET_CURRENT_RUBRIC=ASPNET-CONTRACT-R3 -->

🔴 **This score is unrelated to Web UK's.** Two 1000-point denominators exist in
this repository and they measure different things: this one measures whether
ASP.NET is externally contract-identical to Laravel; Web UK's `WEBUK-W2-PROD-R1`
measures whether the accessible frontend is safe to serve in production
(`../../web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`). Never blend them.

🔴 **How this file works now (restructured 2026-08-20, owner-directed).** This
file holds ONLY what is current: the banked score, the evidence pointers, the
open gates, the next queue, and the reporting rules. Every dated narrative
entry lives in `HISTORY/STATUS_ARCHIVE_2026-07.md` and
`HISTORY/STATUS_ARCHIVE_2026-08.md`, moved verbatim. The plain-English view
for the owner is `ROADMAP.md`. Scoring rules: the rubric and baseline rules
live in `FULL_PARITY_REMEDIATION_RUNBOOK.md`; the update-transaction and
state-label rules in `DOCUMENTATION_GOVERNANCE.md`; the report format at the
bottom of this file.

## Banked score — Fixed Rubric Baseline 3, 653/1000 (`ASPNET-CONTRACT-R3`, banked 2026-08-20)

**Block 1 — Named baseline and SHA.** Rubric `ASPNET-CONTRACT-R3` (same seven
fixed-weight categories as R1/R2; no denominator change). Evidence boundary:
monorepo `1c483377c` (pushed 2026-08-20 with owner approval;
`aspnet-backend/src` and `tests` byte-identical to it at scoring time — the
one later commit, `27350fed4`, is documentation-only). Laravel contract source:
the same monorepo tree, exercised through the disposable Laravel on `:8091`
with both parity fixtures re-applied immediately before measurement. CI
evidence: platform-contracts run **32375659126** at `1c483377c` — **all
ASP.NET jobs green** (build, image builds, Messaging, API shards 1–6; shard
5's failure on the previous run did not reproduce). Scoring-record SHA: the
commit carrying this section.

**Block 2 — Banked score.**

| Category | Banked | Maximum | Movement vs B2 |
| --- | ---: | ---: | ---: |
| Active Laravel API route representation | 98 | 100 | +2 |
| Semantic workflow and canonical-consumer contract parity | 210 | 350 | +25 |
| Schema, migrations, data integrity, and upgrade safety | 118 | 150 | 0 |
| Auth, tenant isolation, security, and localization | 82 | 100 | +8 |
| Full build/test/CI evidence | 85 | 100 | 0 |
| Unchanged canonical React plus unchanged Web UK dual-backend runtime proof | 30 | 125 | +20 |
| Providers, jobs, integrations, operational proof, and reproducible docs | 30 | 75 | 0 |
| **Total** | **653** | **1000** | **+55** |

Every deduction re-derives Baseline 2's own deduction structure against the
2026-08-20 evidence pack (`../../.local-docs-archive/baseline3/` and
`../artifacts/parity/`, regenerated the same day). Where a B2 deduction's
measured basis improved, the deduction moved by the measurement; where the
basis is unchanged, the deduction is unchanged.

- **Routes 98 (−2).** B2's −4 covered 9 method-level client-consumed gaps.
  Now 4 real (messages voice, attachments GET-405, events attendance code,
  volunteering credential download), 1 struck as a false positive, 4 closed;
  regenerated artifact 2,652 matched / 15 missing (was 2,648/19).
- **Semantic 210 (−140).** −50 reads: 80 of 195 differ (41.0%) on the honest
  generated corpus vs B2's 82 of 170 (48.2%) — B2's −60 scaled by the
  measured differ rate — with events (incl. v1/v2 negotiation), listings and
  feed now field-complete except `feed.media`. −55 stubs: 319 verified live,
  unchanged. −35 writes: the 18-endpoint corpus is now MEASURED at 10/18
  (B2's −50 was "entirely unmeasured"): −15 for the 8 differing, −20 because
  uploads, realtime, side-effect verification and the wider 392-write ledger
  remain unmeasured.
- **Schema 118 (−32).** Unchanged evidence: 215 tables absent (257 matched,
  183 EF migrations — zero schema change since 2026-08-17; the recent ports
  were mapper-only), no populated-history upgrade proof (−20 / −12 as at B2).
- **Auth/tenant/security/localization 82 (−18).** B2's −18 localization
  deduction is **retired as mismeasured** — its instrument labels the SHARED
  React catalogs as the 'dotnet' side and contains zero ASP.NET code (the
  script now carries a score-integrity warning at the offending lines) — and
  is **replaced by an honest −10** from the real ledger
  (`BACKEND_LOCALIZATION_CONTRACT.md`): no request-locale negotiation at all,
  no recipient-locale resolution, 7 of 11 locales seeded. −5 residual
  security unchanged (R-4 subtree confinement, R-18 legal gate, R-20 passkey
  rp_id, R-8 carer cluster, FCM legacy endpoint). −3 tenant isolation for the
  absent tables, unchanged.
- **Build/test/CI 85 (−15).** Same evidence class as B2, now at this SHA:
  fresh CI green on every ASP.NET job (run 32375659126) plus the local host
  suite 3,740/0 + 38/38 (`baseline3/full-suite.log`). The −15 (coverage/test-
  quality gate −8, static contract −7) is unchanged.
- **Frontend runtime proof 30 (−95).** B2's 10 was static readiness only —
  neither frontend had ever run. +20 banks the canonical React side: a
  COMMITTED, repeatable browser smoke (`scripts/smoke-react-against-aspnet.mjs`)
  that signs in, renders 6 member pages, performs 4 member actions (create
  listing, feed post, credit transfer, RSVP) and exercises token refresh
  against ASP.NET in committed direct mode — 16/16 steps, 473 API calls ok,
  zero uncaught page errors (`baseline3/react-smoke.log`). **web-uk banks
  nothing new**: its page-pair result was manual, wrote no artifact, and no
  committed web-uk-vs-ASP.NET instrument exists — building one is C.1 in the
  queue below.
- **Providers/jobs/ops 30 (−45).** Unchanged: jobs 26 of 69 (denominator
  corrected from the previously written 70 — live count of
  `bootstrap/app.php` registrations), −20; Meilisearch zero callers + FCM on
  the retired endpoint, −12; no live-provider/operational proof, −13.

**Block 3 — Published but unscored:** none. Everything through `04c1a8fac` is
banked above; `27350fed4` is documentation-only.

**Block 4 — Dirty/in-flight work:** 25 `web-uk/src/routes/*.js` files carry
known CRLF phantom modifications from a concurrent workstream plus the nightly
`sentry-triage-ledger.json`; none is ASP.NET's and none contributes points.
Zero dirty `aspnet-backend` files at scoring time.

**Block 5 — Certification gaps:** the 347 open points are itemised in "Open
Certification Gates" below, restated against this baseline.

**History:** Baseline 2 (598, `ASPNET-CONTRACT-R2`, 2026-08-18) with full
per-category evidence: `HISTORY/STATUS_ARCHIVE_2026-08.md`. Baseline 1 (712
under the pre-drift denominator, initially banked 620, 2026-07-14):
`HISTORY/STATUS_ARCHIVE_2026-07.md`. R2's fall from R1 measured instrument
improvement, not regression; R3's rise over R2 banks five days of measured
work that had sat unbanked — the owner-directed cadence from here is a
banking transaction at every certification tier, never a deferred bulk score.

## Required End State

The product goal is a **two-frontends-by-two-backends** contract-identity model in
which neither frontend changes behavior when its backend changes:

[`ADR-0001`](decisions/ADR-0001-contract-identical-backends.md) is binding:
"compatibility" in this filename or rubric means externally contract-identical
behavior for every consumed boundary, not an approximately similar API.

| Unchanged client | Laravel backend | ASP.NET backend |
| --- | --- | --- |
| Canonical React at `C:\platforms\htdocs\staging\react-frontend` | Production source-of-truth behavior | Same methods, paths, payloads, responses, statuses, auth, tenancy, uploads, side effects, and workflows |
| Accessible Web UK at `web-uk/` (repo root) | Laravel-first certification target | The same Web UK code and page flows, switched by configuration only |

Route presence alone is not contract correctness. ASP.NET must reproduce the
Laravel contracts consumed by both unchanged clients, including validation and
error envelopes, redirects, authorization boundaries, tenant behavior,
provider effects, persistence, and upgrade behavior. Frontend adapters or
ASP.NET-specific page branches do not satisfy the goal.


## Open Certification Gates

The open deductions are Baseline 3's **347 points**. They are independent
proof gates, not one implementation queue:

- **Semantic (140 open):** the SHAPE_DIFFERS tail of the member read corpus
  (80 of 195), the 8 differing writes, and everything unmeasured — 243 admin
  GETs, 392 writes, 1,172 dynamic paths (coverage ledgers exist; runnable
  corpora do not).
- **Frontend runtime proof (95 open):** React journey certification beyond
  the current 16-step smoke; a web-uk-vs-ASP.NET instrument that does not yet
  exist as committed code (the recorded page-pair results were manual).
- **Schema/upgrade (32 open):** 215 absent tables (create what journeys need,
  via EF migrations); populated-history upgrade proof; preflight-failure proof.
- **Security/localization (18 open):** R-4 subtree confinement, R-18 legal
  gate, R-20 passkey rp_id, R-8 carer cluster; request/recipient-locale
  negotiation per `BACKEND_LOCALIZATION_CONTRACT.md`.
- **CI evidence (15 open):** the coverage/test-quality gate (−8) and static
  contract evidence (−7); the green aggregate at the scoring SHA exists (run
  32375659126).
- **Providers/ops (45 open):** jobs 26 of 69; Meilisearch indexing with zero
  callers; FCM on the retired endpoint; no processing at Laravel's
  `/api/v2/webhooks/stripe`. Live-provider certification is owner-gated.
- **Routes (2 points / 4 endpoints open):** messages voice + attachment media, events attendance
  code, volunteering credential download.

Stateful certification uses the disposable Laravel (`:8091`) only. The
ordinary local Laravel database is a confidential production-derived snapshot
and is never a test fixture. Production operation remains a separate owner
decision per ADR-0002 regardless of score; the live ASP.NET database backup
gap (none since 2026-03-08) is a named production hard-stop.


## Finite Ordered Backend Queue

The live plan (owner-approved 2026-08-20) supersedes the old eight-package
queue, which was written against Baseline 1's numbers; that queue is preserved
in `HISTORY/STATUS_ARCHIVE_2026-07.md` context. Phases, in order:

1. **A — Documentation restructure** (this commit) and **B — Baseline 3
   rescore** on the regenerated evidence pack; CI on push `1c483377c` is the
   last precondition.
2. **C — Frontend runtime certification, tiered** (the 125-point category):
   C.1 journey harness (React's exists — extend it; **web-uk's must be
   BUILT** — no committed web-uk-vs-ASP.NET instrument exists); C.2 the
   twelve core member journeys, fixing what breaks; C.3 feature modules, then
   admin, then web-uk. First known breaks: `/api/v2/events` ignores
   `per_page`/`when`/`group_id`/`mine` (the dashboard shows finished events
   under "Upcoming"); `/api/v2/feed/sidebar` serialises a raw EF entity; feed
   `subtype`; four route gaps (messages voice/attachment media, attendance
   code, credential download); token refresh across real expiry.
3. **D — stubs and semantic tail, interleaved with C**: implement the
   client-called stubs journeys hit, delete the 63 uncalled (owner sees the
   list first), validator-first semantic order, security items R-4 / R-18 /
   R-20 / R-8. Owner decision to surface: the undeclared `api/sub-accounts`
   credit-moving API — delete or declare.
4. **E — schema/ops as journeys demand**: needed tables via EF migrations,
   jobs 26 → 69 (compliance first), Meilisearch round-trip, FCM HTTP v1,
   Stripe webhook path, request/recipient-locale localization. The
   production hard-stop no code fixes: the live ASP.NET database's backups
   (none since 2026-03-08) — owner infrastructure item.

Banking cadence: a scoring transaction at every tier/phase completion —
never estimated, never silent.


## Required Status-Report Format

Every ASP.NET status report must present these five blocks in this order:

1. **Named baseline and SHA** - rubric version, Laravel SHA, last banked ASP.NET
   implementation SHA, scoring-record SHA, and currently inspected HEAD.
2. **Banked score** - one fixed-denominator total plus the seven category rows.
3. **Published but unscored** - exact commits and why points are not banked yet;
   write `none` when there are none.
4. **Dirty/in-flight work** - scoped files or workstream, verification achieved,
   and explicit confirmation that it contributes zero banked points.
5. **Certification gaps** - exact remaining deductions and the evidence needed
   to bank them.

Never report a blended ASP.NET/Web UK percentage, silently rescore history,
convert route counts into a completion percentage, or describe uncommitted work
as complete. Follow
[`DOCUMENTATION_GOVERNANCE.md`](DOCUMENTATION_GOVERNANCE.md) when updating this
status.
