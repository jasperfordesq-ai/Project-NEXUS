# GOV.UK-Based Accessible Frontend Research

Last reviewed: 2026-08-12

🔴 **Read this first: the architecture below describes the Blade frontend, which
is being replaced.** This page records the original decision and remains the
reference for the **GOV.UK constraints** — the branding prohibitions, the approved
packages, the HTML-first progressive-enhancement requirement — and those bind
**both** accessible frontends. Its *architecture* section does not: since
**2026-08-12**, `accessible.project-nexus.ie` is served by `web-uk/`, a standalone
Node 22 / Express / Nunjucks application that consumes the Laravel HTTP API. The
Blade implementation described here still serves the community accessible domains
and all `/{tenantSlug}/accessible/...` paths, and retires when the changeover
completes. **Status is stated once**, in
[../ACCESSIBLE-FRONTEND-TAKEOVER.md](../ACCESSIBLE-FRONTEND-TAKEOVER.md) — not
here, and not in any other document.

## Architecture Decision (the Blade track)

Project NEXUS Accessible Frontend is an approved exception to the React-primary UI rule. It is an isolated, HTML-first Laravel frontend that complements `react-frontend/` and does not replace it. It follows GOV.UK Frontend implementation standards for accessibility and resilience, but it is not a GOV.UK service and must not look or read like one.

The public-facing accessible frontend is now Beta and served under `/{tenantSlug}/accessible/...` (legacy `/alpha/...` URLs permanently redirect). The `GovukAlpha`, `govuk_alpha`, and `govuk-alpha.*` names remain as internal code-path names until a deliberate namespace migration is done.

> 🔴 **The layout described in this section was DELETED on 2026-08-14.** This document
> records the original architecture research and the GOV.UK licensing/branding limits,
> which remain valid and binding. Its *implementation* details describe the Laravel
> Blade accessible frontend, which no longer exists. Current status is stated once, in
> [../ACCESSIBLE-FRONTEND-TAKEOVER.md](../ACCESSIBLE-FRONTEND-TAKEOVER.md).

**The accessible frontend today** is `web-uk/` — Node 22 + Express 4 + Nunjucks +
`govuk-frontend`, consuming the Laravel API. It serves
`accessible.project-nexus.ie`, both community accessible domains, and
`/{tenantSlug}/accessible/...` for every community. It deploys as its own container
alongside the blue/green PHP app, and **every deploy must pass `--with-webuk`**.

Verification for changes to it:

```bash
npm --prefix web-uk run brand:check
npm --prefix web-uk run lint
npm --prefix web-uk test
npm --prefix web-uk run build:css
```

<details>
<summary>The original (deleted) Blade layout, kept for provenance</summary>

- Laravel routes under `/{tenantSlug}/accessible/...`
- Controllers under `app/Http/Controllers/GovukAlpha/`
- Frontend source under root-level `accessible-frontend/`
- Blade views under `accessible-frontend/views/`
- Sass and TypeScript under `accessible-frontend/src/`
- A separate Vite build output under `httpdocs/build/accessible-frontend/`
- Complete component inventory under `accessible-frontend/COMPONENTS.md`

Its deployment checks were `npm run build:accessible-frontend`,
`npm run test:accessible-frontend:php` and `npm run test:accessible-frontend:a11y`.
**None of those npm scripts exist any more.**

</details>

Recommended production subdomain: `accessible.project-nexus.ie`. Avoid `gov`, `govuk`, `ukgov`, or other names that could imply a UK government service.

## GOV.UK Repos To Remember

- `alphagov/govuk-frontend`: official implementation package for Sass, JavaScript, Nunjucks macros, and component CSS classes. https://github.com/alphagov/govuk-frontend
- `alphagov/govuk-design-system`: canonical component, pattern, accessibility, and content guidance. https://github.com/alphagov/govuk-design-system
- `alphagov/govuk-frontend-docs`: technical installation, asset, JavaScript, and update guidance. https://github.com/alphagov/govuk-frontend-docs
- `alphagov/govuk-prototype-kit`: reference for prototypes only, not the production foundation. https://github.com/alphagov/govuk-prototype-kit
- `alphagov/govuk_publishing_components`: implementation reference for GOV.UK publishing components, not the default foundation for Project NEXUS. https://github.com/alphagov/govuk_publishing_components
- `alphagov/frontend`: GOV.UK frontend application reference for production page patterns. https://github.com/alphagov/frontend
- `alphagov/govuk-design-system-architecture`: architecture decisions for GOV.UK Design System, Frontend, and Prototype Kit. https://github.com/alphagov/govuk-design-system-architecture

## What We Can Use

- `govuk-frontend` package code, Sass, JavaScript, component classes, and sample markup.
- GOV.UK Design System layout, spacing, typography scale, form, button, summary list, pagination, phase banner, skip link, and grid conventions.
- Progressive-enhancement patterns: working server-rendered HTML first, JavaScript as an enhancement only.
- All official `govuk-frontend` component styles except identity-sensitive GOV.UK header and footer styles.

## What We Cannot Use

- GOV.UK crown.
- GOV.UK logotype.
- GOV.UK header component or footer identity in a way that implies this service is official GOV.UK.
- GDS Transport font.
- Any copy or presentation that suggests Project NEXUS is a UK government service.
- Deprecated GOV.UK packages or repos: `govuk_template`, `govuk_elements`, and `govuk_frontend_toolkit`.
- Unofficial React GOV.UK component libraries as the foundation unless a future decision record documents why official `govuk-frontend` cannot meet the need.

## GOV.UK Frontend Version And Update Process

The current installed Project NEXUS baseline is `govuk-frontend@6.1.0`. The latest stable npm release was verified as `6.3.0` on 2026-06-23. Before upgrading, verify npm and GitHub again; do not move to beta or prerelease builds without a recorded decision.

Before updating:

1. Check the GitHub releases page and npm package version.
2. Confirm the target version is stable, not beta/prerelease.
3. Read the release notes for Sass, asset path, and JavaScript initialization changes.
4. Run the accessible frontend build and scoped accessibility smoke tests.
5. Update this document if branding, font, licensing, or initialization guidance changes.

## Licensing And Attribution

`govuk-frontend` code and sample code are MIT licensed and compatible with this AGPL-3.0-or-later project.

GOV.UK Design System and documentation content is Crown copyright under the Open Government Licence v3.0 unless otherwise stated. Do not copy or closely adapt documentation prose into the app. If future docs copy or closely adapt GOV.UK documentation text, record attribution in `docs/govuk-alpha/ATTRIBUTION.md`.

## Why HTML-First And Progressive Enhancement

The GOV.UK Service Manual requires robust frontends to start with HTML that works, then add CSS and JavaScript as enhancements. That matches this accessible frontend because feed, listings, and member directory journeys are page and form based, need reliable browser navigation, and should remain usable if JavaScript fails.

The accessible frontend therefore uses normal links, GET filters, POST forms, semantic HTML, and GOV.UK Frontend JavaScript only for enhanced behaviours.
