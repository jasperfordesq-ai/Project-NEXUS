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
| Broker voice playback | `/v2/admin/broker/messages/{id}/voice/{messageId}` | `AdminBrokerController::messageVoice()` — owner decision 3 Oct 2026 (a safety feature). Serves only a voice message inside that copy's review thread, never one deleted for everyone, refuses a party to the conversation (F-436), and audit-logs every play as `broker_voice_message_played`. The broker page fetches it only when Play is pressed. |
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

Events:

- `app/Events/MessageSent.php` — fired by `MessageService::send()` through `MessageDeliveryOutboxService`; implements `ShouldBroadcast` and goes out as `new-message` on the recipient's user channel and the pair's chat channel (see "Real-time delivery via Pusher").
- `app/Events/MessageRead.php` — fired by `MessageService::markAsRead()` when at least one message changed to read; goes out as `message.read` on the sender's and the reader's user channels.
- `app/Events/MessageUpdated.php`, `MessageDeleted.php`, `MessageReaction.php` — fired by `MessageService::editMessage()`, `deleteMessage()` and `toggleReaction()` for one-to-one messages; go out as `message.updated`, `message.deleted` and `message.reaction` on the participants' user channels (see "Changes to existing messages").
- `app/Support/Messaging/MessageSenderSummary.php` — the seven sender fields `MessageSent` carries onto the queue instead of the full `User` row.
- `app/Support/Messaging/MessagePairId.php` — the one place the synthetic one-to-one `conversation_id` (crc32 of `{min}-{max}`) and the `chat.{min}-{max}` channel suffix are derived.

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

Every thread response carries `meta.synced_at` (the server's clock, taken before the query ran). A `direction=newer` poll that sends it back as `updated_since` also receives the rows at or below its cursor that were **edited or deleted for everyone** at or after that time, so a client without a live connection still catches up on those; it replaces such rows in place and appends the rest. Reactions are not covered by the poll (a removed reaction leaves no timestamp on the row) and a "delete for me" simply disappears from the next full load. An unparseable `updated_since` is ignored and the poll behaves as a plain "newer" poll.

`GET /api/v2/messages/unread-count` returns the aggregate unread count across all conversations for the authenticated user. This is polled by the navigation badge.

## Sending, editing, and deleting

### Send

`POST /api/v2/messages` requires `recipient_id` plus either `body` or an `attachments[]` file upload. It rejects client-supplied `voice_url` and `audio_url` pointers; voice messages must use the dedicated multipart route below. A JSON `attachments` array (url/path/name/mime metadata) is ignored: attachment rows come only from files uploaded with the request, persisted through `MessageService::sendWithUploadedAttachments()`, which re-resolves each staged path in the tenant's private store. Generic `MessageService::send()` drops any `attachments` key.

- `body` is validated server-side with `HtmlSanitizer::stripAll()` (all HTML stripped before storage).
- Maximum body length: **10,000 characters**.
- Rate limit: 30 requests per 60 seconds per user (key `messages_send`).
- Sending a message awards XP via `GamificationService` (non-blocking; a failure is logged and does not block delivery).

### Edit

`PUT /api/v2/messages/{id}` allows the **sender only** to edit a message body within a **24-hour window** from creation. Editing an older message returns `EDIT_EXPIRED` (HTTP 403). The `body` is re-sanitized through `HtmlSanitizer::stripAll()`. The `is_edited` and `edited_at` columns are updated on the `messages` row, and `message.updated` is broadcast to both participants.

### Delete

`DELETE /api/v2/messages/{id}` accepts an optional `scope` body parameter:

| `scope` | Default? | Effect |
| --- | --- | --- |
| `everyone` | Yes | Sets `is_deleted = true`, blanks `body` to `[Message deleted]`, clears `reactions`, sets `deleted_at`. Both parties see the placeholder. |
| `self` | No | Sets `is_deleted_sender` or `is_deleted_receiver` (depending on role). The other party's view is unchanged. |

Only the sender may delete a message with `scope=everyone`; a receiver's attempt is refused with HTTP 403. Either participant may use `scope=self` to hide the message from their own view without changing the other person's view. `message.deleted` is broadcast to both participants for `everyone`, and to the actor's own channel only for `self`.

### Conversation archive and restore

`DELETE /api/v2/messages/conversations/{id}` archives a conversation. The `scope` parameter accepts `self` (default — hides from the current user's inbox only, restorable) or `everyone` (hides from both inboxes). `POST /api/v2/messages/conversations/{id}/restore` restores an archived conversation for the calling user.

The legacy `POST /api/messages/delete-conversation` (`other_user_id`) is the same `self` archive. It used to hard-delete both members' messages, and the `broker_message_copies.original_message_id` foreign key (`ON DELETE CASCADE`) removed the broker's safeguarding copies with them. No member-facing path hard-deletes message rows; do not add one.

### Group conversations and member controls

Group create, add-participant and send apply the same sender restrictions as a direct send (`MessageService::senderWriteRestriction()`: suspended/banned/deactivated accounts and broker "messaging disabled"). A block in either direction between the creator and an invitee, or between the adding admin and the new member, refuses the request with `BLOCKED` (403) before the safeguarding policy runs. A block made after two members already share a group removes neither of them; each simply stops seeing the other's group messages (thread, last-message preview and unread count).

### Reactions

`POST /api/v2/messages/{id}/reactions` toggles an emoji reaction. Only emojis in `App\Support\EmojiConstants::MESSAGE_REACTIONS` are accepted. Reactions are stored in both the `message_reactions` table (per-user tracking) and the `messages.reactions` JSON column (backward compatibility). Each toggle on a one-to-one message broadcasts `message.reaction` with the counts after the toggle. `GET /api/v2/messages/reactions/batch?ids=1,2,3` fetches reactions for up to 100 messages in one request.

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

Corrected 2026-10-17. Until then `MessageSent` went out as `message.sent` on `private-tenant.{T}.conversation.{crc32}` — a channel `PusherService::canAccessPrivateChannel()` grants only to members with a `conversation_participants` row, which one-to-one chats never write, and that neither client subscribed to. No live one-to-one event ever reached the web or the mobile app; the web only looked live because it polls every 30 seconds. The contract below is the one both shipped clients bind.

### Channels and who may subscribe

Authorisation is `POST /api/pusher/auth` (`PusherController::auth()` → `PusherService::canAccessPrivateChannel()`), under `auth:sanctum`, so the mobile Bearer token works. All channel names embed the tenant id and are refused for any other tenant.

| Channel | Granted to | Used for |
| --- | --- | --- |
| `private-tenant.{T}.user.{N}` | member N only | `new-message`, `message.read`, `message.updated`, `message.deleted`, `message.reaction`, `typing`, notifications |
| `private-tenant.{T}.chat.{A}-{B}` (smaller id first) | members A and B | `new-message` echo for a sender's other tabs/devices |
| `private-tenant.{T}.conversation.{id}` | members with a `conversation_participants` row | group conversations only; unreachable for one-to-one chats |

Clients read the connection settings at runtime: the web from `GET /v2/realtime/config`, the mobile app from `GET /api/pusher/config` (which also returns the member's user channel name). Both are empty/disabled when `PUSHER_APP_KEY` is unset.

### `new-message`

Dispatched by `MessageDeliveryOutboxService` right after the row commits (and by the scheduled outbox consumer if that immediate dispatch failed). `MessageSent` broadcasts, queued, on the recipient's user channel and on the pair's chat channel — never on the sender's own user channel, because the installed mobile build bumps its unread badge for any `new-message` there that no visible thread acknowledges.

One payload satisfies both clients: the flat keys the web handler reads, plus the nested `{conversation_id, message}` the mobile validator requires.

```json
{
  "id": 123, "sender_id": 5, "receiver_id": 9,
  "body": "hello", "created_at": "2026-10-17T10:00:00.000000Z", "timestamp": 1760695200,
  "conversation_id": 2874163920,
  "message": {
    "id": 123, "body": "hello", "sender_id": 5, "receiver_id": 9,
    "sender": { "id": 5, "name": "Anna", "first_name": "Anna", "avatar_url": "/storage/..." },
    "created_at": "2026-10-17T10:00:00.000000Z",
    "is_own": false, "is_read": false, "is_edited": false, "is_deleted": false,
    "is_voice": false, "audio_url": null, "audio_duration": null,
    "reactions": {},
    "attachments": [ { "id": 7, "url": "/api/v2/messages/123/attachments/7", "type": "image", "name": "x.png", "size": 1234, "mime_type": "image/png" } ],
    "listing_id": null, "context_type": null, "context_id": null,
    "is_truncated": false
  }
}
```

- `conversation_id` is `MessagePairId::of(sender, receiver)` — a stable crc32 of the member-id pair, **not** a database id (one-to-one messages have `messages.conversation_id = null`).
- `is_own` is the recipient's perspective. A client that can receive the chat-channel echo derives own-ness from `sender_id`.
- The sender is trimmed to four fields and surnamed per the member-visibility rule (F-084, F-085); never a user row. The event itself carries only a `MessageSenderSummary` (seven fields) onto the queue, not the `User` model. Attachments are mapped only from the relation the outbox eager-loads (tenant-filtered), because `broadcastWith()` runs on the queue worker, where no tenant context exists.
- Bodies longer than 6 KB are cut and flagged `is_truncated: true` (Pusher's event limit is 10 KB); the web then re-polls for the canonical row.

### `message.read`

`MessageService::markAsRead()` selects the unread ids first; when none changed it broadcasts nothing (it runs on every thread GET). Otherwise `MessageRead` goes out, queued, on the sender's user channel (their ticks turn blue) and on the reader's user channel (their other devices clear their badge):

```json
{ "reader_id": 9, "sender_id": 5, "conversation_id": 2874163920, "up_to_message_id": 123,
  "read_count": 3, "read_at": "2026-10-17T10:00:05.000000Z", "reader_unread_messages": 1, "timestamp": 1760695205 }
```

Clients flip only their own messages with `id <= up_to_message_id`, which is race-safe when the sender posts again before the event arrives. This is a two-state model by decision: sent / read. There is no "delivered" state and no column for one. A `direction=newer` poll with a cursor never marks read and therefore never broadcasts.

### `typing`

`POST /api/v2/messages/typing` (60 per minute) → `MessageService::setTypingIndicator()` → `PusherService::trigger()` on the **recipient's user channel**, synchronously: `{ "user_id": 5, "is_typing": true, "timestamp": 1760695200 }`. There is no server-side stop; the client sends `is_typing: false` itself.

### Changes to existing messages

Added 2026-10-17. Three queued events, dispatched by `MessageService` after the change is committed, scalars only (no user rows). All three carry `sender_id` and `receiver_id` of the **message** so a client can tell which thread it belongs to and, on mobile, which member to route it to (the mobile app keys an open thread by the other member's id). A failure to broadcast is logged and never undoes the change. Group messages are not broadcast.

#### `message.updated`

`MessageService::editMessage()` (sender only, 24-hour window) → both participants' user channels:

```json
{ "id": 123, "body": "corrected text", "is_edited": true, "edited_at": "2026-10-17T10:07:00.000000Z",
  "is_truncated": false, "sender_id": 5, "receiver_id": 9, "conversation_id": 2874163920, "timestamp": 1760695620 }
```

Clients replace the body and mark the row edited. Bodies over 6 KB are cut and flagged `is_truncated`, as for `new-message`; the web then polls (with `updated_since`) and the mobile app refetches. The web also drops its cached auto-translation for that id so the edited text is translated afresh.

#### `message.deleted`

`MessageService::deleteMessage()`:

| `scope` | Goes to | Client behaviour |
| --- | --- | --- |
| `everyone` | both participants' user channels | tombstone: placeholder body, `is_deleted`, reactions and attachments cleared |
| `self` | the **actor's** user channel only | remove the row — the actor's other devices follow; the other member never learns of it, and a client that is not the actor must ignore a stray one |

```json
{ "id": 123, "scope": "everyone", "actor_id": 5, "sender_id": 5, "receiver_id": 9,
  "conversation_id": 2874163920, "deleted_at": "2026-10-17T10:08:00.000000Z", "timestamp": 1760695680 }
```

#### `message.reaction`

`MessageService::toggleReaction()` → both participants' user channels. `counts` are the server's per-emoji totals **after** the toggle, read back from `message_reactions`, so clients set them rather than incrementing and converge whatever order events arrive in. `actor_id` lets a client keep its own "you reacted" marker right when the toggle came from another of its devices. An empty map is `{}`, never `[]`.

```json
{ "message_id": 123, "emoji": "👍", "action": "added", "actor_id": 9, "counts": { "👍": 1 },
  "sender_id": 5, "receiver_id": 9, "conversation_id": 2874163920, "timestamp": 1760695740 }
```

### What each client binds

| Client | `new-message` | `message.read` | `message.updated` / `message.deleted` / `message.reaction` | `typing` |
| --- | --- | --- | --- | --- |
| Web (`react-frontend/src/contexts/PusherContext.tsx`) | user channel and chat channel, deduplicated by id | user channel | user channel only (a chat-channel copy would double-deliver); `ConversationPage` patches the open thread | user channel |
| Mobile (`mobile/lib/context/RealtimeContext.tsx`) | user channel | user channel | user channel, routed to the open thread by the other member's id; `thread.tsx` patches the live page and the older-history stack | user channel |

Catch-up without a live connection: the web's 30-second poll sends `updated_since` (see "Conversations and threads") and so picks up edits and deletes for everyone; reactions and the inbox list's last-message preview are live-only until the next full load. The mobile app has no poll; it refetches the thread on focus and on reconnect.

Not broadcast: group-conversation messages (`GroupConversationService` does not dispatch `MessageSent`) and any change to a group message.

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

Group-conversation messages are stored with `receiver_id = 0` and do not raise `MessageSent`. `GroupConversationService::sendGroupMessage()` instead queues `App\Jobs\CopyGroupMessageForBrokerReview`, which applies the same criteria across every active recipient (`BrokerMessageVisibilityService::copyGroupMessageIfRequired()`; one random-sample draw per message). The copy's `receiver_id` names the recipient that triggered the rule (the monitored or first-contact recipient, otherwise the first recipient), `conversation_key` is shared by all copies from one group, and the broker detail view shows the group thread as context.

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
- **Message write responses use public identity projections.** Fresh sends and idempotent replays embed sender and receiver objects with only `id`, name parts, account type/organisation name, and avatar. Text, attachment, voice, and story-reply paths share this boundary; they never serialize contact details, date of birth, precise location, login/account metadata, privacy settings, or payment-provider identifiers.
- **Message media is never public.** New attachment and voice bytes live under `storage/app/private/message-media/{tenantId}/`; clients receive only authenticated API URLs. Media delivery fails closed for outsiders, cross-tenant pointers, traversal, missing files, and attachments that do not belong to the requested message.
- **Broker copies are immutable.** A broker copy stores `message_body` at the moment of copy. Subsequent edits or deletions of the original message do not propagate to the copy.
- **Translation is opt-in per message.** Translations are not stored; they are computed on demand and returned in the response. The source text for translation is either `transcript` (voice) or `body` (text), both already stored.
- **Voice transcripts are stored on the server** in the `transcript` column. Tenants should include this in their privacy policy.
- **Erasure removes authored media without breaking another sender's reference.** `GdprService::executeAccountDeletion()` deletes attachment rows and voice pointers authored by the erased member. It unlinks the underlying private file only when no other sender still references the same canonical path. An unlink failure retains the database pointer so cleanup remains retryable; when erasure is processing a `gdpr_requests` row, that request remains `processing` instead of being marked complete.

## Failure modes and recovery

| Failure | Effect | Recovery |
| --- | --- | --- |
| Pusher unavailable at send time | `MessageSent` and `MessageRead` implement `ShouldRescue`, so a failed broadcast is reported, not thrown. The message is still persisted and the HTTP 201 response is returned. The web falls back to its 30-second poll; the mobile app catches up on the next focus or push. | No action needed. The message is durable. Pusher reconnects on the next page load or app resume. |
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
