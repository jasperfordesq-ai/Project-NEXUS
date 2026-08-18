<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Mobile Route Parity Matrix

> GENERATED FILE — do not edit by hand.
> Regenerate with `npm run parity:matrix` from `mobile/`.
> Declarations live in `mobile/parity-map.json`; this file only reports them.

Route-level companion to [HEROUI_NATIVE_PARITY_AUDIT.md](../HEROUI_NATIVE_PARITY_AUDIT.md).
That document records product judgement per area; this one is falsifiable — it fails
when a React member route exists that nobody has classified for mobile.

| Measure | Count |
| --- | --- |
| React member routes | 254 |
| Mobile routes (Expo Router screens) | 137 |
| Covered natively | 125 |
| Deliberately out of scope | 65 |
| **Known gaps** | **33** |
| Awaiting review (shrink-only, budget 31) | 31 |
| **Undeclared (blocks `--check`)** | **0** |
| Mobile routes not claimed by a React route | 23 |
| Broken declarations | 0 |

## Awaiting review

Declared in the first pass but not yet judged. Shrink-only: this list may empty,
never grow. Each entry needs to become `native`, `gap` or `out-of-scope`.

| React route | Note |
| --- | --- |
| `caring-community/caregiver` | Caring Community member surfaces — feature gate is off by default and the module has no guide yet. |
| `caring-community/caregiver/cover` | Caring Community member surface. |
| `caring-community/caregiver/link` | Caring Community member surface. |
| `caring-community/civic-digest` | Caring Community member surface. |
| `caring-community/feedback` | Caring Community member surface. |
| `caring-community/future-care-fund` | Caring Community member surface. |
| `caring-community/hour-gift` | Caring Community member surface. |
| `caring-community/hour-transfer` | Caring Community member surface. |
| `caring-community/loyalty/history` | Caring Community member surface. |
| `caring-community/markt` | Caring Community member surface. |
| `caring-community/my-data-export` | Caring Community member surface. |
| `caring-community/my-relationships` | Caring Community member surface. |
| `caring-community/my-trust-tier` | Caring Community member surface. |
| `caring-community/offer-favour` | Caring Community member surface. |
| `caring-community/projects` | Caring Community member surface. |
| `caring-community/projects/:id` | Caring Community member surface. |
| `caring-community/providers` | Caring Community member surface. |
| `caring-community/request-help` | Caring Community member surface. |
| `caring-community/safeguarding/my-reports` | Safeguarding surface — needs a deliberate decision, not a default. |
| `caring-community/safeguarding/report` | Safeguarding surface — needs a deliberate decision, not a default. |
| `caring-community/success-stories` | Caring Community member surface. |
| `caring-community/surveys` | Caring Community member surface. |
| `caring-community/surveys/:id` | Caring Community member surface. |
| `caring-community/warmth-pass` | Caring Community member surface. |
| `groups/invite/:token` | Group invite token link. Same deep-link decision as join/:code. |
| `jobs/employers/:userId` | Employer public profile; unclear whether it is a member journey. |
| `join/:code` | Invite-code join. Decide whether +native-intent should handle it or it stays web. |
| `linked-accounts/:childId/messages/:partnerId` | Carer proxy message thread. can_view_messages is NOT enforced server-side; do not wire natively before that. |
| `support-actions/confirm/:token` | Support-action confirmation token link; needs a deep-link decision. |
| `venues/checkin/:token` | Venue check-in token link; needs a deep-link decision. |
| `volunteering/checkin/:token` | Volunteering check-in token link; needs a deep-link decision. |

## Known gaps (member-facing, wanted, not built)

| React route | Note |
| --- | --- |
| `clubs` | Clubs have no native route. |
| `courses` | Courses have no native route. Parity audit records this as partial by design. |
| `courses/:id/learn` | Course player has no native route. |
| `courses/:idOrSlug` | Courses have no native route. |
| `courses/my-learning` | Course enrolment list has no native route. |
| `donations/:id/receipt` | Donation receipts have no native route. |
| `events/:id/guardian-consent` | Guardian consent flow has no native route; safeguarding-sensitive. |
| `events/:id/manage/:section?` | Event organiser management console has no single native equivalent. |
| `ideation/:challengeId/ideas/:id` | Individual idea detail has no native route. |
| `ideation/:id/edit` | Ideation editing has no native route. |
| `ideation/campaigns` | Ideation campaigns have no native route. |
| `ideation/campaigns/:id` | Ideation campaigns have no native route. |
| `ideation/outcomes` | Ideation outcomes have no native route. |
| `jobs/my-applications` | No native "my applications" list; applications are reachable only per job. |
| `matches/preferences` | Match preferences cannot be edited natively. |
| `me/verein-dues` | Club dues have no native route. |
| `me/verein-invitations` | Club invitations have no native route. |
| `onboarding` | No native member onboarding flow; new members land on the tabs. |
| `podcasts` | Podcasts have no native route. Parity audit records this as partial by design. |
| `podcasts/:showSlug` | Podcasts have no native route. |
| `podcasts/:showSlug/:episodeSlug` | Podcast episode player has no native route. |
| `premium` | Donations and support (member_premium) has no native surface. |
| `premium/manage` | Premium management has no native surface. |
| `premium/return` | Premium payment return page has no native surface. |
| `reviews/create` | No native review composer; reviews are read-only on mobile. |
| `venues` | Venues have no native route. |
| `venues/pass` | Venue pass has no native route. |
| `verify-identity-optional` | Optional identity-verification prompt has no native route. |
| `volunteering/my-applications` | No native volunteering applications list. |
| `volunteering/my-organisations` | No native list of the organisations a member belongs to. |
| `wallet/regional-points` | Regional points wallet view has no native route. |
| `whats-on` | Public What's On listing has no native route. |
| `whats-on/:id` | Public What's On detail has no native route. |

## Full matrix

| React route | Status | Mobile screen | Reason |
| --- | --- | --- | --- |
| `about` | out-of-scope | — | Marketing page. |
| `acceptable-use` | out-of-scope | — | Legal document; mobile uses legal-document. |
| `acceptable-use/versions` | out-of-scope | — | Legal version history; web-first. |
| `accessibility` | out-of-scope | — | Accessibility statement; web-first. |
| `accessibility/versions` | out-of-scope | — | Legal version history; web-first. |
| `achievements` | native | `achievements` | — |
| `activity` | native | `activity` | — |
| `admin/*` | out-of-scope | — | Tenant administration workspace; the member app has no admin surface. |
| `advertise/campaigns` | out-of-scope | — | Tenant advertising administration. |
| `advertise/push-campaigns` | out-of-scope | — | Tenant push-campaign administration. |
| `auth/oauth/callback` | out-of-scope | — | Browser OAuth redirect target; native OAuth needs its own deep-link design. |
| `blog` | native | `blog` | — |
| `blog/:slug` | native | `blog-post` | — |
| `broker/*` | out-of-scope | — | Broker workspace — an operational role with its own React application. |
| `caring-community/caregiver` | needs-review | — | Caring Community member surfaces — feature gate is off by default and the module has no guide yet. |
| `caring-community/caregiver/cover` | needs-review | — | Caring Community member surface. |
| `caring-community/caregiver/link` | needs-review | — | Caring Community member surface. |
| `caring-community/civic-digest` | needs-review | — | Caring Community member surface. |
| `caring-community/feedback` | needs-review | — | Caring Community member surface. |
| `caring-community/future-care-fund` | needs-review | — | Caring Community member surface. |
| `caring-community/hour-gift` | needs-review | — | Caring Community member surface. |
| `caring-community/hour-transfer` | needs-review | — | Caring Community member surface. |
| `caring-community/loyalty/history` | needs-review | — | Caring Community member surface. |
| `caring-community/markt` | needs-review | — | Caring Community member surface. |
| `caring-community/my-data-export` | needs-review | — | Caring Community member surface. |
| `caring-community/my-relationships` | needs-review | — | Caring Community member surface. |
| `caring-community/my-trust-tier` | needs-review | — | Caring Community member surface. |
| `caring-community/offer-favour` | needs-review | — | Caring Community member surface. |
| `caring-community/projects` | needs-review | — | Caring Community member surface. |
| `caring-community/projects/:id` | needs-review | — | Caring Community member surface. |
| `caring-community/providers` | needs-review | — | Caring Community member surface. |
| `caring-community/request-help` | needs-review | — | Caring Community member surface. |
| `caring-community/safeguarding/my-reports` | needs-review | — | Safeguarding surface — needs a deliberate decision, not a default. |
| `caring-community/safeguarding/report` | needs-review | — | Safeguarding surface — needs a deliberate decision, not a default. |
| `caring-community/success-stories` | needs-review | — | Caring Community member surface. |
| `caring-community/surveys` | needs-review | — | Caring Community member surface. |
| `caring-community/surveys/:id` | needs-review | — | Caring Community member surface. |
| `caring-community/warmth-pass` | needs-review | — | Caring Community member surface. |
| `caring/*` | out-of-scope | — | Caring Community staff workspace. |
| `changelog` | out-of-scope | — | Marketing/release page. |
| `chat` | native | `chat` | — |
| `clubs` | gap | — | Clubs have no native route. |
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
| `courses` | gap | — | Courses have no native route. Parity audit records this as partial by design. |
| `courses/:id/learn` | gap | — | Course player has no native route. |
| `courses/:idOrSlug` | gap | — | Courses have no native route. |
| `courses/instructor` | out-of-scope | — | Course authoring workspace. |
| `courses/instructor/:id/analytics` | out-of-scope | — | Course authoring workspace. |
| `courses/instructor/:id/edit` | out-of-scope | — | Course authoring workspace. |
| `courses/instructor/:id/grading` | out-of-scope | — | Course authoring workspace. |
| `courses/instructor/new` | out-of-scope | — | Course authoring workspace. |
| `courses/my-learning` | gap | — | Course enrolment list has no native route. |
| `dashboard` | native | `home` | — |
| `developers` | out-of-scope | — | Developer API documentation; a web reference, not a member journey. |
| `developers/auth` | out-of-scope | — | Developer API documentation. |
| `developers/endpoints` | out-of-scope | — | Developer API documentation. |
| `developers/webhooks` | out-of-scope | — | Developer API documentation. |
| `development-status` | out-of-scope | — | Marketing/release page. |
| `donations/:id/receipt` | gap | — | Donation receipts have no native route. |
| `events` | native | `events` | — |
| `events/:id` | native | `event-detail` | — |
| `events/:id/edit` | native | `edit-event` | — |
| `events/:id/guardian-consent` | gap | — | Guardian consent flow has no native route; safeguarding-sensitive. |
| `events/:id/manage/:section?` | gap | — | Event organiser management console has no single native equivalent. |
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
| `groups/invite/:token` | needs-review | — | Group invite token link. Same deep-link decision as join/:code. |
| `help` | native | `support` | — |
| `ideation` | native | `ideation` | — |
| `ideation/:challengeId/ideas/:id` | gap | — | Individual idea detail has no native route. |
| `ideation/:id` | native | `ideation-detail` | — |
| `ideation/:id/edit` | gap | — | Ideation editing has no native route. |
| `ideation/campaigns` | gap | — | Ideation campaigns have no native route. |
| `ideation/campaigns/:id` | gap | — | Ideation campaigns have no native route. |
| `ideation/create` | native | `new-challenge` | — |
| `ideation/outcomes` | gap | — | Ideation outcomes have no native route. |
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
| `jobs/employers/:userId` | needs-review | — | Employer public profile; unclear whether it is a member journey. |
| `jobs/my-applications` | gap | — | No native "my applications" list; applications are reachable only per job. |
| `jobs/talent-search` | out-of-scope | — | Employer administration depth; web-first per the parity audit. |
| `join/:code` | needs-review | — | Invite-code join. Decide whether +native-intent should handle it or it stays web. |
| `kb` | native | `resources` | — |
| `kb/:id` | native | `kb-article` | — |
| `leaderboard` | native | `leaderboard` | — |
| `legal` | native | `legal-document` | — |
| `legal/:slug` | native | `legal-document` | — |
| `legal/:slug/versions` | out-of-scope | — | Legal version history; web-first. |
| `linked-accounts/:childId/messages` | native | `settings-linked-accounts` | — |
| `linked-accounts/:childId/messages/:partnerId` | needs-review | — | Carer proxy message thread. can_view_messages is NOT enforced server-side; do not wire natively before that. |
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
| `matches/preferences` | gap | — | Match preferences cannot be edited natively. |
| `me/collections` | native | `profile-collections` | — |
| `me/collections/:id` | native | `profile-collections` | — |
| `me/verein-dues` | gap | — | Club dues have no native route. |
| `me/verein-invitations` | gap | — | Club invitations have no native route. |
| `members` | native | `members` | — |
| `messages` | native | `messages` | — |
| `messages/:id` | native | `thread` | — |
| `messages/new/:userId` | native | `new-message` | — |
| `municipality-calendar` | out-of-scope | — | Municipality-specific web surface. |
| `newsletter/unsubscribe` | out-of-scope | — | Reached from an email link; must work without the app installed. |
| `nexus-score` | native | `nexus-score` | — |
| `notifications` | native | `notifications` | — |
| `onboarding` | gap | — | No native member onboarding flow; new members land on the tabs. |
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
| `podcasts` | gap | — | Podcasts have no native route. Parity audit records this as partial by design. |
| `podcasts/:showSlug` | gap | — | Podcasts have no native route. |
| `podcasts/:showSlug/:episodeSlug` | gap | — | Podcast episode player has no native route. |
| `podcasts/studio` | out-of-scope | — | Podcast authoring workspace. |
| `polls` | native | `polls` | — |
| `premium` | gap | — | Donations and support (member_premium) has no native surface. |
| `premium/manage` | gap | — | Premium management has no native surface. |
| `premium/return` | gap | — | Premium payment return page has no native surface. |
| `pricing` | out-of-scope | — | Marketing page. |
| `privacy` | out-of-scope | — | Legal document; mobile uses legal-document. |
| `privacy/versions` | out-of-scope | — | Legal version history; web-first. |
| `profile` | native | `profile` | — |
| `profile/:id` | native | `member-profile` | — |
| `regional-analytics` | out-of-scope | — | Regional analytics; dense reporting, web-first. |
| `register` | native | `register` | — |
| `resources` | native | `resources` | — |
| `reviews` | native | `reviews` | — |
| `reviews/create` | gap | — | No native review composer; reviews are read-only on mobile. |
| `saved` | native | `profile-collections` | — |
| `search` | native | `search` | — |
| `settings` | native | `settings` | — |
| `settings/blocked` | native | `settings-blocked-users` | — |
| `settings/data-export` | native | `settings-data-export` | — |
| `skills` | native | `skills` | — |
| `social-prescribing` | out-of-scope | — | Long-form editorial page; web-first. |
| `strategic-plan` | out-of-scope | — | Marketing/organisational page. |
| `super-admin/*` | out-of-scope | — | Platform super-admin workspace. |
| `support-actions/confirm/:token` | needs-review | — | Support-action confirmation token link; needs a deep-link decision. |
| `terms` | out-of-scope | — | Legal document; mobile reads legal documents through legal-document. |
| `terms/versions` | out-of-scope | — | Legal version history; web-first. |
| `timebanking-guide` | out-of-scope | — | Long-form editorial guide; web-first. |
| `trust-and-safety` | out-of-scope | — | Long-form editorial page; web-first. |
| `users/:userId/appreciations` | native | `appreciations` | — |
| `users/:userId/collections` | native | `profile-collections` | — |
| `venues` | gap | — | Venues have no native route. |
| `venues/checkin/:token` | needs-review | — | Venue check-in token link; needs a deep-link decision. |
| `venues/pass` | gap | — | Venue pass has no native route. |
| `verify-email` | native | `verify-email` | — |
| `verify-identity` | native | `verify-identity` | — |
| `verify-identity-optional` | gap | — | Optional identity-verification prompt has no native route. |
| `verify-identity/callback` | out-of-scope | — | Stripe Identity browser redirect target. |
| `volunteering` | native | `volunteering` | — |
| `volunteering/checkin/:token` | needs-review | — | Volunteering check-in token link; needs a deep-link decision. |
| `volunteering/create` | native | `new-volunteering` | — |
| `volunteering/my-applications` | gap | — | No native volunteering applications list. |
| `volunteering/my-organisations` | gap | — | No native list of the organisations a member belongs to. |
| `volunteering/opportunities/:id` | native | `volunteering-detail` | — |
| `volunteering/org/:orgId/dashboard` | native | `volunteering-org-dashboard` | — |
| `wallet` | native | `wallet` | — |
| `wallet/regional-points` | gap | — | Regional points wallet view has no native route. |
| `whats-on` | gap | — | Public What's On listing has no native route. |
| `whats-on/:id` | gap | — | Public What's On detail has no native route. |

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
- `gamification`
- `image-viewer`
- `legal-acceptance`
- `marketplace-coupon-redemptions`
- `marketplace-merchant-onboarding`
- `marketplace-promotions`
- `marketplace-saved-searches`
- `marketplace-tools`
- `quick-create`
- `settings-translation`
- `create`
- `index`
