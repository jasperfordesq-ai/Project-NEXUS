# Messaging Module Guide

Last reviewed: 2026-07-30

This guide is a how-to/reference for maintainers of the direct-messaging surface in Project NEXUS. It covers conversations and threads, sending/editing/deleting messages, file and voice attachments, real-time delivery via Pusher, broker safeguarding visibility, federation cross-community messaging, tenant scoping, privacy invariants, failure modes, and regression tests.

## Audience and supported workflows

Use this guide when changing any part of the messaging stack: the send path, attachment handling, broker review, notification delivery, or federation messaging.

Supported workflows:

- **Direct messaging** — a 1-to-1 text, image/file, or voice conversation between two members on the same tenant.
- **Contextual messaging** — a message linked to a listing, event, job, volunteering opportunity, or group via `context_type` / `context_id`.
- **Voice messaging** — an audio recording uploaded by the sender, optionally auto-transcribed and translated.
- **Message translation** — on-demand translation of any message body or voice transcript to a target language (gated by the `message_translation` feature flag).
- **Broker safeguarding visibility** — automatic copy of qualifying messages to a broker review queue, with in-app and email alerts to broker-role users.
- **Federation messaging** — cross-community messages between members of different federated tenants (see [docs/FEDERATION_API_MANUAL.md](../FEDERATION_API_MANUAL.md)).

## Tenant and feature-gate rules

| Gate | Kind | Default | Effect when disabled |
| --- | --- | --- | --- |
| `messages` | Module (`tenants.configuration.modules`) | `true` | React redirects to `/`; `ConversationPage` returns early on `!hasModule('messages')`. |
| `direct_messaging` | Feature (`tenants.features`) | `true` | React hides the compose UI and shows a disabled state in `MessagesPage` and `ConversationPage`; controlled by `hasFeature('direct_messaging')`. The broker-side toggle is `BrokerControlConfigService::isDirectMessagingEnabled()` via the `messaging.direct_messaging_enabled` config key. |
| `message_translation` | Feature | (per tenant) | `POST /api/v2/messages/{id}/translate` returns `FEATURE_DISABLED` (HTTP 403). |

Every API route under `/v2/messages/*` is protected by the `auth` middleware (JWT). The send endpoint additionally requires `onboarding-required` middleware.

All queries are scoped by `tenant_id` from `App\Core\TenantContext::getId()` and the `HasTenantScope` Eloquent trait. There is no cross-tenant query path in the direct-messaging surface.

## Key code and data locations

Routes are defined in [`routes/api.php`](../../routes/api.php). Do not reproduce the full endpoint table here — read the route file or `docs/API.md` for the live list.

| Concern | Route prefix | Controller |
| --- | --- | --- |
| Conversations and direct messages | `/v2/messages/*` | `app/Http/Controllers/Api/MessagesController.php` |
| Voice upload/send | `/v2/messages/voice` | `MessagesController` (native Laravel `request()->file()`); `uploadVoice()` is an unrouted compatibility helper |
| Private attachment/voice delivery | `/v2/messages/{message}/attachments/{attachment}`, `/v2/messages/{message}/voice` | `app/Http/Controllers/Api/MessageMediaController.php` |
| Group conversations | `/v2/conversations/{id}/messages` | `app/Http/Controllers/Api/GroupConversationController.php` |
| Federation messages | `/v2/federation/messages/*` | `app/Http/Controllers/Api/FederationV2Controller.php` |
| Broker review queue | `/v2/admin/broker/messages/*` | `app/Http/Controllers/Api/AdminBrokerController.php` |
| Pusher auth / config | `/pusher/auth`, `/v2/pusher/config` | `app/Http/Controllers/Api/PusherController.php` |

Services:

- `app/Services/MessageService.php` — conversation list, thread fetch, send, edit, delete, mark-read, archive/restore, typing indicator, reactions.
- `app/Services/BrokerMessageVisibilityService.php` — broker copy eligibility check, copy creation, restriction status.
- `app/Services/BrokerControlConfigService.php` — broker configuration read/write (`messaging`, `broker_visibility` config sections).
- `app/Services/ContextualMessageService.php` — attach / resolve context cards (listing, event, job, volunteering, group).
- `app/Services/FederatedMessageService.php` — send and receive cross-tenant messages in the `federation_messages` table.
- `app/Services/TranscriptionService.php` — voice-to-text and text translation via OpenAI.
- `app/Services/TranslationConfigurationService.php` — context-aware translation settings and glossary.

Listeners (both implement `ShouldQueue`):

- `app/Listeners/NotifyMessageReceived.php` — sends in-app bell, optional email, and push notification to the recipient in their `preferred_language`.
- `app/Listeners/CopyMessageForBrokerReview.php` — evaluates the broker copy criteria and writes to `broker_message_copies` when matched.

Event:

- `app/Events/MessageSent.php` — fired by `MessageService::send()`; implements `ShouldBroadcast`, broadcasts to the Pusher private channel `tenant.{tenantId}.conversation.{conversationId}` with event name `message.sent`.

Models and tables:

| Model | Table | Notes |
| --- | --- | --- |
| `App\Models\Message` | `messages` | `body` column is `text`. Includes `is_voice`, `audio_url`, `audio_duration`, `transcript`, `transcript_language`, `reactions` (JSON), `is_edited`, `is_deleted`, `is_deleted_sender`, `is_deleted_receiver`, `context_type`, `context_id`, `archived_by_sender`, `archived_by_receiver`. |
| `App\Models\MessageAttachment` | `message_attachments` | Private attachment metadata. The raw `file_path` is hidden; the serialized `url`/`file_url` accessors return the authenticated media endpoint instead of a storage path. |
| `App\Models\BrokerMessageCopy` | `broker_message_copies` | Safeguarding copy. `copy_reason` enum: `first_contact`, `high_risk_listing`, `new_member`, `flagged_user`, `manual_monitoring`, `random_sample`. `flagged`, `flag_severity`, `reviewed_by`, `reviewed_at`. Unique index on `(tenant_id, original_message_id)` prevents duplicate copies. |
| — | `federation_messages` | Cross-tenant messages. `receiver_tenant_id`, `external_partner_id`, `external_message_id` (idempotency). |
| — | `user_messaging_restrictions` | Per-user `messaging_disabled` and `under_monitoring` flags with optional expiry. |
| — | `user_first_contacts` | Tracks first-message events between pairs; used by broker first-contact monitoring. |

React entry points:

- `react-frontend/src/pages/messages/MessagesPage.tsx` — conversation list.
- `react-frontend/src/pages/messages/ConversationPage.tsx` — thread view, send form, voice recorder, reactions, translation. Feature gate on `hasModule('messages')` is enforced here.
- `react-frontend/src/contexts/PusherContext.tsx` — Pusher WebSocket connection lifecycle.

## Conversations and threads

`MessageService::getConversations()` returns a cursor-paginated list of the current user's conversations (default 20 per page, max 100). The `archived` query parameter filters to archived conversations. `MessageService::getMessages()` returns a cursor-paginated thread (default 50, max 100) with a `direction` parameter (`older` or `newer`) for bi-directional scroll.

Opening a conversation (`GET /api/v2/messages/{id}`) automatically marks it as read, unless the client is polling for newer messages (direction=newer with a cursor).

`GET /api/v2/messages/unread-count` returns the aggregate unread count across all conversations for the authenticated user. This is polled by the navigation badge.

## Sending, editing, and deleting

### Send

`POST /api/v2/messages` requires `recipient_id` plus either `body` or an `attachments[]` file upload. It rejects client-supplied `voice_url` and `audio_url` pointers; voice messages must use the dedicated multipart route below.

- `body` is validated server-side with `HtmlSanitizer::stripAll()` (all HTML stripped before storage).
- Maximum body length: **10,000 characters**.
- Rate limit: 30 requests per 60 seconds per user (key `messages_send`).
- Sending a message awards XP via `GamificationService` (non-blocking; a failure is logged and does not block delivery).

### Edit

`PUT /api/v2/messages/{id}` allows the **sender only** to edit a message body within a **24-hour window** from creation. Editing an older message returns `EDIT_EXPIRED` (HTTP 403). The `body` is re-sanitized through `HtmlSanitizer::stripAll()`. The `is_edited` and `edited_at` columns are updated on the `messages` row.

### Delete

`DELETE /api/v2/messages/{id}` accepts an optional `scope` body parameter:

| `scope` | Default? | Effect |
| --- | --- | --- |
| `everyone` | Yes | Sets `is_deleted = true`, blanks `body` to `[Message deleted]`, clears `reactions`, sets `deleted_at`. Both parties see the placeholder. |
| `self` | No | Sets `is_deleted_sender` or `is_deleted_receiver` (depending on role). The other party's view is unchanged. |

Either the sender or receiver may delete with `scope=everyone`. Only the respective party is affected by `scope=self`.

### Conversation archive and restore

`DELETE /api/v2/messages/conversations/{id}` archives a conversation. The `scope` parameter accepts `self` (default — hides from the current user's inbox only, restorable) or `everyone` (hides from both inboxes). `POST /api/v2/messages/conversations/{id}/restore` restores an archived conversation for the calling user.

### Reactions

`POST /api/v2/messages/{id}/reactions` toggles an emoji reaction. Only emojis in `App\Support\EmojiConstants::MESSAGE_REACTIONS` are accepted. Reactions are stored in both the `message_reactions` table (per-user tracking) and the `messages.reactions` JSON column (backward compatibility). `GET /api/v2/messages/reactions/batch?ids=1,2,3` fetches reactions for up to 100 messages in one request.

## Attachments

### File and image attachments

Up to **5 files** per message (`MessageAttachmentUploader::MAX_FILES`). Each file is limited to **10 MB** (`MessageAttachmentUploader::MAX_BYTES = 10 * 1024 * 1024`).

Accepted types (extension verified against MIME content detected by `finfo`):

| Extension | Detected MIME |
| --- | --- |
| jpg, jpeg | image/jpeg |
| png | image/png |
| gif | image/gif |
| webp | image/webp |
| pdf | application/pdf |
| txt | text/plain |
| csv | text/plain, text/csv, application/csv |
| doc | application/msword |
| docx | application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/zip |
| xls | application/vnd.ms-excel |
| xlsx | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/zip |

New files are stored outside the web root under
`storage/app/private/message-media/{tenantId}/attachments/` with a random hex
filename, directory mode `0700`, and file mode `0600`. The database stores the
tenant-relative private path; it is never exposed to clients. Serialized
attachments instead use
`GET /api/v2/messages/{message}/attachments/{attachment}`.

`MessageMediaController` requires Sanctum authentication and then authorizes
the caller as the direct sender/receiver or a member of the message's group
conversation. The attachment must belong to that message and tenant. Successful
responses use `Cache-Control: private, no-store, max-age=0`, `nosniff`, a
sandboxed CSP, and `Cross-Origin-Resource-Policy: same-site`. The React client
therefore loads media through `useAuthenticatedMedia`, which supplies the bearer
token and creates a short-lived object URL; do not replace this with a public
`/uploads/...` URL.

Legacy public paths remain readable only through the same authorized controller
while migration/cleanup compatibility is needed. Migration
`2026_07_14_000200_move_message_media_to_private_storage.php` copies recognized
production attachment roots into private storage and rewrites their database
pointers. Executable extensions and MIME-type mismatches (for example, a `.png`
that is actually a script) are rejected at upload.

### Voice messages

`POST /api/v2/messages/voice` — upload and send in one step (field: `voice_message`, plus `recipient_id`).

The server stores the uploaded bytes under
`storage/app/private/message-media/{tenantId}/voice/` and passes that
server-issued, tenant-relative path through `MessageService::sendVoice()`.
Generic message input cannot choose an audio path. The `Message.audio_url`
accessor exposes only `GET /api/v2/messages/{message}/voice`, which applies the
same authentication, participant authorization, tenant containment, and
no-store response headers as attachment delivery.

Accepted audio MIME types: `audio/webm`, `video/webm`, `audio/ogg`,
`audio/mpeg`, `audio/mp3`, `audio/wav`, `audio/x-wav`, `audio/aac`,
`audio/x-hx-aac-adts`, `audio/mp4`, `audio/x-m4a`, and `video/mp4`.
Maximum file size: **10 MB**. Maximum duration: **5 minutes** (300
seconds, enforced by `AudioUploader::$maxDuration`).

After upload, `TranscriptionService::transcribe()` runs non-blocking. On success the `transcript` and `transcript_language` columns are updated on the message row and included in the response. Transcription failure is logged as a warning and does not fail the send.

## Real-time delivery via Pusher

`MessageSent` (in `app/Events/MessageSent.php`) implements `ShouldBroadcast` and is dispatched by the shared `MessageService` persistence path for text, attachment, and voice messages. It broadcasts to the Pusher private channel:

```
private-tenant.{tenantId}.conversation.{conversationId}
```

with the event name `message.sent`. The broadcast payload includes `id`, `body`, `sender_id`, `created_at`, `is_voice`, and `audio_url`. Full user objects are excluded to avoid leaking email, phone, or other private fields.

Typing indicators use a separate path: `POST /api/v2/messages/typing` triggers `MessageService::setTypingIndicator()`, which calls `Pusher::trigger()` directly on the private channel `private-tenant.{tenantId}.user.{recipientId}`. Rate limit: 60 requests per 60 seconds.

Pusher channel authorization is handled by `PusherController::auth()` at `/pusher/auth`. The React client fetches Pusher connection credentials from `GET /api/v2/pusher/config`.

The `NotifyMessageReceived` listener runs asynchronously on the queue and sends:

1. An in-app bell notification (`Notification::createNotification`).
2. An optional HTML email (suppressed if the recipient's `email_messages` notification preference is false).
3. A push notification via `NotificationDispatcher::fanOutPush()`.

All three are rendered in the **recipient's** `preferred_language` using `LocaleContext::withLocale()` — not the caller's locale.

Both listeners (`CopyMessageForBrokerReview`, `NotifyMessageReceived`) use a Redis-backed idempotency guard (`Cache::add` on a claim key, `Cache::put` on a done key) to suppress duplicate deliveries from queue re-attempts. Both are configured with `$tries = 1` and `$timeout = 60` seconds.

## Broker safeguarding visibility

The broker safeguarding feature allows an admin team to review a copy of qualifying messages. It is tenant-controlled but **on by default**: with no tenant configuration, `broker_visibility.enabled` resolves to `true` (`BrokerControlConfigService::DEFAULTS`, and `isBrokerVisibilityEnabled()` falls back to `true`), and first-contact, new-member and high-risk-listing copying all fire. A tenant must explicitly write `enabled = false` to switch it off. Contrast `exchange_workflow.enabled`, which genuinely defaults to `false`.

### How copies are triggered

`CopyMessageForBrokerReview` (queued listener on `MessageSent`) calls `BrokerMessageVisibilityService::shouldCopyMessage()`, which evaluates these criteria in order:

| Criterion | Config key | Default |
| --- | --- | --- |
| Either participant is under active safeguarding monitoring | `user_messaging_restrictions.under_monitoring` | Off (per-user flag) |
| First contact between two members | `messaging.first_contact_monitoring` | `true` |
| Sender is a new member within the monitoring window | `messaging.new_member_monitoring_days` | 30 days |
| Message relates to a high-risk listing | `broker_visibility.copy_high_risk_listing_messages` | `true` |
| Random compliance sampling | `broker_visibility.random_sample_percentage` | 0 |

Only the first matching criterion determines the `copy_reason`. Broker visibility must be enabled via `broker_visibility.enabled` for any copy to occur.

### Copy storage and notification

`BrokerMessageVisibilityService::copyMessageForBroker()` inserts into `broker_message_copies` using `firstOrCreate` against the unique index on `(tenant_id, original_message_id)`. A concurrent or retried queue job that loses the race returns the existing row without sending a second notification.

All users with `role` in `admin`, `tenant_admin`, `broker`, or `super_admin` with `status = active` receive an in-app bell notification rendered in their `preferred_language`. For the two highest-priority reasons (`flagged_user`, `high_risk_listing`), an HTML email is also sent via `BrokerMessageVisibilityService::sendBrokerReviewEmail()`.

### Broker review admin panel

Routes at `/v2/admin/broker/messages/*` expose filter (`unreviewed`, `flagged`, `reviewed`, `all`), mark-reviewed, flag, and approve actions. The `reviewed_by` and `reviewed_at` columns record who reviewed and when. Flagged copies carry `flag_severity` (`info`, `warning`, `concern`, `urgent`) and optional `action_taken`.

### Retention

The default broker copy retention is **365 days** (`broker_visibility.retention_days`). This is tenant-configurable via `AdminBrokerController`. Expired monitoring on `user_messaging_restrictions` is auto-cleared by `BrokerMessageVisibilityService::clearExpiredMonitoring()` the next time a restriction status is evaluated.

### Messaging restrictions

`GET /api/v2/messages/restriction-status` calls `BrokerMessageVisibilityService::getUserRestrictionStatus()` and returns:

```json
{
  "messaging_disabled": false,
  "under_monitoring": false,
  "restriction_reason": null
}
```

An expired monitoring window is auto-cleared inline when this endpoint is called.

## Contextual messaging

Messages can carry a reference to a platform entity via `context_type` and `context_id` on the `messages` table. `ContextualMessageService` resolves the entity into a context card (title, subtitle, description, link) for display in the thread view.

Valid `context_type` values: `listing`, `event`, `job`, `volunteering`, `group`.

The service populates the `listing_id` column as well as `context_type`/`context_id` when the context type is `listing`, for backward compatibility.

## Federation cross-community messaging

Federation messaging uses a separate table (`federation_messages`) and service (`FederatedMessageService`).

> **This inbound path is built and dormant, not live.** The only ingress to `FederatedMessageService::storeExternalMessage()` is `FederationExternalWebhookController::receive`, whose route carries the `federation.external:webhooks` middleware (`routes/api.php:3585`). External federation is off by default and has been off in production since 2026-07-27, so `EnsureExternalFederationEnabled` answers every request with HTTP 503 + `Retry-After` and code `FEDERATION_EXTERNAL_DISABLED` *before* the controller runs. No inbound federated message can arrive regardless of user opt-in or partnership state. If you are debugging "federated messaging isn't working", check the protocol switch first. This is separate from internal cross-tenant federation, which is live and ungated.

Assuming the `webhooks` protocol switch is on, delivery additionally requires:

1. Both the sender and receiver have opted into federated messaging (`federation_user_settings.federation_optin = true` and `messaging_enabled_federated = true`).
2. An active federation partnership exists between the two tenants with `messaging_enabled = 1` in `federation_partnerships`.

`FederatedMessageService::storeExternalMessage()` is idempotent: if the partner re-delivers a message with the same `external_message_id`, it repairs any missing notification or email side effects without inserting a duplicate row.

Inbound federation messages trigger:

- An in-app bell notification via `Notification::createNotification()`, rendered in the recipient's `preferred_language`.
- A push notification via `NotificationDispatcher::fanOutPush()`.
- An email via `FederationEmailService::sendExternalMessageNotification()`.

For full federation operational notes, partner onboarding, and the external partner API, see [docs/FEDERATION_API_MANUAL.md](../FEDERATION_API_MANUAL.md).

## Privacy invariants

- **Tenant isolation is absolute.** Every query in `MessageService`, `BrokerMessageVisibilityService`, and `FederatedMessageService` includes `tenant_id` from `TenantContext::getId()`. There is no cross-tenant query path.
- **No participant leakage in broadcast payloads.** `MessageSent::broadcastWith()` emits only `id`, `body`, `sender_id`, `created_at`, `is_voice`, and `audio_url`. Full `User` objects (including email, phone) are never broadcast.
- **Message media is never public.** New attachment and voice bytes live under `storage/app/private/message-media/{tenantId}/`; clients receive only authenticated API URLs. Media delivery fails closed for outsiders, cross-tenant pointers, traversal, missing files, and attachments that do not belong to the requested message.
- **Broker copies are immutable.** A broker copy stores `message_body` at the moment of copy. Subsequent edits or deletions of the original message do not propagate to the copy.
- **Translation is opt-in per message.** Translations are not stored; they are computed on demand and returned in the response. The source text for translation is either `transcript` (voice) or `body` (text), both already stored.
- **Voice transcripts are stored on the server** in the `transcript` column. Tenants should include this in their privacy policy.
- **Erasure removes authored media without breaking another sender's reference.** `GdprService::executeAccountDeletion()` deletes attachment rows and voice pointers authored by the erased member. It unlinks the underlying private file only when no other sender still references the same canonical path. An unlink failure retains the database pointer so cleanup remains retryable; when erasure is processing a `gdpr_requests` row, that request remains `processing` instead of being marked complete.

## Failure modes and recovery

| Failure | Effect | Recovery |
| --- | --- | --- |
| Pusher unavailable at send time | `MessageSent` broadcast is caught and logged as a warning (`MessageSent broadcast failed`). The message is still persisted and the HTTP 201 response is returned. The recipient misses the real-time event but can poll or refresh. | No action needed. The message is durable. Pusher will reconnect on the next page load. |
| `NotifyMessageReceived` listener failure | Logged to `Log::error`. The message is already persisted. | The listener has `$tries = 1`. If the queue worker is healthy and the failure was transient, the job is dead. Check `failed_jobs` and re-dispatch if needed. |
| `CopyMessageForBrokerReview` listener failure | Logged to `Log::error`. The original message is unaffected. The broker copy may be missing. | Check `failed_jobs`. Re-dispatch manually. The idempotency guard (`firstOrCreate`) prevents a double-copy on re-dispatch. |
| Voice transcription failure | Logged as `Log::warning('Voice message transcription failed')`. The voice message is sent successfully without a transcript. | No action needed. Transcription can be re-attempted manually by updating the `transcript` column directly if required. |
| Translation failure | `TranslationConfigurationService` / `TranscriptionService::translate()` returns `null`. API returns `TRANSLATION_FAILED` (HTTP 500). | Check that `OPENAI_API_KEY` is set and the OpenAI endpoint is reachable. |
| Attachment upload failure | Storage write fails; `MessageAttachmentUploader` throws `\RuntimeException`. API returns `UPLOAD_FAILED` (HTTP 400). | Check disk space and directory permissions under `storage/app/private/message-media/{tenantId}/attachments/`; directories should be `0700` and files `0600`. |
| Private media returns 401/403 | The request has no valid Sanctum token, or the caller is not the sender, receiver, or a group-conversation participant. | Confirm the client uses `useAuthenticatedMedia`/an authenticated fetch and that the current user belongs to the conversation. Do not make the file public as a workaround. |
| Private media returns 404 | The attachment is not attached to the requested message, the private file is missing, or its stored path fails tenant/canonical-path validation. | Compare the tenant-scoped database pointer with `storage/app/private/message-media/{tenantId}/`; for legacy rows, run or inspect the private-media migration rather than rewriting URLs by hand. |
| Federation message delivery failure | `storeExternalMessage()` returns `['success' => false, 'retryable' => true]`. The row is in `federation_messages` but `notification_sent_at` or `email_sent_at` may be null. | Re-deliver from the partner side (the idempotency guard repairs missing side effects). Or update `notification_sent_at`/`email_sent_at` manually after resolving the queue issue. |

## Test commands and key regression tests

```bash
# Run all messaging-related PHP tests
vendor/bin/phpunit --filter="Message|Broker|Federated" --colors=always

# Run all tests
vendor/bin/phpunit --testsuite=Laravel,LaravelMigrated --colors=always
```

Key test files:

| File | What it covers |
| --- | --- |
| `tests/Laravel/Feature/Controllers/MessagesControllerTest.php` | Send, edit, delete, reactions, pagination, rate limits. |
| `tests/Laravel/Feature/Messages/MessageAttachmentsTest.php` | Attachment persistence plus authenticated, participant-only private delivery and no-store headers. |
| `tests/Laravel/Feature/Messages/VoiceMessageSendTest.php` | Voice upload, duration cap, transcription path. |
| `tests/Laravel/Unit/Migrations/PrivateMessageMediaMigrationTest.php` | Approved production legacy roots are migrated; unapproved and traversing paths fail closed. |
| `tests/Laravel/Feature/Listeners/CopyMessageForBrokerReviewTest.php` | Copy criteria evaluation, idempotency guard, duplicate suppression. |
| `tests/Laravel/Unit/Listeners/NotifyMessageReceivedTest.php` | Notification dispatch, locale wrapping, idempotency. |
| `tests/Laravel/Unit/Services/BrokerMessageVisibilityServiceTest.php` | All copy-reason branches, restriction status, expired monitoring. |
| `tests/Laravel/Feature/Services/BrokerMessageVisibilityTenantIsolationTest.php` | Tenant isolation: copies and restrictions cannot cross tenants. |
| `tests/Laravel/Unit/Services/ContextualMessageServiceTest.php` | Context card resolution for all five entity types. |
| `tests/Laravel/Unit/Services/FederatedMessageServiceTest.php` | Opt-in checks, partnership check, idempotent re-delivery, locale wrapping. |
| `tests/Laravel/Unit/Models/BrokerMessageCopyTest.php` | Model scoping and copy-reason enum. |
| `tests/Laravel/Migrated/Controllers/Api/MessagesApiControllerTest.php` | Legacy API surface migration coverage. |
| `tests/Laravel/Feature/GovukAlpha/MessagesParityTest.php` | Accessible frontend messaging parity. |
