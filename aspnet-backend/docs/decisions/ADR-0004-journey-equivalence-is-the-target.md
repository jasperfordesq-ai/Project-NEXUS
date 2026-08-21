# ADR-0004: Journey Equivalence At Consumed Boundaries Is The Target

Date accepted: 2026-08-21

Status: **Maintained reference - accepted; refines ADR-0001's measurement**

Refines: [ADR-0001](ADR-0001-contract-identical-backends.md). ADR-0001's
decision is unchanged. This record fixes how it is *measured*, and states what
is deliberately excluded.

## Context

ADR-0001 requires ASP.NET to be "externally contract-identical" at "every
consumed boundary," and explicitly says internal implementation identity is not
required. Read carefully, that is the right standard.

In practice it was measured differently. The response-comparison harness
(`scripts/compare-live-responses.mjs`) diffs **whole response bodies**. Laravel's
controllers frequently return raw Eloquent models, so a single listing response
carries around 76 fields and an event around 80 — including internal database
columns that no client reads and some that should never have been serialised at
all, such as `category.reset_token`. Under a whole-body diff, reproducing those
counts as required work, and *not* reproducing them counts as a contract gap.

🔴 **Measured qualification, 2026-08-21 — this example is real but it is
not where the volume is.** Consumed-field mode has since been built and run. On
the **member read** corpus it cleared only 16 of 80 differing endpoints, and all
16 cleared because ASP.NET returned a *superset*, not because Laravel leaked an
unread column: 64 of 80 are real work. The field noise this section describes
concentrates in **write** responses and raw-Eloquent **admin** surfaces, neither
of which that corpus covers, and the member read corpus is generated from the
React client's own call list — so by construction almost everything on it has a
reader. The scope rule below is unchanged and correct; the expected *size* of its
effect on reads was overstated. Do not quote this paragraph as evidence that a
large fraction of measured differences are noise.

The measurable damage:

- The semantic-parity category was scored from "how many of N sampled responses
  differ," so it moved with **field noise** rather than with product behaviour.
- Deductions were taken for **unmeasured surface**: −20 of the 350 semantic
  points existed solely because a 392-endpoint write ledger had not been run.
  Discovering more surface lowered the score; making the product work did not
  necessarily raise it.
- The overall number consequently fell from 712 to 598 between July and August
  **while the software improved**, because the instrument got more thorough. That
  is defensible as an audit and useless as a delivery signal.
- On 2026-08-19 an agent asked the owner outright whether field-for-field
  matching of raw-Eloquent create responses was a goal, recommended that it was
  not, and **received no answer**. Work continued under the strict reading by
  default, because no record permitted the looser one.

"Byte-for-byte identical" was never anyone's stated intent. It is what a
whole-body diff enforces when nothing tells it which fields matter.

## Decision

The target is **journey equivalence at consumed boundaries**:

> For every journey a real user or client performs, the unchanged React frontend
> and the unchanged Web UK frontend must behave the same way against either
> backend — same outcome, same data, same errors, same permissions, same
> persisted side effects — switched by configuration only.

A response field is **in scope** if any of the following is true, and out of
scope otherwise:

1. **A client reads it.** Any static or dynamic read by `react-frontend/`,
   `web-uk/`, `mobile/`, or a documented external API consumer.
2. **It carries meaning a client acts on**, even indirectly — pagination
   cursors, counts driving a UI state, flags gating a control, error codes,
   status values, identifiers used in a subsequent request.
3. **Its absence or difference changes an outcome** — authorisation, tenancy,
   ordering, idempotency, totals, audit records, notifications, jobs.
4. **A published contract names it** — OpenAPI, the API-consumer docs, or a
   partner federation contract.

Explicitly **out of scope**, and not a defect:

- Internal database columns a client never reads, whether Laravel leaks them or
  not. Reproducing `category.reset_token` is not work; **serialising it in
  Laravel is a Laravel defect** and should be raised as one.
- Field *ordering* within a JSON object.
- Laravel's raw-Eloquent serialisation shape where a documented projection is
  what clients actually consume.
- Internal storage layout, table names, private service structure, or query
  plans, provided data integrity, tenant isolation, and upgrade behaviour are
  proved.
- Endpoints no client calls and no published contract names. These are
  **candidates for deletion in both engines**, not for reimplementation. Deleting
  one requires the owner to see the list first.

Where ASP.NET returns a *superset* of what a client reads, that is not a gap.
Where it returns *less* than a client reads, or a different value, that is a
defect regardless of how obscure the field looks.

## How This Is Measured

The denominator is the **journey catalogue**, not the endpoint count:
[`../JOURNEY_CERTIFICATION_LEDGER.md`](../JOURNEY_CERTIFICATION_LEDGER.md). It is
finite, enumerated, tiered, and each row is independently certifiable, which is
what makes the remaining work schedulable and parallelisable.

A journey is **certified** only with all of:

1. the unchanged client driving it through its own UI, against ASP.NET, by
   configuration change only;
2. an assertion on the **effect**, not just the render — the row exists, the
   balance moved, the message arrives, the state survives a reload;
3. the same journey passing against Laravel in the same run, so a fixture
   difference cannot be mistaken for a backend fault;
4. a committed automated test or smoke step, so it cannot silently regress; and
5. no do-nothing endpoint on the path it exercises.

Three rules follow, each learned the expensive way here:

- **A 200 is not evidence.** The volunteering page rendered an error state while
  every API call returned 200, because one field was named `starts_at` where the
  card read `start_date`. Only rendering the page finds that.
- **A response diff only compares the variant you asked for.** Adding
  `X-Events-Contract: 2` fixed the diff and blinded it to the default path,
  which was crashing the dashboard. Harnesses must send what the client sends,
  and measure every negotiated variant.
- **Run the Laravel control.** A difference is not a fault until the same probe
  against Laravel proves it.

## Consequences

- The response-comparison harness needs a **consumed-field mode**: filter to
  fields with a known client reader before reporting a difference.
  🔴 **BUILT 2026-08-21** (`scripts/build-consumed-field-manifest.mjs`, 40,643 field names across
  react-frontend, web-uk, mobile and `openapi.json`; `--consumed-fields` on the
  harness). It over-includes deliberately: an unclassifiable field is treated as
  IN scope, because a false "out of scope" hides a real defect while a false "in
  scope" costs only wasted triage. Where no manifest covers a corpus – the 243
  admin reads and the 392-endpoint write ledger – differ counts remain an upper
  bound and must be reported as such, never as a defect count.
- Scoring is journey-weighted. Rubric `ASPNET-CONTRACT-R5` implements this; see
  [`../FULL_PARITY_REMEDIATION_RUNBOOK.md`](../FULL_PARITY_REMEDIATION_RUNBOOK.md).
  R4 and R5 totals are **not comparable** to R1–R3, which measured a
  different question, nor to each other: R5 re-cut the denominator once, finally,
  to absorb the mobile client and the expanded admin surface.
- No deduction may be taken for surface merely being unmeasured. Unmeasured
  surface is recorded as an **open journey row**, which is work with a name,
  rather than as a penalty with no owner.
- A field difference with no identified client reader is closed as **out of
  scope, with the reason recorded**, and is not carried as a gap.
- ADR-0001's prohibitions are untouched: never fix a mismatch in a frontend,
  never fork a client for ASP.NET, never invent a success response. Narrowing
  *what counts as a mismatch* does not license adapters or fabricated data.

## Relationship To Other Decisions

- **ADR-0001** — the standard. Unchanged; this record is its measurement rule.
- **ADR-0003** — why the deliverable is committed, and the go-live gate.
- **ADR-0002** — retained scaling reasoning only.
