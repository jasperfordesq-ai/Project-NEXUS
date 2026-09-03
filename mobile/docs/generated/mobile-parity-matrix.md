<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Mobile Route Parity Matrix

Last reviewed: 2026-09-03

> GENERATED FILE — do not edit by hand.
> Regenerate with `npm run parity:matrix` from `mobile/`.
> Declarations live in `mobile/parity-map.json`; this file only reports them.

Route-level companion to [HEROUI_NATIVE_PARITY_AUDIT.md](../HEROUI_NATIVE_PARITY_AUDIT.md).
That document records product judgement per area; this one is falsifiable — it fails
when a React member route exists that nobody has classified for mobile.

| Measure | Count |
| --- | --- |
| React member routes | 256 |
| Mobile routes (Expo Router screens) | 163 |
| Covered natively | 153 |
| Deliberately out of scope | 103 |
| **Known gaps** | **0** |
| Awaiting review (shrink-only, budget 31) | 0 |
| **Undeclared (blocks `--check`)** | **0** |
| Mobile routes not claimed by a React route | 29 |
| Broken declarations | 0 |

## Full matrix

| React route | Status | Mobile screen | Reason |
| --- | --- | --- | --- |
| `about` | out-of-scope | — | Marketing page. |
| `acceptable-use` | out-of-scope | — | Legal document; mobile uses legal-document. |
| `acceptable-use/versions` | out-of-scope | — | Legal version history; web-first. |
| `accessibility` | out-of-scope | — | Accessibility statement; web-first. |
| `accessibility/versions` | out-of-scope | — | Legal version history; web-first. |
| `account-deletion` | out-of-scope | — | Google Play requires a publicly reachable deletion page; the app itself deletes an account natively in settings-delete-account. |
| `achievements` | native | `achievements` | — |
| `activity` | native | `activity` | — |
| `admin/*` | out-of-scope | — | Tenant administration workspace; the member app has no admin surface. |
| `advertise/campaigns` | out-of-scope | — | Tenant advertising administration. |
| `advertise/push-campaigns` | out-of-scope | — | Tenant push-campaign administration. |
| `auth/oauth/callback` | out-of-scope | — | Browser OAuth redirect target; native OAuth needs its own deep-link design. |
| `blog` | native | `blog` | — |
| `blog/:slug` | native | `blog-post` | — |
| `broker/*` | out-of-scope | — | Broker workspace — an operational role with its own React application. |
| `caring-community/caregiver` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/caregiver/cover` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/caregiver/link` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/civic-digest` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/feedback` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/future-care-fund` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/hour-gift` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/hour-transfer` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/loyalty/history` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/markt` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/my-data-export` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/my-relationships` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/my-trust-tier` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/offer-favour` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/projects` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/projects/:id` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/providers` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/request-help` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/safeguarding/my-reports` | out-of-scope | — | Owner decision 2026-08-28: Care in Community, including its safeguarding workspace, is not part of either native application. |
| `caring-community/safeguarding/report` | out-of-scope | — | Owner decision 2026-08-28: Care in Community, including its safeguarding workspace, is not part of either native application. |
| `caring-community/success-stories` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/surveys` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/surveys/:id` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring-community/warmth-pass` | out-of-scope | — | Owner decision 2026-08-28: Care in Community is not part of either native application. |
| `caring/*` | out-of-scope | — | Caring Community staff workspace. |
| `changelog` | out-of-scope | — | Marketing/release page. |
| `chat` | native | `chat` | — |
| `child-safety` | out-of-scope | — | Google Play child-safety standards disclosure; web-first published policy. In-app reporting is native on each reportable surface. |
| `clubs` | native | `clubs` | — |
| `clubs/:id/admin/dues` | out-of-scope | — | Club administration. |
| `clubs/:id/admin/import` | out-of-scope | — | Club administration. |
| `community-guidelines` | out-of-scope | — | Legal document; mobile uses legal-document. |
| `community-guidelines/versions` | out-of-scope | — | Legal version history; web-first. |
| `connections` | native | `connections` | — |
| `contact` | out-of-scope | — | Marketing page. |
| `cookies` | out-of-scope | — | Cookie policy is a web-browser concern. |
| `cookies/versions` | out-of-scope | — | Legal version history; web-first. |
| `coupons` | native | `marketplace-coupons` | — |
| `coupons/:id` | native | `marketplace-coupon-detail` | — |
| `courses` | native | `courses` | — |
| `courses/:id/learn` | native | `course-player` | — |
| `courses/:idOrSlug` | native | `course-detail` | — |
| `courses/instructor` | out-of-scope | — | Course authoring workspace. |
| `courses/instructor/:id/analytics` | out-of-scope | — | Course authoring workspace. |
| `courses/instructor/:id/edit` | out-of-scope | — | Course authoring workspace. |
| `courses/instructor/:id/grading` | out-of-scope | — | Course authoring workspace. |
| `courses/instructor/new` | out-of-scope | — | Course authoring workspace. |
| `courses/my-learning` | native | `courses` | — |
| `dashboard` | native | `home` | — |
| `developers` | out-of-scope | — | Developer API documentation; a web reference, not a member journey. |
| `developers/auth` | out-of-scope | — | Developer API documentation. |
| `developers/endpoints` | out-of-scope | — | Developer API documentation. |
| `developers/webhooks` | out-of-scope | — | Developer API documentation. |
| `development-status` | out-of-scope | — | Marketing/release page. |
| `donations/:id/receipt` | native | `donation-receipt` | — |
| `events` | native | `events` | — |
| `events/:id` | native | `event-detail` | — |
| `events/:id/edit` | native | `edit-event` | — |
| `events/:id/guardian-consent` | out-of-scope | — | Both native apps are adults-only. Guardian consent remains an exceptional staffed web/operator workflow and must not become a native child-access journey. |
| `events/:id/manage/:section?` | native | `event-manage` | Permission-aware native operations hub routes organisers to the implemented event people, check-in, agenda, analytics, registration, ticket, communications, template, recurrence, and lifecycle workspaces. |
| `events/create` | native | `new-event` | — |
| `events/edit/:id` | native | `edit-event` | — |
| `exchanges` | native | `exchanges` | — |
| `exchanges/:id` | native | `exchange-detail` | — |
| `explore` | native | `explore` | — |
| `faq` | out-of-scope | — | Marketing page. |
| `features` | out-of-scope | — | Marketing page — a platform catalogue, not a tenant inventory. |
| `federation` | native | `federation` | — |
| `federation/connections` | native | `federation-connections` | — |
| `federation/events` | native | `federation-events` | — |
| `federation/groups` | native | `federation-groups` | — |
| `federation/listings` | native | `federation-listings` | — |
| `federation/members` | native | `federation-members` | — |
| `federation/members/:id` | native | `federation-member` | — |
| `federation/messages` | native | `federation-messages` | — |
| `federation/onboarding` | native | `federation-onboarding` | — |
| `federation/partners` | native | `federation-partners` | — |
| `federation/partners/:id` | native | `federation-partner` | — |
| `federation/settings` | native | `federation-settings` | — |
| `feed` | native | `home` | — |
| `feed/hashtag/:tag` | native | `feed-hashtag` | — |
| `feed/hashtags` | native | `feed-hashtags` | — |
| `feed/item/:type/:id` | native | `feed-item-detail` | — |
| `feed/posts/:id` | native | `feed-item-detail` | — |
| `goals` | native | `goals` | — |
| `goals/:id` | native | `goal-detail` | — |
| `group-exchanges` | native | `group-exchanges` | — |
| `group-exchanges/:id` | native | `group-exchange-detail` | — |
| `group-exchanges/create` | native | `new-group-exchange` | — |
| `groups` | native | `groups` | — |
| `groups/:id` | native | `group-detail` | — |
| `groups/create` | native | `new-group` | — |
| `groups/edit/:id` | native | `edit-group` | — |
| `groups/invite/:token` | native | `group-invite` | Authenticated adults can preview and explicitly accept an ordinary group invitation in the native app. |
| `help` | native | `support` | — |
| `ideation` | native | `ideation` | — |
| `ideation/:challengeId/ideas/:id` | native | `ideation-idea` | — |
| `ideation/:id` | native | `ideation-detail` | — |
| `ideation/:id/edit` | native | `new-challenge` | The challenge form supports a permission-enforced edit mode backed by the existing update contract. |
| `ideation/campaigns` | native | `ideation-campaigns` | — |
| `ideation/campaigns/:id` | native | `ideation-campaign-detail` | — |
| `ideation/create` | native | `new-challenge` | — |
| `ideation/outcomes` | native | `ideation-outcomes` | — |
| `impact-report` | out-of-scope | — | Marketing/organisational page. |
| `impact-summary` | out-of-scope | — | Marketing/organisational page. |
| `install-app` | out-of-scope | — | Exists to send web visitors to the app stores. |
| `jobs` | native | `jobs` | — |
| `jobs/:id` | native | `job-detail` | — |
| `jobs/:id/analytics` | native | `job-analytics` | — |
| `jobs/:id/edit` | native | `edit-job` | — |
| `jobs/:id/kanban` | native | `job-pipeline` | — |
| `jobs/alerts` | native | `jobs` | — |
| `jobs/bias-audit` | out-of-scope | — | Employer administration depth; web-first per the parity audit. |
| `jobs/create` | native | `new-job` | — |
| `jobs/employer-onboarding` | out-of-scope | — | Employer administration depth; web-first per the parity audit. |
| `jobs/employers/:userId` | native | `member-profile` | The employer public identity is the same member profile already rendered natively. |
| `jobs/my-applications` | native | `jobs` | — |
| `jobs/talent-search` | out-of-scope | — | Employer administration depth; web-first per the parity audit. |
| `join/:code` | out-of-scope | — | Care in Community invite redemption is deliberately excluded from both adults-only native applications and remains browser-only. |
| `kb` | native | `resources` | — |
| `kb/:id` | native | `kb-article` | — |
| `leaderboard` | native | `leaderboard` | — |
| `legal` | native | `legal-document` | — |
| `legal/:slug` | native | `legal-document` | — |
| `legal/:slug/versions` | out-of-scope | — | Legal version history; web-first. |
| `linked-accounts/:childId/messages` | native | `settings-linked-accounts` | — |
| `linked-accounts/:childId/messages/:partnerId` | out-of-scope | — | Guardian/carer proxy messaging is excluded from the adults-only native apps, and can_view_messages is not yet enforced server-side. |
| `listings` | native | `exchanges` | — |
| `listings/:id` | native | `exchange-detail` | — |
| `listings/:id/request-exchange` | native | `exchange-detail` | — |
| `listings/create` | native | `new-exchange` | — |
| `listings/edit/:id` | native | `edit-exchange` | — |
| `login` | native | `login` | — |
| `marketplace` | native | `marketplace` | — |
| `marketplace/:id` | native | `marketplace-detail` | — |
| `marketplace/:id/edit` | native | `edit-marketplace-listing` | — |
| `marketplace/become-partner` | native | `marketplace-become-partner` | — |
| `marketplace/category/:slug` | native | `marketplace-category` | — |
| `marketplace/collections` | native | `marketplace-collections` | — |
| `marketplace/free` | native | `marketplace-free` | — |
| `marketplace/map` | native | `marketplace-map` | — |
| `marketplace/me/pickups` | native | `marketplace-pickups` | — |
| `marketplace/my-listings` | native | `marketplace-my-listings` | — |
| `marketplace/my-offers` | native | `marketplace-offers` | — |
| `marketplace/orders` | native | `marketplace-orders` | — |
| `marketplace/orders/sales` | native | `marketplace-sales-orders` | — |
| `marketplace/reports` | out-of-scope | — | Marketplace moderation; administration surface. |
| `marketplace/reports/:id` | out-of-scope | — | Marketplace moderation; administration surface. |
| `marketplace/search` | native | `marketplace-search` | — |
| `marketplace/sell` | native | `new-marketplace-listing` | — |
| `marketplace/seller/:id` | native | `marketplace-seller` | — |
| `marketplace/seller/coupons` | native | `marketplace-coupons` | — |
| `marketplace/seller/coupons/:id/edit` | native | `marketplace-coupon-edit` | — |
| `marketplace/seller/coupons/new` | native | `marketplace-coupon-edit` | — |
| `marketplace/seller/onboard` | native | `marketplace-seller-onboarding` | — |
| `marketplace/seller/onboarding` | native | `marketplace-stripe-onboarding` | — |
| `marketplace/seller/pickup-scan` | native | `marketplace-pickup-scan` | — |
| `marketplace/seller/pickup-slots` | native | `marketplace-pickup-slots` | — |
| `marketplace/seller/shipping-options` | native | `marketplace-shipping-options` | — |
| `matches` | native | `matches` | — |
| `matches/preferences` | native | `match-preferences` | — |
| `me/collections` | native | `profile-collections` | — |
| `me/collections/:id` | native | `profile-collections` | — |
| `me/verein-dues` | out-of-scope | — | The API is guarded by the caring_community feature. Care in Community is intentionally excluded from both native apps. |
| `me/verein-invitations` | out-of-scope | — | Cross-Verein invitations are guarded by the caring_community feature. Care in Community is intentionally excluded from both native apps. |
| `members` | native | `members` | — |
| `messages` | native | `messages` | — |
| `messages/:id` | native | `thread` | — |
| `messages/new/:userId` | native | `new-message` | — |
| `municipality-calendar` | out-of-scope | — | Municipality-specific web surface. |
| `newsletter/unsubscribe` | out-of-scope | — | Reached from an email link; must work without the app installed. |
| `nexus-score` | native | `nexus-score` | — |
| `notifications` | native | `notifications` | — |
| `onboarding` | native | `onboarding` | — |
| `organisations` | native | `organisations` | — |
| `organisations/:id` | native | `organisation-detail` | — |
| `organisations/register` | native | `new-organisation` | — |
| `page/:slug` | out-of-scope | — | Tenant-authored static CMS pages; web-first. |
| `partner` | out-of-scope | — | Partner-facing web workspace. |
| `partner-analytics/dashboard` | out-of-scope | — | Partner analytics; dense reporting, web-first. |
| `partner-timebanks/*` | out-of-scope | — | Partner timebank workspace. |
| `password/forgot` | native | `forgot-password` | — |
| `password/reset` | native | `reset-password` | — |
| `pilot-apply` | out-of-scope | — | Sales and onboarding funnel, not a member journey. |
| `pilot-apply/status/:token` | out-of-scope | — | Sales and onboarding funnel. |
| `pilot-inquiry` | out-of-scope | — | Sales and onboarding funnel. |
| `platform/disclaimer` | out-of-scope | — | Platform legal document; web-first. |
| `platform/privacy` | out-of-scope | — | Platform legal document; web-first. |
| `platform/terms` | out-of-scope | — | Platform legal document; web-first. |
| `podcasts` | native | `podcasts` | — |
| `podcasts/:showSlug` | native | `podcast-show` | — |
| `podcasts/:showSlug/:episodeSlug` | native | `podcast-episode` | — |
| `podcasts/studio` | out-of-scope | — | Podcast authoring workspace. |
| `polls` | native | `polls` | — |
| `premium` | out-of-scope | — | Policy-blocked: native fundraising requires a documented Apple-approved nonprofit and Apple Pay design; do not add an external payment shortcut. |
| `premium/manage` | out-of-scope | — | Policy-blocked with the member_premium payment design; management cannot ship before the native entitlement and refund lifecycle is approved. |
| `premium/return` | out-of-scope | — | Policy-blocked: no native payment-return route is valid until the approved Apple Pay/fundraising flow exists. |
| `pricing` | out-of-scope | — | Marketing page. |
| `privacy` | out-of-scope | — | Legal document; mobile uses legal-document. |
| `privacy/versions` | out-of-scope | — | Legal version history; web-first. |
| `profile` | native | `profile` | — |
| `profile/:id` | native | `member-profile` | — |
| `regional-analytics` | out-of-scope | — | Regional analytics; dense reporting, web-first. |
| `register` | native | `register` | — |
| `resources` | native | `resources` | — |
| `reviews` | native | `reviews` | — |
| `reviews/create` | native | `reviews` | — |
| `saved` | native | `profile-collections` | — |
| `search` | native | `search` | — |
| `settings` | native | `settings` | — |
| `settings/blocked` | native | `settings-blocked-users` | — |
| `settings/data-export` | native | `settings-data-export` | — |
| `skills` | native | `skills` | — |
| `social-prescribing` | out-of-scope | — | Long-form editorial page; web-first. |
| `strategic-plan` | out-of-scope | — | Marketing/organisational page. |
| `super-admin/*` | out-of-scope | — | Platform super-admin workspace. |
| `support-actions/confirm/:token` | out-of-scope | — | Public side-effecting linked-account support confirmations remain browser-only; they are not an adults-only native member journey. |
| `terms` | out-of-scope | — | Legal document; mobile reads legal documents through legal-document. |
| `terms/versions` | out-of-scope | — | Legal version history; web-first. |
| `timebanking-guide` | out-of-scope | — | Long-form editorial guide; web-first. |
| `trust-and-safety` | out-of-scope | — | Long-form editorial page; web-first. |
| `users/:userId/appreciations` | native | `appreciations` | — |
| `users/:userId/collections` | native | `profile-collections` | — |
| `venues` | native | `venues` | — |
| `venues/checkin/:token` | native | `venue-checkin` | Venue staff get a confirmation screen; scanning alone never records a visit. |
| `venues/pass` | native | `venue-pass` | — |
| `verify-email` | native | `verify-email` | — |
| `verify-identity` | native | `verify-identity` | — |
| `verify-identity-optional` | native | `verify-identity` | — |
| `verify-identity/callback` | out-of-scope | — | Stripe Identity browser redirect target. |
| `volunteering` | native | `volunteering` | — |
| `volunteering/checkin/:token` | native | `volunteer-checkin` | Authorised coordinators explicitly confirm check-in and check-out; opening the link causes no mutation. |
| `volunteering/create` | native | `new-volunteering` | — |
| `volunteering/my-applications` | native | `volunteering` | — |
| `volunteering/my-organisations` | native | `volunteering` | — |
| `volunteering/opportunities/:id` | native | `volunteering-detail` | — |
| `volunteering/org/:orgId/dashboard` | native | `volunteering-org-dashboard` | — |
| `wallet` | native | `wallet` | — |
| `wallet/regional-points` | out-of-scope | — | Regional points are implemented by the Care in Community feature and are excluded from both native apps by the product-owner decision of 2026-08-28. |
| `whats-on` | out-of-scope | — | What's On is the anonymous public advertising twin of Events; the adults-only native clients are authenticated member products and keep anonymous public discovery on the web. |
| `whats-on/:id` | out-of-scope | — | What's On is the anonymous public advertising twin of Events; signed-in members use the native Events detail while anonymous public discovery remains on the web. |

## Mobile routes not claimed by any React route

Usually a mobile screen that splits one React page, or a native-only surface.
A surprise here can also mean a `native` declaration names the wrong screen.

- `select-tenant`
- `change-password`
- `edit-profile`
- `edit-volunteering`
- `endorsements`
- `event-attendance`
- `event-communications`
- `event-lifecycle-history`
- `event-recurrence-blueprints`
- `event-templates`
- `event-tickets`
- `exchange-request-detail`
- `exchange-requests`
- `gamification`
- `image-viewer`
- `legal-acceptance`
- `marketplace-coupon-redemptions`
- `marketplace-merchant-onboarding`
- `marketplace-order`
- `marketplace-promotions`
- `marketplace-saved-searches`
- `marketplace-tools`
- `new-post`
- `quick-create`
- `settings-delete-account`
- `settings-translation`
- `wallet-transaction`
- `create`
- `index`
