<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Mobile API Consumer Ledger

Last reviewed: 2026-11-13

> GENERATED FILE — do not edit by hand.
> Regenerate with `npm run api:ledger` from `mobile/`.

Every Laravel endpoint the Expo client calls, and whether the API still exposes it.
The Jest suite mocks the HTTP client, so it cannot detect a renamed or deleted route.
This ledger is the compensating control.

Verified against: `docs/generated/laravel-api-route-inventory.json (2339 distinct API paths)`

> Not verified against `openapi.json`. That file documents only a subset of the
> application routes and has produced false drift findings for working endpoints.

| Measure | Count |
| --- | --- |
| API modules read | 71 |
| Call sites | 784 |
| Distinct method + endpoint pairs | 627 |
| Verified against openapi.json | 627 |
| **Missing from Laravel routes** | **0** |
| **Method mismatch** | **0** |
| Dynamic, not verifiable | 103 |
| Inline `fetch()` bypassing the client | 0 |

## Not verifiable (endpoint assembled at runtime)

These are not failures. They are the honest edge of what static reading can prove,
and the places a contract test earns the most.

| Location | Method | Reason |
| --- | --- | --- |
| eventCommunications.ts:158 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventCommunications.ts:170 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventCommunications.ts:180 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventCommunications.ts:190 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventCommunications.ts:204 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventCommunications.ts:218 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventCommunications.ts:232 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventCommunications.ts:245 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:240 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:247 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:255 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:269 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:281 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:293 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:307 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:320 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:331 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:371 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:380 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:399 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:419 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:429 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:440 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:212 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:220 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:230 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:289 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:306 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:307 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:338 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:364 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:384 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:402 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:450 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:464 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:480 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:493 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:505 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:523 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:544 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:566 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:593 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:622 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:646 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:660 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:684 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventRegistration.ts:711 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafety.ts:138 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafety.ts:148 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafety.ts:160 | DELETE | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafetyManagement.ts:68 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafetyManagement.ts:74 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafetyManagement.ts:80 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:165 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:173 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:182 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:192 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:237 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:251 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventTickets.ts:138 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventTickets.ts:149 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventTickets.ts:161 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:964 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1140 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1158 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1170 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1182 | DELETE | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1196 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1218 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1241 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1252 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1266 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1279 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1302 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1308 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1324 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1340 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1351 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1357 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1363 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1369 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1381 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1391 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1406 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1423 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1429 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1438 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1447 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1458 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1469 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1475 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1526 | POST | endpoint literal nests a template inside an interpolation and could not be resolved statically |
| feed.ts:298 | GET | variable "path" is not a literal endpoint in this module |
| ideation.ts:211 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| ideation.ts:212 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| ideation.ts:229 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| ideation.ts:230 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| ideation.ts:255 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| ideation.ts:256 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| marketplace.ts:619 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| marketplace.ts:620 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| marketplace.ts:905 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| marketplace.ts:906 | GET | variable "endpoint" is assigned more than one endpoint in this module |

## Verified endpoints

| Method | Endpoint | Call sites |
| --- | --- | --- |
| POST | `/api/ai/chat` | chat.ts:86 |
| POST | `/api/ai/chat/feedback` | chat.ts:131 |
| GET | `/api/ai/chat/starters` | chat.ts:121 |
| GET | `/api/ai/conversations/{param}` | chat.ts:117 |
| POST | `/api/auth/forgot-password` | auth.ts:275 |
| POST | `/api/auth/login` | auth.ts:249 |
| POST | `/api/auth/logout` | auth.ts:382 |
| POST | `/api/auth/refresh-token` | auth.ts:396 |
| POST | `/api/auth/resend-verification-by-email` | auth.ts:334 |
| POST | `/api/auth/reset-password` | auth.ts:280 |
| POST | `/api/auth/verify-email` | auth.ts:306 |
| POST | `/api/totp/verify` | auth.ts:154 |
| POST | `/api/v2/appreciations` | appreciations.ts:70 |
| POST | `/api/v2/appreciations/{param}/react` | appreciations.ts:80 |
| POST | `/api/v2/auth/2fa/setup` | auth.ts:141, twoFactor.ts:77 |
| GET | `/api/v2/auth/2fa/status` | twoFactor.ts:60 |
| POST | `/api/v2/auth/2fa/verify` | auth.ts:148, twoFactor.ts:87 |
| POST | `/api/v2/auth/register` | auth.ts:264 |
| GET | `/api/v2/auth/registration-info` | auth.ts:358 |
| GET | `/api/v2/blog` | blog.ts:43 |
| GET | `/api/v2/blog/{param}` | blog.ts:54 |
| GET | `/api/v2/blog/categories` | blog.ts:63 |
| POST | `/api/v2/bookmarks` | feed.ts:409 |
| GET | `/api/v2/categories` | exchanges.ts:233 |
| GET | `/api/v2/clubs` | clubs.ts:31 |
| GET | `/api/v2/comments` | comments.ts:75, exchanges.ts:285 |
| POST | `/api/v2/comments` | comments.ts:87, exchanges.ts:292 |
| DELETE | `/api/v2/comments/{param}` | comments.ts:107 |
| PUT | `/api/v2/comments/{param}` | comments.ts:99 |
| POST | `/api/v2/comments/{param}/reactions` | comments.ts:114 |
| GET | `/api/v2/community/this-month` | community.ts:26 |
| GET | `/api/v2/connections` | connections.ts:54 |
| DELETE | `/api/v2/connections/{param}` | connections.ts:79 |
| POST | `/api/v2/connections/{param}/accept` | connections.ts:69 |
| POST | `/api/v2/connections/{param}/decline` | connections.ts:74 |
| POST | `/api/v2/connections/request` | connections.ts:64 |
| GET | `/api/v2/connections/status/{param}` | connections.ts:59 |
| POST | `/api/v2/contact` | staticPages.ts:134 |
| GET | `/api/v2/coupons` | marketplace.ts:1234 |
| GET | `/api/v2/coupons/{param}` | marketplace.ts:1238 |
| POST | `/api/v2/coupons/{param}/qr` | marketplace.ts:1242 |
| POST | `/api/v2/coupons/redeem-qr` | marketplace.ts:1246 |
| POST | `/api/v2/coupons/validate` | marketplace.ts:925 |
| GET | `/api/v2/courses` | courses.ts:247 |
| POST | `/api/v2/courses` | courses.ts:349, courses.ts:350 |
| GET | `/api/v2/courses/{param}` | courses.ts:259 |
| PUT | `/api/v2/courses/{param}` | courses.ts:358 |
| GET | `/api/v2/courses/{param}/analytics` | courses.ts:535 |
| GET | `/api/v2/courses/{param}/certificate` | courses.ts:544 |
| GET | `/api/v2/courses/{param}/cohorts` | courses.ts:463 |
| POST | `/api/v2/courses/{param}/cohorts` | courses.ts:467, courses.ts:468 |
| POST | `/api/v2/courses/{param}/enroll` | courses.ts:271 |
| GET | `/api/v2/courses/{param}/grading` | courses.ts:519 |
| POST | `/api/v2/courses/{param}/lessons` | courses.ts:410, courses.ts:411 |
| DELETE | `/api/v2/courses/{param}/lessons/{param}` | courses.ts:430 |
| PUT | `/api/v2/courses/{param}/lessons/{param}` | courses.ts:423 |
| POST | `/api/v2/courses/{param}/lessons/{param}/complete` | courses.ts:286 |
| GET | `/api/v2/courses/{param}/progress` | courses.ts:267 |
| POST | `/api/v2/courses/{param}/publish` | courses.ts:362 |
| POST | `/api/v2/courses/{param}/quizzes` | courses.ts:436, courses.ts:437 |
| POST | `/api/v2/courses/{param}/quizzes/{param}/questions` | courses.ts:451, courses.ts:455 |
| POST | `/api/v2/courses/{param}/sections` | courses.ts:370, courses.ts:371 |
| DELETE | `/api/v2/courses/{param}/sections/{param}` | courses.ts:404 |
| PUT | `/api/v2/courses/{param}/sections/{param}` | courses.ts:383 |
| PUT | `/api/v2/courses/{param}/sections/{param}/lessons/reorder` | courses.ts:398 |
| PUT | `/api/v2/courses/{param}/sections/reorder` | courses.ts:392 |
| POST | `/api/v2/courses/{param}/unpublish` | courses.ts:366 |
| POST | `/api/v2/courses/attempts/{param}/grade` | courses.ts:527 |
| GET | `/api/v2/courses/categories` | courses.ts:340 |
| GET | `/api/v2/courses/mine` | courses.ts:345 |
| GET | `/api/v2/courses/quizzes/{param}` | courses.ts:311 |
| POST | `/api/v2/courses/quizzes/{param}/attempt` | courses.ts:328 |
| GET | `/api/v2/donations/{param}/receipt` | donations.ts:50 |
| PUT | `/api/v2/events/{param}/agenda/order` | eventAgendaManagement.ts:79 |
| POST | `/api/v2/events/{param}/agenda/sessions` | eventAgendaManagement.ts:52 |
| PUT | `/api/v2/events/{param}/agenda/sessions/{param}` | eventAgendaManagement.ts:59 |
| POST | `/api/v2/events/{param}/agenda/sessions/{param}/cancel` | eventAgendaManagement.ts:69 |
| GET | `/api/v2/events/{param}/analytics` | eventAnalytics.ts:120 |
| GET | `/api/v2/events/{param}/federation-status` | eventFederation.ts:44 |
| GET | `/api/v2/events/{param}/lifecycle-history` | eventLifecycleHistory.ts:62 |
| GET | `/api/v2/events/{param}/people` | eventPeople.ts:116 |
| GET | `/api/v2/events/{param}/people/{param}/history` | eventPeople.ts:66 |
| POST | `/api/v2/events/{param}/people/bulk` | eventPeople.ts:173 |
| DELETE | `/api/v2/events/{param}/rsvp` | events.ts:1150 |
| GET | `/api/v2/events/{param}/safety/reviews` | eventSafetyManagement.ts:84 |
| POST | `/api/v2/events/{param}/safety/reviews` | eventSafetyManagement.ts:90 |
| DELETE | `/api/v2/events/{param}/safety/reviews/{param}` | eventSafetyManagement.ts:95 |
| GET | `/api/v2/events/{param}/staff` | eventStaff.ts:57 |
| POST | `/api/v2/events/{param}/staff` | eventStaff.ts:85 |
| DELETE | `/api/v2/events/{param}/staff/{param}` | eventStaff.ts:92 |
| DELETE | `/api/v2/events/{param}/waitlist` | events.ts:1271 |
| GET | `/api/v2/events/{param}/waitlist` | events.ts:1257 |
| GET | `/api/v2/exchanges` | exchangeRequests.ts:114 |
| POST | `/api/v2/exchanges` | client.ts:809, exchanges.ts:262 |
| DELETE | `/api/v2/exchanges/{param}` | exchangeRequests.ts:209 |
| GET | `/api/v2/exchanges/{param}` | exchangeRequests.ts:122 |
| POST | `/api/v2/exchanges/{param}/accept` | exchangeRequests.ts:141 |
| POST | `/api/v2/exchanges/{param}/complete` | exchangeRequests.ts:161 |
| POST | `/api/v2/exchanges/{param}/confirm` | exchangeRequests.ts:177 |
| POST | `/api/v2/exchanges/{param}/decline` | exchangeRequests.ts:149 |
| POST | `/api/v2/exchanges/{param}/dispute` | exchangeRequests.ts:239 |
| POST | `/api/v2/exchanges/{param}/start` | exchangeRequests.ts:156 |
| GET | `/api/v2/exchanges/check` | exchanges.ts:257 |
| GET | `/api/v2/exchanges/config` | exchanges.ts:252 |
| GET | `/api/v2/exchanges/needs-attention-count` | exchangeRequests.ts:134 |
| GET | `/api/v2/explore` | explore.ts:184 |
| GET | `/api/v2/federation/activity` | federation.ts:277 |
| GET | `/api/v2/federation/connections` | federation.ts:395 |
| POST | `/api/v2/federation/connections` | federation.ts:415 |
| DELETE | `/api/v2/federation/connections/{param}` | federation.ts:407 |
| POST | `/api/v2/federation/connections/{param}/accept` | federation.ts:399 |
| POST | `/api/v2/federation/connections/{param}/reject` | federation.ts:403 |
| GET | `/api/v2/federation/connections/status/{param}/{param}` | federation.ts:411 |
| GET | `/api/v2/federation/events` | federation.ts:316 |
| GET | `/api/v2/federation/groups` | federation.ts:312 |
| GET | `/api/v2/federation/listings` | federation.ts:308 |
| GET | `/api/v2/federation/members` | federation.ts:288 |
| GET | `/api/v2/federation/members/{param}` | federation.ts:296 |
| GET | `/api/v2/federation/members/{param}/reviews` | federation.ts:304 |
| GET | `/api/v2/federation/messages` | federation.ts:320 |
| POST | `/api/v2/federation/messages` | federation.ts:330 |
| POST | `/api/v2/federation/messages/{param}/mark-read` | federation.ts:350 |
| POST | `/api/v2/federation/messages/{param}/translate` | federation.ts:358 |
| POST | `/api/v2/federation/messages/mark-read-batch` | federation.ts:354 |
| POST | `/api/v2/federation/opt-in` | federation.ts:342 |
| POST | `/api/v2/federation/opt-out` | federation.ts:346 |
| GET | `/api/v2/federation/partners` | federation.ts:251 |
| GET | `/api/v2/federation/partners/{param}` | federation.ts:284 |
| GET | `/api/v2/federation/settings` | federation.ts:364 |
| PUT | `/api/v2/federation/settings` | federation.ts:368 |
| POST | `/api/v2/federation/setup` | federation.ts:372 |
| GET | `/api/v2/federation/status` | federation.ts:258, federation.ts:273 |
| POST | `/api/v2/federation/transactions` | federation.ts:338 |
| GET | `/api/v2/feed` | feed.ts:289 |
| GET | `/api/v2/feed/hashtags/{param}` | feed.ts:320 |
| GET | `/api/v2/feed/hashtags/search` | feed.ts:308 |
| GET | `/api/v2/feed/hashtags/trending` | feed.ts:302 |
| POST | `/api/v2/feed/like` | exchanges.ts:278, feed.ts:395 |
| GET | `/api/v2/feed/polls/{param}` | feed.ts:419 |
| POST | `/api/v2/feed/polls/{param}/vote` | feed.ts:426 |
| POST | `/api/v2/feed/posts` | feed.ts:488, feed.ts:489 |
| POST | `/api/v2/feed/posts/{param}/hide` | feedModeration.ts:42 |
| POST | `/api/v2/feed/posts/{param}/not-interested` | feedModeration.ts:53 |
| POST | `/api/v2/feed/posts/{param}/report` | feedModeration.ts:69 |
| POST | `/api/v2/feed/users/{param}/mute` | feedModeration.ts:77 |
| GET | `/api/v2/gamification/badges` | gamification.ts:195, gamification.ts:197 |
| GET | `/api/v2/gamification/challenges` | gamification.ts:262 |
| POST | `/api/v2/gamification/challenges/{param}/claim` | gamification.ts:270 |
| GET | `/api/v2/gamification/collections` | gamification.ts:278 |
| GET | `/api/v2/gamification/daily-reward` | gamification.ts:246 |
| POST | `/api/v2/gamification/daily-reward` | gamification.ts:254 |
| GET | `/api/v2/gamification/leaderboard` | gamification.ts:224 |
| GET | `/api/v2/gamification/nexus-score` | gamification.ts:236, gamification.ts:238 |
| GET | `/api/v2/gamification/profile` | gamification.ts:184, gamification.ts:186 |
| GET | `/api/v2/gamification/shop` | gamification.ts:286 |
| POST | `/api/v2/gamification/shop/purchase` | gamification.ts:294 |
| PUT | `/api/v2/gamification/showcase` | gamification.ts:305 |
| GET | `/api/v2/goals` | goals.ts:131 |
| POST | `/api/v2/goals` | goals.ts:150, goals.ts:151 |
| GET | `/api/v2/goals/{param}` | goals.ts:135 |
| PUT | `/api/v2/goals/{param}` | goals.ts:181 |
| POST | `/api/v2/goals/{param}/complete` | goals.ts:185 |
| GET | `/api/v2/goals/{param}/history` | goals.ts:202 |
| GET | `/api/v2/goals/{param}/insights` | goals.ts:206 |
| POST | `/api/v2/goals/{param}/progress` | goals.ts:194 |
| DELETE | `/api/v2/goals/{param}/reminder` | goals.ts:218 |
| GET | `/api/v2/goals/{param}/reminder` | goals.ts:210 |
| PUT | `/api/v2/goals/{param}/reminder` | goals.ts:214 |
| POST | `/api/v2/goals/from-template/{param}` | goals.ts:167, goals.ts:168 |
| GET | `/api/v2/goals/templates` | goals.ts:159 |
| GET | `/api/v2/goals/templates/categories` | goals.ts:163 |
| DELETE | `/api/v2/group-chatroom-messages/{param}` | groups.ts:828 |
| DELETE | `/api/v2/group-chatrooms/{param}` | groups.ts:803 |
| GET | `/api/v2/group-chatrooms/{param}/messages` | groups.ts:812 |
| POST | `/api/v2/group-chatrooms/{param}/messages` | groups.ts:820 |
| GET | `/api/v2/group-exchanges` | groupExchanges.ts:151 |
| POST | `/api/v2/group-exchanges` | groupExchanges.ts:160, groupExchanges.ts:165 |
| DELETE | `/api/v2/group-exchanges/{param}` | groupExchanges.ts:177 |
| GET | `/api/v2/group-exchanges/{param}` | groupExchanges.ts:155 |
| POST | `/api/v2/group-exchanges/{param}/complete` | groupExchanges.ts:173 |
| POST | `/api/v2/group-exchanges/{param}/confirm` | groupExchanges.ts:169 |
| POST | `/api/v2/group-exchanges/preview` | groupExchanges.ts:182 |
| GET | `/api/v2/group-templates` | groups.ts:646 |
| GET | `/api/v2/groups` | groups.ts:541, volunteeringVolunteer.ts:539 |
| POST | `/api/v2/groups` | groups.ts:633, groups.ts:638 |
| GET | `/api/v2/groups/{param}` | groups.ts:548 |
| PUT | `/api/v2/groups/{param}` | groups.ts:642 |
| GET | `/api/v2/groups/{param}/analytics` | groups.ts:1106 |
| GET | `/api/v2/groups/{param}/analytics/comparative` | groups.ts:1118 |
| GET | `/api/v2/groups/{param}/analytics/retention` | groups.ts:1112 |
| GET | `/api/v2/groups/{param}/announcements` | groups.ts:1029 |
| POST | `/api/v2/groups/{param}/announcements` | groups.ts:1324, groups.ts:1329 |
| DELETE | `/api/v2/groups/{param}/announcements/{param}` | groups.ts:1347 |
| PUT | `/api/v2/groups/{param}/announcements/{param}` | groups.ts:1340 |
| POST | `/api/v2/groups/{param}/answers/{param}/accept` | groups.ts:1176 |
| GET | `/api/v2/groups/{param}/challenges` | groups.ts:847 |
| POST | `/api/v2/groups/{param}/challenges` | groups.ts:862 |
| DELETE | `/api/v2/groups/{param}/challenges/{param}` | groups.ts:873 |
| GET | `/api/v2/groups/{param}/chatrooms` | groups.ts:787 |
| POST | `/api/v2/groups/{param}/chatrooms` | groups.ts:795 |
| DELETE | `/api/v2/groups/{param}/chatrooms/{param}/pin/{param}` | groups.ts:843 |
| POST | `/api/v2/groups/{param}/chatrooms/{param}/pin/{param}` | groups.ts:839 |
| GET | `/api/v2/groups/{param}/chatrooms/{param}/pinned` | groups.ts:835 |
| GET | `/api/v2/groups/{param}/discussions` | groups.ts:997 |
| POST | `/api/v2/groups/{param}/discussions` | groups.ts:1282, groups.ts:1287 |
| GET | `/api/v2/groups/{param}/discussions/{param}` | groups.ts:1014 |
| POST | `/api/v2/groups/{param}/discussions/{param}/messages` | groups.ts:1304, groups.ts:1309 |
| GET | `/api/v2/groups/{param}/files` | groups.ts:1041 |
| POST | `/api/v2/groups/{param}/files` | groups.ts:1056 |
| DELETE | `/api/v2/groups/{param}/files/{param}` | groups.ts:1045 |
| POST | `/api/v2/groups/{param}/image` | groups.ts:763 |
| GET | `/api/v2/groups/{param}/invites` | groups.ts:1450 |
| DELETE | `/api/v2/groups/{param}/invites/{param}` | groups.ts:1481 |
| POST | `/api/v2/groups/{param}/invites/email` | groups.ts:1471 |
| POST | `/api/v2/groups/{param}/invites/link` | groups.ts:1458 |
| POST | `/api/v2/groups/{param}/join` | groups.ts:1370 |
| GET | `/api/v2/groups/{param}/media` | groups.ts:1077 |
| POST | `/api/v2/groups/{param}/media` | groups.ts:1091 |
| DELETE | `/api/v2/groups/{param}/media/{param}` | groups.ts:1081 |
| GET | `/api/v2/groups/{param}/members` | groups.ts:783 |
| DELETE | `/api/v2/groups/{param}/members/{param}` | groups.ts:985 |
| PUT | `/api/v2/groups/{param}/members/{param}` | groups.ts:980 |
| DELETE | `/api/v2/groups/{param}/membership` | groups.ts:1377 |
| GET | `/api/v2/groups/{param}/notification-prefs` | groups.ts:606 |
| PUT | `/api/v2/groups/{param}/notification-prefs` | groups.ts:618 |
| POST | `/api/v2/groups/{param}/qa/vote` | groups.ts:1172 |
| GET | `/api/v2/groups/{param}/questions` | groups.ts:1131 |
| POST | `/api/v2/groups/{param}/questions` | groups.ts:1144, groups.ts:1149 |
| GET | `/api/v2/groups/{param}/questions/{param}` | groups.ts:1135 |
| POST | `/api/v2/groups/{param}/questions/{param}/answers` | groups.ts:1160, groups.ts:1165 |
| GET | `/api/v2/groups/{param}/requests` | groups.ts:942 |
| POST | `/api/v2/groups/{param}/requests/{param}` | groups.ts:960, groups.ts:962 |
| GET | `/api/v2/groups/{param}/scheduled-posts` | groups.ts:879 |
| POST | `/api/v2/groups/{param}/scheduled-posts` | groups.ts:894 |
| DELETE | `/api/v2/groups/{param}/scheduled-posts/{param}` | groups.ts:902 |
| GET | `/api/v2/groups/{param}/task-stats` | groups.ts:1234 |
| GET | `/api/v2/groups/{param}/tasks` | groups.ts:1230 |
| POST | `/api/v2/groups/{param}/tasks` | groups.ts:1254, groups.ts:1259 |
| GET | `/api/v2/groups/{param}/welcome` | groups.ts:906 |
| PUT | `/api/v2/groups/{param}/welcome` | groups.ts:910 |
| GET | `/api/v2/groups/{param}/wiki` | groups.ts:1183 |
| POST | `/api/v2/groups/{param}/wiki` | groups.ts:1196, groups.ts:1201 |
| DELETE | `/api/v2/groups/{param}/wiki/{param}` | groups.ts:1213 |
| GET | `/api/v2/groups/{param}/wiki/{param}` | groups.ts:1187 |
| PUT | `/api/v2/groups/{param}/wiki/{param}` | groups.ts:1209 |
| GET | `/api/v2/groups/{param}/wiki/{param}/revisions` | groups.ts:1217 |
| GET | `/api/v2/groups/form-capabilities` | groups.ts:588 |
| GET | `/api/v2/groups/invite/{param}` | groups.ts:1485 |
| POST | `/api/v2/groups/invite/{param}/accept` | groups.ts:1490 |
| GET | `/api/v2/help/faqs` | help.ts:49 |
| GET | `/api/v2/ideation-campaigns` | ideation.ts:283 |
| GET | `/api/v2/ideation-campaigns/{param}` | ideation.ts:287 |
| GET | `/api/v2/ideation-categories` | ideation.ts:171 |
| GET | `/api/v2/ideation-challenges` | ideation.ts:166 |
| POST | `/api/v2/ideation-challenges` | ideation.ts:184 |
| GET | `/api/v2/ideation-challenges/{param}` | ideation.ts:176 |
| PUT | `/api/v2/ideation-challenges/{param}` | ideation.ts:192 |
| GET | `/api/v2/ideation-challenges/{param}/ideas` | ideation.ts:196 |
| DELETE | `/api/v2/ideation-comments/{param}` | ideation.ts:277 |
| DELETE | `/api/v2/ideation-ideas/{param}` | ideation.ts:272 |
| GET | `/api/v2/ideation-ideas/{param}` | ideation.ts:238 |
| PUT | `/api/v2/ideation-ideas/{param}` | ideation.ts:242 |
| GET | `/api/v2/ideation-ideas/{param}/comments` | ideation.ts:248 |
| GET | `/api/v2/ideation-outcomes/dashboard` | ideation.ts:291 |
| POST | `/api/v2/identity/create-payment` | verification.ts:112 |
| POST | `/api/v2/identity/save-dob` | verification.ts:102 |
| POST | `/api/v2/identity/start` | verification.ts:108 |
| GET | `/api/v2/identity/status` | verification.ts:98 |
| GET | `/api/v2/jobs` | jobs.ts:270 |
| POST | `/api/v2/jobs` | jobs.ts:275, jobs.ts:279 |
| GET | `/api/v2/jobs/{param}` | jobs.ts:310 |
| PUT | `/api/v2/jobs/{param}` | jobs.ts:283, jobs.ts:287 |
| GET | `/api/v2/jobs/{param}/analytics` | jobs.ts:318 |
| GET | `/api/v2/jobs/{param}/applications` | jobs.ts:314 |
| POST | `/api/v2/jobs/{param}/apply` | jobs.ts:380, jobs.ts:401 |
| GET | `/api/v2/jobs/{param}/match` | jobs.ts:490 |
| GET | `/api/v2/jobs/{param}/predictions` | jobs.ts:322 |
| DELETE | `/api/v2/jobs/{param}/save` | jobs.ts:417 |
| POST | `/api/v2/jobs/{param}/save` | jobs.ts:410 |
| GET | `/api/v2/jobs/alerts` | jobs.ts:448 |
| POST | `/api/v2/jobs/alerts` | jobs.ts:456, jobs.ts:460 |
| DELETE | `/api/v2/jobs/alerts/{param}` | jobs.ts:467 |
| PUT | `/api/v2/jobs/alerts/{param}/resubscribe` | jobs.ts:481 |
| PUT | `/api/v2/jobs/alerts/{param}/unsubscribe` | jobs.ts:474 |
| PUT | `/api/v2/jobs/applications/{param}` | jobs.ts:329, jobs.ts:365 |
| GET | `/api/v2/jobs/applications/{param}/history` | jobs.ts:361 |
| POST | `/api/v2/jobs/applications/{param}/interview` | jobs.ts:339 |
| POST | `/api/v2/jobs/applications/{param}/offer` | jobs.ts:353 |
| POST | `/api/v2/jobs/generate-description` | jobs.ts:296 |
| DELETE | `/api/v2/jobs/interviews/{param}` | jobs.ts:343 |
| PUT | `/api/v2/jobs/interviews/{param}/accept` | jobs.ts:509 |
| PUT | `/api/v2/jobs/interviews/{param}/decline` | jobs.ts:520 |
| GET | `/api/v2/jobs/my-applications` | jobs.ts:430 |
| GET | `/api/v2/jobs/my-interviews` | jobs.ts:497 |
| GET | `/api/v2/jobs/my-offers` | jobs.ts:527 |
| GET | `/api/v2/jobs/my-postings` | jobs.ts:441 |
| DELETE | `/api/v2/jobs/offers/{param}` | jobs.ts:357 |
| PUT | `/api/v2/jobs/offers/{param}/accept` | jobs.ts:539 |
| PUT | `/api/v2/jobs/offers/{param}/reject` | jobs.ts:550 |
| GET | `/api/v2/jobs/recommended` | jobs.ts:303 |
| GET | `/api/v2/jobs/saved-profile` | jobs.ts:557 |
| GET | `/api/v2/kb` | resources.ts:106 |
| GET | `/api/v2/kb/{param}` | resources.ts:123 |
| POST | `/api/v2/kb/{param}/feedback` | resources.ts:132 |
| GET | `/api/v2/kb/search` | resources.ts:111, resources.ts:116 |
| GET | `/api/v2/legal/{param}` | legal.ts:104 |
| POST | `/api/v2/legal/acceptance/accept-all` | legal.ts:94 |
| GET | `/api/v2/legal/acceptance/status` | legal.ts:82 |
| GET | `/api/v2/listings` | exchanges.ts:180 |
| POST | `/api/v2/listings` | exchanges.ts:238, exchanges.ts:239 |
| DELETE | `/api/v2/listings/{param}` | exchanges.ts:379 |
| GET | `/api/v2/listings/{param}` | exchanges.ts:229 |
| PUT | `/api/v2/listings/{param}` | exchanges.ts:312 |
| DELETE | `/api/v2/listings/{param}/image` | exchanges.ts:374 |
| POST | `/api/v2/listings/{param}/image` | exchanges.ts:363 |
| POST | `/api/v2/listings/{param}/renew` | exchanges.ts:274 |
| POST | `/api/v2/listings/{param}/report` | exchanges.ts:300 |
| DELETE | `/api/v2/listings/{param}/save` | exchanges.ts:270 |
| POST | `/api/v2/listings/{param}/save` | exchanges.ts:266 |
| PUT | `/api/v2/listings/{param}/tags` | exchanges.ts:247 |
| POST | `/api/v2/listings/generate-description` | exchanges.ts:304 |
| GET | `/api/v2/listings/mine` | exchanges.ts:220 |
| GET | `/api/v2/marketplace/categories` | marketplace.ts:606 |
| GET | `/api/v2/marketplace/categories/{param}/template` | marketplace.ts:610 |
| GET | `/api/v2/marketplace/collections` | marketplace.ts:1050 |
| POST | `/api/v2/marketplace/collections` | marketplace.ts:1058 |
| DELETE | `/api/v2/marketplace/collections/{param}` | marketplace.ts:1062 |
| GET | `/api/v2/marketplace/collections/{param}/items` | marketplace.ts:1073 |
| POST | `/api/v2/marketplace/collections/{param}/items` | marketplace.ts:1077 |
| DELETE | `/api/v2/marketplace/collections/{param}/items/{param}` | marketplace.ts:1084 |
| GET | `/api/v2/marketplace/groups/{param}/listings` | marketplace.ts:1024 |
| GET | `/api/v2/marketplace/groups/{param}/stats` | marketplace.ts:1028 |
| GET | `/api/v2/marketplace/listings` | marketplace.ts:576 |
| POST | `/api/v2/marketplace/listings` | marketplace.ts:628, marketplace.ts:630 |
| DELETE | `/api/v2/marketplace/listings/{param}` | marketplace.ts:667 |
| PUT | `/api/v2/marketplace/listings/{param}` | marketplace.ts:655 |
| POST | `/api/v2/marketplace/listings/{param}/images` | marketplace.ts:705 |
| DELETE | `/api/v2/marketplace/listings/{param}/images/{param}` | marketplace.ts:709 |
| POST | `/api/v2/marketplace/listings/{param}/offers` | marketplace.ts:734 |
| POST | `/api/v2/marketplace/listings/{param}/promote` | marketplace.ts:1096 |
| POST | `/api/v2/marketplace/listings/{param}/renew` | marketplace.ts:686 |
| POST | `/api/v2/marketplace/listings/{param}/report` | marketplace.ts:678 |
| DELETE | `/api/v2/marketplace/listings/{param}/save` | marketplace.ts:682 |
| POST | `/api/v2/marketplace/listings/{param}/save` | marketplace.ts:671 |
| DELETE | `/api/v2/marketplace/listings/{param}/video` | marketplace.ts:719 |
| POST | `/api/v2/marketplace/listings/{param}/video` | marketplace.ts:715 |
| GET | `/api/v2/marketplace/listings/featured` | marketplace.ts:594 |
| GET | `/api/v2/marketplace/listings/free` | marketplace.ts:602 |
| POST | `/api/v2/marketplace/listings/generate-description` | marketplace.ts:663 |
| GET | `/api/v2/marketplace/listings/nearby` | marketplace.ts:590 |
| GET | `/api/v2/marketplace/me/pickups` | marketplace.ts:1177 |
| GET | `/api/v2/marketplace/my-offers/{param}` | marketplace.ts:744 |
| DELETE | `/api/v2/marketplace/offers/{param}` | marketplace.ts:767 |
| PUT | `/api/v2/marketplace/offers/{param}/accept` | marketplace.ts:748 |
| PUT | `/api/v2/marketplace/offers/{param}/accept-counter` | marketplace.ts:759 |
| PUT | `/api/v2/marketplace/offers/{param}/counter` | marketplace.ts:755 |
| PUT | `/api/v2/marketplace/offers/{param}/decline` | marketplace.ts:763 |
| POST | `/api/v2/marketplace/orders` | marketplace.ts:865 |
| GET | `/api/v2/marketplace/orders/{param}` | marketplace.ts:779, marketplace.ts:784 |
| PUT | `/api/v2/marketplace/orders/{param}/cancel` | marketplace.ts:799 |
| PUT | `/api/v2/marketplace/orders/{param}/confirm-delivery` | marketplace.ts:795 |
| GET | `/api/v2/marketplace/orders/{param}/delivery-offers` | marketplace.ts:821 |
| POST | `/api/v2/marketplace/orders/{param}/delivery-offers` | marketplace.ts:837 |
| PUT | `/api/v2/marketplace/orders/{param}/delivery-offers/{param}/accept` | marketplace.ts:844 |
| PUT | `/api/v2/marketplace/orders/{param}/delivery-offers/{param}/confirm` | marketplace.ts:851 |
| POST | `/api/v2/marketplace/orders/{param}/dispute` | marketplace.ts:813 |
| POST | `/api/v2/marketplace/orders/{param}/pickup-reservation` | marketplace.ts:910 |
| POST | `/api/v2/marketplace/orders/{param}/rate` | marketplace.ts:806 |
| GET | `/api/v2/marketplace/orders/{param}/ratings` | marketplace.ts:817 |
| PUT | `/api/v2/marketplace/orders/{param}/ship` | marketplace.ts:791 |
| POST | `/api/v2/marketplace/orders/checkout-outcome` | marketplace.ts:878 |
| GET | `/api/v2/marketplace/orders/deliveries` | marketplace.ts:830 |
| POST | `/api/v2/marketplace/payments/confirm` | marketplace.ts:888 |
| POST | `/api/v2/marketplace/payments/create-intent` | marketplace.ts:869 |
| GET | `/api/v2/marketplace/promotions/mine` | marketplace.ts:1092 |
| GET | `/api/v2/marketplace/promotions/products` | marketplace.ts:1088 |
| GET | `/api/v2/marketplace/saved-searches` | marketplace.ts:1032 |
| POST | `/api/v2/marketplace/saved-searches` | marketplace.ts:1042 |
| DELETE | `/api/v2/marketplace/saved-searches/{param}` | marketplace.ts:1046 |
| GET | `/api/v2/marketplace/seller/balance` | marketplace.ts:969 |
| GET | `/api/v2/marketplace/seller/coupons` | marketplace.ts:1185 |
| POST | `/api/v2/marketplace/seller/coupons` | marketplace.ts:1202 |
| DELETE | `/api/v2/marketplace/seller/coupons/{param}` | marketplace.ts:1226 |
| PUT | `/api/v2/marketplace/seller/coupons/{param}` | marketplace.ts:1222 |
| GET | `/api/v2/marketplace/seller/coupons/{param}/redemptions` | marketplace.ts:1230 |
| GET | `/api/v2/marketplace/seller/dashboard` | marketplace.ts:999 |
| POST | `/api/v2/marketplace/seller/onboard` | marketplace.ts:980 |
| GET | `/api/v2/marketplace/seller/onboard/status` | marketplace.ts:965 |
| GET | `/api/v2/marketplace/seller/payouts` | marketplace.ts:976 |
| POST | `/api/v2/marketplace/seller/pickup-scan` | marketplace.ts:1181 |
| GET | `/api/v2/marketplace/seller/pickup-slots` | marketplace.ts:1102 |
| POST | `/api/v2/marketplace/seller/pickup-slots` | marketplace.ts:1155 |
| DELETE | `/api/v2/marketplace/seller/pickup-slots/{param}` | marketplace.ts:1173 |
| PUT | `/api/v2/marketplace/seller/pickup-slots/{param}` | marketplace.ts:1169 |
| GET | `/api/v2/marketplace/seller/shipping-options` | marketplace.ts:1106 |
| POST | `/api/v2/marketplace/seller/shipping-options` | marketplace.ts:1125 |
| DELETE | `/api/v2/marketplace/seller/shipping-options/{param}` | marketplace.ts:1144 |
| PUT | `/api/v2/marketplace/seller/shipping-options/{param}` | marketplace.ts:1140 |
| GET | `/api/v2/marketplace/sellers/{param}` | marketplace.ts:984 |
| GET | `/api/v2/marketplace/sellers/{param}/listings` | marketplace.ts:995 |
| GET | `/api/v2/marketplace/sellers/{param}/shipping-options` | marketplace.ts:1112 |
| POST | `/api/v2/matches/{param}/dismiss` | matches.ts:240 |
| GET | `/api/v2/matches/all` | matches.ts:222 |
| GET | `/api/v2/me/collections` | savedCollections.ts:55 |
| POST | `/api/v2/me/collections` | savedCollections.ts:63 |
| GET | `/api/v2/me/collections/{param}/items` | savedCollections.ts:67 |
| GET | `/api/v2/me/courses` | courses.ts:263 |
| GET | `/api/v2/me/data-export/history` | settings.ts:88 |
| DELETE | `/api/v2/me/saved-items/{param}` | savedCollections.ts:74 |
| DELETE | `/api/v2/members/{param}/endorse` | endorsements.ts:232 |
| POST | `/api/v2/members/{param}/endorse` | endorsements.ts:214 |
| GET | `/api/v2/members/{param}/endorsements` | endorsements.ts:169 |
| POST | `/api/v2/merchant-onboarding/complete` | marketplace.ts:961 |
| GET | `/api/v2/merchant-onboarding/status` | marketplace.ts:933 |
| POST | `/api/v2/merchant-onboarding/step-1` | marketplace.ts:943 |
| POST | `/api/v2/merchant-onboarding/step-2` | marketplace.ts:950 |
| POST | `/api/v2/merchant-onboarding/step-3` | marketplace.ts:957 |
| GET | `/api/v2/messages` | messages.ts:162 |
| POST | `/api/v2/messages` | messages.ts:253, messages.ts:254 |
| DELETE | `/api/v2/messages/{param}` | messages.ts:242 |
| GET | `/api/v2/messages/{param}` | messages.ts:169 |
| PUT | `/api/v2/messages/{param}` | messages.ts:238 |
| POST | `/api/v2/messages/{param}/reactions` | messages.ts:234 |
| PUT | `/api/v2/messages/{param}/read` | messages.ts:215 |
| POST | `/api/v2/messages/{param}/report` | memberReports.ts:70 |
| DELETE | `/api/v2/messages/conversations/{param}` | messages.ts:195 |
| POST | `/api/v2/messages/conversations/{param}/restore` | messages.ts:199 |
| GET | `/api/v2/messages/restriction-status` | messages.ts:230 |
| POST | `/api/v2/messages/typing` | messages.ts:223 |
| GET | `/api/v2/messages/unread-count` | messages.ts:211 |
| POST | `/api/v2/messages/voice` | messages.ts:342, messages.ts:343 |
| DELETE | `/api/v2/notifications/{param}` | notifications.ts:119 |
| POST | `/api/v2/notifications/{param}/read` | notifications.ts:105 |
| GET | `/api/v2/notifications/counts` | notifications.ts:100 |
| POST | `/api/v2/notifications/group/read` | notifications.ts:114 |
| GET | `/api/v2/notifications/grouped` | notifications.ts:95 |
| POST | `/api/v2/notifications/read-all` | notifications.ts:110 |
| GET | `/api/v2/onboarding/categories` | onboarding.ts:106 |
| POST | `/api/v2/onboarding/complete` | onboarding.ts:121 |
| GET | `/api/v2/onboarding/config` | onboarding.ts:102 |
| POST | `/api/v2/onboarding/safeguarding` | onboarding.ts:114 |
| GET | `/api/v2/onboarding/safeguarding-options` | onboarding.ts:110 |
| GET | `/api/v2/onboarding/status` | onboarding.ts:98 |
| GET | `/api/v2/partner-venues` | venues.ts:55 |
| GET | `/api/v2/partner-venues/my-visits` | venues.ts:68 |
| GET | `/api/v2/partner-venues/pass` | venues.ts:60 |
| POST | `/api/v2/partner-venues/pass/rotate` | venues.ts:64 |
| POST | `/api/v2/partner-venues/visits/verify/{param}` | venues.ts:73 |
| GET | `/api/v2/podcasts` | podcasts.ts:196 |
| POST | `/api/v2/podcasts` | podcasts.ts:261, podcasts.ts:262 |
| DELETE | `/api/v2/podcasts/{param}` | podcasts.ts:280 |
| GET | `/api/v2/podcasts/{param}` | podcasts.ts:203 |
| PUT | `/api/v2/podcasts/{param}` | podcasts.ts:268 |
| GET | `/api/v2/podcasts/{param}/{param}` | podcasts.ts:207 |
| POST | `/api/v2/podcasts/{param}/archive` | podcasts.ts:276 |
| POST | `/api/v2/podcasts/{param}/artwork` | podcasts.ts:345 |
| POST | `/api/v2/podcasts/{param}/episodes` | podcasts.ts:284, podcasts.ts:285 |
| DELETE | `/api/v2/podcasts/{param}/episodes/{param}` | podcasts.ts:303 |
| PUT | `/api/v2/podcasts/{param}/episodes/{param}` | podcasts.ts:291 |
| POST | `/api/v2/podcasts/{param}/episodes/{param}/archive` | podcasts.ts:299 |
| POST | `/api/v2/podcasts/{param}/episodes/{param}/cover` | podcasts.ts:351 |
| POST | `/api/v2/podcasts/{param}/episodes/{param}/publish` | podcasts.ts:295 |
| POST | `/api/v2/podcasts/{param}/publish` | podcasts.ts:272 |
| GET | `/api/v2/podcasts/{param}/stats` | podcasts.ts:257 |
| POST | `/api/v2/podcasts/{param}/subscribe` | podcasts.ts:215 |
| GET | `/api/v2/podcasts/{param}/validate-feed` | podcasts.ts:253 |
| POST | `/api/v2/podcasts/episodes/{param}/listen` | podcasts.ts:211 |
| POST | `/api/v2/podcasts/episodes/{param}/reaction` | podcasts.ts:222 |
| POST | `/api/v2/podcasts/episodes/{param}/report` | podcasts.ts:229 |
| GET | `/api/v2/podcasts/mine` | podcasts.ts:246 |
| GET | `/api/v2/polls` | events.ts:1289 |
| POST | `/api/v2/polls` | polls.ts:51, polls.ts:52 |
| POST | `/api/v2/polls/{param}/rank` | polls.ts:56 |
| GET | `/api/v2/polls/{param}/ranked-results` | polls.ts:62 |
| POST | `/api/v2/polls/{param}/vote` | events.ts:1297 |
| GET | `/api/v2/public-page-content/{param}` | staticPages.ts:77 |
| POST | `/api/v2/reactions` | feed.ts:350 |
| GET | `/api/v2/reactions/{param}/{param}/users/{param}` | feed.ts:375 |
| GET | `/api/v2/resources` | resources.ts:96 |
| GET | `/api/v2/resources/categories` | resources.ts:101 |
| POST | `/api/v2/reviews` | reviews.ts:127 |
| DELETE | `/api/v2/reviews/{param}` | reviews.ts:131 |
| GET | `/api/v2/reviews/given` | reviews.ts:103 |
| GET | `/api/v2/reviews/pending` | reviews.ts:116 |
| GET | `/api/v2/reviews/user/{param}` | members.ts:92, reviews.ts:74 |
| POST | `/api/v2/safeguarding/add-choice` | safeguarding.ts:95 |
| GET | `/api/v2/safeguarding/available-options` | safeguarding.ts:77 |
| GET | `/api/v2/safeguarding/my-preferences` | safeguarding.ts:57 |
| POST | `/api/v2/safeguarding/revoke` | safeguarding.ts:99 |
| GET | `/api/v2/search` | search.ts:50 |
| GET | `/api/v2/search/saved` | search.ts:63 |
| POST | `/api/v2/search/saved` | search.ts:71 |
| DELETE | `/api/v2/search/saved/{param}` | search.ts:78 |
| POST | `/api/v2/search/saved/{param}/run` | search.ts:82 |
| GET | `/api/v2/skills/categories` | endorsements.ts:272 |
| GET | `/api/v2/skills/categories/{param}` | endorsements.ts:276 |
| GET | `/api/v2/skills/members` | endorsements.ts:280 |
| GET | `/api/v2/skills/search` | endorsements.ts:267 |
| POST | `/api/v2/support/reports` | support.ts:188, support.ts:189 |
| DELETE | `/api/v2/team-tasks/{param}` | groups.ts:1270 |
| GET | `/api/v2/team-tasks/{param}` | groups.ts:1238 |
| PUT | `/api/v2/team-tasks/{param}` | groups.ts:1266 |
| GET | `/api/v2/tenant/bootstrap` | tenant.ts:122, tenant.ts:142 |
| GET | `/api/v2/tenants` | tenant.ts:157 |
| GET | `/api/v2/users` | client.ts:808, eventPeople.ts:92, members.ts:77 |
| GET | `/api/v2/users/{param}` | members.ts:82 |
| GET | `/api/v2/users/{param}/appreciations` | appreciations.ts:46 |
| DELETE | `/api/v2/users/{param}/block` | settings.ts:149 |
| POST | `/api/v2/users/{param}/block` | settings.ts:145 |
| GET | `/api/v2/users/{param}/listings` | members.ts:87 |
| GET | `/api/v2/users/{param}/public-collections` | savedCollections.ts:59 |
| POST | `/api/v2/users/{param}/report` | memberReports.ts:66 |
| GET | `/api/v2/users/blocked` | settings.ts:133 |
| DELETE | `/api/v2/users/me` | settings.ts:129 |
| GET | `/api/v2/users/me` | auth.ts:391 |
| PUT | `/api/v2/users/me` | profile.ts:26 |
| GET | `/api/v2/users/me/activity/dashboard` | activity.ts:72 |
| POST | `/api/v2/users/me/avatar` | profile.ts:96 |
| GET | `/api/v2/users/me/match-preferences` | matches.ts:244 |
| PUT | `/api/v2/users/me/match-preferences` | matches.ts:251 |
| GET | `/api/v2/users/me/parent-accounts` | settings.ts:167 |
| PUT | `/api/v2/users/me/parent-accounts/{param}/permissions` | settings.ts:208 |
| POST | `/api/v2/users/me/password` | profile.ts:39 |
| GET | `/api/v2/users/me/preferences` | settings.ts:153 |
| PUT | `/api/v2/users/me/preferences` | settings.ts:158 |
| GET | `/api/v2/users/me/skills` | endorsements.ts:188 |
| POST | `/api/v2/users/me/skills` | endorsements.ts:242 |
| DELETE | `/api/v2/users/me/skills/{param}` | endorsements.ts:255 |
| GET | `/api/v2/users/me/sub-accounts` | settings.ts:162 |
| POST | `/api/v2/users/me/sub-accounts` | settings.ts:172 |
| DELETE | `/api/v2/users/me/sub-accounts/{param}` | settings.ts:239 |
| GET | `/api/v2/users/me/sub-accounts/{param}/activity` | settings.ts:280 |
| PUT | `/api/v2/users/me/sub-accounts/{param}/approve` | settings.ts:176 |
| PUT | `/api/v2/users/me/sub-accounts/{param}/permissions` | settings.ts:183, settings.ts:199 |
| GET | `/api/v2/volunteering/accessibility-needs` | volunteeringVolunteer.ts:448 |
| PUT | `/api/v2/volunteering/accessibility-needs` | volunteeringVolunteer.ts:456 |
| GET | `/api/v2/volunteering/applications` | volunteering.ts:476 |
| DELETE | `/api/v2/volunteering/applications/{param}` | volunteering.ts:512 |
| PUT | `/api/v2/volunteering/applications/{param}` | volunteering.ts:501 |
| GET | `/api/v2/volunteering/certificates` | volunteering.ts:640 |
| POST | `/api/v2/volunteering/certificates` | volunteering.ts:644 |
| POST | `/api/v2/volunteering/checkin/checkout/{param}` | volunteering.ts:782 |
| POST | `/api/v2/volunteering/checkin/verify/{param}` | volunteering.ts:777 |
| GET | `/api/v2/volunteering/donations` | volunteering.ts:671 |
| POST | `/api/v2/volunteering/donations` | volunteering.ts:723 |
| GET | `/api/v2/volunteering/emergency-alerts` | volunteeringVolunteer.ts:248 |
| PUT | `/api/v2/volunteering/emergency-alerts/{param}` | volunteeringVolunteer.ts:259 |
| GET | `/api/v2/volunteering/expenses` | volunteering.ts:652 |
| POST | `/api/v2/volunteering/expenses` | volunteering.ts:659, volunteeringVolunteer.ts:616 |
| GET | `/api/v2/volunteering/giving-days` | volunteering.ts:667 |
| GET | `/api/v2/volunteering/group-reservations` | volunteeringVolunteer.ts:496 |
| DELETE | `/api/v2/volunteering/group-reservations/{param}` | volunteeringVolunteer.ts:524 |
| POST | `/api/v2/volunteering/group-reservations/{param}/members` | volunteeringVolunteer.ts:515 |
| DELETE | `/api/v2/volunteering/group-reservations/{param}/members/{param}` | volunteeringVolunteer.ts:520 |
| POST | `/api/v2/volunteering/hours` | volunteering.ts:748 |
| PUT | `/api/v2/volunteering/hours/{param}/verify` | volunteering.ts:508 |
| GET | `/api/v2/volunteering/hours/summary` | volunteering.ts:516 |
| GET | `/api/v2/volunteering/incidents` | volunteeringVolunteer.ts:420 |
| POST | `/api/v2/volunteering/incidents` | volunteeringVolunteer.ts:402 |
| GET | `/api/v2/volunteering/incidents/report-options` | volunteeringVolunteer.ts:373 |
| GET | `/api/v2/volunteering/my-organisations` | volunteering.ts:520 |
| GET | `/api/v2/volunteering/my-waitlists` | volunteeringVolunteer.ts:91 |
| GET | `/api/v2/volunteering/opportunities` | volunteering.ts:459 |
| POST | `/api/v2/volunteering/opportunities` | volunteering.ts:731 |
| DELETE | `/api/v2/volunteering/opportunities/{param}` | volunteeringOrganiser.ts:55 |
| GET | `/api/v2/volunteering/opportunities/{param}` | volunteering.ts:469 |
| PUT | `/api/v2/volunteering/opportunities/{param}` | volunteering.ts:739 |
| GET | `/api/v2/volunteering/opportunities/{param}/applications` | volunteering.ts:487 |
| POST | `/api/v2/volunteering/opportunities/{param}/apply` | volunteering.ts:756 |
| GET | `/api/v2/volunteering/opportunities/{param}/recurring-patterns` | volunteeringOrganiser.ts:147 |
| POST | `/api/v2/volunteering/opportunities/{param}/recurring-patterns` | volunteeringOrganiser.ts:152 |
| GET | `/api/v2/volunteering/opportunities/{param}/shifts` | volunteering.ts:690, volunteeringOrganiser.ts:81 |
| POST | `/api/v2/volunteering/opportunities/{param}/shifts` | volunteeringOrganiser.ts:86 |
| GET | `/api/v2/volunteering/organisations` | organisations.ts:59 |
| POST | `/api/v2/volunteering/organisations` | organisations.ts:77, organisations.ts:81 |
| GET | `/api/v2/volunteering/organisations/{param}` | organisations.ts:69, volunteering.ts:527 |
| PUT | `/api/v2/volunteering/organisations/{param}` | volunteering.ts:629 |
| GET | `/api/v2/volunteering/organisations/{param}/applications` | volunteering.ts:538 |
| GET | `/api/v2/volunteering/organisations/{param}/campaigns` | volunteeringOrganiser.ts:394 |
| POST | `/api/v2/volunteering/organisations/{param}/campaigns` | volunteeringOrganiser.ts:399 |
| PUT | `/api/v2/volunteering/organisations/{param}/campaigns/{param}` | volunteeringOrganiser.ts:404 |
| GET | `/api/v2/volunteering/organisations/{param}/campaigns/{param}/gifts` | volunteeringOrganiser.ts:409 |
| GET | `/api/v2/volunteering/organisations/{param}/campaigns/{param}/handovers` | volunteeringOrganiser.ts:419 |
| GET | `/api/v2/volunteering/organisations/{param}/campaigns/{param}/history` | volunteeringOrganiser.ts:414 |
| GET | `/api/v2/volunteering/organisations/{param}/expenses` | volunteeringOrganiser.ts:261 |
| PUT | `/api/v2/volunteering/organisations/{param}/expenses/{param}` | volunteeringOrganiser.ts:280 |
| POST | `/api/v2/volunteering/organisations/{param}/handovers/{param}/confirm` | volunteeringOrganiser.ts:424 |
| GET | `/api/v2/volunteering/organisations/{param}/hours/pending` | volunteering.ts:545 |
| GET | `/api/v2/volunteering/organisations/{param}/opportunities` | volunteeringOrganiser.ts:47 |
| GET | `/api/v2/volunteering/organisations/{param}/stats` | volunteering.ts:531 |
| GET | `/api/v2/volunteering/organisations/{param}/volunteers` | volunteering.ts:551 |
| POST | `/api/v2/volunteering/organisations/{param}/wallet/deposit` | volunteering.ts:612 |
| GET | `/api/v2/volunteering/organisations/{param}/wallet/transactions` | volunteering.ts:591 |
| GET | `/api/v2/volunteering/organisations/{param}/wellbeing` | volunteering.ts:587 |
| GET | `/api/v2/volunteering/qualifications` | volunteeringVolunteer.ts:313 |
| POST | `/api/v2/volunteering/qualifications` | volunteeringVolunteer.ts:344 |
| PUT | `/api/v2/volunteering/qualifications/{param}` | volunteeringVolunteer.ts:348 |
| POST | `/api/v2/volunteering/qualifications/{param}/withdraw` | volunteeringVolunteer.ts:352 |
| DELETE | `/api/v2/volunteering/recurring-patterns/{param}` | volunteeringOrganiser.ts:166 |
| PUT | `/api/v2/volunteering/recurring-patterns/{param}` | volunteeringOrganiser.ts:161 |
| GET | `/api/v2/volunteering/shifts` | volunteering.ts:633 |
| DELETE | `/api/v2/volunteering/shifts/{param}` | volunteeringOrganiser.ts:99 |
| PUT | `/api/v2/volunteering/shifts/{param}` | volunteeringOrganiser.ts:91 |
| GET | `/api/v2/volunteering/shifts/{param}/checkin` | volunteeringVolunteer.ts:136 |
| GET | `/api/v2/volunteering/shifts/{param}/checkins` | volunteeringOrganiser.ts:203 |
| POST | `/api/v2/volunteering/shifts/{param}/group-reserve` | volunteeringVolunteer.ts:507 |
| GET | `/api/v2/volunteering/shifts/{param}/roster` | volunteeringOrganiser.ts:198 |
| DELETE | `/api/v2/volunteering/shifts/{param}/signup` | volunteering.ts:767 |
| POST | `/api/v2/volunteering/shifts/{param}/signup` | volunteering.ts:760 |
| DELETE | `/api/v2/volunteering/shifts/{param}/waitlist` | volunteeringVolunteer.ts:105 |
| POST | `/api/v2/volunteering/shifts/{param}/waitlist` | volunteeringVolunteer.ts:100 |
| POST | `/api/v2/volunteering/shifts/{param}/waitlist/promote` | volunteeringVolunteer.ts:110 |
| GET | `/api/v2/volunteering/swaps` | volunteering.ts:681 |
| POST | `/api/v2/volunteering/swaps` | volunteering.ts:707 |
| DELETE | `/api/v2/volunteering/swaps/{param}` | volunteering.ts:719 |
| PUT | `/api/v2/volunteering/swaps/{param}` | volunteering.ts:715 |
| GET | `/api/v2/volunteering/wellbeing` | volunteeringVolunteer.ts:185 |
| POST | `/api/v2/volunteering/wellbeing/checkin` | volunteeringVolunteer.ts:216 |
| GET | `/api/v2/wallet/balance` | wallet.ts:184 |
| GET | `/api/v2/wallet/community-fund` | wallet.ts:220 |
| POST | `/api/v2/wallet/donate` | wallet.ts:259 |
| POST | `/api/v2/wallet/operation-status` | wallet.ts:251 |
| GET | `/api/v2/wallet/transactions` | wallet.ts:212 |
| GET | `/api/v2/wallet/transactions/{param}` | wallet.ts:197 |
| POST | `/api/v2/wallet/transfer` | wallet.ts:244 |
| GET | `/api/v2/wallet/user-search` | wallet.ts:228 |
| POST | `/api/webauthn/security-confirm` | twoFactor.ts:65 |
