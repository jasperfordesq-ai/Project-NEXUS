# ASP.NET Backend — Plain-English Roadmap

Status: **Canonical current - owner-facing summary** (technical detail lives
in [CURRENT_ASPNET_CONTRACT_STATUS.md](CURRENT_ASPNET_CONTRACT_STATUS.md))

Last updated: 2026-08-20

This page explains where the ASP.NET backend actually is, in the language of
the platform rather than points. It is updated every time the score is.

## What this project is

The platform runs on the Laravel backend in production. The ASP.NET backend
is a second engine being built to behave identically, so that either of the
two websites (the main app and the accessible site) can run on either engine
just by changing a setting. It is a development project: putting it in front
of real members is a separate decision that has not been made.

## What works today, proven by actually using it

A member can open the main app pointed at the ASP.NET backend and: sign in,
see the dashboard, browse the feed and scroll it, use the feed's filter tabs,
browse listings and events, **create a listing, post to the feed, transfer
credits, and RSVP to an event** — all through the app's own screens, with the
same behaviour as on Laravel. An automated browser test now walks all of that
on every run (16 steps, zero errors), so it cannot quietly break again.

The accessible site starts against ASP.NET and serves its main pages, but its
testing has been by hand so far — building its automated test is next.

## What does not work yet, honestly

- **Most screens are still unproven.** The main app has ~575 screens and the
  accessible site ~707. We have properly exercised a handful. "Unproven" is
  not "broken" — but we treat it that way until walked.
- **About 319 backend endpoints answer "success" while doing nothing.** These
  are the biggest source of false confidence and are being replaced or
  deleted as each screen is certified.
- **Known specific faults, queued:** the dashboard's "Upcoming events" shows
  finished events and ignores the requested count; the feed sidebar returns
  raw database records; multi-photo posts show one photo (no table for the
  extras yet); voice messages and message attachments can't be fetched.
- **Behind the scenes:** only 26 of Laravel's 69 scheduled background tasks
  exist; search indexing, push notifications and payment webhooks are not
  wired up; 215 of Laravel's database tables have no counterpart yet.
- **The production hard stop:** the live ASP.NET database has had **no
  successful backup since March** while the app rewrites its schema on every
  start. Until backups work, nothing about this backend can touch production.
  This is infrastructure, not code, and it is in the owner's hands.

## The score, and why it hasn't been going up

The formal score is a strict 1,000-point audit. It fell from 712 to 598 in
August **because the measuring stick improved, not because the backend got
worse** — audits found more surface to measure. Worse, weeks of real
improvement was never formally "banked", so the number sat still while the
work moved. Both problems are fixed as of 2026-08-20: a fresh score
(**Baseline 3**) is being banked on regenerated evidence, and from now on the
score is re-banked every time a batch of work is proven, not months later.

## The plan from here

1. **Now:** bank Baseline 3 (waiting only on the automated checks for
   today's push).
2. **Next:** certify the twelve everyday member journeys in a real browser —
   sign-up through settings — fixing whatever breaks, on both websites.
   This attacks the weakest category (frontends proven working: 10 of 125).
3. **Then:** the remaining feature screens, the admin panel, the accessible
   site in full, the missing background tasks, and the do-nothing endpoints.
4. **Named exclusions** (won't be in any score until the owner decides):
   live payment-provider tests, production operation, and the backup fix.
