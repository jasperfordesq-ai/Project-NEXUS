# React Route Testing Reference

Last reviewed: 2026-07-14

This guide records how Playwright tests should resolve and exercise React routes. It intentionally does not duplicate the complete route table: the route registries are the source of truth and change more often than a hand-maintained inventory can safely track.

## Authoritative route registries

| Surface | Source |
| --- | --- |
| Member and public application | [`react-frontend/src/routes/AppRoutes.tsx`](../../react-frontend/src/routes/AppRoutes.tsx) |
| Authentication entry points | [`react-frontend/src/routes/AuthRoutes.tsx`](../../react-frontend/src/routes/AuthRoutes.tsx) |
| Public-only startup shell | [`react-frontend/src/routes/PublicAppRoutes.tsx`](../../react-frontend/src/routes/PublicAppRoutes.tsx) |
| React administration | [`react-frontend/src/admin/routes.tsx`](../../react-frontend/src/admin/routes.tsx) |
| Broker workspace | [`react-frontend/src/broker/routes.tsx`](../../react-frontend/src/broker/routes.tsx) |
| Federation partner workspace | [`react-frontend/src/partners/routes.tsx`](../../react-frontend/src/partners/routes.tsx) |
| Caring Community administration | [`react-frontend/src/caring/routes.tsx`](../../react-frontend/src/caring/routes.tsx) |

`AppRoutes` mounts the separate shells at `/admin/*`, `/super-admin/*`, `/broker/*`, `/partner-timebanks/*`, and `/caring/*`. The retired `/admin-legacy/` and legacy PHP frontend are not React test targets.

## Tenant-aware navigation

The E2E default is the `hour-timebank` tenant. Always build member, public, and React-admin navigation through `tenantUrl()` from [`e2e/helpers/test-utils.ts`](../helpers/test-utils.ts):

```ts
await page.goto(tenantUrl('dashboard'));
await page.goto(tenantUrl('admin/users'));
```

The helper accepts paths with or without a leading slash and emits `/{tenantSlug}/{path}`. Set `E2E_TENANT` to exercise another tenant and `E2E_BASE_URL` only when deliberately targeting a non-default environment.

## Current route boundaries

Use the route registry to confirm the exact gate before adding an assertion. Representative boundaries are:

| Boundary | Examples | Expected unauthorised or disabled behaviour |
| --- | --- | --- |
| Public layout | `/`, `/about`, `/help`, `/terms`, `/privacy`, `/features` | Renders without member authentication. |
| Auth layout | `/login`, `/register`, `/password/forgot` | Renders without the normal application navigation. |
| Protected member routes | `/dashboard`, `/messages`, `/wallet`, `/settings` | Redirects an anonymous browser to login. |
| Module/feature-gated routes | `/listings`, `/groups`, `/events`, `/marketplace`, `/podcasts`, `/federation` | Redirects or renders the configured unavailable state when the tenant gate is off. |
| Role shells | `/admin/*`, `/super-admin/*`, `/broker/*` | Enforces the shell's role guard before rendering nested routes. |
| Tenant-specific content | `/partner`, `/impact-report`, `/strategic-plan` | Available to `hour-timebank`; other tenants are redirected to their About page. |

Do not infer public/protected status from a route name. Public module pages and protected create/manage pages can share a prefix, so check which registry declares the path.

## Maintained page objects

[`e2e/page-objects/index.ts`](../page-objects/index.ts) exports the maintained objects. Use only objects exported there:

| Area | Page objects |
| --- | --- |
| Authentication | `LoginPage` |
| Core member UI | `DashboardPage`, `FeedPage`, `WalletPage` |
| Listings | `ListingsPage`, `CreateListingPage`, `ListingDetailPage` |
| Messaging | `MessagesPage`, `MessageThreadPage`, `NewMessagePage`, `NewMessageModal` |
| Events | `EventsPage`, `CreateEventPage`, `EventDetailPage` |
| Groups | `GroupsPage`, `GroupDetailPage`, `CreateGroupPage` |
| Members | `MembersPage`, `ProfilePage`, `SettingsPage` |
| Administration | `AdminDashboardPage`, `AdminUsersPage`, `AdminListingsPage`, `AdminSettingsPage`, `AdminTimebankingPage`, `SuperAdminPage`, `BrokerControlsPage` |

Do not document or import a page object that is not exported from that index. Add the implementation and export in the same change as its first test.

## Selector and route practices

- Prefer roles, accessible names, labels, and stable `data-testid` values over implementation classes.
- Use `tenantUrl()` even for public routes so the test exercises explicit tenant resolution.
- Authenticate through the shared helpers or fixtures; do not duplicate token seeding in a spec.
- Expect feature-gated routes to vary by the active tenant fixture.
- Treat create and edit routes as distinct test cases even when they render the same component.
- Verify redirects by destination and visible outcome, not only by a transient loading state.
- Add route coverage near the owning feature spec under `e2e/tests/`; keep `smoke.spec.ts` focused on release-critical journeys.

## Verification

```bash
npm run test:e2e
npx playwright test e2e/tests/smoke.spec.ts --grep '@smoke' --project=chromium-modern
```

When a route changes, update its owning test/page object and this guide only if the routing model, shell boundaries, helper contract, or maintained page-object inventory changed.
