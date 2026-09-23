<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CronJobRunner;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-038 residual: plain notification snippets become an HTML email body when
 * a producer did not supply a prepared body. The conversion must preserve
 * text and line breaks without letting member text create working markup.
 */
class NotificationQueueHtmlFallbackTest extends TestCase
{
    use DatabaseTransactions;

    private const HOSTILE_SNIPPET = "Anna<a href=\"https://evil.example/login\">Verify</a>\nNew line";

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        Cache::forget('notification_queue:instant:runner_lock');
        DB::table('notification_queue')->delete();
    }

    public function test_internal_instant_runner_escapes_plain_text_fallback_before_html_delivery(): void
    {
        [$mailer, $queueId] = $this->prepareHostileQueueItem();

        $method = new \ReflectionMethod(CronJobRunner::class, 'runInstantQueueInternal');
        $method->setAccessible(true);
        ob_start();
        try {
            $method->invoke(new CronJobRunner());
        } finally {
            ob_end_clean();
        }

        $this->assertSafeDelivery($mailer, $queueId);
    }

    /**
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_public_instant_runner_escapes_plain_text_fallback_before_html_delivery(): void
    {
        if (!defined('CRON_INTERNAL_RUN')) {
            define('CRON_INTERNAL_RUN', true);
        }
        [$mailer, $queueId] = $this->prepareHostileQueueItem();

        ob_start();
        try {
            (new CronJobRunner())->runInstantQueue();
        } finally {
            ob_end_clean();
        }

        $this->assertSafeDelivery($mailer, $queueId);
    }

    /** @return array{0:EmailDispatchService,1:int} */
    private function prepareHostileQueueItem(): array
    {
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => 'en',
            'email' => 'f038-queue-' . uniqid('', true) . '@example.test',
        ]);
        $mailer = new class extends EmailDispatchService {
            /** @var list<array{to:string,subject:string,body:string,options:array<string,mixed>}> */
            public array $calls = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body', 'options');

                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $mailer);

        $queueId = (int) DB::table('notification_queue')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $recipient->id,
            'activity_type' => 'connection_request',
            'content_snippet' => self::HOSTILE_SNIPPET,
            'link' => '/connections',
            'frequency' => 'instant',
            'email_body' => null,
            'status' => 'pending',
            'created_at' => now(),
        ]);

        return [$mailer, $queueId];
    }

    private function assertSafeDelivery(EmailDispatchService $mailer, int $queueId): void
    {
        $this->assertCount(1, $mailer->calls);
        $body = $mailer->calls[0]['body'];
        $this->assertStringContainsString(
            'Anna&lt;a href=&quot;https://evil.example/login&quot;&gt;Verify&lt;/a&gt;',
            $body,
        );
        $this->assertStringNotContainsString('<a href="https://evil.example', $body);
        $this->assertStringContainsString("<br>\nNew line", $body);
        $this->assertDatabaseHas('notification_queue', ['id' => $queueId, 'status' => 'sent']);
    }
}
