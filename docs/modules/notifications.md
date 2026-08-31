# Notifications & Email Module Guide

Last reviewed: 2026-08-31

This guide is a how-to/reference for maintainers of the notifications and email subsystem in Project NEXUS. It covers the three delivery channels (in-app bell, email, push/FCM), the recipient-locale invariant that every notification path must honour, the dispatcher flow, the queue, tenant scoping, the frontend inbox, and the regression tests that protect this surface.

## Audience & supported workflows

Use this guide when:

- adding a new notification type or email template;
- changing how existing notifications are dispatched (frequency, deduplication, channel routing);
- debugging a missing or duplicated notification;
- adding a new event listener that sends notifications.

Supported notification workflows:

- **In-app bell** — a row written to `notifications` that the React and accessible frontend inbox reads.
- **Email digest** — a row queued in `notification_queue` at the member's chosen frequency (instant / daily / monthly / off), flushed by a scheduled job.
- **Web push (VAPID)** — sent via `WebPushService` to `push_subscriptions` rows for browser subscribers.
- **Native mobile push (Expo/FCM/APNs)** — Laravel sends the Expo token through
  `FCMPushService`; Expo delivers through FCM on Android and APNs on iOS. The distinct
  React Native client is in `mobile/`. The Capacitor-aware React hook is a separate path.
- **Muted-user suppression** — if the acting user is in the recipient's `user_muted_users` list, all channels are suppressed for that sender/recipient pair.

---

## Tenant & feature-gate rules

- **Tenant scope is mandatory.** `notifications`, `notification_queue`, and
  `push_subscriptions` carry `tenant_id`; the `Notification` model also
  uses `HasTenantScope`. `notification_settings` intentionally has no
  `tenant_id`: its global user/context key is safe only after the caller proves
  ownership through the authenticated tenant-scoped `users` row.
- The `markAllRead()` method in `NotificationService` also adds an explicit `AND tenant_id = ?` filter as defence in depth.
- There is no feature-gate that globally disables notifications; specific channels (email, push) can be toggled per-user through notification preferences (`users.notification_preferences`).
- Push requires a configured VAPID key (`config('services.vapid.public_key')`). When it is missing, `WebPushService` returns false silently.

---

## Channels and the dispatch flow

### Step-by-step: `NotificationDispatcher::dispatch()`

The primary entry point for standard (discussion / topic / reply / mention) notifications is `App\Services\NotificationDispatcher::dispatch()`. For social interactions (`NotifyTransactionCompleted`, `NotifyMessageReceived`, `NotifyConnectionRequest`, and similar listeners), the listener calls `NotificationDispatcher::send()`, `fanOutPush()`, or the specialised `dispatch*` methods directly.

`dispatch()` flow:

1. **Resolve tenant.** Calls `TenantContext::runForTenant()` using the recipient's `users.tenant_id`, so the block is always executed in the correct tenant context regardless of which worker or HTTP request triggered it.
2. **Mute check.** If `$fromUserId` is supplied and that user appears in `user_muted_users` for the recipient, the entire dispatch is silently skipped (returns `true`).
3. **In-app bell (deduplication).** Writes a row via `Notification::createNotification()`. A 60-second Cache key `notif_dedup:{tenant}:{user}:{type}:{md5(link)}` suppresses duplicate bells within the window.
4. **Frequency resolution.** Calls `getFrequencySetting()` which walks the hierarchy: thread → group → global. If nothing is set, the tenant-level default in `configuration.notifications.default_frequency` applies; if that is also unset, the frequency defaults to `'off'`. Seven critical types are forced to `'instant'`: `new_message`, `connection_request`, `connection_accepted`, `vol_application_approved`, `vol_application_declined`, `vol_hours_approved`, and the time-sensitive `vol_waitlist_spot`.
5. **Device push fan-out.** Immediately after a fresh bell is written, `fanOutPush()` fires (independent of email frequency). Push has its own 60-second dedup key per `(user, type, md5(link))`. The send is dispatched `afterResponse()` for HTTP callers. Web push and FCM are attempted sequentially inside that closure and are failure-isolated, so one provider cannot suppress the other. Results are recorded to `push_log`.
6. **Email queue insert.** For `instant`, queues an immediate email in `notification_queue`. For `daily` / `monthly`, queues for the batch digest run. For `off`, nothing is enqueued.
7. **Rollback on queue failure.** If the `notification_queue` insert fails,
   only the fresh, non-duplicate bell created by this dispatch is deleted;
   `dispatch()` returns `false`.

### Dispatch flow diagram (simplified)

```
Event fires
  └─ Listener (often ShouldQueue; some listeners run inline)
       └─ LocaleContext::withLocale($recipient, fn())
            ├─ Notification::createNotification()   → notifications table (bell)
            ├─ NotificationDispatcher::fanOutPush() → WebPushService + FCMPushService
            └─ NotificationDispatcher::dispatch()   → notification_queue (email)
                                                      (or specialist dispatch* methods)
```

### Social and system notifications

`SocialNotificationService` handles likes, comments, comment replies, and shares. Each method fetches the content owner and wraps bell + email rendering in `LocaleContext::withLocale()` before calling `Notification::createNotification()` and `fanOutPush()`.

`NotificationDispatcher::notifyAdmins()` and `notifyModerationAdmins()` fan out to every `role IN (admin, broker, coordinator)` member in the current tenant, with each admin's bell and email rendered inside their own `LocaleContext::withLocale()` closure.

### Native payload and destination contract

Ordinary native pushes pass through `NotificationDispatcher::fanOutPush()` and
`FCMPushService`. `RealtimeService::broadcastAndPush()` is retained for compatibility but also
delegates to that canonical fan-out; jobs that already fan out use `broadcastOnly()` to avoid a
second lock-screen alert.

The ordinary on-device data payload is string-only and versioned:

```json
{"schema_version":"1","type":"new_message","link":"/messages/123"}
```

- `link` is a validated member-facing internal route. Credentials, sensitive reset/support
  links, staff/browser-only routes, unsupported routes and unsafe external URLs become
  `/notifications` or are suppressed when even that alert would be misleading.
- Lock-screen copy is deliberately privacy-limited. The body is generic and the title is a
  translated category or an explicitly curated safe title rendered in the recipient's locale.
  Producer-supplied arbitrary fields never leave the server.
- The Expo client sends foreground, background and terminated-app responses through
  `mobile/app/+native-intent.ts`, waits for authentication, checks the current tenant's enabled
  modules, and falls back to its notification centre. Missing poll/resource entities render a
  recoverable not-found state rather than a broken screen.
- Native has no exact story viewer, so story device pushes are suppressed until one exists.
  Group chat and non-emergency Caring Community activity are also kept out of native push until
  exact viewers exist. Ordinary Android alerts use the translated `default` channel at default
  importance; a Caring emergency retains its safe notification-centre route, selects the
  translated maximum-importance `emergency` channel and requests high-priority FCM/APNs delivery.
- Exact marketplace order links first fetch the protected order, resolve whether the signed-in
  member is the buyer or seller, then open and highlight that order in Purchases or Sales. The
  direct fetch prevents an older referenced order disappearing behind the first paginated result.
- Paid campaigns are the only external-navigation exception. They retain separately reviewed
  copy and a credential-free HTTPS CTA. Their numeric campaign id is queued until authentication
  resolves, then the first tap is recorded through the tenant-scoped
  `POST /v2/me/push-campaigns/{id}/open` endpoint. A failed signed-out attempt can be retried.

The exhaustive producer ledger is generated by
`mobile/scripts/audit-native-push-producers.php` into
`mobile/config/native-push-producer-inventory.json`. It currently contains 239 direct and
indirect call sites. `mobile/config/native-push-dynamic-route-review.json` records the route
families that cannot be resolved statically, including their exact expected native href where one
exists. Cross-stack tests fail when a producer or dispatcher entry point appears without
classification or when the canonical mapper no longer produces that exact href.

---

## The recipient-locale rule (critical invariant)

**Every user-facing string in every notification — bell text, email subject, email body, push title — must render in the recipient's `preferred_language`, not the sender's locale, not the queue worker's default, and not `config('app.locale')`.**

`App\I18n\LocaleContext::withLocale()` is the enforced mechanism. It temporarily switches `App::getLocale()` for the duration of a callable and restores the prior locale in a `finally` block, so exceptions cannot leak the switched locale. Nested invocations are safe — each level saves and restores its own snapshot.

**What `withLocale` accepts:**

| Input type | Behaviour |
| --- | --- |
| `string` | Used directly as locale code (`'en'`, `'ga'`, …). Empty string → no switch. |
| Object with `->preferred_language` | Reads the property as a locale string. |
| `null` | No-op — callable runs in the current locale. |

### Before/after pattern

Before (leaks caller or worker locale):

```php
foreach ($admins as $admin) {
    $subject = __('emails.report.subject');   // resolves in the worker's default locale
    $mailer->send($admin->email, $subject, $body);
}
```

After (each admin receives in their own `preferred_language`):

```php
use App\I18n\LocaleContext;

foreach ($admins as $admin) {
    LocaleContext::withLocale($admin, function () use ($admin, $mailer, $body) {
        $subject = __('emails.report.subject');
        $mailer->send($admin->email, $subject, $body);
    });
}
```

**Queue workers** (listeners implementing `ShouldQueue`) boot once with the
application default locale and reuse the process. Every queued listener must
load or carry the recipient's `preferred_language` and wrap rendering and send
work in `withLocale()`; do not rely on a fixed list of listeners.

**Admin fanouts** (e.g. `notifyAdmins()`, `notifyModerationAdmins()`) wrap the send *inside* the per-recipient loop so each recipient's subject and body render in their language:

```php
foreach ($admins as $admin) {
    LocaleContext::withLocale($admin, function () use ($admin, ...) {
        // bell, push, and email all render here
    });
}
```

---

## Key code & data locations

Routes are defined in [`routes/api.php`](../../routes/api.php). Do not maintain a duplicate endpoint table here — read the route file directly for the live list.

| Concern | Route prefix | Controller |
| --- | --- | --- |
| Notification inbox (list, grouped, counts, mark read, delete) | `/v2/notifications/*` | `App\Http\Controllers\Api\NotificationsController` |
| Per-user notification preferences | `GET/PUT /v2/users/me/notifications` | `App\Http\Controllers\Api\UsersController` |
| Atomic Settings form save | `PUT /v2/users/me/notification-settings` | `App\Http\Controllers\Api\NotificationSettingsController` |
| Per-context digest frequency settings | `GET/POST /v2/notifications/settings` | `App\Http\Controllers\Api\UsersController` |
| Email one-click unsubscribe | `GET/POST /v2/notifications/unsubscribe` | `App\Http\Controllers\Api\NotificationUnsubscribeController` |
| Web push: subscribe / unsubscribe / status | `POST /push/subscribe`, `POST /push/unsubscribe`, `GET /push/status` | `App\Http\Controllers\Api\PushController` |
| VAPID public key | `GET /push/vapid-key` | `App\Http\Controllers\Api\PushController` |

Services:

| Service | File | Responsibility |
| --- | --- | --- |
| `NotificationService` | `app/Services/NotificationService.php` | In-app inbox reads: paginated list with cursor, grouped list, unread counts, mark-read, mark-group-read, delete. All queries are tenant-scoped via `HasTenantScope`. |
| `NotificationDispatcher` | `app/Services/NotificationDispatcher.php` | Central dispatcher: bell creation, frequency resolution, email queue insert, push fan-out, hot/mutual match emails, exchange/broker notification helpers. |
| `NotificationSettingsService` | `app/Services/NotificationSettingsService.php` | Atomically updates user JSON preferences, federation notifications, tenant-scoped match preferences, and global user/context digest settings after locking the tenant-owned user row. |
| `SocialNotificationService` | `app/Services/SocialNotificationService.php` | Likes, comments, comment replies, shares — writes bell + sends email under recipient's locale. |
| `PushNotificationService` | `app/Services/PushNotificationService.php` | Manages `push_subscriptions` rows (subscribe / unsubscribe / count). Delegates sending to `WebPushService`. |
| `WebPushService` | `app/Services/WebPushService.php` | VAPID browser push; called by `fanOutPush()`. |
| `FCMPushService` | `app/Services/FCMPushService.php` | Canonical native payload/privacy guard and Expo token sender for the React Native app; called by `fanOutPush()`. |
| `EmailDispatchService` | `app/Services/EmailDispatchService.php` | Low-level send wrapper over `App\Core\Mailer` (SMTP, Gmail API, or Postmark). All notification email sends go through `EmailDispatchService::sendRaw()`. SendGrid is retired — a legacy `sendgrid` tenant setting deliberately has no case and falls through to the platform provider. |

Models:

| Model | Table | Notes |
| --- | --- | --- |
| `App\Models\Notification` | `notifications` | Bell rows. Has `HasTenantScope` (global scope). `SoftDeletes`. Appends `read_at`, `body`, `title` for frontend compatibility — the underlying columns are `is_read` (bool), `message` (string). |
| `App\Models\PushLog` | `push_log` | Delivery observability record per fan-out. Records web push outcome, FCM sent/failed counts, errors. Best-effort; never affects delivery. |

Database tables (do not query directly from new code — use the services and models above):

| Table | Purpose |
| --- | --- |
| `notifications` | In-app bell rows per tenant per user. |
| `notification_queue` | Pending email digest rows. Columns: `user_id`, `tenant_id`, `activity_type`, `content_snippet`, `link`, `frequency`, `email_body`, `status`. |
| `notification_settings` | Per-user per-context frequency preferences (context_type: `global`, `group`, `thread`; frequency: `instant`, `daily`, `monthly`, `off`). It has no `tenant_id`; access must first establish the globally unique user's tenant ownership. |
| `push_subscriptions` | Browser VAPID and mobile (FCM) push endpoint rows, keyed on `(user_id, endpoint)`. Tenant-scoped. |
| `push_log` | Delivery observability for push fan-outs (one row per fan-out call). |
| `transaction_notification_deliveries` | Idempotency ledger for `NotifyTransactionCompleted` — records delivery status per `(transaction_id, user_id, event, channel)` to prevent duplicate emails on queue re-delivery. |
| `user_muted_users` | Muted-sender list. `dispatch()` skips all channels when the acting user appears here for the recipient. |

Listeners (most implement `ShouldQueue`; `SendWelcomeNotification` and
`NotifyAdminOfNewRegistration` currently run inline):

| Listener | Event | What it sends |
| --- | --- | --- |
| `NotifyTransactionCompleted` | `TransactionCompleted` | Bell + email to receiver (credit received); confirmation email to sender (credit sent); review-request email to both parties. Idempotency via `transaction_notification_deliveries`. |
| `NotifyMessageReceived` | `MessageSent` | Bell + email to message recipient. Idempotency via Cache. |
| `NotifyConnectionRequest` | `ConnectionRequested` | Bell + email to connection target. Idempotency via Cache. |
| `NotifyConnectionAccepted` | `ConnectionAccepted` | Bell + email to original requester. |
| `NotifySafeguardingStaff` | `SafeguardingFlaggedEvent` | Bell to all safeguarding-role users. |
| `NotifyAdminOfNewRegistration` | `UserRegistered` | Bell to admins on new registration. |
| `NotifyAdminOfNewListing` | `ListingCreated` | Bell to admins on new listing. |
| `NotifyAdminOfNewGroup` | `GroupCreated` | Bell to admins on new group. |
| `NotifyAdminOfNewCommunityEvent` | `CommunityEventCreated` | Bell to admins on new event. |
| `NotifyAdminOfNewVolunteerOpportunity` | `VolunteerOpportunityCreated` | Bell to admins on new opportunity. |
| `SendWelcomeNotification` | `UserRegistered` | Welcome bell to new member. |
| `NotifyGroupChatroomMessage` | `GroupChatroomMessagePosted` | Bell to group chatroom participants. |
| `NotifyGroupMemberJoined` | `GroupMemberJoined` | Bell to group organisers. |
| `NotifyJobAlertSubscribers` | `JobVacancyCreated` | Email to users with matching job alert subscriptions. Dispatched by `JobVacancyService::create()` — not wired to `ListingCreated`. |

---

## Notification type categories

`NotificationService` groups types into named categories used for inbox filtering and unread counts. The canonical category map is in `NotificationService::TYPE_CATEGORIES`:

`messages`, `connections`, `reviews`, `transactions`, `social`, `events`, `groups`, `listings`, `jobs`, `safeguarding`, `system`, `security`, `ideation`.

Types that do not match any category are counted in `other`.

---

## Security & privacy invariants

- **Tenant isolation.** `Notification::query()` carries the `HasTenantScope` global scope. `markAllRead()` adds a redundant explicit `AND tenant_id = ?` filter. Never call raw `DB::table('notifications')` without a `tenant_id` filter.
- **Mute suppression.** `dispatch()` checks `user_muted_users` before creating a bell or queuing an email. System-generated notifications (no `$fromUserId`) are never suppressed.
- **Opt-out.** `email_transactions`, `email_messages`, and `email_reviews` preferences on `users.notification_preferences` are checked before sending the corresponding email type. The `/v2/notifications/unsubscribe` route supports one-click unsubscribe compliance (Gmail / Yahoo Feb-2024 bulk-sender rules).
- **Push subscription ownership.** `PushNotificationService::subscribe()` and `unsubscribe()` are keyed on `(user_id, endpoint)` and always write `tenant_id`. The VAPID public key is served unauthenticated (`GET /push/vapid-key`) but subscriptions require auth.
- **Bell field hiding.** `Notification::$hidden` excludes `tenant_id` from JSON serialization so it is never exposed to the client.
- **No hardcoded locale strings.** Every `__('emails.*')` or `__('notifications.*')` call must reference a key in the translation files under `lang/`. This is enforced by `scripts/check-i18n.sh`, which runs in CI (`.github/workflows/ci.yml`) — there is no local pre-push hook. Never inline English strings in notification or email code.

---

## Email template builder

All HTML emails are built with `App\Core\EmailTemplateBuilder`. Chain methods
produce consistent, brand-themed HTML, but several content blocks intentionally
accept trusted HTML. Escape every user-controlled value with
`htmlspecialchars()` before interpolating it into paragraph, list, highlight,
blockquote, or other HTML-bearing content; `paragraph()` is not the only
surface to review.

---

## Frontend entry points

| Surface | File |
| --- | --- |
| Full notification inbox page (React) | `react-frontend/src/pages/notifications/NotificationsPage.tsx` |
| Notification flyout / bell icon (React) | `react-frontend/src/components/layout/NotificationFlyout.tsx` |
| Notification preferences in Settings (React) | Via `GET/PUT /v2/users/me/notifications` (UsersController) |
| Per-context digest frequency (React) | Via `GET/POST /v2/notifications/settings` |
| FCM registration hook (Capacitor) | `react-frontend/src/hooks/usePushNotifications.ts` |
| Expo registration, response lifecycle and paid-tap queue (React Native) | `mobile/lib/notifications.ts` |
| Canonical native route mapper | `mobile/app/+native-intent.ts` |
| Tenant module guard for notification taps | `mobile/lib/navigation/tenantCapabilityStore.ts` |
| Global notification state + unread counts | `react-frontend/src/contexts/NotificationsContext.tsx` via `useNotifications()` |
| Real-time bell updates | `react-frontend/src/contexts/PusherContext.tsx` (Pusher WebSocket) |

The `NotificationsPage` uses the grouped endpoint (`GET /v2/notifications/grouped`) which collapses repeated `(type, link)` pairs into a single item with `group_count`, `actors`, and `remaining_count` for "Alice and 3 others liked your post" display.

---

## Test commands & regression tests

```bash
# PHP tests — run all notification-related tests
vendor/bin/phpunit --filter Notification --colors=always

# The canonical locale-contract regression test
vendor/bin/phpunit tests/Laravel/Feature/I18n/EmailLocaleIntegrationTest.php --colors=always

# Native producer inventory, payload/privacy and paid-campaign HTTP contract
php mobile/scripts/audit-native-push-producers.php --check
vendor/bin/phpunit tests/Laravel/Unit/Services/NativePushProducerInventoryTest.php \
  tests/Laravel/Unit/Services/FCMPushServiceTest.php \
  tests/Laravel/Feature/Controllers/PaidPushCampaignControllerTest.php --colors=always

# Expo lifecycle, route mapping, module fallback and exhaustive producer contract
npm --prefix mobile test -- --runInBand lib/notifications.test.ts \
  lib/utils/navigateToLink.test.ts lib/pushProducerContract.test.ts

# Transaction notification idempotency
vendor/bin/phpunit tests/Laravel/Unit/Listeners/NotifyTransactionCompletedTest.php --colors=always

# Full Laravel test suite (includes listeners)
vendor/bin/phpunit --testsuite=Laravel --colors=always

# i18n key baseline check (run after any lang/ change)
npm run check:i18n:baseline
```

### Key regression tests

| Test file | What it guards |
| --- | --- |
| `tests/Laravel/Feature/I18n/EmailLocaleIntegrationTest.php` | `LocaleContext::withLocale()` causes `__()` to resolve in the recipient's locale; restores outer locale after return and on exception; nested invocations each see their own locale. |
| `tests/Laravel/Unit/Listeners/NotifyTransactionCompletedTest.php` | Bell + email sent to receiver in receiver's locale; confirmation email sent to sender in sender's locale; idempotency guard prevents duplicate delivery on queue re-delivery. |
| `tests/Laravel/Unit/Services/NativePushProducerInventoryTest.php` | Every direct/indirect producer and internal dispatcher entry point stays in the generated ledger. |
| `tests/Laravel/Unit/Services/FCMPushServiceTest.php` | Versioned string-only data, recipient-locale titles, privacy fallbacks, native suppression and paid CTA rules. |
| `mobile/lib/pushProducerContract.test.ts` | Every statically resolvable producer route maps to an installed native screen; dynamic families are explicitly reviewed. |
| `mobile/lib/notifications.test.ts` | Foreground/background/killed response handling, hostile fallbacks and auth-deferred paid-tap analytics. |

---

## Failure modes & recovery

| Symptom | Likely cause | Recovery |
| --- | --- | --- |
| Notifications appear in English regardless of user language | `LocaleContext::withLocale()` missing or wrapping the wrong scope (subject line rendered before the wrap, or a queue job not wrapping `handle()`). | Grep for the email or bell key being rendered; verify it is inside a `withLocale()` closure that reads `preferred_language` from the recipient. |
| Duplicate emails sent | Queue re-delivered a job (listener `$tries > 1`, or `retry_after` lower than job execution time). | Check listener `$tries` and `$timeout`. For transaction emails, the `transaction_notification_deliveries` idempotency table prevents duplicates for that listener specifically. For message and connection notifications, Cache-based claim guards are in place. |
| Bell created but no email sent | Frequency is `'off'` (user's default or explicit setting). Check `notification_settings` and `users.notification_preferences`. Critical types force `'instant'` — only non-critical discussion types respect `'off'`. | Instruct the user to turn on their email digest in notification settings. |
| Browser push not delivered | VAPID key missing from `.env`, or `push_subscriptions` row expired / unregistered. | Check `push_log` for error details. Verify `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set. User may need to re-subscribe in Settings. |
| Native push not delivered | Expo token missing/expired, device permission denied, Expo/FCM/APNs credentials unavailable, or provider receipt rejected. | Check the Expo-token subscription and `push_log`, renew registration after login, then inspect provider receipts. Simulator/emulator deep-link tests do not prove provider delivery. |
| Native alert opens Notifications | Destination was invalid, sensitive, staff/browser-only, unsupported, stale, or disabled for the current tenant. | Check the generated producer ledger and dynamic review first. Add an exact native route only when the member-facing destination genuinely exists; keep fail-closed fallback otherwise. |
| Push double-fired | `fanOutPush()` called twice for the same event (e.g. `dispatch()` plus a direct call in the same path). | The 60-second Cache dedup key prevents double push for identical `(user, type, link)` within the window. If firing more than 60 seconds apart, the caller is responsible for suppressing the duplicate. |
| Email appears from wrong tenant | `TenantContext` not restored after an async job. All listeners call `TenantContext::restoreAfterScopedListener()` in `finally`. If a custom job forgets this, the worker's context leaks to subsequent jobs. | Add `restoreAfterScopedListener()` in the `finally` block of the listener's `handle()` method. |
| `notification_queue` rows stuck in `pending` | Digest cron job not running, or database connection failure during flush. | The queue is flushed by `App\Services\CronJobRunner` from the schedule registered in `bootstrap/app.php`. Verify the Laravel scheduler is running. Rows expire to `failed` after 7 days; sent/failed rows are cleaned after 30 days. |

---

## Related documentation

- [ARCHITECTURE.md](../ARCHITECTURE.md) — runtime boundaries and infrastructure topology.
- [MODULES.md](../MODULES.md) — module map and guide checklist.
- [`routes/api.php`](../../routes/api.php) — authoritative endpoint list (do not duplicate here).
- [`app/I18n/LocaleContext.php`](../../app/I18n/LocaleContext.php) — source of truth for the locale-switching contract.
- [`tests/Laravel/Feature/I18n/EmailLocaleIntegrationTest.php`](../../tests/Laravel/Feature/I18n/EmailLocaleIntegrationTest.php) — regression test for the locale contract.
