# Project NEXUS Greptile Review Rules

Review for production-impacting issues first: tenant isolation, security, data integrity, localization, accessibility, and regressions in user workflows. Prefer a small number of high-signal comments over broad style commentary.

## Repository Rules

- Treat `AGENTS.md` as the project-wide source of truth.
- Project NEXUS is public AGPL-3.0-or-later software. New PHP, TypeScript, TSX, and Blade source files need the project SPDX header.
- Never suggest or assume production deployment, SSH deploy steps, or backup-remote pushes unless the human explicitly asks for them.
- Do not propose changes under legacy `views/` except the documented live exceptions.

## Backend

- Tenant-owned data must be tenant-scoped. Flag queries or service calls that can cross tenant boundaries by accident.
- SQL must be parameterized. Never interpolate user input into SQL.
- Notification and email rendering must use translation keys and the recipient's preferred language through `LocaleContext::withLocale`.
- User-facing strings belong in `lang/` files, not inline PHP.
- Project NEXUS is global. Do not add Irish-only phone, address, map, or location assumptions.

## React Frontend

- The primary UI lives in `react-frontend/`.
- Use HeroUI v3, Tailwind CSS 4, Lucide icons, and CSS tokens. Do not add `framer-motion`, inline styles, or per-component CSS files.
- End-user text must use translation keys through `t(...)`.
- Pages should use `usePageTitle()`, and internal tenant-aware links should use `tenantPath()`.
- Preserve AGPL attribution in footer, auth, and drawer surfaces.

## Accessible Frontend

- The accessible frontend is `web-uk/` (Express + Nunjucks + `govuk-frontend`), plus the shared translations in `lang/*/govuk_alpha*.php`. The Laravel Blade implementation — `accessible-frontend/`, `app/Http/Controllers/GovukAlpha/`, `routes/govuk-alpha*.php` — was **deleted on 2026-08-14** and must not be reintroduced.
- Keep it HTML-first and progressively enhanced. Do not introduce React/Vue/SPA routing there.
- Use official `govuk-frontend` classes and approved Project NEXUS branding, not GOV.UK crown/logotype/identity wording.
- Every user-facing string must use `govuk_alpha` translation keys and matching locale parity.
- Preserve tenant assertions, feature gates, and AGPL attribution.

## Review Tone

When raising a finding, explain the concrete failure mode and the smallest safe correction. Skip preferences, broad rewrites, and cosmetic comments unless they prevent a real bug or long-term maintenance hazard.
