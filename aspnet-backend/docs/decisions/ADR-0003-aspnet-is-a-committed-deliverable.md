# ADR-0003: ASP.NET Is A Committed Deliverable With A Commercial Driver

Date accepted: 2026-08-21

Status: **Maintained reference - accepted; supersedes ADR-0002 in part**

Supersedes: the *optionality* framing of
[ADR-0002](ADR-0002-laravel-production-authority-and-aspnet-optionality.md).
ADR-0002's technical reasoning about scaling triggers is retained and remains
correct; its characterisation of the ASP.NET backend as strategically optional
is superseded by this record.

## Context

ADR-0002 was written on 2026-08-15 to stop a specific bad assumption: that user
growth should automatically trigger a framework rewrite. That reasoning was
sound and remains so. But in closing off the wrong reason to build ASP.NET, it
recorded no *right* reason, and it labelled the whole workstream "optional
strategic optionality." Maintained documentation then propagated that label:

- `AGENTS.md` described ASP.NET as "an optional future alternative, not
  Laravel's planned replacement";
- `docs/REACT-DUAL-BACKEND.md` described the work as "a portability strategy,
  not a planned migration," with Laravel canonical "for the indefinite future";
- `DOCUMENTATION_GOVERNANCE.md` instructed readers that "ASP.NET is optional
  rather than an assumed successor";
- `aspnet-backend/docs/CURRENT_ASPNET_CONTRACT_STATUS.md` recorded that
  production operation "remains a separate owner decision regardless of score."

Every agent reading the mandatory first-read guides therefore learned that this
work was speculative. Two measurable consequences followed:

1. **Nobody was authorised to narrow the finish line.** A speculative project
   does not get a scoped, dated, finite delivery plan, so the goal stayed at its
   maximal reading — reproduce every one of ~2,650 endpoints exactly — and no
   agent could propose cutting it down, because cutting scope on a deliverable
   is a delivery decision and this was not framed as a delivery.
2. **The workstream was deprioritised in its own tooling.** `AGENTS.md:797`
   still records the rationale for excluding ASP.NET jobs from the deploy
   verifier as "the paused, development-only ASP.NET track." The exclusion
   itself is correct and stays; the reason written beside it is not.

The actual driver was never written down anywhere in the repository. It is
commercial and specific: **a segment of public-sector buyers will require a
.NET backend as a condition of procurement.** Many will accept a well-built
Laravel platform. Some will not, and for those, the absence of an ASP.NET
edition loses the contract outright. That is a revenue requirement with a
deadline set by tender timetables, not a technical curiosity.

## Decision

The ASP.NET backend is a **committed product deliverable of Project NEXUS**, not
optional strategic optionality. It is built to be sold and operated.

Its purpose is recorded as: **to allow Project NEXUS to be offered to buyers
whose procurement requires a .NET application stack, with the same product
behaviour on either engine.** This purpose is a first-class reason to fund,
schedule, prioritise, and finish the work.

Laravel remains the **production default and behaviour source of truth** until
the ASP.NET edition is certified. That is a sequencing statement, not a
statement about which engine matters. Both engines are intended to be
production-capable. Neither is a research exercise.

ADR-0002's technical findings are retained and remain binding:

- there is no user-, tenant-, or traffic-count threshold that automatically
  promotes ASP.NET or retires Laravel;
- growth constraints are addressed first in queries, indexes, caches, queues,
  media delivery, and infrastructure, in whichever engine is serving; and
- ASP.NET work never authorises weakening Laravel, delaying Laravel scaling
  work, or forking either frontend to suit ASP.NET.

What changes is the framing: ASP.NET exists because customers will require it,
and it is scheduled to be finished.

## Go-Live Gate

ADR-0002's six-item promotion gate is retained, renamed a **certification
gate**, and reduced to what a committed deliverable actually needs. It is a
checklist to complete, not a bar designed to be hard to reach:

1. the journey-equivalence evidence required by
   [ADR-0004](ADR-0004-journey-equivalence-is-the-target.md), at the tier the
   proposed deployment scope needs;
2. equivalent authorisation, tenant isolation, data integrity, localisation,
   background processing, and failure behaviour for the journeys in scope;
3. representative load and endurance evidence against real Project NEXUS
   workflows;
4. operational readiness: **working, verified backups**, deployment and
   rollback path, observability, and named support ownership;
5. a migration, verification, rollback, and data-reconciliation plan that does
   not rely on unsafe dual writes or a shared database; and
6. an explicit owner decision authorising the deployment scope.

🔴 **The backup position, stated accurately (corrected 2026-08-21).** Documents
in this repository — including this one until today — repeated "no successful
backup since 2026-03-08 (156 consecutive failures) with nothing to restore
from". That is true of the **scheduled off-server backup job** and materially
incomplete about the data.
[`DATABASE_BACKUP_DECISION.md`](../DATABASE_BACKUP_DECISION.md) established on
2026-08-16, by read-only inspection of the production host, that a
**restore-tested off-server copy exists** — restored into a throwaway
`postgres:16.4-bookworm` on 2026-08-10 giving 265/265 tables, 53/53 EF
migrations and 49,958 rows — and that the database container has been
`Exited (0)` since 2026-08-10 16:36:10Z, so that recovery point is **current**.
The genuine remaining gaps are narrower: the scheduled job is still broken so
nothing new is taken; the final 16:35 dump has only one copy and is
checksum-verified but not restore-tested, leaving a ~2.5-hour single-copy tail;
and migrate-on-start is dormant rather than gone, so the container still must
not be restarted. Fixing the scheduled backup and copying that final dump are
owner infrastructure items and remain part of the go-live gate — but "there is
no backup" is not the accurate statement, and must not be repeated.

Item 4 therefore contains a **real but bounded infrastructure gap**, in the
owner's hands: restore the scheduled backup, copy the final dump, and establish
a deploy/rollback path. No score and no volume of contract evidence substitutes
for it.

A deployment need not be all-or-nothing. A first ASP.NET production role may be
a single new customer tenant on a .NET-required contract, which needs the
journeys that customer uses certified — not every journey in the platform.

## Consequences

- Maintained documentation describes ASP.NET as a **committed second edition**,
  scheduled and resourced. The words "optional," "experimental," and
  "development-only" are removed from its product description. They remain
  accurate only where they describe a specific *current* limitation, and must
  then say which one.
- The **deployment prohibitions stay exactly as they are.** `aspnet-backend/`
  must still never be added to the Laravel blue/green Compose file or production
  deploy scripts without explicit authorisation; ASP.NET CI jobs must still
  never gate a Laravel release; the live ASP.NET containers must still not be
  restarted or redeployed. Those rules protect a live Laravel platform, and a
  database whose scheduled backup is broken and whose migrate-on-start behaviour
  is dormant rather than removed. Commitment to the deliverable is not authorisation to
  deploy it.
- Scope decisions are now legitimate and expected. An agent may propose cutting
  work that no client consumes, and should — see ADR-0004.
- Progress is reported against a finite, dated, journey-based plan
  ([`../JOURNEY_CERTIFICATION_LEDGER.md`](../JOURNEY_CERTIFICATION_LEDGER.md)),
  not against total endpoint count.
- The commercial driver is recorded here so that no future agent has to guess
  why this work exists, and no future document demotes it again.

## Relationship To Other Decisions

- **ADR-0001** defines what ASP.NET must reproduce. Unchanged and still binding.
- **ADR-0004** refines *how exactly* ADR-0001 is measured, and states what is
  deliberately out of scope. Read it before doing parity work.
- **ADR-0002** keeps its scaling reasoning. Its optionality framing is
  superseded by this record and must not be quoted as current product intent.
