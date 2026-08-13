# Accessible Frontend — CLAUDE.md

> 🔴 **THIS TRACK IS FROZEN — READ-ONLY REFERENCE (owner decision, 2026-08-13).**
>
> Do **not** build anything new here. `web-uk/` is the accessible frontend being
> built now; this Blade track is kept as the reference for building it, and
> retires once `web-uk` is judged finished.
>
> **Reading this tree is the intended use** — it is the behaviour specification
> `web-uk` is built against. Everything below still accurately describes how it
> works, which is exactly why it is worth reading.
>
> **Writing to it is not.** No new pages, features, routes, fields or parity
> work. The only changes allowed without asking the owner are a security fix, a
> fault making a live page unusable for a real member, or a mechanical
> repo-wide sweep this tree cannot be excluded from (SPDX, lint, translation key
> parity, a dependency bump).
>
> It is still deployed and still serving real members on the community accessible
> domains and every `/{tenantSlug}/accessible/...` path, so do not delete it,
> remove its routes, or disable its tests or build.
>
> Status and phase are stated once, in
> [docs/ACCESSIBLE-FRONTEND-TAKEOVER.md](../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md).

> Stack-specific conventions for `accessible-frontend/`. See root `CLAUDE.md` for project-wide rules and `docs/govuk-alpha/RESEARCH.md` for the architecture decision.

## Stack

| Item | Value |
|------|-------|
| **Rendering** | Laravel 12 Blade — server-rendered HTML, no client-side routing |
| **Component library** | `govuk-frontend@6.1.0` (MIT) — official Sass, JS, classes |
| **Sass entry** | `accessible-frontend/src/app.scss` — imports govuk-frontend components selectively |
| **TypeScript entry** | `accessible-frontend/src/app.ts` — calls `initAll()` from `govuk-frontend`; progressive enhancement only |
| **Build output** | `httpdocs/build/accessible-frontend/` — Vite config at `vite.accessible-frontend.config.ts` |
| **View namespace** | `accessible-frontend::` (e.g. `accessible-frontend::feed`) |
| **Controller** | `app/Http/Controllers/GovukAlpha/AlphaController.php` (composed via `Concerns/` traits) |
| **Routes** | `routes/govuk-alpha.php` + `routes/govuk-alpha-parity/*.php` (glob-loaded) |
| **Translations** | `lang/en/govuk_alpha.php` and per-module `lang/en/govuk_alpha_*.php` files |
| **URL pattern** | `/{tenantSlug}/accessible/...` (named prefix `govuk-alpha.`; legacy `/alpha` URLs 301/308-redirect) |
| **Public subdomain** | `accessible.project-nexus.ie` |
| **Deployment target** | Laravel/PHP blue-green container (not the React container) |

---

## Mandatory Rules

### 1. HTML-first, progressive enhancement

Server-rendered HTML must work completely without JavaScript. CSS and JS are enhancements layered on top. Use:

- Normal `<a>` links for navigation, not JS-driven routing.
- GET forms with server-rendered results for search and filters (see `[data-alpha-auto-submit]` for the optional JS auto-submit enhancement).
- POST forms with CSRF for state-changing actions.
- `govuk-frontend` JS only for enhanced behaviours (accordion expand/collapse, service-navigation toggle, skip-link, etc.); all pages must remain usable if `initAll()` is never called.

Never use React, Vue, or any SPA framework in this frontend.

### 2. Use official govuk-frontend classes — do not invent GOV.UK markup

All markup must follow the GOV.UK Design System. Use the classes and HTML structure from [https://design-system.service.gov.uk](https://design-system.service.gov.uk).

Import component Sass selectively in `accessible-frontend/src/app.scss`. See `accessible-frontend/COMPONENTS.md` for the current import list.

Do NOT:
- Copy markup from unofficial React GOV.UK component libraries.
- Use `govuk_template`, `govuk_elements`, or `govuk_frontend_toolkit` (deprecated).
- Invent classes that mirror GOV.UK naming without importing the real styles.

Do NOT import or use:
- `govuk-frontend`'s `header` component — Project NEXUS uses a custom `.nexus-alpha-header` element.
- `govuk-frontend`'s `footer` identity styles (crown / crest / Open Government Licence / "Crown copyright") — these imply a UK government service.

### 3. All user-facing strings via translations — no hardcoded English

Every string visible to users must come from a translation file.

| File | Used for |
|------|----------|
| `lang/en/govuk_alpha.php` | Global/shared strings (nav, footer, cookie banner, page titles, auth) |
| `lang/en/govuk_alpha_feed.php` | Feed module strings |
| `lang/en/govuk_alpha_listings.php` | Listings module strings |
| `lang/en/govuk_alpha_events.php` | Events module strings |
| *(etc. — one file per module)* | |

In Blade: `{{ __('govuk_alpha.nav.home') }}` or `{{ __('govuk_alpha_feed.some.key') }}`

In controllers: `__('govuk_alpha.auth.login_title')` when passing `'title'` to `$this->view(...)`.

After adding keys to English, add matching keys to all 10 other locale files (`ar`, `de`, `es`, `fr`, `ga`, `it`, `ja`, `nl`, `pl`, `pt`). Run the parity check:

```bash
npm run check:i18n:php
```

### 4. Preserve tenant context on every request

Every controller method that serves a tenant page must call `$this->assertTenantSlug($tenantSlug)` before touching any data. This aborts with 404 when the slug in the URL does not match the resolved `TenantContext`.

All database queries and service calls inherit tenant scope from `TenantContext::getId()` — follow the same convention as the main API controllers.

### 5. Respect module feature gates

Use `abort_unless(TenantContext::hasFeature('feature_name'), 403)` at the top of any controller method that serves a gated module. This mirrors the `FeatureGate` checks in the React frontend and must be kept in sync when new gates are added.

Example from the codebase:

```php
abort_unless(TenantContext::hasFeature('federation'), 403);
```

### 6. Keep AGPL Section 7(b) attribution in the footer on every page

`layout.blade.php` renders the `govuk-footer__meta-custom` block containing the licence notice and source-repository link. These are driven by `lang/en/govuk_alpha.php` keys `footer.licence`, `footer.attribution`, and `footer.source`.

**Never remove these from the layout.** The project is AGPL-3.0-or-later; Section 7(b) requires attribution to be preserved.

### 7. Do NOT imply an official UK government service

- Do not use the GOV.UK crown or logotype.
- Do not use GDS Transport font — `app.scss` overrides `$govuk-font-family` to `arial, helvetica, sans-serif` and sets `$govuk-include-default-font-face: false`.
- Do not use wording such as "GOV.UK service", "UK government", or any copy that suggests this is an official government product.
- Do not use `gov`, `govuk`, or `ukgov` in any public-facing subdomain.

### 8. SPDX header on every source file

PHP and Blade files get the comment-style header:

```blade
{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
```

PHP files get:

```php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
```

---

## The @php Block Gotcha — Read This Before Writing Blade

**Always use block `@php...@endphp` for any logic in Blade templates. Never use complex inline `@php(...)` expressions.**

There are two failure modes:

1. **Syntax error** — a complex inline `@php(...)` containing parentheses throws a misleading `unexpected "endforeach"` or similar compile error that does not point at the real line.
2. **Silent swallowing** — if the same file also contains a block `@php...@endphp`, Blade's non-greedy raw-block extractor can swallow the inline expression entirely, producing an `Undefined variable` error only on the executed branch. Static tests pass; the bug only appears at runtime when that branch is reached.

```blade
{{-- CORRECT --}}
@php
    $foo = $bar['key'] ?? null;
@endphp

{{-- WRONG — both forms —}}
@php($foo = $bar['key'] ?? null)
@php(complex ? expression : here)
```

Short one-liner assignments that contain no parentheses and appear in files that have no block `@php` sections are lower risk, but the block form is always safer and should be preferred.

---

## Directory Structure

```
accessible-frontend/
├── src/
│   ├── app.scss          # Sass entry — govuk-frontend imports + NEXUS overrides
│   └── app.ts            # TypeScript entry — initAll() + progressive enhancements
├── views/
│   ├── layout.blade.php  # Master layout (header, nav, footer, cookie banner)
│   ├── partials/         # Shared partial templates
│   └── *.blade.php       # One file per page/module
├── COMPONENTS.md         # Inventory of imported govuk-frontend components
└── README.md             # Setup and deployment notes

app/Http/Controllers/GovukAlpha/
├── AlphaController.php        # Main controller — composes all Concerns traits
└── Concerns/
    ├── FeedParity.php         # Feed module methods
    ├── ListingsParity.php     # Listings module methods
    └── *.php                  # One trait per module

routes/
├── govuk-alpha.php            # Core routes + glob-loads parity directory
└── govuk-alpha-parity/
    ├── feed.php               # Feed parity routes
    ├── listings.php           # Listings parity routes
    └── *.php                  # One file per parity module

lang/en/
├── govuk_alpha.php            # Global strings
├── govuk_alpha_feed.php       # Feed module strings
└── govuk_alpha_*.php          # Per-module strings (mirrored in all 10 other locales)
```

---

## Adding a New Module

1. **Controller logic** — add a new `Concerns/YourModuleParity.php` trait. Use the module-prefixed method-name convention (`yourModuleIndex`, `yourModuleShow`, etc.). Compose it into `AlphaController` with `use Concerns\YourModuleParity;`.

2. **Routes** — add `routes/govuk-alpha-parity/yourmodule.php`. It is loaded automatically by the glob inside the `{tenantSlug}/accessible` route group and inherits its prefix and middleware. Register static segments before wildcards within the file.

3. **Views** — add `accessible-frontend/views/yourmodule.blade.php` (and partials as needed). Extend the layout:

   ```blade
   @extends('accessible-frontend::layout')

   @section('content')
     {{-- page content --}}
   @endsection
   ```

4. **Translations** — add `lang/en/govuk_alpha_yourmodule.php` and mirror all keys in the other 10 locale files. Run `npm run check:i18n:php` to verify parity.

5. **Feature gate** — if the module is gated, add `abort_unless(TenantContext::hasFeature('your_feature'), 403)` at the top of each gated controller method.

6. **Tests** — add cases to `tests/Laravel/Feature/GovukAlphaFrontendTest.php` (or a focused test class nearby). Run `npm run test:accessible-frontend:php` to verify.

---

## Calling `$this->view()`

All controller methods render via the private `view()` helper, which merges shared data automatically:

```php
return $this->view('accessible-frontend::yourmodule', [
    'title'     => __('govuk_alpha_yourmodule.index.title'),
    'activeNav' => 'yourmodule',
    // ...page-specific data
]);
```

Shared data injected by `sharedViewData()` (available in every template without passing it explicitly):

| Variable | Description |
|----------|-------------|
| `$isAuthenticated` | Boolean — whether the visitor has a valid session |
| `$tenantSlug` | Current tenant slug from the URL |
| `$tenant` | TenantContext array (name, slug, configuration) |
| `$alphaNavItems` | Associative array of nav key → URL for the service navigation |
| `$alphaFooterColumns` | Footer link columns |
| `$alphaLocaleOptions` | All 11 supported locale codes and labels |
| `$alphaCurrentLocale` | Active locale |
| `$alphaTextDirection` | `'rtl'` for Arabic, `'ltr'` otherwise |
| `$alphaUnreadMessages` | Unread message count for the badge |
| `$tenantLogoUrl` / `$tenantLogoDarkUrl` | Tenant-uploaded logo URLs |
| `$assetEntrypoint` | Vite manifest entry (`css` + `js` arrays) |

Set `'activeNav'` in your method so the correct service-navigation item receives `aria-current="page"`.

---

## Progressive Enhancement in TypeScript

`app.ts` is the single TypeScript entry point. Keep JS additions in this file or imported modules — do not add `<script>` tags to individual Blade pages.

Pattern for a page-scoped enhancement:

```typescript
const myWidget = document.querySelector<HTMLElement>('[data-alpha-my-widget]');
if (myWidget) {
  // enhancement — only runs when the element exists on the current page
  // the page must already work fully without this block
}
```

The `[data-alpha-auto-submit]` attribute on a `<form>` causes its `<select>` elements to submit the form on change — a no-JS graceful-degradation pattern for filter forms already present in the codebase.

---

## Build and Test Commands

```bash
# Build assets (required before deploying or when Sass/TS changes)
npm run build:accessible-frontend

# Dev server (Vite proxy on :5174 -> Docker Laravel on :8090)
npm run dev:accessible-frontend

# PHP tests (GovukAlphaFrontendTest suite)
npm run test:accessible-frontend:php

# Accessibility smoke tests (Playwright, separate config)
npm run test:accessible-frontend:a11y

# Translation parity check (after editing any lang/en/govuk_alpha*.php)
npm run check:i18n:php
```

Run all three test commands before submitting or deploying accessible frontend changes.

---

## What NOT to Do

| Do not | Reason |
|--------|--------|
| Use React, Vue, or any SPA framework | HTML-first requirement; wrong container |
| Import `govuk-frontend` `header` or `footer` identity components | Would imply an official UK government service |
| Use the GOV.UK crown, logotype, or GDS Transport | Brand restriction |
| Hardcode English strings in Blade templates | Platform supports 11 locales |
| Edit `AlphaController.php` directly for new module methods | Use a `Concerns/` trait to keep parallel work conflict-free |
| Edit `routes/govuk-alpha.php` directly for new module routes | Add a file under `routes/govuk-alpha-parity/` instead |
| Use complex inline `@php(...)` expressions | Blade silent-swallow bug; always use block `@php...@endphp` |
| Remove AGPL attribution from the layout footer | Required by AGPL-3.0-or-later Section 7(b) |
| Deploy without running `npm run build:accessible-frontend` | Built assets in `httpdocs/build/accessible-frontend/` must be committed or rebuilt inside the container |
