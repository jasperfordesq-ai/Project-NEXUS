# Module Guide Map

Last reviewed: 2026-07-30

This page maps the live product modules and cross-cutting client surfaces to their primary code and maintained documentation. It is a navigation aid, not a replacement for source code. Coverage is not complete: Caring Community is listed below but has no curated guide yet.

> Maintained module guides live under `docs/modules/`. The **source code** (`app/Services/`, `routes/api.php`) and machine-readable API contract remain authoritative. Federation, mobile, and the accessible frontend are cross-cutting surfaces with dedicated reference suites rather than duplicate module guides. The earlier per-module engine-report snapshots (dated 2026-03-29) were removed from the public repo because they had drifted from current behaviour; do not treat archived copies as live reference.

| Module or surface | Backend surface | Frontend surface | Maintained reference |
| --- | --- | --- | --- |
| Admin | `app/Http/Controllers/Api/Admin*`, admin services | `react-frontend/src/admin` | [modules/admin.md](modules/admin.md) |
| AI chat | `AiChatController`, `AiChatService`, `app/Services/AI/` | AI chat and admin trace surfaces | [modules/ai-chat.md](modules/ai-chat.md) |
| Blog and resources | blog/resource controllers and services | blog, knowledge, and resource-library pages | [modules/blog-and-resources.md](modules/blog-and-resources.md) |
| Caring Community | `CaringCommunityApiController`, `AdminCaringCommunityController`, `CaringSubRegionController`, `app/Services/CaringCommunity/` (40 classes) plus 9 top-level `Caring*` services — 49 in total, 227 routes in `routes/api.php`, 3 commands in the `caring:` namespace (`caring:nudges-dispatch`, `caring:hour-transfers-retry`, `caring:civic-digest-dispatch` — the last defined in `CivicDigestDispatch.php`; all scheduled at `bootstrap/app.php:353-378`) plus 2 `tenant:` maintenance commands (`tenant:apply-caring-community-preset`, `tenant:audit-agoris-caring-content`) | `react-frontend/src/caring/CaringApp` mounted at `caring/*`, 50 files directly under `react-frontend/src/pages/caring-community/` (53 including `__tests__/`), `react-frontend/src/admin/modules/caring-community/` | **No guide yet** — `routes/api.php` and the services are authoritative |
| Connections and reviews | connection/review controllers and services | network, connection, review, and endorsement pages | [modules/connections-and-reviews.md](modules/connections-and-reviews.md) |
| Courses | course controllers and `app/Services/Course*` | catalogue, learning, instructor, and admin course pages | [modules/courses.md](modules/courses.md) |
| Events | `EventsController`, event services, recurring-event logic | event pages and accessible event routes | [modules/events.md](modules/events.md) |
| Gamification | gamification services and controllers | achievements, leaderboard, challenge, and score surfaces | [modules/gamification.md](modules/gamification.md) |
| Goals and impact | goal, impact, and regional-analytics services | goals, check-ins, insights, and impact pages | [modules/goals-and-impact.md](modules/goals-and-impact.md) |
| Groups | group controllers and services | groups, discussions, files, and group-management pages | [modules/groups.md](modules/groups.md) |
| Identity verification | identity controllers and `app/Services/Identity/` | verification, registration, badge, and admin-review surfaces | [modules/identity-verification.md](modules/identity-verification.md) |
| Ideation and challenges | ideation controllers and challenge services | campaign, idea, voting, and outcome pages | [modules/ideation-challenges.md](modules/ideation-challenges.md) |
| Jobs | job controllers and services, bias audit | jobs pages and admin hiring surfaces | [modules/jobs.md](modules/jobs.md) |
| Listings | `ListingsController`, listing services | listings pages and accessible listing templates | [modules/listings.md](modules/listings.md) |
| Marketplace | marketplace controllers and `app/Services/Marketplace*` | buyer, seller, order, pickup, and admin marketplace pages | [modules/marketplace.md](modules/marketplace.md) |
| Members and GDPR | member/profile controllers, consent and data-rights services | member directory, profiles, settings, and admin member pages | [modules/members-and-gdpr.md](modules/members-and-gdpr.md) |
| Messaging | `MessagesController`, message services, Pusher auth | conversations, group messaging, and accessible message routes | [modules/messaging.md](modules/messaging.md) |
| Monetization | premium, coupon, and local-advertising controllers/services | premium, coupon, merchant, and advertising surfaces | [modules/monetization.md](modules/monetization.md) |
| Notifications and email | notification services, listeners, dispatch jobs, locale context | notification inbox and settings | [modules/notifications.md](modules/notifications.md) |
| Organisations | volunteering organisation controllers and services | organisation directory, registration, management, and admin pages | [modules/organisations.md](modules/organisations.md) |
| Podcasts | podcast controllers and services | show, episode, studio, and admin podcast pages | [modules/podcasts.md](modules/podcasts.md) |
| Search | `SearchService`, Meilisearch integration, SQL fallback | search and explore pages | [modules/search.md](modules/search.md) |
| Social feed | feed controllers and services | feed, posts, polls, stories, comments, and reactions | [modules/social-feed.md](modules/social-feed.md) |
| Volunteering | volunteering services, organisation controllers, hours logging | volunteering pages and accessible routes | [modules/volunteering.md](modules/volunteering.md) |
| Wallet and exchanges | `WalletService`, exchange services, wallet/exchange routes | wallet and exchange pages, including accessible routes | [modules/wallet-exchanges.md](modules/wallet-exchanges.md) |
| Federation | federation controllers/services, protocol adapters, partner API routes | member/admin federation pages and accessible federation routes | [FEDERATION_API_MANUAL.md](FEDERATION_API_MANUAL.md) |
| Mobile | Laravel API consumed by the Expo client | `mobile/` | `mobile/README.md` and `mobile/docs/` |
| Accessible frontend | `app/Http/Controllers/GovukAlpha`, `routes/govuk-alpha.php`, parity route files | `accessible-frontend/` Blade/Sass/TS | [govuk-alpha/RESEARCH.md](govuk-alpha/RESEARCH.md), [govuk-alpha/ATTRIBUTION.md](govuk-alpha/ATTRIBUTION.md), and `accessible-frontend/README.md` |

## Writing A Module Guide

Create a module guide only when it will help future maintenance. A good guide includes:

- audience and supported workflows;
- tenant and feature-gate rules;
- key routes, controllers, services, models, tables, and frontend entry points;
- security and privacy invariants;
- test commands and important regression tests;
- operational failure modes and recovery steps;
- OpenAPI links instead of copied endpoint tables.

Keep module guides small. Split only when one page becomes difficult to scan.
