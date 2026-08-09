# Security And Tenancy Architecture

Last reviewed: 2026-07-15

Status: **Maintained system reference - not a security certification**

## Core Boundaries

- Laravel remains the contract source, including authentication, roles,
  tenancy, validation, and error behavior.
- ASP.NET uses JWT bearer authentication and resolves tenant context after
  authentication.
- Tenant-aware EF query filters and tenant-composite relationships are defense
  layers, not permission to omit explicit tenant checks in high-risk workflows.
- Tenant administrator, tenant super-administrator, and platform
  super-administrator are distinct authorities.
- Partner/federation credentials are not ordinary member tokens and are
  constrained to their dedicated surfaces.

## Request Pipeline

The current API pipeline establishes correlation, exception handling, security
headers, CORS, authentication, partner-token boundaries, authorization,
feature/onboarding/rate-limit middleware, privacy/lockdown guards, federation,
tenant resolution, and identity-enriched logging before controller execution.
Middleware order is contract-sensitive and must be covered when changed.

## Authentication And Account Security

The API supports access/refresh tokens, tenant-aware sign-in, TOTP/backup-code
two-factor challenges, and WebAuthn/passkeys. Current 2FA and WebAuthn challenge
stores are process-local, so distributed challenge continuity remains an open
production-readiness gap. Never log or persist raw bearer tokens, passkey
challenges, provider secrets, or backup codes.

## Browser And Service Security

- Production CORS uses an explicit origin allow-list.
- FIDO2 RP ID and origins must match the deployed HTTPS domains.
- Rate limits protect authentication and selected high-risk actions; they do
  not replace authorization.
- Security headers and production-safe exception responses are middleware
  responsibilities.
- Uploads require type/size/ownership/tenant validation and durable storage
  appropriate to the workflow.
- User-authored rich content must pass the endpoint's Laravel-compatible
  sanitization contract.

## Privacy And Logging

The API adds request correlation and tenant/user log context. Production error
tracking must avoid default PII. The surname-privacy response layer, recipient-
locale behavior, GDPR workflows, safeguarding evidence, and provider audit data
are contract areas that need endpoint-specific tests; their presence is not a
global guarantee.

## Known Evidence Limits

The canonical score retains open security/localization and unchanged-client
deductions. Full suite, exact-SHA CI, provider, browser, and production evidence
also remain open. Consult
[CURRENT_ASPNET_CONTRACT_STATUS.md](../CURRENT_ASPNET_CONTRACT_STATUS.md) rather
than inferring readiness from this architecture summary.

Report vulnerabilities through [SECURITY.md](../../SECURITY.md). Do not test a
suspected issue against another tenant or a production system without explicit
authorization.
