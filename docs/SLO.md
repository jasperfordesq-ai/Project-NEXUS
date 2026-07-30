# Service Level Objectives

Last reviewed: 2026-07-30

Project NEXUS starts with a small set of SLOs that can be measured and acted on. A few watched signals are better than a large dashboard nobody trusts.

## SLO 1: Exchange Completion

| Item | Value |
| --- | --- |
| User journey | Completing an exchange and applying the time-credit result. |
| Target | At least 99.5% success over a rolling 28 days. |
| Failure signal | Terminal exchanges that end in `disputed` rather than `completed`. |
| Wired command | `php artisan slo:check` |

The command measures `completed / (completed + disputed)` over the configured window. It exits non-zero and alerts through log, Sentry, and optional Slack when the target is breached and the sample size is large enough.

Useful options:

```bash
php artisan slo:check --days=28 --target=99.5 --min-sample=20
php artisan slo:check --tenant=2
```

Regression coverage lives in `tests/Laravel/Feature/Console/SloCheckTest.php`.

## SLO 2: Login Availability

| Item | Value |
| --- | --- |
| User journey | Valid login attempts. |
| Target | At least 99.5% non-5xx success and p95 latency below 1000 ms over 28 days. |
| Failure signal | Server-side login errors and high latency, excluding wrong-password 401s. |
| Primary source | Sentry transaction metrics for `POST /api/auth/login` (the login route is not under the `v2` namespace — `routes/api.php:3040`). |

`login_attempts` can provide supporting context, but the authoritative login SLO belongs in Sentry because application data cannot reliably distinguish all user mistakes from system failures.

## Alert Self-Test

Run this to prove the log/Sentry path is alive without creating a real incident:

```bash
php artisan monitoring:alarm-selftest --quiet-slack
```

If Slack alerting is configured and you want to include it:

```bash
php artisan monitoring:alarm-selftest
```

## Error Budget

At 99.5% over 28 days, each SLO has roughly 3.4 hours of monthly error budget. If a deploy burns a meaningful part of that budget, stabilize before shipping more feature work.

## Candidate Next SLOs

- Direct wallet transfer success.
- Registration through email verification.
- Stripe webhook freshness.
- Overall uptime from external health checks.
