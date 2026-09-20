<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Mobile API Consumer Ledger

Last reviewed: 2026-09-20

> GENERATED FILE — do not edit by hand.
> Regenerate with `npm run api:ledger` from `mobile/`.

Every Laravel endpoint the Expo client calls, and whether the API still exposes it.
The Jest suite mocks the HTTP client, so it cannot detect a renamed or deleted route.
This ledger is the compensating control.

Verified against: `docs/generated/laravel-api-route-inventory.json (2248 distinct API paths)`

> Not verified against `openapi.json`. That file documents only a subset of the
> application routes and has produced false drift findings for working endpoints.

| Measure | Count |
| --- | --- |
| API modules read | 60 |
| Call sites | 676 |
| Distinct method + endpoint pairs | 532 |
| Verified against openapi.json | 532 |
| **Missing from Laravel routes** | **0** |
| **Method mismatch** | **0** |
| Dynamic, not verifiable | 101 |
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
| eventOfflineCheckin.ts:238 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:245 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:253 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:267 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:279 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:291 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:305 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:318 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:329 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:369 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:378 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:398 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:408 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventOfflineCheckin.ts:419 | POST | variable "endpoint" is assigned more than one endpoint in this module |
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
| eventSafety.ts:139 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafety.ts:149 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafety.ts:161 | DELETE | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafety.ts:175 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventSafety.ts:189 | DELETE | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:165 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:173 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:182 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:192 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:237 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventTemplates.ts:251 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventTickets.ts:138 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| eventTickets.ts:149 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| eventTickets.ts:161 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:941 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1117 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1135 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1147 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1159 | DELETE | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1173 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1195 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1214 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1225 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1239 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1252 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1275 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1281 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1297 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1313 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1324 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1330 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1336 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1342 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1354 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1364 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1379 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1396 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1402 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1411 | PUT | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1420 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1431 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1442 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1448 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| events.ts:1499 | POST | endpoint literal nests a template inside an interpolation and could not be resolved statically |
| feed.ts:283 | GET | variable "path" is not a literal endpoint in this module |
| ideation.ts:211 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| ideation.ts:212 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| ideation.ts:229 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| ideation.ts:230 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| ideation.ts:255 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| ideation.ts:256 | POST | variable "endpoint" is assigned more than one endpoint in this module |
| marketplace.ts:605 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| marketplace.ts:606 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| marketplace.ts:879 | GET | variable "endpoint" is assigned more than one endpoint in this module |
| marketplace.ts:880 | GET | variable "endpoint" is assigned more than one endpoint in this module |

## Verified endpoints

| Method | Endpoint | Call sites |
| --- | --- | --- |
| POST | `/api/ai/chat` | chat.ts:86 |
| POST | `/api/ai/chat/feedback` | chat.ts:131 |
| GET | `/api/ai/chat/starters` | chat.ts:121 |
| GET | `/api/ai/conversations/{param}` | chat.ts:117 |
| POST | `/api/auth/forgot-password` | auth.ts:230 |
| POST | `/api/auth/login` | auth.ts:207 |
| POST | `/api/auth/logout` | auth.ts:289 |
| POST | `/api/auth/refresh-token` | auth.ts:299 |
| POST | `/api/auth/resend-verification-by-email` | auth.ts:258 |
| POST | `/api/auth/reset-password` | auth.ts:235 |
| POST | `/api/auth/verify-email` | auth.ts:240 |
| POST | `/api/totp/verify` | auth.ts:128 |
| POST | `/api/v2/appreciations` | appreciations.ts:70 |
| POST | `/api/v2/appreciations/{param}/react` | appreciations.ts:80 |
| POST | `/api/v2/auth/2fa/setup` | auth.ts:118 |
| POST | `/api/v2/auth/2fa/verify` | auth.ts:123 |
| POST | `/api/v2/auth/register` | auth.ts:219 |
| GET | `/api/v2/auth/registration-info` | auth.ts:282 |
| GET | `/api/v2/blog` | blog.ts:43 |
| GET | `/api/v2/blog/{param}` | blog.ts:54 |
| POST | `/api/v2/bookmarks` | feed.ts:394 |
| GET | `/api/v2/categories` | exchanges.ts:188 |
| GET | `/api/v2/clubs` | clubs.ts:31 |
| GET | `/api/v2/comments` | comments.ts:75, exchanges.ts:240 |
| POST | `/api/v2/comments` | comments.ts:87, exchanges.ts:247 |
| DELETE | `/api/v2/comments/{param}` | comments.ts:107 |
| PUT | `/api/v2/comments/{param}` | comments.ts:99 |
| POST | `/api/v2/comments/{param}/reactions` | comments.ts:114 |
| GET | `/api/v2/connections` | connections.ts:54 |
| DELETE | `/api/v2/connections/{param}` | connections.ts:79 |
| POST | `/api/v2/connections/{param}/accept` | connections.ts:69 |
| POST | `/api/v2/connections/{param}/decline` | connections.ts:74 |
| POST | `/api/v2/connections/request` | connections.ts:64 |
| GET | `/api/v2/connections/status/{param}` | connections.ts:59 |
| POST | `/api/v2/contact` | staticPages.ts:128 |
| GET | `/api/v2/coupons` | marketplace.ts:1208 |
| GET | `/api/v2/coupons/{param}` | marketplace.ts:1212 |
| POST | `/api/v2/coupons/{param}/qr` | marketplace.ts:1216 |
| POST | `/api/v2/coupons/redeem-qr` | marketplace.ts:1220 |
| POST | `/api/v2/coupons/validate` | marketplace.ts:899 |
| GET | `/api/v2/courses` | courses.ts:247 |
| POST | `/api/v2/courses` | courses.ts:349, courses.ts:350 |
| GET | `/api/v2/courses/{param}` | courses.ts:259 |
| PUT | `/api/v2/courses/{param}` | courses.ts:358 |
| GET | `/api/v2/courses/{param}/analytics` | courses.ts:535 |
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
| GET | `/api/v2/events/{param}/analytics` | eventAnalytics.ts:120 |
| GET | `/api/v2/events/{param}/lifecycle-history` | eventLifecycleHistory.ts:62 |
| GET | `/api/v2/events/{param}/people` | eventPeople.ts:116 |
| GET | `/api/v2/events/{param}/people/{param}/history` | eventPeople.ts:66 |
| POST | `/api/v2/events/{param}/people/bulk` | eventPeople.ts:173 |
| DELETE | `/api/v2/events/{param}/rsvp` | events.ts:1127 |
| DELETE | `/api/v2/events/{param}/waitlist` | events.ts:1244 |
| GET | `/api/v2/events/{param}/waitlist` | events.ts:1230 |
| GET | `/api/v2/exchanges` | exchangeRequests.ts:114 |
| POST | `/api/v2/exchanges` | client.ts:784, exchanges.ts:217 |
| DELETE | `/api/v2/exchanges/{param}` | exchangeRequests.ts:199 |
| GET | `/api/v2/exchanges/{param}` | exchangeRequests.ts:122 |
| POST | `/api/v2/exchanges/{param}/accept` | exchangeRequests.ts:141 |
| POST | `/api/v2/exchanges/{param}/complete` | exchangeRequests.ts:161 |
| POST | `/api/v2/exchanges/{param}/confirm` | exchangeRequests.ts:177 |
| POST | `/api/v2/exchanges/{param}/decline` | exchangeRequests.ts:149 |
| POST | `/api/v2/exchanges/{param}/dispute` | exchangeRequests.ts:229 |
| POST | `/api/v2/exchanges/{param}/start` | exchangeRequests.ts:156 |
| GET | `/api/v2/exchanges/check` | exchanges.ts:212 |
| GET | `/api/v2/exchanges/config` | exchanges.ts:207 |
| GET | `/api/v2/exchanges/needs-attention-count` | exchangeRequests.ts:134 |
| GET | `/api/v2/explore` | explore.ts:184 |
| GET | `/api/v2/federation/activity` | federation.ts:277 |
| GET | `/api/v2/federation/connections` | federation.ts:391 |
| POST | `/api/v2/federation/connections` | federation.ts:411 |
| DELETE | `/api/v2/federation/connections/{param}` | federation.ts:403 |
| POST | `/api/v2/federation/connections/{param}/accept` | federation.ts:395 |
| POST | `/api/v2/federation/connections/{param}/reject` | federation.ts:399 |
| GET | `/api/v2/federation/connections/status/{param}/{param}` | federation.ts:407 |
| GET | `/api/v2/federation/events` | federation.ts:316 |
| GET | `/api/v2/federation/groups` | federation.ts:312 |
| GET | `/api/v2/federation/listings` | federation.ts:308 |
| GET | `/api/v2/federation/members` | federation.ts:288 |
| GET | `/api/v2/federation/members/{param}` | federation.ts:296 |
| GET | `/api/v2/federation/members/{param}/reviews` | federation.ts:304 |
| GET | `/api/v2/federation/messages` | federation.ts:320 |
| POST | `/api/v2/federation/messages` | federation.ts:330 |
| POST | `/api/v2/federation/messages/{param}/mark-read` | federation.ts:346 |
| POST | `/api/v2/federation/messages/{param}/translate` | federation.ts:354 |
| POST | `/api/v2/federation/messages/mark-read-batch` | federation.ts:350 |
| POST | `/api/v2/federation/opt-in` | federation.ts:338 |
| POST | `/api/v2/federation/opt-out` | federation.ts:342 |
| GET | `/api/v2/federation/partners` | federation.ts:251 |
| GET | `/api/v2/federation/partners/{param}` | federation.ts:284 |
| GET | `/api/v2/federation/settings` | federation.ts:360 |
| PUT | `/api/v2/federation/settings` | federation.ts:364 |
| POST | `/api/v2/federation/setup` | federation.ts:368 |
| GET | `/api/v2/federation/status` | federation.ts:258, federation.ts:273 |
| POST | `/api/v2/federation/transactions` | federation.ts:334 |
| GET | `/api/v2/feed` | feed.ts:274 |
| GET | `/api/v2/feed/hashtags/{param}` | feed.ts:305 |
| GET | `/api/v2/feed/hashtags/search` | feed.ts:293 |
| GET | `/api/v2/feed/hashtags/trending` | feed.ts:287 |
| POST | `/api/v2/feed/like` | exchanges.ts:233, feed.ts:380 |
| GET | `/api/v2/feed/polls/{param}` | feed.ts:404 |
| POST | `/api/v2/feed/polls/{param}/vote` | feed.ts:411 |
| POST | `/api/v2/feed/posts` | feed.ts:472 |
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
| GET | `/api/v2/group-exchanges` | groupExchanges.ts:110 |
| POST | `/api/v2/group-exchanges` | groupExchanges.ts:118 |
| DELETE | `/api/v2/group-exchanges/{param}` | groupExchanges.ts:130 |
| GET | `/api/v2/group-exchanges/{param}` | groupExchanges.ts:114 |
| POST | `/api/v2/group-exchanges/{param}/complete` | groupExchanges.ts:126 |
| POST | `/api/v2/group-exchanges/{param}/confirm` | groupExchanges.ts:122 |
| GET | `/api/v2/group-templates` | groups.ts:434 |
| GET | `/api/v2/groups` | groups.ts:412 |
| POST | `/api/v2/groups` | groups.ts:426 |
| GET | `/api/v2/groups/{param}` | groups.ts:419 |
| PUT | `/api/v2/groups/{param}` | groups.ts:430 |
| GET | `/api/v2/groups/{param}/analytics` | groups.ts:702 |
| GET | `/api/v2/groups/{param}/analytics/comparative` | groups.ts:714 |
| GET | `/api/v2/groups/{param}/analytics/retention` | groups.ts:708 |
| GET | `/api/v2/groups/{param}/announcements` | groups.ts:647 |
| POST | `/api/v2/groups/{param}/announcements` | groups.ts:913, groups.ts:918 |
| DELETE | `/api/v2/groups/{param}/announcements/{param}` | groups.ts:936 |
| PUT | `/api/v2/groups/{param}/announcements/{param}` | groups.ts:929 |
| POST | `/api/v2/groups/{param}/answers/{param}/accept` | groups.ts:772 |
| GET | `/api/v2/groups/{param}/discussions` | groups.ts:615 |
| POST | `/api/v2/groups/{param}/discussions` | groups.ts:878, groups.ts:883 |
| GET | `/api/v2/groups/{param}/discussions/{param}` | groups.ts:632 |
| POST | `/api/v2/groups/{param}/discussions/{param}/messages` | groups.ts:898 |
| GET | `/api/v2/groups/{param}/files` | groups.ts:659 |
| DELETE | `/api/v2/groups/{param}/files/{param}` | groups.ts:663 |
| POST | `/api/v2/groups/{param}/image` | groups.ts:519 |
| POST | `/api/v2/groups/{param}/join` | groups.ts:959 |
| GET | `/api/v2/groups/{param}/media` | groups.ts:676 |
| POST | `/api/v2/groups/{param}/media` | groups.ts:687 |
| DELETE | `/api/v2/groups/{param}/media/{param}` | groups.ts:680 |
| GET | `/api/v2/groups/{param}/members` | groups.ts:537 |
| DELETE | `/api/v2/groups/{param}/members/{param}` | groups.ts:603 |
| PUT | `/api/v2/groups/{param}/members/{param}` | groups.ts:598 |
| DELETE | `/api/v2/groups/{param}/membership` | groups.ts:966 |
| POST | `/api/v2/groups/{param}/qa/vote` | groups.ts:768 |
| GET | `/api/v2/groups/{param}/questions` | groups.ts:727 |
| POST | `/api/v2/groups/{param}/questions` | groups.ts:740, groups.ts:745 |
| GET | `/api/v2/groups/{param}/questions/{param}` | groups.ts:731 |
| POST | `/api/v2/groups/{param}/questions/{param}/answers` | groups.ts:756, groups.ts:761 |
| GET | `/api/v2/groups/{param}/requests` | groups.ts:569 |
| POST | `/api/v2/groups/{param}/requests/{param}` | groups.ts:584 |
| GET | `/api/v2/groups/{param}/task-stats` | groups.ts:830 |
| GET | `/api/v2/groups/{param}/tasks` | groups.ts:826 |
| POST | `/api/v2/groups/{param}/tasks` | groups.ts:850, groups.ts:855 |
| GET | `/api/v2/groups/{param}/wiki` | groups.ts:779 |
| POST | `/api/v2/groups/{param}/wiki` | groups.ts:792, groups.ts:797 |
| DELETE | `/api/v2/groups/{param}/wiki/{param}` | groups.ts:809 |
| GET | `/api/v2/groups/{param}/wiki/{param}` | groups.ts:783 |
| PUT | `/api/v2/groups/{param}/wiki/{param}` | groups.ts:805 |
| GET | `/api/v2/groups/{param}/wiki/{param}/revisions` | groups.ts:813 |
| GET | `/api/v2/groups/invite/{param}` | groups.ts:982 |
| POST | `/api/v2/groups/invite/{param}/accept` | groups.ts:987 |
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
| GET | `/api/v2/listings` | exchanges.ts:176 |
| POST | `/api/v2/listings` | exchanges.ts:193, exchanges.ts:194 |
| DELETE | `/api/v2/listings/{param}` | exchanges.ts:333 |
| GET | `/api/v2/listings/{param}` | exchanges.ts:184 |
| PUT | `/api/v2/listings/{param}` | exchanges.ts:267 |
| DELETE | `/api/v2/listings/{param}/image` | exchanges.ts:328 |
| POST | `/api/v2/listings/{param}/image` | exchanges.ts:317 |
| POST | `/api/v2/listings/{param}/renew` | exchanges.ts:229 |
| POST | `/api/v2/listings/{param}/report` | exchanges.ts:255 |
| DELETE | `/api/v2/listings/{param}/save` | exchanges.ts:225 |
| POST | `/api/v2/listings/{param}/save` | exchanges.ts:221 |
| PUT | `/api/v2/listings/{param}/tags` | exchanges.ts:202 |
| POST | `/api/v2/listings/generate-description` | exchanges.ts:259 |
| GET | `/api/v2/marketplace/categories` | marketplace.ts:592 |
| GET | `/api/v2/marketplace/categories/{param}/template` | marketplace.ts:596 |
| GET | `/api/v2/marketplace/collections` | marketplace.ts:1024 |
| POST | `/api/v2/marketplace/collections` | marketplace.ts:1032 |
| DELETE | `/api/v2/marketplace/collections/{param}` | marketplace.ts:1036 |
| GET | `/api/v2/marketplace/collections/{param}/items` | marketplace.ts:1047 |
| POST | `/api/v2/marketplace/collections/{param}/items` | marketplace.ts:1051 |
| DELETE | `/api/v2/marketplace/collections/{param}/items/{param}` | marketplace.ts:1058 |
| GET | `/api/v2/marketplace/groups/{param}/listings` | marketplace.ts:998 |
| GET | `/api/v2/marketplace/groups/{param}/stats` | marketplace.ts:1002 |
| GET | `/api/v2/marketplace/listings` | marketplace.ts:562 |
| POST | `/api/v2/marketplace/listings` | marketplace.ts:614, marketplace.ts:616 |
| DELETE | `/api/v2/marketplace/listings/{param}` | marketplace.ts:653 |
| PUT | `/api/v2/marketplace/listings/{param}` | marketplace.ts:641 |
| POST | `/api/v2/marketplace/listings/{param}/images` | marketplace.ts:679 |
| DELETE | `/api/v2/marketplace/listings/{param}/images/{param}` | marketplace.ts:683 |
| POST | `/api/v2/marketplace/listings/{param}/offers` | marketplace.ts:708 |
| POST | `/api/v2/marketplace/listings/{param}/promote` | marketplace.ts:1070 |
| POST | `/api/v2/marketplace/listings/{param}/renew` | marketplace.ts:672 |
| POST | `/api/v2/marketplace/listings/{param}/report` | marketplace.ts:664 |
| DELETE | `/api/v2/marketplace/listings/{param}/save` | marketplace.ts:668 |
| POST | `/api/v2/marketplace/listings/{param}/save` | marketplace.ts:657 |
| DELETE | `/api/v2/marketplace/listings/{param}/video` | marketplace.ts:693 |
| POST | `/api/v2/marketplace/listings/{param}/video` | marketplace.ts:689 |
| GET | `/api/v2/marketplace/listings/featured` | marketplace.ts:580 |
| GET | `/api/v2/marketplace/listings/free` | marketplace.ts:588 |
| POST | `/api/v2/marketplace/listings/generate-description` | marketplace.ts:649 |
| GET | `/api/v2/marketplace/listings/nearby` | marketplace.ts:576 |
| GET | `/api/v2/marketplace/me/pickups` | marketplace.ts:1151 |
| GET | `/api/v2/marketplace/my-offers/{param}` | marketplace.ts:718 |
| DELETE | `/api/v2/marketplace/offers/{param}` | marketplace.ts:741 |
| PUT | `/api/v2/marketplace/offers/{param}/accept` | marketplace.ts:722 |
| PUT | `/api/v2/marketplace/offers/{param}/accept-counter` | marketplace.ts:733 |
| PUT | `/api/v2/marketplace/offers/{param}/counter` | marketplace.ts:729 |
| PUT | `/api/v2/marketplace/offers/{param}/decline` | marketplace.ts:737 |
| POST | `/api/v2/marketplace/orders` | marketplace.ts:839 |
| GET | `/api/v2/marketplace/orders/{param}` | marketplace.ts:753, marketplace.ts:758 |
| PUT | `/api/v2/marketplace/orders/{param}/cancel` | marketplace.ts:773 |
| PUT | `/api/v2/marketplace/orders/{param}/confirm-delivery` | marketplace.ts:769 |
| GET | `/api/v2/marketplace/orders/{param}/delivery-offers` | marketplace.ts:795 |
| POST | `/api/v2/marketplace/orders/{param}/delivery-offers` | marketplace.ts:811 |
| PUT | `/api/v2/marketplace/orders/{param}/delivery-offers/{param}/accept` | marketplace.ts:818 |
| PUT | `/api/v2/marketplace/orders/{param}/delivery-offers/{param}/confirm` | marketplace.ts:825 |
| POST | `/api/v2/marketplace/orders/{param}/dispute` | marketplace.ts:787 |
| POST | `/api/v2/marketplace/orders/{param}/pickup-reservation` | marketplace.ts:884 |
| POST | `/api/v2/marketplace/orders/{param}/rate` | marketplace.ts:780 |
| GET | `/api/v2/marketplace/orders/{param}/ratings` | marketplace.ts:791 |
| PUT | `/api/v2/marketplace/orders/{param}/ship` | marketplace.ts:765 |
| POST | `/api/v2/marketplace/orders/checkout-outcome` | marketplace.ts:852 |
| GET | `/api/v2/marketplace/orders/deliveries` | marketplace.ts:804 |
| POST | `/api/v2/marketplace/payments/confirm` | marketplace.ts:862 |
| POST | `/api/v2/marketplace/payments/create-intent` | marketplace.ts:843 |
| GET | `/api/v2/marketplace/promotions/mine` | marketplace.ts:1066 |
| GET | `/api/v2/marketplace/promotions/products` | marketplace.ts:1062 |
| GET | `/api/v2/marketplace/saved-searches` | marketplace.ts:1006 |
| POST | `/api/v2/marketplace/saved-searches` | marketplace.ts:1016 |
| DELETE | `/api/v2/marketplace/saved-searches/{param}` | marketplace.ts:1020 |
| GET | `/api/v2/marketplace/seller/balance` | marketplace.ts:943 |
| GET | `/api/v2/marketplace/seller/coupons` | marketplace.ts:1159 |
| POST | `/api/v2/marketplace/seller/coupons` | marketplace.ts:1176 |
| DELETE | `/api/v2/marketplace/seller/coupons/{param}` | marketplace.ts:1200 |
| PUT | `/api/v2/marketplace/seller/coupons/{param}` | marketplace.ts:1196 |
| GET | `/api/v2/marketplace/seller/coupons/{param}/redemptions` | marketplace.ts:1204 |
| GET | `/api/v2/marketplace/seller/dashboard` | marketplace.ts:973 |
| POST | `/api/v2/marketplace/seller/onboard` | marketplace.ts:954 |
| GET | `/api/v2/marketplace/seller/onboard/status` | marketplace.ts:939 |
| GET | `/api/v2/marketplace/seller/payouts` | marketplace.ts:950 |
| POST | `/api/v2/marketplace/seller/pickup-scan` | marketplace.ts:1155 |
| GET | `/api/v2/marketplace/seller/pickup-slots` | marketplace.ts:1076 |
| POST | `/api/v2/marketplace/seller/pickup-slots` | marketplace.ts:1129 |
| DELETE | `/api/v2/marketplace/seller/pickup-slots/{param}` | marketplace.ts:1147 |
| PUT | `/api/v2/marketplace/seller/pickup-slots/{param}` | marketplace.ts:1143 |
| GET | `/api/v2/marketplace/seller/shipping-options` | marketplace.ts:1080 |
| POST | `/api/v2/marketplace/seller/shipping-options` | marketplace.ts:1099 |
| DELETE | `/api/v2/marketplace/seller/shipping-options/{param}` | marketplace.ts:1118 |
| PUT | `/api/v2/marketplace/seller/shipping-options/{param}` | marketplace.ts:1114 |
| GET | `/api/v2/marketplace/sellers/{param}` | marketplace.ts:958 |
| GET | `/api/v2/marketplace/sellers/{param}/listings` | marketplace.ts:969 |
| GET | `/api/v2/marketplace/sellers/{param}/shipping-options` | marketplace.ts:1086 |
| POST | `/api/v2/matches/{param}/dismiss` | matches.ts:240 |
| GET | `/api/v2/matches/all` | matches.ts:222 |
| GET | `/api/v2/me/collections` | savedCollections.ts:55 |
| POST | `/api/v2/me/collections` | savedCollections.ts:63 |
| GET | `/api/v2/me/collections/{param}/items` | savedCollections.ts:67 |
| GET | `/api/v2/me/courses` | courses.ts:263 |
| GET | `/api/v2/me/data-export/history` | settings.ts:87 |
| DELETE | `/api/v2/me/saved-items/{param}` | savedCollections.ts:74 |
| DELETE | `/api/v2/members/{param}/endorse` | endorsements.ts:232 |
| POST | `/api/v2/members/{param}/endorse` | endorsements.ts:214 |
| GET | `/api/v2/members/{param}/endorsements` | endorsements.ts:169 |
| POST | `/api/v2/merchant-onboarding/complete` | marketplace.ts:935 |
| GET | `/api/v2/merchant-onboarding/status` | marketplace.ts:907 |
| POST | `/api/v2/merchant-onboarding/step-1` | marketplace.ts:917 |
| POST | `/api/v2/merchant-onboarding/step-2` | marketplace.ts:924 |
| POST | `/api/v2/merchant-onboarding/step-3` | marketplace.ts:931 |
| GET | `/api/v2/messages` | messages.ts:145 |
| POST | `/api/v2/messages` | messages.ts:225, messages.ts:226 |
| DELETE | `/api/v2/messages/{param}` | messages.ts:214 |
| GET | `/api/v2/messages/{param}` | messages.ts:152 |
| PUT | `/api/v2/messages/{param}` | messages.ts:210 |
| POST | `/api/v2/messages/{param}/reactions` | messages.ts:206 |
| PUT | `/api/v2/messages/{param}/read` | messages.ts:198 |
| DELETE | `/api/v2/messages/conversations/{param}` | messages.ts:178 |
| POST | `/api/v2/messages/conversations/{param}/restore` | messages.ts:182 |
| GET | `/api/v2/messages/restriction-status` | messages.ts:202 |
| GET | `/api/v2/messages/unread-count` | messages.ts:194 |
| POST | `/api/v2/messages/voice` | messages.ts:311, messages.ts:312 |
| DELETE | `/api/v2/notifications/{param}` | notifications.ts:119 |
| POST | `/api/v2/notifications/{param}/read` | notifications.ts:105 |
| GET | `/api/v2/notifications/counts` | notifications.ts:100 |
| POST | `/api/v2/notifications/group/read` | notifications.ts:114 |
| GET | `/api/v2/notifications/grouped` | notifications.ts:95 |
| POST | `/api/v2/notifications/read-all` | notifications.ts:110 |
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
| GET | `/api/v2/polls` | events.ts:1262 |
| POST | `/api/v2/polls` | polls.ts:49, polls.ts:50 |
| POST | `/api/v2/polls/{param}/rank` | polls.ts:54 |
| GET | `/api/v2/polls/{param}/ranked-results` | polls.ts:60 |
| POST | `/api/v2/polls/{param}/vote` | events.ts:1270 |
| GET | `/api/v2/public-page-content/{param}` | staticPages.ts:77 |
| POST | `/api/v2/reactions` | feed.ts:335 |
| GET | `/api/v2/reactions/{param}/{param}/users/{param}` | feed.ts:360 |
| GET | `/api/v2/resources` | resources.ts:96 |
| GET | `/api/v2/resources/categories` | resources.ts:101 |
| POST | `/api/v2/reviews` | reviews.ts:127 |
| DELETE | `/api/v2/reviews/{param}` | reviews.ts:131 |
| GET | `/api/v2/reviews/given` | reviews.ts:103 |
| GET | `/api/v2/reviews/pending` | reviews.ts:116 |
| GET | `/api/v2/reviews/user/{param}` | members.ts:91, reviews.ts:74 |
| GET | `/api/v2/search` | search.ts:50 |
| GET | `/api/v2/search/saved` | search.ts:63 |
| POST | `/api/v2/search/saved` | search.ts:71 |
| DELETE | `/api/v2/search/saved/{param}` | search.ts:78 |
| POST | `/api/v2/search/saved/{param}/run` | search.ts:82 |
| GET | `/api/v2/skills/categories` | endorsements.ts:272 |
| GET | `/api/v2/skills/categories/{param}` | endorsements.ts:276 |
| GET | `/api/v2/skills/members` | endorsements.ts:280 |
| GET | `/api/v2/skills/search` | endorsements.ts:267 |
| DELETE | `/api/v2/team-tasks/{param}` | groups.ts:866 |
| GET | `/api/v2/team-tasks/{param}` | groups.ts:834 |
| PUT | `/api/v2/team-tasks/{param}` | groups.ts:862 |
| GET | `/api/v2/tenant/bootstrap` | tenant.ts:84, tenant.ts:104 |
| GET | `/api/v2/tenants` | tenant.ts:119 |
| GET | `/api/v2/users` | client.ts:783, eventPeople.ts:92, members.ts:76 |
| GET | `/api/v2/users/{param}` | members.ts:81 |
| GET | `/api/v2/users/{param}/appreciations` | appreciations.ts:46 |
| DELETE | `/api/v2/users/{param}/block` | settings.ts:148 |
| POST | `/api/v2/users/{param}/block` | settings.ts:144 |
| GET | `/api/v2/users/{param}/listings` | members.ts:86 |
| GET | `/api/v2/users/{param}/public-collections` | savedCollections.ts:59 |
| GET | `/api/v2/users/blocked` | settings.ts:132 |
| DELETE | `/api/v2/users/me` | settings.ts:128 |
| GET | `/api/v2/users/me` | auth.ts:294 |
| PUT | `/api/v2/users/me` | profile.ts:25 |
| GET | `/api/v2/users/me/activity/dashboard` | activity.ts:72 |
| POST | `/api/v2/users/me/avatar` | profile.ts:95 |
| GET | `/api/v2/users/me/match-preferences` | matches.ts:244 |
| PUT | `/api/v2/users/me/match-preferences` | matches.ts:251 |
| GET | `/api/v2/users/me/parent-accounts` | settings.ts:166 |
| PUT | `/api/v2/users/me/parent-accounts/{param}/permissions` | settings.ts:207 |
| POST | `/api/v2/users/me/password` | profile.ts:38 |
| GET | `/api/v2/users/me/preferences` | settings.ts:152 |
| PUT | `/api/v2/users/me/preferences` | settings.ts:157 |
| GET | `/api/v2/users/me/skills` | endorsements.ts:188 |
| POST | `/api/v2/users/me/skills` | endorsements.ts:242 |
| DELETE | `/api/v2/users/me/skills/{param}` | endorsements.ts:255 |
| GET | `/api/v2/users/me/sub-accounts` | settings.ts:161 |
| POST | `/api/v2/users/me/sub-accounts` | settings.ts:171 |
| DELETE | `/api/v2/users/me/sub-accounts/{param}` | settings.ts:238 |
| GET | `/api/v2/users/me/sub-accounts/{param}/activity` | settings.ts:279 |
| PUT | `/api/v2/users/me/sub-accounts/{param}/approve` | settings.ts:175 |
| PUT | `/api/v2/users/me/sub-accounts/{param}/permissions` | settings.ts:182, settings.ts:198 |
| GET | `/api/v2/volunteering/applications` | volunteering.ts:471 |
| DELETE | `/api/v2/volunteering/applications/{param}` | volunteering.ts:507 |
| PUT | `/api/v2/volunteering/applications/{param}` | volunteering.ts:496 |
| GET | `/api/v2/volunteering/certificates` | volunteering.ts:601 |
| POST | `/api/v2/volunteering/certificates` | volunteering.ts:605 |
| POST | `/api/v2/volunteering/checkin/checkout/{param}` | volunteering.ts:738 |
| POST | `/api/v2/volunteering/checkin/verify/{param}` | volunteering.ts:733 |
| GET | `/api/v2/volunteering/donations` | volunteering.ts:632 |
| POST | `/api/v2/volunteering/donations` | volunteering.ts:679 |
| GET | `/api/v2/volunteering/expenses` | volunteering.ts:613 |
| POST | `/api/v2/volunteering/expenses` | volunteering.ts:620 |
| GET | `/api/v2/volunteering/giving-days` | volunteering.ts:628 |
| POST | `/api/v2/volunteering/hours` | volunteering.ts:704 |
| PUT | `/api/v2/volunteering/hours/{param}/verify` | volunteering.ts:503 |
| GET | `/api/v2/volunteering/hours/summary` | volunteering.ts:511 |
| GET | `/api/v2/volunteering/my-organisations` | volunteering.ts:515 |
| GET | `/api/v2/volunteering/opportunities` | volunteering.ts:454 |
| POST | `/api/v2/volunteering/opportunities` | volunteering.ts:687 |
| GET | `/api/v2/volunteering/opportunities/{param}` | volunteering.ts:464 |
| PUT | `/api/v2/volunteering/opportunities/{param}` | volunteering.ts:695 |
| GET | `/api/v2/volunteering/opportunities/{param}/applications` | volunteering.ts:482 |
| POST | `/api/v2/volunteering/opportunities/{param}/apply` | volunteering.ts:712 |
| GET | `/api/v2/volunteering/opportunities/{param}/shifts` | volunteering.ts:646 |
| GET | `/api/v2/volunteering/organisations` | organisations.ts:59 |
| POST | `/api/v2/volunteering/organisations` | organisations.ts:77, organisations.ts:81 |
| GET | `/api/v2/volunteering/organisations/{param}` | organisations.ts:69, volunteering.ts:522 |
| PUT | `/api/v2/volunteering/organisations/{param}` | volunteering.ts:590 |
| GET | `/api/v2/volunteering/organisations/{param}/applications` | volunteering.ts:533 |
| GET | `/api/v2/volunteering/organisations/{param}/hours/pending` | volunteering.ts:540 |
| GET | `/api/v2/volunteering/organisations/{param}/stats` | volunteering.ts:526 |
| GET | `/api/v2/volunteering/organisations/{param}/volunteers` | volunteering.ts:546 |
| POST | `/api/v2/volunteering/organisations/{param}/wallet/deposit` | volunteering.ts:573 |
| GET | `/api/v2/volunteering/organisations/{param}/wallet/transactions` | volunteering.ts:552 |
| GET | `/api/v2/volunteering/shifts` | volunteering.ts:594 |
| DELETE | `/api/v2/volunteering/shifts/{param}/signup` | volunteering.ts:723 |
| POST | `/api/v2/volunteering/shifts/{param}/signup` | volunteering.ts:716 |
| GET | `/api/v2/volunteering/swaps` | volunteering.ts:639 |
| POST | `/api/v2/volunteering/swaps` | volunteering.ts:663 |
| DELETE | `/api/v2/volunteering/swaps/{param}` | volunteering.ts:675 |
| PUT | `/api/v2/volunteering/swaps/{param}` | volunteering.ts:671 |
| GET | `/api/v2/wallet/balance` | wallet.ts:184 |
| GET | `/api/v2/wallet/community-fund` | wallet.ts:220 |
| POST | `/api/v2/wallet/donate` | wallet.ts:259 |
| POST | `/api/v2/wallet/operation-status` | wallet.ts:251 |
| GET | `/api/v2/wallet/transactions` | wallet.ts:212 |
| GET | `/api/v2/wallet/transactions/{param}` | wallet.ts:197 |
| POST | `/api/v2/wallet/transfer` | wallet.ts:244 |
| GET | `/api/v2/wallet/user-search` | wallet.ts:228 |
