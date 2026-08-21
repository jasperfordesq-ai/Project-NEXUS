# React Frontend — CLAUDE.md

> Stack-specific conventions for `react-frontend/`. See root `CLAUDE.md` for project-wide rules.

## Stack

| Item | Value |
|------|-------|
| **Framework** | React 19 + TypeScript (strict) |
| **Component Library** | HeroUI v3 (`@heroui/react`) — migration complete, no v2 npm alias |
| **CSS** | Tailwind CSS 4 (`@tailwindcss/vite` plugin) |
| **Icons** | Lucide React (`lucide-react`) |
| **Animation** | Local `@/lib/motion` shim (CSS-transition-backed). **Do NOT add `framer-motion` imports** — it has been removed. Prefer Tailwind/CSS animations or the shim. |
| **Rich Text** | Lexical editor |
| **Charts** | Recharts |
| **Routing** | React Router v6 (tenant slug support) |
| **Build** | Vite |
| **Tests** | Vitest |

## Backend Target Guardrail

This frontend is in production against the Laravel backend. Laravel remains the
default and canonical API contract, and ASP.NET is selected only by
environment/config — never by a code branch.

🔴 **Corrected 2026-08-21: ASP.NET is not "development-only".** It is a
**committed second edition** driven by public-sector buyers who require a .NET
stack to procure at all, and **this frontend is its primary client** — 300 of the
1,000 points of its certification score are journeys driven through these very
pages. When a journey behaves differently on ASP.NET, **the fix goes in ASP.NET,
never here**: no adapter, no `if (backend === 'aspnet')` branch, no weakening of a
production page. Requests to change a file in this directory for ASP.NET's benefit
need explicit owner approval for that specific change.

Read before doing dual-backend work:
[`ADR-0003`](../aspnet-backend/docs/decisions/ADR-0003-aspnet-is-a-committed-deliverable.md)
(why it is committed),
[`ADR-0004`](../aspnet-backend/docs/decisions/ADR-0004-journey-equivalence-is-the-target.md)
(what equivalence does and does not require — a response field no component reads
is explicitly out of scope), and the work list
[`JOURNEY_CERTIFICATION_LEDGER.md`](../aspnet-backend/docs/JOURNEY_CERTIFICATION_LEDGER.md).

Safe local commands:

```bash
npm run dev          # Laravel default
npm run build        # Laravel/default production path
npm run dev:laravel  # Explicit local Laravel target
npm run dev:dotnet   # Explicit local ASP.NET target
npm run inventory:api-calls  # Local API-call matrix for future ASP.NET parity work
npm run certification:worksheets  # Local module worksheets from the matrix
npm run smoke:laravel-manifest  # Local Laravel-mode smoke checklist only
npm run check:backend-guardrails  # Ensure Laravel remains default and pages stay backend-neutral
npm run check:dual-backend-prep  # Guardrails + inventory tests + local matrix regeneration
```

Do not add ASP.NET conditionals inside pages or ordinary components. If a real
transport difference is unavoidable, isolate it behind a small adapter. Prefer
fixing ASP.NET to match Laravel for paths, payloads, response envelopes,
validation errors, auth refresh, tenant handling, uploads, and status codes. See
[`../docs/REACT-DUAL-BACKEND.md`](../docs/REACT-DUAL-BACKEND.md).

The API-call inventory is preparation only. It writes generated output under
`../.local-docs-archive/react-api-inventory/` and must not be treated as evidence
that the ASP.NET backend is ready. It may match React calls against Laravel
OpenAPI and Laravel route files, but those matches only confirm the production
Laravel contract surface.

Use `npm run test:api-inventory` when changing the inventory script. The matrix
groups calls by module and priority so backend agents can work from P0 auth /
tenant contracts outward without touching production React pages.
Use `npm run test:backend-guardrails` when changing the guardrail script.
Use `npm run test:certification-worksheets` when changing the worksheet generator.
Generated worksheets live under `../.local-docs-archive/react-api-certification/`
and are local handoff material only.
Use `npm run test:laravel-smoke-manifest` when changing the Laravel smoke
manifest generator. Generated smoke manifests live under
`../.local-docs-archive/react-laravel-smoke/`, keep ASP.NET marked as
`not_applicable`, and do not certify dual-backend readiness.

## 🔴 Mandatory Rules

1. **HeroUI components first** — buttons, inputs, modals, cards, tables, dropdowns all come from `@heroui/react`
2. **Tailwind utilities for layout** — spacing, flex, grid, responsive breakpoints
3. **CSS tokens for theme colors** — use `var(--color-surface)`, `var(--color-text)`, etc. from `src/styles/tokens.css`
4. **No inline styles** — use Tailwind classes or CSS tokens
5. **No separate `.css` files per component** — use Tailwind utilities or extend `tokens.css`
6. **Every page uses `usePageTitle()`** — sets `document.title` to "Page - Tenant"
7. **All internal links use `tenantPath()`** — for tenant slug routing
8. **SPDX header on every file** — see root CLAUDE.md
9. **Header/footer logo exception** — tenant brand logos in `Navbar`, `Footer`, `MobileDrawer`, and shared branding components must render uploaded raster assets, preferably transparent PNGs. Do not convert these header/footer logos to inline SVGs or generated SVG wrappers. SVGs are still fine for icons/illustrations elsewhere; this exception exists so light/dark header and footer logo contrast uses the real transparent logo files.

## Styling Examples

```tsx
// CORRECT — HeroUI + Tailwind
import { Button, Card, Input } from "@heroui/react";

<Card className="p-4 gap-3">
  <Input label="Email" variant="bordered" />
  <Button color="primary" className="mt-2">Submit</Button>
</Card>

// CORRECT — Tailwind utilities for layout
<div className="flex items-center gap-4 px-6 py-3">

// CORRECT — CSS tokens for theme-aware colors
<div className="bg-[var(--color-surface)] text-[var(--color-text)]">

// WRONG — inline styles
<div style={{ padding: '16px' }}>

// WRONG — separate CSS component files
```

## Theme System

- `ThemeContext` manages `light`, `dark`, or `system` preference
- CSS tokens in `src/styles/tokens.css` (light/dark custom properties)
- HeroUI dark mode via `@custom-variant dark (&:is(.dark *))` in `index.css`
- Persists to `users.preferred_theme` via `PUT /api/v2/users/me/theme`
- Toggle in Navbar (sun/moon icon)

## CSS Architecture

| File | Purpose |
|------|---------|
| `src/index.css` | Tailwind CSS 4 entry, HeroUI plugin, design token imports |
| `src/contexts/ThemeContext.tsx` | Runtime light/dark/system, contrast, and accent preferences |
| `src/styles/tokens.css` | CSS custom properties (light/dark themes) |

## Key Files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Providers plus one catch-all route delegating to `TenantShell` |
| `src/routes/AppRoutes.tsx` | Member-facing page routes and all `FeatureGate` gating |
| `src/routes/PublicAppRoutes.tsx` | Pre-auth public routes |
| `src/routes/AuthRoutes.tsx` | Login / register / recovery routes |
| `src/admin/routes.tsx` | Admin routes |
| `src/lib/api.ts` | API client with token refresh & interceptors |
| `src/types/api.ts` | TypeScript interfaces for API responses |

## Contexts

| Context | File | Purpose |
|---------|------|---------|
| `AuthContext` | `src/contexts/AuthContext.tsx` | Authentication state, login/logout, user data |
| `TenantContext` | `src/contexts/TenantContext.tsx` | Tenant config, `hasFeature()`, `hasModule()` |
| `ToastContext` | `src/contexts/ToastContext.tsx` | Toast notifications (success/error/info) |
| `ThemeContext` | `src/contexts/ThemeContext.tsx` | Light/dark/system mode |
| `NotificationsContext` | `src/contexts/NotificationsContext.tsx` | Real-time notification state & unread counts |
| `PusherContext` | `src/contexts/PusherContext.tsx` | Pusher WebSocket connection |

## Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useApi` | `src/hooks/useApi.ts` | GET requests with loading/error states |
| `usePageTitle` | `src/hooks/usePageTitle.ts` | Sets document title ("Page - Tenant") |
| `useToast` | via ToastContext | `showToast('message', 'success')` |
| `useAuth` | via AuthContext | Current user, `isAuthenticated` |
| `useTenant` | via TenantContext | `hasFeature()`, `hasModule()`, tenant settings |
| `useTheme` | via ThemeContext | `theme`, `setTheme('light'/'dark'/'system')` |
| `useNotifications` | via NotificationsContext | Notification list, unread count, mark-read |
| `useApiErrorHandler` | `src/hooks/useApiErrorHandler.ts` | App-level API error → toast listener |
| `useAppUpdate` | `src/hooks/useAppUpdate.ts` | Capacitor native app version check |
| `useLegalGate` | `src/hooks/useLegalGate.ts` | Legal doc acceptance check & `acceptAll()` |
| `usePushNotifications` | `src/hooks/usePushNotifications.ts` | FCM push registration (Capacitor only) |

## Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `Layout` | `src/components/layout/Layout.tsx` | Main wrapper (Navbar + Footer + BackToTop + Offline) |
| `Navbar` | `src/components/layout/Navbar.tsx` | Desktop nav, dropdowns, search overlay (Cmd+K) |
| `MobileDrawer` | `src/components/layout/MobileDrawer.tsx` | Mobile slide-out menu |
| `Footer` | `src/components/layout/Footer.tsx` | Site footer (AGPL attribution required) |
| `FeatureGate` | `src/components/routing/FeatureGate.tsx` | Conditional render by `feature` or `module` |
| `Breadcrumbs` | `src/components/navigation/Breadcrumbs.tsx` | Breadcrumb nav |
| `BackToTop` | `src/components/ui/BackToTop.tsx` | Floating scroll-to-top button |
| `OfflineIndicator` | `src/components/feedback/OfflineIndicator.tsx` | Offline/online banner |
| `TransferModal` | `src/components/wallet/TransferModal.tsx` | Time credit transfer dialog |

## Maps & Location Providers

Three independent per-tenant settings, all configurable in `/admin/module-configuration → "Maps & location"`:

| Setting | Values | Default | Effect |
| --- | --- | --- | --- |
| `maps` (feature flag) | on / off | **off** (opt-in per tenant — `TenantFeatureConfig::FEATURE_DEFAULTS` and the TS default map both set `false`) | Off ⇒ no map components render anywhere; no Google API key reaches the browser. |
| `map_provider` (general setting) | `google` / `openstreetmap` / `ordnance_survey` | `google` | Renderer for interactive maps. `ordnance_survey` reuses the Leaflet view with OS Maps API tiles (Crown copyright attribution); degrades to free OSM tiles when no OS key resolves. |
| `geocoding_provider` (general setting) | `google` / `nominatim` / `os_places` | `google` | Address autocomplete. **Always on regardless of `maps` flag.** `os_places` gives UPRN-backed UK address validation via the server-side proxy `/v2/geo/os-places/search` (OS Data Hub key never reaches the browser). |

**Dispatch:**

- `LocationMap` checks `hasFeature('maps')` → `mapProvider` → `<OpenStreetMapView/>` (lazy-loaded Leaflet, serves both `openstreetmap` and `ordnance_survey` — the server picks the tile URL) or `<GoogleMapsProvider/>`.
- `PlaceAutocompleteInput` checks `geocodingProvider` → `<NominatimAutocomplete/>`, `<OsPlacesAutocomplete/>` (UPRN on `PlaceResult.uprn`), or Google Places. The Google branch never mounts on non-Google tenants — zero billable traffic.
- OS Data Hub: one project key (`general.os_maps_api_key`, env fallback `OS_MAPS_API_KEY`) covers both the OS Maps basemap and the OS Places lookup. UK public-sector tenants are typically covered by the PSGA.

**Defence in depth:** `MapsConfigController` (`/api/v2/config/google-maps`) only returns the Google API key when `maps=on` AND `map_provider=google`. `AdminConfigController::updateSettings` validates provider values against allow-lists.

**Compliance:** OSM tiles via `tile.openstreetmap.org` (subject to OSMF tile policy — fine at low/moderate scale; switch to MapTiler/Stadia for high traffic). Nominatim 1 req/sec policy is honored by the 1s frontend debounce. Required attribution renders automatically.

**Cost playbook:** Switch `geocoding_provider` to `nominatim` first (Places sessions are usually the biggest cost). Then `map_provider`. Kill switch is the emergency cutoff.

Files: [src/components/location/LocationMap.tsx](src/components/location/LocationMap.tsx), [OpenStreetMapView.tsx](src/components/location/OpenStreetMapView.tsx), [PlaceAutocompleteInput.tsx](src/components/location/PlaceAutocompleteInput.tsx), [NominatimAutocomplete.tsx](src/components/location/NominatimAutocomplete.tsx), admin UI in [src/admin/modules/config/ModuleConfiguration.tsx](src/admin/modules/config/ModuleConfiguration.tsx).

## Feature & Module Gating

Two gating mechanisms controlled per-tenant:

- **Features** (`tenants.features` JSON): Optional add-ons — `events`, `groups`, `gamification`, `goals`, `blog`, `resources`, `volunteering`, `exchange_workflow`, etc.
- **Modules** (`tenants.configuration.modules` JSON): Core functionality — `listings`, `wallet`, `messages`, `dashboard`, `feed`, etc.

```tsx
const { hasFeature, hasModule } = useTenant();
if (hasFeature('gamification')) { /* show gamification UI */ }
if (hasModule('wallet')) { /* show wallet nav item */ }

// In src/routes/AppRoutes.tsx route definitions
<FeatureGate feature="events"><EventsPage /></FeatureGate>
<FeatureGate module="wallet"><WalletPage /></FeatureGate>
```

Admin UI: `/admin/module-configuration` (React admin, `src/admin/modules/config/ModuleConfiguration.tsx`) — toggle switches for all features & modules per tenant. `/admin/tenant-features` is retired and only redirects there.

## Pages

All pages use `usePageTitle()`. Member-facing rows are defined and feature/module gated in `src/routes/AppRoutes.tsx`; the public rows (Home, About, Contact, Help Center, Blog, Newsletter Unsub) live in `src/routes/PublicAppRoutes.tsx`:

| Page | Route | Gate |
|------|-------|------|
| Dashboard | `/dashboard` | Module: `dashboard` |
| Listings | `/listings`, `/listings/:id` | Module: `listings` |
| Create Listing | `/listings/create`, `/listings/edit/:id` | Module: `listings` |
| Messages | `/messages`, `/messages/:id` | Module: `messages` |
| Wallet | `/wallet` | Module: `wallet` |
| Feed | `/feed` | Module: `feed` |
| Events | `/events`, `/events/:id` | Feature: `events` |
| Groups | `/groups`, `/groups/:id` | Feature: `groups` |
| Members | `/members` | Feature: `connections` |
| Profile | `/profile`, `/profile/:id` | Module: `profile` (protected) |
| Exchanges | `/exchanges`, `/exchanges/:id` | Feature: `exchange_workflow` |
| Notifications | `/notifications` | Module: `notifications` |
| Settings | `/settings` | Module: `settings` |
| Search | `/search` | Feature: `search` |
| AI Chat | `/chat` | Feature: `ai_chat` |
| Polls | `/polls` | Feature: `polls` |
| Job Vacancies | `/jobs`, `/jobs/:id`, `/jobs/create` | Feature: `job_vacancies` |
| Ideation | `/ideation`, `/ideation/:id` | Feature: `ideation_challenges` |
| Skills | `/skills` | — (protected) |
| Activity | `/activity` | — (protected) |
| Leaderboard | `/leaderboard` | Feature: `gamification` |
| Achievements | `/achievements` | Feature: `gamification` |
| Goals | `/goals` | Feature: `goals` |
| Volunteering | `/volunteering` | Feature: `volunteering` |
| Blog | `/blog`, `/blog/:slug` | Feature: `blog` |
| Resources | `/resources` | Feature: `resources` |
| Organisations | `/organisations`, `/organisations/:id` | Feature: `volunteering` |
| Federation | `/federation/*` | Feature: `federation` |
| Group Exchanges | `/group-exchanges`, `/group-exchanges/:id`, `/group-exchanges/create` | Feature: `group_exchanges` |
| Matches | `/matches`, `/matches/preferences` | Module: `listings` (redirect → `/dashboard`) |
| Newsletter Unsub | `/newsletter/unsubscribe` | — (public) |
| Onboarding | `/onboarding` | — (protected) |
| Help Center | `/help` | — (public) |
| About | `/about` | — (public) |
| Contact | `/contact` | — (public) |
| Home | `/` | — (public) |

## Legal Document System

Per-tenant custom legal documents (Terms, Privacy, Cookies) managed via admin, rendered on frontend.

| File | Purpose |
|------|---------|
| `src/hooks/useLegalDocument.ts` | Fetches custom doc, waits for TenantContext |
| `src/components/legal/CustomLegalDocument.tsx` | Section parser + renderer with TOC |
| `src/pages/public/TermsPage.tsx` | Terms page (custom or default) |
| `src/pages/public/PrivacyPage.tsx` | Privacy page (custom or default) |
| `src/pages/public/CookiesPage.tsx` | Cookies page (custom or default) |
| `src/index.css` | `.legal-content` styles |

**Key details:**
- Response unwrapping is done by the shared client, not by these files: `src/lib/api.ts` uses `'data' in data ? data.data : data` (NOT `data.data ?? data`). Do not re-unwrap `res.data` in the legal hook or pages.
- `useLegalDocument` validates response shape before setting state — it requires `res.success` plus `'id' in res.data && 'content' in res.data`, and silently falls through to default content otherwise
- `CustomLegalDocument` detects documents with their own section numbering

## Zod Runtime Validation (Dev Only)

API responses validated against Zod schemas in development mode:

| File | Purpose |
|------|---------|
| `src/lib/api-schemas.ts` | Zod schemas for API responses |
| `src/lib/api-validation.ts` | Dev-only validation helper |

- Dev mode: `console.warn` on schema mismatch (never throws)
- Production: validation code tree-shaken out (zero overhead)

## PWA Update Architecture

**TL;DR:** deploys propagate to users on their next navigation, with no UI prompt. There is no "Update available" banner any more — `UpdateAvailableBanner.tsx` and `useVersionCheck` were removed (see layer 3); the stale-build gate in `api.ts` is the only backstop.

Three layers, in priority order:

### 1. Network-first/network-only navigation (primary)

In [vite.config.ts](vite.config.ts) `globPatterns` precaches `index.html`, the content-hashed startup graph (`assets/app-*.js`, `assets/index-*.css`, `assets/vendor-react-*.js`, `assets/vendor-i18n-*.js`), `sw-push-handler.js`, and install metadata (`manifest.json`, `favicon.svg`, `og-default.svg`, `icons/*.png`). The precached index is deliberate: it is the clean-install offline fallback and is consulted only when both the network and the runtime HTML cache miss. `navigateFallback: null` disables vite-plugin-pwa's default precache-first NavigationRoute (which would otherwise shadow everything below) — that, not excluding HTML from the precache, is what keeps navigations fresh.

Navigations are handled by **two** `runtimeCaching` rules, in order:

1. **NetworkOnly** for any same-origin navigation that does *not* match the identity-free public-path allowlist — protected, auth/token, CMS, tenant-prefixed, and unknown navigations. These are never cached, so identity-bearing HTML cannot be replayed after logout. There is no offline fallback for them.
2. **NetworkFirst** for the public allowlist only (`/`, `features`, `changelog`, `about`, `faq`, `contact`, `help`, `terms`, `privacy`, `blog/:slug`, `developers/*`, `pricing`, and the rest of the regex in `vite.config.ts`).

```ts
// Rule 2 — identity-free public HTML shell only.
{
  urlPattern: ({ request, url }) => {
    if (request.mode !== 'navigate') return false;
    if (url.origin !== self.location.origin) return false;
    const p = url.pathname;
    if (p.startsWith('/api/')) return false;       // bypass to network
    if (p === '/health.php') return false;
    if (p === '/api/sw-reset') return false;       // recovery URL
    // …then an inline allowlist regex literal over the normalised path.
    // There is no named constant for it — abridged with `…` below; the full
    // literal is in vite.config.ts.
    return /^(?:|features|changelog|about|faq|contact|help|terms|privacy|blog(?:\/[^/]+)?|…)$/
      .test(p.toLowerCase().split('/').filter(Boolean).join('/'));
  },
  handler: 'NetworkFirst',
  options: {
    cacheName: 'nexus-public-html-shell-v3',
    networkTimeoutSeconds: 3,
    cacheableResponse: { statuses: [200], headers: { 'X-Nexus-Spa-Shell': '1' } },
    precacheFallback: { fallbackURL: 'index.html' },
  },
}
```

### 2. API stale-client gate (secondary safety net)

Every API response carries `X-Build: <commit-sha>` set by `app/Http/Middleware/SecurityHeaders.php` (sourced from `httpdocs/.build-version` baked by `bluegreen-deploy.sh`). The header is exposed via CORS (`Access-Control-Expose-Headers` in both `EnsureCorsHeaders.php` and `config/cors.php`).

In [src/lib/api.ts](src/lib/api.ts), `checkStaleBuild()` runs on every response from `request()`, `download()`, and `upload()`:

- **Match** → clear the mismatch tracker.
- **First mismatch** → record the timestamp in `localStorage` (`nexus_build_mismatch_since`) and add a `'Stale client detected'` Sentry breadcrumb, then return. Nothing else happens: no DOM event is dispatched and no UI is shown (the code comment reads "Silently start the grace timer"). The old `UpdateAvailableBanner` that used to surface this has been removed — network-first/network-only navigation is the recovery path.
- **Mismatch persists ≥ 10 minutes** → `window.location.replace('/api/sw-reset')`. Forces nuclear recovery via the nginx route that returns `Clear-Site-Data` plus an inline SW unregister + cache wipe script.

The 10-minute grace gives network-first/network-only navigation (any page navigation fetches a fresh shell — network-only for authenticated pages, network-first for the public allowlist) a chance to recover the user organically. Only when that has clearly failed do we eject them.

### 3. ~~Soft update banner~~ (removed)

`UpdateAvailableBanner.tsx` and `useVersionCheck` have been removed — layers 1 and 2 proved sufficient and users should never need a manual "update" button. Nothing in the codebase emits a stale-build event today, so a reintroduced banner would have to add its own notification channel (e.g. dispatch a new event from `checkStaleBuild()` and listen for it) and do the Android-Chrome dance (disconnect Pusher → postMessage SKIP_WAITING → `controllerchange`-fallback with cache-busted reload).

### Sentry visibility

[src/lib/sentry.ts](src/lib/sentry.ts) tags every event with `build_commit` and `build_time` from `__BUILD_COMMIT__` / `__BUILD_TIME__`. Use Sentry Discover with `tag:build_commit:<sha>` to measure how a stale cohort drains over time after a deploy. `release` is `nexus-react@<commit>`.

### Things to never reintroduce

- Blanket globs like `'**/*.{js,css,html,ico,png,svg,woff2}'` copied from the vite-plugin-pwa README — precaching *every* HTML file and every heavyweight chunk is the original sin that caused six months of staleness incidents. The explicit `globPatterns` / `globIgnores` lists are the fix. Note `index.html` itself IS precached on purpose (clean-install offline fallback, and `precacheFallback` for the public shell rule depends on it) — do not remove it.
- `navigateFallback: 'index.html'` — vite-plugin-pwa's default. Silently registers a precache-first NavigationRoute *before* any runtimeCaching rules. Always set to `null` when using network-first/network-only navigation.
- `/clear-site-data` nginx route — older SWs intercepted it and served the precached SPA shell. Useless for actually-stuck users. Use `/api/sw-reset` only (the universal `/^\/api\//` denylist guarantees every SW we've ever shipped passes it through).
- `sw-rescue.js`-style force-eviction shims — not needed when deploys propagate via network-first/network-only navigation.
- Manual "Update to latest version" buttons — users should never need one.

## Prerender Pipeline (bot-only, detached, three-layer freshness)

Prerendered HTML is **served only to SEO crawlers**, never to real users. This keeps snapshot freshness completely separate from user-facing correctness.

### Three-layer freshness (the "big names do this" pattern)

The engine has three independent freshness mechanisms working together — defence in depth so no single failure leaves stale pages live:

1. **Observer hook (millisecond layer).** Eloquent model observers (`PostPrerenderObserver`, `ListingPrerenderObserver`, `EventPrerenderObserver`, `JobVacancyPrerenderObserver`, `GroupPrerenderObserver`, `MarketplaceListingPrerenderObserver`, `MarketplaceCategoryPrerenderObserver`, `VolOpportunityPrerenderObserver`, `IdeationChallengePrerenderObserver`, `PagePrerenderObserver`, `ResourceItemPrerenderObserver`, `CoursePrerenderObserver`, `CourseSectionPrerenderObserver`, `CourseLessonPrerenderObserver`) delete the affected snapshot and enqueue a NORMAL-priority recache on every `saved`/`deleted` event. Wired in `AppServiceProvider::boot()`. To add a new content type, extend `PrerenderInvalidationObserver` and implement `routesFor()` — the base class handles the rest. Failures are swallowed and logged; the model save never blocks.

2. **Sitemap drift detector (minute layer).** `prerender:detect-drift` cron (every 2 min) walks each tenant's sitemap, parses `<lastmod>` values, and compares against snapshot mtimes. Anything stale gets a HIGH-priority recache. This is the safety net for code paths that bypass Eloquent (raw DB writes, queue jobs, migrations, admin tools that use the query builder). Cap: `--max-tenants` × `--max-routes` per pass so a single tick stays bounded.

3. **TTL auto-recache (hour/day floor).** `prerender:auto-recache` cron (every 20 min — `->cron('*/20 * * * *')` in `bootstrap/app.php`) reads `config/prerender.php`'s per-pattern TTLs (homepage `/` 6h; the `/blog` index 12h — the only index pattern; item patterns `/blog/**` and `/page/*` 7d; legal/static pages 30d, except `/changelog` at 7d; `default` 7d) and enqueues LOW-priority recaches for snapshots past their TTL. Backstop for the cases where both observer and drift detector miss (e.g. content that doesn't appear in the sitemap).

External-system hook: `POST /api/v2/admin/prerender/invalidate` with HMAC or Bearer auth lets headless CMS / marketing automation tools invalidate routes without going through the model layer.

### Priority lanes

`prerender_jobs.priority` (1–9, lower wins):
- **3 HIGH** — drift detector, user-initiated force-refresh
- **5 NORMAL** — observer-triggered recache, manual API enqueue, bulk admin UI recache
- **7 LOW** — TTL auto-recache, after-purge auto-recache

Claim order is `(priority, queued_at, id)`. Duplicate-enqueue at a higher priority promotes the existing queued row.

### HTTP status code propagation (Phase 1.2)

The React app emits `<meta name="prerender-status-code" content="404|410|503">` for soft-error pages (community-not-found, deleted listings, maintenance mode). The worker extracts this and:

1. Writes a `_status` sidecar next to `index.html` containing the integer status.
2. Adds an entry to `.prerender-status-overrides.json`.

The bash orchestrator (`write_nginx_status_overrides` in `scripts/prerender-tenants.sh`) rebuilds the aggregate from every live `_status` sidecar into `.status-overrides.list` inside the shared prerender volume — `/usr/share/nginx/html/prerendered/.status-overrides.list`, overridable via `PRERENDER_STATUS_OVERRIDE_LIST`. nginx `include`s that file inside a `map` block ([nginx.bluegreen.conf](nginx.bluegreen.conf)), so it must contain only `"key" "value";` data lines; the server block then uses `error_page` + conditional `return` to serve the snapshot body with the correct HTTP status. The list is validated by `nginx -t` before reload; the prior version is restored from the `.bak` copy on validation failure.

### AI-friendly Markdown variant (Round 5)

After rendering the HTML snapshot, the worker also extracts a clean Markdown body (`index.md` sidecar). nginx's `$nexus_is_ai_bot` map routes GPTBot, ClaudeBot, Perplexity, ByteSpider, Common Crawl, Google-Extended, etc. to the `.md` variant first via `try_files` — falling back to the `.html` if the markdown isn't available. AI crawlers ingest Markdown more token-efficiently than HTML; this puts NEXUS ahead of every competitor that serves raw HTML to LLM bots.

### Sitemap-driven route planning

`prerender-tenants.sh` invokes `php artisan prerender:plan-routes` to get the full per-tenant URL list (static floor + every dynamic URL `SitemapService` publishes — blog posts, listings, events, jobs, KB articles, etc). The hardcoded `PUBLIC_ROUTES` array is the fallback when the PHP container is unavailable. `--no-sitemap` or `NEXUS_PRERENDER_NO_SITEMAP=1` forces fallback mode.

### Crawler analytics (Phase 3.2)

nginx writes a JSONL bot-only access log to the shared prerender volume (`.bot-access.jsonl`). The admin Analytics tab reads it via `crawlerAnalytics()`, surfacing hits by status / crawler / host, top URIs, IP-verification rate, and the spoofed-vs-verified breakdown for major crawlers. IP verification uses `/etc/nginx/prerender-trusted-bot-ips.list` (refreshed weekly by `scripts/refresh-bot-ip-ranges.sh` pulling Google / Bing / DuckDuckGo / Apple feeds).

### Admin UI (`/admin/seo/prerender`)

**Access:** platform super-admin only. Sidebar hides the entry for tenant super-admins because the engine operates cross-tenant. Backend uses `requirePlatformSuperAdmin` on every mutating endpoint.

Nine tabs:
- **Overview** — health banner (auto-hides when green), KPIs, Freshness automation, **TTL inspector** (which `config/prerender.php` pattern owns a route + the TTL), **Sitemap explorer** (static + dynamic routes per tenant), wildcard purge, force-refresh
- **Tenant safety** — per-tenant inspector to run before refreshing or deleting anything: compares the tenant's route plan against the saved cache and explains why each snapshot exists
- **Inventory** — every snapshot with HTTP status, SEO score, age, content/asset flags, integrity (sha256 sidecar check); bulk-select + bulk-recache; filter by host/route/staleness/status/issue
- **Coverage** — per-tenant expected-vs-rendered matrix with "Refresh all stale" bulk action
- **Jobs** — priority swimlanes (HIGH/NORMAL/LOW chips), retry-failed button, realtime updates via Pusher
- **Analytics** — bot crawl activity, top URIs, verified vs spoofed
- **Events** — JSONL deploy event stream
- **Failures** — recent failed paths in the backoff window
- **History** — every mutating action audited (actor/IP/UA/outcome/details), filterable by action, **Export CSV**

### Self-healing & ops (Round 2-4)

**Circuit breaker.** 5 failed jobs in 10 min trips the queue for 15 min (auto-resume). `claimNextJob` returns null while tripped. Manual reset via `POST /api/v2/admin/prerender/reset-breaker` or the UI "Close breaker now" button.

**Per-tenant concurrency cap.** One in-flight job per tenant (NULL-tenant jobs serialize on the host worker lock). Stops a slow tenant from starving others.

**Stale-job reaper.** `prerender:reap-stale` runs from the host cron file **only** (`/etc/cron.d/nexus-prerender-processor`, written by `scripts/deploy/phases/install-prerender-cron.sh` — `PRERENDER_REAPER_INTERVAL_MINUTES`, default 5, via `scripts/prerender-reap-stale.sh`). It is **not** in the in-container Laravel schedule: `bootstrap/app.php` `withSchedule()` registers only `prerender:detect-drift` and `prerender:auto-recache`. If that cron file goes missing the reaper stops entirely; the only detection is the 300s heartbeat expectation in `PrerenderService` turning the health check yellow then red.

**Scheduler liveness.** Every prerender scheduled task stamps `prerender:sched:<name>:last_ok_at` on success. `health()` checks each is fresh; yellow at 2× expected interval, red at 3×. Catches the silent "supervisord died" failure mode.

**Health endpoint** `GET /api/v2/admin/prerender/health` — traffic-light JSON. Always 200; status field carries `green|yellow|red`. Each check has an `action` string telling the operator exactly what to run. Rendered as a banner in the admin UI.

**Emergency reset.** UI "Emergency reset" button (only visible when health ≠ green) calls `POST /api/v2/admin/prerender/reset-queue`, which requeues every `claimed`/`running` row older than 30 min AND clears the breaker. Rate-limited (2/5min/user), audited.

**Audit log.** `prerender_audit_log` table persists every mutating action with actor/IP/UA/outcome/sanitised details. Secret keys (`password`/`token`/`secret`/`api_key`/`authorization`/`bearer`) auto-redacted. Replay attempts on `/invalidate` are audited with `outcome=denied, reason=webhook_replay`.

**Webhook /invalidate auth** has three independent layers:
1. Bearer token = `config('prerender.webhook_token')`
2. HMAC-SHA256 of `"<X-Nexus-Timestamp>.<body>"` with that token, ±5 min skew, one-time-use nonce (sig replays within window are rejected)
3. Platform-super-admin session (UI fallback)

**Snapshot integrity.** Worker writes `index.html.sha256` next to every snapshot. Inspect drawer shows an `integrity` chip (`ok|missing|mismatch|unreadable`); mismatch is danger-coloured. Catches corruption, bit rot, hand-edits.

**CSV exports.** `GET /api/v2/admin/prerender/export/{audit|inventory|jobs}.csv` — streamed, 5,000 row cap.

**Observability artefacts** (committed):
- `docs-public/observability/prerender-grafana-dashboard.json`
- `docs-public/observability/prerender-alerts.yml` — 8 Prometheus rules (4 critical, 4 warning)
- `docs-public/observability/prerender-runbook.md` — alert-by-alert response steps

**Prometheus metrics worth knowing**: `nexus_prerender_health_status` (0/1/2 enum, alertable), `breaker_tripped`, `queue_oldest_age_seconds`, `failures_recent`, `coverage_ratio`, plus per-tenant `tenant_rendered{slug}` / `tenant_missing{slug}` gauges and per-status `jobs_total{status}` counters.

### Serving rules ([nginx.bluegreen.conf](nginx.bluegreen.conf))

A User-Agent regex map (`$nexus_is_seo_bot`) classifies the request. The composite key `$nexus_is_seo_bot:$arg_nexus_prerender_bypass` then routes:

- **Real user (any UA not matching the bot list):** never sees a snapshot. `try_files` falls through to `/index.html` and the SPA boots normally.
- **Bot, no bypass:** served `/prerendered/$host$uri/index.html` if it exists, otherwise the SPA.
- **Playwright worker (`?nexus_prerender_bypass=1`):** always served the SPA, regardless of UA. Without this, the worker would render snapshots of snapshots.

HTML responses are sent with `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` and `Vary: User-Agent`. **CDN never caches HTML** — bots and users get different bytes for the same URL, so a per-URL CDN cache would poison across user-agents. Immutable assets (`/assets/*.js`/`.css`) remain cached at the edge as before.

### Why bot-only matters

Snapshots reference build-hashed asset URLs (`/assets/index-{HASH}.js`). When a deploy ships new hashes, those references go dead. Bots don't execute JS so they don't care. Users would 404 on the script tags and fail to hydrate — which is why pre-bot-only we had to invalidate every snapshot on every deploy and re-render the entire `(active tenants × 19 routes)` matrix from scratch.

With bot-only serving, `load_stale_cache_paths` in [scripts/prerender-tenants.sh](../scripts/prerender-tenants.sh) is now a no-op. Snapshots survive deploys indefinitely; they only need to be re-rendered when their content (DB-driven) changes.

### Snapshot persistence (shared volume)

In production blue/green ([compose.bluegreen.yml](../compose.bluegreen.yml)), both colors mount the same external named volume `nexus-php-prerendered` at `/usr/share/nginx/html/prerendered`. **Snapshots are shared between colors and persist across deploys.** When the inactive color spins up, it sees the same prerender cache the active color has been using.

Practical consequences:

- Snapshots survive container rebuilds, deploys, and color switches automatically. No copy step is needed at cutover.
- The pre-cutover [warmup phase](../scripts/deploy/phases/warmup-prerender-snapshots.sh) auto-detects the shared mount and skips with `event:"skip","reason":"shared_volume"`. It still works as a fallback in setups without the shared volume (legacy single-color, dev compose).
- Concurrent writes from two prerender runs are prevented by the lock-or-cancel logic, not by isolation.

### Deploy-time behavior

The prerender phase runs **detached from the deploy critical path** ([bluegreen-deploy.sh](../scripts/deploy/bluegreen-deploy.sh)). After traffic switch + Cloudflare purge, the deploy script forks the prerender into a backgrounded subshell and exits. The deploy lock releases immediately; the next deploy is unblocked even if prerender is still running. Prerender logs land in `$LOG_DIR/prerender-detached-{commit}-{ts}.log`.

If a newer deploy starts before the prior prerender finishes, the new deploy's prerender phase **supersedes** the old one (lock-or-cancel in `acquire_lock`):
1. Reads the prior pid from `$LOCK_DIR/pid`.
2. `docker stop nexus-prerender-worker` — kills the Playwright container directly. The container has a stable `--name` so we don't have to discover its ID.
3. SIGTERM → 10s grace → SIGKILL the prior bash.
4. Reclaims the lock and starts fresh.

### Skip-on-clean

[scripts/deploy/phases/prerender-tenants.sh](../scripts/deploy/phases/prerender-tenants.sh) compares HEAD against `.last-successful-prerender`. If `git diff --quiet` reports no changes under `react-frontend/` or `public/`, the prerender is skipped entirely — no Playwright container starts, no lock contention. Override with `PRERENDER_SKIP_ON_CLEAN=0` or `--force-prerender`.

### Manual operations

```bash
# Re-render everything
sudo bash scripts/prerender-tenants.sh --force

# Re-render one tenant
sudo bash scripts/prerender-tenants.sh --tenant hour-timebank

# Re-render specific routes across all tenants
sudo bash scripts/prerender-tenants.sh --routes /about,/blog

# Stop a stuck worker (if cleanup trap missed)
sudo docker stop nexus-prerender-worker
sudo rm -rf /opt/nexus-php/.prerender-lock
```

## Commands

```bash
npm install              # Install dependencies
npm run dev              # Dev server (localhost:5173)
npm run build            # Production build
npm test                 # Run Vitest tests
npm run lint             # ESLint (src, max 10 warnings) + tsc --noEmit
```

## 🔴 Deployment Warning

**NEVER build locally and upload `dist/` to production!** Local builds use wrong environment variables. Always rebuild on the server. See [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).
