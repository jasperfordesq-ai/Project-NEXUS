<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Mobile API Consumer Ledger

Last reviewed: 2026-08-30

> GENERATED FILE — do not edit by hand.
> Regenerate with `npm run api:ledger` from `mobile/`.

Every Laravel endpoint the Expo client calls, and whether the API still exposes it.
The Jest suite mocks the HTTP client, so it cannot detect a renamed or deleted route.
This ledger is the compensating control.

Verified against: `docs/generated/laravel-api-route-inventory.json (2238 distinct API paths)`

> Not verified against `openapi.json`. That file documents only a subset of the
> application routes and has produced false drift findings for working endpoints.

| Measure | Count |
| --- | --- |
| API modules read | 55 |
| Call sites | 551 |
| Distinct method + endpoint pairs | 462 |
| Verified against openapi.json | 462 |
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
| events.ts:1116 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1134 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1146 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1158 | DELETE | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1172 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1194 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1213 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1224 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1238 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1251 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1274 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1280 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1296 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1312 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1323 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1329 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1335 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1341 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1353 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1363 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1378 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1395 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1401 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1410 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1419 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1430 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1441 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1447 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1498 | POST | endpoint literal nests a template inside an interpolation and could not be resolved statically |
| feed.ts:269 | GET | variable "path" is not a literal endpoint in this module |
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
| POST | `/api/auth/forgot-password` | auth.ts:164 |
| POST | `/api/auth/login` | auth.ts:141 |
| POST | `/api/auth/logout` | auth.ts:179 |
| POST | `/api/auth/refresh-token` | auth.ts:189 |
| POST | `/api/auth/reset-password` | auth.ts:169 |
| POST | `/api/auth/verify-email` | auth.ts:174 |
| POST | `/api/v2/appreciations/{param}/react` | appreciations.ts:53 |
| POST | `/api/v2/auth/register` | auth.ts:153 |
| GET | `/api/v2/blog` | blog.ts:45 |
| GET | `/api/v2/blog/{param}` | blog.ts:56 |
| POST | `/api/v2/bookmarks` | feed.ts:380 |
| GET | `/api/v2/categories` | exchanges.ts:187 |
| GET | `/api/v2/clubs` | clubs.ts:31 |
| GET | `/api/v2/comments` | comments.ts:74, exchanges.ts:235 |
| POST | `/api/v2/comments` | comments.ts:86, exchanges.ts:242 |
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
| GET | `/api/v2/courses` | courses.ts:109 |
| GET | `/api/v2/courses/{param}` | courses.ts:121 |
| POST | `/api/v2/courses/{param}/enroll` | courses.ts:133 |
| POST | `/api/v2/courses/{param}/lessons/{param}/complete` | courses.ts:137 |
| GET | `/api/v2/courses/{param}/progress` | courses.ts:129 |
| GET | `/api/v2/donations/{param}/receipt` | donations.ts:23 |
| GET | `/api/v2/events/{param}/analytics` | eventAnalytics.ts:119 |
| GET | `/api/v2/events/{param}/lifecycle-history` | eventLifecycleHistory.ts:61 |
| DELETE | `/api/v2/events/{param}/rsvp` | events.ts:1126 |
| DELETE | `/api/v2/events/{param}/waitlist` | events.ts:1243 |
| GET | `/api/v2/events/{param}/waitlist` | events.ts:1229 |
| GET | `/api/v2/exchanges` | exchangeRequests.ts:114 |
| POST | `/api/v2/exchanges` | client.ts:574, exchanges.ts:212 |
| DELETE | `/api/v2/exchanges/{param}` | exchangeRequests.ts:199 |
| GET | `/api/v2/exchanges/{param}` | exchangeRequests.ts:122 |
| POST | `/api/v2/exchanges/{param}/accept` | exchangeRequests.ts:141 |
| POST | `/api/v2/exchanges/{param}/complete` | exchangeRequests.ts:161 |
| POST | `/api/v2/exchanges/{param}/confirm` | exchangeRequests.ts:177 |
| POST | `/api/v2/exchanges/{param}/decline` | exchangeRequests.ts:149 |
| POST | `/api/v2/exchanges/{param}/dispute` | exchangeRequests.ts:229 |
| POST | `/api/v2/exchanges/{param}/start` | exchangeRequests.ts:156 |
| GET | `/api/v2/exchanges/check` | exchanges.ts:207 |
| GET | `/api/v2/exchanges/config` | exchanges.ts:202 |
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
| GET | `/api/v2/feed` | feed.ts:260 |
| GET | `/api/v2/feed/hashtags/{param}` | feed.ts:291 |
| GET | `/api/v2/feed/hashtags/search` | feed.ts:279 |
| GET | `/api/v2/feed/hashtags/trending` | feed.ts:273 |
| POST | `/api/v2/feed/like` | exchanges.ts:228, feed.ts:366 |
| GET | `/api/v2/feed/polls/{param}` | feed.ts:390 |
| POST | `/api/v2/feed/polls/{param}/vote` | feed.ts:397 |
| POST | `/api/v2/feed/posts` | feed.ts:458 |
| POST | `/api/v2/feed/posts/{param}/hide` | feedModeration.ts:42 |
| POST | `/api/v2/feed/posts/{param}/not-interested` | feedModeration.ts:53 |
| POST | `/api/v2/feed/posts/{param}/report` | feedModeration.ts:69 |
| POST | `/api/v2/feed/users/{param}/mute` | feedModeration.ts:77 |
| GET | `/api/v2/gamification/badges` | gamification.ts:195, gamification.ts:197 |
| GET | `/api/v2/gamification/challenges` | gamification.ts:245 |
| POST | `/api/v2/gamification/challenges/{param}/claim` | gamification.ts:253 |
| GET | `/api/v2/gamification/collections` | gamification.ts:261 |
| GET | `/api/v2/gamification/daily-reward` | gamification.ts:229 |
| POST | `/api/v2/gamification/daily-reward` | gamification.ts:237 |
| GET | `/api/v2/gamification/leaderboard` | gamification.ts:210 |
| GET | `/api/v2/gamification/nexus-score` | gamification.ts:219, gamification.ts:221 |
| GET | `/api/v2/gamification/profile` | gamification.ts:184, gamification.ts:186 |
| GET | `/api/v2/gamification/shop` | gamification.ts:269 |
| POST | `/api/v2/gamification/shop/purchase` | gamification.ts:277 |
| PUT | `/api/v2/gamification/showcase` | gamification.ts:285 |
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
| GET | `/api/v2/group-exchanges` | groupExchanges.ts:109 |
| POST | `/api/v2/group-exchanges` | groupExchanges.ts:117 |
| DELETE | `/api/v2/group-exchanges/{param}` | groupExchanges.ts:129 |
| GET | `/api/v2/group-exchanges/{param}` | groupExchanges.ts:113 |
| POST | `/api/v2/group-exchanges/{param}/complete` | groupExchanges.ts:125 |
| POST | `/api/v2/group-exchanges/{param}/confirm` | groupExchanges.ts:121 |
| GET | `/api/v2/group-templates` | groups.ts:406 |
| GET | `/api/v2/groups` | groups.ts:384 |
| POST | `/api/v2/groups` | groups.ts:398 |
| GET | `/api/v2/groups/{param}` | groups.ts:391 |
| PUT | `/api/v2/groups/{param}` | groups.ts:402 |
| GET | `/api/v2/groups/{param}/analytics` | groups.ts:583 |
| GET | `/api/v2/groups/{param}/analytics/comparative` | groups.ts:595 |
| GET | `/api/v2/groups/{param}/analytics/retention` | groups.ts:589 |
| GET | `/api/v2/groups/{param}/announcements` | groups.ts:533 |
| POST | `/api/v2/groups/{param}/announcements` | groups.ts:737 |
| DELETE | `/api/v2/groups/{param}/announcements/{param}` | groups.ts:755 |
| PUT | `/api/v2/groups/{param}/announcements/{param}` | groups.ts:748 |
| POST | `/api/v2/groups/{param}/answers/{param}/accept` | groups.ts:641 |
| GET | `/api/v2/groups/{param}/discussions` | groups.ts:521 |
| POST | `/api/v2/groups/{param}/discussions` | groups.ts:727 |
| GET | `/api/v2/groups/{param}/files` | groups.ts:545 |
| DELETE | `/api/v2/groups/{param}/files/{param}` | groups.ts:549 |
| POST | `/api/v2/groups/{param}/image` | groups.ts:491 |
| POST | `/api/v2/groups/{param}/join` | groups.ts:762 |
| GET | `/api/v2/groups/{param}/media` | groups.ts:562 |
| POST | `/api/v2/groups/{param}/media` | groups.ts:572 |
| DELETE | `/api/v2/groups/{param}/media/{param}` | groups.ts:566 |
| GET | `/api/v2/groups/{param}/members` | groups.ts:509 |
| DELETE | `/api/v2/groups/{param}/membership` | groups.ts:769 |
| POST | `/api/v2/groups/{param}/qa/vote` | groups.ts:637 |
| GET | `/api/v2/groups/{param}/questions` | groups.ts:608 |
| POST | `/api/v2/groups/{param}/questions` | groups.ts:619 |
| GET | `/api/v2/groups/{param}/questions/{param}` | groups.ts:612 |
| POST | `/api/v2/groups/{param}/questions/{param}/answers` | groups.ts:627 |
| GET | `/api/v2/groups/{param}/task-stats` | groups.ts:692 |
| GET | `/api/v2/groups/{param}/tasks` | groups.ts:688 |
| POST | `/api/v2/groups/{param}/tasks` | groups.ts:706 |
| GET | `/api/v2/groups/{param}/wiki` | groups.ts:648 |
| POST | `/api/v2/groups/{param}/wiki` | groups.ts:659 |
| DELETE | `/api/v2/groups/{param}/wiki/{param}` | groups.ts:671 |
| GET | `/api/v2/groups/{param}/wiki/{param}` | groups.ts:652 |
| PUT | `/api/v2/groups/{param}/wiki/{param}` | groups.ts:667 |
| GET | `/api/v2/groups/{param}/wiki/{param}/revisions` | groups.ts:675 |
| GET | `/api/v2/groups/invite/{param}` | groups.ts:785 |
| POST | `/api/v2/groups/invite/{param}/accept` | groups.ts:790 |
| GET | `/api/v2/ideation-campaigns` | ideation.ts:238 |
| GET | `/api/v2/ideation-campaigns/{param}` | ideation.ts:242 |
| GET | `/api/v2/ideation-categories` | ideation.ts:169 |
| GET | `/api/v2/ideation-challenges` | ideation.ts:164 |
| POST | `/api/v2/ideation-challenges` | ideation.ts:182 |
| GET | `/api/v2/ideation-challenges/{param}` | ideation.ts:174 |
| PUT | `/api/v2/ideation-challenges/{param}` | ideation.ts:190 |
| GET | `/api/v2/ideation-challenges/{param}/ideas` | ideation.ts:194 |
| POST | `/api/v2/ideation-challenges/{param}/ideas` | ideation.ts:202 |
| GET | `/api/v2/ideation-ideas/{param}` | ideation.ts:218 |
| PUT | `/api/v2/ideation-ideas/{param}` | ideation.ts:222 |
| GET | `/api/v2/ideation-ideas/{param}/comments` | ideation.ts:228 |
| POST | `/api/v2/ideation-ideas/{param}/comments` | ideation.ts:232 |
| POST | `/api/v2/ideation-ideas/{param}/vote` | ideation.ts:210 |
| GET | `/api/v2/ideation-outcomes/dashboard` | ideation.ts:246 |
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
| GET | `/api/v2/listings` | exchanges.ts:175 |
| POST | `/api/v2/listings` | exchanges.ts:192 |
| DELETE | `/api/v2/listings/{param}` | exchanges.ts:328 |
| GET | `/api/v2/listings/{param}` | exchanges.ts:183 |
| PUT | `/api/v2/listings/{param}` | exchanges.ts:262 |
| DELETE | `/api/v2/listings/{param}/image` | exchanges.ts:323 |
| POST | `/api/v2/listings/{param}/image` | exchanges.ts:312 |
| POST | `/api/v2/listings/{param}/renew` | exchanges.ts:224 |
| POST | `/api/v2/listings/{param}/report` | exchanges.ts:250 |
| DELETE | `/api/v2/listings/{param}/save` | exchanges.ts:220 |
| POST | `/api/v2/listings/{param}/save` | exchanges.ts:216 |
| PUT | `/api/v2/listings/{param}/tags` | exchanges.ts:197 |
| POST | `/api/v2/listings/generate-description` | exchanges.ts:254 |
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
| POST | `/api/v2/matches/{param}/dismiss` | matches.ts:237 |
| GET | `/api/v2/matches/all` | matches.ts:219 |
| GET | `/api/v2/me/collections` | savedCollections.ts:55 |
| POST | `/api/v2/me/collections` | savedCollections.ts:63 |
| GET | `/api/v2/me/collections/{param}/items` | savedCollections.ts:67 |
| GET | `/api/v2/me/courses` | courses.ts:125 |
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
| GET | `/api/v2/onboarding/categories` | onboarding.ts:101 |
| POST | `/api/v2/onboarding/complete` | onboarding.ts:116 |
| GET | `/api/v2/onboarding/config` | onboarding.ts:97 |
| POST | `/api/v2/onboarding/safeguarding` | onboarding.ts:109 |
| GET | `/api/v2/onboarding/safeguarding-options` | onboarding.ts:105 |
| GET | `/api/v2/onboarding/status` | onboarding.ts:93 |
| GET | `/api/v2/partner-venues` | venues.ts:55 |
| GET | `/api/v2/partner-venues/my-visits` | venues.ts:68 |
| GET | `/api/v2/partner-venues/pass` | venues.ts:60 |
| POST | `/api/v2/partner-venues/pass/rotate` | venues.ts:64 |
| POST | `/api/v2/partner-venues/visits/verify/{param}` | venues.ts:73 |
| GET | `/api/v2/podcasts` | podcasts.ts:73 |
| GET | `/api/v2/podcasts/{param}` | podcasts.ts:80 |
| GET | `/api/v2/podcasts/{param}/{param}` | podcasts.ts:84 |
| POST | `/api/v2/podcasts/{param}/subscribe` | podcasts.ts:92 |
| POST | `/api/v2/podcasts/episodes/{param}/listen` | podcasts.ts:88 |
| POST | `/api/v2/podcasts/episodes/{param}/reaction` | podcasts.ts:96 |
| POST | `/api/v2/podcasts/episodes/{param}/report` | podcasts.ts:100 |
| GET | `/api/v2/polls` | events.ts:1261 |
| POST | `/api/v2/polls` | polls.ts:20 |
| POST | `/api/v2/polls/{param}/vote` | events.ts:1269 |
| POST | `/api/v2/reactions` | feed.ts:321 |
| GET | `/api/v2/reactions/{param}/{param}/users/{param}` | feed.ts:346 |
| GET | `/api/v2/resources` | resources.ts:90 |
| GET | `/api/v2/resources/categories` | resources.ts:95 |
| POST | `/api/v2/reviews` | reviews.ts:98 |
| DELETE | `/api/v2/reviews/{param}` | reviews.ts:102 |
| GET | `/api/v2/reviews/pending` | reviews.ts:87 |
| GET | `/api/v2/reviews/user/{param}` | members.ts:91, reviews.ts:74 |
| GET | `/api/v2/search` | search.ts:50 |
| GET | `/api/v2/search/saved` | search.ts:63 |
| POST | `/api/v2/search/saved` | search.ts:71 |
| DELETE | `/api/v2/search/saved/{param}` | search.ts:78 |
| POST | `/api/v2/search/saved/{param}/run` | search.ts:82 |
| GET | `/api/v2/skills/categories` | endorsements.ts:228 |
| GET | `/api/v2/skills/categories/{param}` | endorsements.ts:232 |
| GET | `/api/v2/skills/members` | endorsements.ts:236 |
| GET | `/api/v2/skills/search` | endorsements.ts:223 |
| DELETE | `/api/v2/team-tasks/{param}` | groups.ts:717 |
| PUT | `/api/v2/team-tasks/{param}` | groups.ts:713 |
| GET | `/api/v2/tenant/bootstrap` | tenant.ts:51 |
| GET | `/api/v2/tenants` | tenant.ts:63 |
| GET | `/api/v2/users` | client.ts:573, members.ts:76 |
| GET | `/api/v2/users/{param}` | members.ts:81 |
| GET | `/api/v2/users/{param}/appreciations` | appreciations.ts:46 |
| DELETE | `/api/v2/users/{param}/block` | settings.ts:130 |
| POST | `/api/v2/users/{param}/block` | settings.ts:126 |
| GET | `/api/v2/users/{param}/listings` | members.ts:86 |
| GET | `/api/v2/users/{param}/public-collections` | savedCollections.ts:59 |
| GET | `/api/v2/users/blocked` | settings.ts:114 |
| DELETE | `/api/v2/users/me` | settings.ts:110 |
| GET | `/api/v2/users/me` | auth.ts:184 |
| PUT | `/api/v2/users/me` | profile.ts:24 |
| GET | `/api/v2/users/me/activity/dashboard` | activity.ts:72 |
| POST | `/api/v2/users/me/avatar` | profile.ts:94 |
| GET | `/api/v2/users/me/match-preferences` | matches.ts:241 |
| PUT | `/api/v2/users/me/match-preferences` | matches.ts:248 |
| GET | `/api/v2/users/me/parent-accounts` | settings.ts:148 |
| PUT | `/api/v2/users/me/parent-accounts/{param}/permissions` | settings.ts:189 |
| POST | `/api/v2/users/me/password` | profile.ts:37 |
| GET | `/api/v2/users/me/preferences` | settings.ts:134 |
| PUT | `/api/v2/users/me/preferences` | settings.ts:139 |
| GET | `/api/v2/users/me/skills` | endorsements.ts:171 |
| POST | `/api/v2/users/me/skills` | endorsements.ts:198 |
| DELETE | `/api/v2/users/me/skills/{param}` | endorsements.ts:211 |
| GET | `/api/v2/users/me/sub-accounts` | settings.ts:143 |
| POST | `/api/v2/users/me/sub-accounts` | settings.ts:153 |
| DELETE | `/api/v2/users/me/sub-accounts/{param}` | settings.ts:220 |
| GET | `/api/v2/users/me/sub-accounts/{param}/activity` | settings.ts:261 |
| PUT | `/api/v2/users/me/sub-accounts/{param}/approve` | settings.ts:157 |
| PUT | `/api/v2/users/me/sub-accounts/{param}/permissions` | settings.ts:164, settings.ts:180 |
| GET | `/api/v2/volunteering/applications` | volunteering.ts:470 |
| DELETE | `/api/v2/volunteering/applications/{param}` | volunteering.ts:501 |
| PUT | `/api/v2/volunteering/applications/{param}` | volunteering.ts:493 |
| GET | `/api/v2/volunteering/certificates` | volunteering.ts:569 |
| POST | `/api/v2/volunteering/certificates` | volunteering.ts:573 |
| POST | `/api/v2/volunteering/checkin/checkout/{param}` | volunteering.ts:673 |
| POST | `/api/v2/volunteering/checkin/verify/{param}` | volunteering.ts:668 |
| GET | `/api/v2/volunteering/donations` | volunteering.ts:589 |
| POST | `/api/v2/volunteering/donations` | volunteering.ts:629 |
| GET | `/api/v2/volunteering/expenses` | volunteering.ts:577 |
| POST | `/api/v2/volunteering/expenses` | volunteering.ts:581 |
| GET | `/api/v2/volunteering/giving-days` | volunteering.ts:585 |
| POST | `/api/v2/volunteering/hours` | volunteering.ts:646 |
| PUT | `/api/v2/volunteering/hours/{param}/verify` | volunteering.ts:497 |
| GET | `/api/v2/volunteering/hours/summary` | volunteering.ts:505 |
| GET | `/api/v2/volunteering/my-organisations` | volunteering.ts:509 |
| GET | `/api/v2/volunteering/opportunities` | volunteering.ts:453 |
| POST | `/api/v2/volunteering/opportunities` | volunteering.ts:633 |
| GET | `/api/v2/volunteering/opportunities/{param}` | volunteering.ts:463 |
| PUT | `/api/v2/volunteering/opportunities/{param}` | volunteering.ts:637 |
| GET | `/api/v2/volunteering/opportunities/{param}/applications` | volunteering.ts:480 |
| POST | `/api/v2/volunteering/opportunities/{param}/apply` | volunteering.ts:650 |
| GET | `/api/v2/volunteering/opportunities/{param}/shifts` | volunteering.ts:600 |
| GET | `/api/v2/volunteering/organisations` | organisations.ts:58 |
| POST | `/api/v2/volunteering/organisations` | organisations.ts:75 |
| GET | `/api/v2/volunteering/organisations/{param}` | organisations.ts:68, volunteering.ts:513 |
| PUT | `/api/v2/volunteering/organisations/{param}` | volunteering.ts:561 |
| GET | `/api/v2/volunteering/organisations/{param}/applications` | volunteering.ts:524 |
| GET | `/api/v2/volunteering/organisations/{param}/hours/pending` | volunteering.ts:531 |
| GET | `/api/v2/volunteering/organisations/{param}/stats` | volunteering.ts:517 |
| GET | `/api/v2/volunteering/organisations/{param}/volunteers` | volunteering.ts:537 |
| POST | `/api/v2/volunteering/organisations/{param}/wallet/deposit` | volunteering.ts:549 |
| GET | `/api/v2/volunteering/organisations/{param}/wallet/transactions` | volunteering.ts:543 |
| GET | `/api/v2/volunteering/shifts` | volunteering.ts:565 |
| DELETE | `/api/v2/volunteering/shifts/{param}/signup` | volunteering.ts:658 |
| POST | `/api/v2/volunteering/shifts/{param}/signup` | volunteering.ts:654 |
| GET | `/api/v2/volunteering/swaps` | volunteering.ts:593 |
| POST | `/api/v2/volunteering/swaps` | volunteering.ts:617 |
| DELETE | `/api/v2/volunteering/swaps/{param}` | volunteering.ts:625 |
| PUT | `/api/v2/volunteering/swaps/{param}` | volunteering.ts:621 |
| GET | `/api/v2/wallet/balance` | wallet.ts:170 |
| GET | `/api/v2/wallet/community-fund` | wallet.ts:206 |
| POST | `/api/v2/wallet/donate` | wallet.ts:233 |
| GET | `/api/v2/wallet/transactions` | wallet.ts:198 |
| GET | `/api/v2/wallet/transactions/{param}` | wallet.ts:183 |
| POST | `/api/v2/wallet/transfer` | wallet.ts:225 |
| GET | `/api/v2/wallet/user-search` | wallet.ts:214 |
