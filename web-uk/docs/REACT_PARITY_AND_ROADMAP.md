# Accessible frontend: parity with React, deliberate absences, and roadmap

**First written 2026-08-17.** This is the first time `web-uk` has been measured against
**React**. Read it alongside [CURRENT_WEBUK_PRODUCTION_STATUS.md](CURRENT_WEBUK_PRODUCTION_STATUS.md),
which scores production readiness, and
[../../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md](../../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md),
which is the single place the takeover status is stated.

## 🔴 Why this document exists

`docs/generated/accessible-route-matrix.*` reports **707 of 707 routes matched**, and that
number is true — but it measures parity with the **deleted Laravel Blade accessible
frontend**, frozen at `scripts/blade-route-inventory.frozen.json` on 2026-08-14. Anything
React can do that Blade never did is **invisible** to it.

That blind spot is not theoretical. It hid a completely dead page: `/page/:slug`, a
community's own published CMS page, which React served and `web-uk` answered with 404
because `static-pages.js` held an empty page map. Blade never had the page, so the matrix
could never have flagged it. It was found by reading React's route files instead, and fixed
the same day.

**Treat the 707/707 figure as Blade-coverage evidence, never as React parity.**

## The measurement

Method: static enumeration of React's route registries
(`react-frontend/src/routes/{AppRoutes,PublicAppRoutes,AuthRoutes,sharedPublicFeatureRoutes}.tsx`)
against every route file in `web-uk/src/routes/` plus the routes declared inline in
`web-uk/src/server.js`, with paths normalised and every non-matching route reviewed by hand
because the two sides often use different URLs for the same capability.

| | Count |
|---|---:|
| Distinct member-facing React routes (excludes admin, super-admin, broker, partner timebanks, caring operations) | **251** |
| Have a `web-uk` equivalent | **179** |
| — of which identical path | 132 |
| — of which same capability at a different URL | 47 |
| **No `web-uk` equivalent** | **72** |

**Member-facing route coverage: 71%.**

`web-uk` itself serves **more** URLs than React has routes (~334 distinct GET pages), because
it splits React's tabbed pages and modals into one page per tab or step — which is the
correct HTML-first pattern, not duplication.

🔴 **The reverse direction is clean.** Every `web-uk` route with no React equivalent was
reviewed and **none** represents a capability React lacks. They are all deliberate no-JS
patterns: one page per tab, GET confirmation pages for destructive actions React does in a
modal, server-rendered downloads and feeds (`.ics`, `.csv`, `.xml`, certificates), and
GDS-specific pages (`/account`, `/report-a-problem`, `/legal-acceptance`,
`/service-unavailable`, `/guide`).

## Deliberate absences — decided, not gaps

An audit that cannot tell a decision from a defect re-argues the same items forever. Each
entry below is a recorded decision with a date. **Do not report these as parity gaps.**

### Platform administration — NOT REQUIRED (owner decision, 2026-08-17)

> "Creating an admin panel for the accessible front end is absolutely not required."

That removes **364 routes** from the parity question outright:

| Panel | Source | Routes |
|---|---|---:|
| Admin | `react-frontend/src/admin/routes.tsx` | 260 |
| Caring operations (staff) | `react-frontend/src/caring/routes.tsx` | 37 |
| Broker | `react-frontend/src/broker/routes.tsx` | 25 |
| Super-admin | `react-frontend/src/super-admin/SuperAdminRoutes.tsx` | 24 |
| Partner timebanks | `react-frontend/src/partners/routes.tsx` | 18 |

`web-uk` already draws this line in practice: it carries everything a **member or a community
organiser** does — event moderation, group management, jobs pipeline and talent search,
organisation management, volunteering organisation admin, marketplace coupons — and nothing
platform-administrative. That boundary is now the stated policy.

### Caring Community / mutual aid — EXPERIMENTAL, deferred (owner decision, 2026-08-17)

> Marked **experimental and not needed in the accessible frontend yet**. On the roadmap for
> further investigation.

**24 member-facing React routes**, entirely absent from `web-uk` (verified: the string
`caring` appears nowhere in `web-uk/src/routes/` or `web-uk/src/views/` apart from one
incidental mention in `profile.js`):

`/caring-community/` plus `request-help`, `offer-favour`, `my-relationships`, `markt`,
`loyalty/history`, `future-care-fund`, `hour-transfer`, `hour-gift`, `safeguarding/report`,
`safeguarding/my-reports`, `providers`, `my-trust-tier`, `my-data-export`, `warmth-pass`,
`caregiver`, `caregiver/link`, `caregiver/cover`, `surveys`, `surveys/:id`, `projects`,
`projects/:id`, `civic-digest`, `success-stories`, `feedback`.

🔴 **Live-state evidence, measured 2026-08-17 against the production bootstrap API** — record
this, because it is the fact that makes the deferral a real decision rather than an
assumption. The feature key is **`caring_community`** (enforced via
`TenantContext::hasFeature('caring_community')`):

| Community | `caring_community` |
|---|---|
| `timebanking-org` | **true** |
| `agoris` | **true** |
| `hour-timebank`, `minehead-and-coast-timebank`, `bancosdetiempo-info`, `crewkerne-timebank`, `pairc-goodman`, `partner-demo`, `stratford`, `timebank-global`, `timebanks-us` | false |

So it is **on for 2 of 11 communities**, and `timebanking-org` is the community behind the
live accessible domain `accessible-uk.timebank.global`. The deferral is therefore accepted
with that known exposure, not in ignorance of it.

**Open questions for the investigation** (answer these before scoping any build):

1. Is the module actually **used** by `timebanking-org` and `agoris` members, or enabled but
   idle? Needs usage data, not a feature flag.
2. Which of the 24 routes are load-bearing versus experimental? Several
   (`markt`, `warmth-pass`, `future-care-fund`, `loyalty/history`, `civic-digest`) read as
   regional pilots rather than core mutual aid.
3. `safeguarding/report` and `safeguarding/my-reports` are the two with the strongest
   accessibility argument — raising a concern is exactly what a member on an accessible
   frontend may need most. Consider whether those two should be split out and delivered
   ahead of the rest.
4. `hour-transfer` and `hour-gift` move time credits. Those need the same double-submit,
   idempotency-key and confirmation treatment the wallet already has here, so they are not
   simple ports.
5. Does the module assume real-time or JS-dependent interaction anywhere that would need an
   HTML-first redesign rather than a port?

### Genuinely not applicable to a no-JavaScript HTML frontend

| React route | Why, and what covers it here instead |
|---|---|
| `/marketplace/map` | Map browsing needs JS. `/marketplace/search` and `/marketplace/category/:slug` reach the same inventory as text |
| `/marketplace/seller/pickup-scan` | Camera QR scanning. `web-uk` has the server-side equivalent `POST /marketplace/slots/scan` |
| `/advertise/push-campaigns` | Push notifications |
| `/install-app` | PWA install |

### Prospect, partner and developer collateral — owner decision, low priority

20 routes: `/changelog`, `/development-status`, `/developers` (+ `auth`, `endpoints`,
`webhooks`), `/impact-report`, `/impact-summary`, `/strategic-plan`, `/partner`,
`/partner-analytics/dashboard`, `/pilot-apply` (+ `status/:token`), `/pilot-inquiry`,
`/platform/{terms,privacy,disclaimer}`, `/pricing`, `/regional-analytics`,
`/social-prescribing`. These are marketing and developer pages, not member capability.
`/pricing` is partly covered already by `web-uk/src/routes/premium.js`.

## Roadmap — the work that IS needed

Ordered. "Real gap" counts exclude everything in the deliberate-absences section above.

| # | Item | Routes | Why it matters |
|---|---|---:|---|
| 1 | **Identity verification** — 🔴 **BLOCKED, see below** | 3 | `web-uk` shows verification *status* but has no route to START verification. The ID check itself needs no JavaScript; the **fee** step does, and the fee-free variant is unreachable for every live community. Needs one Laravel addition |
| 2 | **Emailed-token pages** + the email-URL fix below | 5 | Guardian consent (event + volunteering), support-action confirm, invite-code join, group-invite accept |
| 3 | Social / OAuth sign-in — 🔴 **switched off platform-wide; zero member impact today** | 1 | `auth.js` implements password, 2FA, forgot and reset only. But no provider is configured in production, so nobody can use social sign-in on React either. See below |
| 4 | Clubs / Verein dues | 4 | `/clubs` index exists; dues, imports and membership invitations do not |
| 5 | Marketplace remainder | 4 | Become-partner application, own reports list, seller shipping options |
| 6 | Smaller singles | 5 | Wallet regional points, volunteering shift check-in token, donation receipt, municipality calendar, ad campaigns |
| 7 | **Capability comparison of the 179 matched routes** | — | See the honesty note below. This is the largest unmeasured risk |
| 8 | Generated, CI-gated React-parity matrix | — | So this document stops being a manual exercise and becomes a number that CI watches |

### 🔴 Item 1 (identity verification) is BLOCKED, and the blocker is not in `web-uk`

Contracts mapped 2026-08-17. The encouraging part: **the ID check itself needs no
JavaScript.** `POST /api/v2/identity/start` returns a `redirect_url` which is Stripe's
**hosted** verification page (`app/Services/Identity/StripeIdentityProvider.php:94-103`,
Stripe's `VerificationSession.url`) — React merely opens it in a tab, and the mobile app
opens it with `Linking.openURL`, so `res.redirect(303, …)` is a valid equivalent. `web-uk`
would need no Stripe secret, and no publishable key either.

Then three measured facts stop it being worth building yet.

**1. The fee step cannot be done HTML-first.** `POST /api/v2/identity/create-payment`
returns only a PaymentIntent `client_secret`
(`app/Services/Identity/IdentityVerificationPaymentService.php:100-113`). Confirming a
PaymentIntent requires Stripe.js. There is no Checkout Session, no hosted payment page and
no payment link anywhere in the identity fee path. The default fee is **500 (€5.00)** and
only a super admin can set it to 0 (`IdentityVerificationPaymentService.php:30-35`), and the
value is an authenticated tenant setting so it could not be sampled per community from
outside. 🔴 This is the **same** blocker `web-uk` already met and honestly declined for
marketplace orders — see the comment at `web-uk/src/routes/marketplace-actions.js:937-947`,
which refuses rather than "creating and discarding an intent or claiming that payment
started". Any build here must follow that precedent.

**2. The fee-free flow is unreachable for every live community.** `/verify-identity` (the
registration-gated variant) has no fee and no date-of-birth step, so it *is* fully
implementable — but it only opens when a community's `registration_mode` is
`verified_identity` or `government_id`. Measured on the public
`/api/v2/auth/registration-info` for `hour-timebank`, `timebanking-org`,
`minehead-and-coast-timebank`, `agoris`, `timebanks-us` and `timebank-global`: **all six are
`open_with_approval`.** So building that page today delivers a page no member can reach.

**3. Stripe returns the member to React, not here.** `return_url` is built from
`TenantContext::getFrontendUrl()` (`StripeIdentityProvider.php:89-92`), which never consults
`tenants.accessible_domain` — the same fault described in the next section. Mitigation
exists and is cheap: `GET /api/v2/identity/status` reconciles against Stripe on **every**
call, so a member who comes back to the page by any route gets the correct terminal state. A
GOV.UK "check your status" link is the accessible equivalent of React's spinner-poll; no
polling loop is needed, because a webhook and an hourly `nexus:identity:poll-stuck` command
also settle it.

**What would unblock it — one owner decision, outside `web-uk`:** a Laravel endpoint that
returns a Stripe **Checkout Session** URL for the identity fee (hosted, no JS), which would
also close the identical marketplace-payment gap. That touches payments and is outside
`web-uk/**`, so it needs explicit authorisation. Until then, note that `identity_verification`
defaults to **ON** (`app/Services/TenantFeatureConfig.php:57`) and was measured **true for
all five communities sampled**, so the capability is advertised platform-wide while being
unreachable on the accessible frontend.

Also recorded for whoever builds it: roughly **20–28 new translation keys** are needed across
eleven locales (no identity page copy exists in the `govuk_alpha*` namespaces today; only the
badge labels `verification_type_id_verified` and `verification_badges.id_verified` are
reusable). Put them in a new `identity` block in `lang/en/govuk_alpha_settings.php`, which
the sync script already globs. `web-uk` also needs `identity_verification` added to
`src/middleware/tenant-feature-gates.js` with **two** prefix entries, because
`/verify-identity` does not prefix-match `/verify-identity-optional`.

### 🔴 Item 3 (social sign-in): the gap is real in code, and has NO member impact today

Measured 2026-08-17, and this corrects an earlier claim in this project's own notes that a
member whose only credential is a Google login "cannot sign in at all". **There are no such
members**, because social sign-in is not switched on anywhere:

- `GET /api/v2/auth/oauth/enabled-providers` — a public endpoint — returns
  `{"success":true,"providers":[]}` for `hour-timebank`, `timebanking-org`, `agoris` and
  `timebanks-us`.
- Production `/opt/nexus-php/.env` carries **no** `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `FACEBOOK_CLIENT_ID` or `APPLE_CLIENT_ID` (checked read-only, key
  presence only).

So no member on **either** frontend can sign in with Google, Facebook or Apple. `web-uk`
lacking the route changes nothing for anybody until a provider is configured — and when one
is, `web-uk` must render buttons only for providers that endpoint actually reports, never a
hardcoded set.

**Encouraging, for whenever it is switched on:** the backend design is friendly to an
HTML-first frontend, unlike the Stripe fee path. The dance is server-side —
`GET /v2/auth/oauth/{provider}/redirect` starts it, the provider calls back to **Laravel** at
`/v2/auth/oauth/{provider}/callback` (so no provider configuration needs to know the
accessible domain exists), and `POST /v2/auth/oauth/exchange` trades a one-time code for
tokens. `web-uk` already stores `token`/`refresh_token`/`tenant_slug` in signed HTTP-only
cookies, so the final step reuses existing plumbing.

**Contracts fully mapped 2026-08-17.** Providers are **Google and Facebook only** — Apple is
explicitly refused (`app/Services/Auth/SocialAuthService.php:1078-1088`, and the route
constraint is `provider =~ google|facebook`). Enablement is **two layers, both of which must
pass**: the platform env kill switch `OAUTH_ENABLED`, and the per-tenant setting
`auth.oauth.enabled_providers` (a JSON list). It fails closed, which is why the endpoint
returns `[]` today. `GET /v2/auth/oauth/enabled-providers` is the ONLY source of that list —
`tenant/bootstrap` does not carry it, and `bootstrap`'s `social_*` fields are social-*media*
links, not OAuth.

**The provider side is genuinely fine.** The OAuth `redirect_uri` is a platform env var
(`GOOGLE_REDIRECT_URI`) pointing at **Laravel's own** callback, not at any frontend and not
tenant-derived. Nothing about `web-uk` ever needs registering with Google or Facebook — a
real difference from the Stripe case.

🔴 **The blocker is the LAST internal hop.** After a successful dance,
`SocialAuthController.php:104`, `:121` and `:164-170` build the return target as
`TenantContext::getFrontendUrl() . getSlugPrefix() . '/auth/oauth/callback?code=…&flow=…'`.
That never consults `tenants.accessible_domain`, so a member who begins on the accessible
domain is redirected to **React** at the final step — and because the one-time code is bound
to their own browser, the exchange would *succeed there*, silently signing them into the
React app instead. No amount of `web-uk` code prevents that.

**Minimum backend change to unblock (small, and the pieces already exist):** make that base
accessible-aware. `config('app.accessible_frontend_url')` already exists (`config/app.php:14`)
and is already trusted elsewhere (`WebAuthnController`, `AuthenticationMethodGuard`,
`TenantHierarchyService`). The clean form is to record the initiating surface in the signed
`state` — `buildState()` already carries six fields and is HMAC-signed with `config('app.key')`,
so it is tamper-proof — and pick the base from the verified state in the callback. This is
outside `web-uk/**` and needs owner authorisation.

**HTML-first IS achievable once that lands.** The buttons use no JS SDK and no popup: React
fetches `/v2/auth/oauth/{provider}/redirect`, reads `redirect_url` from the JSON and does a
top-level navigation, which an Express POST handler can replace with a `302`. The mandatory
PKCE-style browser binding needs no browser: generate the verifier with Node
`crypto.randomBytes(32)`, derive `base64url(sha256(verifier))` as the challenge, and hold the
verifier in a **signed HTTP-only cookie with `sameSite: 'lax'`** (`strict` would be dropped by
the cross-site redirect and break every sign-in). The final envelope from
`POST /v2/auth/oauth/exchange` carries `access_token`, `refresh_token`, `expires_in` and
`refresh_expires_in` — exactly the four fields `web-uk`'s existing `rotatingSessionFrom()` and
`setAuthCookies()` need, so the session plumbing is reused unchanged.

🔴 **A design problem specific to this frontend, worth solving before building.** The OAuth
routes are throttled 30 requests/minute keyed by caller IP. React calls them from the
member's browser, so each member gets their own budget. `web-uk` would call them from the
Express server, so **every member shares one bucket keyed on the container IP** — 30 sign-in
starts per minute for the entire accessible frontend — and `RouteServiceProvider` deliberately
does not read forwarded-IP headers, so it cannot be fixed by forwarding the client IP. Two
consequences: cache `enabled-providers` server-side (the `CACHE_TTL.BOOTSTRAP` pattern in
`src/lib/api.js` is the model — do NOT call it on every login render), and ask for a
per-tenant or higher limit on the start endpoint.

**Behavioural limits to design the pages around, not to discover later:**

- **Members with 2FA are hard-blocked** from social sign-in — it fails closed, because the
  callback cannot complete the TOTP challenge contract.
- **Every failure collapses into one opaque `oauth_failed`** — 2FA-required, gate-blocked,
  unverified email, closed registration and tenant mismatch are indistinguishable. Plan one
  honest generic error page with a clear route back to password sign-in.
- **`intent=login` cannot create an account.** A first-time social user must arrive via
  `intent=register`, so sign-in and sign-up need separate entry points or the new member hits
  a dead end.
- **Facebook can never auto-link or auto-register** — the email-ownership proof always fails
  for it, so it works only for returning members who already have a linked identity.
- **Google only qualifies for `@gmail.com` or Workspace accounts** carrying an `hd` claim; a
  Google account on a personal custom domain is refused.
- Identities are **tenant-scoped**; the same Google account already bound to another community
  is refused.

**Translations are cheaper than feared:** React already carries the whole `oauth.*` block in
all eleven locales. Port those English strings into a new `oauth` section in
`lang/en/govuk_alpha.php` and seed the other ten from React's existing translations — a
mechanical port, not new copy. Drop the Apple strings.

**Recommendation: do not build until BOTH a provider is configured AND the callback base is
made accessible-aware.** Either one missing means the flow cannot complete for a member on the
accessible frontend.

### 🔴 A correction that changes item 2's shape

These five pages were first reported as highest-severity on the grounds that "an emailed link
cannot choose its frontend, so a member on an accessible domain hits nothing." **That premise
is false**, verified in `app/Core/TenantContext.php::getFrontendUrl()`: it resolves the
tenant's own `domain` → the parent's domain → `FRONTEND_URL` → the `site_url` setting →
`APP_URL` → `app.project-nexus.ie`. It **never** consults `tenants.accessible_domain`, even
though `TenantContext` reads that column elsewhere.

So today every one of those emails points at **React**, and nobody is landing on a dead page
from an email. The real problem is different and worth stating plainly: **a guardian who
depends on the accessible frontend is emailed a React link.**

**Consequence for sequencing: fix the URL builder only once the pages exist.** Making
`getFrontendUrl()` accessible-domain-aware first would route those members to pages
`web-uk` does not yet have — turning a degraded experience into a broken one.

## 🔴 What this measurement does NOT prove

- **It compared route existence, not capability.** The 179 matched routes are **not** proven
  at parity. A page here could be read-only where React writes, or omit fields. This
  project has already been bitten by exactly that: nine real divergences were once found
  *inside* routes the Blade matrix counted as matched. Item 7 above is that work.
- **Feature flags were not evaluated per community** beyond `caring_community`. Clubs/Verein,
  municipality calendar and regional points may be dormant for most or all live communities,
  which would change their priority.
- **Nothing was verified at runtime.** This is static route reading. A registered route can
  still error, and a React route can be unreachable from its own navigation.
- One trap ruled out: `laravel-prep-pages.js` registers placeholder "still to be ported"
  stub pages for any matrix row marked `missing`, which would inflate coverage. Checked on
  2026-08-17 — **zero rows are marked missing, so zero stubs exist** and the route count is
  not inflated by them. It would inflate again the moment a row regressed to `missing`.
