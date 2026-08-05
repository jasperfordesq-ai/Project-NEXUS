# Safeguarding & Consent

Last reviewed: 2026-08-04

This page maps the safeguarding, guardian and consent subsystems as they exist in
code. It was written by reading the services, controllers, routes and the ~30
related tables in `database/schema/mysql-schema.sql` — this subsystem previously
had no documentation at all, which meant anyone working from the docs concluded it
did not exist. The source code remains authoritative.

Everything here is tenant-scoped unless stated otherwise.

---

## Why this page exists

Timebanking frequently involves people who cannot, or should not, transact
unsupported: minors, adults with care needs, and members who need a coordinator to
act with them. The platform has substantial machinery for this. It is spread across
four subsystems with different owners and different maturity levels, and they are
easy to mistake for each other.

---

## Guardian relationships — three separate systems

> 🔴 **"Guardian" means two unrelated things, and both are user-facing.** Staff
> record guardian arrangements in `safeguarding_assignments`, which grant
> **nothing**. Separately, a member can create an `account_relationships` link and
> choose `guardian` as its `relationship_type`, and that one **can** grant real
> abilities (listings, transfers). There is no foreign key between the two tables
> and no file in the codebase touches both — verified 2026-08-05. Nothing on
> screen distinguished them until the same date, when both surfaces gained an
> explicit note saying which is which and where the other lives. Keep that
> distinction in any new copy: conflating them is a safeguarding error, not a
> wording preference.

### 1. `safeguarding_assignments` — guardian ↔ ward pairs

The general-purpose safeguarding relationship. Columns: `guardian_user_id`,
`ward_user_id`, `assigned_by`, `assigned_at`, `consent_given_at`, `revoked_at`,
`notes`, unique per `(guardian, ward, tenant)`.

- **Created by staff, not by members.** `POST /v2/admin/safeguarding/assignments`,
  gated by `AdminSafeguardingController::requireSafeguardingStaff('manage')`, which
  admits admin tiers, `broker`, and holders of the `safeguarding.manage` permission.
  A member cannot create one.
- **Consent belongs to the ward.** The ward sees their own arrangements at
  `GET /v2/safeguarding/my-guardians` and consents at
  `POST /v2/safeguarding/consent-to-guardian`, which is the only writer of
  `consent_given_at`. A guardian consenting on the ward's behalf is refused, and
  there are tests for that boundary.
  > Until 2026-08-05 this column had **no writer at all** —
  > `SafeguardingService::recordConsent()` had zero callers — so the admin
  > "consented wards" count was structurally always zero, and the ward was never
  > shown the assignment despite being notified about it. If you add another
  > consent-bearing column, check something can actually write it.
  >
  > 🔴 The endpoints alone did not fix it. When they were added, **no frontend
  > called them**, so a ward still could not see or agree to an arrangement —
  > the same defect one layer up. The UI landed later the same day: a "Guardian
  > arrangements" section in `SafeguardingTab.tsx` lists the ward's arrangements
  > and carries the consent action, covered by tests in
  > `SafeguardingTab.test.tsx`. An API with no caller is not a fix; check the
  > screen exists.
- Revocation is a soft delete (`revoked_at`), so history survives.
- Create and revoke both write an `activity_log` row with actor and IP.
- **It is a record, not a capability.** No authorisation path anywhere consults
  this table — a guardian does not thereby gain the ability to act for, message
  for, or transact for their ward. It exists to be reported on and to inform staff.
- Surfaced in the broker and admin safeguarding dashboards.

### 2. `event_guardian_consents` — parental consent for minors at events

The most rigorous consent implementation in the platform, and the model to copy.

- Guardian email and identity are stored **encrypted**, with a separate blind hash
  for lookup.
- The consent artefact is pinned: `consent_text`, `consent_text_version`,
  `consent_text_hash`, plus a `policy_binding_hash` and the requirement version
  that was in force.
- Grant happens via a **single-use, expiring, hashed token**
  (`token_hash`, `token_consumed_at`, `expires_at`). The read-only status endpoint
  is deliberately separate from the grant endpoint so a mail scanner following the
  link cannot grant consent.
- Withdrawal and expiry are recorded with the acting user
  (`withdrawn_by_user_id`, `expired_by_user_id`).
- `event_guardian_consent_history` is **append-only, enforced at the database
  level** — `BEFORE UPDATE` / `BEFORE DELETE` triggers raise `SQLSTATE 45000`. Its
  `actor_type` column carries a CHECK constraint distinguishing a platform user
  from an external guardian.
- Request idempotency is hashed, so a retried request cannot create a second
  consent.
- An event manager may request or withdraw consent **on behalf of** a minor;
  every such action is attributed in the history table.
- Eligibility is genuinely gated — `EventSafetyEligibilityService` denies
  participation with `event_safety_guardian_consent_required`.

### 3. `vol_guardian_consents` — parental consent for volunteering

Simpler, and also genuinely enforced. The guardian here is an **external person,
not a platform user** (`guardian_name`, `guardian_email`, `guardian_phone`,
`relationship`). The minor requests consent themselves; the token is emailed to the
guardian and never returned to the requester. `VolunteerController` blocks minors
without active consent from applying, signing up for shifts, or joining a waitlist.
Expiry is swept by a scheduled command.

---

## Linked accounts (`account_relationships`)

A member-to-member relationship, self-service, distinct from all of the above.
`relationship_type` is one of `family`, `guardian`, `carer`, `organization`.

- Requested by one member, **approved by the other** (the child/dependent), with
  status `pending → active → revoked`. Either party can revoke.
- Guarded against self-linking, circularity, nesting in either direction, and a
  maximum number of children.
- Cross-checked against the safeguarding contact policy in **both** directions at
  request time, at approval time, and again whenever permissions are *expanded*.
- Carries a permission set: `can_view_activity`, `can_manage_listings`,
  `can_transact`, `can_view_messages`.

**Enforcement status (updated 2026-08-04).** Three of the four are now real:

| Permission | Enforced? | Where |
|---|---|---|
| `can_view_activity` | ✅ | `SubAccountService::getChildActivitySummary()` |
| `can_manage_listings` | ✅ | `SubAccountService::createListingForChild()` → `POST /v2/users/me/sub-accounts/{childId}/listings` |
| `can_transact` | ✅ | `SubAccountService::transferForChild()` → `POST /v2/users/me/sub-accounts/{childId}/transfer` |
| `can_view_messages` | ❌ **not enforced, and no longer offered** | see below |

**Update 2026-08-05: `can_view_messages` is no longer presented to members.** It
was removed from `SubAccountsManager.tsx`'s `PERMISSION_KEYS` and from
`SettingsAuthParity::SETTINGS_LINK_PERMISSIONS`, which also stops the accessible
frontend accepting it on save (that constant drives display *and* all three write
paths). Both screens now state explicitly that carers cannot read messages,
rather than the control silently disappearing — a family that had switched it on
needs to know it never did anything. The permissions endpoint still accepts the
key for backward compatibility, and it remains in
`SubAccountService::DEFAULT_PERMISSIONS` so historical rows parse; a table there
records which keys are real. Note the
`account_relationships.permissions` column comment lists only the three enforced
keys — evidence the fourth reached both UIs and never the schema.

Until 2026-08-04 **only `can_view_activity` was enforced** — `hasPermission()` had a
single caller in the whole codebase, while all four toggles were presented to users
in both frontends with labels promising the abilities. Nothing granted a privilege
it shouldn't have, but families could have been told a carer had powers the carer
did not have.

Two rules the proxy endpoints follow, and that anything added here must follow too:

- **Attribution is mandatory.** The dependent remains the owner (the listing is
  theirs, the credits are theirs), and `listings.acting_user_id` /
  `transactions.acting_user_id` record who actually performed the action. A carer's
  action must never be indistinguishable from the dependent's own. Every proxy
  action is also written to `org_audit_log`, and the dependent is notified in their
  own language.
- **Reuse the member's own code path.** `transferForChild()` delegates to
  `WalletService::transfer()` so the carer route inherits the transfer cap,
  over-spend guard, safeguarding contact check, deterministic lock ordering and
  idempotency claim unchanged. A parallel money path would be a weaker one.
- The safeguarding contact policy is re-asserted **at use time**, not only at grant
  time, and a `pending` relationship confers nothing.

> 🔴 **`can_view_messages` is not enforced and is no longer offered.** Letting a
> carer read a dependent's conversations exposes the *other* party, who never
> agreed to it. The platform's established answer for staff oversight is to
> notify — see `BrokerMessageVisibilityService::getUserRestrictionStatus()`'s
> `review_notice_required`. Until the equivalent notice exists for carers, do not
> wire this permission up, and do not re-add it to either frontend's permission
> list "for consistency" with the type or the constant.

---

## Consent records

`user_consents` is the general consent ledger, and it is properly versioned:
`consent_type`, `consent_given`, `consent_text`, `consent_version`,
`consent_hash`, `ip_address`, `user_agent`, `source`, `given_at`, `withdrawn_at`,
`expires_at`, `is_active`. Supporting tables: `consent_version_history`,
`tenant_consent_overrides`, `tenant_consent_version_history`.

`consent_types` is the **platform-global** catalogue that per-tenant overrides key
off by slug. It carries `category`, `is_required`, `legal_basis` (the six UK GDPR
lawful bases) and `retention_days`. It is a data-protection catalogue — it does
**not** model consent to be represented by another person.

Jurisdiction- and domain-specific consent records also exist:
`fadp_consent_records` (Swiss FADP), `job_gdpr_consents`,
`caring_research_consents`, `federation_aggregate_consents`.

> **Caveat:** terms acceptance at registration is validated but is **not** written
> to the versioned `user_legal_acceptances` table. The only versioned acceptance a
> member gets is created at first login via the legal gate. Until that is fixed,
> there is no record of which terms version a brand-new member agreed to.

---

## Raising a safeguarding concern

`safeguarding_reports` is a real case-management workflow, not a content flag.

- `category`: `inappropriate_behavior`, `financial_concern`, `exploitation`,
  `neglect`, `medical_concern`, `other`.
- `severity`: `low` → `critical`, driving a review SLA (`review_due_at`);
  `critical` fans out immediately to staff.
- `status`: `submitted → triaged → investigating → resolved | dismissed`, with an
  explicit transition table in the service.
- Subject can be a **user or an organisation**. Assignment, escalation and
  resolution notes are all supported.
- `safeguarding_report_actions` is an append-only log with a closed action
  vocabulary (`created`, `triaged`, `assigned`, `escalated`, `status_changed`,
  `note_added`, `resolved`, `dismissed`), actor and notes.
- Members submit via the caring-community endpoint and can view their own reports.
  Triage is deliberately open to non-admin safeguarding officers and brokers.

Related: `safeguarding_flagged_messages` (message review),
`user_safeguarding_preferences` and `tenant_safeguarding_settings` /
`tenant_safeguarding_options` (which triggers apply, per tenant and per member).

> **Caveat:** there are four independent reporting systems in the platform —
> generic content `reports`, `safeguarding_reports`, volunteering safeguarding
> incidents, and `marketplace_disputes` — and **none of them can reference a time
> exchange.** `reports.target_type` has no `exchange` value. A member who believes
> a completed exchange was recorded wrongly has no in-product way to say so.

---

## Vetting attestations

`member_vetting_attestations` is the best-designed decision surface in the
codebase and worth imitating:

- **Evidence is deliberately refused.** The controller maintains a list of
  prohibited input fields (document, file, reference/certificate number, issue and
  expiry dates) and rejects uploads outright. The platform records that a community
  attests to having done its checks; it does not become a store of DBS certificates.
- Confirmation requires an explicit acknowledgement plus certification codes, a
  scope summary and optional private notes. The free-text fields are stored
  **encrypted**.
- Revocation uses a **closed reason vocabulary**, not free text.
- `member_vetting_attestation_events` records `decision_before`, `decision_after`,
  `reason_code`, actor and policy version — append-only.

Contrast with member suspension and ban, which accept a free-text reason that has
no column to live in and survives only inside an audit blob; and with member
registration, which has no rejection path at all.

---

## Acting on behalf of a member — current state

| Mechanism | Who initiates | Who consents | Can act for them? |
|---|---|---|---|
| `safeguarding_assignments` | broker / admin | the **ward**, via `POST /v2/safeguarding/consent-to-guardian` | **No** — record only |
| `event_guardian_consents` | minor, or an event manager | external guardian, via token | **Yes**, within events |
| `vol_guardian_consents` | the minor | external guardian, via token | Gates the minor; no proxy action |
| `account_relationships` | any member | the dependent | **Yes** — listings and transfers (attributed + audited); messages not offered |
| `caring_caregiver_links` | any member (`pending`) | — (no activation endpoint) | Blocked in practice |
| Paper onboarding intake | admin | the member, offline on paper | **Yes** — creates the account |
| Event staff roles | event manager | — | **Yes**, capability-scoped, fully enforced |

**There is no way for a broker to post a listing or record an exchange on behalf of
a supported member.** `listings` has a single `user_id` with no author/owner split,
and there is no such screen in the broker application. This is the largest gap in
the subsystem, and closing it needs a product decision first: does the broker act
*as* the member, or record activity *attributed to* the member? The two have
different consent and audit consequences.

`caring_help_requests` does support on-behalf creation (`is_on_behalf`,
`requested_by_id`) via an active caregiver link — but no endpoint can move a link
to `active`, so the path is unreachable today.

---

## If you are extending this area

1. **Copy `event_guardian_consents`** for anything involving consent by a third
   party: versioned consent text, a hash, a single-use expiring token, an
   append-only history table, and attribution of who acted.
2. **Copy `member_vetting_attestations`** for anything involving a staff decision:
   closed reason vocabulary, before/after values, actor, policy version.
3. **Never present a permission the backend does not check.** See the linked
   accounts caveat above for why.
4. A record of a relationship is not authorisation. If you want a guardian to be
   able to *do* something, you must add an explicit check — nothing is implicit.
