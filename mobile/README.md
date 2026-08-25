# Timebank Global - Mobile App

Last reviewed: 2026-07-14

React Native (Expo) mobile client for the [Project NEXUS](https://github.com/jasperfordesq-ai/Project-NEXUS) timebanking platform.

Release identity, package IDs, and website/Play Store distribution decisions are recorded in [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

**License:** AGPL-3.0-or-later (c) 2024-2026 Jasper Ford

---

## Prerequisites

- Node.js 22+
- Expo CLI through `npx expo` or the local npm scripts
- For Android: Android Studio + emulator, or a physical device with Expo Go
- For iOS: Xcode + Simulator (macOS only), or a physical device with Expo Go

---

## Setup

```bash
cd mobile
npm ci        # .npmrc sets legacy-peer-deps=true automatically
cp .env.example .env.local
# Edit .env.local and set EXPO_PUBLIC_API_URL to your API endpoint
```

### Assets

🔴 This section told you to replace `assets/` placeholders before building. That
is **stale** — `icon.png`, `splash.png`, `adaptive-icon.png` and
`notification-icon.png` are all real artwork (verified 2026-08-18). Nothing needs
replacing, and the same stale warning still appears in the Notes at the foot of
this file.

Expected dimensions, if any of them is ever regenerated:

| File | Size |
| --- | --- |
| `icon.png` | 1024x1024 |
| `splash.png` | 1284x2778 |
| `adaptive-icon.png` | 1024x1024 (Android) |
| `notification-icon.png` | 96x96, white on transparent |

---

## Development

```bash
# Start Expo dev server (opens QR code)
cd mobile && npm start

# Run on Android emulator / connected device
npm run android

# Run on iOS simulator (macOS only)
npm run ios

# TypeScript check
npm run type-check
```

Scan the QR code with **Expo Go** on your phone, or press `a` / `i` in the terminal to open an emulator.

---

## API URL Configuration

The app reads `EXPO_PUBLIC_API_URL` from environment. Set this in `.env.local`:

| Target | URL |
|--------|-----|
| Production | `https://api.project-nexus.ie` |
| Android emulator -> local Docker API | `http://10.0.2.2:8090` |
| iOS simulator -> local Docker API | `http://localhost:8090` |
| Local device on LAN | `http://<your-computer-ip>:8090` |

The default tenant (`EXPO_PUBLIC_DEFAULT_TENANT`) is `hour-timebank`; change this to test with a different tenant.

---

## Architecture

### Stack

| Concern | Solution |
|---------|----------|
| Framework | Expo SDK 54 (managed workflow) |
| Language | TypeScript strict |
| Navigation | Expo Router (file-based, like Next.js) |
| UI | HeroUI Native `^1.0.4` + Uniwind + Tailwind CSS 4 |
| Auth storage | `expo-secure-store` (encrypted at rest) |
| HTTP | Native `fetch` with typed wrapper (`lib/api/client.ts`) |
| State | React Context + hooks (no external state library) |
| Icons | `@expo/vector-icons` (Ionicons) |
| Authentication | Password + authenticator-app 2FA (native passkeys planned) |
| Real-time messaging | Pusher WebSockets (private channels, end-to-end encrypted transport) |
| Push notifications | Firebase Cloud Messaging (FCM) via Expo Notifications |

### Directory Layout

```text
mobile/
├── app/                  # Expo Router routes (file = screen)
│   ├── _layout.tsx       # Root layout: providers + auth redirect
│   ├── index.tsx         # Loading splash while auth resolves
│   ├── (auth)/           # Login, register, tenant selection, password reset, verify email
│   ├── (tabs)/           # Main tab navigator (home, exchanges, members, messages, profile)
│   └── (modals)/         # Modal workflows: exchanges, groups, jobs, marketplace, federation, settings
├── components/           # Shared UI components
│   ├── ui/               # HeroUI Native-backed primitives and app wrappers
│   ├── federation/       # Federation directory and detail helpers
│   ├── marketplace/      # Marketplace cards and shared marketplace UI
│   ├── ExchangeCard.tsx
│   ├── MemberCard.tsx
│   ├── FeedItem.tsx
│   └── TenantBanner.tsx
└── lib/
    ├── api/              # Typed API modules
    ├── context/          # AuthContext, TenantContext, RealtimeContext
    ├── hooks/            # useAuth, useTenant, useApi, usePaginatedApi
    ├── storage.ts        # Secure storage wrapper
    └── constants.ts      # API URL, storage keys
```

### HeroUI Native

This app uses HeroUI Native, not HeroUI React web APIs. The root layout imports `global.css`, wraps the app in `GestureHandlerRootView`, and mounts `HeroUINativeProvider`. `global.css` imports Tailwind CSS, Uniwind, and `heroui-native/styles`.

Prefer the shared wrappers in `components/ui` for app screens:

- `Button`, `Input`, `Card`, `Badge`/`Chip`, `Toggle`, `Checkbox`, `BottomSheet`, `ActionSheet`, `LoadingSpinner`, and `EmptyState`
- Direct `heroui-native` primitives for dense compound layouts where the wrapper would fight the native component anatomy
- Native React Native primitives for layout, lists, media, maps, gesture surfaces, and platform APIs

See `docs/WRAPPER_POLICY.md` for the wrapper-vs-primitive policy and locale guide, and `docs/HEROUI_NATIVE_PARITY_AUDIT.md` for the current parity matrix.

### Auth Flow

1. App mounts and `AuthContext` reads the stored access/refresh credentials from `expo-secure-store`.
2. If a token exists, `GET /api/v2/users/me` validates it and redirects to `/(tabs)/home`.
3. If no token exists or validation fails, the app redirects to `/(auth)/login`.
4. On login, credentials are posted, the JWT is stored, and the app redirects to tabs.
5. On 401 from an API call, `lib/api/client.ts` attempts one rotating refresh-token exchange and retries the original request. It clears credentials and redirects to login only when refresh fails.

#### WebAuthn / Passkeys

Native passkey authentication is not implemented in the Expo app yet. The current mobile login flow is password/TOTP based; do not expose the web passkey module switch as mobile capability. A future native implementation must use the iOS/Android platform credential APIs, configure the required associated-domain/app-link files for every supported tenant RP ID, and conform to the web API's origin, tenant, user-verification, and recovery policy before this section can claim support.

### Multi-Tenancy

Every API request includes an `X-Tenant-Slug` header set by `lib/api/client.ts` from storage. `TenantContext` loads tenant config and branding on startup and exposes `hasFeature(key)` for conditional UI.

To switch tenant, call `setTenantSlug(slug)` from `useTenant()`.

---

## Verification

```bash
cd mobile
npm run verify:release
npm run type-check
npm test -- --runInBand --silent
npm run drift:check        # route parity + API contract
npm run coverage:check     # coverage + per-area shrink-only ratchet
```

Focused route/component tests are useful during migration work, but run the commands above before considering a HeroUI Native or parity pass complete. The Jest suite may emit known Uniwind/HeroUI Native test-environment warnings; document any command timeout or open-handle behavior in the parity audit.

🔴 The Jest suite mocks the HTTP client, so it can never tell you that an endpoint
was renamed or that the React app grew a member route mobile knows nothing about.
`drift:check` is what covers that; it found a live defect the first time it ran.
Full detail and the traps in [docs/TESTING.md](docs/TESTING.md).

## Maintained Mobile Documentation

| Guide | Purpose |
| --- | --- |
| [MOBILE_HANDOFF.md](docs/MOBILE_HANDOFF.md) | 🔴 **Start here.** The goal, what has been proved, what is left, the traps, and the chief-engineer view of what the plan is missing. |
| [CURRENT_MOBILE_PRODUCTION_STATUS.md](docs/CURRENT_MOBILE_PRODUCTION_STATUS.md) | The only document that states the current score (rubric M1). |
| [MOBILE_JOURNEY_LEDGER.md](docs/MOBILE_JOURNEY_LEDGER.md) | The work list and the fixed 140-row denominator. Pick work up here. |
| [MOBILE_ROADMAP.md](docs/MOBILE_ROADMAP.md) | The phased plan to production, with exit criteria per phase. |
| [MOBILE_TEST_HARNESS.md](docs/MOBILE_TEST_HARNESS.md) | How to walk a journey: two emulators, two accounts, and every trap that cost time. |
| [HISTORY/PRODUCTION_READINESS_2026-08-21.md](docs/HISTORY/PRODUCTION_READINESS_2026-08-21.md) | HISTORICAL. The superseded readiness document, kept for its measurements. Not current state. |
| [TESTING.md](docs/TESTING.md) | How to verify a change, what each check proves, and what cannot be tested here. |
| [DISTRIBUTION.md](docs/DISTRIBUTION.md) | Package identity, release channels, stores, and distribution policy. |
| [PLAY_SUBMISSION.md](docs/PLAY_SUBMISSION.md) | 🔴 Read before any Play work. Everything prepared for submission, the owner-only decisions (upload key, service account, Sentry project), drafted listing copy, Data Safety and content-rating answers — and the in-app payment policy risk. |
| [SECURITY.md](docs/SECURITY.md) | Token handling, Android certificate pins, OTA policy, and native hardening. |
| [NATIVE_UI_CONTRACT.md](docs/NATIVE_UI_CONTRACT.md) | Supported native UI contract and parity boundaries. |
| [WRAPPER_POLICY.md](docs/WRAPPER_POLICY.md) | HeroUI Native wrapper-versus-primitive rules and locale guidance. |
| [HEROUI_NATIVE_PARITY_AUDIT.md](docs/HEROUI_NATIVE_PARITY_AUDIT.md) | Maintained parity matrix and verification record. |
| [ALERT_MIGRATION_PLAYBOOK.md](docs/ALERT_MIGRATION_PLAYBOOK.md) | Migration procedure for native alert and confirmation surfaces. |
| [VISUAL_AUDIT.md](docs/VISUAL_AUDIT.md) | Screen-by-screen visual findings from the emulator sweep, and what the sweep does and does not prove. |
| [store-listing/screenshots/README.md](store-listing/screenshots/README.md) | The Play Store screenshot sets, what they were captured against, and which set to submit. |
| [.maestro/README.md](.maestro/README.md) | Maestro installation, test data, and native end-to-end flow instructions. |
| [docs/generated/mobile-parity-matrix.md](docs/generated/mobile-parity-matrix.md) | GENERATED — route-level parity against the React member routes. `npm run parity:matrix`. |
| [docs/generated/mobile-api-consumer-ledger.md](docs/generated/mobile-api-consumer-ledger.md) | GENERATED — every API endpoint this client calls, verified against Laravel's real routes. `npm run api:ledger`. |

---

## Production Build (EAS)

```bash
npm install -g eas-cli
eas login
npm run prepackage             # TypeScript, Jest, Expo Doctor
npm run build:android:website  # APK for website/internal tester downloads
npm run build:android:play     # AAB for Google Play
npm run submit:android:internal # Submit latest AAB to Play internal testing
```

Configure `eas.json` before submitting. See [Expo EAS docs](https://docs.expo.dev/eas/).

---

## Notes

- **No business logic in the app**: all logic lives in the PHP API.
- **Real-time messaging**: Pusher WebSocket channels are established after login and torn down on logout. Private channels use server-side auth (`/api/v2/pusher/auth`).
- **Push notifications**: FCM tokens are registered on login via `POST /api/v2/notifications/device-token` and deregistered on logout. Requires `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) in the project root before any EAS build.
- **AGPL-3.0 attribution** is rendered by [`components/SourceRepositoryLink.tsx`](components/SourceRepositoryLink.tsx), which is the single definition of the notice and of the repository URL — screens must not inline either. There is no dedicated About screen in this app; the component is mounted at the foot of the Profile hub (`app/(tabs)/profile.tsx`) and of the settings-family modals (`settings`, `settings-blocked-users`, `settings-data-export`, `settings-translation`) and `goal-detail`, so the notice stays reachable from ordinary navigation as Section 7(b) and Section 13 require. It renders three things together: the licence notice, the copyright notice (`Copyright © 2024–<year> Jasper Ford`), and a tappable source repository link to <https://github.com/jasperfordesq-ai/Project-NEXUS>. All wording goes through the `common` translation namespace in all seven locales; the URL itself is never translated. Removing any of the three is a licence violation — `components/SourceRepositoryLink.test.tsx` fails if they disappear.
- Replace `assets/` placeholder images before any public build. When the generated notification icon is ready, save it as `assets/notification-icon.png` (96x96, white on transparent). The dynamic Expo config will use it automatically when the file exists.
- Add `google-services.json` at the project root before push-notification production builds. It is gitignored and will be added to native config automatically when present.
