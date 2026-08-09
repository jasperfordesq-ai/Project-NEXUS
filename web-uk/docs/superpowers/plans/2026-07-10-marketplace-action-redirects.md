# Marketplace Action Redirect Tenant Awareness

> **Historical plan:** Retained for implementation history only. Do not use it
> as a current queue; read `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`.

## Goal

Move `apps/web-uk/src/routes/marketplace-actions.js` POST exits behind the
active tenant URL helper so marketplace workflows do not rely on flat
`/marketplace...` redirects before shared-mount or custom-domain rewriting.

## Source Of Truth

- Laravel accessible routes: `C:\platforms\htdocs\staging\routes\govuk-alpha.php`
- Laravel tenant/custom-domain behavior:
  `C:\platforms\htdocs\staging\app\Core\TenantContext.php`,
  `EnsureAccessibleCustomDomain.php`, `InjectHostTenantSlug.php`, and
  `StripTenantSlugOnAccessibleDomain.php`
- Web UK target: `apps/web-uk/src/routes/marketplace-actions.js`

## TDD Slice

1. Add a source regression proving marketplace action redirects use
   `redirectTo(res, ...)` and `res.locals.urlFor` instead of raw
   `res.redirect('/marketplace...')`.
2. Add shared-mount behavior coverage proving a no-JS seller coupon validation
   POST under `/acme/accessible` redirects back under the same tenant mount and
   does not call Laravel APIs.
3. Implement a local `redirectTo()` helper backed by `res.locals.urlFor`.
4. Convert auth-required, validation, success, and failure redirects across
   listing, buyer, offer, report, order, onboarding, pickup-slot, and coupon
   marketplace action handlers.
5. Refresh docs and generated route matrix, then run focused and broad Web UK
   verification before committing only Web UK files.
