<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Mobile API Consumer Ledger

Last reviewed: 2026-08-23

> GENERATED FILE — do not edit by hand.
> Regenerate with `npm run api:ledger` from `mobile/`.

Every Laravel endpoint the Expo client calls, and whether the API still exposes it.
The Jest suite mocks the HTTP client, so it cannot detect a renamed or deleted route.
This ledger is the compensating control.

Verified against: `docs/generated/laravel-api-route-inventory.json (2232 distinct API paths)`

> Not verified against `openapi.json`. That file documents 862 paths of the 2,232 the
> application actually registers, so using it produced 179 false drift findings out of 404.

| Measure | Count |
| --- | --- |
| API modules read | 49 |
| Call sites | 504 |
| Distinct method + endpoint pairs | 415 |
| Verified against openapi.json | 415 |
| **Missing from Laravel routes** | **0** |
| **Method mismatch** | **0** |
| Dynamic, not verifiable | 74 |
| Inline `fetch()` bypassing the client | 0 |

## Not verifiable (endpoint assembled at runtime)

These are not failures. They are the honest edge of what static reading can prove,
and the places a contract test earns the most.

| Location | Method | Reason |
| --- | --- | --- |
| eventCommunications.ts:157 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventCommunications.ts:169 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventCommunications.ts:179 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventCommunications.ts:189 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventCommunications.ts:203 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventCommunications.ts:217 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventCommunications.ts:231 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventCommunications.ts:244 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:234 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:241 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:249 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:263 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:275 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:287 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:302 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:313 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:335 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:345 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:356 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:190 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:204 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:220 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:233 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:245 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:263 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:284 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:306 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafety.ts:138 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafety.ts:148 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafety.ts:160 | DELETE | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafety.ts:174 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafety.ts:188 | DELETE | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:164 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:172 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:181 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:191 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventTickets.ts:137 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventTickets.ts:148 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventTickets.ts:160 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:940 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1115 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1128 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1140 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1152 | DELETE | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1166 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1188 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1207 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1218 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1232 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1245 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1268 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1274 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1290 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1306 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1317 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1323 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1329 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1335 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1347 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1357 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1372 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1389 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1395 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1404 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1413 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1424 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1435 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1441 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1492 | POST | endpoint literal nests a template inside an interpolation and could not be resolved statically |
| feed.ts:230 | GET | variable "path" is not a literal endpoint in this module |
| marketplace.ts:605 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| marketplace.ts:606 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| marketplace.ts:835 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| marketplace.ts:836 | GET | variable "endpoint" is assigned more than one endpoint in this module |

## Verified endpoints

| Method | Endpoint | Call sites |
| --- | --- | --- |
| POST | `/api/ai/chat` | chat.ts:85 |
| POST | `/api/ai/chat/feedback` | chat.ts:130 |
| GET | `/api/ai/chat/starters` | chat.ts:120 |
| GET | `/api/ai/conversations/{param}` | chat.ts:116 |
| POST | `/api/auth/forgot-password` | auth.ts:163 |
| POST | `/api/auth/login` | auth.ts:140 |
| POST | `/api/auth/logout` | auth.ts:178 |
| POST | `/api/auth/refresh-token` | auth.ts:188 |
| POST | `/api/auth/reset-password` | auth.ts:168 |
| POST | `/api/auth/verify-email` | auth.ts:173 |
| POST | `/api/v2/appreciations/{param}/react` | appreciations.ts:53 |
| POST | `/api/v2/auth/register` | auth.ts:152 |
| GET | `/api/v2/blog` | blog.ts:45 |
| GET | `/api/v2/blog/{param}` | blog.ts:56 |
| POST | `/api/v2/bookmarks` | feed.ts:341 |
| GET | `/api/v2/categories` | exchanges.ts:180 |
| GET | `/api/v2/comments` | comments.ts:74, exchanges.ts:228 |
| POST | `/api/v2/comments` | comments.ts:86, exchanges.ts:235 |
| DELETE | `/api/v2/comments/{param}` | comments.ts:106 |
| PUT | `/api/v2/comments/{param}` | comments.ts:98 |
| POST | `/api/v2/comments/{param}/reactions` | comments.ts:113 |
| GET | `/api/v2/connections` | connections.ts:54 |
| DELETE | `/api/v2/connections/{param}` | connections.ts:74 |
| POST | `/api/v2/connections/{param}/accept` | connections.ts:69 |
| POST | `/api/v2/connections/request` | connections.ts:64 |
| GET | `/api/v2/connections/status/{param}` | connections.ts:59 |
| GET | `/api/v2/coupons` | marketplace.ts:1164 |
| GET | `/api/v2/coupons/{param}` | marketplace.ts:1168 |
| POST | `/api/v2/coupons/{param}/qr` | marketplace.ts:1172 |
| POST | `/api/v2/coupons/redeem-qr` | marketplace.ts:1176 |
| POST | `/api/v2/coupons/validate` | marketplace.ts:855 |
| GET | `/api/v2/events/{param}/analytics` | eventAnalytics.ts:119 |
| GET | `/api/v2/events/{param}/lifecycle-history` | eventLifecycleHistory.ts:61 |
| DELETE | `/api/v2/events/{param}/rsvp` | events.ts:1120 |
| DELETE | `/api/v2/events/{param}/waitlist` | events.ts:1237 |
| GET | `/api/v2/events/{param}/waitlist` | events.ts:1223 |
| GET | `/api/v2/exchanges` | exchangeRequests.ts:114 |
| POST | `/api/v2/exchanges` | client.ts:479, exchanges.ts:205 |
| DELETE | `/api/v2/exchanges/{param}` | exchangeRequests.ts:196 |
| GET | `/api/v2/exchanges/{param}` | exchangeRequests.ts:122 |
| POST | `/api/v2/exchanges/{param}/accept` | exchangeRequests.ts:141 |
| POST | `/api/v2/exchanges/{param}/complete` | exchangeRequests.ts:161 |
| POST | `/api/v2/exchanges/{param}/confirm` | exchangeRequests.ts:177 |
| POST | `/api/v2/exchanges/{param}/decline` | exchangeRequests.ts:149 |
| POST | `/api/v2/exchanges/{param}/start` | exchangeRequests.ts:156 |
| GET | `/api/v2/exchanges/check` | exchanges.ts:200 |
| GET | `/api/v2/exchanges/config` | exchanges.ts:195 |
| GET | `/api/v2/exchanges/needs-attention-count` | exchangeRequests.ts:134 |
| GET | `/api/v2/explore` | explore.ts:184 |
| GET | `/api/v2/federation/activity` | federation.ts:276 |
| GET | `/api/v2/federation/connections` | federation.ts:390 |
| POST | `/api/v2/federation/connections` | federation.ts:410 |
| DELETE | `/api/v2/federation/connections/{param}` | federation.ts:402 |
| POST | `/api/v2/federation/connections/{param}/accept` | federation.ts:394 |
| POST | `/api/v2/federation/connections/{param}/reject` | federation.ts:398 |
| GET | `/api/v2/federation/connections/status/{param}/{param}` | federation.ts:406 |
| GET | `/api/v2/federation/events` | federation.ts:315 |
| GET | `/api/v2/federation/groups` | federation.ts:311 |
| GET | `/api/v2/federation/listings` | federation.ts:307 |
| GET | `/api/v2/federation/members` | federation.ts:287 |
| GET | `/api/v2/federation/members/{param}` | federation.ts:295 |
| GET | `/api/v2/federation/members/{param}/reviews` | federation.ts:303 |
| GET | `/api/v2/federation/messages` | federation.ts:319 |
| POST | `/api/v2/federation/messages` | federation.ts:329 |
| POST | `/api/v2/federation/messages/{param}/mark-read` | federation.ts:345 |
| POST | `/api/v2/federation/messages/{param}/translate` | federation.ts:353 |
| POST | `/api/v2/federation/messages/mark-read-batch` | federation.ts:349 |
| POST | `/api/v2/federation/opt-in` | federation.ts:337 |
| POST | `/api/v2/federation/opt-out` | federation.ts:341 |
| GET | `/api/v2/federation/partners` | federation.ts:250 |
| GET | `/api/v2/federation/partners/{param}` | federation.ts:283 |
| GET | `/api/v2/federation/settings` | federation.ts:359 |
| PUT | `/api/v2/federation/settings` | federation.ts:363 |
| POST | `/api/v2/federation/setup` | federation.ts:367 |
| GET | `/api/v2/federation/status` | federation.ts:257, federation.ts:272 |
| POST | `/api/v2/federation/transactions` | federation.ts:333 |
| GET | `/api/v2/feed` | feed.ts:221 |
| GET | `/api/v2/feed/hashtags/{param}` | feed.ts:252 |
| GET | `/api/v2/feed/hashtags/search` | feed.ts:240 |
| GET | `/api/v2/feed/hashtags/trending` | feed.ts:234 |
| POST | `/api/v2/feed/like` | exchanges.ts:221, feed.ts:327 |
| GET | `/api/v2/feed/polls/{param}` | feed.ts:351 |
| POST | `/api/v2/feed/polls/{param}/vote` | feed.ts:358 |
| POST | `/api/v2/feed/posts/{param}/hide` | feedModeration.ts:42 |
| POST | `/api/v2/feed/posts/{param}/not-interested` | feedModeration.ts:53 |
| POST | `/api/v2/feed/posts/{param}/report` | feedModeration.ts:69 |
| POST | `/api/v2/feed/users/{param}/mute` | feedModeration.ts:77 |
| GET | `/api/v2/gamification/badges` | gamification.ts:166, gamification.ts:168 |
| GET | `/api/v2/gamification/challenges` | gamification.ts:216 |
| POST | `/api/v2/gamification/challenges/{param}/claim` | gamification.ts:224 |
| GET | `/api/v2/gamification/collections` | gamification.ts:232 |
| GET | `/api/v2/gamification/daily-reward` | gamification.ts:200 |
| POST | `/api/v2/gamification/daily-reward` | gamification.ts:208 |
| GET | `/api/v2/gamification/leaderboard` | gamification.ts:181 |
| GET | `/api/v2/gamification/nexus-score` | gamification.ts:190, gamification.ts:192 |
| GET | `/api/v2/gamification/profile` | gamification.ts:155, gamification.ts:157 |
| GET | `/api/v2/gamification/shop` | gamification.ts:240 |
| POST | `/api/v2/gamification/shop/purchase` | gamification.ts:248 |
| PUT | `/api/v2/gamification/showcase` | gamification.ts:256 |
| GET | `/api/v2/goals` | goals.ts:131 |
| POST | `/api/v2/goals` | goals.ts:150 |
| GET | `/api/v2/goals/{param}` | goals.ts:135 |
| PUT | `/api/v2/goals/{param}` | goals.ts:175 |
| GET | `/api/v2/goals/{param}/history` | goals.ts:183 |
| GET | `/api/v2/goals/{param}/insights` | goals.ts:187 |
| POST | `/api/v2/goals/{param}/progress` | goals.ts:179 |
| DELETE | `/api/v2/goals/{param}/reminder` | goals.ts:199 |
| GET | `/api/v2/goals/{param}/reminder` | goals.ts:191 |
| PUT | `/api/v2/goals/{param}/reminder` | goals.ts:195 |
| POST | `/api/v2/goals/from-template/{param}` | goals.ts:164 |
| GET | `/api/v2/goals/templates` | goals.ts:156 |
| GET | `/api/v2/goals/templates/categories` | goals.ts:160 |
| GET | `/api/v2/group-exchanges` | groupExchanges.ts:83 |
| POST | `/api/v2/group-exchanges` | groupExchanges.ts:91 |
| DELETE | `/api/v2/group-exchanges/{param}` | groupExchanges.ts:103 |
| GET | `/api/v2/group-exchanges/{param}` | groupExchanges.ts:87 |
| POST | `/api/v2/group-exchanges/{param}/complete` | groupExchanges.ts:99 |
| POST | `/api/v2/group-exchanges/{param}/confirm` | groupExchanges.ts:95 |
| GET | `/api/v2/group-templates` | groups.ts:399 |
| GET | `/api/v2/groups` | groups.ts:377 |
| POST | `/api/v2/groups` | groups.ts:391 |
| GET | `/api/v2/groups/{param}` | groups.ts:384 |
| PUT | `/api/v2/groups/{param}` | groups.ts:395 |
| GET | `/api/v2/groups/{param}/analytics` | groups.ts:576 |
| GET | `/api/v2/groups/{param}/analytics/comparative` | groups.ts:588 |
| GET | `/api/v2/groups/{param}/analytics/retention` | groups.ts:582 |
| GET | `/api/v2/groups/{param}/announcements` | groups.ts:526 |
| POST | `/api/v2/groups/{param}/announcements` | groups.ts:730 |
| DELETE | `/api/v2/groups/{param}/announcements/{param}` | groups.ts:748 |
| PUT | `/api/v2/groups/{param}/announcements/{param}` | groups.ts:741 |
| POST | `/api/v2/groups/{param}/answers/{param}/accept` | groups.ts:634 |
| GET | `/api/v2/groups/{param}/discussions` | groups.ts:514 |
| POST | `/api/v2/groups/{param}/discussions` | groups.ts:720 |
| GET | `/api/v2/groups/{param}/files` | groups.ts:538 |
| DELETE | `/api/v2/groups/{param}/files/{param}` | groups.ts:542 |
| POST | `/api/v2/groups/{param}/image` | groups.ts:484 |
| POST | `/api/v2/groups/{param}/join` | groups.ts:755 |
| GET | `/api/v2/groups/{param}/media` | groups.ts:555 |
| POST | `/api/v2/groups/{param}/media` | groups.ts:565 |
| DELETE | `/api/v2/groups/{param}/media/{param}` | groups.ts:559 |
| GET | `/api/v2/groups/{param}/members` | groups.ts:502 |
| DELETE | `/api/v2/groups/{param}/membership` | groups.ts:762 |
| POST | `/api/v2/groups/{param}/qa/vote` | groups.ts:630 |
| GET | `/api/v2/groups/{param}/questions` | groups.ts:601 |
| POST | `/api/v2/groups/{param}/questions` | groups.ts:612 |
| GET | `/api/v2/groups/{param}/questions/{param}` | groups.ts:605 |
| POST | `/api/v2/groups/{param}/questions/{param}/answers` | groups.ts:620 |
| GET | `/api/v2/groups/{param}/task-stats` | groups.ts:685 |
| GET | `/api/v2/groups/{param}/tasks` | groups.ts:681 |
| POST | `/api/v2/groups/{param}/tasks` | groups.ts:699 |
| GET | `/api/v2/groups/{param}/wiki` | groups.ts:641 |
| POST | `/api/v2/groups/{param}/wiki` | groups.ts:652 |
| DELETE | `/api/v2/groups/{param}/wiki/{param}` | groups.ts:664 |
| GET | `/api/v2/groups/{param}/wiki/{param}` | groups.ts:645 |
| PUT | `/api/v2/groups/{param}/wiki/{param}` | groups.ts:660 |
| GET | `/api/v2/groups/{param}/wiki/{param}/revisions` | groups.ts:668 |
| GET | `/api/v2/ideation-categories` | ideation.ts:118 |
| GET | `/api/v2/ideation-challenges` | ideation.ts:113 |
| POST | `/api/v2/ideation-challenges` | ideation.ts:131 |
| GET | `/api/v2/ideation-challenges/{param}` | ideation.ts:123 |
| GET | `/api/v2/ideation-challenges/{param}/ideas` | ideation.ts:139 |
| POST | `/api/v2/ideation-challenges/{param}/ideas` | ideation.ts:147 |
| POST | `/api/v2/ideation-ideas/{param}/vote` | ideation.ts:155 |
| POST | `/api/v2/identity/create-payment` | verification.ts:112 |
| POST | `/api/v2/identity/save-dob` | verification.ts:102 |
| POST | `/api/v2/identity/start` | verification.ts:108 |
| GET | `/api/v2/identity/status` | verification.ts:98 |
| GET | `/api/v2/jobs` | jobs.ts:242 |
| POST | `/api/v2/jobs` | jobs.ts:246 |
| GET | `/api/v2/jobs/{param}` | jobs.ts:277 |
| PUT | `/api/v2/jobs/{param}` | jobs.ts:250, jobs.ts:254 |
| GET | `/api/v2/jobs/{param}/analytics` | jobs.ts:285 |
| GET | `/api/v2/jobs/{param}/applications` | jobs.ts:281 |
| POST | `/api/v2/jobs/{param}/apply` | jobs.ts:317 |
| GET | `/api/v2/jobs/{param}/match` | jobs.ts:401 |
| GET | `/api/v2/jobs/{param}/predictions` | jobs.ts:289 |
| DELETE | `/api/v2/jobs/{param}/save` | jobs.ts:333 |
| POST | `/api/v2/jobs/{param}/save` | jobs.ts:326 |
| GET | `/api/v2/jobs/alerts` | jobs.ts:364 |
| POST | `/api/v2/jobs/alerts` | jobs.ts:371 |
| DELETE | `/api/v2/jobs/alerts/{param}` | jobs.ts:378 |
| PUT | `/api/v2/jobs/alerts/{param}/resubscribe` | jobs.ts:392 |
| PUT | `/api/v2/jobs/alerts/{param}/unsubscribe` | jobs.ts:385 |
| PUT | `/api/v2/jobs/applications/{param}` | jobs.ts:296, jobs.ts:304 |
| GET | `/api/v2/jobs/applications/{param}/history` | jobs.ts:300 |
| POST | `/api/v2/jobs/generate-description` | jobs.ts:263 |
| PUT | `/api/v2/jobs/interviews/{param}/accept` | jobs.ts:417 |
| PUT | `/api/v2/jobs/interviews/{param}/decline` | jobs.ts:429 |
| GET | `/api/v2/jobs/my-applications` | jobs.ts:346 |
| GET | `/api/v2/jobs/my-interviews` | jobs.ts:408 |
| GET | `/api/v2/jobs/my-offers` | jobs.ts:440 |
| GET | `/api/v2/jobs/my-postings` | jobs.ts:357 |
| PUT | `/api/v2/jobs/offers/{param}/accept` | jobs.ts:449 |
| PUT | `/api/v2/jobs/offers/{param}/reject` | jobs.ts:461 |
| GET | `/api/v2/jobs/recommended` | jobs.ts:270 |
| GET | `/api/v2/jobs/saved-profile` | jobs.ts:473 |
| GET | `/api/v2/kb` | resources.ts:100 |
| GET | `/api/v2/kb/{param}` | resources.ts:110 |
| GET | `/api/v2/kb/search` | resources.ts:105 |
| GET | `/api/v2/legal/{param}` | legal.ts:104 |
| POST | `/api/v2/legal/acceptance/accept-all` | legal.ts:94 |
| GET | `/api/v2/legal/acceptance/status` | legal.ts:82 |
| GET | `/api/v2/listings` | exchanges.ts:168 |
| POST | `/api/v2/listings` | exchanges.ts:185 |
| DELETE | `/api/v2/listings/{param}` | exchanges.ts:321 |
| GET | `/api/v2/listings/{param}` | exchanges.ts:176 |
| PUT | `/api/v2/listings/{param}` | exchanges.ts:255 |
| DELETE | `/api/v2/listings/{param}/image` | exchanges.ts:316 |
| POST | `/api/v2/listings/{param}/image` | exchanges.ts:305 |
| POST | `/api/v2/listings/{param}/renew` | exchanges.ts:217 |
| POST | `/api/v2/listings/{param}/report` | exchanges.ts:243 |
| DELETE | `/api/v2/listings/{param}/save` | exchanges.ts:213 |
| POST | `/api/v2/listings/{param}/save` | exchanges.ts:209 |
| PUT | `/api/v2/listings/{param}/tags` | exchanges.ts:190 |
| POST | `/api/v2/listings/generate-description` | exchanges.ts:247 |
| GET | `/api/v2/marketplace/categories` | marketplace.ts:592 |
| GET | `/api/v2/marketplace/categories/{param}/template` | marketplace.ts:596 |
| GET | `/api/v2/marketplace/collections` | marketplace.ts:980 |
| POST | `/api/v2/marketplace/collections` | marketplace.ts:988 |
| DELETE | `/api/v2/marketplace/collections/{param}` | marketplace.ts:992 |
| GET | `/api/v2/marketplace/collections/{param}/items` | marketplace.ts:1003 |
| POST | `/api/v2/marketplace/collections/{param}/items` | marketplace.ts:1007 |
| DELETE | `/api/v2/marketplace/collections/{param}/items/{param}` | marketplace.ts:1014 |
| GET | `/api/v2/marketplace/groups/{param}/listings` | marketplace.ts:954 |
| GET | `/api/v2/marketplace/groups/{param}/stats` | marketplace.ts:958 |
| GET | `/api/v2/marketplace/listings` | marketplace.ts:562 |
| POST | `/api/v2/marketplace/listings` | marketplace.ts:612 |
| DELETE | `/api/v2/marketplace/listings/{param}` | marketplace.ts:631 |
| PUT | `/api/v2/marketplace/listings/{param}` | marketplace.ts:619 |
| POST | `/api/v2/marketplace/listings/{param}/images` | marketplace.ts:656 |
| DELETE | `/api/v2/marketplace/listings/{param}/images/{param}` | marketplace.ts:660 |
| POST | `/api/v2/marketplace/listings/{param}/offers` | marketplace.ts:685 |
| POST | `/api/v2/marketplace/listings/{param}/promote` | marketplace.ts:1026 |
| POST | `/api/v2/marketplace/listings/{param}/renew` | marketplace.ts:650 |
| POST | `/api/v2/marketplace/listings/{param}/report` | marketplace.ts:642 |
| DELETE | `/api/v2/marketplace/listings/{param}/save` | marketplace.ts:646 |
| POST | `/api/v2/marketplace/listings/{param}/save` | marketplace.ts:635 |
| DELETE | `/api/v2/marketplace/listings/{param}/video` | marketplace.ts:670 |
| POST | `/api/v2/marketplace/listings/{param}/video` | marketplace.ts:666 |
| GET | `/api/v2/marketplace/listings/featured` | marketplace.ts:580 |
| GET | `/api/v2/marketplace/listings/free` | marketplace.ts:588 |
| POST | `/api/v2/marketplace/listings/generate-description` | marketplace.ts:627 |
| GET | `/api/v2/marketplace/listings/nearby` | marketplace.ts:576 |
| GET | `/api/v2/marketplace/me/pickups` | marketplace.ts:1107 |
| GET | `/api/v2/marketplace/my-offers/{param}` | marketplace.ts:695 |
| DELETE | `/api/v2/marketplace/offers/{param}` | marketplace.ts:718 |
| PUT | `/api/v2/marketplace/offers/{param}/accept` | marketplace.ts:699 |
| PUT | `/api/v2/marketplace/offers/{param}/accept-counter` | marketplace.ts:710 |
| PUT | `/api/v2/marketplace/offers/{param}/counter` | marketplace.ts:706 |
| PUT | `/api/v2/marketplace/offers/{param}/decline` | marketplace.ts:714 |
| POST | `/api/v2/marketplace/orders` | marketplace.ts:802 |
| GET | `/api/v2/marketplace/orders/{param}` | marketplace.ts:730 |
| PUT | `/api/v2/marketplace/orders/{param}/cancel` | marketplace.ts:745 |
| PUT | `/api/v2/marketplace/orders/{param}/confirm-delivery` | marketplace.ts:741 |
| GET | `/api/v2/marketplace/orders/{param}/delivery-offers` | marketplace.ts:767 |
| POST | `/api/v2/marketplace/orders/{param}/delivery-offers` | marketplace.ts:774 |
| PUT | `/api/v2/marketplace/orders/{param}/delivery-offers/{param}/accept` | marketplace.ts:781 |
| PUT | `/api/v2/marketplace/orders/{param}/delivery-offers/{param}/confirm` | marketplace.ts:788 |
| POST | `/api/v2/marketplace/orders/{param}/dispute` | marketplace.ts:759 |
| POST | `/api/v2/marketplace/orders/{param}/pickup-reservation` | marketplace.ts:840 |
| POST | `/api/v2/marketplace/orders/{param}/rate` | marketplace.ts:752 |
| GET | `/api/v2/marketplace/orders/{param}/ratings` | marketplace.ts:763 |
| PUT | `/api/v2/marketplace/orders/{param}/ship` | marketplace.ts:737 |
| POST | `/api/v2/marketplace/payments/confirm` | marketplace.ts:818 |
| POST | `/api/v2/marketplace/payments/create-intent` | marketplace.ts:806 |
| GET | `/api/v2/marketplace/promotions/mine` | marketplace.ts:1022 |
| GET | `/api/v2/marketplace/promotions/products` | marketplace.ts:1018 |
| GET | `/api/v2/marketplace/saved-searches` | marketplace.ts:962 |
| POST | `/api/v2/marketplace/saved-searches` | marketplace.ts:972 |
| DELETE | `/api/v2/marketplace/saved-searches/{param}` | marketplace.ts:976 |
| GET | `/api/v2/marketplace/seller/balance` | marketplace.ts:899 |
| GET | `/api/v2/marketplace/seller/coupons` | marketplace.ts:1115 |
| POST | `/api/v2/marketplace/seller/coupons` | marketplace.ts:1132 |
| DELETE | `/api/v2/marketplace/seller/coupons/{param}` | marketplace.ts:1156 |
| PUT | `/api/v2/marketplace/seller/coupons/{param}` | marketplace.ts:1152 |
| GET | `/api/v2/marketplace/seller/coupons/{param}/redemptions` | marketplace.ts:1160 |
| GET | `/api/v2/marketplace/seller/dashboard` | marketplace.ts:929 |
| POST | `/api/v2/marketplace/seller/onboard` | marketplace.ts:910 |
| GET | `/api/v2/marketplace/seller/onboard/status` | marketplace.ts:895 |
| GET | `/api/v2/marketplace/seller/payouts` | marketplace.ts:906 |
| POST | `/api/v2/marketplace/seller/pickup-scan` | marketplace.ts:1111 |
| GET | `/api/v2/marketplace/seller/pickup-slots` | marketplace.ts:1032 |
| POST | `/api/v2/marketplace/seller/pickup-slots` | marketplace.ts:1085 |
| DELETE | `/api/v2/marketplace/seller/pickup-slots/{param}` | marketplace.ts:1103 |
| PUT | `/api/v2/marketplace/seller/pickup-slots/{param}` | marketplace.ts:1099 |
| GET | `/api/v2/marketplace/seller/shipping-options` | marketplace.ts:1036 |
| POST | `/api/v2/marketplace/seller/shipping-options` | marketplace.ts:1055 |
| DELETE | `/api/v2/marketplace/seller/shipping-options/{param}` | marketplace.ts:1074 |
| PUT | `/api/v2/marketplace/seller/shipping-options/{param}` | marketplace.ts:1070 |
| GET | `/api/v2/marketplace/sellers/{param}` | marketplace.ts:914 |
| GET | `/api/v2/marketplace/sellers/{param}/listings` | marketplace.ts:925 |
| GET | `/api/v2/marketplace/sellers/{param}/shipping-options` | marketplace.ts:1042 |
| POST | `/api/v2/matches/{param}/dismiss` | matches.ts:135 |
| GET | `/api/v2/matches/all` | matches.ts:119 |
| GET | `/api/v2/me/collections` | savedCollections.ts:55 |
| POST | `/api/v2/me/collections` | savedCollections.ts:63 |
| GET | `/api/v2/me/collections/{param}/items` | savedCollections.ts:67 |
| POST | `/api/v2/me/data-export` | settings.ts:91 |
| GET | `/api/v2/me/data-export/history` | settings.ts:86 |
| DELETE | `/api/v2/me/saved-items/{param}` | savedCollections.ts:74 |
| POST | `/api/v2/members/{param}/endorse` | endorsements.ts:188 |
| GET | `/api/v2/members/{param}/endorsements` | endorsements.ts:152 |
| POST | `/api/v2/merchant-onboarding/complete` | marketplace.ts:891 |
| GET | `/api/v2/merchant-onboarding/status` | marketplace.ts:863 |
| POST | `/api/v2/merchant-onboarding/step-1` | marketplace.ts:873 |
| POST | `/api/v2/merchant-onboarding/step-2` | marketplace.ts:880 |
| POST | `/api/v2/merchant-onboarding/step-3` | marketplace.ts:887 |
| GET | `/api/v2/messages` | messages.ts:142 |
| POST | `/api/v2/messages` | messages.ts:204, messages.ts:230 |
| DELETE | `/api/v2/messages/{param}` | messages.ts:199 |
| GET | `/api/v2/messages/{param}` | messages.ts:149 |
| PUT | `/api/v2/messages/{param}` | messages.ts:195 |
| POST | `/api/v2/messages/{param}/reactions` | messages.ts:191 |
| PUT | `/api/v2/messages/{param}/read` | messages.ts:183 |
| DELETE | `/api/v2/messages/conversations/{param}` | messages.ts:175 |
| POST | `/api/v2/messages/conversations/{param}/restore` | messages.ts:179 |
| GET | `/api/v2/messages/restriction-status` | messages.ts:187 |
| POST | `/api/v2/messages/voice` | messages.ts:262 |
| DELETE | `/api/v2/notifications/{param}` | notifications.ts:83 |
| POST | `/api/v2/notifications/{param}/read` | notifications.ts:69 |
| GET | `/api/v2/notifications/counts` | notifications.ts:64 |
| POST | `/api/v2/notifications/group/read` | notifications.ts:78 |
| GET | `/api/v2/notifications/grouped` | notifications.ts:59 |
| POST | `/api/v2/notifications/read-all` | notifications.ts:74 |
| GET | `/api/v2/polls` | events.ts:1255 |
| POST | `/api/v2/polls` | polls.ts:20 |
| POST | `/api/v2/polls/{param}/vote` | events.ts:1263 |
| POST | `/api/v2/reactions` | feed.ts:282 |
| GET | `/api/v2/reactions/{param}/{param}/users/{param}` | feed.ts:307 |
| GET | `/api/v2/resources` | resources.ts:90 |
| GET | `/api/v2/resources/categories` | resources.ts:95 |
| POST | `/api/v2/reviews` | reviews.ts:98 |
| DELETE | `/api/v2/reviews/{param}` | reviews.ts:102 |
| GET | `/api/v2/reviews/pending` | reviews.ts:87 |
| GET | `/api/v2/reviews/user/{param}` | members.ts:85, reviews.ts:74 |
| GET | `/api/v2/search` | search.ts:50 |
| GET | `/api/v2/search/saved` | search.ts:63 |
| POST | `/api/v2/search/saved` | search.ts:71 |
| DELETE | `/api/v2/search/saved/{param}` | search.ts:78 |
| POST | `/api/v2/search/saved/{param}/run` | search.ts:82 |
| GET | `/api/v2/skills/categories` | endorsements.ts:228 |
| GET | `/api/v2/skills/categories/{param}` | endorsements.ts:232 |
| GET | `/api/v2/skills/members` | endorsements.ts:236 |
| GET | `/api/v2/skills/search` | endorsements.ts:223 |
| DELETE | `/api/v2/team-tasks/{param}` | groups.ts:710 |
| PUT | `/api/v2/team-tasks/{param}` | groups.ts:706 |
| GET | `/api/v2/tenant/bootstrap` | tenant.ts:43 |
| GET | `/api/v2/tenants` | tenant.ts:48 |
| GET | `/api/v2/users` | client.ts:478, members.ts:70 |
| GET | `/api/v2/users/{param}` | members.ts:75 |
| GET | `/api/v2/users/{param}/appreciations` | appreciations.ts:46 |
| DELETE | `/api/v2/users/{param}/block` | settings.ts:100 |
| GET | `/api/v2/users/{param}/listings` | members.ts:80 |
| GET | `/api/v2/users/{param}/public-collections` | savedCollections.ts:59 |
| GET | `/api/v2/users/blocked` | settings.ts:95 |
| GET | `/api/v2/users/me` | auth.ts:183 |
| PUT | `/api/v2/users/me` | profile.ts:24 |
| GET | `/api/v2/users/me/activity/dashboard` | activity.ts:72 |
| POST | `/api/v2/users/me/avatar` | profile.ts:94 |
| GET | `/api/v2/users/me/parent-accounts` | settings.ts:118 |
| PUT | `/api/v2/users/me/parent-accounts/{param}/permissions` | settings.ts:159 |
| POST | `/api/v2/users/me/password` | profile.ts:37 |
| GET | `/api/v2/users/me/preferences` | settings.ts:104 |
| PUT | `/api/v2/users/me/preferences` | settings.ts:109 |
| GET | `/api/v2/users/me/skills` | endorsements.ts:171 |
| POST | `/api/v2/users/me/skills` | endorsements.ts:198 |
| DELETE | `/api/v2/users/me/skills/{param}` | endorsements.ts:211 |
| GET | `/api/v2/users/me/sub-accounts` | settings.ts:113 |
| POST | `/api/v2/users/me/sub-accounts` | settings.ts:123 |
| DELETE | `/api/v2/users/me/sub-accounts/{param}` | settings.ts:190 |
| GET | `/api/v2/users/me/sub-accounts/{param}/activity` | settings.ts:231 |
| PUT | `/api/v2/users/me/sub-accounts/{param}/approve` | settings.ts:127 |
| PUT | `/api/v2/users/me/sub-accounts/{param}/permissions` | settings.ts:134, settings.ts:150 |
| GET | `/api/v2/volunteering/applications` | volunteering.ts:456 |
| DELETE | `/api/v2/volunteering/applications/{param}` | volunteering.ts:487 |
| PUT | `/api/v2/volunteering/applications/{param}` | volunteering.ts:479 |
| GET | `/api/v2/volunteering/certificates` | volunteering.ts:555 |
| POST | `/api/v2/volunteering/certificates` | volunteering.ts:559 |
| GET | `/api/v2/volunteering/donations` | volunteering.ts:575 |
| POST | `/api/v2/volunteering/donations` | volunteering.ts:593 |
| GET | `/api/v2/volunteering/expenses` | volunteering.ts:563 |
| POST | `/api/v2/volunteering/expenses` | volunteering.ts:567 |
| GET | `/api/v2/volunteering/giving-days` | volunteering.ts:571 |
| POST | `/api/v2/volunteering/hours` | volunteering.ts:610 |
| PUT | `/api/v2/volunteering/hours/{param}/verify` | volunteering.ts:483 |
| GET | `/api/v2/volunteering/hours/summary` | volunteering.ts:491 |
| GET | `/api/v2/volunteering/my-organisations` | volunteering.ts:495 |
| GET | `/api/v2/volunteering/opportunities` | volunteering.ts:439 |
| POST | `/api/v2/volunteering/opportunities` | volunteering.ts:597 |
| GET | `/api/v2/volunteering/opportunities/{param}` | volunteering.ts:449 |
| PUT | `/api/v2/volunteering/opportunities/{param}` | volunteering.ts:601 |
| GET | `/api/v2/volunteering/opportunities/{param}/applications` | volunteering.ts:466 |
| POST | `/api/v2/volunteering/opportunities/{param}/apply` | volunteering.ts:614 |
| GET | `/api/v2/volunteering/organisations` | organisations.ts:52 |
| POST | `/api/v2/volunteering/organisations` | organisations.ts:69 |
| GET | `/api/v2/volunteering/organisations/{param}` | organisations.ts:62, volunteering.ts:499 |
| PUT | `/api/v2/volunteering/organisations/{param}` | volunteering.ts:547 |
| GET | `/api/v2/volunteering/organisations/{param}/applications` | volunteering.ts:510 |
| GET | `/api/v2/volunteering/organisations/{param}/hours/pending` | volunteering.ts:517 |
| GET | `/api/v2/volunteering/organisations/{param}/stats` | volunteering.ts:503 |
| GET | `/api/v2/volunteering/organisations/{param}/volunteers` | volunteering.ts:523 |
| POST | `/api/v2/volunteering/organisations/{param}/wallet/deposit` | volunteering.ts:535 |
| GET | `/api/v2/volunteering/organisations/{param}/wallet/transactions` | volunteering.ts:529 |
| GET | `/api/v2/volunteering/shifts` | volunteering.ts:551 |
| DELETE | `/api/v2/volunteering/shifts/{param}/signup` | volunteering.ts:622 |
| POST | `/api/v2/volunteering/shifts/{param}/signup` | volunteering.ts:618 |
| GET | `/api/v2/volunteering/swaps` | volunteering.ts:579 |
| DELETE | `/api/v2/volunteering/swaps/{param}` | volunteering.ts:589 |
| PUT | `/api/v2/volunteering/swaps/{param}` | volunteering.ts:585 |
| GET | `/api/v2/wallet/balance` | wallet.ts:125 |
| GET | `/api/v2/wallet/community-fund` | wallet.ts:156 |
| POST | `/api/v2/wallet/donate` | wallet.ts:183 |
| GET | `/api/v2/wallet/transactions` | wallet.ts:148 |
| POST | `/api/v2/wallet/transfer` | wallet.ts:175 |
| GET | `/api/v2/wallet/user-search` | wallet.ts:164 |
