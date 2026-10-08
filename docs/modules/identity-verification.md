# Identity Verification Module

Audience: maintainers and contributors working on document/selfie identity verification, the "ID Verified" trust badge, the per-member verification fee, or tenant registration policies that gate sign-up on identity.

Last reviewed: 2026-07-14

> Compliance note: this module handles government ID documents and biometric (selfie) data through third-party providers. Read the [Privacy and data handling](#privacy-and-data-handling) section before changing any code that stores, logs, or exports verification data.

## Two distinct flows

Project NEXUS verifies identity in two separate places. They share the provider layer, the `identity_verification_sessions` table, the audit log, and the badge-grant helper, but they are entered differently and gated differently.

| Flow | Who | Entry point | Gate | Outcome |
|------|-----|-------------|------|---------|
| **Optional / voluntary** | Already-active members who want a trust badge | `/verify-identity-optional` (`VerifyIdentityOptionalPage`) | `identity_verification` feature flag (default ON) | Grants the `id_verified` badge |
| **Registration-gated** | New sign-ups, when the tenant's registration policy requires it | `/verify-identity` (`VerifyIdentityPage`) | Tenant registration policy (`verified_identity` / `government_id` mode) | Activates / approves / limits the new account |

This guide focuses primarily on the **optional** flow (the common case and the one tied to the `identity_verification` feature flag). The registration-gated flow is summarised in [Registration-gated verification](#registration-gated-verification).

## Feature gate (`identity_verification`)

The optional flow is gated by the per-tenant `identity_verification` feature flag. The platform default is **ON** (`app/Services/TenantFeatureConfig.php` — `'identity_verification' => true`). Admins toggle it in Module Configuration.

When a tenant turns the flag **off**:

- The React route is blocked — `react-frontend/src/routes/AppRoutes.tsx` wraps both `/verify-identity-optional` and `/verify-identity/callback` in `<FeatureGate feature="identity_verification" redirect="/dashboard">`.
- The nav entry points are removed — `Navbar.tsx` and `MobileDrawer.tsx` only render the "Verify identity" item when `hasFeature('identity_verification')` is true.
- The backend rejects new/in-progress verification — `OptionalIdentityVerificationController::guardFeatureEnabled()` returns a 403 (`FEATURE_DISABLED`) from `saveDob`, `createPaymentIntent`, and `startVerification`.
- **`GET /v2/identity/status` is deliberately left ungated** so existing "ID Verified" badges keep rendering after a tenant disables new verification. Read-only status stays available; only starting/progressing a verification is blocked.

## The "ID Verified" badge — what actually drives the green tag

The green "Verified" / "ID Verified" tag keys on the **`id_verified` member badge**, granted by `MemberVerificationBadgeService`. It is **not** the same as `users.is_verified` (which tracks email verification). Do not conflate the two:

- `id_verified` badge → granted only after a document/selfie identity check passes **and** the verified name/DOB match the profile.
- email/`is_verified` → set when the email is confirmed: the member uses their verification link, completes a password reset (reset links are only ever emailed), or an administrator vouches for the address (creating the account with an administrator-set password, a CSV import, or "Mark as confirmed"). All of it goes through `App\Services\Auth\EmailConfirmationService`. Unrelated to ID verification, and confirming an email never releases an identity-check hold.

The badge is granted by `OptionalIdentityVerificationController::grantIdVerifiedBadge()`, which calls `MemberVerificationBadgeService::grantBadge($userId, 'id_verified', ...)`. The grant is idempotent — every code path checks for an existing badge first.

## Optional verification flow (start → provider → badge)

```
DOB collection → Payment (if fee > 0) → Stripe Identity session → result → id_verified badge
```

1. **Status** — the page loads `GET /v2/identity/status`, which reports `has_id_verified_badge`, `user_has_dob`, `fee_cents`/`fee_currency`, `payment_completed`, and the latest session status.
2. **Date of birth** — `POST /v2/identity/save-dob` saves `users.date_of_birth`. Validated server-side: required, a past date, and the user must be **at least 16**. DOB is **locked once the badge is granted** (returns 403 `dob_locked`). DOB is later compared against the document's verified DOB.
3. **Payment** — `POST /v2/identity/create-payment` creates a Stripe `PaymentIntent` for the verification fee (default €5.00 / 500 cents; see [The verification fee](#the-verification-fee)). Skipped entirely when the fee is 0 or already paid.
4. **Start** — `POST /v2/identity/start` requires DOB and (if fee > 0) completed payment, then creates a Stripe Identity session via `StripeIdentityProvider::createSession()` and records a row in `identity_verification_sessions`. Returns a `redirect_url`/`client_token` for the user to complete the document + selfie check with Stripe.
5. **Result** — Stripe reports the outcome by webhook (preferred), in-app poll on status fetch, or the stuck-session cron (see [Result reconciliation](#result-reconciliation)). On a real pass, the badge is granted and pass/fail emails are dispatched.

The provider for the optional flow is fixed to `stripe_identity`. Other registered providers (`veriff`, `jumio`, `onfido`, `idenfy`, `mock`) are available to the registration-gated flow via the tenant's registration policy.

### Name / DOB match gate (critical invariant)

A document that Stripe reports as "verified" is **not sufficient** to grant the badge. The verified name and DOB returned by the provider (`verified_outputs`) must match the user's profile. `OptionalIdentityVerificationController::checkNameDobMismatch()` is the **single source of truth** for this gate and is applied identically by all three result paths (webhook, in-app poll, stuck-session cron). A mismatch downgrades a "passed" result to **failed** before any badge is granted, so the three paths cannot drift. Never bypass this check when adding a new result path.

## The verification fee

Handled by `IdentityVerificationPaymentService`:

- **Amount** — `getFeeCents($tenantId)` reads the `identity_verification_fee_cents` tenant setting (default `500`). Super-admins can set it to `0` for free verification via `PUT /v2/admin/super/identity/fee`.
- **Currency** — Stripe PaymentIntent creation uses the tenant's configured currency (`TenantContext::getCurrency()`), but the current status and create-payment response payloads hardcode `fee_currency = eur`. This is a known contract mismatch for non-EUR tenants; clients must not assume the displayed response currency matches the charge until the response is wired to the tenant currency.
- **Pay-once rule** — once a user has any session with `payment_status = 'completed'` for the tenant, retries after a failed verification **skip payment**. Enforced by `IdentityVerificationSessionService::hasCompletedPaymentForTenant()`.
- **Idempotency** — `createPaymentIntent()` uses a stable Stripe idempotency key (`identity-{tenantId}-{userId}`) so a client retry cannot double-charge.
- **Webhooks** — `handlePaymentSucceeded()` / `handlePaymentFailed()` update the session's `payment_status` and email the user. They early-return unless the PaymentIntent metadata `nexus_type === 'identity_verification'`, so they never touch unrelated payments.

## Providers

Providers implement `IdentityVerificationProviderInterface` and self-register in `IdentityProviderRegistry` by slug: `stripe_identity`, `veriff`, `jumio`, `onfido`, `idenfy`, and a dev-only `mock` (never registered in production). The interface abstracts hosted-redirect, embedded-SDK, webhook, and polling flows so the orchestration and controller code stay provider-agnostic.

Per-tenant provider credentials are managed by `TenantProviderCredentialService` and the admin endpoints under `/v2/admin/identity/provider-credentials`. Registration-policy provider config is encrypted at rest (AES-256-GCM, key derived from `APP_KEY`) by `RegistrationPolicyService::encryptConfig()`.

## Result reconciliation

Stripe Identity webhooks are not fully reliable, so three independent paths converge on the same status transitions and side effects (all gated by the name/DOB match):

| Path | Trigger | Code |
|------|---------|------|
| **Webhook** | Provider posts to `POST /v2/webhooks/identity/{provider_slug}` (public, signature-verified, rate-limited) | `IdentityWebhookController::handleWebhook()` → `RegistrationOrchestrationService::handleVerificationResult()` |
| **In-app poll** | User revisits the verification page; `getStatus` polls Stripe for any active session | `OptionalIdentityVerificationController::getStatus()` |
| **Stuck-session cron** | Hourly `nexus:identity:poll-stuck` for sessions untouched for N minutes (default 5), created within 7 days | `App\Console\Commands\PollStuckIdentityVerifications` (scheduled in `bootstrap/app.php`) |

The webhook handler verifies the provider signature and is idempotent against duplicate terminal events. Accepted/matched events, unknown session identifiers, and payloads without a provider session id are acknowledged with 200. Rate-limit, unknown-provider, invalid-signature/payload, and provider-processing failures can instead return 429, 404, 403/400, or 500 respectively.

## Tenant scoping

Every session and event row carries `tenant_id`. User-facing and listing queries filter by it; a few internal lookups instead key on globally-unique identifiers — the primary key (`getById`), the Stripe PaymentIntent id (`findByPaymentIntentId`), and the provider session id (`findByProviderSession`) — and resolve the tenant from the returned row (the webhook path supplies the tenant separately). The `identity_verification_sessions` table has FKs to both `tenants` and `users` with `ON DELETE CASCADE`. Email and notification rendering for results wraps the recipient in `LocaleContext::withLocale()` and pins `TenantContext` to the session's tenant before sending, so outcome emails render in the recipient's language and the correct tenant's branding/URLs.

## Privacy and data handling

This is the compliance-sensitive part of the module.

- **Data minimisation at the provider.** `StripeIdentityProvider::createSession()` does **not** pre-send the user's name/DOB to Stripe (only email is passed in `provided_details`). The document name/DOB are retrieved from `verified_outputs` **after** the check completes, solely to run the profile-match gate. This minimisation applies to the **identity-check session**; the separate **fee** path (`IdentityVerificationPaymentService::createPaymentIntent`) does create a Stripe Customer with the user's name + email.
- **Normalized results are plaintext JSON — not encrypted.** Current completion paths write the provider's normalized result (decision, risk score, checks, failure reason — **not** verified name/DOB or document images) to `identity_verification_sessions.result_summary` and to event `details`. Although the sessions table also has a `metadata` column, the current create paths leave it null rather than duplicating the result there. Treat encryption at rest as a known follow-up. The raw ID document and selfie remain with the provider and are never stored in the NEXUS database. (By contrast, registration-policy provider *credentials* are AES-256-GCM encrypted — see [Providers](#providers).)
- **Audit trail.** `identity_verification_events` records every state transition (`registration_started` … `verification_passed/failed`, `admin_approved/rejected`, `account_activated`, etc.) with actor type/id, IP, and user agent. Audit logging is best-effort and never breaks the main flow.
- **Retention.** `IdentityVerificationSessionService::purgeOldSessions()` deletes terminal sessions (`passed`/`failed`/`expired`/`cancelled`) older than the retention period (default 180 days). `expireAbandoned()` expires created/started sessions older than a threshold (default 72h). The `identity_verification_events` audit trail is retained even when session rows are purged (the event FK is `ON DELETE SET NULL`).
- **GDPR.** Account deletion removes the user's `identity_verification_sessions` rows (`GdprService`, scoped by `user_id` + `tenant_id`). The Article 15 data export returns only non-sensitive session metadata (id, provider slug, level, status, failure reason, timestamps) — never document images or biometric data.
- **Webhook security.** The provider webhook signature is verified before any payload is processed; failures are logged and rejected with 403.

## Admin / manual review (registration-gated flow)

When a tenant's registration policy uses a post-verification action of `admin_approval`, or a verification fails into a manual-review fallback, admins act on it via:

- `GET /v2/admin/identity/sessions` — pending/active sessions
- `POST /v2/admin/identity/sessions/{id}/approve` and `/reject` → `RegistrationOrchestrationService::adminReview()`
- `GET /v2/admin/identity/audit-log` — the event audit trail
- `GET /v2/admin/identity/provider-health`, `/providers`, `/provider-credentials` — provider configuration and health

## Registration-gated verification

Driven by `tenant_registration_policies` via `RegistrationPolicyService` and `RegistrationOrchestrationService`. Registration modes include `open`, `open_with_approval`, `verified_identity`, `government_id`, `invite_only`, and `waitlist`; verification levels are `none`, `document_only`, `document_selfie`, `reusable_digital_id`, `manual_review`; post-verification actions are `activate`, `admin_approval`, `limited_access`, `reject_on_fail`. When no policy row exists, the service falls back to the legacy `registration_mode` / `admin_approval` / `email_verification` tenant settings. The React entry point is `/verify-identity`, which polls `GET /v2/auth/verification-status`.

## Key code, routes, and tables

- **Routes** — see `routes/api.php`: optional flow `/v2/identity/*` (`status`, `start`, `save-dob`, `create-payment`); webhook `/v2/webhooks/identity/{provider_slug}`; registration status `/v2/auth/verification-status`; admin `/v2/admin/identity/*` and `/v2/admin/super/identity/fee`. Prefer the live route file and OpenAPI over copying endpoint tables.
- **Controllers** — `OptionalIdentityVerificationController`, `IdentityWebhookController`, `IdentityProviderHealthController`, `RegistrationPolicyController`.
- **Services** (`app/Services/Identity/`) — `IdentityVerificationSessionService`, `IdentityVerificationEventService`, `IdentityVerificationPaymentService`, `IdentityProviderRegistry`, `IdentityVerificationProviderInterface`, the provider adapters, `RegistrationPolicyService`, `RegistrationOrchestrationService`, `TenantProviderCredentialService`. Plus `MemberVerificationBadgeService` for the badge.
- **Tables** — `identity_verification_sessions`, `identity_verification_events`, `tenant_registration_policies`; the `identity_verification_fee_cents` tenant setting; the `id_verified` badge in `member_verification_badges`.
- **Frontend** — `react-frontend/src/pages/settings/VerifyIdentityOptionalPage.tsx` (optional), `react-frontend/src/pages/auth/VerifyIdentityPage.tsx` (registration), plus the native app modal `mobile/app/(modals)/verify-identity.tsx`.

## Failure modes and recovery

| Failure | Behaviour | Recovery |
|---------|-----------|----------|
| User pays then closes the tab; webhook never arrives | Session stuck in `created`/`started`/`processing` | Hourly `nexus:identity:poll-stuck` cron polls Stripe and applies the result; the in-app poll also recovers it on the user's next visit |
| Document passes but name/DOB ≠ profile | Result downgraded to `failed` with a "details don't match your profile" reason; no badge | User corrects their profile and retries; payment is skipped (pay-once rule) |
| Webhook signature invalid | 403, payload not processed, warning logged | Re-check provider webhook secret in `TenantProviderCredentialService` / provider dashboard |
| Provider not configured for tenant | `start` returns 503 (`SERVICE_UNAVAILABLE`) | Configure credentials via `/v2/admin/identity/provider-credentials` |
| Feature flag turned off | New verification blocked (403 `FEATURE_DISABLED`); existing badges still render | Re-enable `identity_verification` in Module Configuration |
| Stripe payment status not yet synced | `getStatus` retrieves the PaymentIntent directly and reconciles `payment_status` | Automatic; webhook also reconciles |

## Tests

```bash
# PHP — run from repo root
vendor/bin/phpunit --testsuite=Laravel --filter=Identity
```

Key regression tests:

- `tests/Laravel/Feature/Controllers/OptionalIdentityVerificationControllerTest.php` — DOB validation, fee/payment gating, feature-flag guard, badge grant.
- `tests/Laravel/Feature/Controllers/IdentityWebhookControllerTest.php` — signature verification, idempotency, name/DOB mismatch downgrade, badge grant.
- `tests/Laravel/Unit/Services/IdentityVerificationPaymentServiceTest.php` — fee resolution, pay-once rule, idempotency key.
- `tests/Laravel/Unit/Services/Identity/IdentityVerificationSessionServiceTest.php`, `IdentityVerificationEventServiceTest.php`, `StripeIdentityProviderTest.php`, `IdentityProviderRegistryTest.php`.

React tests live alongside the pages: `react-frontend/src/pages/settings/VerifyIdentityOptionalPage.test.tsx` and `react-frontend/src/pages/auth/VerifyIdentityPage.test.tsx`.
