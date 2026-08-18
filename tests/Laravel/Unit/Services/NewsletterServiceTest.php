<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Models\Newsletter;
use App\Models\Tenant;
use App\Models\User;
use App\Core\TenantContext;
use App\Services\NewsletterService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Mockery;
use Tests\Laravel\TestCase;

class NewsletterServiceTest extends TestCase
{
    use DatabaseTransactions;

    private NewsletterService $service;
    private $mockNewsletter;
    private int $isolatedTenantSeq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mockNewsletter = Mockery::mock(Newsletter::class)->makePartial();
        $this->service = new NewsletterService($this->mockNewsletter);
    }

    private function useIsolatedTenant(): int
    {
        $this->isolatedTenantSeq++;
        $tenant = Tenant::factory()->create([
            'slug' => 'newsletter-test-' . uniqid('', true) . '-' . $this->isolatedTenantSeq,
            'domain' => null,
        ]);

        $this->withTenant((int) $tenant->id);

        return (int) $tenant->id;
    }

    public function test_getAll_returns_paginated_structure(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('with')->andReturnSelf();
        $query->shouldReceive('orderByDesc')->andReturnSelf();
        $query->shouldReceive('limit')->andReturnSelf();
        $query->shouldReceive('get')->andReturn(collect([]));
        $this->mockNewsletter->shouldReceive('newQuery')->andReturn($query);

        $result = $this->service->getAll();

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('cursor', $result);
        $this->assertArrayHasKey('has_more', $result);
    }

    public function test_getAll_with_status_filter(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('with')->andReturnSelf();
        $query->shouldReceive('where')->with('status', 'draft')->andReturnSelf();
        $query->shouldReceive('orderByDesc')->andReturnSelf();
        $query->shouldReceive('limit')->andReturnSelf();
        $query->shouldReceive('get')->andReturn(collect([]));
        $this->mockNewsletter->shouldReceive('newQuery')->andReturn($query);

        $result = $this->service->getAll(['status' => 'draft']);
        $this->assertSame([], $result['items']);
    }

    public function test_getById_returns_null_when_not_found(): void
    {
        $query = Mockery::mock();
        $query->shouldReceive('with')->andReturnSelf();
        $query->shouldReceive('find')->with(999)->andReturn(null);
        $this->mockNewsletter->shouldReceive('newQuery')->andReturn($query);

        $this->assertNull($this->service->getById(999));
    }

    public function test_create_returns_newsletter(): void
    {
        $newsletter = Mockery::mock(Newsletter::class)->makePartial();
        $newsletter->shouldReceive('save')->once();
        $newsletter->shouldReceive('fresh')->with(['creator'])->andReturn($newsletter);

        $this->mockNewsletter->shouldReceive('newInstance')->andReturn($newsletter);

        $result = $this->service->create(1, [
            'subject' => 'Test Newsletter',
            'content' => '<p>Hello</p>',
        ]);

        $this->assertInstanceOf(Newsletter::class, $result);
    }

    public function test_recipient_count_excludes_suppressed_subscribers(): void
    {
        $tenantId = $this->useIsolatedTenant();

        DB::table('newsletter_subscribers')->insert([
            [
                'tenant_id' => $tenantId,
                'email' => 'allowed@example.test',
                'status' => 'active',
                'confirmation_token' => Str::random(64),
                'unsubscribe_token' => Str::random(64),
                'confirmed_at' => now(),
                'source' => 'manual',
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $tenantId,
                'email' => 'suppressed@example.test',
                'status' => 'active',
                'confirmation_token' => Str::random(64),
                'unsubscribe_token' => Str::random(64),
                'confirmed_at' => now(),
                'source' => 'manual',
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        DB::table('newsletter_suppression_list')->insert([
            'tenant_id' => $tenantId,
            'email' => 'suppressed@example.test',
            'reason' => 'manual',
            'bounce_count' => 0,
            'suppressed_at' => now(),
        ]);

        $this->assertSame(1, TenantContext::runForTenant($tenantId, fn () => NewsletterService::getRecipientCount('subscribers_only')));
    }

    public function test_process_queue_marks_suppressed_pending_rows_terminal_without_failed_retry(): void
    {
        $tenantId = $this->useIsolatedTenant();

        $admin = User::factory()->forTenant($tenantId)->admin()->create();
        $newsletterId = DB::table('newsletters')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Suppression send guard',
            'subject' => 'Suppression send guard',
            'content' => '<p>Hello</p>',
            'status' => 'sending',
            'target_audience' => 'subscribers_only',
            'created_by' => $admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('newsletter_queue')->insert([
            'tenant_id' => $tenantId,
            'newsletter_id' => $newsletterId,
            'email' => 'suppressed-pending@example.test',
            'status' => 'pending',
            'unsubscribe_token' => Str::random(64),
            'tracking_token' => Str::random(64),
            'created_at' => now(),
        ]);
        DB::table('newsletter_suppression_list')->insert([
            'tenant_id' => $tenantId,
            'email' => 'suppressed-pending@example.test',
            'reason' => 'manual',
            'bounce_count' => 0,
            'suppressed_at' => now(),
        ]);

        $result = TenantContext::runForTenant($tenantId, fn () => NewsletterService::processQueue($newsletterId, 10));

        $this->assertSame(0, $result['sent']);
        $this->assertSame(0, $result['failed']);
        $this->assertDatabaseHas('newsletter_queue', [
            'tenant_id' => $tenantId,
            'newsletter_id' => $newsletterId,
            'email' => 'suppressed-pending@example.test',
            'status' => 'suppressed',
            'attempts' => 5,
        ]);
        $this->assertDatabaseHas('email_log', [
            'tenant_id' => $tenantId,
            'recipient_email' => 'suppressed-pending@example.test',
            'category' => 'newsletter',
            'status' => 'suppressed',
        ]);
    }

    public function test_process_queue_uses_global_email_suppression_cache_for_terminal_suppression(): void
    {
        if (!Schema::hasTable('email_suppression')) {
            $this->markTestSkipped('Email suppression cache table is not available.');
        }

        $tenantId = $this->useIsolatedTenant();

        $admin = User::factory()->forTenant($tenantId)->admin()->create();
        $newsletterId = DB::table('newsletters')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Global suppression send guard',
            'subject' => 'Global suppression send guard',
            'content' => '<p>Hello</p>',
            'status' => 'sending',
            'target_audience' => 'subscribers_only',
            'created_by' => $admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('newsletter_queue')->insert([
            'tenant_id' => $tenantId,
            'newsletter_id' => $newsletterId,
            'email' => 'global-suppressed-pending@example.test',
            'status' => 'pending',
            'unsubscribe_token' => Str::random(64),
            'tracking_token' => Str::random(64),
            'created_at' => now(),
        ]);
        DB::table('email_suppression')->insert([
            'email' => 'global-suppressed-pending@example.test',
            'reason' => 'bounce',
            'detail' => 'global suppression test',
            'suppressed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $result = TenantContext::runForTenant($tenantId, fn () => NewsletterService::processQueue($newsletterId, 10));

        $this->assertSame(0, $result['sent']);
        $this->assertSame(0, $result['failed']);
        $this->assertDatabaseHas('newsletter_queue', [
            'tenant_id' => $tenantId,
            'newsletter_id' => $newsletterId,
            'email' => 'global-suppressed-pending@example.test',
            'status' => 'suppressed',
            'attempts' => 5,
        ]);
        $this->assertDatabaseHas('email_log', [
            'tenant_id' => $tenantId,
            'recipient_email' => 'global-suppressed-pending@example.test',
            'category' => 'newsletter',
            'status' => 'suppressed',
        ]);
    }

    public function test_all_members_recipient_count_includes_active_approved_members(): void
    {
        $tenantId = $this->useIsolatedTenant();

        $memberWithOptInData = [
            'email' => 'member-opt-in@example.test',
            'status' => 'active',
            'is_approved' => 1,
        ];
        $memberWithoutOptInData = [
            'email' => 'member-no-opt-in@example.test',
            'status' => 'active',
            'is_approved' => 1,
        ];
        $pendingMemberData = [
            'email' => 'pending-member@example.test',
            'status' => 'pending',
            'is_approved' => 0,
        ];

        if (Schema::hasColumn('users', 'newsletter_opt_in')) {
            $memberWithOptInData['newsletter_opt_in'] = 1;
            $memberWithoutOptInData['newsletter_opt_in'] = 0;
            $pendingMemberData['newsletter_opt_in'] = 1;
        }

        User::factory()->forTenant($tenantId)->create($memberWithOptInData);
        User::factory()->forTenant($tenantId)->create($memberWithoutOptInData);
        User::factory()->forTenant($tenantId)->create([
            ...$pendingMemberData,
        ]);

        $this->assertSame(2, TenantContext::runForTenant($tenantId, fn () => NewsletterService::getRecipientCount('all_members')));
    }

    public function test_recurring_newsletters_can_queue_same_email_again(): void
    {
        $tenantId = $this->useIsolatedTenant();

        $admin = User::factory()->forTenant($tenantId)->admin()->create();
        $newsletterId = DB::table('newsletters')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Recurring test',
            'subject' => 'Recurring test',
            'content' => '<p>Hello</p>',
            'status' => 'scheduled',
            'target_audience' => 'subscribers_only',
            'is_recurring' => 1,
            'recurring_frequency' => 'weekly',
            'recurring_day_of_week' => 1,
            'created_by' => $admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $recipient = [
            'email' => 'repeat@example.test',
            'user_id' => null,
            'name' => 'Repeat Recipient',
            'first_name' => 'Repeat',
            'last_name' => 'Recipient',
        ];

        $method = new \ReflectionMethod(NewsletterService::class, 'queueRecipientsWithTokens');
        $method->setAccessible(true);

        $this->assertSame(1, $method->invoke(null, $newsletterId, [$recipient]));

        DB::table('newsletter_queue')
            ->where('tenant_id', $tenantId)
            ->where('newsletter_id', $newsletterId)
            ->update(['status' => 'sent', 'sent_at' => now()]);

        $this->assertSame(1, $method->invoke(null, $newsletterId, [$recipient]));
        $this->assertSame(2, DB::table('newsletter_queue')->where('newsletter_id', $newsletterId)->count());
    }

    public function test_process_queue_claims_newsletter_rows_by_batch_before_sending(): void
    {
        $source = file_get_contents(app_path('Services/NewsletterService.php'));
        $migration = file_get_contents(database_path('migrations/2026_05_19_072000_add_batch_columns_to_newsletter_queue.php'));

        $this->assertStringContainsString('$batchId = (string) Str::uuid();', $source);
        $this->assertStringContainsString('processing_batch_id = ?', $source);
        $this->assertStringContainsString("->where('nq.processing_batch_id', \$batchId)", $source);
        $this->assertStringContainsString("->where('processing_batch_id', \$batchId)", $source);
        $this->assertStringContainsString('processing_started_at', $source);
        $this->assertStringContainsString('markAttemptFailed((int) $item->id, $tenantId, $e->getMessage(), $batchId)', $source);

        $this->assertStringContainsString('processing_batch_id', $migration);
        $this->assertStringContainsString('processing_started_at', $migration);
        $this->assertStringContainsString('idx_newsletter_queue_processing_batch', $migration);
    }

    /**
     * Regression: sending a newsletter used to drain the ENTIRE queue inside the
     * caller's request. On production (newsletter 35, 2026-08-18) that held a
     * 256-recipient send open for 184s; the React admin aborts at 30s, so the admin
     * saw "Request Timed Out" for a send that had in fact worked.
     *
     * processQueue() must stop claiming batches once its time budget is spent and
     * report the leftover work, leaving the newsletter in 'sending' so the
     * every-minute cron drainer finishes it.
     */
    public function test_process_queue_stops_at_its_time_budget_and_leaves_the_rest_queued(): void
    {
        $tenantId = $this->useIsolatedTenant();
        $newsletterId = $this->createSendingNewsletterWithQueuedRecipients($tenantId, 3);

        // Budget 0 = stop as soon as the first batch is done. Batch size 1, so
        // exactly one row is claimed and the other two are never touched.
        $result = TenantContext::runForTenant(
            $tenantId,
            fn () => NewsletterService::processQueue($newsletterId, 1, 0)
        );

        $this->assertSame(2, $this->countQueueRowsWithStatus($tenantId, $newsletterId, 'pending'), 'two recipients should still be waiting for the cron drainer');
        $this->assertGreaterThanOrEqual(2, $result['remaining'], 'processQueue must report the work it left behind');
        $this->assertSame(
            'sending',
            DB::table('newsletters')->where('id', $newsletterId)->value('status'),
            "newsletter must stay 'sending' or the cron drainer will not claim it"
        );
    }

    /**
     * The budget is opt-in: off the HTTP path (a manual admin drain) a null budget
     * must still empty the queue in one call.
     */
    public function test_process_queue_without_a_budget_drains_the_whole_queue(): void
    {
        $tenantId = $this->useIsolatedTenant();
        $newsletterId = $this->createSendingNewsletterWithQueuedRecipients($tenantId, 3);

        TenantContext::runForTenant(
            $tenantId,
            fn () => NewsletterService::processQueue($newsletterId, 1, null)
        );

        $this->assertSame(0, $this->countQueueRowsWithStatus($tenantId, $newsletterId, 'pending'));
    }

    private function createSendingNewsletterWithQueuedRecipients(int $tenantId, int $recipients): int
    {
        $admin = User::factory()->forTenant($tenantId)->admin()->create();

        $newsletterId = (int) DB::table('newsletters')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Send budget guard',
            'subject' => 'Send budget guard',
            'content' => '<p>Hello</p>',
            'status' => 'sending',
            'target_audience' => 'subscribers_only',
            'total_recipients' => $recipients,
            'created_by' => $admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        for ($i = 0; $i < $recipients; $i++) {
            DB::table('newsletter_queue')->insert([
                'tenant_id' => $tenantId,
                'newsletter_id' => $newsletterId,
                'email' => "budget-guard-{$i}@example.test",
                'status' => 'pending',
                'unsubscribe_token' => Str::random(64),
                'tracking_token' => Str::random(64),
                'created_at' => now(),
            ]);
        }

        return $newsletterId;
    }

    private function countQueueRowsWithStatus(int $tenantId, int $newsletterId, string $status): int
    {
        return (int) DB::table('newsletter_queue')
            ->where('tenant_id', $tenantId)
            ->where('newsletter_id', $newsletterId)
            ->where('status', $status)
            ->count();
    }
}
