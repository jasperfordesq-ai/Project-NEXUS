# Laravel Contract-Identity Remediation Runbook

Last reviewed: 2026-07-15

Status: **Maintained reference — fixed rubric and cross-workstream completion gate**

Last reviewed: 2026-08-21 (Baseline 5 named; this line read 2026-07-15 while the
file already carried an August rubric section)

This is the maintained execution map for completing both contract-identity
workstreams. The filename is retained for link stability:

1. finish `web-uk/` (repo root) as the accessible frontend against the Laravel backend;
2. make the ASP.NET backend externally contract-identical to Laravel for both the
   canonical Laravel React frontend and the accessible frontend.

[`decisions/ADR-0001-contract-identical-backends.md`](decisions/ADR-0001-contract-identical-backends.md)
is binding. "Parity" in historical sections or filenames is shorthand for that
standard and never means route similarity or approximate compatibility.

The counts below are a dated audit snapshot, not permanent truth. Regenerate
them before editing, scoring, or claiming completion. This runbook supersedes
older numeric scores and completion claims in the handoff documents, while the
handoffs remain useful for detailed implementation history and commands.

For live workstream scores, published-versus-dirty boundaries, and remaining
deductions, read `CURRENT_ASPNET_CONTRACT_STATUS.md` and
`../../web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`. This runbook owns
the fixed rubric and evidence gates, but deliberately does not mirror either
current overall score.

The 2026-07-15 fixed-rubric re-audit is published in those two canonical status
documents. The exact Windows Update interruption and the pre-restart boundary of
all three open tasks are recorded in
[`RESTART_INCIDENT_2026-07-15.md`](RESTART_INCIDENT_2026-07-15.md). Interrupted
or recovered dirty work never changes a banked score.

## Authorization Boundary (the 2026-07-15 pause was LIFTED on 2026-08-14)

Local implementation, tests and migrations are authorized again (owner
instruction, 2026-08-14 — recorded in `../CLAUDE.md`). What remains true from
the pause era: this runbook is a method, not standing authority — production
deployment, production-container operations and live-provider actions each
require a separate explicit owner instruction naming the workstream and
scope. The pause record itself is a Historical checkpoint:
[`PROJECT_PAUSE_HANDOFF_2026-07-15.md`](PROJECT_PAUSE_HANDOFF_2026-07-15.md).

## Objective

The required end state is a two-frontends-by-two-backends contract-identity
model:

| Frontend | Laravel backend | ASP.NET backend |
| --- | --- | --- |
| Canonical React at `C:\platforms\htdocs\staging\react-frontend` | Source-of-truth baseline | Same contracts and workflows, runtime-certified |
| Accessible Web UK at `C:\platforms\htdocs\staging\web-uk` | Laravel-first and fully certified | Same Web UK code and page flows, runtime-certified after backend parity |

Do not achieve this by adding ASP.NET-specific behavior to the canonical React
frontend or page-level backend adapters to Web UK. ASP.NET must implement the
Laravel contracts.

## Source Of Truth And Boundaries

| Surface | Path | Rule |
| --- | --- | --- |
| Laravel backend | `C:\platforms\htdocs\staging` | Read-only reference |
| Canonical React frontend | `C:\platforms\htdocs\staging\react-frontend` | Read-only contract consumer |
| ~~Laravel Blade accessible frontend~~ | *(deleted 2026-08-14)* | `accessible-frontend/`, `routes/govuk-alpha.php` and `routes/govuk-alpha-parity` no longer exist. Behaviour is defined by GOV.UK Design System + WCAG 2.2 (presentation), `react-frontend/` (member capability) and the Laravel API (contract); the final Blade route inventory is frozen at `web-uk/scripts/blade-route-inventory.frozen.json` (707 routes) |
| ASP.NET backend | `C:\platforms\htdocs\staging\aspnet-backend\src` | Backend implementation target |
| Accessible Web UK | `C:\platforms\htdocs\staging\web-uk` | Accessible implementation target (production accessible frontend — read-only from this workstream) |
| ~~Legacy React copy~~ | *(deleted 2026-08-09)* | Retired and removed from the repository; do not recreate |

Before any production deployment or production-container action, stop and read
`.claude/production-containers.md`. This runbook does not authorize production
deployment or touching production containers. Never modify the Laravel repo or
Laravel Edition containers from this worktree.

## Fixed 1000-Point Completion Rubric

All older implementation, certification, combined, and static-route percentages
below are historical checkpoints. They must not be used as the current overall
completion percentage. Effective 2026-07-14, the only overall denominator is:

| Category | Weight |
| --- | ---: |
| Active Laravel API route representation | 100 |
| Semantic workflow and canonical-consumer contract parity | 350 |
| Schema, migrations, data integrity, and upgrade safety | 150 |
| Auth, tenant isolation, security, and localization | 100 |
| Full build/test/CI evidence | 100 |
| Unchanged canonical React plus unchanged Web UK dual-backend runtime proof | 125 |
| Providers, jobs, integrations, operational proof, and reproducible docs | 75 |

Fixed Rubric Baseline 1 freezes Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, ASP.NET
`b751d22f38baf0ac8bdf90fe669550b568fcb489`, and 2026-07-14 10:51:18 +01.
Its banked score is **620/1000 (62%)**: 100/100 route representation,
250/350 semantic parity, 110/150 schema/upgrade safety, 90/100 security and
localization, 45/100 build/test/CI, 10/125 unchanged-frontend runtime proof,
and 15/75 providers/operations/docs. Exact deductions are respectively 0,
100, 40, 10, 55, 115, and 60 points. New Laravel drift creates a separately
named baseline and scope-added delta; it does not silently rewrite this score.

### Fixed Rubric Baseline 2 — named 2026-08-18 (`ASPNET-CONTRACT-R2`)

Baseline 1 above is **frozen and unrewritten**. Baseline 2 is the separately named
drift baseline the rule immediately above requires, taken at monorepo
`8f6d527bd87d9c07cc5c619bf397b2cad7592f41` against Laravel HEAD rather than
`903d03d3`. Its banked score is **598/1000**: 96 route representation, 185 semantic
parity, 118 schema/upgrade safety, 74 security and localization, 85 build/test/CI,
10 unchanged-frontend runtime proof, and 30 providers/operations/docs. Exact
deductions are respectively 4, 165, 32, 26, 15, 115 and 45.

🔴 **It is lower than Baseline 1's 712 because the instrument improved, not because
the backend regressed.** Baseline 1 banked 307/350 for semantic parity at a time
when nothing could compare a response; parity was inferred from route inventories.
`scripts/compare-live-responses.mjs` can now ask both running backends the same
question, and on the 170 GET paths the canonical React frontend calls, signed in,
only 64 are contract-identical. Meanwhile the code genuinely improved: the tenant
hierarchy and subtree confinement now exist, the event-discarding webhooks now
refuse, no-op handlers fell 349 → 319, and every ASP.NET CI job is green.

The full category table, per-category evidence and the commands behind each number
live in [`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md),
which remains the canonical current score. This runbook records the baseline's
existence and denominator only.

### Fixed Rubric Baseline 3 — named 2026-08-20 (`ASPNET-CONTRACT-R3`)

Baselines 1 and 2 above are frozen and unrewritten. Baseline 3 is banked at
monorepo `1c483377c` (pushed; every ASP.NET CI job green on platform-contracts
run 32375659126) with a banked score of **653/1000**: 98 route representation,
210 semantic parity, 118 schema/upgrade safety, 82 security and localization,
85 build/test/CI, 30 unchanged-frontend runtime proof, and 30
providers/operations/docs. Exact deductions are respectively 2, 140, 32, 18,
15, 95 and 45. Same seven fixed-weight categories; no denominator change.

Two things distinguish this transaction: it re-derives every Baseline 2
deduction against a same-day regenerated evidence pack
(`.local-docs-archive/baseline3/` plus `aspnet-backend/artifacts/parity/`),
and it **retires one mismeasured deduction with its replacement stated** —
B2's −18 "localization keys" came from an instrument whose 'dotnet' side is
the shared React frontend's catalogs; R3 deducts −10 from the real backend
ledger instead (`BACKEND_LOCALIZATION_CONTRACT.md`). The owner-directed
cadence from Baseline 3 onward is a banking transaction at every
certification tier, never a deferred bulk score. The full derivation lives in
[`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md);
this runbook records the baseline's existence and denominator only.

### Fixed Rubric Baseline 4 — named 2026-08-21 (`ASPNET-CONTRACT-R4`)

🔴 **R4 CHANGES THE CATEGORIES AND THE QUESTION. Its total is NOT comparable
to R1, R2 or R3.** Baselines 1–3 are frozen and unrewritten above. Do not
subtract one from the other, do not describe R4 as a fall from 653, and do not
average them.

R1–R3 answered: *how much of Laravel's API surface has an ASP.NET counterpart
that looks right?* R4 answers: *how much of the actual product has been proved
to work on ASP.NET?* Those are different questions and the second is the one
[`ADR-0003`](decisions/ADR-0003-aspnet-is-a-committed-deliverable.md) commits the
project to. The rubric changed because the old one could not be finished:

- **It scored unmeasured surface as a penalty.** −20 of R3's 350 semantic points
  existed only because a 392-endpoint write ledger had not been run. Looking
  harder lowered the score; shipping working journeys did not necessarily raise
  it. R4 forbids this: unmeasured surface becomes an **open journey row**, which
  is work with a name and an owner, never a deduction with neither.
- **It measured field noise.** Semantic parity moved with whole-response-body
  diff counts, so Laravel's raw-Eloquent internal columns — down to
  `category.reset_token` — counted as required work. See
  [`ADR-0004`](decisions/ADR-0004-journey-equivalence-is-the-target.md).
- **Its denominator was ~2,650 endpoints**, which cannot be scheduled or
  parallelised. R4's denominator is the 130-row
  [`JOURNEY_CERTIFICATION_LEDGER.md`](JOURNEY_CERTIFICATION_LEDGER.md).

R4's fixed 1000-point denominator:

| Category | Weight |
| --- | ---: |
| Core member journeys certified — React | 200 |
| Community and extended module member journeys certified — React | 150 |
| Member journeys certified — Web UK accessible | 150 |
| Staff journeys certified — admin, super-admin, broker | 100 |
| Consumed-contract correctness and stub elimination | 150 |
| Data integrity, schema, and upgrade safety | 75 |
| Auth, tenant isolation, security, and localization | 75 |
| Background processing, providers, and integrations | 50 |
| Build/test/CI evidence and operational readiness | 50 |

Nine scored categories totalling 1000. Community and extended module journeys
share one 150-point category so that a scope decision on the extended modules
(owner decision 4 in the ledger) cannot silently change the denominator.

Journey categories are scored from the ledger's own status vocabulary —
CERTIFIED 100%, PROVEN 60%, RENDERS 25%, PARTIAL 30%, OPEN/BROKEN 0% — applied
to that tier's row count. That makes every journey category mechanically
derivable from the ledger rather than a judgement call, and it means the score
moves when, and only when, a row moves.

Baseline 4 is banked at monorepo `869a2a030` with a banked score of
**355/1000**: 72 core React journeys, 11 module React journeys, 28 Web UK
journeys, 1 staff journey, 90 consumed-contract correctness, 58 schema, 58
security/localization, 10 background/providers, 27 CI/operational. Exact
deductions are respectively 128, 139, 122, 99, 60, 17, 17, 40 and 23.

The full derivation, evidence pointers and five-block record live in
[`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md), which
remains the canonical current score. This runbook records the baseline's
existence and denominator only.

### Fixed Rubric Baseline 5 — named 2026-08-21 (`ASPNET-CONTRACT-R5`)

🔴 **THIS IS THE FINAL DENOMINATOR. It does not change again.** Baselines
1-4 above are frozen and unrewritten, and R5's total is **not comparable to any
of them**. R1-R3 asked how much of Laravel's API surface had a counterpart that
looked right; R4 and R5 ask how much of the product is proved to work, and R5
asks it of the complete scope.

R5 exists for one reason: on 2026-08-21 the owner set the scope to **everything,
including the mobile app** (331 endpoints, ~138K lines, previously in no plan at
all) and confirmed the edition is a committed deliverable driven by public-sector
procurement. That decision added a whole client and expanded the staff surface,
so the denominator had to be re-cut once. R4's 353 becomes R5's **270/1000** — no
regression, a larger and complete measuring frame.

The re-cut also carried three corrections found by audit on the same day, all in
R4's own published figures: Tier 1's summary claimed 20 PROVEN / 2 PARTIAL where
its rows held 19 / 3; one row carried a status (`PARTIAL`-to-`OPEN`) outside the
vocabulary; and three documents said "eight categories" above a nine-row table.

R5's fixed 1000-point denominator — **ten** categories:

| Category | Weight |
| --- | ---: |
| Core member journeys certified — React | 170 |
| Community and extended module journeys certified — React | 130 |
| Member journeys certified — Web UK accessible | 120 |
| Staff journeys certified — admin, super-admin, broker | 150 |
| Mobile app journeys certified — Expo / React Native | 120 |
| Consumed-contract correctness and stub elimination | 110 |
| Data integrity, schema, and upgrade safety | 60 |
| Auth, tenant isolation, security, and localization | 60 |
| Background processing, providers, and integrations | 40 |
| Build/test/CI evidence and operational readiness | 40 |

Staff rises from 100 to 150 because that tier grew from 25 to 72 rows and because
public-sector buyers evaluate the admin panel. Community and extended modules
share one category so that an owner scope decision on the extended modules cannot
change the denominator.

**Three mechanisms make the denominator permanent and the headline monotone.**
They are enforced by `scripts/check-doc-scores.mjs`, not promised in prose:

1. **Reserve rows.** Every tier in
   [`JOURNEY_CERTIFICATION_LEDGER.md`](JOURNEY_CERTIFICATION_LEDGER.md) carries
   named `RESERVE` rows, counted in the denominator at zero credit from day one.
   A journey discovered later FILLS a reserve. Reserves exhausted in a tier is an
   owner escalation, never a silent re-cut.
2. **A ratchet.** `ASPNET_BANKED_FLOOR` is asserted every run: the published
   total may never fall below it, and each banking transaction raises it. A
   demotion is recorded in the ledger immediately; the headline publishes at the
   next net-non-negative transaction. The ledger stays honest in real time.
3. **Mechanical derivation.** The five journey categories are recomputed from the
   ledger's own row statuses on every run — the checker re-counts each tier's
   rows, rejects any status outside the vocabulary, and fails if a published
   category score disagrees with the recomputed credit. R4's arithmetic error
   could not survive this check.

Baseline 5 is banked at monorepo `1a2f2a30f` (pushed; all eight workflows green)
with a banked score of **270/1000**: 50 core React journeys, 5 module React
journeys, 21 Web UK journeys, 1 staff journey, 0 mobile journeys, 68
consumed-contract correctness, 46 schema, 46 security/localization, 11
background/providers, 22 CI/operational. Exact deductions are respectively 120,
125, 99, 149, 120, 42, 14, 14, 29 and 18. Denominator source: the ledger at
**250 rows** across six tiers.

The full derivation, evidence pointers and five-block record live in
[`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md), which
remains the canonical current score. This runbook records the baseline's
existence and denominator only.

## Historical Published Evidence

The two dated checkpoints below explain how Fixed Rubric Baseline 1 was first
advanced. They are audit history, not a second current score source. The
canonical ASP.NET status document decides which published movement remains
banked now.

### 2026-07-14 Marketplace Payment Settlement (Published)

Evidence snapshot: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, ASP.NET parent
`1871130ed5dff15e5333f4110d46f44395c1ae53`, captured 2026-07-14
12:24:14 +01. This published slice replaces the local fake-payment-intent path with
Stripe destination-charge orchestration: currency-exponent-aware amounts,
stable idempotency, exact provider identity/economics validation, buyer and
tenant ownership, checkout claim/expiry guards, post-provider race rechecks,
orphan-intent cancellation, provider-revalidated confirmation replay, signed
marketplace webhook reconciliation, durable payment/payout rows, and seller
payout/balance projections. Escrow remains explicitly fail-closed.

Migration `20260714105831_MarketplacePaymentSettlementParity` adds the payment
ledger, tenant/order composite integrity, unique provider intent, seller
onboarding state, checkout mode, and expiry fields with economic/status checks.
It applies to disposable PostgreSQL and EF reports no pending model changes.
The Release API build passes with zero errors. New payment-service proof passes
9/9; the payment-facing BuyNow controller case also passes. The broad existing
Marketplace controller class is not green: two independently reproduced stale
assertions still expect the pre-DSA report projection and camel-case admin
moderation field. Full-suite/CI, live Stripe/Connect, escrow/refunds/disputes,
notifications, feature gating, localization depth, and unchanged-frontend
runtime proof remain open.

Published commit `768801f129747ebcb8ae2f52dd9d34f851f20df9` banks 8 semantic
and 4 schema points for **632/1000**:
100/100 route, 258/350 semantic, 114/150 schema, 90/100 security/localization,
45/100 build/test/CI, 10/125 unchanged-frontends, and 15/75 providers/ops/docs.
Exact remaining deductions are 0, 92, 36, 10, 55, 115, and 60 points.

### 2026-07-14 Marketplace Connect Onboarding (Published)

Evidence snapshot: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, ASP.NET parent
`8193cd3870432688e397c6a5681d190fa2e1f58f`, captured 2026-07-14
13:17:30 +01. Seller onboarding now creates or reuses a real Stripe Express
account under a stable tenant/user idempotency key and PostgreSQL advisory
lock, requests card-payment and transfer capabilities, and generates tenant-
correct single-use account links. The response preserves Laravel's
`account_id`/`onboarding_url` fields and also supplies the unchanged canonical
React consumer's current `url` alias.

Status reads retrieve live provider state and only mark onboarding complete
when details, charges, and payouts are all enabled. Signed `account.updated`
webhooks share the same locked transition, support disablement, persist
sanitized replay evidence, and emit exactly one recipient-locale in-app bell
plus best-effort push on the incomplete-to-complete transition. Migration
`20260714115746_MarketplaceConnectOnboardingParity` aligns the Laravel
100-character account ID, adds global provider-account uniqueness, and blocks
overlong or duplicate legacy values for operator reconciliation rather than
truncating or choosing a financial identity.

Release builds pass with zero errors. Focused payment/Connect/provider/webhook
proof passes 13/13, the existing onboarding contract plus route-ownership gate
passes 115/115, both marketplace migrations apply to disposable upgraded
PostgreSQL, generated SQL contains the preflight guards, and EF model drift is
clear. No live Stripe credentials were used, so live-provider certification,
escrow/refunds/disputes, payment-confirmation notifications, feature gating,
full-suite/CI, and unchanged-frontend runtime proof remain open.

Published commit `25110d7fb98dfed4e2eabbea016924cee93f9b9d` banks 4 semantic,
1 schema, and 1 provider/operations point for **638/1000**: 100/100 route,
262/350 semantic, 115/150 schema, 90/100
security/localization, 45/100 build/test/CI, 10/125 unchanged-frontends, and
16/75 providers/ops/docs. Exact remaining deductions are 0, 88, 35, 10, 55,
115, and 59 points.

### 2026-07-14 Marketplace Paid Notifications And Order Identity (Published)

Evidence snapshot: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, ASP.NET implementation
`f562c49796b81ac2ea47a4699dc22f9f0e57f9c0`, captured 2026-07-14
15:22:08 +01:00. The first provider-verified paid transition now independently
delivers buyer/seller email and buyer/seller in-app bells under each recipient's
locale for all 11 Laravel locales. It preserves Laravel's `marketplace_order`
type and `/marketplace/orders/{id}` link, formats zero- and two-decimal
currencies correctly, HTML-escapes listing copy, and uses tenant-correct email
URLs. The unchanged canonical React flow is covered through the signed
`payment_intent.succeeded` webhook rather than relying on its unused fallback
confirm endpoint.

Delivery identity is durable per tenant/order/event/user/channel. Delivered or
skipped channels never duplicate; failed and stale claims retry with attempt,
provider-evidence, and sanitized-error history. Payment remains committed when
email delivery fails, bells remain independent, and direct or webhook replay
heals incomplete channels without reopening financial state. Marketplace order
numbers are now persisted as non-enumerable `MKT-{ULID}` identities instead of
fabricated response-time IDs. Migration
`20260714132232_MarketplacePaidNotificationParity` safely backfills existing
orders, fails preflight on duplicate identity, and adds the canonical delivery
ledger constraints and indexes.

Release API build passes with zero errors; the complete focused payment,
Connect, signed-webhook, notification, failure, and replay class passes 16/16.
The migration applies to disposable upgraded PostgreSQL, the database has zero
blank order numbers, and EF reports no pending model changes. Comparator
fixtures pass and the live inventory remains 2,601/2,601 active operations with
zero missing. No live Stripe or email credentials were used, the canonical
Laravel `/marketplace/orders/{id}` link currently has no matching React detail
route, and full-suite/CI plus unchanged-client runtime certification remain
open.

Published implementation `f562c49796b81ac2ea47a4699dc22f9f0e57f9c0`
banks 4 semantic, 2 schema, and 1 provider/operations point for **645/1000**:
100/100 route, 266/350 semantic, 117/150 schema, 90/100
security/localization, 45/100 build/test/CI, 10/125 unchanged-frontends, and
17/75 providers/ops/docs. Exact remaining deductions are 0, 84, 33, 10, 55,
115, and 58 points.

### 2026-07-14 Marketplace Escrow Settlement And Delayed Payout (Published)

Evidence snapshot: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, ASP.NET implementation
`93417bd17e886e8d05e054ec2f679a4851c6ae26`, captured 2026-07-14
17:08:02 +01:00. Escrow-enabled checkout now creates a Stripe separate charge
under a stable transfer group instead of returning a placeholder conflict.
Provider-verified capture atomically records a tenant-bound escrow hold; buyer
delivery confirmation starts the Laravel-compatible dispute window without
prematurely completing the order or paying the seller.

Eligible releases run hourly and create a source-charge-bound Connect transfer
under a stable idempotency key. The service locks and rechecks tenant, order,
payment, dispute, deadline, and provider evidence before transfer; persists
scheduled, paid, failed, and ambiguous states; finalizes the order only after
provider success; and emits one idempotent seller payout bell in the recipient's
locale. Migration `20260714150317_MarketplaceEscrowSettlementParity` adds the
escrow ledger, composite tenant integrity, lifecycle timestamps, economic/status
checks, unique order/payment identities, and release indexes.

The migration applies to disposable upgraded PostgreSQL and EF reports no model
drift. The Release API build passes with zero errors and three known unrelated
warnings. The combined payment-service/controller proof passes 20/20 twice,
the comparator fixture passes, and the live inventory remains 2,601/2,601 active
operations matched with zero missing. No live Stripe credentials were used;
refund execution, provider-backed dispute resolution, refund/dispute webhook
reconciliation, full-suite/CI, and unchanged-client runtime certification remain
open.

Published implementation `93417bd17e886e8d05e054ec2f679a4851c6ae26`
banks 8 semantic, 4 schema, and 2 provider/operations points for **659/1000**:
100/100 route, 274/350 semantic, 121/150 schema, 90/100
security/localization, 45/100 build/test/CI, 10/125 unchanged-frontends, and
19/75 providers/ops/docs. Exact remaining deductions are 0, 76, 29, 10, 55,
115, and 56 points.

### 2026-07-14 Marketplace Provider Refunds (Published)

Evidence snapshot: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, ASP.NET implementation
`4f7b9f202322d792574f2003274fadfda9e7037d`, captured 2026-07-14
18:27:08 +01:00. Admin buyer dispute resolution now performs real full or
partial Stripe refunds instead of unconditionally failing fiat settlement.
Destination charges request Stripe transfer/application-fee reversal; a paid
separate-charge payout receives an explicit, stably idempotent transfer
reversal for only the seller share. Cumulative refund identity is stable across
retries, provider economics are revalidated, and full refunds restore inventory
and close order/escrow state while partial refunds retain the remaining seller
economics.

Migration `20260714165402_MarketplaceRefundReconciliationParity` adds a durable
tenant/payment-bound refund ledger with globally unique Stripe refund identity,
provider-dispute evidence columns, refund-aware payment economics, and a fail-
closed preflight for legacy refunded rows without ledger evidence. It applies
to disposable upgraded PostgreSQL and EF reports no model drift. The Release
API build passes with zero errors and three known unrelated warnings; the full
marketplace payment plus dispute gate passes 24/24. Signed external-refund and
charge-dispute reconciliation, refund notification delivery, live Stripe proof,
full-suite/CI, and unchanged-client runtime certification remain open.

Published implementation `4f7b9f202322d792574f2003274fadfda9e7037d`
banks 5 semantic, 3 schema, and 1 provider/operations point for **668/1000**:
100/100 route, 279/350 semantic, 124/150 schema, 90/100
security/localization, 45/100 build/test/CI, 10/125 unchanged-frontends, and
20/75 providers/ops/docs. Exact remaining deductions are 0, 71, 26, 10, 55,
115, and 55 points.

### 2026-07-14 Signed External Marketplace Refund Reconciliation (Published)

Evidence snapshot: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, ASP.NET implementation
`ef8a0cf8d9458abda8350f8bf2a5adca44f12724`, captured 2026-07-14
18:53:01 +01:00. The signed Stripe marketplace webhook now parses
`charge.refunded`, binds the charge and PaymentIntent to one local payment,
requires destination-charge transfer/application-fee reversal evidence, and
recovers paid separate-charge transfers with stable reversal idempotency. Each
provider refund enters the existing tenant/payment ledger exactly once; event
replay is idempotent, incomplete expanded-refund detail fails closed, and no
local financial state advances when reversal evidence is unsafe.

The Release API build passes with zero errors and three known unrelated warnings.
The complete marketplace payment/dispute gate passes 26/26. Charge-dispute
created/updated/closed win/loss reconciliation, refund notifications, live Stripe
proof, full-suite/CI, and unchanged-client runtime certification remain open.

Published implementation `ef8a0cf8d9458abda8350f8bf2a5adca44f12724`
banks 3 semantic and 1 provider/operations point for **672/1000**: 100/100
route, 282/350 semantic, 124/150 schema, 90/100 security/localization, 45/100
build/test/CI, 10/125 unchanged-frontends, and 21/75 providers/ops/docs. Exact
remaining deductions are 0, 68, 26, 10, 55, 115, and 54 points.

### 2026-07-14 Held-Escrow Charge-Dispute Reconciliation (Published)

Evidence snapshot: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, ASP.NET implementation
`027f35e6189eee13eb05396050a2995706597cad`, captured 2026-07-14
19:15:17 +01:00. Signed Stripe charge-dispute created/updated/closed events now
bind provider charge/dispute identity to one tenant payment while funds remain
held. Open events freeze the order and escrow; a win restores the prior order
state and makes escrow releasable; a loss records the provider exposure in the
durable refund ledger and closes full-refund order/escrow state. Event replay is
idempotent. Paid or scheduled payouts remain fail-closed pending transfer lookup,
reversal, and won-dispute reimbursement evidence.

The Release API build passes with zero errors and three known unrelated warnings;
the complete marketplace payment/dispute gate passes 28/28. Paid-transfer dispute
recovery, refund notifications, live Stripe proof, full-suite/CI, and unchanged-
client runtime certification remain open.

Published implementation `027f35e6189eee13eb05396050a2995706597cad`
banks 3 semantic and 1 provider/operations point for **676/1000**: 100/100
route, 285/350 semantic, 124/150 schema, 90/100 security/localization, 45/100
build/test/CI, 10/125 unchanged-frontends, and 22/75 providers/ops/docs. Exact
remaining deductions are 0, 65, 26, 10, 55, 115, and 53 points.

### 2026-07-14 Paid-Transfer Charge-Dispute Recovery (Published)

Evidence snapshot: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, ASP.NET implementation
`9875fb5dd33e3ab5c33ea77a83fcfb0b8c6c0b00`, captured 2026-07-14
19:36:08 +01:00. Paid separate-charge disputes now reverse the proportional
seller exposure once and persist that reversal in the dispute ledger; a provider
win recreates exactly the recorded seller share under a stable reimbursement
idempotency key. Destination-charge losses retrieve the transfer identity from
the Stripe charge when no local payout id exists and reverse the same proportional
seller exposure. Subsequent events reuse the ledger and cannot double-move funds.

The Release API build passes with zero errors and three known unrelated warnings;
the complete marketplace payment/dispute gate passes 30/30. Localized refund
notification evidence, live Stripe proof, full-suite/CI, and unchanged-client
runtime certification remain open.

Published implementation `9875fb5dd33e3ab5c33ea77a83fcfb0b8c6c0b00`
banks 3 semantic and 1 provider/operations point for **680/1000**: 100/100
route, 288/350 semantic, 124/150 schema, 90/100 security/localization, 45/100
build/test/CI, 10/125 unchanged-frontends, and 23/75 providers/ops/docs. Exact
remaining deductions are 0, 62, 26, 10, 55, 115, and 52 points.

### 2026-07-14 Marketplace Refund Notification Evidence (Published)

Evidence snapshot: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, ASP.NET implementation
`b37a3cc5ed903394b67813a3e34304213b9e150d`, captured 2026-07-14
20:35:12 +01:00. Manual and signed-webhook refunds now deliver Laravel-compatible
buyer and seller bells plus recipient-locale emails after financial state commits.
The existing durable delivery ledger suppresses an evidenced refund email per
recipient/order, creates a new bell only for a distinct partial/full amount
message, retries failed channels without repeating provider money movement, and
collapses multi-refund Stripe webhook payloads into one cumulative notification.

The Release API build passes with zero errors and three known unrelated warnings;
the Release test assembly builds with zero warnings and the complete marketplace
payment/dispute gate passes 30/30. Live Stripe/Connect proof, full-suite/CI, and
unchanged-client runtime certification remain open.

Published implementation `b37a3cc5ed903394b67813a3e34304213b9e150d`
banks 3 semantic and 1 provider/operations point for **684/1000**: 100/100
route, 291/350 semantic, 124/150 schema, 90/100 security/localization, 45/100
build/test/CI, 10/125 unchanged-frontends, and 24/75 providers/ops/docs. Exact
remaining deductions are 0, 59, 26, 10, 55, 115, and 51 points.

### 2026-07-14 Secure SSO/OIDC Authentication Parity (Published)

Evidence snapshot: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, ASP.NET implementation
`c20d064e6adb99d3a585efd299650d5e913180ff`, captured 2026-07-14
23:50:46 +01:00. The former unsigned state and non-functional exchange stub are
replaced by durable signed state, browser PKCE, server PKCE, OIDC nonce and JWKS
validation, public-HTTPS endpoint pinning, tenant-qualified identity linking,
domain and account-policy gates, one-time browser-bound exchange codes, and
refresh-token issuance. The migration adds the durable flow, callback-grant,
identity, and authentication-invalidation state required by those contracts.

Release API and test-assembly builds pass. The focused fake-IdP authentication
suite passes 4/4, the broader focused SSO controller/service set passes 10/10,
and migration SQL generation from the prior published migration contains only
the intended authentication tables, indexes, and user invalidation column. The
public-controller SSO/OAuth compatibility check subsequently passes 1/1 against
a stable, separately named disposable PostgreSQL database. Full-suite/CI and
unchanged-client runtime points remain open.

Published implementation `c20d064e6adb99d3a585efd299650d5e913180ff`
banks 8 semantic, 3 schema, and 3 security points for **698/1000**: 100/100
route, 299/350 semantic, 127/150 schema, 93/100 security/localization, 45/100
build/test/CI, 10/125 unchanged-frontends, and 24/75 providers/ops/docs. Exact
remaining deductions are 0, 51, 23, 7, 55, 115, and 51 points.

### 2026-07-15 Tenant Bootstrap Runtime Evidence (Published)

Evidence snapshot: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, tenant-bootstrap implementation
`5fbcf36dedf320c0ca81ac77f8b4771d891f7331`, ASP.NET verification HEAD
`ccd109fc4dc67b0b117780b2130d519e6bb38eea`, captured 2026-07-15
00:04:57 +01:00. Explicit slug resolution is authoritative and fail-closed,
custom Host precedes Origin, Origin is accepted only on the shared Host, and an
unknown explicit slug cannot fall back to an authenticated tenant header or the
default tenant.

The corrected focused tenant-bootstrap set passes 4/4 and the containing
public-compatibility class passes 11/11 against the same separately named
disposable PostgreSQL database through `NEXUS_TEST_POSTGRES`. The ordinary
Testcontainers mapped connection reproduced a Docker transport reset during
`EnsureCreatedAsync`; no test method executed in that failed attempt, and it is
not reported as an application failure. The stable external-container path
completed schema creation, seed/reset, HTTP host/origin handling, and cleanup.

This closes the previously published provisional movement and banks 2 semantic
and 1 security/tenant-isolation point for **701/1000**: 100/100 route, 301/350
semantic, 127/150 schema, 94/100 security/localization, 45/100 build/test/CI,
10/125 unchanged-frontends, and 24/75 providers/ops/docs. Exact remaining
deductions are 0, 49, 23, 6, 55, 115, and 51 points.

### 2026-07-15 Social Comment Mention Parity (Published)

Evidence snapshot: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, ASP.NET implementation
`1ff6447012c89744e94d6693463a8032361c5946`, captured 2026-07-15
00:52:15 +01:00. Canonical mention search now exposes Laravel's optional,
tenant-unique public username rather than leaking the member email address. The
legacy social-comment mutation resolves canonical React `@username` tokens,
persists one durable mention per comment/recipient, and creates recipient-locale
mention, direct-reply, and content-owner notifications with push fan-out after
the database transaction commits.

The shared safeguarding policy evaluates the complete recipient set while the
relational write transaction is held. Denial returns Laravel's stable policy
envelope and persists no comment, mention, or notification. The migration adds
the Laravel-compatible username and mention state, with tenant-composite foreign
keys preventing cross-tenant mentioned/mentioning users at the database boundary.

Release API and test builds pass with zero errors. The complete affected V15
controller class passes 17/17, focused workflow proof passes 4/4, and unchanged
canonical React mention search plus the real PostgreSQL mention/notification
mutation pass 2/2. Migration SQL from the prior published migration contains
only the username column, mention table, tenant-bound foreign keys, and indexes.
Full-suite/CI, broader provider delivery, and unchanged-browser proof remain open.

This banks 4 semantic, 2 schema, and 1 security/localization point for
**708/1000**: 100/100 route, 305/350 semantic, 129/150 schema, 95/100
security/localization, 45/100 build/test/CI, 10/125 unchanged-frontends, and
24/75 providers/ops/docs. Exact remaining deductions are 0, 45, 21, 5, 55,
115, and 51 points.

### 2026-07-15 Social Comment Sanitizer Parity (Published)

Evidence snapshot: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, ASP.NET implementation
`293796e0f17b91e446f49a28babd960de7681e27`, captured 2026-07-15
01:15:28 +01:00. Legacy social comment and reply writes now sanitize HTML before
persistence and mention resolution with Laravel's tag, attribute, protocol, and
anchor-rel contract. Script and style blocks are removed with their contents;
event handlers, inline styles, and dangerous URL schemes are stripped; safe
formatting is retained. Mentions embedded only in removed executable content do
not create mention rows or recipient notifications.

The Release API build passes with zero errors, the sanitizer regression passes
1/1, and the complete affected V15 social compatibility class passes 18/18.
The selected HtmlSanitizer dependency and its transitive graph report no known
vulnerable packages from the configured NuGet source. Full-suite/CI, V2 generic
comment sanitizer coverage, unchanged-browser proof, and provider-backed push
delivery remain open.

This banks 1 semantic and 1 security/localization point for **710/1000**:
100/100 route, 306/350 semantic, 129/150 schema, 96/100
security/localization, 45/100 build/test/CI, 10/125 unchanged-frontends, and
24/75 providers/ops/docs. Exact remaining deductions are 0, 44, 21, 4, 55,
115, and 51 points.

### 2026-07-15 V2 Generic Comment Sanitizer Parity (Published)

Evidence snapshot: Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf`, ASP.NET implementation
`5fa15e0e79993464622b1c3ef053fcdd01679991`, captured 2026-07-15
01:26:01 +01:00. Generic threaded-comment create and edit now sanitize in the
shared service, covering `/api/v2/comments` and other service consumers. The V2
contract now preserves Laravel-allowed formatting instead of stripping every
tag, while removing executable blocks, event handlers, inline styles, and
dangerous URL schemes before persistence.

The Release API build passes with zero errors. On separately named disposable
PostgreSQL databases, the unchanged-canonical-React CRUD/reply/list/reaction/
delete contract with sanitizer assertions passes 1/1 and the containing
Comments V2 controller integration class passes 5/5. Full-suite/CI,
mention/notification side effects on the generic V2 path, and unchanged-browser
proof remain open.

This banks 1 semantic and 1 security/localization point for **712/1000** *(the
Baseline 1 total; superseded by Baseline 2's 598/1000 on 2026-08-18)*:
100/100 route, 307/350 semantic, 129/150 schema, 97/100
security/localization, 45/100 build/test/CI, 10/125 unchanged-frontends, and
24/75 providers/ops/docs. Exact remaining deductions are 0, 43, 21, 3, 55,
115, and 51 points.

## Historical Checkpoints

Everything in this section is dated implementation evidence. Its older
implementation/certification/combined percentages, route denominators, “current”
wording, and remaining-work lists are retired and must not override the fixed
rubric or the two current status documents above.

### 2026-07-14 Retired Vetting OpenAPI Reconciliation (Locally Verified)

The final seven apparent static gaps were stale OpenAPI-only document-era vetting
writes, not live Laravel contracts. Laravel's current route table deliberately omits
generic create/bulk/update/delete/upload/verify/reject operations; its controller says
there is intentionally no evidence, certificate, arbitrary-status, upload, bulk, or
delete endpoint; Laravel feature tests assert the removed routes return 404/405; and
the canonical React client calls only metadata-only list/show/policy/confirm/revoke/
review operations. Adding ASP.NET owners would therefore have broken parity and revived
a prohibited sensitive-evidence model.

The comparator now reports raw and retired OpenAPI operations separately. A retired
candidate is excluded only while no live Laravel route file declares the same method/
path, so any future reintroduction automatically returns to the active gate. Its fixture
passes with that conditional behavior. The refreshed live result is **2,601/2,601
active operations matched, 0 missing**, with seven retired OpenAPI-only operations
reported separately. ASP.NET runtime proof confirms the same seven methods return
Laravel-compatible 404/405 and cannot mutate either legacy `vetting_records` or current
`member_vetting_attestations`; the full safeguarding controller class passes 11/11.
The Release API/test build is green with zero errors and only the two pre-existing
Event Safety nullable warnings plus four pre-existing xUnit blocking warnings.

Implementation remains **875/1000** because no prohibited write was added.
Certification confidence advances to **755/1000**, and the honest combined finish-line
estimate is **80%**, up from 79%. Static route parity is now closed, but it is still not
the 1000/1000 gate: real fiat settlement, complete-suite/CI proof, unchanged-frontend
browser proof, schema/localization depth, federation transport, and live-provider
evidence remain open. No production resource or frontend source was touched.

### 2026-07-14 ASP.NET Prerender Control-Plane Checkpoint (Locally Verified)

The external `POST /api/v2/prerender/invalidate` hook and administrator
`POST /api/v2/admin/prerender/reset-all` operation now have explicit Laravel-
compatible owners. Invalidation accepts a configured constant-time bearer token,
timestamped HMAC over the raw body with a five-minute skew window and one-time nonce,
or a platform-super-admin session. It canonicalizes and de-duplicates at most 500
routes, rejects traversal/ambiguous/encoded separator aliases, rate-limits external
callers, commits durable recache intent before deletion, and reports only snapshot
bundles actually removed. Filesystem containment rejects reparse/symlink escapes and
status-bearing bundles; ordinary tenant administrators cannot enter the control plane.

Reset-all requires the exact `RESET ALL SNAPSHOTS` confirmation, enforces the canonical
one-per-five-minute operator limit, serializes the global control state, fences every
older queued/claimed/running job, enqueues one high-priority force rebuild for the
fresh active-tenant plan, writes its success audit in the same transaction, and returns
Laravel's 202 data envelope. Prerender job/audit state is now platform-global rather
than incorrectly hidden under the calling tenant.

Focused PostgreSQL runtime proof passes 7/7 and the combined prerender plus broad admin
route-ownership gate passes 121/121. Comparator fixtures pass; Debug API/test and
Release API builds have zero errors (only the two pre-existing Event Safety nullable
warnings and four old xUnit warnings). The refreshed live comparator reports 4,554
ASP.NET operations and **2,601/2,608 matches (99.7%, 7 static misses)**. Those seven
are exactly the document-era vetting create/bulk/update/delete/upload/verify/reject
writes.

Retired provisional checkpoint scores under the pre-fixed-rubric scale were **875/1000 implementation** and **750/1000
certification confidence**. The honest combined finish-line estimate is **79%**, up
from the goal baseline of 42% and the previous checkpoint of 78%. Legacy-evidence
vetting safety, real fiat settlement, complete-suite/CI proof, unchanged-frontend
browser proof, schema/localization depth, federation transport, and live-provider
evidence remain open. No production resource or frontend source was touched.

### 2026-07-14 ASP.NET Group Auto-Assignment Checkpoint (Locally Verified)

All four canonical administrator auto-assignment routes now own a real typed workflow
instead of the prior recorded-only placeholder. List joins only same-tenant groups and
conceals poisoned cross-tenant rows. Create validates group ownership, rule type, and
required value. Update supports Laravel's partial `group_id`, `rule_type`, `rule_value`,
and `is_active` contract, locks the tenant-owned rule, rejects empty/invalid changes,
and never moves a rule to a foreign group. Delete is locked and tenant-concealed.
Create, update, and delete append durable actor/before/after audit evidence in the same
serializable transaction and return the canonical data/meta envelopes.

Migration 146 (`20260714054826_GroupAutoAssignmentParity`) adds the canonical
snake-case table, rule/value constraints, indexes, tenant/group foreign keys, and
tenant query filter. It applies on both maintained disposable PostgreSQL histories;
focused lifecycle/isolation proof passes 2/2 on each; the combined focused/route-
ownership gate passes 116/116; EF model drift is clean; comparator fixtures pass; and
Debug test-project plus Release API builds have zero errors. The live comparator
reports 4,551 ASP.NET operations and **2,599/2,608 matches (99.7%, 9 static misses)**.

Retired provisional checkpoint scores under the pre-fixed-rubric scale were **870/1000 implementation** and **745/1000
certification confidence**. The honest combined finish-line estimate is **78%**, up
from the goal baseline of 42% and the previous checkpoint of 77%. The remaining seven
document-era vetting writes, two prerender operations, real fiat settlement, complete-
suite/CI proof, unchanged-frontend browser proof, schema/localization depth, federation
transport, and live-provider evidence remain open. No production resource or frontend
source was touched by this backend slice.

### 2026-07-14 ASP.NET Podcast Artwork Checkpoint (Locally Verified)

The canonical show-artwork and episode-cover uploads now have explicit owners at
`POST /api/v2/podcasts/{id}/artwork` and
`POST /api/v2/podcasts/{showId}/episodes/{episodeId}/cover`, with legacy aliases.
Both accept the React client's `image` multipart field, persist an allow-listed image
through the platform file service, return `{success,data:{url}}`, bind the stored file
to the tenant and podcast subject, and save only the platform download URL. Missing or
invalid images return Laravel-style 422 validation; foreign ownership returns 403;
cross-tenant identifiers return 404; and failed state changes remove the staged file.
Approved shows and episodes return to pending moderation when their artwork changes.

A dedicated authenticated fixed-window policy enforces 10 uploads per 60 seconds.
Focused controller/runtime proof passes 4/4; invalid, unauthorized, and cross-tenant
attempts leave no file rows; route ownership passes 114/114; comparator fixtures pass;
and Release API/test-project builds have zero errors. The live comparator reports 4,550
ASP.NET operations and **2,598/2,608 matches (99.6%, 10 static misses)**.

At this checkpoint, provisional global scores were **865/1000 implementation** and
**740/1000 certification confidence**, with a **77%** combined estimate, up
from the goal baseline of 42% and the previous checkpoint of 76%. The remaining seven
document-era vetting writes, two prerender operations, one group-auto-assignment
operation, real fiat settlement, complete-suite/CI proof, unchanged-frontend browser
proof, schema/localization depth, federation transport, and live-provider evidence
remain open. No production resource or frontend source was touched by this slice.

### 2026-07-14 ASP.NET Atomic Notification Settings Checkpoint (Locally Verified)

The canonical React member-settings save at
`PUT /api/v2/users/me/notification-settings` now has one concrete owner and one
serialized transaction across all three Laravel domains. The complete typed general
notification set and federation opt-in persist on the tenant-owned user, match
frequency/hot/mutual settings persist on the unique tenant/user match-preference row,
and global activity-digest cadence persists in the existing notification-settings
ledger. Weekly match and digest values normalize to Laravel's canonical `monthly`.

The endpoint requires every canonical boolean and both nested aggregates, rejects
invalid or incomplete input before opening a transaction, returns the exact canonical
saved projection, and is protected by a dedicated authenticated 10-per-60-second
fixed-window policy. Migration 145 (`20260714042710_AtomicNotificationSettingsParity`)
adds the exact federation and match-notification columns with safe existing-row
defaults and canonical snake-case names.

Migration 145 applies to both upgraded and blank-chain disposable PostgreSQL. EF
model drift is clean; focused proof passes 2/2 on each database; the affected member-
settings set passes 6/6; route ownership passes 114/114; comparator fixtures pass;
and Debug test-project plus Release API builds have zero errors. The live comparator
reports 4,546 ASP.NET operations and **2,596/2,608 matches (99.5%, 12 static misses)**.

At this checkpoint, provisional global scores were **860/1000 implementation** and
**735/1000 certification confidence**, with a **76%** combined estimate. The remaining
document-era vetting writes, podcast artwork, prerender, and group-auto-assignment
routes, real fiat settlement, complete-suite/CI proof, unchanged-frontend browser
proof, schema/localization depth, federation transport, and live-provider evidence
remain open. No production resource or frontend source was touched by this backend
slice.

### 2026-07-14 ASP.NET Event Configuration Policy Checkpoint (Locally Verified)

The four canonical administrator event-configuration routes now own a typed,
tenant-safe policy aggregate rather than falling through the missing-route surface.
Reads expose effective/default settings, version, platform capabilities, and live
impact counts. Updates use serializable locking and optimistic versions, preserve
unrelated tenant configuration, reject unknown or incorrectly typed keys, enforce
waitlist and notification-consumer dependencies, require a reason, reject no-op and
stale writes, and require explicit confirmation before disabling a policy with live
registrations, waitlists, reminders, calendar tokens, shared events, or broadcasts.

Confirmed reminder disablement cancels pending reminders. Confirmed federation
disablement withdraws every shared tenant event, advances its federation version,
and appends the existing per-partner tombstone delivery evidence. Selective or full
restore removes only event overrides, increments the version only when something was
stored, and is idempotent on replay. Update/restore audit entries retain actor, reason,
version, changes, and time without exposing unrelated audit data. Platform-disabled
timed waitlist offers and authoritative outbox delivery fail closed.

Focused migrated-PostgreSQL proof passes 3/3, route ownership passes 114/114,
comparator fixtures pass, and Debug test-project plus Release API builds have zero
errors. No schema migration was needed because the existing tenant-config and audit
ledgers provide durable typed state and history. The live comparator reports 4,545
ASP.NET operations and **2,595/2,608 matches (99.5%, 13 static misses)**.

Retired provisional checkpoint scores under the pre-fixed-rubric scale were **855/1000 implementation** and **730/1000
certification confidence**. The honest combined finish-line estimate is **75%**,
up from the goal baseline of 42% and the previous checkpoint of 74%. The remaining
document-era vetting writes, podcast artwork, prerender, group-auto-assignment and
notification-settings routes, real fiat settlement, complete-suite/CI proof,
unchanged-frontend browser proof, schema/localization depth, federation transport,
and live-provider evidence remain open. No production resource or frontend source
was touched by this backend slice.

### 2026-07-14 ASP.NET Marketplace Dispute Settlement Checkpoint (Locally Verified)

Order disputes are no longer redirected into the listing-report workflow. Buyers
and sellers can open one active dispute for a tenant-owned order in an eligible
state, with canonical reason, bounded description, and safe evidence-URL validation.
Opening is serialized, preserves the prior order state, moves the order to
`disputed`, and creates durable in-app evidence.

The administrator queue returns the canonical opener, order, listing, buyer, seller,
evidence, status, and pagination projection. Serialized buyer/seller/closed
resolutions are replay-safe. Buyer resolution restores listing inventory exactly
once. Free orders settle at zero; time-credit orders require a complete, tenant-safe
original ledger fact and create a linked seller-to-buyer reversal for the full
amount. Seller/closed decisions restore the saved prior order state. Both
participants receive durable resolution notifications. Fiat buyer resolution fails
closed with `409 RESOLUTION_FAILED` and no mutation because ASP.NET still lacks the
provider/escrow settlement evidence required for a real refund.

Migration 144 (`20260714030824_MarketplaceDisputeSettlementParity`) adds the dispute
aggregate, wallet settlement links, state/reason/refund constraints, and tenant/order
indexes. The complete 144-migration chain replays on blank PostgreSQL and EF reports
no model drift. Focused behavior passes 3/3 on both upgraded and blank-chain
databases; the affected marketplace set passes 16/16; route ownership passes
114/114; comparator fixtures pass; and Debug test-project plus Release API builds
have zero errors. The live comparator reports 4,541 ASP.NET operations and
**2,591/2,608 matches (99.3%, 17 static misses)**.

Retired provisional checkpoint scores under the pre-fixed-rubric scale were **845/1000 implementation** and **720/1000
certification confidence**. The honest combined finish-line estimate is **74%**,
up from the goal baseline of 42% and the previous checkpoint of 73%. Real fiat
provider/escrow settlement, the remaining route shapes, complete-suite/CI proof,
unchanged-frontend browser proof, schema/localization depth, federation transport,
and live-provider evidence remain open. No production resource or frontend source
was touched by this backend slice.

### 2026-07-14 ASP.NET Marketplace Report Appeals Checkpoint (Locally Verified)

Marketplace reports now use the Laravel-compatible DSA notice-and-action lifecycle
rather than shallow `open/resolved` rows. Canonical creation validates reason,
description, safe evidence URLs, self-reporting, and duplicate active reports.
Reporter and affected-seller list/show projections are private and tenant-safe;
seller views never disclose reporter identity, notice description, or evidence URLs.
Only a reporter whose notice ended in no action or a seller affected by enforcement
can appeal.

Administrator queue, acknowledge, initial resolution, and appeal resolution are
serialized and state-guarded. Warning, listing removal, and seller suspension are
persisted with a pre-enforcement snapshot and report ownership markers. An appeal
decision that changes the action restores only rows still owned by that report, so
unrelated later moderation cannot be overwritten. Reporter/seller decisions create
durable in-app notifications.

Migration 143 (`20260714024014_MarketplaceReportAppealWorkflowParity`) safely maps
legacy report states/reasons before installing canonical checks, JSON evidence and
snapshot fields, appeal evidence, enforcement markers, and tenant/query indexes. The
complete migration chain replays on blank PostgreSQL, EF model drift is clean,
focused migrated-schema proof passes 2/2, the ownership/admin-marketplace gate passes
122/122, and Debug/Release builds have zero errors. The live comparator reports
4,537 ASP.NET operations and **2,589/2,608 matches (99.3%, 19 static misses)**.

Retired provisional checkpoint scores under the pre-fixed-rubric scale were **835/1000 implementation** and **710/1000
certification confidence**. The honest combined finish-line estimate is **73%**,
up from the goal baseline of 42% and the previous checkpoint of 72%. Marketplace
order-dispute settlement/refund parity, the remaining route shapes, complete-suite/
CI proof, unchanged-frontend browser proof, schema/localization depth, and live-
provider evidence remain open. No production resource or frontend source was
touched by this backend slice.

### 2026-07-14 ASP.NET Event Federation Reliability Checkpoint (Locally Verified)

Event lifecycle mutations now maintain a monotonic federation version and enqueue
one durable, idempotent delivery record per active Nexus event partner. Published,
scheduled listed/joinable events enqueue a privacy-minimal upsert; withdrawals and
terminal or private transitions enqueue tombstones to active and prior recipients.
The delivery ledger preserves schema, aggregate, and calendar versions, payload and
idempotency hashes, bounded attempts, claim timing, delivery/dead-letter state, and
safe error codes without foreign keys that could erase historical evidence.

Organizer and administrator diagnostics are owned at
`GET /api/events/{id}/federation-status` and its `/api/v2` alias. The private,
no-store response reports configured/recipient partner counts, health, latest
per-partner status, attempts, versions, timing, and sanitized error codes. It never
returns payloads, hashes, idempotency keys, raw provider errors, or member data;
member and cross-tenant access fail closed.

Migration 142 (`20260714012032_EventFederationReliabilityParity`) replayed after the
complete migration chain on a new PostgreSQL database. EF model drift is clean,
the combined current lifecycle/federation suite passes 14/14, route ownership passes
114/114, and Debug and Release builds succeed with zero errors. The live comparator
reports 4,529 ASP.NET operations and **2,585/2,608 matches (99.1%, 23 static
misses)**. The test reset fixture now truncates the new ledger so reused event IDs
cannot contaminate integration cases.

Retired provisional checkpoint scores under the pre-fixed-rubric scale were **825/1000 implementation** and **700/1000
certification confidence**. The honest combined finish-line estimate is **72%**,
up from the goal baseline of 42% and the previous checkpoint of 71%. Outbound claim,
HTTP signing/delivery, retry/dead-letter processing, inbound federation, complete-
suite/CI proof, unchanged-frontend-on-ASP.NET browser proof, broader schema and
localization depth, and live-provider evidence remain open. No production resource
or frontend source was touched by this backend slice.

### 2026-07-14 ASP.NET Custom Recurrence And Series Lifecycle Checkpoint (Locally Verified)

Event reminder preferences are no longer handled by the shallow event update/read
fallback. GET/PUT/DELETE now own a tenant-safe aggregate on both API aliases with
strict channel/cadence/rule validation, optimistic revisions, serializable locking,
soft-disabled rule history, reset-to-inherited semantics, resolved channel data,
and canonical limits/capabilities. Migration 141
(`20260714005420_EventReminderPreferencesParity`) replays after the full chain,
model drift is clean, focused migrated-schema proof passes 2/2, and route ownership
remains 114/114.

ASP.NET now accepts the reviewed Laravel custom RRULE subset (`FREQ`, `INTERVAL`,
`BYDAY`, `BYMONTHDAY`, `BYMONTH`, `WKST`, `COUNT`, and `UNTIL`) with canonical
ordering, DTSTART-derived defaults, WKST-aware weekly intervals, negative month
days, a 20-year horizon, UTC EXDATE/RDATE normalization, EXDATE precedence, and
local wall-time preservation across DST. Invalid or contradictory rules fail
closed, and the rolling materializer uses the same canonical generator.

Recurring lifecycle mutations now operate at series scope. Publication decisions
made through a child resolve to the root and propagate to all occurrences;
operational cancel/archive/postpone/complete/restore/reschedule on a template update
the root and future occurrences. One serializable transaction and root advisory
lock preserve immutable per-member history, consolidate recipients and moderation,
emit one authoritative root outbox fact, and cascade terminal RSVP, waitlist, and
reminder effects. Member, compatibility-alias, and admin cancel/delete routes use
this lifecycle instead of direct flag writes or physical deletion, and
`/api/v2/admin/events` has a concrete owner.

The migrated recurrence suite passes 9/9 and the lifecycle suite passes 11/11.
The admin route-ownership suite passes 114/114. Debug and Release builds have zero
errors, EF model drift is clean, and comparator fixture/live refresh remain green.
The canonical self-relationship read now projects redacted registration, waitlist,
attendance, capacity, and action facts on both aliases; personal calendar, guardian
grant, and guest-attendance aliases are explicitly represented. The live inventory
is 2,584/2,608 operations (99.1%, 24 static misses). A legacy admin-controller test
attempt was environment-blocked before application assertions because Testcontainers
could not initialize its resource reaper; it is unknown rather than green.

Retired provisional checkpoint scores under the pre-fixed-rubric scale were **820/1000 implementation** and **695/1000
certification confidence**. The honest combined finish-line estimate is **71%**,
up from the goal baseline of 42% and the previous published checkpoint of 68%.
The 24 remaining route shapes, complete-suite/CI proof, unchanged canonical-
frontend-on-ASP.NET browser proof, broader schema/localization depth, and live-
provider evidence remain open. No production resource or frontend file was touched.

### 2026-07-13 ASP.NET Event Recurrence V2 Checkpoint (Locally Verified)

ASP.NET now owns the canonical recurrence capability, finite/never-series create,
effective revision preview/commit, and definition-blueprint history/preview/commit
contracts at both `/api/events` and `/api/v2/events`. Recurrence identities and
occurrence keys are stable, revision and blueprint commits are signed, stale-safe,
and exactly idempotent, and every materialized or revised occurrence appends
immutable evidence. Revision preview now fails closed for invalid timezones and
the same Dublin DST gap/fold conflicts exercised by Laravel.

The registered hourly rolling materializer uses tenant-isolated serializable
transactions and advisory locks. It extends only active draft/published scheduled
v2 never-series, persists bounded resume watermarks, inherits the latest effective
revision, applies the latest eligible immutable definition blueprint only to new
occurrences, and records one application ledger per occurrence. Portable agenda
sessions/speakers/resources, free ticket definitions, registration settings and
published forms/questions, published safety requirements, and active staff
assignments are supported. Paused/terminal roots do not grow; manifest hashes use
canonical JSON so PostgreSQL `jsonb` normalization cannot invalidate or conceal
tampering.

Migration 140 (`20260713192415_EventRecurrenceV2Parity`) replayed with the complete
migration chain on blank PostgreSQL and installs recurrence identity validation plus
append-only revision, occurrence, blueprint, and application guards. The focused
migrated-database suite passes 8/8 with zero skipped, including rolling truncation/
resume, future-only blueprint propagation, DST conflicts, tenant/token boundaries,
and database immutability. Debug and Release API builds pass with zero errors;
`has-pending-model-changes` is clean and the comparator fixture passes. The live
inventory is 2,579/2,608 (98.9%) with 29 static misses.

Retired provisional checkpoint scores under the pre-fixed-rubric scale were **800/1000 implementation** and
**675/1000 certification confidence**. The honest combined finish-line estimate is
**68%**, up from the goal baseline of 42% and the previous published checkpoint of
65%. Custom RRULE/exdate/rdate create input, full recurring-series lifecycle
propagation, the 29 remaining route shapes, complete-suite/CI proof, unchanged
canonical-frontend-on-ASP.NET browser proof, and live-provider evidence remain open.
No production resource or frontend file was touched by this backend slice.

### 2026-07-13 ASP.NET Event Publication Lifecycle Checkpoint (Locally Verified)

ASP.NET now owns the Laravel-compatible member event lifecycle at both `/api/events`
and `/api/v2/events`: submit for review, direct/admin publish, and manager-only
lifecycle history. The implementation enforces active tenant and linked-group
authority, creator/co-organizer management, the canonical moderation-required and
moderation-not-required conflicts, idempotent transitions, private/no-store reads,
strict React version-2 event projections, and event-bound opaque history cursors.
Submit, approve, reject, and publish update one durable
`content_moderation_queue` subject row atomically with immutable lifecycle history.

Migration 139 (`20260713180152_EventPublicationLifecycleParity`) applied cleanly
after the complete migration chain on a new PostgreSQL database. The focused suite
passes 8/8 against that migrated schema, including the database-installed
append-only history guard; the API/test build succeeds with zero errors, and
`has-pending-model-changes` reports no drift. The comparator fixture passes. A live
refresh confirms all three publication routes are represented. The Laravel source
grew concurrently from 2,592 to 2,608 operations, so the current global inventory
is 2,573/2,608 (98.7%) with 35 misses; that larger remainder does not reverse this
slice's three-route closure and is still static representation, not certification.

Retired provisional checkpoint scores under the pre-fixed-rubric scale were **780/1000 implementation** and
**650/1000 certification confidence**. The honest combined finish-line estimate is
**65%**, up from the goal baseline of 42% and the preceding checkpoint of 64%.
Recurring-series propagation, the newly exposed recurrence and relationship routes,
full-suite/CI evidence, canonical-frontend-on-ASP.NET browser proof, and live-provider
evidence remain open. No production resource or frontend file was touched.

### 2026-07-13 ASP.NET Event Analytics Checkpoint (Locally Verified And Published)

ASP.NET now implements the canonical organizer analytics summary and CSV export
contracts at both `/api/events/{id}/analytics` and `/api/v2/events/{id}/analytics`
(plus `/export.csv`). The identity-free version-1 projection derives registration,
invitation, waitlist, attendance, ticket, attendance-credit, communication,
optional-funnel, and guardian-consent metrics from their durable ledgers. Counts
below the configurable minimum-five privacy threshold are suppressed. Cross-tenant
and non-manager reads return 404, active co-organizers may read the summary, and
ticket finance remains redacted unless the actor has owner, administrator, or
finance-manager authority. Every dashboard or export read appends an immutable
access audit. CSV output is private/no-store, UTF-8 BOM encoded, localized across
the canonical locale set, and spreadsheet-formula safe.

Migration 138 (`20260713161512_EventAnalyticsParity`) adds the exact attendance
credit claim, optional analytics fact, withdrawal-run, and access-audit tables,
including tenant-scoped indexes, privacy/time/state constraints, and PostgreSQL
append-only guards. A new blank PostgreSQL database replayed the complete migration
chain through migration 138. `has-pending-model-changes` reports no drift, and
catalog inspection proves all four new immutability/deletion triggers are installed.
The Debug API and test projects compile with zero errors; only two existing
`EventSafetyService` nullable warnings and four existing `xUnit1031` test warnings
remain. The focused migrated-database runtime suite passes 4/4 with zero skipped:
canonical ledger counts and privacy, localized formula-safe CSV plus export audit,
tenant/manager authorization plus finance redaction, and database immutability.

The route comparator now understands constant-composed ASP.NET attributes and
retains compact multi-alias route parsing, with a passing synthetic regression
fixture. The refreshed live inventory represents 2,567/2,592 Laravel operations
(99.0%), up from 2,541/2,592 at the previous checkpoint, leaving 25 static misses.
This is route representation only, not semantic certification.

Retired provisional checkpoint scores under the pre-fixed-rubric scale were **770/1000 implementation** and
**635/1000 certification confidence**. The honest combined finish-line estimate is
**64%** (up from 62%). The increase is deliberately small because the complete
3,000-plus test suite, canonical-frontend-on-ASP.NET browser runs, CI, live-provider
evidence, and the remaining lifecycle/vetting/static-route queue are still open.
No production resource or frontend file was touched by this backend slice.

### 2026-07-13 ASP.NET Event Registration Product Checkpoint (Locally Verified; Publication Pending)

This uncommitted backend-only slice replaces the event-registration product
stubs with durable settings/forms/submissions, audited answer access and export,
campaign/invitation state, guest identity/consent/attendance/cancellation, and
retention workflows. It also installs Laravel-aligned role capabilities and
independent privacy projections: registration managers can manage registration,
view roster, and export non-sensitive answers, while sensitive answers and
retention remain owner/tenant-administrator only. Guest email and phone remain
owner/administrator-only even when roster names are visible. Active, unexpired
staff assignments and active linked-group audience membership are required.

All mutation replays now bind the tenant/event aggregate, action, revision, and
request payload. Reusing an idempotency key for changed settings, form content,
answers, submission state, invitation acceptance, or revocation fails closed.
Guest cancellation writes one deterministic revision-bound outbox event and
only replays the same actor/reason. Organizer and attendee reads now follow the
canonical draft/published boundaries, ordering, registration ownership, and
invitation timestamps. Guest locales normalize to Laravel's exact 11-locale
allowlist. Export is owner/role authorized, sensitive-gated, capped at 10,000
effective submitted/withdrawn attempts, audited, decoded, and spreadsheet-
formula safe with stable member/attempt/question headers.

Migrations 131 and 132 create and harden the product tables. Migration 134 adds
the per-channel delivery ledger and its evidence relationship; migration 133 is
the concurrent fresh-database compatibility repair. Migration 135 adds the
canonical user approval/preferred-language audience fields, exact Laravel
defaults, an existing-active-user backfill, and its supporting audience index.
Migration 136 adds durable email provider, provider-message, source, and
idempotency evidence plus a unique tenant/delivery-key index. Migration 137
adds canonical per-event and per-category notification preferences with scoped
unique indexes, cadence constraints, and tenant/user/event/category foreign
keys. A fresh blank PostgreSQL replay applied migrations through 135 before
migration 136 was added; the retained fully migrated replay database then
upgraded through 136 and 137. Catalog
inspection proves all four new columns, the `local` provider default, and the
correct partial unique index. `has-pending-model-changes` passes. Debug API and
test builds pass with zero errors; the latest API build has zero warnings and
the test build has four pre-existing `xUnit1031` warnings. No production
resource or frontend file was touched.

Invitation preview now expands member, email, group, CSV, and declarative
audience sources into an encrypted immutable snapshot. Group source authority
is rechecked at issuance, while the frozen recipient list does not drift when
membership changes. Preview, issuance, and delivery all recheck active tenant
subjects, event visibility, blocks against the issuer and organizer,
safeguarding contact policy against both actors, and external-event/public-group
rules. An email target that resolves to a registered member cannot bypass these
member checks. Neither initial issue nor idempotent replay exposes the bearer
secret; it remains encrypted delivery-only outbox material. External email links
carry the secret invitation token in an absolute tenant-qualified frontend URL.
Invitation email and token evidence uses keyed HMAC bound to the tenant and,
for tokens, the event; member invitations prefer the member's normalized locale.
Issuance creates five-channel preference and locale evidence plus durable child
delivery rows. The registered minute worker claims pending parents, validates
payload/token/subject evidence, performs in-app, email, push, and realtime work,
records suppression, retries with backoff, dead-letters after five attempts,
appends immutable terminal evidence, and completes the parent only when every
child is terminal. The focused processor test proves one notification, five
ledger rows, five initial evidence rows, five terminal evidence rows, and a
processed parent. Conditional database claims prove that only one of two
competing processors wins; claims abandoned for five minutes are reclaimed.
Malformed parents dead-letter after five claims. External email is tested both
for successful terminal delivery and for five provider rejections ending in a
terminal failed child with immutable failure evidence. Successful email is
recorded by delivery key before retry, with provider and provider-message
evidence when the transport exposes it. Web Push and FCM now select and dispatch
their own subscription families and maintain independent child-ledger evidence.
Live channel preferences are resolved at issue time and rechecked immediately
before delivery across event, category, global-user, and tenant-default layers;
explicit false values veto broader defaults and malformed/unavailable state
fails closed. Email also requires instant cadence. Declarative audiences
implement all canonical criteria, including approval,
preferred-language, and inclusive joined-date filters.

The final focused gate passed 18/18 with zero skipped: all 16 product tests plus
two provider-isolation/dispatch tests. The broader migrated-database filter
initially exposed missing `DeliveredAt` on terminal delivered evidence; after
the runtime row was corrected without weakening the migration constraint, the
two exact regressions passed 2/2 and the clean aggregate passed 21/21 with zero
skipped in 14m57s. This also proves the migration-installed waitlist history
trigger that `EnsureCreated` cannot install.

After the second independent review, four review-critical PostgreSQL checks
passed 4/4: API secret redaction plus absolute tenant delivery URL, tenant/event
HMAC binding, recipient-locale evidence, and live canonical preference
suppression. The complete product-class rerun then passed 16/16 with zero
skipped on the fully migrated PostgreSQL database in 8m17s.

Do not call global event-registration certification complete. The hosted
minute-loop itself still lacks a clock-controlled integration test. Full-suite,
route/runtime frontend, live-provider credential, and CI evidence also remain.

At this checkpoint the provisional global scores were **760/1000 implementation**
and **620/1000 certification confidence**. These superseded the 2026-07-10
64%/42% baseline but are not release-readiness claims. Route inventory remains
2,541/2,592 Laravel routes represented (98%); route representation is not
semantic workflow parity.

### 2026-07-12 ASP.NET Safeguarding And Messaging Checkpoint

Laravel at `C:\platforms\htdocs\staging` and the canonical React frontend remain
the read-only contract sources. This backend-only slice did not authorize or
require frontend changes; preserve unrelated `web-uk/` (repo root) edits.

The new safeguarding domain stores metadata only. Migration 112 creates the
five exact Laravel tables `tenant_safeguarding_settings`,
`member_vetting_attestations`, `member_vetting_attestation_events`,
`safeguarding_vetting_review_requests`, and
`safeguarding_policy_rotation_events`. Legacy vetting rows never authorize the
new contact policy, event/rotation history is append-only, and controllers
reject certificate files, reference numbers, arbitrary statuses, free text,
expiry dates, and other sensitive evidence.

Focused onboarding, member, administrator/broker vetting, policy rotation, and
safeguarding-option owners replace the generic recorded responses. Option
mutations use trigger/type allowlists, locks, live-selection weakening guards,
member re-evaluation, and audit. The exact risk buckets are onboarding save
5/minute, option mutation and vetting decision 60/minute, policy update
20/minute, policy rotation 5/minute, member mutation 10/minute, and message
restriction status 30/minute. Vetting throttles use Laravel `errors[]` and
retry/version/tenant headers.

Migration 113 adds `messaging_disabled` to
`user_monitoring_restrictions`, a documented workflow adapter for Laravel's
`user_messaging_restrictions`. Live status/admin monitoring now expire stale
state, validate reason and tenant/user boundaries, persist the flag/expiry,
audit/notify, and clear safeguarding-created approval on removal. Migration 114
widens preference values, requires consent time, installs one unique
tenant/user/option selection, and cascades tenant/option dependencies.

The recorded chain is now 115 migrations through
`20260712060051_DirectMessageStateParity`. A blank PostgreSQL replay applied all
115. A populated 114-to-115 upgrade preserved existing message content/read
timestamps and initialized new state to false/null; the nullable deletion-audit
user relationship uses `ON DELETE SET NULL`. The migration is forward-only. A
retained valid populated 113-to-114 upgrade preserved safeguarding rows and
filled null consent times from `CreatedAt`; a duplicate tenant/user/option
fixture raised `P0001` before DDL/data mutation, left history at 113, and left
no partial migration-114 schema. Exact catalog containment and
`has-pending-model-changes` are green. No production resource was touched.

Direct text send/thread now has detected attachment content, partial/staged
cleanup, sanitization and Unicode length, first-conversation serialization,
same-tenant inactive-recipient compatibility, corrected partner/attachment
projection, and awaited notification/XP/realtime effects. Blocked POST attempts
alert safeguarding staff once; reads do not. Voice send now uses a dedicated
detected-audio policy, preflight plus locked policy recheck, one transaction for
all graph rows, independent rollback/file cleanup, minimum-one-second duration,
and normal message effects. Spoofed audio and restricted sends leave no ghost
state. Provider transcription remains open.

The direct-message P0 state slice is implemented: sender-only edit accepts
React's `body`, enforces 24 hours, sanitizes, rechecks live policy, and persists
edited metadata; participant-safe delete records durable `self|everyone`
visibility instead of hard deletion; and partner-ID conversation archive/
restore persists per-user state, separates active/archived inbox reads, filters
hidden unread rows, and restores without deleting history.

Coordinator assistance now replaces the former synthetic success stub with a
server-authoritative policy recheck. It returns Laravel-style HTTP 422 errors
for self/nonpositive, missing/cross-tenant, unrestricted, and unavailable
requests; only genuine vetting/contact restrictions alert active tenant staff.
In-app plus email delivery is transactionally serialized and suppressed for
ten minutes after success, while failed or no-staff delivery remains retryable.
Every accepted request is audited and uses an independent authenticated
5-per-300-second bucket. Focused PostgreSQL coverage passed 16/16 and route
ownership passed 1/1.

Group exchange create/add/start/confirm/complete/cancel now follows Laravel's
caller and role order, dual-role/participant semantics, caller-visible status,
lifecycle guards, deterministic locking with caller-order policy evaluation,
canonical provider transaction rows, hidden ledger adapters, exact failure
contracts, conservation, idempotency, and first-writer behavior. Notification
depth and frontend runtime smoke remain open.

This checkpoint does not close direct messaging. Execute the remaining audited
residual in this order:

1. **P1 reactions completed 2026-07-12:** exact six-emoji allowlist, durable
   unique reactions, policy on add but withdrawal after closure, serialized
   toggles, participant-scoped batch aggregation, and independent rate buckets
   passed focused PostgreSQL and route-owner coverage 9/9. Migration 116 blank
   replay and model-drift checks are green.
2. **P1 typing completed 2026-07-12:** full message preflight, first-contact
   behavior without persistence, exact private tenant-user Pusher channel and
   `typing` payload, signed REST transport, best-effort delivery, exact response,
   and independent 60/minute bucket pass endpoint/route 7/7 plus transport 1/1.
3. **P1 read/unread completed 2026-07-12:** partner-ID mark-read and unread
   counts now use exact minimal envelopes, explicit tenant-scoped conversation
   resolution, Laravel receiver-visibility rules, no extra V2 read-receipt
   event, and independent authenticated 60/minute buckets. Route/policy
   ownership passed 1/1; focused disposable-PostgreSQL runtime passed 3/3; the
   combined direct-message regression passed 44/44.

Replace route-only and false-oracle tests for those handlers with two-user,
reload, tenant, policy, and side-effect assertions. The final deterministic
direct-message state gate passed 39/39 with zero failed or skipped, covering
migration/model contracts, edit/delete, archive/restore, concurrency, rate
limits, unread metadata, sanitizer oracles, and corrected route ownership. The broader exact regression
completed 57/58; its sole existing first-writer race subsequently passed in
isolation. A separate class aggregate completed 12/13 and was interrupted only
by disposable PostgreSQL OOM `exit 137`; the race was green in isolation.
Neither aggregate is fully green. Do not report full-suite, CI, unchanged-
frontend runtime, or backend 1000/1000 green from this checkpoint.

### 2026-07-12 ASP.NET Volunteer Hours Ledger Checkpoint (Preceding)

The current backend slice replaces the former unavailable/recorded-only
volunteer-hours paths with one canonical `VolunteerHoursService` workflow across
eight Laravel routes: member list/create/summary/pending-review/verify,
organisation pending review, administrator list, and administrator verify.
Member and administrator decisions use locked, tenant-scoped `vol_logs` rows,
strict Laravel action validation, canonical request/error envelopes, separate
rate buckets, and Laravel-aligned organisation, opportunity, reviewer, and
feature-policy authorization.

An approved whole-hour log mints the personal time-credit transaction, records
the matching volunteer-organisation payment (including a permitted negative
organisation balance), and awards the configured XP exactly once. Sub-hour
approval still awards XP but returns the canonical no-whole-hours result without
creating either credit ledger row. Existing payout and XP evidence is validated
semantically before reuse; contradictory or incomplete evidence aborts and
rolls back instead of duplicating or guessing a settlement. Caring support
relationship hour logging and decisions now converge on the same canonical
ledger, including the configured flag administrators and trusted-review policy.
Direct Caring logging accepts sub-hour values and uses the raw request hours for
the whole-hour floor and regional-points calculation before storing the rounded
two-decimal hours value. Normal non-Caring reviewed decisions run post-commit
decision bell/push side effects. Approved decisions force immediate email;
declined decisions send immediate email only when the global notification
frequency is explicitly `instant`. Tenant-default frequency fallback,
daily/monthly notification-queue delivery, and recipient locale/provider
breadth remain open. Provider failure does not roll back the canonical
decision. The post-approval badge sweep covers every badge family represented
in ASP.NET; Laravel-only badge families and realtime badge broadcast remain
open. Reviewed Caring decisions deliberately emit no decision bell, push, or
email.

The tenant-scoped `FeedActivity` entity/configuration/service now provides
Laravel's canonical idempotent feed projection. Approved-hour publication uses
`source_type=volunteer_hours`, respects `show_on_leaderboard`, and excludes the
organisation-facing free-text description. Other feed producers, admin
moderation consumers, compatibility cleanup, and historical backfill remain on
the feed backlog.

`20260711192124_VolunteerHoursLedgerParity` is migration 111. It hardens
`vol_logs` status/hours/provenance, installs
tenant-composite relationships and active natural-key uniqueness, links personal
transactions to `VolunteerLogId`, and enforces unique organisation-payment and
volunteer-hour XP evidence. Its source also defines `feed_activity` and the
user's nullable public-hours preference used by privacy-aware publication. It
never inserts legacy transaction, payment, or XP value: uniquely provable
existing evidence may be linked, evidence-free approved
whole-hour organisation rows are downgraded to `pending`, and approved Caring
sub-hour rows remain valid without fabricated evidence. At that checkpoint,
non-production certification applied all 111 migrations to a blank PostgreSQL
database and directly verified the
exact 13-column/eight-index `feed_activity` schema, nullable-boolean
`users.show_on_leaderboard` defaulting to `true`, all 11 column-specific
`ON DELETE SET NULL` relationships, and the volunteer-user `CASCADE`
relationship. A valid populated 110-to-111 upgrade preserved and linked existing
evidence without minting. A deliberately invalid fixture raised PostgreSQL
`P0001` atomically, left history at 110, and left no partial migration-111 DDL.
`has-pending-model-changes` is green; disposable Docker cleanup left zero
matching resources. No production database or container was touched.

The Debug API/test builds and required solution-wide Release build complete with
zero errors; the only warnings are the same four pre-existing `xUnit1031`
warnings in the test project. The Release build took 4m36s. One disposable Linux run
discovered 3,007 tests and passed 53/53: all 51
`VolunteerHoursParityTests` plus both `V15FeedActivityCompatibilityTests`.
Windows Smart App Control blocks the freshly rebuilt unsigned API assembly, so
the run used Linux without weakening host policy. The clean affected rerun then
discovered 3,007 tests, selected 243, and passed 243/243 with zero failed and zero
skipped in 418.639s. Do not report the full 3,007-test suite, CI, unchanged-
frontend runtime, or backend 1000/1000 as green from this checkpoint.

### 2026-07-11 ASP.NET Volunteer QR Attendance Checkpoint (Preceding)

The preceding backend slice implements Laravel's four QR-attendance routes:
personal token issue at
`GET /api/v2/volunteering/shifts/{id}/checkin`, coordinator verification at
`POST /api/v2/volunteering/checkin/verify/{token}`, coordinator checkout at
`POST /api/v2/volunteering/checkin/checkout/{token}`, and sanitized shift
history at `GET /api/v2/volunteering/shifts/{id}/checkins`.

Issuance requires the authenticated volunteer's exact approved shift
assignment and creates/reuses one globally unique 64-lowercase-hex token.
Verification/checkout/roster access requires an active tenant/platform administrator,
the volunteer-organisation owner, or an active organisation `owner`, `admin`,
`manager`, or `coordinator`. Laravel timing boundaries, late checkout for an
already checked-in volunteer, idempotent verification, sanitized history, and
canonical 404 masking for malformed/unknown/cross-tenant token lookups are
covered. An authenticated same-tenant caller without coordinator permission
receives 403 `FORBIDDEN`. Checkout intentionally uses a safer conditional
single-winner transition under concurrency.

QR attendance itself never creates volunteer logs/hours, personal or
organisation transactions, balance movement, XP, or rewards. The separate
canonical volunteer-hours workflow described above now owns logging,
verification, settlement, and XP. An outgoing `shift.completed` webhook and
child-to-parent tenant-domain inheritance remain open.

The same checkpoint repairs the V2 member/admin shift-swap lifecycle. Member
list/request/respond/cancel and administrator pending/decision routes now bind
Laravel/React snake-case fields and `{action}` payloads, return canonical
envelopes, enforce the volunteering gate and Laravel rate buckets, and derive
administrator approval from tenant configuration. Direct and admin-approved
decisions lock both shifts and exact approved applications, atomically exchange
only `VolunteerApplication.ShiftId`, and leave QR rows/tokens attached to their
original shifts as historical evidence. Stale, started, or overlapping
assignments leave the request and applications unchanged; identical concurrent
requests serialize to one pending row; only pending/admin-pending requests can
be cancelled. Notification/localization side effects and global per-user
assignment serialization across distinct concurrent swaps or other approval
writers, unchanged-frontend runtime swap smoke, and Laravel's longer-than-1,000
character text-message storage remain open; ASP.NET rejects the latter with an
explicit HTTP 400 rather than a database 500.

Evidence at the preceding 110-migration checkpoint:

- then-latest migration at that checkpoint:
  `20260711143546_VolunteerQrAttendanceParity`;
- at that checkpoint, EF discovered/applied 110 IDs and reported no model drift;
- test-project build: 0 errors and 4 pre-existing `xUnit1031` warnings;
- migration-discovery regression: green;
- QR attendance suite: 32/32;
- attendance persistence-failure 500 regression: 1/1;
- shift-swap assignment/member/admin/concurrency suite: 12/12;
- route/auth subset: 5/5;
- affected legacy-hours/caring/demo/route-alias/volunteering gate: 90/90;
- ambient-transaction regression: green;
- blank and populated databases upgraded from the preceding 109-ID state to
  110, preserving historical hours/transaction evidence and leaving historical
  tokens/coordinator IDs null;
- duplicate-attendance and cross-tenant preflight fixtures both failed
  atomically at 109 before DDL; and
- the uniquely named disposable PostgreSQL container was removed.

Do not claim CI green. Descendant CI run `29154079189` was later cancelled after
its completed Integration Tests job reported 51 failures out of 2,888 tests.
The only direct regression from the preceding `bfeafb2e`
backend slice was nested transaction handling; it is fixed and green locally.
The remaining failures still need independent triage.

### 2026-07-11 ASP.NET Financial Safety And Evidence Checkpoint (Preceding)

That preceding backend slice hardens personal, volunteer-organisation, and generic
organisation wallets; completes the group-exchange settlement state machine;
replaces V15 wallet false-success reads with persisted values; adds Caring
loyalty/estate transaction evidence; and makes unsafe incomplete financial
paths fail closed. Neither frontend nor the read-only Laravel source was
modified.

Generic organisation public/private visibility, membership authorization, and
wallet writes now use canonical owner/status/tenant rules. Verified-only
donate/transfer/admin-grant paths share lifecycle/advisory locks. Deletion takes
the same lifecycle lock and refuses any organisation whose wallet has a
balance, counters, or transaction history; a concurrency regression proves an
in-flight wallet write wins and its evidence remains. Tenant-composite keys and
role checks backstop the application policy. User search is active same-tenant,
name-only, excludes self/suspended users and email, and is limited to 30/minute.

Group exchange has server-owned draft/start/confirm/complete/cancel transitions,
positive immutable splits, distinct provider/receiver roles, all-party
confirmation, shared wallet locks, and real `group_exchange` ledger rows. V15
community-fund summary/history, pending count, and starting balance use
persisted tenant data; starting-balance configuration is admin-only. Unsafe
donation/deposit/withdraw aliases are HTTP 503 with no write.

Federation external reads now enforce owner opt-in, active state, tenant match,
visibility, and blocked-partner boundaries. Caller-supplied message/review
identity, partner webhook list/create, V2 ingest, cancellation after pristine
`Pending`, and unsupported financial settlement return stable HTTP 503 without
mutation. These are safety contracts pending real authenticated workflows.

Caring loyalty debit/refund and positive hour-estate settlement rows now carry
authoritative tenant-composite transaction IDs. Concurrent loyalty reversal has
one winner. A legacy applied redemption without a valid debit link fails manual
reconciliation rather than minting a refund; legacy null links are retained for
operator review. Repeat estate report/settle and post-settlement nomination are
rejected.

Current evidence:

- test-project build: 0 errors and 4 pre-existing `xUnit1031` warnings;
- high-risk regression: initial command 103/106; two corrected assertions and
  the isolated fixture-startup retry then passed 3/3;
- fail-closed contract suite: 119/119 with explicit unavailable/no-write/no-
  balance-mutation assertions;
- post-audit organisation/federation regressions: 24/24;
- final migration-discovery, partner-consent, cancellation, route-owner, and
  rounded-zero regressions: 30/30;
- latest migration:
  `20260711100817_LoyaltyEstateOrganisationEvidence`;
- EF model drift: none; EF discovers 109 migrations after restoring
  `AddAiMessageTenantId` metadata;
- blank disposable PostgreSQL: all 109 IDs applied from
  `20260202085043_InitialCreate` through the latest migration; history contains
  109 rows and the non-null `ai_messages.TenantId` column, tenant index, and
  foreign key were inspected directly;
- discovery repair now includes the essential designer-less
  `20260303120000_AddAiMessageTenantId`; obsolete
  `20260305120000_AddTenantUpdatedAt` remains intentionally excluded because
  `InitialCreate` already creates `tenants.UpdatedAt`;
- populated database at the preceding migration: valid upgrade green with
  legacy rows retained and known organisation-role casing normalized;
- deliberately invalid cross-tenant organisation-wallet transaction: latest
  preflight aborted and left the preceding migration history/schema intact;
- API comparator fixture green; at that checkpoint the live result was
  2,436/2,449 matched. Its exact 13 missing operations were
  `GET /api/admin/vetting/policy`,
  `PUT /api/admin/vetting/policy`, `POST /api/admin/vetting/policy/rotate`,
  `POST /api/admin/vetting/reviews/{reviewid}/resolve`,
  `POST /api/admin/vetting/user/{userid}/confirm`,
  `POST /api/admin/vetting/user/{userid}/revoke`, `GET /api/pwa/manifest`,
  `POST /api/admin/prerender/reset-all`, `POST /api/prerender/invalidate`,
  `GET /api/safeguarding/my-vetting-status`,
  `POST /api/safeguarding/confirm-policy-review`,
  `POST /api/safeguarding/vetting-review-request`, and
  `POST /api/volunteering/guardian-consents/verify/{token}`; this remains route-
  shape evidence only;
- schema comparator fixture green; the live result is 333 Laravel migration
  files, 113 ASP.NET migration source files, 368 Laravel source tables, 331
  ASP.NET tables, 137 exact matches, 231 missing, and 194 ASP.NET-only;
- all disposable databases/container were removed; no production database or
  container was touched.

The copy-ready `BEGIN TRANSACTION READ ONLY` report in
`docs/database-migrations.md` inventories ambiguous legacy self-transfers,
admin grants, starting-balance configuration/grants, loyalty, estate, Caring
hour transfer, and federated-hour-transfer candidates. It reports balance
effects but never fixes or links rows. Every candidate needs a documented manual
disposition before a reviewed forward remediation.

These focused slices were not converted into a new global score. The previous
`690/1000` implementation and `500/1000` certification estimates are historical
baselines, not current values. The backend 1000/1000 gate remains red: legacy
one-to-one exchange, sub-account pooling, community-fund writes, federation
settlement, provider/localization depth, the full 3,007-test suite, CI, and
unchanged-frontend runtime proof are not complete.

### 2026-07-10 Web UK Checkpoint (Historical)

This checkpoint supersedes the Web UK scores and test counts in the audit
baseline below. It does not change the ASP.NET workstream scores.

| Surface | Score | Meaning |
| --- | ---: | --- |
| Web UK Laravel-first implementation | 900/1000 | An independent pre-publication audit scored 896; publishing the clean, documented `web-uk/` (repo root) slice supplies the remaining repository-hygiene points, but substantive component, workflow, localization, and manual-accessibility gaps remain. |
| Web UK Laravel-first certification | 765/1000 | An independent pre-publication audit scored 760; publication improves reproducibility, while live mutation/upload/destructive evidence and manual certification remain materially incomplete. |
| Web UK ASP.NET switchability proof | 80/1000 | Unchanged and outside this Laravel-first session. |

Current evidence at commit `702ece83`:

- `45/45` Jest suites and `1,386/1,386` tests passed; lint, brand policy, CSS
  compilation, and scoped diff checks passed.
- The route matrix reports `608/608` Laravel routes matched, `0` missing, `0`
  extra parity routes, and `3` ignored infrastructure routes. This remains
  declaration evidence, not workflow certification.
- Locale structure is complete across `11` locales, `24` namespaces, and
  `7,337` keys, but every non-English catalog still has `3,903-3,951`
  English-identical values and `16` wholly English namespaces.
- The conservative source audit reports `290` templates and `0` remaining safe
  exact-value substitutions; current browser inspection still found English
  contextual copy on the Arabic dashboard.
- Chromium/axe passed `22/22`; the live Blade marker comparator passed `19/19`.
  Limited 320-pixel RTL/reflow/forced-colour inspection is recorded, but native
  keyboard traversal, screen-reader, and full manual WCAG evidence remain open.
- Deterministic serial Laravel smoke covered all `639` distinct current default
  read/auth/gate/body checks: base `93/93`, all `276` module pages, and all
  `270` body markers. Two 60-second request aborts passed isolated `11/11`
  retries. This does not prove mutation, upload, download, or destructive side
  effects.
- Component reconciliation still records `111` Partial and `19` Started rows,
  `130` open in total and `0` Complete. Some rows also mention future ASP.NET
  switching, so use their explicit Laravel gaps rather than status alone.

The Laravel-first 1000/1000 gate is therefore not met, and meaningful local
work remains. The permitted external-blocker-only stop condition is not met.

### 2026-07-10 Audit Baseline

Repository snapshot at audit time:

- ASP.NET `main`: `faad7fd7`, equal to `origin/main`, tracked worktree clean.
- Laravel `main`: `93e4266b7`, equal to `origin/main`, with a pre-existing
  modification in `react-frontend/package-lock.json` that must be preserved.

### Scores

Scores separate implementation progress from evidence-backed readiness. Static
route coverage is not a completion score.

| Surface | Score | Meaning |
| --- | ---: | --- |
| ASP.NET static API method/path inventory | 980/1000 | 2,541 of 2,592 current Laravel operations matched, with 51 route-shape gaps after the Event Ticketing family closed; this remains route-shape coverage rather than behavioral parity |
| ASP.NET implementation parity | 640/1000 | Broad implementation with material workflow, schema, integration, and localization gaps |
| ASP.NET certification confidence | 420/1000 | Current full-suite and frontend-on-ASP proof is insufficient |
| Web UK Laravel-first implementation | 910/1000 | Route conversion is advanced; several source and presentation gaps remain |
| Web UK Laravel-first certification | 755/1000 | Current Jest, accessibility, localization, and exhaustive live proof are incomplete |
| Web UK ASP.NET switchability proof | 80/1000 | Resolver/configuration exists; no route family is end-to-end certified against current ASP.NET |

### Fresh evidence

| Check | Current result or retained historical evidence |
| --- | --- |
| ASP.NET static operations | 4,461 |
| Laravel source operations | 2,592 |
| Static method/path matches | 2,541 matched, 51 missing |
| Explicit admin compatibility behavior | At least 196 of 329 `AdminExplicitParityController` route declarations reached generic fallbacks at audit time |
| Schema inventory | Live: 377 Laravel migration files, 132 ASP.NET migration source files, 455 Laravel source tables, 383 ASP.NET tables, 192 exact matches, 263 missing Laravel names, and 191 ASP.NET-only names. EF applied 130 migrations in the latest blank replay. |
| ASP.NET backend localization comparator | 7/11 locales, 49/605 namespaces, 157 comparable English keys matched, 5,018 missing |
| Web UK authoritative locale catalogs | 11/11 locales, 24 namespaces, and 7,337 string keys per locale with zero missing or extra keys relative to English |
| Web UK translation depth | Each non-English Laravel catalog still has 3,903-3,951 English-identical values (53.2%-53.9%); 16 namespaces are wholly English-identical in the read-only source |
| Web UK conservative template localization | 1,595 safe static substitutions across 257 templates; the post-write audit reports 290 templates and zero remaining conservative matches, which is not a contextual-copy completion claim |
| ASP.NET API/test builds | Debug API/test and required solution-wide Release builds passed with zero errors; the only warnings are the same four pre-existing `xUnit1031` warnings, and the latest Release build took 4m22s. |
| Transactional volunteering regression | Prior core 61/61; guardian lifecycle 7/7; recurring-pattern CRUD 13/13 plus route ownership 1/1; recurring-shift generation/scheduler 13/13; volunteer-organisation relationship/lifecycle 13/13; wallet integration 6/6; QR attendance 32/32 plus persistence-failure 1/1; shift-swap assignment/member/admin/concurrency 12/12; affected-module gate 90/90; route/auth 5/5; ambient-transaction regression green. Current focused proof is one 53/53 disposable-Linux run: all 51 `VolunteerHoursParityTests` plus both `V15FeedActivityCompatibilityTests`, with 3,007 tests discovered. The clean affected rerun selected and passed 243/243 with zero failed/skipped in 418.639s. The full 3,007-test suite remains open. |
| Migration runtime chain | EF applied all 128 migrations through `20260713004944_EventOfflineCheckinWorkflowParity` to blank disposable PostgreSQL, and `has-pending-model-changes` is green. The latest migration adds five exact offline-check-in tables, 21 workflow checks, and seven append-only/no-delete triggers; direct tampering failed with PostgreSQL `P0001 event_offline_item_immutable`. Focused signed credential, one-time device secret, manifest privacy, rotation/revocation, idempotent batch, conflict resolution, manager, version, and tenant proof passed 4/4 on isolated PostgreSQL. Prior calendar, staff, agenda, Event People, registration/waitlist, broadcast/template/lifecycle, and retained migration evidence remains green. No production resource was touched. |
| Web UK route matrix | 608/608 matched, 0 missing, 0 extra application routes, 3 infrastructure routes ignored |
| Web UK Jest | 31/31 suites and 1,021/1,021 tests passed after the localization/RTL, tenant-boundary, contextual identity/auth/accessibility, Explore, and profile-status slices |
| Web UK lint and CSS build | Passed |
| Web UK brand guard | Passed at the audit baseline; rerun with the final certification set |
| Current-source Blade marker spot-check | 19/19 passed; this is not screenshot or WCAG certification |
| Current-source browser accessibility gate | Expanded 12/12 Playwright Chromium/axe cases passed: nine representative public shared-mount pages plus three Arabic RTL pages at 320px, covering language/direction, structure, unique IDs, horizontal reflow, and serious/critical violations. Manual certification remains. |
| Current-source Laravel core smoke | 10/10 passed |
| Current-source module smoke sample | Chunk 1/8 passed 106/106; exhaustive eight-chunk recertification was not rerun during the audit |

Repository activity was substantial: 125 backend/test commits landed from July
7 through the audit, including 59 from July 9 onward. Scores must reflect both
that implementation movement and the lower amount of current green evidence.

### Key evidence anchors

- Missing Laravel route declarations:
  `C:\platforms\htdocs\staging\routes\api.php:2160`, `:2161`, and `:2885`.
- Canonical React group-exchange start call:
  `C:\platforms\htdocs\staging\react-frontend\src\pages\group-exchanges\GroupExchangeDetailPage.tsx:231`.
- ASP.NET generic admin fallbacks and recorded-only write path:
  `src\Nexus.Api\Controllers\AdminExplicitParityController.cs:246`, `:487`,
  `:529`, `:671`, `:1257`, and `:5536`.
- Scheduled-job false-success path:
  `src\Nexus.Api\Controllers\AdminCompatibilityController.cs:3955`.
- Current Web UK reserved-path parity assertion:
  `apps\web-uk\tests\tenant-routing-source.test.js:25`.
- Web UK tenant routing list:
  `apps\web-uk\src\middleware\tenant-routing.js:25`; Laravel source list:
  `C:\platforms\htdocs\staging\app\Core\TenantContext.php:516`.
- Completed tenant-URL source boundary: all 54 audited root-relative controls
  across 17 volunteering templates now use `urlFor()`, their three generated
  cursor links use the same helper, and an app-wide Nunjucks regression permits
  only the intentional root public asset paths.
- ASP.NET switching remains intentionally labelled future/not-certified in
  `apps\web-uk\src\lib\backend-contract.js:9`.
- Transactional volunteering anchors are
  `src\Nexus.Api\Services\VolunteerService.cs`,
  `src\Nexus.Api\Services\AdminVolunteerApprovalService.cs`,
  `src\Nexus.Api\Services\ShiftManagementService.cs`, and
  `src\Nexus.Api\Controllers\VolunteeringParityController.cs`. Guardian
  lifecycle anchors are `src\Nexus.Api\Services\VolunteerGuardianConsentService.cs`,
  `src\Nexus.Api\Controllers\VolunteerAdminController.cs`,
  `src\Nexus.Api\Services\Scheduled\VolunteerGuardianConsentExpiryJob.cs`,
  `src\Nexus.Api\Migrations\20260710192521_GuardianConsentLifecycle.cs`,
  `tests\Nexus.Api.Tests\GuardianConsentLifecycleTests.cs`, and
  `tests\Nexus.Api.Tests\GuardianConsentRouteOwnershipTests.cs`. Recurring
  generation anchors are `src\Nexus.Api\Services\ShiftManagementService.cs`,
  `src\Nexus.Api\Services\Scheduled\VolunteerRecurringShiftGenerationJob.cs`,
  `src\Nexus.Api\Migrations\20260710211122_RecurringShiftGenerationParity.cs`,
  and `tests\Nexus.Api.Tests\RecurringShiftGenerationTests.cs`. Recurring CRUD
  anchors are `src\Nexus.Api\Controllers\ShiftManagementController.cs`,
  `src\Nexus.Api\Migrations\20260710221715_RecurringShiftPatternCrudParity.cs`,
  `tests\Nexus.Api.Tests\RecurringShiftCrudTests.cs`, and
  `tests\Nexus.Api.Tests\RecurringShiftRouteOwnershipTests.cs`.
  Volunteer-organisation anchors are
  `src\Nexus.Api\Entities\VolunteerOrganisation.cs`,
  `src\Nexus.Api\Services\VolunteerOrganisationService.cs`,
  `src\Nexus.Api\Migrations\20260711010201_VolunteerOrganisationRelationshipsParity.cs`,
  and `tests\Nexus.Api.Tests\VolunteerOrganisationRelationshipTests.cs`.
  Wallet anchors are
  `src\Nexus.Api\Services\VolunteerOrganisationWalletService.cs`,
  `src\Nexus.Api\Controllers\VolunteerOrganisationWalletController.cs`,
  `src\Nexus.Api\Controllers\AdminVolunteerOrganisationWalletController.cs`,
  `src\Nexus.Api\Migrations\20260711083852_WalletLedgerFederationPartnerParity.cs`,
  and `tests\Nexus.Api.Tests\VolunteerOrganisationWalletTests.cs`.
  Preceding generic-organisation/group/financial-evidence anchors are
  `src\Nexus.Api\Services\OrganisationLifecycleLock.cs`,
  `src\Nexus.Api\Services\OrgWalletService.cs`,
  `src\Nexus.Api\Services\GroupExchangeService.cs`,
  `src\Nexus.Api\Services\CaringLoyaltyService.cs`,
  `src\Nexus.Api\Services\CaringHourEstateService.cs`,
  `src\Nexus.Api\Migrations\20260711100817_LoyaltyEstateOrganisationEvidence.cs`,
  `tests\Nexus.Api.Tests\GenericOrganisationSecurityTests.cs`,
  `tests\Nexus.Api.Tests\GroupExchangeControllerTests.cs`, and
  `tests\Nexus.Api.Tests\CaringLoyaltyLedgerConcurrencyTests.cs`.
  Current QR-attendance anchors are
  `src\Nexus.Api\Services\VolunteerAttendanceService.cs`,
  `src\Nexus.Api\Controllers\VolunteeringParityController.cs`,
  `src\Nexus.Api\Migrations\20260711143546_VolunteerQrAttendanceParity.cs`, and
  `tests\Nexus.Api.Tests\VolunteerAttendanceParityTests.cs`.
  Current volunteer-hours anchors are
  `src\Nexus.Api\Services\VolunteerHoursService.cs`,
  `src\Nexus.Api\Controllers\VolunteerHoursController.cs`,
  `src\Nexus.Api\Migrations\20260711192124_VolunteerHoursLedgerParity.cs`, and
  `tests\Nexus.Api.Tests\VolunteerHoursParityTests.cs`.
  Current safeguarding/messaging anchors are
  `src\Nexus.Api\Controllers\AdminSafeguardingVettingController.cs`,
  `src\Nexus.Api\Controllers\SafeguardingVettingMemberController.cs`,
  `src\Nexus.Api\Controllers\OnboardingSafeguardingController.cs`,
  `src\Nexus.Api\Services\SafeguardingInteractionPolicy.cs`,
  `src\Nexus.Api\Migrations\20260712020049_SafeguardingVettingAttestationParity.cs`,
  `src\Nexus.Api\Migrations\20260712022243_MessagingDisabledRestrictionParity.cs`,
  `src\Nexus.Api\Migrations\20260712023810_SafeguardingPreferenceDependencyParity.cs`,
  `src\Nexus.Api\Migrations\20260712060051_DirectMessageStateParity.cs`,
  `tests\Nexus.Api.Tests\SafeguardingVettingControllerTests.cs`,
  `tests\Nexus.Api.Tests\DirectMessageParityCorrectionsTests.cs`, and
  `tests\Nexus.Api.Tests\VoiceMessageParityRegressionTests.cs`, plus the direct-
  message state schema/migration/edit-delete/archive-restore tests.
  Historical focused proof is the prior 61/61 core, clean 7/7 guardian lifecycle, clean
  13/13 recurring CRUD plus 1/1 route ownership, clean 13/13 recurring
  generation/scheduler, clean 13/13 organisation relationships/lifecycle, and
  clean 6/6 transactional wallets. The preceding financial proof is the initial
  103/106 high-risk run plus corrected/retried 3/3 and the 119/119 fail-closed
  suite. Current proof is the 32/32 attendance suite, 5/5 route/auth subset,
  green ambient-transaction regression, and the retained green 111-migration
  hours replay. Migration 114's invalid atomic-abort/catalog proof remains
  retained; blank 115, populated 114-to-115, and model drift are green. The final
  deterministic direct-message state gate passed 39/39. The broader exact
  regression completed 57/58 with the existing race green in isolation; the
  class aggregate completed 12/13 before PostgreSQL OOM `exit 137`, again with
  the race green isolated. Neither aggregate is fully green. The preceding hours/feed
  proof adds zero-error Debug and solution-wide Release builds with only four
  pre-existing `xUnit1031` warnings (Release took 4m36s) and one 53/53
  disposable-Linux run: all 51
  `VolunteerHoursParityTests` plus both `V15FeedActivityCompatibilityTests`, with
  3,007 tests discovered. The clean affected rerun selected and passed 243/243
  with zero failed/skipped in 418.639s. The full 3,007-test suite, CI, and
  unchanged-frontend runtime proof remain open.

### Web UK localization/RTL progress after the audit baseline

The current slice adds a real request-scoped localization foundation rather
than treating the language selector as completion. Locale resolution follows a
valid query locale, session, an available request user/profile, a signed-token
profile preference, weighted `Accept-Language`, then English. Valid query and
profile choices seed the session; responses declare `Content-Language`;
request-scoped `AsyncLocalStorage` carries the locale into API/download
requests; signed profile reads are memoized per request; and display formatting,
document `lang`, and document direction use the resolved locale.

The deterministic catalog sync and audits prove structural parity with the
read-only Laravel source, while the conservative template pass wires only
semantically safe exact matches. They do not solve untranslated upstream data
or contextual route/template copy. In particular, `activity`, `blogreviews`,
`connections`, `events`, `federation`, `feed`, `gamification`, `ideation`,
`listings`, `members`, `organisations`, `saved`, `search`, `settings`,
`volunteering`, and `wallet` are wholly English-identical across every
non-English Laravel catalog. No score was recalculated from this slice alone,
and the Laravel-first completion gate remains open.

A follow-up now gives all nine representative public browser-gate pages
localized document titles and primary headings, translates exact auth
validation/status/API-code states at render time, and localizes scoped dynamic
ARIA/visually-hidden labels in advanced search, saved collections, connection
network, and course learning. The full Jest and 12-case browser gates remain
green. This narrows the contextual backlog; it does not remove the hundreds of
remaining family-specific strings or the authoritative untranslated namespaces.

Explore now delegates its page and 19 feature-gated cards to explicit Laravel
keys, and profile/settings translates 45 exact status/error keys at render time.
The immutable `92357a95` residual audit still measured 381 effective hard-coded
title sites, 153 static H1s, 3,178 pure static nodes, 53 dynamic accessible-label
occurrences, and about 715 raw route-message candidates before those two slices.
Jobs now delegates 16 fixed document titles, its exact status/error families,
and selected high-impact detail/history/talent/bias/qualification copy to
authoritative keys while preserving user-authored dynamic content. Fresh
ephemeral Laravel proof passed 41/41 signed/gated/redirect/body checks plus a
13/13 Irish/Arabic rendered-output run. Marketplace now delegates 20 fixed
document titles, 56 exact status/error tokens, its shared navigation, and its
high-impact browse chrome to Laravel keys. A fresh current-source Laravel run
passed 33/33 base, signed-page, feature-gate, and Irish/Arabic output checks.
The remaining family-specific hard-coded copy and mutation/upload/destructive
proof keep Marketplace open. Laravel's non-English
`premium.*` Explore copy is also stale relative to current English donation
semantics and requires an upstream catalog fix.

The profile two-factor enrolment contract now follows Laravel's status-then-
setup sequence, accepts `qr_code_url`, renders one-time backup codes on the
verification POST, preserves rate/service failures, and localizes its remaining
high-impact setup chrome. Focused tests passed 31 selected assertions. Live
successful enrolment remains blocked on a disposable security-test fixture;
the complete current Web UK gate passed 38/38 suites and 1,177/1,177 tests. Do
not mutate a persistent member merely to create proof.

The profile deletion form now uses Laravel's pending-erasure contract instead
of the immediate `/api/v2/users/me` purge. It submits to
`POST /api/gdpr/delete-account`, maps password/auth/service failures, and clears
the Web UK cache, server session, and all auth cookies only after success.
Focused proof passed 11 assertions and safe current-source Laravel GET plus
Irish/Arabic rendering passed 13/13 checks; the complete current Web UK gate
passed 39/39 suites and 1,187/1,187 tests. A successful live POST is blocked
on a disposable isolated GDPR fixture; it must not be run against the shared
smoke member.

### Historical Workstream A: Accessible Frontend To Laravel Completion

This workstream ends at complete, evidence-backed Laravel-first certification.
It must not wait for ASP.NET parity, and it must not implement ASP.NET-specific
page branches. Preserve backend-neutral contracts so the same frontend can be
smoked against ASP.NET later.

### Immediate blockers

1. **Completed 2026-07-10:** synchronized the 21 parent-domain reserved route
   segments added to Laravel `TenantContext`, restored full Jest to green, and
   added behavior coverage for every new segment plus the existing automatic
   source-drift comparison.
2. **Completed 2026-07-10:** replaced all 54 direct root-relative internal
   `href` and `action` attributes across 17 volunteering templates with the
   tenant-aware URL helper, wrapped the three generated cursor consumers, and
   added app-wide source plus mounted query/fragment render regression
   coverage. The same slice made `urlFor()` idempotent, tenant-scoped cookie
   return redirects, the legal-hub document links, and the session-timeout
   login/logout flow; timeout sign-out is now a CSRF-protected POST rather than
   an unsupported GET.
3. **Completed 2026-07-10:** ported the current Laravel accessible changes:
   - donation display resolves the uppercase tenant currency and donation POST
     no longer sends hard-coded EUR; amounts above 1,000,000 are rejected;
   - the two advisory screen-reader prefixes say `Warning` while genuine error
     summaries retain `There is a problem`;
   - safeguarding field failures link to all five affected controls while the
     two generic failures remain plain text;
   - **Completed 2026-07-10:** the federation hub CTA now enters onboarding,
     and the tenant-scoped session-backed privacy/communication/confirm flow
     retains choices, finalizes from a confirm-only request, preserves state on
     failure, clears it only on success, and has Laravel API read-back proof.
4. Reconcile every `Partial` and `Started` row in
   `apps/web-uk/docs/BLADE_COMPONENT_PORT_AUDIT.md` against current Laravel
   Blade, controllers, API calls, validation, gates, banners, empty states,
   error states, and POST/upload/delete contracts. Use mocked HTTP contract
   tests against the ordinary checkout; live side-effect proof belongs only in
   a separately provisioned disposable Laravel environment.
5. **Localization/RTL foundation substantially advanced 2026-07-10, but still
   open:** Web UK imports all 11 offered Laravel locales across 24 namespaces
   and 7,337 keys with zero structural drift; resolves locale per request;
   propagates it to API calls and formatters; emits correct `lang`/`dir`; and
   completed 1,595 conservative substitutions across 257 templates. Finish the
   contextual route titles, headings, validation/status copy, ARIA labels, and
   residual unsafe-to-infer strings. The authoritative read-only Laravel
   catalogs also leave 16 namespaces and 53.2%-53.9% of each non-English locale
   English-identical, so those source translations need an external owner
   before every offered locale can be certified. A language selector,
   structurally complete catalogs, or a zero-safe-match audit is not translated
   output completion.
6. **Expanded automated foundation completed 2026-07-10:** Playwright Chromium
   plus `@axe-core/playwright` now starts a fresh current-checkout Web UK
   listener and gates 12 cases: nine representative public pages plus three
   Arabic RTL pages at 320px, covering document direction, structure, unique
   IDs, horizontal reflow, and serious/critical axe violations. Continue
   expanding authenticated and error states. Exercise live upload/destructive
   states only in a separately provisioned disposable Laravel environment, and
   perform a recorded manual pass for keyboard use, focus order and
   visibility, screen-reader announcements, zoom/reflow, contrast, error
   summaries, and RTL behavior.
   The source-level error-summary focus audit is complete for current Nunjucks
   source: all 135 summaries carry `tabindex="-1"`, down from six omissions at
   the 2026-07-10 audit.
7. Rebuild/restart a current-source Web UK process. Do not use a stale port 5180
   process as certification evidence.
8. Rerun the complete Laravel smoke scope, chunked if necessary, including
   signed/unsigned, unauthorized, not-found, feature-disabled, tenant-domain,
   custom-domain, forms, redirects, and body-copy checks. Against the ordinary
   production-derived local Laravel database this scope must be strictly
   read-only. Run upload/mutation/destructive chunks only against a separately
   provisioned disposable Laravel environment.
9. Refresh the route matrix, component audit, switching contract, and Web UK
   handoff with exact command output. Remove superseded scores and false
   completion claims.

### Laravel-first 1000/1000 gate

Do not claim this workstream complete until all of the following are true:

- every current Laravel accessible method/path is represented by a real Web UK
  route and page rather than a preparation handler;
- layouts, content hierarchy, navigation, forms, validation, status banners,
  empty/error states, gates, redirects, uploads, and side effects match Laravel;
- tenant mounts, parent/custom domains, and tenant-aware URLs work without
  response-rewrite dependence hiding source errors;
- authentication and authorization work against Laravel for all relevant roles;
- all offered locales render translated, correctly formatted output and RTL is
  proven where applicable;
- Jest, lint, brand guard, route matrix, accessibility automation, visual
  review, manual WCAG review, and the full Laravel runtime smoke scope pass;
- no known Laravel Blade/controller/route drift remains;
- docs contain reproducible evidence and no unsupported 1000/1000 claim;
- the worktree contains no unrelated staged changes.

ASP.NET smoke is a separate shared-switchability gate. Record it honestly as
pending rather than blocking Laravel-first completion.

### Historical Workstream B: ASP.NET As A Laravel-Compatible Twin

This workstream is contract and workflow parity, not route transcription. Drive
each slice from Laravel routes/controllers plus actual canonical React call
sites. Web UK is an additional consumer once Laravel-first conversion is green.

### Current contract and safety regressions

1. **P0 completed 2026-07-12:** sender-only 24-hour edit, scoped participant
   delete, and partner-ID per-user archive/restore now persist durable state.
   Restricted-only coordinator help, durable policy-aware reactions/batch,
   full-preflight signed-Pusher typing, and tenant-scoped read/unread behavior
   with exact envelopes and independent 60/minute buckets are also complete.
   Continue the next canonical-frontend-used fallback inventory; use two-user
   reload, tenant, policy, cleanup, and side-effect tests and remove false
   oracles.
2. Run the full ASP.NET suite and CI, then complete unchanged-frontend
   member, organisation, administrator, and Caring runtime smoke. The focused
   53/53 and affected 243/243 gates are green, but the discovery count is not a
   full-suite pass.
3. Finish the residual group-exchange contract around notification fidelity,
   list/detail pagination/shape audit, and unchanged-frontend runtime smoke. The
   start/confirm/complete ledger workflow itself is now real and must not be
   conflated with the separate legacy one-to-one `Exchange` service.
4. Implement each financial workflow that still fails closed: two-party legacy
   exchange confirmation, managed-user sub-account approval, canonical
   community-fund donation/deposit/withdrawal, and durable authenticated
   federation settlement.
5. Run the read-only legacy financial candidate report, document manual
   disposition and current/proposed balance impact, and implement only reviewed
   forward remediations. Never infer evidence by amount or timestamp proximity.
6. Inventory every canonical React-used route that reaches a generic catch-all,
   recorded-only write, unconditional empty response, mock secret, or fabricated
   success. Replace each with a real workflow or an explicit honest unsupported
   result while implementing the remaining workflow. Never return a success
   envelope for an operation that did not happen.
7. Correct scheduled-job `run now`: execute the compatible operation and record
   its real outcome, or fail explicitly. Do not record success without running
   the job.
8. Match current role semantics: supported roles, tenant-super-admin flag,
   authorization policies, validation, response values, and migrations.
9. Match Laravel's AI-provider test authorization and throttling.
10. Add the `features.explore` bootstrap contract.
11. Port regression tests for Laravel's recent cross-tenant read and route-auth
   fixes. Prove tenant isolation with negative tests, not only happy paths.

> **2026-07-10 backend progress, extended 2026-07-11:** The previously missing
> wellbeing and group-exchange routes now have real workflows with focused
> tests. Scheduled `run now` also fails closed: the
> manual-run endpoint executes real `ListingExpiry` and `JobVacancyExpiry`
> jobs, persists their outcomes, prevents overlapping scheduled/manual
> execution, excludes inactive tenants, and returns explicit unsupported,
> busy, disabled, and failure responses. `volunteer-expire-consents` maps to
> the real global guardian-consent expiry job, while `recurring-shifts` now
> maps to a 06:00 UTC all-active-tenant 14-day sweep. Four of the 42 Laravel
> cron definitions are executable and the other 38 are reported disabled/
> unsupported. Role semantics now have explicit user privilege columns,
> DB-backed policies,
> stale-token rejection, canonical v2 auth errors, protected explicit-God
> targets, and focused role regression coverage. The recorded chain inventory is
> 115 migrations through `DirectMessageStateParity`; blank 115, populated
> 114-to-115, and model-drift gates are green. Migration 114's invalid atomic-
> abort/catalog proof and migration 111's no-mint proof remain retained. Full
> application runtime remains open. Canonical federation partnership list/approve/reject now has
> real receiver-only pending transitions,
> atomic audit, post-commit in-app notifications, Laravel error envelopes, and
> one-winner concurrency tests. It does not yet include Laravel federation-level
> permission fields, durable rejection metadata, localized push, initial-sync
> scheduling, or canonical audit-read visibility. Core volunteering now has real
> transactional behavior: selected-shift apply, admin/organizer decisions,
> direct signup/cancellation, group reservations and roster changes, waitlist
> join/leave/claim, displaced-shift re-offers, and stale-offer expiry use
> tenant-scoped persistence, conditional transitions, shared capacity locks,
> and surface-specific post-commit notification delivery. The shared guardian
> gate covers apply, signup, waitlist, and group-add entry paths. Its full
> lifecycle now provides safe member requests/reads, hashed single-use email
> credentials, tenant-scoped anonymous activation, authorized withdrawal,
> cursor-paginated admin reads, canonical throttling, admin-config convergence,
> audited email attempts, post-commit bells, global expiry, and explicit 410s
> for legacy mutation bypasses. The prior core is 61/61, the guardian lifecycle
> is clean at 7/7, and the combined workflow/guardian/ownership run was 67/68;
> its sole PostgreSQL fixture-clear timeout occurred before the test body and
> that exact case then passed 1/1 in isolation. The guardian ownership/migration
> focus is 97/97. The API and test-project Release builds are
> green. Recurring generation now preserves Laravel's original recurrence
> anchor, strict ISO weekdays and true-empty day behavior, biweekly parity,
> month-end clamping, end/max bounds, and counter accuracy. Pattern-row locks,
> a filtered unique occurrence key, and targeted conflict handling make
> scheduled/manual retries race-safe; per-pattern errors fail the persisted job
> after the remaining tenants continue. The focused set is 13/13. Recurring
> CRUD now matches Laravel's array payloads and `{data,meta}` envelopes,
> active-plus-inactive newest-first reads, create defaults, presence-aware PUT,
> organizer/current-admin authorization, direct-key/blob feature convergence,
> independent 60/10-per-minute buckets, and two-stage deactivation/future-shift
> cleanup. Cleanup preserves historical shifts, expenses, and wellbeing rows,
> deactivates matching alerts, and clears blocking swap destinations. The
> focused CRUD set is 13/13 and route ownership is 1/1. It also proves exact
> site-role authorization, allowed-field timestamp semantics, lossless decoded
> day arrays, and authorization/feature gates before action throttles. The
> creator shadow FK is replaced by tenant-preflighted `CreatedBy`; capacity,
> spots, occurrence maximums, and generated counts enforce Laravel's unsigned
> semantics while explicit zero remains valid. Dedicated canonical
> volunteer-organisation storage now backs member/admin/public lifecycle,
> opportunity creation, dashboard projections, transaction aggregates, and
> exact manager authorization without reusing the generic organisation domain.
> Member wallet summary/history/deposit and admin history/adjustment now have
> singular focused owners and real atomic storage. Advisory locks, tenant
> predicates, signed-balance validation, and a nullable-leg personal-ledger
> adapter make deposits/adjustments race-safe without fabricating counterpart
> users. The earlier focused wallet set was 6/6 and its disjoint affected groups
> were 213/213. The 2026-07-11 extension adds locked generic-organisation
> lifecycle/wallet rules, wallet-evidence-preserving delete refusal, the full
> group-exchange state machine, persisted V15 community-fund/starting-balance
> reads, privacy-safe wallet search, and linked loyalty/estate evidence. The
> latest migration is `20260712104503_DurableMessageReactions`; the recorded
> EF inventory is 116 migrations. Blank 116 and model-drift gates are green
> with exact reaction schema; blank 115 and populated 114-to-115 remain green
> with content/read timestamps preserved, false/null defaults, and audit FK
> `SET NULL`; migration 115 is forward-only. Migration
> 114's invalid duplicate `P0001` atomic-abort/no-partial-schema and catalog-
> containment proof remains retained. Migration 111's
> feed/privacy/FK replay remains retained evidence. The
> preceding financial migration's valid populated upgrade
> preserves legacy rows and normalizes known role casing; its invalid
> cross-tenant wallet-transaction upgrade aborts before changing history or
> schema. The initial high-risk run was 103/106, the corrected/retried cases
> passed 3/3, and the fail-closed contract suite passes 119/119. The current QR
> attendance workflow covers all four Laravel routes with exact-assignment token
> issue, coordinator verification/late checkout, sanitized history, and no
> financial/reward side effects. Its focused suite passes 32/32, the injected
> persistence-failure contract passes 1/1, route/auth is 5/5, and the
> ambient-transaction regression is green. Member/admin V2 shift
> swaps now use canonical payloads/envelopes and atomically exchange approved
> application assignments without moving QR evidence; setting-driven admin
> approval, pending-only cancellation, and duplicate-request serialization are
> covered by a 12/12 focused suite. Swap notifications/localization, global
> per-user assignment serialization across distinct concurrent writers, and
> unchanged-frontend smoke remain
> open. The affected legacy-hours/caring/demo/route-alias/volunteering gate is
> 90/90. The subsequent volunteer-hours slice now gives the eight Laravel
> member/organisation/admin routes one locked `vol_logs` workflow, exact-once
> personal and organisation settlement, XP evidence, and Caring convergence.
> Debug API/test and solution-wide Release builds have zero errors and only the
> same four pre-existing `xUnit1031` warnings; Release took 4m36s. One disposable-
> Linux run discovered 3,007 tests and passed
> 53/53: all 51 `VolunteerHoursParityTests` plus both
> `V15FeedActivityCompatibilityTests`. The clean affected rerun selected and
> passed 243/243 with zero failed/skipped in 418.639s. The full 3,007-test suite,
> CI, and unchanged-frontend smoke remain open.
> The volunteering migrations
> handle unsafe histories explicitly: the former unique application index
> cannot be restored after legitimate reapplication history, and hashed
> guardian credentials/status semantics cannot be safely discarded. The QR
> attendance migration is also forward-only because downgrade would discard
> token, lifecycle-status, and coordinator evidence and make pending attendance
> timestamps non-nullable. Restore a tested pre-migration backup or use a
> reviewed forward remediation; do not force its `Down()` path.
> The recurrence index migration is reversible but fails closed when duplicate
> historical occurrences require manual linked-history reconciliation.
> The recurring CRUD migration fails closed on divergent, missing, or
> cross-tenant creator ownership and restores the shadow FK deterministically
> on downgrade. `CreatedBy` deliberately uses non-destructive `RESTRICT`
> instead of Laravel's user-delete cascade until ownership deletion effects are
> explicitly proven. Volunteer-hour reads/approval mutations and the admin
> timebank organisation-wallet overview remain; localized built-in guardian
> delivery copy and the full tenant-link fallback
> chain, live provider proof, and unrelated long-tail volunteering scaffolds
> remain. This
> progress does not close the catch-all
> inventory, wider scheduled/provider backlog, or the backend 1000/1000 gate.

### P1: replace compatibility scaffolding with domain behavior

1. Prioritize React-used/admin-used fallbacks in
   `AdminExplicitParityController`, `AdminParityController`, volunteering,
   identity, moderation, safeguarding, groups, jobs, courses, podcasts, billing,
   marketplace, federation, Verein/Clubs, partner APIs, and regional analytics.
2. For each route family, match request/query/multipart shapes, response
   envelopes, pagination, validation, status codes, auth/tenant errors,
   not-found behavior, feature gates, persistence, events, notifications,
   uploads, downloads, and provider side effects.
3. Close or explicitly map schema gaps. A renamed/table-alias entry requires
   evidence for columns, types, keys, constraints, tenancy, soft deletion,
   relationships, indexes, migration state, and workflow use.
4. Finish real Stripe/payment/portal/webhook behavior, SSO redirect/callback,
   PKCE and token validation, provider webhooks, media processing, scheduled
   jobs, Mailchimp-equivalent behavior, realtime, and other documented provider
   gaps. Where credentials are unavailable, complete deterministic adapters and
   tests, then record the external live-verification blocker precisely.
5. Close backend/admin/email/API/accessibility localization gaps for all Laravel
   locales and relevant keys.
6. Split oversized compatibility controllers when doing so reduces collisions
   and allows focused ownership/tests; preserve public contracts throughout.

Admin and WebAuthn route-owner collisions found in the 2026-07-10 slice were
removed and are now guarded by live endpoint-table ownership tests. Ownership
is not evidence that every remaining handler has workflow parity.

The 2026-07-12 security-confirmation slice adds the canonical React-used
`POST /api/webauthn/security-confirm` workflow and closes one expanded route
gap. Password, TOTP, backup-code, and recent UV-passkey proof issue a signed
five-minute token bound to user, tenant, method, type, and unique id; enrollment
challenge/verification plus remove/rename/remove-all require that proof. The
dedicated authenticated bucket is 10 attempts per 600 seconds. Focused
disposable-PostgreSQL workflows passed 2/2, signed-token binding/claim tests
passed 2/2, route/policy ownership passed 1/1, and the Release solution build
completed with zero errors and the same four pre-existing warnings.

The subsequent PWA-manifest slice closes the canonical React/browser
`GET /api/v2/pwa/manifest` workflow plus its legacy alias. It returns raw
`application/manifest+json`, exact cache/Vary headers, tenant name/id/start/scope
overlays, path-prefixed shortcuts, shared-host slug resolution, and dedicated-
domain switching restricted to active direct children through
`tenant_hierarchies`. Focused disposable-PostgreSQL runtime passed 2/2,
route/policy ownership passed 1/1, and the Release solution build and API
comparator fixtures are green.

### Backend 1000/1000 gate

Do not claim completion until all of the following are true:

- a current Laravel route/OpenAPI/call-site inventory has zero unexplained
  method/path gaps;
- no canonical frontend-used operation depends on generic, empty,
  recorded-only, mocked, or fabricated-success behavior;
- request, response, validation, error, auth, tenant, feature, upload,
  pagination, status, persistence, event, notification, and provider contracts
  match Laravel for every in-scope workflow;
- schema and localization maps have no unexplained gaps;
- recent Laravel tenant/security regression cases pass against ASP.NET;
- the full ASP.NET build and test suites pass from a clean checkout;
- a fresh current-source image/runtime has the complete migration history and
  no missing-table errors;
- supported populated histories upgrade without row loss, while deliberately
  invalid tenant/financial histories fail preflight without partial schema or
  migration-history changes;
- the unchanged canonical Laravel React frontend passes representative and then
  exhaustive workflow smoke against ASP.NET;
- the unchanged Web UK frontend, after its Laravel-first certification, passes
  the same smoke buckets against
  ASP.NET;
- parity docs are refreshed from live evidence and no stale score is presented
  as current truth;
- the worktree contains no unrelated staged changes.

## Current Remediation Queue

Do not duplicate either live queue in this runbook:

- Web UK Laravel-first blockers, ownership, and its finite ordered packages live
  in `../../web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`.
- ASP.NET banked deductions, published-versus-dirty boundary, and backend
  certification gates live in `CURRENT_ASPNET_CONTRACT_STATUS.md`.

Read both at the start of a status report or implementation session. Select work
from the appropriate canonical queue, then apply the shared loop and evidence
rules below. The older Workstream A/B material above remains historical planning
context only.

## Resume-Only Autonomous Execution Loop

After explicit user authorization resumes a named workstream, its session must
use this loop until that workstream's completion gate is met or only genuine
external blockers remain:

1. **Refresh:** read instructions and handoffs; inspect both repos' heads,
   status, recent commits, generated matrices, failing tests, and active local
   runtime versions. Never overwrite another agent's work.
2. **Choose:** select the highest-impact unblocked workflow-sized gap. Prefer
   end-to-end behavior over raw endpoint/page counts.
3. **Trace:** follow the Laravel route, controller/service/model/view and the
   consuming React or accessible call site. Write the exact contract and
   acceptance cases before implementation.
4. **Implement:** make the smallest coherent production-quality slice, including
   migrations/configuration and focused tests where required.
5. **Verify:** run focused tests first, then relevant broader suites, comparators,
   and runtime smoke. A static match, marker check, skipped test, stale process,
   or unrun suite is not passing evidence.
6. **Document:** update the maintained map/handoff with exact commands, outcomes,
   remaining gaps, and any environmental caveat.
7. **Publish:** inspect the diff and worktree, commit only the coherent in-scope
   slice, and push it. Never force-push. If publishing fails, record the exact
   reason and continue safe local work where possible.
8. **Repeat:** immediately choose the next highest-impact gap. Do not stop after
   planning, documentation, one passing slice, or an improved score.

Only a new explicit user instruction can authorize implementation, testing,
documentation changes, commits, or pushes in a resumed phase. This runbook
defines how to execute that authorized scope; it never authorizes production
deployment, production-container changes, destructive external actions, or
modification of the Laravel reference repo.

## Refresh And Verification Commands

Start at the repository root:

```powershell
cd C:\platforms\htdocs\asp.net-backend
git status --short --branch
git log --oneline --decorate -n 30
git diff --stat
git -C C:\platforms\htdocs\staging status --short --branch
git -C C:\platforms\htdocs\staging log --oneline --decorate -n 30
```

Backend baseline:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-compare-laravel-api-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-compare-laravel-schema-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-compare-laravel-localization-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-export-laravel-parity-backlog.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\compare-laravel-api-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\compare-laravel-schema-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\compare-laravel-localization-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\compare-laravel-frontend-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\export-laravel-parity-backlog.ps1
dotnet build Nexus.sln --configuration Release --no-restore
dotnet test Nexus.sln --configuration Release --no-restore
```

The test scripts validate comparator behavior. The non-`test-` commands refresh
the live artifacts used for current counts. Interpret the generic frontend
comparator cautiously and use Web UK's dedicated route matrix for its current
accessible route coverage.

Accessible baseline:

```powershell
cd C:\platforms\htdocs\asp.net-backend\apps\web-uk
npm run brand:check
npm run lint
npm run build:css
npm test -- --runInBand
npm run locales:audit
npm run locales:audit-templates -- --summary
npm run route:matrix
npm run visual:blade
```

This is the ordinary non-mutating accessible baseline. Do not run
`smoke:laravel:local`, `smoke:federation:local`, any `*:mutation:*` command,
authenticated settings journey, or upload/download check against the ordinary
Laravel environment. Those gates may run only with `LARAVEL_BASE_URL` bound to
a separately provisioned, verified disposable Laravel database/environment.
The production-derived ordinary local database is read-only and is not a
fixture, even when a script creates unique rows or attempts cleanup.

Use the certification commands and ownership boundaries documented in
`web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`; consult
`web-uk/docs/CURRENT_WEB_UK_HANDOFF.md` only as historical detail. Record
every exhaustive module/body-text chunk and do not extrapolate from one chunk.

## Evidence And Blocker Rules

- Never claim a suite passed if it was not run, timed out, was filtered, used a
  stale process/image, or skipped relevant cases.
- Never convert route counts, table-name counts, commits, or marker checks into
  behavioral parity claims.
- Keep one fixed-rubric banked overall score per workstream. Report
  implementation evidence and certification confidence separately as named,
  unscored dimensions; do not invent competing overall percentages.
- A missing credential, unavailable provider, production secret, account
  permission, or external service can be an external blocker. Record the exact
  command, error, affected acceptance criterion, safe local proof completed, and
  what a human must supply.
- A failing test, difficult implementation, stale local process, missing local
  migration, or large backlog is not automatically an external blocker. Fix it
  or move to another unblocked in-scope slice while continuing the loop.
- Do not stop while meaningful unblocked work remains.

## Required Final Handoff

At the end of either session, report and record:

- branch, head, upstream state, and commits pushed;
- dirty files, separated into session-owned and pre-existing changes;
- exact before/after comparator and route-matrix counts;
- exact build, test, accessibility, and runtime-smoke commands and results;
- completed workflow families and remaining gaps;
- the canonical fixed-rubric banked score, plus separately named implementation
  and certification evidence without additional overall percentages;
- external blockers with evidence and owner/action needed;
- the next five concrete tasks if any work remains.
