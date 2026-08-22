# Support Intake and Triage

Last reviewed: 2026-08-22

How-to for working a member or operator support report on Project NEXUS. Written for whoever runs support for a tenant community. Deliberately generic: it describes the platform, not any one operator's staffing or contacts.

Companion reference: `SUPPORT-REPORTS.md` for the in-product subsystem, `MEMBER-LANGUAGE.md` for how to write the reply.

---

## Establish four facts before investigating

Nothing downstream is reliable without these.

1. **Who is asking** — a member, or a tenant operator?
2. **Which tenant** — every query is tenant-scoped; a symptom is often a per-tenant configuration.
3. **Which application** — see below.
4. **Scope** — one member, one tenant, or more than one tenant? More than one tenant is a platform fault, not several reports.

### Identifying the application from a screenshot

| What you see | What it is |
| --- | --- |
| GOV.UK styling; an `accessible.*` host, or an `/{tenantSlug}/accessible/...` path | The accessible frontend (`web-uk`) |
| HeroUI styling on the main app host | The React frontend |
| A phone | One of **two** mobile codebases — a Capacitor wrapper around the React app, or the separate Expo/React Native client. A screenshot does not distinguish them. Ask. |

Check the URL bar, not just the error. See `../DEPLOYMENT.md` for the current host table, including retired hosts that answer 503 with the domain retained — a report against one of those is a report against something switched off.

---

## Check in cost order

Each step is cheaper than the one after it.

### 1. Is it a disabled feature rather than a fault?

Usually yes, when the complaint is "we don't have X". But **gating is not one check**:

- **Tenant feature flags** — validated against `TenantFeatureConfig::FEATURE_DEFAULTS`. Many default off.
- **Tenant module flags** — `MODULE_DEFAULTS`.
- **Admin sections are separately feature-gated** and redirect to `/admin/not-found`.
- **Some features have a broker-side toggle** independent of the tenant flag.

Canonical admin path is `/admin/module-configuration`; `/admin/tenant-features` is a legacy redirect. Writes clear the tenant bootstrap cache in Redis and take effect immediately. Read the current lists from `../modules/admin.md` or the config class rather than from any prose copy.

### 2. Did it arrive with a linked Sentry event?

An in-product report captures a Sentry event on submission and stores the id (`SUPPORT-REPORTS.md`). Check that before searching Sentry by hand.

Remember the capture is best-effort — an empty `sentry_event_id` is not proof that nothing failed.

### 3. Is there a server-side error at all?

Sentry, in the project matching the application. **"No matching events" is a finding, not a dead end** — a fault with no server-side error is a different investigation from one with a stack trace, and saying which you have is part of the report.

### 4. For sudden onset, did a deployment cause it?

There is an automated post-deploy error watch scoped to the new release tag, which surfaces the rollback command on a spike. Ask whether it alarmed. See `../DEPLOYMENT.md` and `../RUNBOOK-INCIDENTS.md`.

### 5. What does the record actually say?

The admin panel is the present-tense truth for a specific tenant or member — user status, wallet history, listing state, partnership state. Documentation describes what *should* happen; the panel describes what *is*.

### 6. Has it been reported before?

The support queue, then whatever ticketing the operator keeps outside the platform.

---

## Severity, and what the platform already commits to

The platform does **not** carry a staff-assigned severity on support reports — `impact` is member-declared and is not a priority (`SUPPORT-REPORTS.md`). Response commitments therefore live with the operator, not in the table.

What *is* wired, and worth knowing before promising anything:

| Commitment | Where |
| --- | --- |
| Exchange completion and login availability SLOs, with alerting | `../SLO.md` |
| External uptime checks, 5–15 min intervals, multiple alert destinations | `../MONITORING.md` |
| GDPR statutory deadline enforced as a constant, with a daily overdue alarm warning from day 25 | `../modules/members-and-gdpr.md` |
| Safeguarding review deadline driven by report severity | `../SAFEGUARDING-AND-CONSENT.md` |
| Vetting renewal reminders at 90/30/7 days, on the date, and after expiry | `../modules/admin.md` |

So "is the site up?" and "is a GDPR request overdue?" usually have answers before anyone emails.

> **Vocabulary note.** `../RUNBOOK-INCIDENTS.md` uses P1/P2/P3 for production incidents and post-mortems. A support severity scale is a different axis — a P1 is always a support emergency, but a support emergency need not be a production incident. Keep the two vocabularies distinct rather than merging them.

Post-mortem triggers are defined in `../RUNBOOK-INCIDENTS.md`: any incident that lasted more than a few minutes, required maintenance mode, triggered a rollback, or risked data.

---

## Actions that look routine and are not

The platform documents these mechanisms in detail elsewhere. What follows is when a human should hesitate before using them.

**Account recovery — password or 2FA reset.** Verify the requester is the account holder before acting. An email address is not proof, and a wallet with transferable credits sits behind the login.

**Reactivating a suspended account.** Read why it was suspended first. Suspension may have been a moderation or safeguarding outcome, and reversing it is not an administrative convenience. Note that suspension reasons are free text with no dedicated column, surviving only in an audit blob — so "why" may be hard to recover, which is itself a reason to stop.

**Adjusting credits.** Grants are capped at 10,000 per grant and write an `admin_grant_credits` activity entry with actor, target, amount and reason — but **the reason field is optional in code**, defaulting to a generic string. Recording a real reason is therefore a policy the platform does not enforce. Grants are also the deliberate exception to double-entry conservation (`../modules/wallet-exchanges.md`).

**Correcting a completed exchange.** There is no member-facing route. The remedy is a broker **reversal**, which writes a compensating transaction and never mutates the original. Three consequences to know before promising anything:

- The status deliberately stays `completed`; whether an exchange still stands is answered by `reversal_transaction_id`, not by the status.
- Reversal does not re-post at a corrected figure — it is reverse, then record again.
- The balance **can go negative** if the credits were already spent, creating a real debt in the ledger.

Before completion the path is different: a mismatch beyond tolerance moves the exchange to `disputed` for broker resolution.

**Moving a member between tenants.** The balance moves; the transaction history does not, and there is no repair tooling (`../ROLES-AND-PERMISSIONS.md`). If a member's history has vanished, ask whether they were moved.

---

## Two answers that are easy to get wrong

**External federation is disabled platform-wide.** Every external endpoint answers 503 with `Retry-After`, whatever credentials are presented, and cross-tenant credit inflow is dormant. That is the kill switch, not a fault. Internal and external gates fail in opposite directions by design. `../FEDERATION_API_MANUAL.md`.

**A duplicate transfer is probably not a duplicate.** Transfers are idempotency-guarded — a repeated identical transfer inside the guard window is ignored deliberately, and "duplicate transfer ignored" is the expected message. The guard fails open on cache error. `../modules/wallet-exchanges.md`.

**A guardian arrangement grants no powers.** It is a record, not a capability; no authorisation path consults it. Never tell a family that recording a guardian confers the ability to act. `../SAFEGUARDING-AND-CONSENT.md`.

---

## Safeguarding is not this workflow

A report about another member's behaviour, or any concern for someone's safety, does not belong in support triage.

The platform has a dedicated workflow — `safeguarding_reports`, with categories, a severity-driven review deadline, an explicit state machine and an append-only action log, triageable by brokers and coordinators as well as admins. Two constraints decide whether a member can reach it:

- The member-facing pages are gated behind the `caring_community` feature, which defaults **off**.
- The accessible frontend has no safeguarding report page — the frontend most likely used by the members these reports concern.

Detail in `../SAFEGUARDING-AND-CONSENT.md`. **Desk procedure for handling a disclosure — who to contact, what to say, what not to record — is an operator responsibility and belongs in the operator's own safeguarding policy, not in this repository.**

## Related

- `SUPPORT-REPORTS.md` — the in-product subsystem
- `MEMBER-LANGUAGE.md` — writing the reply
- `../RUNBOOK-INCIDENTS.md` — production incident first response
