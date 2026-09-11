# Security Assurance

Last reviewed: 2026-09-11

How security assessment works on Project NEXUS: what gets tested, how results are recorded, and
how a customer — particularly a public-sector one — can ask for and receive evidence.

This document describes the **process**. It deliberately contains no findings. Finding detail
lives in a private register (Section 3) and is shared with a customer confidentially, under that
customer's own package, once remediation allows.

Related: [`SECURITY.md`](../SECURITY.md) for vulnerability disclosure,
[`SECURITY-SCANNING.md`](SECURITY-SCANNING.md) for the automated scanners,
[`CI.md`](CI.md) for which checks block a release.

---

## 1. Why this exists

Project NEXUS hosts communities for councils, charities and housing providers. Those
organisations have supplier-assurance obligations: before and during a contract they must be
able to see what security work has been done, what it found, and what happened next. That
question has been asked in practice, and it will be asked at every renewal and by every new
public-sector customer.

So security work here is not a series of one-off exercises. It is a maintained record with
continuity between engagements. An assessment that cannot be placed in that record — dated,
scoped, with its findings tracked to a conclusion — is not assurance, however good the testing
was.

---

## 2. What assurance is made of

Four layers, each answering a different question.

| Layer | Question it answers | Where it runs |
|---|---|---|
| **Automated gates** | Did this change break a security property we already protect? | Every push, every release. See [`CI.md`](CI.md). |
| **Automated scanning** | Are there known-vulnerable dependencies, secrets, or patterns? | Nightly and on merge. See [`SECURITY-SCANNING.md`](SECURITY-SCANNING.md). |
| **Targeted assessment** | Does a specific security property hold across the whole route table? | Periodic, recorded as an engagement. |
| **Independent testing** | Would someone outside the team reach the same conclusion? | **Not yet commissioned.** Stated plainly, never implied. |

The fourth line is the honest one and must stay. No internal work substitutes for independent
testing, and no assurance document may suggest otherwise.

### Route-table-wide sweeps

The distinctive part of assessment here is that security properties are tested against the
**live route table**, not a hand-written list of endpoints. The API registers thousands of
route-methods; a hand-written list goes stale the week it is written. Each sweep enumerates every
route the application actually serves, decides what each parameter means, and probes it.

Properties tested this way so far:

- **Community isolation** — a member of one community cannot reach another community's records.
- **Role boundaries** — a member, broker or community administrator cannot reach functions above their tier.
- **Same-community authorisation** — a member cannot reach another *member's* private records inside the same community. This is the check that per-endpoint code has to make for itself, so it is the one most easily forgotten.
- **Credential scoping** — a credential issued for one community is refused by another.
- **External surfaces** — partner and federation endpoints refuse traffic while their switches are off.

Each sweep covers single-parameter and multi-parameter routes, and each treats the two kinds of
identifier differently: a route that names a *person* and a route that names a *child record*
fail in different ways, so they are probed separately.

### Rules that make a sweep's numbers mean something

These were learned the expensive way and are binding on any new sweep.

1. **Every refusal is control-verified.** A refusal only counts when the same request with the
   caller's *own* record succeeds. Otherwise "refused" may just mean the endpoint was never
   exercised. This lowers headline numbers and makes each one defensible.
2. **A control request is a real request.** Running controls in route order lets an earlier
   destructive control destroy the state a later one needs. State is re-established before every
   endpoint. This fault has been hit three times and each time produced a cluster of false
   results.
3. **Unattempted, inconclusive and validation-rejected are not passes.** They are reported beside
   every coverage figure. A probed count quoted without them is not a coverage statement.
4. **A disabled feature module is not a pass.** If a gate refuses before the check under test
   runs, nothing was learned; the module is enabled for the sweep so the real check is reached.
5. **Write sweeps compare state, not status codes.** The target row is read before and after and
   compared column by column, regardless of the response status — a write that changes data and
   then returns an error must not escape.
6. **A success response for a record that does not belong to the caller is a finding**, even when
   nothing changed. It should be a not-found.

### Where assessment does not reach

Stated in every engagement rather than left to inference: anything needing production writes
(mutation sweeps run against an isolated copy); infrastructure the repository does not contain;
and any component explicitly excluded, with the reason.

---

## 3. The register

Every engagement and every finding is recorded in a private **Security Assurance Register**. It
is not in this repository because it carries finding detail that should not be public before
remediation.

The register holds:

- **An engagement log** — dates, who conducted it, why, the exact commit examined, scope, method, what was found, and where the evidence is frozen.
- **A consolidated finding register** — every finding from every engagement, with a permanent identifier it keeps for life.
- **Cross-document reconciliation** — what each engagement changed about the other security documents and about any customer-facing collateral.
- **Evidence handling** — which frozen bundle each published figure comes from.
- **Open items by owner** — consolidated across engagements.

Rules on the register:

1. Every assessment appends to it at the time.
2. Finding identifiers are permanent. Never reused, never renumbered, never deleted. A finding
   that proves wrong is marked withdrawn, with the reason.
3. A new assessment reads the existing findings first. Re-testing a closed finding is welcome;
   reporting it as new is not.
4. Findings are stated in proportion and never removed to improve the picture.

---

## 4. Finding status and severity

A finding's status uses a vocabulary that distinguishes *a fix exists* from *the fix works in
production*. Each state implies the ones before it.

`found` → `confirmed` → `fixed in source` → `locally retested` → `CI verified` → `deployed` →
`production retested` → `independently verified`

Two of these are habitually over-claimed and are therefore defined tightly:

- **CI verified** means the pipeline passed on a commit containing the fix, *and the job list was
  read*. This pipeline skips jobs for areas a commit does not touch, and a skipped job counts as
  a pass at the aggregate level — so a green tick alone does not establish that a suite ran.
  See [`CI.md`](CI.md).
- **Production retested** means the original symptom was checked against the live service. This
  matters more than it sounds: a configuration fix verified only against a local environment has
  shipped and still been wrong, because the hosting layer above the application does not exist
  locally.

Severity is stated in plain English so a non-specialist reader can weigh it:

| Severity | Meaning |
|---|---|
| **Critical** | Someone on the internet, not logged in, could read or change member data, take over an account, or move time credits. |
| **High** | Any logged-in member could do that to other members, or gain administrator power. |
| **Medium** | Limited disclosure or abuse, or it needs administrator access or unusual conditions. |
| **Low** | Hardening or hygiene, with no direct member impact. |
| **Informational** | A coverage note, not a weakness. |

---

## 5. Evidence

Assessment results are written to machine-readable evidence files as the tests run. Two rules
govern them:

- **Freeze per engagement.** Test runs overwrite their own output, so any figure quoted in a
  document must point at a frozen, checksummed copy, not a live path. A figure whose evidence
  has been overwritten cannot be defended.
- **Evidence is never committed.** It contains response bodies and member-shaped fixtures.

Evidence can be supplied to a customer under a confidentiality arrangement, as part of that
customer's package.

---

## 6. For a customer asking for assurance

A public-sector buyer, or anyone with a supplier-assurance obligation, can ask for:

1. **An assurance summary** — what is protected, how it is checked, what the current risk
   position is, in plain English.
2. **A technical assurance report** — mechanisms, recorded test outcomes with their coverage
   boundaries, operational evidence, and the current open items.
3. **The complete internal assessment record** — methods, endpoint populations, original findings
   and their remediation history. Supplied confidentially on request; the summary is never
   presented as though it were this.
4. **Testing terms**, if the organisation wants to commission its own testing. A draft
   rules-of-engagement document exists for that conversation. Nothing about independent testing
   is claimed unless it has actually been commissioned.

Requests come through the commercial relationship. The technical contact is named in the
assurance package itself.

---

## 7. Keeping this current

- Security work updates the register at the time — not at the end of a quarter, not from memory.
- An assessment that contradicts a statement in any other security document has found a
  documentation defect as well as a technical one, and records both.
- This document changes only when the **process** changes. Findings never appear here.
- Reviewed at least at each engagement; the date at the top is the last review.
