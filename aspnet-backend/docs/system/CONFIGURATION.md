# Configuration And Secrets

Last reviewed: 2026-07-15

Status: **Maintained system reference - values must be verified per environment**

ASP.NET Core loads `appsettings.json`, the environment-specific appsettings
file, and environment variables. Environment variables use double underscores
for nested keys, for example `Cors__AllowedOrigins__0` maps to
`Cors:AllowedOrigins:0`.

## Core Configuration

| Purpose | Key or environment mapping | Notes |
| --- | --- | --- |
| PostgreSQL | `ConnectionStrings__DefaultConnection` | Required in Production; use a dedicated database and real password. |
| JWT signing | `Jwt__Secret` | Root Compose maps local `JWT_SECRET` into this key. Production guard enforces non-placeholder length >=16; use at least 32 random bytes. |
| JWT metadata | `Jwt__Issuer`, `Jwt__Audience`, `Jwt__AccessTokenExpiryMinutes` | Issuer and audience are required by production policy. The current startup guard does not enforce them, and empty values disable those validation checks; treat that as an open guard gap. |
| Browser origins | `Cors__AllowedOrigins__0...N` | Production origins must be explicit HTTPS origins with contiguous indexes. |
| Passkeys | `Fido2__ServerDomain`, `Fido2__ServerName`, `Fido2__Origins__0...N` | RP ID and origins must match the deployed domains. |
| Message broker | `RabbitMq__Host`, `Port`, `Username`, `Password`, `VirtualHost`, `ExchangeName`, `Enabled` | The current binder does not use a single `RabbitMq__Uri` key and exposes no TLS option. Keep it disabled unless a verified private plaintext port-5672 path is explicitly accepted; port 5671 is not supported by the current publisher. |
| Uploads | `FileUpload__UploadsRoot` | Persist and permission the path for the runtime user. |
| Error/trace export | `Sentry__*`, `Otel__Endpoint` | Sentry is optional; do not send default PII. |
| Search | `Meilisearch__Enabled`, `Meilisearch__BaseUrl`, `Meilisearch__ApiKey` | Use `BaseUrl`, not the obsolete `Host` example. |
| Email/providers | Provider-specific sections such as `SendGrid__*`, `Gmail__*`, `Stripe__*` | Enabling a provider requires its complete current section and webhook verification. |

`ProductionSecretGuard` fails Production startup for an invalid JWT secret or
connection string and for configured-but-incomplete Stripe/SendGrid sections.
It warns when Sentry is disabled. That guard is a minimum check, not proof that
provider, CORS, WebAuthn, storage, backup, or observability configuration is
correct.

## Example Files

- `.env.example` is for local root Compose only.
- `.env.production.example` is a key-name reference, not a deployment recipe
  and not a file automatically loaded by every Compose command. Its canonical
  required application keys are `Jwt__Secret` and the complete
  `ConnectionStrings__DefaultConnection`. Short `JWT_SECRET` is retained only
  in a separately labelled legacy root-Compose section; no short
  `POSTGRES_PASSWORD` key is advertised because the current root Compose file
  hard-codes development database values and is not a production authority.
- `appsettings.Production.json` contains placeholders and must never be treated
  as deployable configuration.
- Real `.env`, connection strings, API keys, tokens, signing material, and
  provider credentials must remain outside Git.

Always compare an example key with the current options binding or consuming
service before relying on it. Optional feature sections evolve independently;
an environment template can lag code.

## Frontend Boundaries

- The canonical React client lives in the Laravel repository; its environment
  contract must not be weakened for ASP.NET.
- Web UK uses `ACCESSIBLE_BACKEND_TARGET` plus target-specific base URLs. Laravel
  is the current source; `aspnet` remains uncertified.
- Web UK Production requires distinct explicit cookie/session secrets and a
  persistent Redis session URL.
- The standalone admin's root Compose service receives its API URL from the
  root stack; its independent Compose file is not currently a supported path.

## Verification

Before a release candidate, record the exact source SHA and redacted set of
configuration keys (never values), run the Production secret guard through a
non-production candidate, and verify health, CORS, WebAuthn origins, storage,
provider callbacks, and session persistence appropriate to the component.
