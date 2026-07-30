# Sentry Error Tracking

Last reviewed: 2026-07-30

Project NEXUS uses Sentry for backend exceptions, frontend exceptions, performance traces, and selected operational alerts.

## Backend

Backend Sentry configuration lives in:

- `config/sentry.php`
- `config/services.php`
- `bootstrap/app.php`
- `app/Providers/AppServiceProvider.php`

The canonical backend DSN variable is:

```env
SENTRY_DSN_PHP=
```

Fallback variables are supported for compatibility:

```env
SENTRY_LARAVEL_DSN=
SENTRY_DSN=
```

Useful backend options:

```env
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=
SENTRY_SAMPLE_RATE=1.0
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=
SENTRY_SEND_DEFAULT_PII=false
```

When `BUILD_COMMIT` is present, backend events can be tied to the deployed commit. Keep DSNs and webhook URLs in environment files or production secret stores, never in committed documentation.

## Frontend

React Sentry integration lives in `react-frontend/src/lib/sentry.ts`. It is **not** initialized from `main.tsx`. The only production call site is `react-frontend/src/contexts/CookieConsentContext.tsx:296`, which lazily imports the module and calls `initSentryAfterIdle()` from a delayed-idle callback. That effect is gated on analytics consent **and** `!isAuthEntryPath(location.pathname)`, so Sentry also never initializes while the user is on a login/register entry path — it must not compete with auth startup.

`main.tsx` only queues breadcrumbs through `@/lib/telemetryQueue` (line 71) and lazily imports `captureSentryException` inside its error boundary (line 133).

Frontend variables are Vite variables:

```env
VITE_SENTRY_DSN=
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE=0
```

Frontend Sentry only initializes when a DSN is present and the user has granted analytics consent. Without consent or without a DSN, the exported helpers are safe no-ops.

## Privacy Defaults

- `send_default_pii` is disabled.
- SQL bindings are disabled by default.
- Frontend request data is scrubbed for sensitive fields before sending.
- User context should use stable IDs, not email addresses or names.
- Session replay is disabled unless explicitly configured.

## Operational Alerts

Several console commands can emit log, Sentry, and optional Slack alerts:

```bash
php artisan monitoring:alarm-selftest --quiet-slack
php artisan slo:check
php artisan backup:verify
php artisan stripe:check-stuck-webhooks
php artisan gdpr:check-overdue-requests
```

`monitoring:alarm-selftest` is the safest manual end-to-end check because it sends a benign heartbeat through the same alert legs without creating a real incident.

## Verification

1. Confirm the relevant DSN is set in the runtime environment.
2. Confirm `SENTRY_ENVIRONMENT` matches the environment.
3. Run `php artisan monitoring:alarm-selftest --quiet-slack` in the target environment.
4. Confirm the heartbeat appears in Sentry with the expected environment and release/build tags.
5. For frontend verification, grant analytics consent in the browser and confirm frontend errors are reported with `platform=react`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No backend events | DSN value, `config:cache`, outbound network access, environment name. |
| No frontend events | `VITE_SENTRY_DSN` at build time, analytics consent, whether the session stayed on a login/register entry path (init is suppressed there), browser console errors. |
| Too much noise | Ignore known non-bugs in code, lower trace sampling, avoid reporting validation errors. |
| PII in events | Update backend `before_send` or frontend `beforeSend` scrubbers immediately. |

## References

- `config/sentry.php`
- `config/services.php`
- `react-frontend/src/lib/sentry.ts`
- `app/Console/Commands/AlarmSelftest.php`
- `app/Console/Commands/SloCheck.php`
