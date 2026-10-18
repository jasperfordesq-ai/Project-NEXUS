<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Integrations;

use App\Core\TenantContext;
use App\Services\WebhookDispatchService;
use App\Support\OutboundWebhookTransport;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Until 2026-10-18 `retryFailed()` re-posted every failed delivery of the last
 * 24 hours on every five-minute cron tick, forever: it never touched
 * `attempt_count`, `next_retry_at` or `outbound_webhooks.max_retries`. A dead
 * endpoint was hammered ~288 times a day. The retry now counts attempts, waits
 * between them, and stops at the webhook's `max_retries`.
 */
final class WebhookRetryCapTest extends TestCase
{
    use DatabaseTransactions;

    private CountingTransport $transport;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->transport = new CountingTransport();
        $this->app->instance(OutboundWebhookTransport::class, $this->transport);
    }

    private function webhook(int $maxRetries): int
    {
        return (int) DB::table('outbound_webhooks')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Retry cap hook',
            'url' => 'https://93.184.216.34/hook',
            'secret' => 'retry-cap-secret',
            'events' => json_encode(['shift.completed']),
            'is_active' => 1,
            'max_retries' => $maxRetries,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function failedLog(int $webhookId, int $attemptCount, ?string $nextRetryAt = null): int
    {
        return (int) DB::table('outbound_webhook_logs')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'webhook_id' => $webhookId,
            'event_type' => 'shift.completed',
            'payload' => json_encode(['event' => 'shift.completed', 'data' => ['shift_id' => 1]]),
            'response_code' => 500,
            'response_body' => 'boom',
            'status' => 'failed',
            'attempt_count' => $attemptCount,
            'next_retry_at' => $nextRetryAt,
            'created_at' => now()->subMinutes(10),
            'attempted_at' => now()->subMinutes(10),
        ]);
    }

    public function test_a_retry_counts_the_attempt_and_schedules_the_next_one(): void
    {
        $webhookId = $this->webhook(3);
        $logId = $this->failedLog($webhookId, 1);
        $this->transport->httpCode = 500;

        $retried = WebhookDispatchService::retryFailed($this->testTenantId);

        $this->assertSame(1, $retried);
        $this->assertSame(1, $this->transport->calls);
        $row = DB::table('outbound_webhook_logs')->where('id', $logId)->first();
        $this->assertSame(2, (int) $row->attempt_count);
        $this->assertSame('failed', $row->status);
        $this->assertNotNull($row->next_retry_at, 'the next attempt is scheduled, not immediate');
        $this->assertGreaterThan(now()->timestamp, strtotime((string) $row->next_retry_at));
    }

    public function test_a_retry_is_not_attempted_before_its_scheduled_time(): void
    {
        $webhookId = $this->webhook(3);
        $this->failedLog($webhookId, 2, now()->addMinutes(30)->toDateTimeString());

        $retried = WebhookDispatchService::retryFailed($this->testTenantId);

        $this->assertSame(0, $retried);
        $this->assertSame(0, $this->transport->calls);
    }

    public function test_a_delivery_at_max_retries_is_left_alone(): void
    {
        $webhookId = $this->webhook(3);
        $logId = $this->failedLog($webhookId, 3, now()->subMinute()->toDateTimeString());

        $retried = WebhookDispatchService::retryFailed($this->testTenantId);

        $this->assertSame(0, $retried);
        $this->assertSame(0, $this->transport->calls, 'a dead endpoint must stop being hammered');
        $this->assertSame(3, (int) DB::table('outbound_webhook_logs')->where('id', $logId)->value('attempt_count'));
    }

    public function test_a_successful_retry_marks_the_delivery_sent(): void
    {
        $webhookId = $this->webhook(3);
        $logId = $this->failedLog($webhookId, 1);
        $this->transport->httpCode = 200;

        WebhookDispatchService::retryFailed($this->testTenantId);

        $row = DB::table('outbound_webhook_logs')->where('id', $logId)->first();
        $this->assertSame('success', $row->status);
        $this->assertSame(200, (int) $row->response_code);
        $this->assertSame(0, (int) DB::table('outbound_webhooks')->where('id', $webhookId)->value('failure_count'));
    }
}

/** Counts deliveries and answers with a chosen status; nothing leaves the process. */
final class CountingTransport extends OutboundWebhookTransport
{
    public int $calls = 0;

    public int $httpCode = 500;

    public function post(string $url, string $body, array $headers): array
    {
        $this->calls++;

        return ['http_code' => $this->httpCode, 'response' => 'answer', 'error' => ''];
    }
}
