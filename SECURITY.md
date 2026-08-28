# Security Policy

Project NEXUS is an AGPL-3.0-or-later, multi-tenant community platform. Security reports are welcome and should be handled privately until a fix is available.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| `main` / v1.6.2 (Generally Available) | Yes |
| Older releases | No |

Security fixes are developed against `main` unless a published release explicitly says otherwise.

## Reporting a Vulnerability

Please report suspected vulnerabilities through GitHub's private vulnerability reporting flow for this repository:

<https://github.com/jasperfordesq-ai/Project-NEXUS/security/advisories/new>

If GitHub is unavailable, contact the maintainer through the public Project NEXUS contact channel and mark the message as security-sensitive. Do not open a public issue for an unpatched vulnerability.

Include as much of the following as you can:

- Affected route, feature, tenant context, or package.
- Reproduction steps or a proof of concept.
- Expected impact, including whether tenant isolation, authentication, payments, messaging, uploads, or personal data are involved.
- Relevant request IDs, timestamps, browser details, logs, or screenshots.

## Response Expectations

- Initial triage target: 3 business days.
- Confirmed high-impact issues are prioritized ahead of normal feature work.
- Public disclosure happens after a fix is available, affected deployments have had reasonable time to update, and any required advisory notes are prepared.

## Safe Research Rules

Please avoid actions that could harm real users or tenants:

- Do not access, modify, delete, or exfiltrate data that is not yours.
- Do not run destructive tests, denial-of-service tests, spam, or broad automated scanning against production.
- Do not bypass rate limits beyond what is necessary to demonstrate the issue.
- Stop testing and report promptly if you encounter personal data, secrets, credentials, or cross-tenant data exposure.

## Scope

In scope:

- Authentication and session handling.
- Tenant isolation and authorization boundaries.
- API input validation and file upload handling.
- Payment, wallet, and time-credit flows.
- Messaging, notifications, WebAuthn/passkeys, and federation APIs.
- Build, dependency, container, and deployment security.

Out of scope:

- Social engineering.
- Physical attacks.
- Vulnerabilities in third-party services unless Project NEXUS configuration or integration makes them exploitable.
- Reports that require already-compromised maintainer credentials without a separate Project NEXUS weakness.
