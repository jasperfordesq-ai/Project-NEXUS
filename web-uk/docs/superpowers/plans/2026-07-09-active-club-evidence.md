# Active Club Evidence Parity Slice

> **Historical plan:** Retained for implementation history only. Do not use it
> as a current queue; read `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`.

## Source evidence

- Laravel `AlphaController::clubs()` requires a signed-in user, then checks
  `vol_organizations` for an active `org_type = club` row in the current tenant
  before applying the search query.
- Laravel returns `404` when the tenant has no active clubs.
- Laravel still renders the Clubs page for a signed-in user when a search query
  has no matches, as long as the tenant has at least one active club.
- Laravel `explore.blade.php` uses the same active-club existence check before
  showing the Clubs card.

## Web UK gap

`src/routes/clubs.js` currently renders a signed-in empty Clubs page whenever
`getClubs()` returns an empty list. That exposes `/clubs` for tenants where
Laravel would 404.

## Implementation plan

1. Add focused Jest coverage proving signed `/clubs` returns 404 when the
   Laravel-backed club list is empty.
2. Add focused Jest coverage proving `/clubs?q=missing` can still render 200
   with an empty result when an unfiltered probe proves the tenant has active
   clubs.
3. Update `src/routes/clubs.js` to treat an empty unfiltered club list as
   Laravel-equivalent no active club evidence.
4. For searched empty results, issue a minimal unfiltered probe before deciding
   whether to 404 or render the empty search result.
5. Refresh the route matrix docs and update handoff/matrix notes with the
   route-level active-club certification.
6. Verify with the focused Jest tests, the broader Web UK suite, lint, and the
   route matrix before committing only Web UK slice files.
