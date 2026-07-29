# Federation API — Instruction Manual

Last reviewed: 2026-07-29

This guide explains how Project NEXUS connects a tenant to another timebank. It
is for tenant administrators, platform operators, and integration developers.
The registered routes in `routes/api.php` and the authorization code named
below remain the source of truth.

## Current status — every external protocol is switched OFF

**Read this before following any endpoint example in this manual.**

All external partner federation protocols are **built and complete, but disabled
platform-wide**. They were built ahead of demand deliberately: no external
partner is connected in production yet. While they are disabled, every external
endpoint described below answers **HTTP 503 with a `Retry-After` header**, whatever
credentials you present. That is the kill switch, not a fault, and not a sign your
credentials are wrong.

| Protocol | Route family | Status |
| --- | --- | --- |
| Native V1 partner API | `/api/v1/federation/*` | Built — **disabled** |
| Native V2 ingest | `/api/v2/federation/ingest/*` | Built — **disabled** |
| Komunitin | `/api/v2/federation/komunitin/*` | Built — **disabled** |
| Credit Commons | `/api/v2/federation/cc/*` | Built — **disabled** |
| External webhook receiver | `POST /api/v2/federation/external/webhooks/receive` | Built — **disabled** |
| Cross-node aggregates | `GET /api/v2/federation/aggregates` | Built — **disabled** |
| Inbound hour transfer | `POST /api/v2/federation/hour-transfer/inbound` | Built — **disabled** |
| Partner API (AG60) | `/api/partner/v1/*` | Built — **disabled** (separate switch) |

Two things this table does *not* cover, deliberately:

- **Federation between communities inside one installation is unaffected** and
  keeps working. The switch governs traffic with *other installations* only. The
  member-facing `/api/v2/federation/*` routes are internal and stay available.
- The Partner API has its **own** switch, independent of the federation one.
  Turning external federation on does not turn the Partner API on, or vice versa.

Each protocol is re-enabled individually in **Super Admin → Federation**, as its
security review passes. Expect to request that a protocol be enabled as part of
onboarding rather than assuming it is live.

## Plain-English model

Federation is an explicitly controlled bridge between otherwise separate
timebanks. Depending on the switches enabled on both sides, the bridge can make
selected members, listings, events, groups, reviews, messages, volunteering
opportunities, connections, or time-credit transactions available to a partner.

The controls are layered:

1. The tenant must have the `federation` feature.
2. Platform-wide and operation-specific controls in
   `federation_system_control` must permit the action.
3. When whitelist mode is active, the tenant must appear in
   `federation_tenant_whitelist`.
4. The resource switch in `federation_tenant_features` must be enabled.
5. The partnership and external-partner record must be active and its relevant
   `allow_*` permission must be enabled.
6. Member consent and resource visibility rules still apply.

Turning on one layer never bypasses the remaining layers. Operators can close
the bridge globally, for one tenant, for one partner, or for one data family.

### API keys and webhooks

An API key authenticates a partner making a request. Treat it like a password:
store it in a secret manager, transmit it only over TLS, rotate it, and revoke it
if exposed. NEXUS stores inbound keys as SHA-256 hashes and shows a newly issued
plaintext key only once.

A webhook is a signed, unsolicited notification sent to a partner when an event
occurs. It complements an API request; it does not replace authentication,
authorization, idempotency, or a reconciliation process. Whether a particular
external protocol uses callbacks, polling, or protocol-native requests depends
on that partner's contract. Do not assume every connector requires the same
webhook fields.

### Administrative surfaces

- External partners: `/partner-timebanks/external-partners`, backed by
  `/api/v2/admin/federation/external-partners/*`.
- Inbound API keys: `/partner-timebanks/api-keys`, backed by
  `/api/v2/admin/federation/api-keys/*`.
- Federation controls and diagnostics use the remaining
  `/api/v2/admin/federation/*` routes.

These controllers enforce their current admin or super-admin authorization.
External credentials are encrypted with Laravel `Crypt`; inbound key material
is never stored in plaintext.

### Safe onboarding

1. Confirm the other operator, protocol, base URL, and data-sharing purpose.
2. Create the external partner and leave it inactive while configuring it.
3. Exchange credentials over a separate secure channel. Bind the inbound NEXUS
   API key to the corresponding `external_partner_id`.
4. Grant only the scopes and per-partner `allow_*` switches required.
5. Run the connector health or handshake test and test an idempotent,
   non-financial operation.
6. Activate the partner, then enable data families incrementally. Enable value
   movement only after operational and reconciliation checks pass.
7. Monitor delivery logs, retries, reconciliation, and circuit-breaker state.

Suspending or revoking a partner must be treated as an operational incident:
preserve audit evidence, reconcile in-flight transfers, rotate credentials, and
verify that retries cannot resume unauthorized delivery.

## API families

NEXUS exposes several distinct surfaces. Do not mix their authentication or
response contracts.

### Read this first: inside versus outside, and which way data flows

The route names are easy to misread, so start here.

**There are only two questions that matter about any federation surface:**

1. **Is it for people already inside this installation, or for another
   installation?** One surface is internal; every other one is external.
2. **Which way does the data move — do they read from us, or push to us?**

That second question is the real difference between the two NEXUS-native
surfaces, and no route name mentions it:

| Surface | Inside or outside? | Direction |
| --- | --- | --- |
| `/api/v2/federation/*` (member routes) | **Inside.** Your own logged-in members. | n/a — your own users |
| `/api/v1/federation/*` | Outside | **They read from us** |
| `/api/v2/federation/ingest/*` | Outside | **They push to us** |
| `/api/v2/federation/komunitin/*` | Outside | Both |
| `/api/v2/federation/cc/*` | Outside | Both |
| `POST /api/v2/federation/external/webhooks/receive` | Outside | They notify us |
| `POST /api/v2/federation/hour-transfer/inbound` | Outside | Hours arrive |
| `GET /api/v2/federation/aggregates` | Outside | They read totals |
| `/api/partner/v1/*` | Outside | They read from us |

Three naming traps, all of which have caused real confusion:

- **`/api/v2/federation/*` holds both.** The member routes and several external
  protocols share that prefix, so the path alone never tells you which side of
  the wall a route is on. Only `ingest/`, `komunitin/`, `cc/`, `external/`,
  `hour-transfer/` and `aggregates` under it are external.
- **`v1` did not become `v2`.** They are different audiences, not successive
  versions. `/api/v1/federation/*` is current and has no replacement; it is the
  only surface offering partner reads in NEXUS's own format.
- **"NEXUS native" does not mean internal.** It means *talking to a different
  NEXUS installation* — the most external thing here. The product name inside a
  protocol name reads as "ours, internal", and it is the opposite.

Communities that share **one** installation — including sub-communities and
anything in the Partner Timebanks panel — federate through the internal member
routes. They are never affected by the external kill switch.

| Surface | Route family | Audience and contract |
| --- | --- | --- |
| Member federation UI/API | `/api/v2/federation/*` | Authenticated NEXUS users: status, consent, partners, federated resources, settings, connections, messages, and transactions. |
| Native V1 partner API | `/api/v1/federation/*` | The only partner-facing **read** API in NEXUS's own native format, plus a few writes. Not superseded: the v2 families below serve different jobs. The index, health, OAuth token and webhook-test endpoints sit outside the federation authenticator — the token endpoint necessarily so, since it exchanges client credentials for a token — and the data methods call the controller's federation authentication. |
| Komunitin | `/api/v2/federation/komunitin/*` | Protocol-native JSON:API accounting resources. Reads and writes. |
| Credit Commons | `/api/v2/federation/cc/*` | Credit Commons accounts, entries, and transaction lifecycle. Reads and writes. |
| Native V2 ingest | `/api/v2/federation/ingest/*` | Versioned partner **pushes** for reviews, listings, events, groups, connections, volunteering, and member sync. Inbound only — this surface never serves partner reads, which is what the V1 partner API above is for. Referred to as "NEXUS native" in Super Admin; it means traffic with *another NEXUS installation*, not anything internal. |
| External webhook receiver | `POST /api/v2/federation/external/webhooks/receive` | HMAC-authenticated events from configured external partners. |

The Komunitin, Credit Commons, and native V2 ingest routes use the
`federation.api` middleware and a route-level 200 requests/minute throttle.
Native V1 writes use a 20 requests/minute route throttle; the OAuth token route
uses 10 requests/minute. These route limits are additional to credential-level
limits.

## Inbound authentication and authorization

`App\Core\FederationApiMiddleware` supports three credential forms:

- Bearer API key: the presented value is hashed and matched to an active,
  unexpired `federation_api_keys` row.
- HMAC-SHA256: the signature covers method, path, timestamp, nonce, and body.
  A five-minute timestamp tolerance and cached nonce prevent replay.
- Short-lived JWT/OAuth client credentials: the token remains tied to an active
  federation key and its granted scopes.

`App\Http\Middleware\FederationApiAuth` then:

1. derives the tenant from the authenticated key;
2. rejects an explicit tenant header or pre-resolved tenant that disagrees;
3. binds `TenantContext` to that tenant; and
4. derives the required scopes from the protocol route and HTTP method.

The supported issuance allowlist is:
`members:read`, `members:write`, `transactions:read`,
`transactions:write`, `ingest:write`, and `admin`. Privileged write,
ingest, and admin scopes require platform-super-admin authority at issuance.
The native V1 controller also has older resource-specific permissions; verify
the target controller when maintaining that compatibility surface.

### Trusted partner identity for native ingest

Native V2 ingest never trusts a client-supplied partner identifier. The
effective external partner, including every `allow_*` permission, comes from
the authenticated key's `external_partner_id` (with the authenticated
platform identifier used only as the compatibility fallback). An unlinked key
does not inherit another partner's permissions: its partner permissions fail
closed.

This is a critical security boundary. Do not restore identity selection through
`X-Federation-Partner-ID`, request JSON, or another caller-controlled value.
See `FederationNativeIngestController` and the 2026-07-10 key-binding
migration.

### Credential-level rate limiting

Federation keys have an hourly `rate_limit`; a missing value defaults to 1000
requests/hour. Responses expose `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, and `X-RateLimit-Reset`; an overrun returns 429.
Callers must also honor `Retry-After` and the route-level limits above.

## Member consent and tenant isolation

Member choices live in `federation_user_settings`, keyed by `user_id`.
That table intentionally has no `tenant_id` column, so
`FederationUserService` first proves that the user belongs to the active
tenant before reading or writing it. New code must use that service rather than
query the table by an untrusted user ID.

Settings separately cover federation opt-in, profile visibility, messaging,
transactions, search discovery, skills, location, reviews, and email
notifications. Opt-out disables sharing and dispatches data-retraction work for
previously shared records. Consent does not override tenant, partner, resource,
or safeguarding policy.

Protocol authentication also binds the tenant from the credential. Every
partner read, write, ingest, and reconciliation path must preserve that binding.

## Outbound delivery

The authoritative domain-event wiring is
`app/Providers/EventServiceProvider.php`. Current federation listeners cover
listings, transactions, messages, reviews, accepted connections, groups and
group membership/retractions, volunteering, member-profile changes, and member
opt-out retraction.

Event federation uses its dedicated transactional outbox and delivery ledger;
do not infer event delivery from the presence of an unused listener class.
Outbound adapters are resolved by
`FederationExternalApiClient` for `nexus`, `komunitin`,
`timeoverflow`, or `credit_commons`. Retry and circuit-breaker behavior is
partner-aware, but callers must still reconcile outcomes rather than assume
that an HTTP timeout means failure.

Inbound handlers must validate signatures, tenant and partner state, feature
permissions, schema/version rules, resource ownership, replay/idempotency keys,
and safeguarding restrictions before mutation.

## Transactions and reputation

Federated value movement is not an eventual best-effort notification. Preserve
the protocol's proposal/validation/commit or equivalent state machine,
idempotency keys, immutable ledger evidence, and reconciliation records. Never
retry a value-moving request without its original idempotency identity.

Portable reputation is represented through federated review fields on
`reviews`, including receiver-tenant, review-type, federation, and
cross-tenant visibility metadata. `MemberRankingService` includes eligible
portable reviews while preserving tenant and visibility policy. Do not write
federated reputation to the obsolete `exchange_ratings.is_federated`
contract.

## Operations and testing

Before activating or changing a partner:

- verify TLS, credential expiry, scopes, external-partner binding, and allow
  flags;
- test replay rejection, tenant mismatch, inactive-partner rejection, and
  rate-limit behavior;
- test duplicate delivery and timeout reconciliation for all writes;
- confirm opt-out/retraction and suspension behavior; and
- review logs without exposing keys, HMAC secrets, private payloads, or member
  data.

Focused regression coverage includes:

- `tests/Laravel/Feature/FederationProtocolEndpointsTest.php`
- `tests/Laravel/Unit/Middleware/FederationApiAuthTest.php`
- `tests/Laravel/Feature/Controllers/FederationNativeIngestControllerTest.php`
- `tests/Laravel/Feature/Federation/FederationPartnershipPermissionsTest.php`
- `tests/Laravel/Feature/FederationTenantIsolationTest.php`

Run focused tests first, then the Laravel suites:

```bash
vendor/bin/phpunit tests/Laravel/Feature/FederationProtocolEndpointsTest.php
vendor/bin/phpunit tests/Laravel/Unit/Middleware/FederationApiAuthTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/FederationNativeIngestControllerTest.php
vendor/bin/phpunit --testsuite=Laravel,LaravelMigrated
```

## Source map

- `routes/api.php` — registered partner, protocol, ingest, member, and admin routes.
- `app/Core/FederationApiMiddleware.php` — API-key, HMAC, JWT, replay, and rate-limit checks.
- `app/Http/Middleware/FederationApiAuth.php` — tenant binding and route-scope enforcement.
- `app/Http/Controllers/Api/FederationNativeIngestController.php` — trusted partner binding and native ingest.
- `app/Services/FederationFeatureService.php` — layered platform, tenant, and resource gates.
- `app/Services/FederationUserService.php` — tenant-safe member consent.
- `app/Services/FederationExternalApiClient.php` — outbound protocol adapters.
- `app/Providers/EventServiceProvider.php` — active event/listener wiring.

Document version: 1.2.
