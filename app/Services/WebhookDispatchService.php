<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Support\OutboundUrlGuard;
use App\Support\OutboundWebhookTransport;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * WebhookDispatchService — Outbound webhook management and dispatch.
 *
 * One table, `outbound_webhooks`, per tenant. Events are dispatched from the
 * code paths listed in ALLOWED_EVENTS; nothing else fires a webhook, so the
 * admin page offers exactly that list.
 *
 * Management (list / create / update / delete / test / logs / rotate secret)
 * is done from the platform-level Integrations page by a god account that is
 * also a platform super admin (owner decision 2026-10-18), so every management
 * method takes an explicit `$tenantId` and falls back to TenantContext only
 * when none is given. dispatch() always uses the current tenant: it is called
 * from inside the request that caused the event.
 *
 * Delivery goes through OutboundWebhookTransport (container-resolved) so tests
 * can bind a fake and nothing reaches the network.
 */
class WebhookDispatchService
{
    /**
     * Every event the platform actually dispatches, and the only names a
     * webhook may subscribe to. Twelve other volunteering event names were
     * seeded into one community's webhook in 2026-03 and never fired by
     * anything; they are deliberately not here.
     *
     * @var list<string>
     */
    public const ALLOWED_EVENTS = [
        'shift.completed',                      // VolunteerCheckInController QR checkout
        'job.vacancy.created',                  // JobVacancyService
        'job.application.created',              // JobVacancyService
        'job.application.status_changed',       // JobVacancyService
        'job.application.bulk_status_changed',  // JobVacancyService
        'job.offer.accepted',                   // JobOfferService
    ];

    /** Minutes to wait before the Nth retry: 5, 15, 45 … (×3 each time). */
    private const RETRY_BASE_MINUTES = 5;

    /** Private/reserved IP ranges for SSRF protection */
    private const PRIVATE_IP_PREFIXES = ['127.', '10.', '0.', '169.254.', '::1', 'fc00:', 'fe80:'];

    public function __construct()
    {
    }

    /**
     * Check if a URL target resolves to a private/internal IP (SSRF protection).
     */
    public static function isPrivateUrl(string $url): bool
    {
        return ! OutboundUrlGuard::isSafeHttpUrl($url);
    }

    private static function isPrivateIp(string $ip): bool
    {
        foreach (self::PRIVATE_IP_PREFIXES as $prefix) {
            if (str_starts_with($ip, $prefix)) {
                return true;
            }
        }

        // Check 172.16.0.0/12 and 192.168.0.0/16
        $long = ip2long($ip);
        if ($long !== false) {
            if ($long >= ip2long('172.16.0.0') && $long <= ip2long('172.31.255.255')) {
                return true;
            }
            if ($long >= ip2long('192.168.0.0') && $long <= ip2long('192.168.255.255')) {
                return true;
            }
        }

        return false;
    }

    private static function transport(): OutboundWebhookTransport
    {
        return app(OutboundWebhookTransport::class);
    }

    /**
     * Signed POST of one body to one webhook.
     *
     * @return array{http_code: int, response: string, error: string}
     */
    private static function deliver(object $webhook, string $body, string $eventType): array
    {
        $signature = hash_hmac('sha256', $body, $webhook->secret ?? '');

        return self::transport()->post((string) $webhook->url, $body, [
            'Content-Type: application/json',
            'X-Webhook-Signature: ' . $signature,
            'X-Webhook-Event: ' . $eventType,
        ]);
    }

    private static function succeeded(int $httpCode): bool
    {
        return $httpCode >= 200 && $httpCode < 300;
    }

    /**
     * Dispatch an event to all matching webhooks of the current tenant.
     */
    public static function dispatch(string $eventType, array $payload): void
    {
        $tenantId = TenantContext::getId();

        try {
            $webhooks = DB::table('outbound_webhooks')
                ->where('tenant_id', $tenantId)
                ->where('is_active', 1)
                ->get();

            foreach ($webhooks as $webhook) {
                $events = json_decode($webhook->events ?? '[]', true);
                if (!is_array($events) || !in_array($eventType, $events, true)) {
                    continue;
                }

                try {
                    // SSRF protection: block webhooks targeting private/internal IPs
                    if (self::isPrivateUrl($webhook->url)) {
                        Log::warning('WebhookDispatchService: SSRF blocked — private URL', ['url' => $webhook->url]);
                        continue;
                    }

                    $body = json_encode([
                        'event' => $eventType,
                        'timestamp' => now()->toIso8601String(),
                        'tenant_id' => $tenantId,
                        'data' => $payload,
                    ]);

                    $result = self::deliver($webhook, (string) $body, $eventType);
                    $ok = self::succeeded($result['http_code']);

                    // Log the delivery attempt
                    DB::table('outbound_webhook_logs')->insert([
                        'tenant_id' => $tenantId,
                        'webhook_id' => $webhook->id,
                        'event_type' => $eventType,
                        'payload' => $body,
                        'response_code' => $result['http_code'],
                        'response_body' => substr($result['response'] !== '' ? $result['response'] : $result['error'], 0, 1000),
                        'status' => $ok ? 'success' : 'failed',
                        'attempt_count' => 1,
                        'next_retry_at' => $ok ? null : now()->addMinutes(self::RETRY_BASE_MINUTES),
                        'created_at' => now(),
                        'attempted_at' => now(),
                    ]);
                    self::recordDeliveryOutcome((int) $tenantId, (int) $webhook->id, $ok);
                } catch (\Exception $e) {
                    self::recordDeliveryOutcome((int) $tenantId, (int) $webhook->id, false);
                    DB::table('outbound_webhook_logs')->insert([
                        'tenant_id' => $tenantId,
                        'webhook_id' => $webhook->id,
                        'event_type' => $eventType,
                        'payload' => json_encode($payload),
                        'response_code' => 0,
                        'response_body' => $e->getMessage(),
                        'status' => 'failed',
                        'attempt_count' => 1,
                        'next_retry_at' => now()->addMinutes(self::RETRY_BASE_MINUTES),
                        'created_at' => now(),
                        'attempted_at' => now(),
                    ]);
                }
            }
        } catch (\Exception $e) {
            Log::error('WebhookDispatchService::dispatch error: ' . $e->getMessage());
        }
    }

    /**
     * Keep outbound_webhooks.failure_count honest: +1 per failed delivery,
     * back to 0 (and last_triggered_at stamped) on a successful one. The admin
     * page reads this count; nothing wrote it before 17 Oct 2026.
     */
    public static function recordDeliveryOutcome(int $tenantId, int $webhookId, bool $succeeded): void
    {
        try {
            $query = DB::table('outbound_webhooks')
                ->where('id', $webhookId)
                ->where('tenant_id', $tenantId);
            if ($succeeded) {
                $query->update(['failure_count' => 0, 'last_triggered_at' => now()]);
            } else {
                $query->update(['failure_count' => DB::raw('failure_count + 1'), 'last_triggered_at' => now()]);
            }
        } catch (\Throwable $e) {
            Log::error('WebhookDispatchService::recordDeliveryOutcome error: ' . $e->getMessage());
        }
    }

    /**
     * All webhooks of a tenant, WITHOUT the signing secret: it is shown once,
     * when created or rotated, and never listed afterwards.
     */
    public static function getWebhooks(?int $tenantId = null): array
    {
        $tenantId ??= TenantContext::getId();

        try {
            return DB::table('outbound_webhooks')
                ->where('tenant_id', $tenantId)
                ->orderByDesc('created_at')
                ->get()
                ->map(function ($row) {
                    $row = (array) $row;
                    unset($row['secret']);
                    $row['events'] = json_decode($row['events'] ?? '[]', true);
                    return $row;
                })
                ->toArray();
        } catch (\Exception $e) {
            Log::error('WebhookDispatchService::getWebhooks error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Create a new webhook. The returned array carries the secret — the only
     * time it is handed out, so the receiving system can be configured.
     *
     * @throws \InvalidArgumentException
     */
    public static function createWebhook(int $userId, array $data, ?int $tenantId = null): array
    {
        $tenantId ??= TenantContext::getId();

        // Validate
        if (empty($data['name'])) {
            throw new \InvalidArgumentException('Webhook name is required.');
        }
        if (empty($data['url']) || !filter_var($data['url'], FILTER_VALIDATE_URL)) {
            throw new \InvalidArgumentException('A valid webhook URL is required.');
        }
        // SSRF protection: reject URLs targeting private/internal IPs at creation time
        if (self::isPrivateUrl($data['url'])) {
            throw new \InvalidArgumentException('Webhook URL must not target private or internal IP addresses.');
        }
        if (empty($data['secret'])) {
            $data['secret'] = self::generateSecret();
        }
        if (empty($data['events']) || !is_array($data['events'])) {
            throw new \InvalidArgumentException('At least one event type is required.');
        }
        self::assertKnownEvents($data['events']);
        self::assertFitsColumns($data);

        $id = DB::table('outbound_webhooks')->insertGetId([
            'tenant_id' => $tenantId,
            'created_by' => $userId,
            'name' => $data['name'],
            'url' => $data['url'],
            'secret' => $data['secret'],
            'events' => json_encode(array_values($data['events'])),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [
            'id' => (int) $id,
            'name' => $data['name'],
            'url' => $data['url'],
            'events' => array_values($data['events']),
            'is_active' => 1,
            'secret' => $data['secret'],
        ];
    }

    private static function generateSecret(): string
    {
        return bin2hex(random_bytes(24));
    }

    /**
     * Only events the platform dispatches may be subscribed to. Offering a
     * name nothing fires is how one community's webhook sat subscribed to
     * twelve events for seven months without receiving one.
     *
     * @param array<int, mixed> $events
     * @throws \InvalidArgumentException
     */
    private static function assertKnownEvents(array $events): void
    {
        foreach ($events as $event) {
            if (!is_string($event) || !in_array($event, self::ALLOWED_EVENTS, true)) {
                throw new \InvalidArgumentException(__('api.webhook_unknown_event', [
                    'event' => is_string($event) ? $event : '?',
                    'events' => implode(', ', self::ALLOWED_EVENTS),
                ]));
            }
        }
    }

    /**
     * E-062 F-327: the connection is non-strict, so a value longer than its
     * column would be silently shortened. A truncated secret can never produce
     * the signature the receiving system computes from the secret the admin
     * actually pasted, so an over-long value is refused rather than stored.
     *
     * @param array<string,mixed> $data
     * @throws \InvalidArgumentException
     */
    private static function assertFitsColumns(array $data): void
    {
        foreach (['name' => 255, 'url' => 2048, 'secret' => 255] as $field => $max) {
            if (!isset($data[$field]) || !is_scalar($data[$field])) {
                continue;
            }
            if (mb_strlen((string) $data[$field]) > $max) {
                throw new \InvalidArgumentException(__('api.field_too_long_with_limit', ['field' => $field, 'max' => $max]));
            }
        }
    }

    /**
     * Update an existing webhook.
     *
     * @throws \InvalidArgumentException
     */
    public static function updateWebhook(int $id, array $data, ?int $tenantId = null): bool
    {
        $tenantId ??= TenantContext::getId();

        // Validate URL if provided
        if (isset($data['url'])) {
            if (!filter_var($data['url'], FILTER_VALIDATE_URL)) {
                throw new \InvalidArgumentException('A valid webhook URL is required.');
            }
            // SSRF protection: reject URLs targeting private/internal IPs at update time
            if (self::isPrivateUrl($data['url'])) {
                throw new \InvalidArgumentException('Webhook URL must not target private or internal IP addresses.');
            }
        }
        self::assertFitsColumns($data);

        $updateData = [];
        $allowedFields = ['name', 'url', 'secret', 'is_active'];

        foreach ($allowedFields as $field) {
            if (array_key_exists($field, $data)) {
                $updateData[$field] = $data[$field];
            }
        }
        if (array_key_exists('is_active', $updateData)) {
            $updateData['is_active'] = filter_var($updateData['is_active'], FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
        }

        if (isset($data['events']) && is_array($data['events'])) {
            self::assertKnownEvents($data['events']);
            $updateData['events'] = json_encode(array_values($data['events']));
        }

        if (empty($updateData)) {
            return false;
        }

        $updateData['updated_at'] = now();

        $affected = DB::table('outbound_webhooks')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($updateData);

        return $affected > 0;
    }

    /**
     * Replace the signing secret and hand the new one out — once.
     *
     * @throws \RuntimeException when the webhook does not exist for the tenant
     */
    public static function rotateSecret(int $id, ?int $tenantId = null): string
    {
        $tenantId ??= TenantContext::getId();
        $secret = self::generateSecret();

        $affected = DB::table('outbound_webhooks')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update(['secret' => $secret, 'updated_at' => now()]);

        if ($affected < 1) {
            throw new \RuntimeException("Webhook not found (id={$id}).");
        }

        return $secret;
    }

    /**
     * Delete a webhook.
     */
    public static function deleteWebhook(int $id, ?int $tenantId = null): bool
    {
        $tenantId ??= TenantContext::getId();

        try {
            // Delete logs first
            DB::table('outbound_webhook_logs')
                ->where('webhook_id', $id)
                ->where('tenant_id', $tenantId)
                ->delete();

            $affected = DB::table('outbound_webhooks')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->delete();

            return $affected > 0;
        } catch (\Exception $e) {
            Log::error('WebhookDispatchService::deleteWebhook error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Test a webhook by sending a test event.
     *
     * @throws \RuntimeException
     */
    public static function testWebhook(int $id, ?int $tenantId = null): array
    {
        $tenantId ??= TenantContext::getId();

        $webhook = DB::table('outbound_webhooks')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$webhook) {
            throw new \RuntimeException("Webhook not found (id={$id}).");
        }

        // SSRF protection: block webhooks targeting private/internal IPs
        if (self::isPrivateUrl($webhook->url)) {
            return [
                'success' => false,
                'http_code' => 0,
                'response' => 'Blocked: webhook URL resolves to a private/internal IP address',
            ];
        }

        $body = json_encode([
            'event' => 'webhook.test',
            'timestamp' => now()->toIso8601String(),
            'tenant_id' => $tenantId,
            'data' => ['message' => __('svc_notifications_2.webhook.test_delivery')],
        ]);

        $result = self::deliver($webhook, (string) $body, 'webhook.test');

        return [
            'success' => self::succeeded($result['http_code']),
            'http_code' => $result['http_code'],
            'response' => $result['response'] !== '' ? $result['response'] : $result['error'],
        ];
    }

    /**
     * Get delivery logs for a webhook.
     */
    public static function getLogs(int $id, array $filters = [], ?int $tenantId = null): array
    {
        $tenantId ??= TenantContext::getId();

        try {
            $query = DB::table('outbound_webhook_logs')
                ->where('webhook_id', $id)
                ->where('tenant_id', $tenantId)
                ->orderByDesc('created_at');

            if (!empty($filters['status'])) {
                $query->where('status', $filters['status']);
            }

            $limit = (int) ($filters['limit'] ?? 50);
            $query->limit($limit);

            return $query->get()
                ->map(fn ($row) => (array) $row)
                ->toArray();
        } catch (\Exception $e) {
            Log::error('WebhookDispatchService::getLogs error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Retry failed deliveries of the last 24 hours that are due and still
     * under their webhook's `max_retries`. Each attempt is counted and the
     * next one scheduled further out (5, 15, 45 … minutes), so a dead
     * endpoint is tried max_retries times and then left alone — until
     * 2026-10-18 it was re-posted on every five-minute tick for a day.
     *
     * @return int Number of deliveries attempted
     */
    public static function retryFailed(?int $tenantId = null): int
    {
        $tenantId ??= TenantContext::getId();
        $retried = 0;

        try {
            $due = DB::table('outbound_webhook_logs as l')
                ->join('outbound_webhooks as w', function ($join): void {
                    $join->on('w.id', '=', 'l.webhook_id')
                        ->on('w.tenant_id', '=', 'l.tenant_id');
                })
                ->where('l.tenant_id', $tenantId)
                ->where('l.status', 'failed')
                ->where('l.created_at', '>=', now()->subHours(24))
                ->where('w.is_active', 1)
                ->whereColumn('l.attempt_count', '<', 'w.max_retries')
                ->where(function ($q): void {
                    $q->whereNull('l.next_retry_at')
                        ->orWhere('l.next_retry_at', '<=', now());
                })
                ->orderBy('l.created_at')
                ->limit(50)
                ->get([
                    'l.id', 'l.webhook_id', 'l.payload', 'l.event_type', 'l.attempt_count',
                    'w.url', 'w.secret',
                ]);

            foreach ($due as $log) {
                // SSRF protection: re-check on retry (DNS rebinding defense)
                if (self::isPrivateUrl((string) $log->url)) {
                    Log::warning('WebhookDispatchService: SSRF blocked on retry — private URL', ['url' => $log->url]);
                    continue;
                }

                $attempt = (int) $log->attempt_count + 1;

                try {
                    $result = self::deliver($log, (string) $log->payload, (string) ($log->event_type ?? 'retry'));
                    $ok = self::succeeded($result['http_code']);

                    DB::table('outbound_webhook_logs')
                        ->where('id', $log->id)
                        ->update([
                            'status' => $ok ? 'success' : 'failed',
                            'response_code' => $result['http_code'],
                            'response_body' => substr($result['response'] !== '' ? $result['response'] : $result['error'], 0, 1000),
                            'attempt_count' => $attempt,
                            'attempted_at' => now(),
                            'next_retry_at' => $ok ? null : now()->addMinutes(self::RETRY_BASE_MINUTES * (3 ** ($attempt - 1))),
                        ]);
                    self::recordDeliveryOutcome((int) $tenantId, (int) $log->webhook_id, $ok);

                    $retried++;
                } catch (\Exception $e) {
                    DB::table('outbound_webhook_logs')
                        ->where('id', $log->id)
                        ->update([
                            'attempt_count' => $attempt,
                            'attempted_at' => now(),
                            'response_body' => substr($e->getMessage(), 0, 1000),
                            'next_retry_at' => now()->addMinutes(self::RETRY_BASE_MINUTES * (3 ** ($attempt - 1))),
                        ]);
                }
            }
        } catch (\Exception $e) {
            Log::error('WebhookDispatchService::retryFailed error: ' . $e->getMessage());
        }

        return $retried;
    }
}
