# ASP.NET Production-Readiness Remediation Backlog

**Opened 2026-08-15 at monorepo HEAD `870c1e989`.** This is the single actionable
list of everything standing between the ASP.NET backend and running a real
community. It exists so a future session does not have to rediscover any of it.

**Read this first, then** [`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md)
(scoring, evidence boundary, full audit narrative) and
[`CURRENT_SCHEMA_READINESS.md`](CURRENT_SCHEMA_READINESS.md).

## How to read this

- Every item was **verified on disk** at the cited `file:line`. Nothing here rests
  on unverified agent output. Where something was **not** verified it says so.
- `STATUS` is one of `OPEN`, `FIXED <sha>`, `OWNER-GATED`, `NEEDS-DECISION`.
- Severity: **P0** blocks any production use; **P1** breaks a real member or admin
  workflow; **P2** contract divergence with a client impact; **P3** hygiene.

## 🔴 The one thing to understand before touching this backend

**Route existence proves nothing here.** 349 action methods return
success-shaped JSON while performing no work at all — no database access, no
service call. The generated inventories report *2,659 routes matched and 0 static
React contract gaps* precisely because those stubs answer with plausible 200s.

Consequences for how you work:

- **Never accept "the route exists" as evidence.** Open the method body.
- **Never accept a green test run as evidence of behaviour.** The suite pins
  shapes and routing; almost nothing asserts that an endpoint had an *effect*.
  `AdminV2RouteAliasRuntimeTests.cs:773-780` literally asserts only "not 404, not
  405" — a stub satisfies it.
- The stub inventory is machine-generated at
  `.local-docs-archive/noop_stubs.json` (gitignored). Regenerate with the
  detector described in R-1.

---

## P0 — blocks production

### R-1 `OPEN` — 349 no-op action methods that report success

**Evidence:** detector = an action method whose entire body contains no `_db`, no
`await`, no service call, yet returns `Ok(new {...})`/`Created`. Worst files:
`MiscParityController.cs` (84), `AdminCompatibility2Controller.cs` (56),
`AdminCompatibility3Controller.cs` (42), `ReactFrontendCompatibilityController.cs`
(31), `FrontendApiParityController.cs` (20), `MemberParityController.cs` (19).

Confirmed destructive examples — these silently do nothing:

| Endpoint | Location |
| --- | --- |
| `POST super/tenants` (returns `success:true, id:0`) | `AdminCompatibility3Controller.cs:633` |
| `PUT super/tenants/{id}` | `:641` |
| `DELETE super/tenants/{id}` | `:649` |
| `POST super/tenants/{id}/reactivate` | `:657` |
| `POST super/tenants/{id}/toggle-hub` | `:665` |
| `POST super/tenants/{id}/move` | `:673` |
| `POST super/users` | `:697` |
| `PUT super/users/{id}` | `:705` |
| `GET super/tenants/hierarchy` (hardcoded empty) | `:626` |
| group member promote / demote / remove | `AdminCompatibility2Controller.cs:681,686,691` |
| `GET /v2/users/me/sub-accounts/{childId}/activity` | `UsersParityController.cs:510` |

**Plan.** Triage the JSON inventory into three buckets: (a) endpoints a client
actually calls — implement for real; (b) endpoints nothing calls — delete the
route rather than leave a lie; (c) deliberate fixtures — annotate with
`[Obsolete]` or a `// STUB:` marker and add them to an allowlist so the detector
count can become a shrink-only ratchet in CI. **Do not "fix" one by adding a
`_db` call that does nothing useful** — the point is the client-visible effect.

### R-2 `FIXED 9c54ef501`+`this commit` — webhooks that destroyed events

Three `[AllowAnonymous]` handlers in `MiscParityController.cs` returned
`200 {received:true}` and discarded the payload: `webhooks/stripe` (`:1328`),
`webhooks/identity/{provider}` (`:1319`), `webhooks/sendgrid/events` (`:1324`).
Stripe and SendGrid treat 2xx as delivered and never retry, so each event was
destroyed permanently and silently.

Now return **501** with an `Error`-level log (`WebhookNotProcessed`). The event
stays in the sender's retry queue — a real durable store — and surfaces in the
provider dashboard. **Still OPEN:** real processing. The genuine, hardened Stripe
handlers exist at `api/webhooks/stripe/donations`
(`Phase72Controllers.cs:103,139` — HMAC-SHA256, 5-minute replay window, fails
closed in Production when the secret is unset) and
`api/v2/marketplace/webhooks/stripe` (`MarketplaceController.cs:1741`). Laravel's
production path `/api/v2/webhooks/stripe` has **no** ASP.NET handler at all.

### R-3 `OPEN` — no tenant hierarchy exists

`Tenant` and the `tenants` table carry only `Id, Slug, Name, Domain, Tagline,
LogoUrl, IsActive, CreatedAt, UpdatedAt`. There is **no parent, path, depth or
allows_subtenants**. Laravel's entire hub/sub-tenant model rests on
`tenants.path`. This is why `GET super/tenants/hierarchy` returns a hardcoded
empty array, and why R-4 is a data-model gap rather than a missing `if`.

**Plan.** Add `parent_id` + materialised `path` (+ `allows_subtenants`,
`max_depth`) with a migration and a backfill, then implement hierarchy, then R-4.

### R-4 `OPEN` — no subtree confinement for regional super admins

Laravel confines a hub-tenant super admin (`level = regional`) to its own subtree:
`app/Core/SuperPanelAccess.php:172` (level), `canAccessTenant()` `:190`
(prefix match on `path`, **fails closed** on an empty prefix), enforced from
`AdminSuperController.php` (35 call sites), `TenantVisibilityService.php` (10),
`SuperAdminAuditService.php` (4), `EnsureSuperPanelAccess.php` (3),
`UsersController.php` (2). The only occurrence of the concept anywhere in
`aspnet-backend/src/Nexus.Api/` is an explanatory comment in
`AdminSuperImpersonationController.cs`.

Consequence: a regional super admin who sees only their own communities on
Laravel would, on ASP.NET, see and act on **every tenant on the platform**,
impersonation included. Blocked on R-3.

### R-5 `PARTIALLY FIXED` — guardian consent security

**Fixed (this commit):** items 1, 3 and 4 below — cross-tenant token resolution,
the 24-hour expiry, and the minor self-grant. Pinned by
`tests/Nexus.Api.Tests/EventGuardianConsentSecurityTests.cs` (3 tests, including
a deliberate **control case** asserting the legitimate guardian is still accepted).

🔴 **That control case earned its place immediately: it caught the two security
assertions passing vacuously.** The grant endpoint requires an `Idempotency-Key`
header; without one every request is refused as invalid, so both "attack" tests
were green while proving nothing. Any future security test here must assert the
allowed path too.

**Still OPEN:** item 2 (unkeyed blind hash) and R-5e (missing UPDATE trigger).
Note the tenant fix required plumbing the resolved tenant into the anonymous
endpoint — `EventSafetyController` now takes `TenantContext` because the
`Tenant()` helper reads caller claims a guardian does not have.

### R-5 detail (original findings)

All in `Services/EventSafetyService.cs`, all verified:

1. **Cross-tenant token resolution** (`:40`) — `SingleOrDefaultAsync(x =>
   x.TokenHash == hash)` under `IgnoreQueryFilters()` with **no `TenantId`
   predicate**, from an `[AllowAnonymous]` endpoint. Laravel binds twice: the hash
   is an app-key HMAC over `event-safety|{tenantId}|guardian-token|{token}`
   (`app/Support/Events/EventSafetyFoundationSupport.php:180-187`) and the query
   adds `where('tenant_id', …)` (`app/Services/EventGuardianConsentService.php:371,382-385`).
2. **Unkeyed email blind hash** (`:39`, helper at `:55`) — bare `SHA256(email)`
   where Laravel uses a keyed HMAC (`EventGuardianConsentService.php:205-209`).
   Anyone with read access to `event_guardian_consents` can dictionary-confirm
   which guardian email belongs to which minor, defeating the encryption.
3. **24-hour expiry regardless of event date** (`:39`,
   `ExpiresAt = UtcNow.AddDays(1)`) — Laravel reads
   `events.safety.guardian_consent_ttl_days` (default 30) and forces expiry past
   event start + 1 day (`EventGuardianConsentService.php:196-203`). Any event more
   than a day out: consent expires first and the minor is blocked.
4. **A minor can grant their own consent** (`GrantGuardianAsync`, `:40`) —
   Laravel re-checks the minor is active and refuses a self-grant with
   `event_guardian_minor_self_grant_forbidden` (`:389-400`).

Plus **R-5e**: the consent-mutation trigger is missing. Laravel's
`trg_event_guardian_consent_update`
(`database/migrations/2026_07_11_000060_create_event_safety_foundation.php:728-733`)
guards the encrypted identity columns, `token_hash`, `minor_user_id`, `expires_at`
and the pending→active→withdrawn/expired state machine in the database. ASP.NET's
`Migrations/20260713015034_EventSafetyWorkflowParity.cs:344-357` creates only
`..._history_no_update` and `..._consent_no_delete`. Laravel creates 21 triggers
here, ASP.NET 13.

**R-5f (inverted residue).** The status doc used to record "consent-token emails
not delivered". The truth is the opposite and worse: ASP.NET emails the guardian a
link containing the **plaintext token** (`:39`, base URL falling back to
`http://localhost:5173` when `Frontend:BaseUrl` is unset), while Laravel
deliberately never returns or emails it, keeping it in an AES-GCM envelope
(`EventGuardianConsentService.php:48-49,326,352`).

---

### R-16 `FIXED this commit` — members were logged out at every token expiry

`react-frontend/src/lib/api.ts:779` makes its **only** refresh call to
`/auth/refresh-token` — the path Laravel registers (`routes/api.php:3319`).
ASP.NET answered **410 Gone** from `AuthParityController` and pointed at
`/api/auth/refresh`, which no client calls. `api.ts:800` treats any 4xx except
408/429 as "credentials are bad" and deletes the session, so every member got one
short session then a bounce to the login screen, repeatedly, with no explanation.
Fixed by giving the real `AuthController.Refresh` both spellings and deleting the
410 stub outright.

**The follow-on defect this exposed is also `FIXED this commit`.** ASP.NET had no
`AUTH_REFRESH_SUPERSEDED` at all and treated every replay of a rotated token as
theft, revoking the whole family — so two tabs racing (or a queued request and its
retry) logged the member out everywhere. `AuthController.Refresh` now mirrors
Laravel: within a 5-second grace window (`RefreshReuseGraceSeconds`, matching
`TokenService::REFRESH_REUSE_GRACE_SECONDS`), if the token was revoked with reason
`"rotation"` **and** a still-valid successor exists, it returns
**409 `AUTH_REFRESH_SUPERSEDED`** and leaves the family intact; outside the window,
or with no live successor, reuse detection still revokes everything.

Note the approximation, deliberately narrower than it looks: `refresh_tokens` has
no family/parent columns, so "direct successor" is "any still-valid token for the
same user and tenant created at or after this one was rotated". Laravel matches on
`parent_jti_hash`. If family columns are ever added, tighten this.

🔴 **A test was pinning the wrong contract.** `AuthControllerTests`
`Refresh_WithUsedToken_ReturnsUnauthorized` asserted 401 for an *immediate* replay
— i.e. it enshrined the log-everyone-out behaviour. Replaced by
`Refresh_WithTokenRotatedByAConcurrentRequest_ReturnsSupersededAndKeepsTheFamily`
(409 + the successor still works) and
`Refresh_WithTokenReplayedAfterTheGraceWindow_RevokesTheFamily` (401 + family
revoked). Worth remembering when triaging R-1: a green suite can be pinning a
defect.

### R-17 `FIXED this commit` — legal-acceptance lockout with no way out

React calls `GET /v2/legal/acceptance/status` and
`POST /v2/legal/acceptance/accept-all` (`useLegalGate.ts:110,146`), matching
Laravel (`routes/api.php:4011-4012`). ASP.NET registered **only** the non-`v2`
spellings (`ReactFrontendCompatibilityController.cs:1845`,
`CompatibilityAliasController.cs:1621`). The gate enforces by default and
`useLegalGate` treats an absent flag as blocking (`:120`), so a member was blocked
and the only two endpoints that could unblock them were unreachable. Both
handlers now carry the `/api/v2/...` spelling as well.

Also removed in the same commit: three no-op legal endpoints in
`MiscParityController` (`legal/accept`, `legal/accept-all`, `legal/status`) that
persisted nothing, the last of which reported `accepted: true` unconditionally —
a false answer about a compliance record.

### R-18 `OPEN` — legal gate enforces the wrong condition

`LegalAcceptanceGateMiddleware.cs:196-208` blocks on **any** active
`RequiresAcceptance` document with no acceptance row at all. Laravel filters by
`config('legal.enforced_acceptance_modes') = ['registration','login','first_use']`
and classifies `not_accepted | outdated | current` from
`ula.version_id = ld.current_version_id`
(`app/Http/Controllers/Api/LegalAcceptanceController.php:247-251`). Two live
consequences: a document a community deliberately set to `none` still blocks
(over-block), and **a member who accepted v1 of a document now on v3 is not
blocked at all** — the exact compliance case the gate exists for. It propagates
into the status endpoint, where `acceptance_status` can never be `"outdated"`
(`ReactFrontendCompatibilityController.cs:1883-1897`).

Related, same area: acceptance records are written **without** `version_id`,
`version_number` or `acceptance_method`, with no row lock and no re-verification
(`CompatibilityAliasController.cs:1645-1663`) where Laravel does all four inside a
`lockForUpdate` transaction and then invalidates its cached verdict
(`LegalAcceptanceController.php:146-212`). Auditable proof of *what* was accepted
does not survive. Federation partners are also not exempt: Laravel exempts both
`partner` and `federation_partner` request attributes
(`EnsureLegalAcceptance.php:159`); ASP.NET exempts only a `"partner"` role claim
(`LegalAcceptanceGateMiddleware.cs:109`).

**Confirmed correct, do not "fix":** both sides fail **open** on infrastructure
errors (`EnsureLegalAcceptance.php:174-178` vs
`LegalAcceptanceGateMiddleware.cs:146-157`); an unrecognised mode enforces as
`write` on both (`:222,238-256` vs `:44,215-232`); the gated route set is
identical, all fourteen (`GatedTemplates` `:52-68`); and the 403 body
`{errors:[{code:"LEGAL_ACCEPTANCE_REQUIRED",…}], success:false}` with
`API-Version: 2.0` and deliberately no `X-Tenant-ID` is byte-identical.

## P1 — breaks a real workflow

### R-6 `OPEN` — 54 of 71 scheduled units have no counterpart (~24% covered)

Laravel `bootstrap/app.php`: 56 `->command()` + 1 `->job()` + 14 `->call()`
closures = **71**. ASP.NET: 20 hosted jobs in `Services/Scheduled/`
(`Extensions/ServiceExtensions.cs:380-400`) + 3 other workers (`:192`, `:370`,
`:371`). **17 genuinely correspond.**

Compliance / data-loss absences: `retention:enforce`, `backup:verify`,
`gdpr:check-overdue-requests`, `safeguarding:purge-message-copies`,
`safeguarding:review-flags`, `safeguarding:vetting-renewals`,
`safeguarding:clear-expired-monitoring`, `support-actions:expire`,
`groups:prune-exports`, `marketplace:process-unacknowledged-reports` (DSA 24h),
`performance:prune`, `nexus:prune-match-notifications`.

Member-visible: nothing scheduled publishes (feed, group posts, podcasts);
nothing reminds (events, interviews, subscription renewals, trial ends, dues);
nothing expires (event waitlist offers, pending orders, stale offers, promotions);
`marketplace:complete-orders` absent ⇒ **sellers are never paid out**;
`emails:resend-stuck-activations` absent ⇒ members who never got an activation
email stay locked out.

Operational blindness: `slo:check`, `monitoring:alarm-selftest`,
`email:health-alert`, `queue:verify-liveness` (+ heartbeat closure),
`horizon:snapshot`, `stripe:check-stuck-webhooks`, `backup:verify`.

Also: `safeguarding:sla-escalate` runs **hourly** in ASP.NET
(`ScheduledJobs.cs:239`) vs **every 15 minutes** in Laravel — escalation is 4×
slower. And the closure `nexus:run-all` (`bootstrap/app.php:32`, every minute)
drives an entire second scheduler tier with no ASP.NET counterpart at all.

### R-7 `OPEN` — Meilisearch never indexes incrementally

`Services/MeilisearchService.cs`: `IndexDocumentAsync` (`:146`),
`IndexDocumentsAsync` (`:168`), `DeleteDocumentAsync` (`:190`) have **no callers**
outside the service. The only writer is `ReindexTenantAsync`, reachable solely
from manual admin endpoints (`AdminSearchController.cs:64,83`). New and edited
content never reaches the index; deleted items stay findable.

### R-8 `OPEN` — carer cluster gaps

- `GET /v2/users/me/sub-accounts/{childId}/activity` is a stub
  (`UsersParityController.cs:510`): no relationship lookup, no `activity ≥ assist`
  check, no 403 for a caller with no relationship, always an empty array, plus an
  extra top-level `sub_account_id` key Laravel never sends. (Also counted in R-1.)
- The `onboarding-required` gate is missing from all four proxy write paths.
  Laravel: `routes/api.php:882,883,898,903`. ASP.NET's
  `Middleware/OnboardingRequiredMiddleware.cs` path table does not list them, so a
  carer who has not completed onboarding can create listings, transfer credits and
  prepare support actions. (Legal acceptance IS covered —
  `LegalAcceptanceGateMiddleware.cs:58-61`.)
- `message_view_last_at` does not exist anywhere in the ASP.NET source. Laravel
  enriches every parent-account row whose `message_access === 'active'` with the
  supporter's last read from the immutable audit
  (`app/Http/Controllers/Api/SubAccountController.php:50-55`). The member-facing
  "when did my supporter last read my messages" signal silently disappears.
- **Undeclared parallel API:** `Controllers/SubAccountsController.cs:19`
  (`api/sub-accounts`, nine actions incl. `pool-transfer`) is backed by a separate
  `SubAccount` entity and has **no Laravel counterpart** — it moves credits through
  a route the Laravel contract does not define. `NEEDS-DECISION`: delete, or
  document as an intentional extension.
- `CompatibilityAliasController.cs:2850,2861` map `can_view_messages` onto
  `subAccount.CanMessage`, a permission Laravel hard-kills at every layer.
  Currently unreachable (no call sites) — a loaded gun if re-wired.
- **Not audited:** `acting_user_id` + `org_audit_log` side-effect parity in
  `SubAccountProxyService.cs`. Treat as open.

### R-9 `OPEN` — impersonation legacy route is a different endpoint

`/v2/admin/users/{id}/impersonate`:

- Laravel mints a single-use 5-minute **proof** (`AdminUsersController.php:1479` →
  `TokenService.php:794-803`); ASP.NET returns `_tokenService.GenerateJwt(user)` —
  an ordinary immediately-usable access token
  (`AdminCompatibilityController.cs:768`) that bypasses the exchange's spend-time
  re-checks entirely.
- Gated `PlatformSuperAdminOnly` (`:743-747`) where Laravel uses
  `tenant-super-admin` (`routes/api.php:3229-3231`) — reinstating exactly the bug
  Laravel fixed on 2026-08-05, so a community super-admin gets 403 for every target.
- Inactive target: Laravel returns **200 with `gate_warning`/`gate_code`**
  (`AdminUsersController.php:1508-1511`); ASP.NET returns **409** (`:764-766`).
- Self-target ordering differs: Laravel 422 before the tier check (`:1460-1465`),
  ASP.NET 403 first (`:757-762`).

The super mint route also admits callers Laravel refuses: Laravel's `super-panel`
gate requires `master`, or `regional` = super-admin of a tenant **that has
children** (`EnsureSuperPanelAccess.php:14-45,66-80`); ASP.NET admits any
`IsTenantSuperAdmin` unconditionally (`AdminSuperImpersonationController.cs:59-65`).
Smaller: the exchange compares the proof's tenant to the raw `X-Tenant-ID`
**header** and skips the check when absent (`ImpersonationController.cs:84-88`)
where Laravel compares the **resolved** `TenantContext::getId()`
(`AuthController.php:798-805`); and `user_name`/`admin_name` fall back to the
**email address** (`:135,138`) where Laravel emits an empty string
(`AuthController.php:865,868`).

The `/v2/auth/impersonate/exchange` + `/end` pair itself held up under attack:
paths, TTLs (300s/900s), full key set, no refresh token, and every exchange
rejection code/status matched.

### R-10 `OPEN` — FCM push targets a decommissioned endpoint

`Services/PushNotificationService.cs:558-570` uses the FCM **legacy** HTTP API
(`https://fcm.googleapis.com/fcm/send`), retired by Google. Treat as
implemented-but-non-functional until moved to FCM HTTP v1. Related: Pusher is real
(`PusherEventPublisher.cs:23,57`) but logs unconfigured credentials and send
failures at **Debug** and returns silently (`:52,:79,:83`) — realtime can be
entirely dead with nothing visible. Raise those to `Warning`/`Error`.

---

### R-19 `OPEN` — auth security boundary is materially weaker

- **No per-account lockout.** Laravel records failed attempts per **email** and
  per **IP** (`app/Http/Controllers/Api/AuthController.php:221-225`) and returns
  `api.too_many_attempts` (`:566`). ASP.NET has only a per-IP limiter
  (`[EnableRateLimiting(AuthPolicy)]`); zero lockout/failed-attempt counters exist
  (`Controllers/AuthController.cs:82-167`). Distributed credential stuffing
  against one account is unthrottled.
- **Mandatory 2FA for admins is missing.** Laravel returns
  `{requires_2fa_setup:true, two_factor_token, code:'AUTH_2FA_SETUP_REQUIRED'}`
  (`AuthController.php:270-274`) and the client honours it
  (`AuthContext.tsx:346-359`). `AUTH_2FA_SETUP_REQUIRED` has **0 hits** in ASP.NET,
  so an admin with 2FA off logs straight in.
- **Login failure envelope has no `success` and no `code`**
  (`AuthController.cs:119,139,146,152,158,166` return bare `{error:"..."}`), so the
  client's `AUTH_ACCOUNT_PENDING_APPROVAL` / `AUTH_PENDING_VERIFICATION` branches
  (`AuthContext.tsx:317-320`) never fire and a pending-approval member sees a
  generic "login failed".
- **More no-op stubs in the auth surface:** `revoke`, `revoke-all`
  (`AuthParityController.cs:99-105`), `refresh-session` (`:81-83`), and the OAuth
  link/unlink/identities trio (`:157-199`) all report success while persisting
  nothing. Laravel backs the OAuth ones with a real `SocialAuthController`
  (`routes/api.php:3441-3445`).

**Confirmed correct:** login success shape key-for-key; the TOTP challenge flow;
refresh rotation and reuse detection are real; password reset is single-use,
revokes refresh tokens, and does a HIBP k-anonymity check
(`AuthController.cs:806-895`); both sides are enumeration-safe on forgot-password;
the passkey challenge store is single-use and time-bounded
(`PasskeyChallengeStore.cs:48-54`). `AuthParityController` does **not** shadow the
real `AuthController` — no verb+path collisions.

### R-20 `OPEN` — passkeys cannot work on a community's own domain

Laravel derives the WebAuthn relying-party ID **per request** from the `Origin`
header validated against that tenant's registered domains, stores it **per
credential**, and filters on it at authentication time
(`app/Http/Controllers/Api/WebAuthnController.php:1533-1536, 129, 400, 521, 92-93,
761-762`). ASP.NET registers Fido2 **once at DI** with a single static
`options.ServerDomain` (`Extensions/ServiceExtensions.cs:118-125`; production
`"project-nexus.net"` with a 3-entry origin allowlist,
`appsettings.Production.json:18-21`) and has no per-credential `rp_id` column.
WebAuthn requires the RP ID to be a registrable suffix of the page's domain, so
the browser refuses the ceremony for any member on a tenant custom domain or
`*.timebank.global` before a request is even sent.

### R-21 `OPEN` — small-batch groups: two total stubs and a credits-ledger bug

- **Performance summary is a complete stub** — every value literal,
  `recording_enabled` hardcoded `false`, `retention_days` hardcoded `14`, no
  database read (`AdminPerformanceSummaryController.cs:71-86`) against eight real
  queries in `app/Services/PerformanceInsightsService.php:39-57`. Mitigating: it
  is a *declared* stub — `recording_enabled:false` is a real contract field the
  page renders honestly, and the eight `data` keys match exactly. But
  `recording_enabled` can never become true: there is no config path
  (`:82`), so an operator who enables recording gets no change and no error.
- **Federation external-status is a complete stub** — every switch literal
  `false`, seven literal protocol flags, empty `blocked_last_24h`
  (`AdminSuperOpsController.cs:112-133`). Plausibly accurate today (external
  federation is off) but it can never report otherwise. Laravel's counterpart
  shape was NOT verified.
- **`/v2/federation/status` returns a different object** — 5 of Laravel's 6 keys
  missing; only `enabled` overlaps by name (`FederationV2Controller.php:471-477`
  vs `ReactFrontendCompatibilityController.cs:206-215`). Worse, `enabled` ignores
  the platform and tenant federation gates (`:208` reads `settings.FederationOptIn`
  alone) where Laravel ANDs three conditions (`:411-415,472`) — so a member whose
  community has federation switched off still reads `enabled:true` and is offered
  federated actions the platform disabled.
- **5 of 8 admin badge counters are hardcoded `0`** — `fraud_alerts`,
  `gdpr_requests`, `404_errors`, `pending_exchanges`, `unreviewed_messages`
  (`AdminBadgeCountsController.cs:78-83`) against five real queries in
  `app/Services/AdminBadgeCountService.php:127,140,153,172,185`. This is precisely
  the regression the Laravel endpoint was built to fix. Also `pending_listings`
  undercounts: Laravel counts `status='pending' OR NULL OR ''` (`:97-104`), ASP.NET
  only `Status == Pending`.
- **Attendance-claims ledger ignores `from`/`to`** — Laravel validates and applies
  both (`AdminEventAttendanceRewardController.php:136-137,162-167`); ASP.NET
  declares neither (`AdminEventAttendanceRewardsController.cs:104-109`), so an
  admin narrowing a **credits** ledger to a date range silently gets the
  unfiltered list.
- **Public events pagination is dead** — Laravel forwards `?cursor=` and emits
  `meta.cursor` (`EventPublicController.php:67-69,80-86`); ASP.NET declares no
  cursor and never emits one (`PublicEventsController.cs:37-42,73-81`), so paging
  re-requests page 1 forever.
- **Challenge type is silently rewritten on save** — `PresentType()` collapses
  Individual/Team/Community to `"special"`
  (`AdminGamificationChallengesController.cs:246-253`) and `Update` persists it
  (`:137-139`), destroying the original type when an admin edits any unrelated
  field.
- **Missing rate limits** on anonymous and credit-minting endpoints: public events
  60/60 (`EventPublicController.php:44,94`), attendance claims/retry/reverse
  (`AdminEventAttendanceRewardController.php:130,243,265`), platform-capability
  writes 20/60 (`PlatformCapabilityController.php:39`), and **all twelve** partner
  venue endpoints including pass rotation and a 20,000-row member-name CSV export
  (`PartnerVenueController.php:46-91`, `AdminPartnerVenueController.php:44-174`).
- **Two incompatible auth-error envelopes** ship side by side:
  `{errors:[{code,message}], success:false}` in
  `AdminGamificationChallengesController.cs:304-308` and
  `AdminBadgeCountsController.cs:44-48`, versus
  `{success:false, error, code:"AUTH_REQUIRED"}` in
  `AdminPerformanceSummaryController.cs:43-44`, `AdminSuperOpsController.cs:143-144`
  and `AdminEventAttendanceRewardsController.cs:239-240`. At most one is parity.
- **`reverseClaim` is not tenant-scoped by argument** — Laravel passes the tenant
  id explicitly (`AdminEventAttendanceRewardController.php:271-276`); ASP.NET looks
  the claim up by id alone (`Services/EventCreditService.cs:117-122`) and relies on
  the global query filter, which is written `!IsTenantResolved || e.TenantId == …`
  (`NexusDbContext.cs:864-866`) and therefore **fails open** when tenant resolution
  fails.

### R-22 `OPEN` — partner venues

- **QR points at the wrong host.** Laravel builds the member pass from the
  tenant's *frontend* URL (`app/Services/PartnerVenueVisitService.php:112-117`);
  ASP.NET builds it from `tenant.Domain` and, when blank, falls back to **the API's
  own host** (`Controllers/PartnerVenuesController.cs:178-189`), so any slug-served
  tenant gets a QR resolving to `api.…` and a scan lands nowhere.
- **`member` can be `null`** in the record-visit payload
  (`Services/PartnerVenueVisitService.cs:265`) where Laravel always returns an
  object (`:365-379`); `react-frontend/src/pages/venues/VenueVisitVerifyPage.tsx`
  faults on the null.
- Numeric type errors produce ASP.NET's default **400 ProblemDetails** instead of
  Laravel's 422 (`AdminPartnerVenuesController.cs:52-53`); empty strings are
  accepted by Laravel and 422'd by ASP.NET (`:313,337`); CSV headers and all
  feature-disabled/not-found messages are hardcoded English where Laravel
  translates them.
- **Confirmed:** all twelve handlers do real work (no stubs), and paths, verbs,
  the 201-on-create, tenant-scope-as-404, idempotent delete and the
  `already_recorded_today` branch all match.

## P2 — contract divergence

### R-11 `OPEN` — message voice/attachment routes absent (downgraded)

Laravel `routes/api.php:586-587` serve
`GET /v2/messages/{message}/attachments/{attachment}` and
`GET /v2/messages/{message}/voice` (`MessageMediaController`). ASP.NET has no
counterpart; `MessageAttachmentsController.cs` is a different feature (list `:29`,
attach `:68`, remove `:105`).

**Downgraded from BREAKS-CLIENT on 2026-08-15.** ASP.NET stores voice as
`FileUpload` + `MessageAttachment` and returns
`AudioUrl = /api/files/{id}/download`; `web-uk` renders whatever `audio_url` the
payload carries (`src/routes/messages.js:391`) and React has no hardcoded
`GET /messages/{id}/voice`. So the clients follow the server-supplied URL and
playback plausibly works. Still a contract divergence, and any consumer that
hardcodes Laravel's path breaks. Needs runtime proof either way.

Laravel's private-media response headers to match when implementing:
`Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`,
`X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none';
sandbox`, `Cross-Origin-Resource-Policy: same-site`
(`MessageMediaController.php:70-80`), plus participant authorisation that also
accepts a `conversation_participants` row (`:56-63`).

### R-12 `OPEN` — remaining unmatched routes

From the regenerated comparison (8 total, 2,659 matched):
`GET /api/messages/{message}/attachments/{attachment}` and `.../voice` (R-11);
`POST /api/csp-report`; `POST /api/events/{id}/attendance/code`;
`POST /api/events/{id}/registration-product/guests/{guestid}/attendance/{action}`
(React calls it at `react-frontend/src/lib/event-registration-api.ts:477`; ASP.NET
`EventRegistrationProductController.cs:160` constrains the action to
`^(check_in|check_out|no_show|undo)$` — **compare the Laravel vocabulary**);
`POST /api/admin/broker/exchanges/{id}/resolve-dispute` and `.../reverse`
(genuinely absent, but **not called** by `react-frontend/src/broker/`);
`POST /api/admin/users/{id}/reject`.

### R-13 `OPEN` — expired support actions are silent

ASP.NET enforces expiry at read/execute time
(`SupportPendingActionService.cs:177,204,291`) so an expired request is inert. But
Laravel's daily `support-actions:expire` (`bootstrap/app.php:57`,
`app/Console/Commands/ExpireSupportActions.php`) exists so "the supporter is
notified — an expiry is never silent". No ASP.NET job. (Subset of R-6.)

### R-14 `OPEN` — 188 Laravel tables have no trace in ASP.NET

Of 219 unmatched Laravel tables, 31 are referenced somewhere in ASP.NET source;
**188 appear nowhere in `src/Nexus.Api/**/*.cs`**. Not concentrated in one
excludable module — advertising (4), AI/agent (9), partner API/OAuth (4),
challenge depth (5), billing/community funds (4) account for only ~27.
**Needs table-by-table triage** into "same thing renamed" / "Laravel-only, never
needed" / "genuinely missing". Regenerate with
`scripts/compare-laravel-schema-parity.ps1`.

### R-15 `OPEN` — 5,424 missing translation keys

11/11 locales present; 374 missing namespaces; 5,424 missing keys; 2,949 extra.
Regenerate with `scripts/compare-laravel-localization-parity.ps1`. Mechanical but
large.

---

## P3 — client-contract notes worth keeping

- `adminApi.ts:2665` `getFederationStatus` (`/v2/admin/super/federation`) has **no
  callers** — dead client method.
- `FederationTenantFeatures.tsx:100` casts through `unknown` to read a nested
  `data.features.*` shape contradicting its declared type at `adminApi.ts:2709` —
  a live mismatch against Laravel too.
- Super audit endpoints return a **bare array with no total**; `SuperAuditLog.tsx`
  and `FederationAuditLog.tsx` synthesise pagination from page length. Any ASP.NET
  implementation must return the same bare-array shape.
- Regional-analytics endpoints omit the `/v2` prefix used by every other super
  path; ASP.NET registers **both** forms
  (`RegionalAnalyticsSuperAdminController.cs:23,38-175`), so this matches — **do
  not "fix"**.
- `ProvisioningRequestsPage.tsx:99` builds its query by concatenation without
  encoding the filter value.

---

## Cleared — checked and found correct, do NOT re-raise

- Regional analytics without `/v2` (both forms registered — above).
- Super-admin provisioning requests: `routes/api.php:3196-3200` vs
  `AdminProvisioningController.cs:118-173`.
- Broker `archives`: present at `AdminCompatibility2Controller.cs:599`.
- Broker `resolve-dispute` / `reverse`: genuinely absent but never called by the
  broker app (`react-frontend/src/broker/`), so not client-breaking.
- Super-admin **route existence**: every endpoint in the React super-panel client
  inventory resolves to an ASP.NET route (shapes and authorisation are separate —
  R-1, R-4).
- Carer **tier engine core**: ordering `none<assist<co_decide<represent`, the
  `messages`→`assist` ceiling, the `co_decide` staff cap, drop-not-clamp in both
  `Resolve` and `Sanitize`, `can_view_messages` hard-false, and the deliberate
  non-enforcement of `can_view_messages` — all faithful ports.
- Support-authority attestation append-only triggers, authority/revocation/vetting
  vocabularies, and before/after recording — identical both sides.
- Impersonation exchange/end pair — see R-9.

---

## Owner-gated — cannot be closed by an agent

- **The live ASP.NET database has had no successful backup since 2026-03-08** (156
  consecutive failures) while the app runs `Database.MigrateAsync()` on every
  start. Nothing may touch that service until this is fixed.
- **No designed deployment path.** The former deployment was declared dead
  2026-08-10; how this backend ships is undesigned work.
- **Live Stripe keys and any go-live decision.**
- Fixed-rubric **scoring transactions** (this backlog banks no points).

---

## Fixed since the audit opened

| Item | Fix | Commit |
| --- | --- | --- |
| No throttle on support-action answers (incl. the anonymous emailed token confirm authorising a credit transfer) | `isSupportActionAnswerPath` in `RateLimitingMiddleware.cs`, limit 10/min matching Laravel `nexus-route-10-per-1m` | `9c54ef501` |
| `SupportTiers.AtLeast` failed **open** on an unrecognised capability or tier | validates both inputs, returns false — matches `SupportTiers.php:216-226` | `9c54ef501` |
| Three webhooks returned 200 and destroyed the event | `WebhookNotProcessed` → 501 + `Error` log; event survives in the sender's retry queue | `3cf796e50` |
| Guardian consent token resolved against every community | tenant predicate + `TenantContext` plumbed into the anonymous grant | this commit |
| Guardian consent expired 24h after request, before the event | `GuardianConsentExpiry()` — config TTL (default 30d), forced past event start + 1d | this commit |
| A minor could grant their own guardian consent | self-grant refused + minor-still-active check | this commit |
| `/auth/refresh-token` answered 410, logging every member out at first token expiry | real `AuthController.Refresh` now owns both spellings; 410 stub deleted | this commit |
| Legal gate lockout — the two endpoints that clear it were unregistered at `/v2` | `/api/v2/legal/acceptance/{status,accept-all}` aliases added | this commit |
| Three no-op legal endpoints, one reporting `accepted:true` unconditionally | deleted from `MiscParityController` | this commit |

## Suggested order of work

1. **R-2 completion** (real webhook processing at Laravel's `/api/v2/webhooks/stripe`).
2. **R-1 triage** — until the stub count is known-and-shrinking, no other number
   about this backend can be trusted. Make it a CI ratchet.
3. **R-3 → R-4** (tenant hierarchy, then subtree confinement).
4. **R-5** guardian consent security.
5. **R-6** scheduled jobs, compliance cluster first.
6. Then R-7, R-8, R-9, R-10, and the P2 list.

**Runtime proof runs alongside from R-1 onward:** point `react-frontend` at ASP.NET
and drive real journeys. It is the only thing that catches a stub the detector
misses.
