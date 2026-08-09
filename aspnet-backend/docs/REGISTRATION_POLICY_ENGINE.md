# Registration Policy Engine — Architecture & Integration Guide

Last reviewed: 2026-07-14

Status: **Maintained reference — component architecture and integration guide**

> **Scope:** This is a component guide, not the repository's global product
> architecture or a completion claim. Laravel remains the contract source; use
> `CURRENT_ASPNET_CONTRACT_STATUS.md` and `API_PARITY.md` for current parity and
> certification status. “Frontend” diagrams below describe contract consumers,
> not a shared implementation. The in-repo React copy was deleted 2026-08-09.

## Overview

The Registration Policy Engine provides tenant-configurable identity-aware registration with pluggable verification providers. Each tenant independently chooses its registration method, verification requirements, and post-registration behavior.

## Architecture

```
                     ┌─────────────────────────┐
                     │  Frontend (React/GOV.UK) │
                     └──────────┬──────────────┘
                                │
            GET /api/registration/config (public)
            POST /api/auth/register
            POST /api/registration/verify/start
            GET  /api/registration/verify/status
                                │
                     ┌──────────▼──────────────┐
                     │     AuthController       │
                     │ RegistrationPolicy Ctrl  │
                     └──────────┬──────────────┘
                                │
                     ┌──────────▼──────────────┐
                     │ RegistrationOrchestrator │ ← State machine driver
                     └──────────┬──────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
    ┌─────────▼──────┐ ┌───────▼────────┐ ┌────────▼───────┐
    │  Mock Provider  │ │ Stripe Identity │ │ EUDI/Gov (fut) │
    │ (development)   │ │ (production)    │ │ (placeholder)  │
    └────────────────┘ └────────────────┘ └────────────────┘
```

> **Provider scope (2026-07-03):** .NET now has adapters for Mock, Stripe
> Identity, Veriff, Onfido, Jumio, and iDenfy behind
> `IIdentityVerificationProvider`. The non-Stripe adapters cover local session
> shape, HMAC webhook verification, and Laravel-compatible webhook status
> normalization. The React admin compatibility layer now exposes the Laravel
> provider-list and registration-policy read/write payload shapes, stores
> encrypted tenant provider credentials in `tenant_provider_credentials`, and
> resolves those credentials when verification starts or webhooks are processed.
> End-to-end sandbox/live HTTP contract checks, browser-level admin workflow
> coverage, and full provider webhook parity remain open.

## User Registration State Machine

```
                      ┌─────────────────┐
                      │ POST /register  │
                      └────────┬────────┘
                               │
                  ┌────────────┴────────────┐
                  │ Read TenantPolicy.Mode  │
                  └────┬─────┬────┬────┬────┘
                       │     │    │    │
            Standard   │     │    │    │ InviteOnly
           ┌───────────┘     │    │    └──────────┐
           │                 │    │               │
           ▼                 │    │               ▼
      ┌─────────┐            │    │         ┌──────────┐
      │ Active  │            │    │         │ Active   │
      └─────────┘            │    │         └──────────┘
                             │    │
              WithApproval   │    │ VerifiedIdentity/GovernmentId
              ┌──────────────┘    └──────────────┐
              │                                   │
              ▼                                   ▼
      ┌───────────────────┐             ┌────────────────────┐
      │ PendingAdminReview│             │ PendingVerification│
      └────────┬──────────┘             └─────────┬──────────┘
               │                                  │
        ┌──────┴──────┐              POST /verify/start
        │             │                           │
    Approve       Reject              ┌───────────▼──────────┐
        │             │               │ Provider Session     │
        ▼             ▼               │ (redirect/SDK/poll)  │
   ┌─────────┐  ┌──────────┐         └───────────┬──────────┘
   │ Active  │  │ Rejected │                      │
   └─────────┘  └──────────┘             Webhook / poll
                                                  │
                                    ┌─────────────┴──────────────┐
                                    │                            │
                              Approved                      Failed
                                    │                            │
                         ┌──────────┴──────────┐        ┌───────▼──────────┐
                         │PostVerificationAction│        │VerificationFailed│
                         └──────┬───┬───┬──────┘        └──────────────────┘
                                │   │   │
                 AutoActivate   │   │   │ AdminApproval
                     ┌──────────┘   │   └──────────────┐
                     │              │                   │
                     ▼        LimitedAccess             ▼
                ┌─────────┐        │         ┌───────────────────┐
                │ Active  │        ▼         │ PendingAdminReview│
                └─────────┘  ┌──────────┐    └───────────────────┘
                             │ Limited  │
                             │ Access   │
                             └──────────┘
```

## API Reference

### Public Endpoints (Anonymous / Authenticated)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/registration/config?tenant_slug=X` | No | Get tenant's public registration config |
| POST | `/api/registration/verify/start` | Yes | Start identity verification session |
| GET | `/api/registration/verify/status` | Yes | Get current verification status |
| POST | `/api/registration/webhook/{tenantId}?provider=X` | No | Provider webhook callback |

### Admin Endpoints (Requires `admin` role)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/registration/admin/policy` | Get full registration policy |
| PUT | `/api/registration/admin/policy` | Update registration policy |
| GET | `/api/registration/admin/pending` | List users pending approval |
| PUT | `/api/registration/admin/users/{id}/approve` | Approve user registration |
| PUT | `/api/registration/admin/users/{id}/reject` | Reject user registration |
| GET | `/api/registration/admin/options` | List available modes/providers/levels |

### Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| POST | `/api/auth/register` | Now returns `registration_status`, conditional tokens |

## Database Entities

### tenant_registration_policies
One active policy per tenant. Stores registration mode, fallback mode, email
verification requirement, provider config, verification level, and post-action
behavior.

### tenant_provider_credentials
Stores encrypted per-tenant, per-provider API credentials using Laravel provider
slugs such as `stripe_identity`, `veriff`, `onfido`, `jumio`, and `idenfy`.
`RegistrationOrchestrator` resolves this store before falling back to the legacy
policy-level provider config blob.

### identity_verification_sessions
Tracks verification sessions between users and providers. Stores status, external IDs, and sanitized decisions. **No raw PII or provider payloads stored.**

### identity_verification_events
Audit trail for every state change in a verification session. Provides complete traceability.

### users (modified)
Added `registration_status` column (`VARCHAR(30)`, default `Active`).

## Frontend Integration Guide

### Registration Flow (Both Frontends)

1. **Before showing registration form**, call `GET /api/registration/config?tenant_slug=X`
2. Based on response:
   - `mode = "Standard"` → show normal form
   - `mode = "StandardWithApproval"` → show form + "Your account will be reviewed" message
   - `mode = "VerifiedIdentity"` → show form + "Identity verification required" message
   - `mode = "GovernmentId"` → show form + gov ID instructions
   - `mode = "InviteOnly"` → show form with invite code field (or hide form + show "registration closed")
3. **Submit** `POST /api/auth/register` with optional `invite_code`
4. Check `registration_status` in response:
   - `"Active"` → use tokens, redirect to dashboard
   - `"PendingAdminReview"` → show "awaiting approval" screen (no tokens)
   - `"PendingVerification"` → use tokens, redirect to verification flow
5. **For verification**: call `POST /api/registration/verify/start`, use `redirect_url` or `sdk_token`
6. **Poll** `GET /api/registration/verify/status` for completion

### Admin Settings UI

Call `GET /api/registration/admin/options` to populate dropdowns with available modes, providers, and levels.

The settings form should:
1. Show a "Registration Method" dropdown (Standard, Standard + Approval, Verified Identity, Government ID, Invite Only)
2. Conditionally show provider/level dropdowns when "Verified Identity" is selected
3. Show invite code field when "Invite Only" is selected
4. Show a registration message textarea for all modes
5. Submit via `PUT /api/registration/admin/policy`

### Admin Approval Queue

Call `GET /api/registration/admin/pending` to show a table of users awaiting approval. Each row has Approve/Reject buttons calling the respective admin endpoints.

## Provider Adapter Pattern

All providers implement `IIdentityVerificationProvider`:

```csharp
public interface IIdentityVerificationProvider
{
    VerificationProvider ProviderType { get; }
    string DisplayName { get; }
    Task<VerificationSessionResult> CreateSessionAsync(...);
    Task<VerificationStatusResult> GetSessionStatusAsync(...);
    Task<VerificationStatusResult?> ProcessWebhookAsync(...);
    bool VerifyWebhookSignature(...);
}
```

Providers support three integration patterns:
- **Redirect**: User is sent to provider's hosted page (`RedirectUrl`)
- **SDK**: Frontend embeds provider's SDK using `SdkToken`
- **Webhook**: Provider calls back to `/api/registration/webhook/{tenantId}?provider=X`

## Production Notes

- The `users.registration_status` column defaults to `Active`, so existing users
  are unaffected when a tenant has no `TenantRegistrationPolicy` row.
- Tenants with no policy fall through to Standard behavior.
- The `/api/auth/register` response contract is additive (`registration_status`
  field, conditional tokens) — no breaking changes.
- Provider API keys are stored encrypted via `ProviderConfigEncryption.cs`
  (see `src/Nexus.Api/Services/Registration/`).
- Webhook signature verification is required for Stripe Identity and the
  non-Stripe adapters registered behind `IIdentityVerificationProvider`.
- The webhook endpoint is rate-limited; no raw provider payloads are persisted.

## Future Work

- EUDI wallet / verifiable-credential support when standards stabilize.
- Re-verification flow for expired/revoked verifications.
