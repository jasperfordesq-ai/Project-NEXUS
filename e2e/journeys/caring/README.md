# Caring Community — caregiver-consent browser journey

Last reviewed: 2026-08-29

This directory holds the **three-actor browser journey** for the Caring Community
caregiver-consent lifecycle. It is deliberately **not** under `e2e/tests/`.

## Why it lives outside `e2e/tests/`

The root `playwright.config.ts` uses `testDir: './e2e/tests'` with
`testMatch: '**/*.spec.ts'`, and five broad projects (`chromium-modern`,
`firefox-modern`, `mobile-chrome`, `webkit-modern`, `mobile-safari`) each attach
`storageState: e2e/fixtures/.auth/user.json` and point at `E2E_BASE_URL`
(default `:5173`, which proxies to the `:8090` stack).

That stack's `nexus` database is a **production-derived snapshot of real
members**. This journey **writes** caregiver relationships, consent evidence and
safeguarding decisions. A spec placed under `e2e/tests/` would have been swept
into all five projects and run — five times over — against real member data,
with the wrong actor's session.

Keeping it here makes that isolation **structural** rather than a convention
someone has to remember, and makes the journey opt-in without relying on a
runtime flag that can be set by accident.

## The three actors

All three are **synthetic** accounts in the disposable community
`e2e-community`, seeded by `scripts/webuk-e2e-env.sh`:

| Role in the journey | Account | Password |
|---|---|---|
| Ordinary member proposing to be a caregiver | `e2e.user.a@project-nexus.local` | `TestPassword123!` |
| Ordinary member receiving care | `e2e.user.b@project-nexus.local` | `TestPassword123!` |
| Authorised staff reviewer | `e2e.admin@project-nexus.local` | `AdminPassword123!` |

A **fourth** actor, `e2e.other.admin@project-nexus.local`, sits in a *different*
community (`e2e-other`). Its only purpose is to demonstrate that tenant scoping
holds — a single-community fixture cannot show that either way.

These credentials are not secrets. They grant nothing outside the disposable
`nexus_webuk_e2e` database.

## Setup

```bash
# 1. Provision (idempotent). Brings the disposable environment up if needed,
#    applies pending migrations, and enables the caring_community module.
bash scripts/caring-e2e-provision.sh

# 2. Start a Vite pointed at the DISPOSABLE API.
#    🔴 NOT port 5173 — that one is the developer's own, against the
#    production-derived stack.
cd react-frontend && VITE_API_URL=http://127.0.0.1:8091 \
  npx vite --port 5174 --strictPort --host 127.0.0.1

# 3. Run the journey.
npm run test:e2e:caring
```

`bash scripts/caring-e2e-provision.sh --check` reports the state without
changing anything.

To wipe back to a clean seeded fixture:

```bash
bash scripts/webuk-e2e-env.sh reset && bash scripts/caring-e2e-provision.sh
```

## Two things the base environment does not do

`scripts/webuk-e2e-env.sh` builds the actors and communities, but the caregiver
journey needs two more steps, which `caring-e2e-provision.sh` adds:

1. **`php artisan migrate`.** The base environment loads the *committed schema
   dump*, which predates the caregiver-lifecycle migration. Without this the
   `rejected` status and every consent/approval column are simply absent, and
   the journey fails in ways that look like application bugs.
2. **Enabling `caring_community`.** It defaults to **false**
   (`TenantFeatureConfig::FEATURE_DEFAULTS`), so otherwise every Caring route
   renders a "coming soon" placeholder.

It is enabled on **both** synthetic communities on purpose. If it were off in
`e2e-other`, the cross-community checks would be satisfied by a *module gate*
and would prove nothing about **tenant scoping**, which is what they exist to
test.

## Rules this journey follows

- **It fails loudly; it never skips.** A skipped journey and a passing journey
  look identical in a summary line — that is how a broken feature gets reported
  as working. `assertCaringFixtureEnvironment()` throws with actionable setup
  instructions instead.
- **Page identity is proved, never assumed.** `page.goto()` follows redirects
  silently, and a login page satisfies every generic structural assertion (it
  has a heading, a `main`, a skip link). `assertLandedOn()` rejects a login
  redirect explicitly.

  > 🔴 This is the specific failure being corrected. The earlier attempt
  > authenticated at `/t/{tenant}/login`, a route that no longer exists — the
  > maintained route is `/{tenant}/login`. It failed *before* authentication and
  > nothing downstream noticed. Changing `/t/` to `/` fixes the URL and leaves
  > that blindness in place, so both were fixed.
- **Identity, not just presence.** `assertSignedInAs()` checks the actor's own
  name, which comes from the API. Member pages carry `[data-user-menu]`; the
  staff Caring panel (`CaringPanelHeader`) has no `data-*` hook at all, only a
  *translated* aria-label that matches nothing in ten of the eleven locales.
- **Storage state must be populated.** A run must not be able to pass while
  signed in as nobody, so the fixture refuses to build an empty state.
- **Synthetic data only.** Every actor's email is checked against the synthetic
  domain before anything is written.
