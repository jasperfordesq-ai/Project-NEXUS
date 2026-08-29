# Project NEXUS — Maestro E2E Mobile Tests

Last reviewed: 2026-07-14

Maestro is a lightweight mobile UI testing framework that drives iOS Simulators and Android Emulators (or real devices) by replaying YAML flow files against the running app. Flows tap, type, scroll, and assert exactly as a real user would.

---

## Installing Maestro

```bash
# macOS / Linux
curl -Ls "https://get.maestro.mobile.dev" | bash

# Verify installation
maestro --version
```

On Windows, use WSL2 with the Linux install above, or download the Maestro JAR manually from https://github.com/mobile-dev-inc/maestro/releases.

---

## Running flows

All flows target bundle ID `ie.project.nexus` (iOS) / package `ie.project.nexus` (Android).

```bash
# Run all isolated flows (Maestro may discover them in any order)
maestro test .maestro/

# Run a single flow
maestro test .maestro/01-auth-login.yaml

# Run with credentials supplied as env vars (required for auth flows)
maestro test \
  --env TEST_EMAIL=user@example.com \
  --env TEST_PASSWORD=secret \
  .maestro/

# When more than one Android emulator is attached, select one explicitly
node scripts/e2e.mjs --serial emulator-5554

# Upload flows to Maestro Cloud (device farm)
maestro cloud --apiKey $MAESTRO_API_KEY .maestro/
```

---

## Required environment variables

| Variable        | Description                                       |
|-----------------|---------------------------------------------------|
| `TEST_EMAIL`    | Email address of an existing test account         |
| `TEST_PASSWORD` | Password for that account                         |

Credentials are injected via `--env` and referenced in flows as `${TEST_EMAIL}` / `${TEST_PASSWORD}`. They are **never hardcoded** in any flow file.

---

## Flow index

| File | Description | Requires session? |
|------|-------------|-------------------|
| `01-auth-login.yaml` | Login with valid credentials, assert Feed tab | No (clearState) |
| `02-auth-logout.yaml` | Navigate to Profile, Sign out, assert login screen | No (isolated login) |
| `03-browse-listings.yaml` | Listings tab: search "garden", clear, scroll | No (isolated login) |
| `04-browse-groups.yaml` | Profile > Groups: filter pills, search "community" | No (isolated login) |
| `05-view-events.yaml` | Feed tab: scroll through event cards | No (isolated login) |
| `06-messages-flow.yaml` | Messages tab: load, scroll, no crash | No (isolated login) |
| `07-profile-explore.yaml` | Profile Explore: Achievements + AI Assistant | No (isolated login) |
| `08-search-flow.yaml` | Profile > Search: type query, assert filter pills | No (isolated login) |
| `09-registration-flow.yaml` | Registration form renders correctly (no submit) | No (clearState) |

Every root journey starts from a clean state. Authenticated journeys use
`subflows/login.yaml`; registration uses `subflows/open-login.yaml`. This keeps the
suite valid when Maestro discovers flows in a different order.

---

## Tenant selection screen

On a completely fresh install (`clearState: true`) the app may show a **"Select your timebank"** screen before the login form. The shared setup waits for either valid screen before evaluating its conditional tenant-selection block, avoiding a race with asynchronous tenant loading.

---

## CI status

Maestro runs in the scheduled and manually dispatched `Mobile Device Tests`
GitHub Actions workflow. The main CI workflow (`mobile-release` in
`.github/workflows/ci.yml`) still runs the faster source-level gates and does not
launch an emulator or submit an EAS build.

EAS build and submission commands remain deliberate operator actions documented
in [`../docs/DISTRIBUTION.md`](../docs/DISTRIBUTION.md).

If a device-farm gate is added later, start from a preview APK and pass credentials only through repository secrets. For example:

```yaml
- name: Run Maestro E2E tests
  run: |
    maestro cloud \
      --apiKey ${{ secrets.MAESTRO_API_KEY }} \
      --app-file path/to/app.apk \
      .maestro/
  env:
    TEST_EMAIL: ${{ secrets.E2E_TEST_EMAIL }}
    TEST_PASSWORD: ${{ secrets.E2E_TEST_PASSWORD }}
```

Required additional secrets: `MAESTRO_API_KEY`, `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`.
