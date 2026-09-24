<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Jobs\DeliverGroupWebhook;
use App\Support\OutboundUrlGuard;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Throwable;

/**
 * Durable, tenant-scoped outbound callbacks for real group-domain events.
 *
 * Producers only append bounded outbox rows. The scheduler dispatches those
 * rows to queue workers, so a remote endpoint can never delay a user request.
 */
final class GroupWebhookService
{
    public const EVENT_MEMBER_JOINED = 'member.joined';
    public const EVENT_MEMBER_LEFT = 'member.left';
    public const EVENT_DISCUSSION_CREATED = 'discussion.created';
    public const EVENT_POST_CREATED = 'post.created';
    public const EVENT_FILE_UPLOADED = 'file.uploaded';

    /** @var list<string> */
    public const SUPPORTED_EVENTS = [
        self::EVENT_MEMBER_JOINED,
        self::EVENT_MEMBER_LEFT,
        self::EVENT_DISCUSSION_CREATED,
        self::EVENT_POST_CREATED,
        self::EVENT_FILE_UPLOADED,
    ];

    public const MAX_WEBHOOKS_PER_GROUP = 10;

    private const MAX_DELIVERY_ATTEMPTS = 5;
    private const AUTO_DISABLE_FAILURES = 10;
    private const DELIVERY_LEASE_SECONDS = 120;
    private const DISPATCH_RETRY_SECONDS = 300;
    private const RESPONSE_EXCERPT_LENGTH = 1000;

    /** @var list<int> */
    private const RETRY_BACKOFF_SECONDS = [60, 300, 900, 3600];

    /**
     * Register one endpoint after validating its route parent, URL, events,
     * encrypted secret, and the per-group limit under a group-row lock.
     */
    public static function register(int $groupId, string $url, array $events, ?string $secret = null): ?int
    {
        $tenantId = (int) TenantContext::getId();
        $url = trim($url);
        $events = self::normalizeEvents($events);

        if ($events === null || !self::isSafeWebhookUrl($url)) {
            return null;
        }

        return DB::transaction(function () use ($groupId, $tenantId, $url, $events, $secret): ?int {
            $group = DB::table('groups')
                ->where('id', $groupId)
                ->where('tenant_id', $tenantId)
                ->where('status', GroupStatus::Active->value)
                ->lockForUpdate()
                ->first(['id']);
            if ($group === null) {
                return null;
            }

            $count = DB::table('group_webhooks')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->count();
            if ($count >= self::MAX_WEBHOOKS_PER_GROUP) {
                return null;
            }

            return (int) DB::table('group_webhooks')->insertGetId([
                'tenant_id' => $tenantId,
                'group_id' => $groupId,
                'url' => $url,
                'events' => json_encode($events, JSON_THROW_ON_ERROR),
                'secret' => $secret !== null && $secret !== '' ? Crypt::encryptString($secret) : null,
                'is_active' => true,
                'failure_count' => 0,
                'disabled_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });
    }

    /**
     * Append one delivery row per matching endpoint. There are at most ten
     * endpoints, and this method intentionally performs no network or queue IO.
     */
    public static function fire(int $groupId, string $event, array $payload = []): void
    {
        if (!in_array($event, self::SUPPORTED_EVENTS, true)) {
            return;
        }

        $tenantId = (int) TenantContext::getId();
        if (!TenantContext::hasFeature('groups') || !self::groupExists($groupId, $tenantId)) {
            return;
        }

        $webhooks = DB::table('group_webhooks')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->orderBy('id')
            ->limit(self::MAX_WEBHOOKS_PER_GROUP)
            ->get(['id', 'events']);

        $body = [
            'event' => $event,
            'group_id' => $groupId,
            'tenant_id' => $tenantId,
            'timestamp' => now()->toIso8601String(),
            'data' => $payload,
        ];
        $encoded = json_encode(
            $body,
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE,
        );
        $now = now();
        $deliveries = [];

        foreach ($webhooks as $webhook) {
            $subscribedEvents = json_decode((string) $webhook->events, true);
            if (!is_array($subscribedEvents) || !in_array($event, $subscribedEvents, true)) {
                continue;
            }

            $deliveries[] = [
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'group_id' => $groupId,
                'webhook_id' => (int) $webhook->id,
                'event' => $event,
                'payload' => $encoded,
                'status' => 'queued',
                'attempt_count' => 0,
                'available_at' => $now,
                'dispatched_at' => null,
                'claim_token' => null,
                'lease_expires_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        if ($deliveries !== []) {
            DB::table('group_webhook_deliveries')->insert($deliveries);
        }
    }

    /**
     * Claim due outbox rows for queue dispatch. A dispatch timestamp provides a
     * recovery lease if the queue push succeeds but no worker ever receives it.
     */
    public static function dispatchDueDeliveries(int $limit = 100): int
    {
        $limit = max(1, min($limit, 500));
        $dispatches = DB::transaction(function () use ($limit): array {
            $now = now();

            DB::table('group_webhook_deliveries')
                ->where('status', 'processing')
                ->where('lease_expires_at', '<=', $now)
                ->where('attempt_count', '>=', self::MAX_DELIVERY_ATTEMPTS)
                ->update([
                    'status' => 'failed',
                    'claim_token' => null,
                    'lease_expires_at' => null,
                    'last_error_code' => 'LEASE_EXHAUSTED',
                    'updated_at' => $now,
                ]);

            DB::table('group_webhook_deliveries')
                ->where('status', 'processing')
                ->where('lease_expires_at', '<=', $now)
                ->where('attempt_count', '<', self::MAX_DELIVERY_ATTEMPTS)
                ->update([
                    'status' => 'retry',
                    'available_at' => $now,
                    'dispatched_at' => null,
                    'claim_token' => null,
                    'lease_expires_at' => null,
                    'last_error_code' => 'LEASE_EXPIRED',
                    'updated_at' => $now,
                ]);

            $rows = DB::table('group_webhook_deliveries')
                ->whereIn('status', ['queued', 'retry'])
                ->where('available_at', '<=', $now)
                ->where(function ($dispatch) use ($now): void {
                    $dispatch->whereNull('dispatched_at')
                        ->orWhere('dispatched_at', '<=', $now->copy()->subSeconds(self::DISPATCH_RETRY_SECONDS));
                })
                ->orderBy('available_at')
                ->orderBy('id')
                ->limit($limit)
                ->lock('FOR UPDATE SKIP LOCKED')
                ->get(['id', 'tenant_id']);

            foreach ($rows as $row) {
                DB::table('group_webhook_deliveries')
                    ->where('id', $row->id)
                    ->whereIn('status', ['queued', 'retry'])
                    ->update(['dispatched_at' => $now, 'updated_at' => $now]);
            }

            return $rows->map(static fn (object $row): array => [
                'id' => (string) $row->id,
                'tenant_id' => (int) $row->tenant_id,
            ])->all();
        });

        $dispatched = 0;
        foreach ($dispatches as $delivery) {
            try {
                DeliverGroupWebhook::dispatch($delivery['id'], $delivery['tenant_id']);
                $dispatched++;
            } catch (Throwable $exception) {
                DB::table('group_webhook_deliveries')
                    ->where('id', $delivery['id'])
                    ->where('tenant_id', $delivery['tenant_id'])
                    ->whereIn('status', ['queued', 'retry'])
                    ->update(['dispatched_at' => null, 'updated_at' => now()]);

                Log::warning('Group webhook queue dispatch failed', [
                    'delivery_id' => $delivery['id'],
                    'tenant_id' => $delivery['tenant_id'],
                    'exception' => $exception::class,
                ]);
            }
        }

        return $dispatched;
    }

    /**
     * Perform one claimed delivery attempt.
     *
     * @return 'delivered'|'retry'|'failed'|'skipped'
     */
    public static function deliver(string $deliveryId, int $tenantId): string
    {
        $claim = self::claimDelivery($deliveryId, $tenantId);
        if ($claim === null) {
            return 'skipped';
        }

        $tenantExists = DB::table('tenants')
            ->where('id', $tenantId)
            ->where('is_active', true)
            ->exists();
        if (!$tenantExists) {
            return self::markTerminalFailure($claim, 'TENANT_UNAVAILABLE');
        }

        try {
            return TenantContext::runForTenant(
                $tenantId,
                static fn (): string => self::performDelivery($claim),
            );
        } catch (Throwable $exception) {
            Log::warning('Group webhook delivery attempt failed', [
                'delivery_id' => $deliveryId,
                'tenant_id' => $tenantId,
                'exception' => $exception::class,
            ]);

            return self::recordAttemptFailure($claim, 'NETWORK_ERROR');
        }
    }

    /** @return list<string> */
    public static function supportedEvents(): array
    {
        return self::SUPPORTED_EVENTS;
    }

    public static function areSupportedEvents(array $events): bool
    {
        return self::normalizeEvents($events) !== null;
    }

    /**
     * List endpoint configuration without exposing encrypted secrets or payloads.
     */
    public static function list(int $groupId): array
    {
        $tenantId = (int) TenantContext::getId();
        if (!self::groupExists($groupId, $tenantId)) {
            return [];
        }

        return DB::table('group_webhooks')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->select(
                'id',
                'url',
                'events',
                'is_active',
                'last_fired_at',
                'failure_count',
                'disabled_at',
                'created_at',
            )
            ->orderBy('id')
            ->get()
            ->map(static function (object $row): array {
                $events = json_decode((string) $row->events, true);
                $row->events = is_array($events) ? array_values($events) : [];

                return (array) $row;
            })
            ->all();
    }

    public static function delete(int $groupId, int $webhookId, int $actorId): bool
    {
        $tenantId = (int) TenantContext::getId();
        if (!self::groupExists($groupId, $tenantId)) {
            return false;
        }

        return DB::transaction(function () use ($groupId, $webhookId, $actorId, $tenantId): bool {
            $webhook = DB::table('group_webhooks')
                ->where('id', $webhookId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first(['id', 'is_active']);
            if ($webhook === null) {
                return false;
            }

            $deleted = DB::table('group_webhooks')
                ->where('id', $webhookId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->delete();
            if ($deleted !== 1) {
                return false;
            }

            GroupAuditService::log(
                GroupAuditService::ACTION_WEBHOOK_DELETED,
                $groupId,
                $actorId,
                [
                    'webhook_id' => $webhookId,
                    'previous_is_active' => (bool) $webhook->is_active,
                ],
            );

            return true;
        });
    }

    /**
     * Idempotently set endpoint state. Returning true means the route-owned
     * endpoint exists, even when it was already in the requested state.
     */
    public static function toggle(int $groupId, int $webhookId, bool $isActive, int $actorId): bool
    {
        $tenantId = (int) TenantContext::getId();
        if (!self::groupExists($groupId, $tenantId)) {
            return false;
        }

        return DB::transaction(function () use ($groupId, $webhookId, $tenantId, $isActive, $actorId): bool {
            $webhook = DB::table('group_webhooks')
                ->where('id', $webhookId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first(['id', 'is_active']);
            if ($webhook === null) {
                return false;
            }

            if ((bool) $webhook->is_active === $isActive) {
                return true;
            }

            $updates = [
                'is_active' => $isActive,
                'disabled_at' => $isActive ? null : now(),
                'updated_at' => now(),
            ];
            if ($isActive) {
                $updates['failure_count'] = 0;
            }

            DB::table('group_webhooks')
                ->where('id', $webhookId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->update($updates);

            GroupAuditService::log(
                GroupAuditService::ACTION_WEBHOOK_TOGGLED,
                $groupId,
                $actorId,
                [
                    'webhook_id' => $webhookId,
                    'previous_is_active' => (bool) $webhook->is_active,
                    'is_active' => $isActive,
                ],
            );

            return true;
        });
    }

    private static function performDelivery(object $claim): string
    {
        if (!TenantContext::hasFeature('groups')) {
            return self::markTerminalFailure($claim, 'FEATURE_DISABLED');
        }

        $webhook = DB::table('group_webhooks as wh')
            ->join('groups as g', function ($join): void {
                $join->on('g.id', '=', 'wh.group_id')
                    ->on('g.tenant_id', '=', 'wh.tenant_id');
            })
            ->where('wh.id', (int) $claim->webhook_id)
            ->where('wh.group_id', (int) $claim->group_id)
            ->where('wh.tenant_id', (int) $claim->tenant_id)
            ->where('g.status', GroupStatus::Active->value)
            ->select('wh.*')
            ->first();
        if ($webhook === null) {
            return self::markTerminalFailure($claim, 'WEBHOOK_UNAVAILABLE');
        }
        if (!(bool) $webhook->is_active) {
            return self::markTerminalFailure($claim, 'WEBHOOK_DISABLED');
        }
        if (!in_array((string) $claim->event, self::SUPPORTED_EVENTS, true)) {
            return self::markTerminalFailure($claim, 'EVENT_UNSUPPORTED');
        }

        $body = json_decode((string) $claim->payload, true);
        if (
            !is_array($body)
            || ($body['event'] ?? null) !== (string) $claim->event
            || (int) ($body['group_id'] ?? 0) !== (int) $claim->group_id
            || (int) ($body['tenant_id'] ?? 0) !== (int) $claim->tenant_id
        ) {
            return self::markTerminalFailure($claim, 'PAYLOAD_INVALID');
        }

        $url = (string) $webhook->url;
        if (!self::isSafeWebhookUrl($url)) {
            return self::markTerminalFailure($claim, 'UNSAFE_URL', null, null, true);
        }

        $encodedBody = json_encode(
            $body,
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE,
        );
        $headers = [
            'Content-Type' => 'application/json',
            'X-Nexus-Webhook-Id' => (string) $claim->id,
            'X-Nexus-Webhook-Event' => (string) $claim->event,
        ];
        $secret = self::decryptSecret($webhook->secret ?? null);
        if ($secret !== null && $secret !== '') {
            $headers['X-Webhook-Signature'] = hash_hmac('sha256', $encodedBody, $secret);
        }

        $response = Http::connectTimeout(3)
            ->timeout(5)
            ->withOptions(OutboundUrlGuard::httpClientOptions($url, requireHttps: true))
            // Do not eagerly buffer the whole body; responseExcerpt() reads only a
            // bounded prefix, so a hostile endpoint cannot exhaust worker memory.
            ->withOptions(['stream' => true])
            ->withHeaders($headers)
            ->withBody($encodedBody, 'application/json')
            ->post($url);
        $status = $response->status();
        $excerpt = self::responseExcerpt($response);

        if ($status >= 200 && $status < 300) {
            return self::markDelivered($claim, $status, $excerpt);
        }

        return self::recordAttemptFailure($claim, 'HTTP_' . $status, $status, $excerpt);
    }

    private static function claimDelivery(string $deliveryId, int $tenantId): ?object
    {
        return DB::transaction(function () use ($deliveryId, $tenantId): ?object {
            $now = now();
            $row = DB::table('group_webhook_deliveries')
                ->where('id', $deliveryId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if ($row === null || !in_array((string) $row->status, ['queued', 'retry'], true)) {
                return null;
            }
            if ($row->available_at !== null && Carbon::parse((string) $row->available_at)->isFuture()) {
                return null;
            }

            $attempt = (int) $row->attempt_count + 1;
            if ($attempt > self::MAX_DELIVERY_ATTEMPTS) {
                DB::table('group_webhook_deliveries')
                    ->where('id', $deliveryId)
                    ->where('tenant_id', $tenantId)
                    ->update([
                        'status' => 'failed',
                        'last_error_code' => 'ATTEMPTS_EXHAUSTED',
                        'updated_at' => $now,
                    ]);

                return null;
            }

            $token = (string) Str::uuid();
            DB::table('group_webhook_deliveries')
                ->where('id', $deliveryId)
                ->where('tenant_id', $tenantId)
                ->whereIn('status', ['queued', 'retry'])
                ->update([
                    'status' => 'processing',
                    'attempt_count' => $attempt,
                    'claim_token' => $token,
                    'lease_expires_at' => $now->copy()->addSeconds(self::DELIVERY_LEASE_SECONDS),
                    'updated_at' => $now,
                ]);

            $row->status = 'processing';
            $row->attempt_count = $attempt;
            $row->claim_token = $token;

            return $row;
        });
    }

    /** @return 'delivered'|'skipped' */
    private static function markDelivered(object $claim, int $status, ?string $excerpt): string
    {
        return DB::transaction(function () use ($claim, $status, $excerpt): string {
            $updated = DB::table('group_webhook_deliveries')
                ->where('id', (string) $claim->id)
                ->where('tenant_id', (int) $claim->tenant_id)
                ->where('status', 'processing')
                ->where('claim_token', (string) $claim->claim_token)
                ->update([
                    'status' => 'delivered',
                    'http_status' => $status,
                    'response_excerpt' => $excerpt,
                    'last_error_code' => null,
                    'claim_token' => null,
                    'lease_expires_at' => null,
                    'delivered_at' => now(),
                    'updated_at' => now(),
                ]);
            if ($updated === 0) {
                return 'skipped';
            }

            DB::table('group_webhooks')
                ->where('id', (int) $claim->webhook_id)
                ->where('group_id', (int) $claim->group_id)
                ->where('tenant_id', (int) $claim->tenant_id)
                ->update([
                    'last_fired_at' => now(),
                    'failure_count' => 0,
                    'updated_at' => now(),
                ]);

            return 'delivered';
        });
    }

    /** @return 'retry'|'failed'|'skipped' */
    private static function recordAttemptFailure(
        object $claim,
        string $errorCode,
        ?int $status = null,
        ?string $excerpt = null,
    ): string {
        return DB::transaction(function () use ($claim, $errorCode, $status, $excerpt): string {
            $delivery = DB::table('group_webhook_deliveries')
                ->where('id', (string) $claim->id)
                ->where('tenant_id', (int) $claim->tenant_id)
                ->where('status', 'processing')
                ->where('claim_token', (string) $claim->claim_token)
                ->lockForUpdate()
                ->first();
            if ($delivery === null) {
                return 'skipped';
            }

            $webhook = DB::table('group_webhooks')
                ->where('id', (int) $claim->webhook_id)
                ->where('group_id', (int) $claim->group_id)
                ->where('tenant_id', (int) $claim->tenant_id)
                ->lockForUpdate()
                ->first(['id', 'is_active', 'failure_count']);
            $failureCount = $webhook === null ? 0 : (int) $webhook->failure_count + 1;
            $disable = $webhook !== null && $failureCount >= self::AUTO_DISABLE_FAILURES;
            $exhausted = (int) $delivery->attempt_count >= self::MAX_DELIVERY_ATTEMPTS;
            $terminal = $disable || $exhausted;
            $nextAttemptAt = $terminal
                ? null
                : now()->addSeconds(self::retryBackoff((int) $delivery->attempt_count));

            DB::table('group_webhook_deliveries')
                ->where('id', (string) $claim->id)
                ->where('tenant_id', (int) $claim->tenant_id)
                ->where('status', 'processing')
                ->where('claim_token', (string) $claim->claim_token)
                ->update([
                    'status' => $terminal ? 'failed' : 'retry',
                    'available_at' => $nextAttemptAt ?? now(),
                    'dispatched_at' => null,
                    'claim_token' => null,
                    'lease_expires_at' => null,
                    'http_status' => $status,
                    'response_excerpt' => $excerpt,
                    'last_error_code' => $errorCode,
                    'updated_at' => now(),
                ]);

            if ($webhook !== null) {
                $updates = [
                    'failure_count' => $failureCount,
                    'updated_at' => now(),
                ];
                if ($disable) {
                    $updates['is_active'] = false;
                    $updates['disabled_at'] = now();
                }
                DB::table('group_webhooks')
                    ->where('id', (int) $claim->webhook_id)
                    ->where('group_id', (int) $claim->group_id)
                    ->where('tenant_id', (int) $claim->tenant_id)
                    ->update($updates);
            }

            return $terminal ? 'failed' : 'retry';
        });
    }

    /** @return 'failed'|'skipped' */
    private static function markTerminalFailure(
        object $claim,
        string $errorCode,
        ?int $status = null,
        ?string $excerpt = null,
        bool $disableWebhook = false,
    ): string {
        return DB::transaction(function () use (
            $claim,
            $errorCode,
            $status,
            $excerpt,
            $disableWebhook,
        ): string {
            $updated = DB::table('group_webhook_deliveries')
                ->where('id', (string) $claim->id)
                ->where('tenant_id', (int) $claim->tenant_id)
                ->where('status', 'processing')
                ->where('claim_token', (string) $claim->claim_token)
                ->update([
                    'status' => 'failed',
                    'dispatched_at' => null,
                    'claim_token' => null,
                    'lease_expires_at' => null,
                    'http_status' => $status,
                    'response_excerpt' => $excerpt,
                    'last_error_code' => $errorCode,
                    'updated_at' => now(),
                ]);
            if ($updated === 0) {
                return 'skipped';
            }

            if ($disableWebhook) {
                DB::table('group_webhooks')
                    ->where('id', (int) $claim->webhook_id)
                    ->where('group_id', (int) $claim->group_id)
                    ->where('tenant_id', (int) $claim->tenant_id)
                    ->update([
                        'is_active' => false,
                        'disabled_at' => now(),
                        'updated_at' => now(),
                    ]);
            }

            return 'failed';
        });
    }

    private static function retryBackoff(int $attempt): int
    {
        $index = max(0, min($attempt - 1, count(self::RETRY_BACKOFF_SECONDS) - 1));

        return self::RETRY_BACKOFF_SECONDS[$index];
    }

    private static function responseExcerpt(Response $response): ?string
    {
        // Read only a bounded prefix of the body. A hostile endpoint could return
        // an arbitrarily large response, and $response->body() would buffer all of
        // it into the worker's memory just to keep a 1,000-char excerpt. A UTF-8
        // character is at most 4 bytes, so reading RESPONSE_EXCERPT_LENGTH * 4
        // bytes is always enough to fill the excerpt after trimming/substr.
        $maxBytes = self::RESPONSE_EXCERPT_LENGTH * 4;
        $stream = $response->toPsrResponse()->getBody();
        if ($stream->isSeekable()) {
            $stream->rewind();
        }

        $raw = '';
        while (strlen($raw) < $maxBytes && !$stream->eof()) {
            $chunk = $stream->read($maxBytes - strlen($raw));
            if ($chunk === '') {
                break;
            }
            $raw .= $chunk;
        }

        $body = trim($raw);
        if ($body === '') {
            return null;
        }

        $body = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', ' ', $body) ?? '';

        return mb_substr($body, 0, self::RESPONSE_EXCERPT_LENGTH);
    }

    private static function groupExists(int $groupId, int $tenantId): bool
    {
        return DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('status', GroupStatus::Active->value)
            ->exists();
    }

    /** @return list<string>|null */
    private static function normalizeEvents(array $events): ?array
    {
        if ($events === []) {
            return null;
        }

        $normalized = [];
        foreach ($events as $event) {
            if (!is_string($event) || !in_array($event, self::SUPPORTED_EVENTS, true)) {
                return null;
            }
            $normalized[$event] = true;
        }

        return array_keys($normalized);
    }

    private static function decryptSecret(?string $secret): ?string
    {
        if ($secret === null || $secret === '') {
            return null;
        }

        try {
            return Crypt::decryptString($secret);
        } catch (Throwable) {
            // Preserve compatibility with webhook secrets stored before the
            // encrypted-secret rollout. New registrations are always encrypted.
            return $secret;
        }
    }

    private static function isSafeWebhookUrl(string $url): bool
    {
        return OutboundUrlGuard::isSafeHttpUrl($url, requireHttps: true);
    }
}
