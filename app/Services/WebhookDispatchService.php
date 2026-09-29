<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Support\OutboundUrlGuard;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * WebhookDispatchService — Outbound webhook management and dispatch.
 *
 * Manages CRUD for outbound webhooks and dispatches events to registered URLs.
 * All queries are tenant-scoped via TenantContext::getId().
 */
class WebhookDispatchService
{
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

    /**
     * Dispatch an event to all matching webhooks.
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

                    $signature = hash_hmac('sha256', $body, $webhook->secret ?? '');

                    $ch = curl_init($webhook->url);
                    curl_setopt_array($ch, OutboundUrlGuard::curlOptionsForUrl($webhook->url) + [
                        CURLOPT_POST => true,
                        CURLOPT_POSTFIELDS => $body,
                        CURLOPT_HTTPHEADER => [
                            'Content-Type: application/json',
                            'X-Webhook-Signature: ' . $signature,
                            'X-Webhook-Event: ' . $eventType,
                        ],
                        CURLOPT_RETURNTRANSFER => true,
                        CURLOPT_TIMEOUT => 10,
                    ]);

                    $response = curl_exec($ch);
                    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                    $error = curl_error($ch);
                    curl_close($ch);

                    // Log the delivery attempt
                    DB::table('outbound_webhook_logs')->insert([
                        'tenant_id' => $tenantId,
                        'webhook_id' => $webhook->id,
                        'event_type' => $eventType,
                        'payload' => $body,
                        'response_code' => $httpCode,
                        'response_body' => substr($response ?: $error, 0, 1000),
                        'status' => ($httpCode >= 200 && $httpCode < 300) ? 'success' : 'failed',
                        'created_at' => now(),
                    ]);
                } catch (\Exception $e) {
                    DB::table('outbound_webhook_logs')->insert([
                        'tenant_id' => $tenantId,
                        'webhook_id' => $webhook->id,
                        'event_type' => $eventType,
                        'payload' => json_encode($payload),
                        'response_code' => 0,
                        'response_body' => $e->getMessage(),
                        'status' => 'failed',
                        'created_at' => now(),
                    ]);
                }
            }
        } catch (\Exception $e) {
            Log::error('WebhookDispatchService::dispatch error: ' . $e->getMessage());
        }
    }

    /**
     * Get all webhooks for the current tenant.
     */
    public static function getWebhooks(): array
    {
        $tenantId = TenantContext::getId();

        try {
            return DB::table('outbound_webhooks')
                ->where('tenant_id', $tenantId)
                ->orderByDesc('created_at')
                ->get()
                ->map(function ($row) {
                    $row = (array) $row;
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
     * Create a new webhook.
     *
     * @throws \InvalidArgumentException
     */
    public static function createWebhook(int $userId, array $data): array
    {
        $tenantId = TenantContext::getId();

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
            $data['secret'] = bin2hex(random_bytes(24));
        }
        if (empty($data['events']) || !is_array($data['events'])) {
            throw new \InvalidArgumentException('At least one event type is required.');
        }
        self::assertFitsColumns($data);

        $id = DB::table('outbound_webhooks')->insertGetId([
            'tenant_id' => $tenantId,
            'created_by' => $userId,
            'name' => $data['name'],
            'url' => $data['url'],
            'secret' => $data['secret'],
            'events' => json_encode($data['events']),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [
            'id' => (int) $id,
            'name' => $data['name'],
            'url' => $data['url'],
            'events' => $data['events'],
            'is_active' => 1,
        ];
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
    public static function updateWebhook(int $id, array $data): bool
    {
        $tenantId = TenantContext::getId();

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

        if (isset($data['events']) && is_array($data['events'])) {
            $updateData['events'] = json_encode($data['events']);
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
     * Delete a webhook.
     */
    public static function deleteWebhook(int $id): bool
    {
        $tenantId = TenantContext::getId();

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
    public static function testWebhook(int $id): array
    {
        $tenantId = TenantContext::getId();

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

        $signature = hash_hmac('sha256', $body, $webhook->secret ?? '');

        $ch = curl_init($webhook->url);
        curl_setopt_array($ch, OutboundUrlGuard::curlOptionsForUrl($webhook->url) + [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'X-Webhook-Signature: ' . $signature,
                'X-Webhook-Event: webhook.test',
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        return [
            'success' => $httpCode >= 200 && $httpCode < 300,
            'http_code' => $httpCode,
            'response' => $response ?: $error,
        ];
    }

    /**
     * Get delivery logs for a webhook.
     */
    public static function getLogs(int $id, array $filters = []): array
    {
        $tenantId = TenantContext::getId();

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
     * Retry failed webhook deliveries.
     *
     * @return int Number of retried deliveries
     */
    public static function retryFailed(): int
    {
        $tenantId = TenantContext::getId();
        $retried = 0;

        try {
            $failedLogs = DB::table('outbound_webhook_logs')
                ->where('tenant_id', $tenantId)
                ->where('status', 'failed')
                ->where('created_at', '>=', now()->subHours(24))
                ->orderBy('created_at')
                ->limit(50)
                ->get();

            foreach ($failedLogs as $log) {
                $webhook = DB::table('outbound_webhooks')
                    ->where('id', $log->webhook_id)
                    ->where('tenant_id', $tenantId)
                    ->where('is_active', 1)
                    ->first();

                if (!$webhook) {
                    continue;
                }

                // SSRF protection: re-check on retry (DNS rebinding defense)
                if (self::isPrivateUrl($webhook->url)) {
                    Log::warning('WebhookDispatchService: SSRF blocked on retry — private URL', ['url' => $webhook->url]);
                    continue;
                }

                try {
                    $signature = hash_hmac('sha256', $log->payload, $webhook->secret ?? '');

                    $ch = curl_init($webhook->url);
                    curl_setopt_array($ch, OutboundUrlGuard::curlOptionsForUrl($webhook->url) + [
                        CURLOPT_POST => true,
                        CURLOPT_POSTFIELDS => $log->payload,
                        CURLOPT_HTTPHEADER => [
                            'Content-Type: application/json',
                            'X-Webhook-Signature: ' . $signature,
                            'X-Webhook-Event: ' . ($log->event_type ?? 'retry'),
                        ],
                        CURLOPT_RETURNTRANSFER => true,
                        CURLOPT_TIMEOUT => 10,
                    ]);

                    $response = curl_exec($ch);
                    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                    curl_close($ch);

                    $newStatus = ($httpCode >= 200 && $httpCode < 300) ? 'success' : 'failed';

                    DB::table('outbound_webhook_logs')
                        ->where('id', $log->id)
                        ->update([
                            'status' => $newStatus,
                            'response_code' => $httpCode,
                            'response_body' => substr($response ?: '', 0, 1000),
                        ]);

                    $retried++;
                } catch (\Exception $e) {
                    // Skip failed retries
                }
            }
        } catch (\Exception $e) {
            Log::error('WebhookDispatchService::retryFailed error: ' . $e->getMessage());
        }

        return $retried;
    }
}
