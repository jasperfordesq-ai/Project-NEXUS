<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# HeroUI Native Parity Matrix

Last reviewed: 2026-07-14

This is the maintained parity map for the Expo client. It records durable product boundaries and verification rules; it is not a task log or a promise that every web-only workflow belongs on a phone.

Scope: `mobile/` compared with the member-facing React application. React administration, broker/caring workspaces, legacy PHP views, and deployment tooling are intentionally out of scope.

🔴 **This document records product judgement per area, and it is not falsifiable.**
Every row below can stay true while React ships a whole new member route. The
route-level companion is
[generated/mobile-parity-matrix.md](generated/mobile-parity-matrix.md), generated
by `npm run parity:matrix` from declarations in `mobile/parity-map.json`, and
`npm run parity:check` FAILS when a React member route has no recorded mobile
decision. Use both: this file for why, that file for whether. As of 2026-08-18 it
reports 125 native, 65 out-of-scope, 33 gaps and 31 awaiting review across 254
React member routes. Readiness scoring lives in
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

## UI foundation

| Area | Current contract | Source |
| --- | --- | --- |
| Package | `heroui-native` `^1.0.4`, with Uniwind and Tailwind CSS 4 | `mobile/package.json`, `mobile/package-lock.json` |
| Provider order | `global.css`, `GestureHandlerRootView`, `HeroUINativeProvider`, then safe-area and application providers | `mobile/app/_layout.tsx` |
| Styling | Tailwind/Uniwind utilities plus `heroui-native/styles`; tenant colours remain runtime values where required | `mobile/global.css` |
| Screen primitives | Local wrappers are preferred for buttons, fields, cards, badges, toggles, checkboxes, sheets, loading, and empty states | `mobile/components/ui/`, [WRAPPER_POLICY.md](WRAPPER_POLICY.md) |
| Feedback | `useAppToast()` for transient feedback and `useConfirm()` for confirmation; product code does not use `Alert.alert` | `mobile/components/ui/AppToast.tsx`, `mobile/components/ui/useConfirm.tsx` |
| Native composition | React Native primitives remain appropriate for layout, virtualized lists, media, maps, gestures, and platform APIs | [NATIVE_UI_CONTRACT.md](NATIVE_UI_CONTRACT.md) |
| Theme and locale | System/light/dark theme support and seven bundled locales with lazy language loading | `mobile/lib/theme/`, `mobile/lib/i18n.ts`, `mobile/locales/` |

Official HeroUI Native Button, Card, TextField, BottomSheet, Toast, and Dialog documentation was rechecked on 2026-07-14. The installed application remains authoritative where a newer documentation example differs from the pinned package.

## Product parity

“Core parity” means the principal member journey is available through the same Laravel API contract. “Partial by design” identifies an explicit native boundary, not an undocumented defect.

| Product area | Native status | Current mobile surface | Deliberate boundary |
| --- | --- | --- | --- |
| Authentication | Core parity | Tenant selection, login, registration, password reset, email verification, and TOTP completion under `app/(auth)/` | Native passkeys and provider OAuth linking require platform credential/deep-link design before they can be claimed. |
| Home and social feed | Core parity | Home/feed hub, post detail, hashtags, reactions, comments, stories, and quick creation | Web moderation and administration stay out of the member app. |
| Exchanges and wallet | Core parity | Browse/create/edit/request exchanges, group exchanges, wallet history, transfers, and donations | Desktop-heavy analytics remain web-first unless a mobile use case is approved. |
| Messaging | Core parity | Inbox, realtime threads, reactions, image attachments, authenticated private media, voice recording/playback, and AI chat | General document-picker attachment parity is deferred until a supported native document workflow is approved. |
| Members and settings | Core parity | Directory, profiles, connections, skills, appreciations, collections, privacy/export, blocked users, identity verification, and linked sub-accounts | Native social-provider account linking remains deferred with OAuth deep links. |
| Events | Broad core parity | Browse/detail/create/edit, attendance, templates, lifecycle history, recurrence blueprints, tickets, and communications | Dense organizer analytics and exceptional operations can remain web-first. |
| Groups | Broad core parity | Browse/create/edit, discussions, announcements, files, media, Q&A, wiki, tasks, exchanges, and analytics | Document upload/export UX is partial where a native file workflow is not present. |
| Marketplace | Broad core parity | Browse/search/map, listings, offers, orders, pickups, coupons, seller onboarding, collections, reports, shipping, and seller tools | Administrative moderation and financial operations remain in the web administration surface. |
| Jobs | Core parity | Browse/detail/create/edit, applications, alerts, owner analytics, and pipeline | Talent search, bias-audit, and employer-administration depth remain web-first. |
| Volunteering and organisations | Broad core parity | Opportunities, applications, shifts, swaps, expenses, certificates, donations, organisation registration/detail, and organizer dashboard | Policy administration remains web-only. |
| Gamification, goals, polls, and ideation | Core parity | Achievements, leaderboard, Nexus Score, rewards/challenges, goal detail/templates, standard polls, and ideation browse/detail/create | Advanced exports and campaign administration remain web-first. |
| Federation | Broad core parity | Hub, partners, members, messages, listings, events, groups, connections, onboarding, and settings | Platform-wide partner/API administration remains in the partner or admin web workspace. |
| Search and content | Partial by design | Global search/saved searches, blog, resources/knowledge base, support, and legal summaries | Courses and podcasts do not currently have dedicated native routes; use the maintained web or accessible frontend until native workflows are approved. |
| Caring Community and staff workspaces | Out of scope | No native administration surface | React `/admin`, `/super-admin`, `/broker`, `/partner-timebanks`, and `/caring` workspaces are intentionally not reproduced. |

## Route and deep-link sources

- Expo Router screens: `mobile/app/(tabs)/`, `mobile/app/(auth)/`, and `mobile/app/(modals)/`.
- Deep-link mapping and normalization: `mobile/lib/utils/navigateToLink.ts` and its tests.
- Laravel API clients: `mobile/lib/api/`.
- Feature visibility: tenant capabilities loaded through `mobile/lib/context/TenantContext.tsx`; hiding a route is not a substitute for server authorization.

The route files are the inventory source of truth. Do not add per-screen implementation logs or fixed test totals here; those become stale as soon as another route lands.

## Verification

Run the full native release baseline after parity, wrapper, route, or security changes:

```bash
cd mobile
npm run verify:release
npm run type-check
npm test -- --runInBand
npx expo-doctor
npm run drift:check      # route parity + API contract — see TESTING.md
npm run coverage:check   # per-area shrink-only coverage ratchet
```

For a focused change, run the owning screen/API tests first, then the full baseline before release. A timeout, non-zero exit, open-handle failure, or generated-native-policy mismatch is not a pass.

## Maintenance rules

- Update the relevant matrix row in the same change that adds or deliberately removes a native journey.
- Update `mobile/parity-map.json` in the same change too. The prose row and the machine-checked declaration must not disagree; the declaration is the one CI reads.
- Keep user-facing text in mobile locale namespaces; never use an untranslated inline fallback as completed parity.
- Prefer the local wrappers and compound HeroUI Native APIs documented in [WRAPPER_POLICY.md](WRAPPER_POLICY.md).
- Record detailed one-off verification output in CI logs or `.local-docs-archive/`, not in this maintained public guide.
- Recheck the official HeroUI Native component documentation before changing component anatomy or migration guidance.
