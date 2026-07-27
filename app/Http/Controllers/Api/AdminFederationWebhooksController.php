<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\FederationFeatureService;
use App\Support\OutboundUrlGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * AdminFederationWebhooksController -- CRUD for federation webhook management.
 *
 * Manages webhook subscriptions, delivery testing, logs, and retries.
 */
class AdminFederationWebhooksController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * All supported webhook event types.
     */
    private const VALID_EVENTS = [
        'partnership.requested',
        'partnership.approved',
        'partnership.rejected',
        'partnership.terminated',
        'member.opted_in',
        'member.opted_out',
        'message.sent',
        'message.received',
        'transaction.created',
        'transaction.completed',
        'connection.requested',
        'connection.accepted',
        'listing.shared',
    ];

    /**
     * GET /api/v2/admin/federation/webhooks
     *
     * List all webhooks for the current tenant.
     */
    public function index(): JsonResponse
    {
        $this->requireSuperAdmin();
        $tenantId = $this->getTenantId();

        try {
            $webhooks = DB::table('federation_webhooks')
                ->where('tenant_id', $tenantId)
                ->select('id', 'tenant_id', 'url', 'events', 'status', 'description', 'consecutive_failures', 'last_triggered_at', 'last_success_at', 'last_failure_at', 'last_failure_reason', 'created_by', 'created_at', 'updated_at')
                ->orderByDesc('created_at')
                ->get()
                ->map(function ($row) {
                    $row->events = json_decode($row->events, true) ?? [];
                    return $row;
                })
                ->toArray();

            return $this->respondWithData($webhooks);
        } catch (\Exception $e) {
            return $this->respondWithError('FETCH_FAILED', __('api.webhooks_fetch_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/admin/federation/webhooks
     *
     * Create a new webhook. Generates a signing secret automatically.
     */
    public function store(): JsonResponse
    {
        $adminId = $this->requireSuperAdmin();
        $tenantId = $this->getTenantId();
        $input = $this->getAllInput();

        // Validate URL
        $url = trim($input['url'] ?? '');
        if (!$url || !filter_var($url, FILTER_VALIDATE_URL)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.valid_url_required'), 'url', 422);
        }
        if (!str_starts_with($url, 'https://')) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.url_must_use_https'), 'url', 422);
        }

        // SSRF protection: reject URLs targeting private/internal IPs
        if (!OutboundUrlGuard::isSafeHttpUrl($url, requireHttps: true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.url_no_private_ip'), 'url', 422);
        }

        // Validate events
        $events = $input['events'] ?? [];
        if (!is_array($events) || empty($events)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.at_least_one_event_type'), 'events', 422);
        }
        $invalidEvents = array_diff($events, self::VALID_EVENTS);
        if (!empty($invalidEvents)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_event_types', ['types' => implode(', ', $invalidEvents)]), 'events', 422);
        }

        // Generate signing secret
        $secret = 'whsec_' . Str::random(40);

        try {
            $id = DB::table('federation_webhooks')->insertGetId([
                'tenant_id' => $tenantId,
                'url' => $url,
                'secret' => $secret,
                'events' => json_encode(array_values($events)),
                'status' => 'active',
                'description' => trim($input['description'] ?? '') ?: null,
                'consecutive_failures' => 0,
                'created_by' => $adminId,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            return $this->respondWithData([
                'id' => $id,
                'secret' => $secret,
            ], null, 201);
        } catch (\Exception $e) {
            return $this->respondWithError('CREATE_FAILED', __('api.webhook_create_failed'), null, 500);
        }
    }

    /**
     * PUT /api/v2/admin/federation/webhooks/{id}
     *
     * Update an existing webhook.
     */
    public function update(int $id): JsonResponse
    {
        $this->requireSuperAdmin();
        $tenantId = $this->getTenantId();
        $input = $this->getAllInput();

        // Verify webhook exists and belongs to tenant
        $webhook = DB::table('federation_webhooks')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$webhook) {
            return $this->respondWithError('NOT_FOUND', __('api.webhook_not_found'), null, 404);
        }

        $updates = [];

        // URL
        if (isset($input['url'])) {
            $url = trim($input['url']);
            if (!$url || !filter_var($url, FILTER_VALIDATE_URL)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.valid_url_required'), 'url', 422);
            }
            if (!str_starts_with($url, 'https://')) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.url_must_use_https'), 'url', 422);
            }
            // SSRF protection: reject URLs targeting private/internal IPs
            if (!OutboundUrlGuard::isSafeHttpUrl($url, requireHttps: true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.url_no_private_ip'), 'url', 422);
            }
            $updates['url'] = $url;
        }

        // Events
        if (isset($input['events'])) {
            $events = $input['events'];
            if (!is_array($events) || empty($events)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.at_least_one_event_type'), 'events', 422);
            }
            $invalidEvents = array_diff($events, self::VALID_EVENTS);
            if (!empty($invalidEvents)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_event_types', ['types' => implode(', ', $invalidEvents)]), 'events', 422);
            }
            $updates['events'] = json_encode(array_values($events));
        }

        // Status
        if (isset($input['status']) && in_array($input['status'], ['active', 'inactive'], true)) {
            $updates['status'] = $input['status'];
            // Reset failure counter when reactivating
            if ($input['status'] === 'active') {
                $updates['consecutive_failures'] = 0;
                $updates['last_failure_reason'] = null;
            }
        }

        // Description
        if (array_key_exists('description', $input)) {
            $updates['description'] = trim($input['description'] ?? '') ?: null;
        }

        if (empty($updates)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_valid_fields'), null, 422);
        }

        $updates['updated_at'] = now();

        try {
            DB::table('federation_webhooks')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update($updates);

            return $this->respondWithData(['id' => $id]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.webhook_update_failed'), null, 500);
        }
    }

    /**
     * DELETE /api/v2/admin/federation/webhooks/{id}
     *
     * Delete a webhook and all its delivery logs.
     */
    public function destroy(int $id): JsonResponse
    {
        $this->requireSuperAdmin();
        $tenantId = $this->getTenantId();

        $webhook = DB::table('federation_webhooks')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$webhook) {
            return $this->respondWithError('NOT_FOUND', __('api.webhook_not_found'), null, 404);
        }

        try {
            // Delete logs first, then webhook
            DB::table('federation_webhook_logs')
                ->where('webhook_id', $id)
                ->where('tenant_id', $tenantId)
                ->delete();

            DB::table('federation_webhooks')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->delete();

            return $this->respondWithData(['deleted' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('DELETE_FAILED', __('api.webhook_delete_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/admin/federation/webhooks/{id}/test
     *
     * Send a test payload to the webhook URL and log the result.
     */
    public function test(int $id): JsonResponse
    {
        $this->requireSuperAdmin();
        $tenantId = $this->getTenantId();

        $webhook = DB::table('federation_webhooks')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$webhook) {
            return $this->respondWithError('NOT_FOUND', __('api.webhook_not_found'), null, 404);
        }

        // SSRF protection: re-check at dispatch time (DNS rebinding defense)
        if (!OutboundUrlGuard::isSafeHttpUrl($webhook->url, requireHttps: true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.webhook_private_ip'), 'url', 422);
        }

        // External federation kill switch — tell the admin why the button did
        // nothing rather than silently reporting a delivery failure.
        if (!app(FederationFeatureService::class)
            ->isExternalProtocolEnabled(FederationFeatureService::EXTERNAL_PROTOCOL_WEBHOOKS)) {
            return $this->respondWithError(
                'FEDERATION_EXTERNAL_DISABLED',
                __('api.federation.external_outbound_disabled'),
                null,
                503,
            );
        }

        $payload = [
            'event' => 'test',
            'timestamp' => now()->toIso8601String(),
            'data' => [
                'message' => __('api_controllers_3.federation_webhooks.test_message'),
                'webhook_id' => $id,
            ],
        ];

        $payloadJson = json_encode($payload);
        $signature = hash_hmac('sha256', $payloadJson, $webhook->secret);

        $startTime = microtime(true);
        $responseCode = null;
        $responseBody = null;
        $success = false;
        $errorMessage = null;

        try {
            $response = Http::timeout(10)
                ->withOptions(OutboundUrlGuard::httpClientOptions($webhook->url, requireHttps: true))
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'X-Nexus-Signature' => $signature,
                    'X-Nexus-Event' => 'test',
                    'X-Nexus-Webhook-Id' => (string) $id,
                ])
                ->post($webhook->url, $payload);

            $responseCode = $response->status();
            $responseBody = $response->body();
            $success = $response->successful();

            if (!$success) {
                $errorMessage = "HTTP {$responseCode}";
            }
        } catch (\Exception $e) {
            $errorMessage = $e->getMessage();
        }

        $elapsed = (int) round((microtime(true) - $startTime) * 1000);

        // Log the test delivery
        DB::table('federation_webhook_logs')->insert([
            'webhook_id' => $id,
            'tenant_id' => $tenantId,
            'event_type' => 'test',
            'payload' => $payloadJson,
            'response_code' => $responseCode,
            'response_body' => $responseBody ? mb_substr($responseBody, 0, 5000) : null,
            'response_time_ms' => $elapsed,
            'success' => $success ? 1 : 0,
            'error_message' => $errorMessage ? mb_substr($errorMessage, 0, 500) : null,
            'attempt_number' => 1,
            'created_at' => now(),
        ]);

        // Update webhook timestamps
        $webhookUpdates = ['last_triggered_at' => now()];
        if ($success) {
            $webhookUpdates['last_success_at'] = now();
            $webhookUpdates['consecutive_failures'] = 0;
            if ($webhook->status === 'failing') {
                $webhookUpdates['status'] = 'active';
            }
        } else {
            $webhookUpdates['last_failure_at'] = now();
            $webhookUpdates['last_failure_reason'] = $errorMessage;
            $webhookUpdates['consecutive_failures'] = $webhook->consecutive_failures + 1;
            if ($webhook->consecutive_failures + 1 >= 5) {
                $webhookUpdates['status'] = 'failing';
            }
        }

        DB::table('federation_webhooks')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($webhookUpdates);

        if ($success) {
            return $this->respondWithData([
                'success' => true,
                'response_code' => $responseCode,
                'response_time_ms' => $elapsed,
            ]);
        }

        return $this->respondWithError('TEST_FAILED', $errorMessage ?? __('api.webhook_test_failed'),
            null,
            502
        );
    }

    /**
     * GET /api/v2/admin/federation/webhooks/{id}/logs
     *
     * Get delivery logs for a webhook.
     */
    public function logs(int $id): JsonResponse
    {
        $this->requireSuperAdmin();
        $tenantId = $this->getTenantId();

        // Verify webhook exists and belongs to tenant
        $webhook = DB::table('federation_webhooks')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$webhook) {
            return $this->respondWithError('NOT_FOUND', __('api.webhook_not_found'), null, 404);
        }

        try {
            $logs = DB::table('federation_webhook_logs')
                ->where('webhook_id', $id)
                ->where('tenant_id', $tenantId)
                ->orderByDesc('created_at')
                ->limit(100)
                ->get()
                ->map(function ($row) {
                    // Parse payload JSON for frontend display
                    if (is_string($row->payload)) {
                        $row->payload = json_decode($row->payload, true) ?? [];
                    }
                    $row->success = (bool) $row->success;
                    return $row;
                })
                ->toArray();

            return $this->respondWithData($logs);
        } catch (\Exception $e) {
            return $this->respondWithError('FETCH_FAILED', __('api.webhook_logs_fetch_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/admin/federation/webhook-logs/{id}/retry
     *
     * Retry a failed webhook delivery.
     */
    public function retry(int $logId): JsonResponse
    {
        $this->requireSuperAdmin();
        $tenantId = $this->getTenantId();

        // Get the log entry
        $log = DB::table('federation_webhook_logs')
            ->where('id', $logId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$log) {
            return $this->respondWithError('NOT_FOUND', __('api.log_not_found'), null, 404);
        }

        if ($log->success) {
            return $this->respondWithError('ALREADY_SUCCEEDED', __('api.delivery_already_succeeded'), null, 422);
        }

        // Get the parent webhook
        $webhook = DB::table('federation_webhooks')
            ->where('id', $log->webhook_id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$webhook) {
            return $this->respondWithError('NOT_FOUND', __('api.parent_webhook_not_found'), null, 404);
        }

        // SSRF protection: re-check at dispatch time (DNS rebinding defense)
        if (!OutboundUrlGuard::isSafeHttpUrl($webhook->url, requireHttps: true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.webhook_private_ip'), 'url', 422);
        }

        // External federation kill switch — tell the admin why the button did
        // nothing rather than silently reporting a delivery failure.
        if (!app(FederationFeatureService::class)
            ->isExternalProtocolEnabled(FederationFeatureService::EXTERNAL_PROTOCOL_WEBHOOKS)) {
            return $this->respondWithError(
                'FEDERATION_EXTERNAL_DISABLED',
                __('api.federation.external_outbound_disabled'),
                null,
                503,
            );
        }

        // Re-send the original payload
        $payloadJson = is_string($log->payload) ? $log->payload : json_encode($log->payload);
        $signature = hash_hmac('sha256', $payloadJson, $webhook->secret);

        $startTime = microtime(true);
        $responseCode = null;
        $responseBody = null;
        $success = false;
        $errorMessage = null;

        try {
            $response = Http::timeout(10)
                ->withOptions(OutboundUrlGuard::httpClientOptions($webhook->url, requireHttps: true))
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'X-Nexus-Signature' => $signature,
                    'X-Nexus-Event' => $log->event_type,
                    'X-Nexus-Webhook-Id' => (string) $webhook->id,
                    'X-Nexus-Retry' => 'true',
                ])
                ->post($webhook->url, json_decode($payloadJson, true));

            $responseCode = $response->status();
            $responseBody = $response->body();
            $success = $response->successful();

            if (!$success) {
                $errorMessage = "HTTP {$responseCode}";
            }
        } catch (\Exception $e) {
            $errorMessage = $e->getMessage();
        }

        $elapsed = (int) round((microtime(true) - $startTime) * 1000);

        // Log the retry as a new entry
        $newLogId = DB::table('federation_webhook_logs')->insertGetId([
            'webhook_id' => $webhook->id,
            'tenant_id' => $tenantId,
            'event_type' => $log->event_type,
            'payload' => $payloadJson,
            'response_code' => $responseCode,
            'response_body' => $responseBody ? mb_substr($responseBody, 0, 5000) : null,
            'response_time_ms' => $elapsed,
            'success' => $success ? 1 : 0,
            'error_message' => $errorMessage ? mb_substr($errorMessage, 0, 500) : null,
            'attempt_number' => $log->attempt_number + 1,
            'created_at' => now(),
        ]);

        // Update webhook timestamps
        $webhookUpdates = ['last_triggered_at' => now()];
        if ($success) {
            $webhookUpdates['last_success_at'] = now();
            $webhookUpdates['consecutive_failures'] = 0;
            if ($webhook->status === 'failing') {
                $webhookUpdates['status'] = 'active';
            }
        } else {
            $webhookUpdates['last_failure_at'] = now();
            $webhookUpdates['last_failure_reason'] = $errorMessage;
            $webhookUpdates['consecutive_failures'] = $webhook->consecutive_failures + 1;
        }

        DB::table('federation_webhooks')
            ->where('id', $webhook->id)
            ->where('tenant_id', $tenantId)
            ->update($webhookUpdates);

        return $this->respondWithData([
            'success' => $success,
            'log_id' => $newLogId,
            'response_code' => $responseCode,
            'response_time_ms' => $elapsed,
            'error_message' => $errorMessage,
        ]);
    }
}
