<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PartnerApi;

use App\Core\TenantContext;
use App\Support\OutboundUrlGuard;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * AG60 — Partner webhook subscription dispatcher.
 *
 * Mirrors the existing internal WebhookDispatchService but targets the
 * partner-managed api_webhook_subscriptions table. Each delivery is signed
 * with HMAC-SHA256 over the JSON body and sent in `X-Signature: sha256=<hex>`.
 *
 * Reuses WebhookDispatchService::isPrivateUrl() for SSRF protection so
 * partners can't subscribe a webhook to internal RFC1918 addresses.
 */
class PartnerWebhookDispatcher
{
    public static function createSubscription(
        int $partnerId,
        array $eventTypes,
        string $targetUrl,
    ): array {
        if (! OutboundUrlGuard::isSafeHttpUrl($targetUrl, requireHttps: true)) {
            throw new \InvalidArgumentException('target_url_private');
        }

        $tenantId = TenantContext::getId();
        $secret = 'whsec_' . Str::random(48);

        $id = DB::table('api_webhook_subscriptions')->insertGetId([
            'partner_id' => $partnerId,
            'tenant_id' => $tenantId,
            'event_types' => json_encode(array_values($eventTypes)),
            'target_url' => $targetUrl,
            'secret' => $secret,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [
            'id' => $id,
            'event_types' => $eventTypes,
            'target_url' => $targetUrl,
            'secret' => $secret, // shown once
        ];
    }

    public static function listForPartner(int $partnerId): array
    {
        $tenantId = TenantContext::getId();
        return DB::table('api_webhook_subscriptions')
            ->where('partner_id', $partnerId)
            ->where('tenant_id', $tenantId)
            ->orderBy('id', 'desc')
            ->get()
            ->map(fn ($row) => [
                'id' => (int) $row->id,
                'event_types' => json_decode((string) $row->event_types, true) ?: [],
                'target_url' => $row->target_url,
                'status' => $row->status,
                'last_delivery_at' => $row->last_delivery_at,
                'failure_count' => (int) $row->failure_count,
            ])->all();
    }

    /**
     * Dispatch an event to all active partner subscriptions matching the type.
     */
    public static function dispatch(string $eventType, array $payload, ?int $partnerId = null): void
    {
        // Partner API kill switch — this is the outbound half of the AG60
        // surface and posts directly with raw Http::, so it is not covered by
        // any inbound gate. Returning early sends nothing; subscriptions and
        // their delivery config are untouched and resume on re-enable.
        if (! app(PartnerApiKillSwitch::class)->isEnabled()) {
            return;
        }

        $tenantId = TenantContext::getId();
        $query = DB::table('api_webhook_subscriptions')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active');

        if ($partnerId !== null) {
            $query->where('partner_id', $partnerId);
        }

        $subs = $query->get();

        foreach ($subs as $sub) {
            $events = json_decode((string) $sub->event_types, true) ?: [];
            if (! in_array($eventType, $events, true) && ! in_array('*', $events, true)) {
                continue;
            }

            if (! OutboundUrlGuard::isSafeHttpUrl($sub->target_url, requireHttps: true)) {
                Log::warning('partner_webhook.unsafe_url_blocked', [
                    'subscription_id' => $sub->id,
                    'event' => $eventType,
                    'target_url' => $sub->target_url,
                ]);
                self::recordFailure((int) $sub->id);
                continue;
            }

            $body = json_encode([
                'event' => $eventType,
                'data' => $payload,
                'delivered_at' => now()->toIso8601String(),
            ]);
            $signature = hash_hmac('sha256', $body ?: '', $sub->secret);

            try {
                $response = Http::timeout(10)
                    ->withOptions(OutboundUrlGuard::httpClientOptions($sub->target_url, requireHttps: true))
                    ->withHeaders([
                        'Content-Type' => 'application/json',
                        'X-Signature' => 'sha256=' . $signature,
                        'X-Event-Type' => $eventType,
                    ])
                    ->send('POST', $sub->target_url, ['body' => $body]);

                if ($response->successful()) {
                    DB::table('api_webhook_subscriptions')
                        ->where('id', $sub->id)
                        ->update([
                            'last_delivery_at' => now(),
                            'failure_count' => 0,
                            'updated_at' => now(),
                        ]);
                } else {
                    self::recordFailure((int) $sub->id);
                }
            } catch (\Throwable $e) {
                Log::warning('partner_webhook.delivery_failed', [
                    'subscription_id' => $sub->id,
                    'event' => $eventType,
                    'error' => $e->getMessage(),
                ]);
                self::recordFailure((int) $sub->id);
            }
        }
    }

    private static function recordFailure(int $subId): void
    {
        DB::table('api_webhook_subscriptions')
            ->where('id', $subId)
            ->update([
                'failure_count' => DB::raw('failure_count + 1'),
                'updated_at' => now(),
            ]);

        // Pause subscriptions after too many failures
        DB::table('api_webhook_subscriptions')
            ->where('id', $subId)
            ->where('failure_count', '>=', 25)
            ->update(['status' => 'failed']);
    }
}
