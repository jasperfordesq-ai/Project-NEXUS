# Current ASP.NET Contract Status

Last verified: 2026-08-20 (restructured; evidence regenerated the same day —
see the Baseline table and the artifact links under it)

Status: **Canonical current - ASP.NET score and certification source**

<!-- doc-consistency: ASPNET_CURRENT_BANKED_SCORE=598/1000 -->
<!-- doc-consistency: ASPNET_CURRENT_RUBRIC=ASPNET-CONTRACT-R2 -->

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

## Banked score — Fixed Rubric Baseline 2, 598/1000 (`ASPNET-CONTRACT-R2`, banked 2026-08-18)

| Category | Banked | Maximum |
| --- | ---: | ---: |
| Active Laravel API route representation | 96 | 100 |
| Semantic workflow and canonical-consumer contract parity | 185 | 350 |
| Schema, migrations, data integrity, and upgrade safety | 118 | 150 |
| Auth, tenant isolation, security, and localization | 74 | 100 |
| Full build/test/CI evidence | 85 | 100 |
| Unchanged canonical React plus unchanged Web UK dual-backend runtime proof | 10 | 125 |
| Providers, jobs, integrations, operational proof, and reproducible docs | 30 | 75 |
| **Total** | **598** | **1000** |

Per-category evidence for this baseline: `HISTORY/STATUS_ARCHIVE_2026-08.md`
(the "Fixed Rubric Baseline 2" section, preserved verbatim). Baseline 1
(712/1000 under the pre-drift denominator, initially banked 620) is in
`HISTORY/STATUS_ARCHIVE_2026-07.md`. A **Baseline 3 rescore is in progress**
(owner-directed 2026-08-20): its evidence pack is regenerated and archived at
`../../.local-docs-archive/baseline3/`; banking waits only on the CI run for
push `1c483377c`. Until that transaction lands, 598 is the banked score and
everything since 2026-08-18 is published-but-unscored.

## Published but unscored (movement since Baseline 2, all evidence live)

| Measure | Baseline 2 | Now | Evidence |
| --- | --- | --- | --- |
| Reads contract-identical (member corpus) | 64/170 | **78/195** (+31 envelope-match-but-empty) | `baseline3/reads-195.json` |
| Writes contract-identical | unmeasured at B2; first measured 08-19 | **10/18** | `baseline3/writes-18.json` |
| Route operations matched / missing | 2,648 / 19 | **2,652 / 15** | `artifacts/parity/api/` (regenerated 2026-08-20) |
| Feed item fields missing | 33 | **1** (`media` — no table) | `baseline3/` + feed diffs |
| Listings fields missing | 50 | **0** | status archive 2026-08 |
| Events client-side contract drift | 60 issues | **0**, incl. v1/v2 negotiation | status archive 2026-08 |
| React browser smoke | did not exist | **16/16 steps**, 6 pages, 4 member actions, 0 uncaught errors | `baseline3/react-smoke.log` |
| Full test suite (host) | 3,659 | **3,740 passed / 0 failed** + 38/38 Messaging | `baseline3/full-suite.log` |
| No-op stubs | 319 | 319 (unchanged) | `baseline3/stubs.log` |

Commits: `49f97887d` … `04c1a8fac` (see the August archive for each entry's
narrative). Pushed 2026-08-20 as `a4aaf4796..1c483377c` with owner approval.

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

The open deductions are Baseline 2's 402 points (Baseline 3 will restate
them). They are independent proof gates, not one implementation queue:

- **Semantic (165 open):** the SHAPE_DIFFERS tail of the member read corpus
  (80 of 195), the 8 differing writes, and everything unmeasured — 243 admin
  GETs, 392 writes, 1,172 dynamic paths (coverage ledgers exist; runnable
  corpora do not).
- **Frontend runtime proof (115 open):** React journey certification beyond
  the current 16-step smoke; a web-uk-vs-ASP.NET instrument that does not yet
  exist as committed code (the recorded page-pair results were manual).
- **Schema/upgrade (32 open):** 215 absent tables (create what journeys need,
  via EF migrations); populated-history upgrade proof; preflight-failure proof.
- **Security/localization (26 open):** R-4 subtree confinement, R-18 legal
  gate, R-20 passkey rp_id, R-8 carer cluster; request/recipient-locale
  negotiation per `BACKEND_LOCALIZATION_CONTRACT.md`.
- **CI evidence (15 open):** a green `platform-contracts` aggregate at the
  scoring SHA (push `1c483377c` pending at restructure time; the prior
  covering run was red on one shard).
- **Providers/ops (45 open):** jobs 26 of 69; Meilisearch indexing with zero
  callers; FCM on the retired endpoint; no processing at Laravel's
  `/api/v2/webhooks/stripe`. Live-provider certification is owner-gated.
- **Routes (4 open):** messages voice + attachment media, events attendance
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
