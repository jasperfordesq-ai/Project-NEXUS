<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Models\Notification;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\EventNotificationService;
use App\Services\Identity\RegistrationOrchestrationService;
use App\Services\NotificationDispatcher;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class NotificationQueueTenantIntegrityTest extends TestCase
{
    use DatabaseTransactions;

    public function test_duplicate_dispatch_suppresses_bell_but_still_queues_email(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'email' => 'dispatch-duplicate-' . uniqid('', true) . '@example.test',
        ]);
        Cache::flush();
        TenantContext::setById($this->testTenantId);

        NotificationDispatcher::dispatch(
            $user->id,
            'global',
            0,
            'new_message',
            'First direct message',
            '/messages/123',
            '<p>First direct message</p>'
        );
        NotificationDispatcher::dispatch(
            $user->id,
            'global',
            0,
            'new_message',
            'Second direct message',
            '/messages/123',
            '<p>Second direct message</p>'
        );

        $this->assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('type', 'new_message')
            ->count());
        $this->assertSame(2, DB::table('notification_queue')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('activity_type', 'new_message')
            ->where('frequency', 'instant')
            ->count());
    }

    public function test_failed_queue_insert_rolls_back_new_bell_for_retry(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'email' => 'dispatch-queue-fail-' . uniqid('', true) . '@example.test',
        ]);
        Cache::flush();
        TenantContext::setById($this->testTenantId);

        DB::unprepared('DROP TRIGGER IF EXISTS notification_queue_force_failure');
        DB::unprepared(
            "CREATE TRIGGER notification_queue_force_failure
             BEFORE INSERT ON notification_queue
             FOR EACH ROW
             BEGIN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced queue failure';
             END"
        );

        try {
            $result = NotificationDispatcher::dispatch(
                $user->id,
                'global',
                0,
                'new_message',
                'Queue failure message',
                '/messages/queue-failure',
                '<p>Queue failure message</p>'
            );
        } finally {
            DB::unprepared('DROP TRIGGER IF EXISTS notification_queue_force_failure');
        }

        $this->assertFalse($result);
        $this->assertSame(0, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('type', 'new_message')
            ->where('link', '/messages/queue-failure')
            ->count());
        $this->assertSame(0, DB::table('notification_queue')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('activity_type', 'new_message')
            ->where('link', '/messages/queue-failure')
            ->count());
    }

    public function test_message_listener_uses_atomic_claim_before_queueing_email(): void
    {
        $source = file_get_contents(app_path('Listeners/NotifyMessageReceived.php'));

        $this->assertStringContainsString('Cache::add($claimKey', $source);
        $this->assertStringContainsString('$handled = LocaleContext::withLocale', $source);
        $this->assertStringContainsString('Cache::put($handledKey', $source);
        $this->assertStringContainsString('Cache::forget($claimKey)', $source);
    }

    public function test_message_email_recipient_lookup_remains_tenant_scoped(): void
    {
        $source = file_get_contents(app_path('Listeners/NotifyMessageReceived.php'));

        $this->assertStringContainsString("->where('tenant_id', \$event->tenantId)", $source);
        $this->assertStringNotContainsString('User::withoutGlobalScopes()->find((int) $event->message->receiver_id)', $source);
    }

    public function test_queue_notification_resolves_tenant_from_recipient_when_context_is_missing(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        TenantContext::reset();

        try {
            $method = new \ReflectionMethod(NotificationDispatcher::class, 'queueNotification');
            $method->setAccessible(true);
            $method->invoke(null, $user->id, 'new_message', 'Message received', '/messages', 'instant', '<p>Message received</p>');

            $row = DB::table('notification_queue')
                ->where('user_id', $user->id)
                ->where('activity_type', 'new_message')
                ->orderByDesc('id')
                ->first();

            $this->assertNotNull($row);
            $this->assertSame($this->testTenantId, (int) $row->tenant_id);
        } finally {
            TenantContext::setById($this->testTenantId);
        }
    }

    public function test_notification_model_resolves_tenant_from_recipient_when_context_is_missing(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        TenantContext::reset();

        try {
            $notification = Notification::create([
                'user_id' => $user->id,
                'type' => 'system',
                'message' => 'Tenant fallback check',
                'link' => '/notifications',
                'is_read' => 0,
                'created_at' => now(),
            ]);

            $rowTenantId = DB::table('notifications')
                ->where('id', $notification->id)
                ->value('tenant_id');

            $this->assertSame($this->testTenantId, (int) $rowTenantId);

            $id = Notification::createNotification($user->id, 'Tenant fallback check two', '/notifications', 'system');
            $helperTenantId = DB::table('notifications')
                ->where('id', $id)
                ->value('tenant_id');

            $this->assertSame($this->testTenantId, (int) $helperTenantId);
        } finally {
            TenantContext::setById($this->testTenantId);
        }
    }

    public function test_email_dispatcher_infers_tenant_from_unique_recipient_when_context_is_missing(): void
    {
        $email = 'tenant-infer-' . uniqid('', true) . '@example.test';
        User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'email' => $email,
        ]);

        TenantContext::reset();

        try {
            $method = new \ReflectionMethod(EmailDispatchService::class, 'resolveTenantId');
            $method->setAccessible(true);

            $tenantId = $method->invoke(app(EmailDispatchService::class), [], $email);

            $this->assertSame($this->testTenantId, $tenantId);
        } finally {
            TenantContext::setById($this->testTenantId);
        }
    }

    public function test_email_dispatcher_prefers_unique_recipient_tenant_over_leaked_context(): void
    {
        $otherTenantId = 999;
        $email = 'tenant-mismatch-' . uniqid('', true) . '@example.test';
        User::factory()->forTenant($otherTenantId)->create([
            'status' => 'active',
            'email' => $email,
        ]);

        TenantContext::setById($this->testTenantId);

        $method = new \ReflectionMethod(EmailDispatchService::class, 'resolveTenantId');
        $method->setAccessible(true);

        $tenantId = $method->invoke(app(EmailDispatchService::class), [], $email);

        $this->assertSame($otherTenantId, $tenantId);
        $this->assertSame($this->testTenantId, TenantContext::currentId());
    }

    public function test_email_notification_listeners_restore_previous_tenant_context(): void
    {
        $listenerFiles = [
            'NotifyAdminOfNewCommunityEvent.php',
            'NotifyAdminOfNewGroup.php',
            'NotifyAdminOfNewListing.php',
            'NotifyAdminOfNewRegistration.php',
            'NotifyAdminOfNewVolunteerOpportunity.php',
            'NotifyConnectionAccepted.php',
            'NotifyConnectionRequest.php',
            'NotifyGroupChatroomMessage.php',
            'NotifyGroupMemberJoined.php',
            'NotifyJobAlertSubscribers.php',
            'NotifyMessageReceived.php',
            'NotifySafeguardingStaff.php',
            'NotifyTransactionCompleted.php',
            'SendOnboardingCompletionEmail.php',
            'SendWelcomeNotification.php',
            'CopyMessageForBrokerReview.php',
            'UpdateFeedOnListingCreated.php',
            'UpdateWalletBalance.php',
            'HandleFederatedCommunityEventReceived.php',
            'HandleFederatedConnectionReceived.php',
            'HandleFederatedListingReceived.php',
            'HandleFederatedMemberUpdated.php',
            'HandleFederatedReviewReceived.php',
            'IngestFederatedVolunteerOpportunity.php',
            'PushCommunityEventToFederatedPartners.php',
            'PushConnectionAcceptedToFederatedPartner.php',
            'PushFederationDataRetraction.php',
            'PushGroupMembershipToFederatedPartners.php',
            'PushGroupRetractionToFederatedPartners.php',
            'PushGroupToFederatedPartners.php',
            'PushListingToFederatedPartners.php',
            'PushMemberProfileUpdateToFederatedPartners.php',
            'PushMessageToFederatedPartner.php',
            'PushReviewToFederatedPartner.php',
            'PushTransactionToFederatedPartner.php',
            'PushVolunteerOpportunityToFederatedPartners.php',
        ];

        foreach ($listenerFiles as $listenerFile) {
            $source = file_get_contents(app_path('Listeners/' . $listenerFile));
            $restoresTenant = str_contains($source, 'TenantContext::runForTenant(')
                || str_contains($source, 'TenantContext::restoreAfterScopedListener($previousTenantId)')
                || (
                    str_contains($source, 'TenantContext::currentId()')
                    && str_contains($source, 'TenantContext::setById($previousTenantId)')
                );

            $this->assertTrue(
                $restoresTenant,
                "{$listenerFile} must restore the caller tenant after synchronous listener execution."
            );
            $this->assertStringNotContainsString(
                "finally {\n            TenantContext::reset();",
                $source,
                "{$listenerFile} must not blindly reset tenant context in finally."
            );
        }
    }

    public function test_federated_volunteer_mirror_is_tenant_scoped(): void
    {
        $listenerSource = file_get_contents(app_path('Listeners/IngestFederatedVolunteerOpportunity.php'));
        $migrationSource = file_get_contents(database_path('migrations/2026_05_19_000001_scope_vol_opportunity_federation_unique_index_by_tenant.php'));

        $this->assertStringContainsString("->where('tenant_id', \$event->tenantId)", $listenerSource);
        $this->assertStringContainsString("`tenant_id`, `external_partner_id`, `external_id`", $migrationSource);
        $this->assertStringContainsString("dropIndexIfExists('vol_opportunities', 'uk_vol_opp_partner_ext')", $migrationSource);
    }

    public function test_email_dispatcher_allows_intentional_platform_send_without_leaked_context(): void
    {
        $email = 'external-provisioning-' . uniqid('', true) . '@example.test';

        TenantContext::setById($this->testTenantId);

        $method = new \ReflectionMethod(EmailDispatchService::class, 'resolveTenantId');
        $method->setAccessible(true);

        $tenantId = $method->invoke(app(EmailDispatchService::class), [
            'tenant_id' => null,
            'allow_missing_tenant' => true,
        ], $email);

        $this->assertNull($tenantId);
        $this->assertSame($this->testTenantId, TenantContext::currentId());
    }

    public function test_email_dispatcher_does_not_infer_tenant_for_explicit_platform_send(): void
    {
        $email = 'external-provisioning-existing-' . uniqid('', true) . '@example.test';
        User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'email' => $email,
        ]);

        TenantContext::setById($this->testTenantId);

        $method = new \ReflectionMethod(EmailDispatchService::class, 'resolveTenantId');
        $method->setAccessible(true);

        $tenantId = $method->invoke(app(EmailDispatchService::class), [
            'tenant_id' => null,
            'allow_missing_tenant' => true,
        ], $email);

        $this->assertNull($tenantId);
        $this->assertSame($this->testTenantId, TenantContext::currentId());
    }

    public function test_email_dispatcher_clears_context_for_null_tenant_sends(): void
    {
        $source = file_get_contents(app_path('Services/EmailDispatchService.php'));

        $this->assertStringContainsString('runWithResolvedTenant', $source);
        $this->assertStringContainsString('TenantContext::reset();', $source);
        $this->assertStringContainsString("'allow_missing_tenant'", $source);
    }

    public function test_tenant_provisioning_rejection_is_explicit_platform_email(): void
    {
        $source = file_get_contents(app_path('Services/TenantProvisioning/TenantProvisioningMailer.php'));

        $this->assertStringContainsString("'tenant_id' => null", $source);
        $this->assertStringContainsString("'allow_missing_tenant' => true", $source);
        $this->assertStringNotContainsString("'tenant_id' => TenantContext::currentId()", $source);
    }

    public function test_activity_email_helpers_select_recipient_tenant_for_dispatch(): void
    {
        $ideationSource = file_get_contents(app_path('Services/IdeationChallengeService.php'));
        $balanceSource = file_get_contents(app_path('Services/BalanceAlertService.php'));
        $brokerSource = file_get_contents(app_path('Services/BrokerMessageVisibilityService.php'));
        $socialSource = file_get_contents(app_path('Services/SocialNotificationService.php'));
        $appreciationSource = file_get_contents(app_path('Services/Social/AppreciationService.php'));

        $this->assertStringContainsString("'preferred_language', 'tenant_id'", $ideationSource);
        $this->assertStringContainsString("'tenant_id' => \$tenantId", $ideationSource);
        $this->assertStringNotContainsString("'tenant_id' => TenantContext::currentId()", $ideationSource);
        $this->assertStringNotContainsString("'Project NEXUS'", $ideationSource);

        $this->assertStringContainsString("'preferred_language', 'tenant_id'", $balanceSource);
        $this->assertStringContainsString('TenantContext::runForTenant(', $balanceSource);
        $this->assertStringContainsString("'tenant_id' => (int) \$owner->tenant_id", $balanceSource);
        $this->assertStringNotContainsString('$owner->tenant_id ?? TenantContext::currentId()', $balanceSource);

        $this->assertStringContainsString("'preferred_language', 'tenant_id'", $brokerSource);
        $this->assertStringContainsString('TenantContext::runForTenant($tenantId', $brokerSource);
        $this->assertStringContainsString("'tenant_id' => (int) \$broker->tenant_id", $brokerSource);
        $this->assertStringNotContainsString('$broker->tenant_id ?? TenantContext::currentId()', $brokerSource);
        $this->assertStringContainsString("__('emails.common.fallback_manager')", $brokerSource);

        $this->assertStringContainsString("'preferred_language', 'tenant_id'", $socialSource);
        $this->assertGreaterThanOrEqual(4, substr_count($socialSource, 'TenantContext::runForTenant((int) $owner->tenant_id'));
        $this->assertStringContainsString("'tenant_id' => \$tenantId", $socialSource);
        $this->assertStringNotContainsString('$owner->tenant_id ?? TenantContext::currentId()', $socialSource);

        $this->assertStringContainsString("'preferred_language', 'tenant_id'", $appreciationSource);
        $this->assertStringContainsString("'tenant_id' => \$receiver->tenant_id ?? \$tenantId", $appreciationSource);
    }

    public function test_instant_queue_stale_cleanup_only_marks_instant_rows_failed(): void
    {
        $source = file_get_contents(app_path('Services/CronJobRunner.php'));

        $this->assertStringNotContainsString(
            "WHERE status = 'processing' AND created_at < DATE_SUB",
            $source,
            'Instant queue cleanup must not mark digest processing rows as failed.'
        );

        $this->assertStringContainsString('releaseStaleNotificationQueueRows(string $frequency, int $minutes)', $source);
        $this->assertStringContainsString("status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END", $source);
        $this->assertStringContainsString('processing_started_at < DATE_SUB(NOW(), INTERVAL {$minutes} MINUTE)', $source);
        $this->assertStringContainsString("releaseStaleNotificationQueueRows('instant', 10)", $source);
    }

    public function test_notification_queue_runner_claims_rows_by_batch_before_sending(): void
    {
        $source = file_get_contents(app_path('Services/CronJobRunner.php'));
        $migration = file_get_contents(database_path('migrations/2026_05_19_071000_add_batch_retry_columns_to_notification_queue.php'));

        $this->assertStringContainsString('processing_batch_id = ?', $source);
        $this->assertStringContainsString('$batchId = (string) Str::uuid();', $source);
        $this->assertStringContainsString('AND q.processing_batch_id = ?', $source);
        $this->assertStringContainsString('markNotificationQueueAttemptFailed', $source);
        $this->assertStringContainsString('attempts = attempts + 1', $source);
        $this->assertStringContainsString("WHERE id = ? AND tenant_id = ? AND processing_batch_id = ?", $source);

        $this->assertStringContainsString("processing_batch_id", $migration);
        $this->assertStringContainsString("processing_started_at", $migration);
        $this->assertStringContainsString("attempts", $migration);
        $this->assertStringContainsString("last_attempted_at", $migration);
        $this->assertStringContainsString("last_error", $migration);
    }

    public function test_instant_notification_queue_marks_suppressed_recipients_without_retry_churn(): void
    {
        $source = file_get_contents(app_path('Services/CronJobRunner.php'));

        $this->assertStringContainsString('logSuppressedNotificationQueueEmail', $source);
        $this->assertStringContainsString('markNotificationQueueSuppressed', $source);
        $this->assertStringContainsString("SET status = 'suppressed'", $source);
        $this->assertGreaterThanOrEqual(2, substr_count($source, "isEmailSuppressed((string) (\$item['email'] ?? ''))"));
    }

    public function test_instant_notification_queue_sends_business_audit_categories_with_tenant_context(): void
    {
        // This integration suite runs against the shared local test database.
        // Isolate the claimed batch so unrelated pending fixtures cannot add
        // deliveries to the four categories asserted below; the transaction
        // restores those rows after the test.
        DB::table('notification_queue')->delete();
        $mailer = $this->fakeMailer(true);
        app()->instance(EmailDispatchService::class, $mailer);
        Cache::forget('notification_queue:instant:runner_lock');

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'email' => 'queue-category-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);

        DB::table('notification_settings')->insert([
            'user_id' => $user->id,
            'context_type' => 'global',
            'context_id' => 0,
            'frequency' => 'instant',
        ]);

        foreach (['new_message', 'connection_request', 'event_update', 'vol_application_approved'] as $activityType) {
            DB::table('notification_queue')->insert([
                'tenant_id' => $this->testTenantId,
                'user_id' => $user->id,
                'activity_type' => $activityType,
                'content_snippet' => 'Audit category check',
                'link' => '/notifications',
                'frequency' => 'instant',
                'email_body' => '<p>Audit category check</p>',
                'created_at' => now(),
                'status' => 'pending',
            ]);
        }

        $method = new \ReflectionMethod(\App\Services\CronJobRunner::class, 'runInstantQueueInternal');
        $method->setAccessible(true);
        ob_start();
        try {
            $method->invoke(new \App\Services\CronJobRunner());
        } finally {
            ob_end_clean();
        }

        $this->assertCount(4, $mailer->calls);
        $this->assertSame(
            ['message', 'connection', 'event_reminder', 'volunteering'],
            array_column(array_column($mailer->calls, 'options'), 'category')
        );
        foreach ($mailer->calls as $call) {
            $this->assertSame($this->testTenantId, (int) $call['options']['tenant_id']);
        }
    }

    public function test_notification_queue_runner_resets_tenant_context_after_batches(): void
    {
        $source = file_get_contents(app_path('Services/CronJobRunner.php'));

        $this->assertStringContainsString("TenantContext::reset();\n\n        echo \"Done.\\n\";", $source);
        $this->assertStringContainsString("TenantContext::reset();\n\n            // Clean up stale rows", $source);
        $this->assertStringContainsString("TenantContext::reset();\n\n        // Clean up stale rows", $source);
        $this->assertStringContainsString("finally {\n            TenantContext::reset();", $source);
        $this->assertGreaterThanOrEqual(
            2,
            substr_count($source, "foreach (\$pending as \$row) {\n                TenantContext::reset();"),
            'Newsletter queue processors must reset tenant context before each cross-tenant newsletter lookup.'
        );
    }

    public function test_hot_match_cron_scopes_candidates_and_dedupe_by_tenant(): void
    {
        $source = file_get_contents(app_path('Services/CronJobRunner.php'));

        $this->assertStringContainsString('u.tenant_id = l.tenant_id', $source);
        $this->assertStringContainsString('mh.tenant_id = l.tenant_id', $source);
        $this->assertStringContainsString('AND l.tenant_id = ?', $source);
        $this->assertStringContainsString('TenantContext::runForTenant($tenantId', $source);
        $this->assertStringContainsString('if (!$dispatched)', $source);
    }

    public function test_event_notification_queue_resolves_tenant_from_recipient_when_context_is_missing(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'email' => 'event-queue-' . uniqid('', true) . '@example.test',
        ]);

        DB::table('notification_settings')->insert([
            'user_id' => $user->id,
            'context_type' => 'global',
            'context_id' => 0,
            'frequency' => 'daily',
        ]);

        TenantContext::reset();

        try {
            $method = new \ReflectionMethod(EventNotificationService::class, 'sendEventEmail');
            $method->setAccessible(true);

            $sent = $method->invoke(
                new EventNotificationService(),
                (object) [
                    'user_id' => $user->id,
                    'email' => $user->email,
                    'first_name' => $user->first_name,
                ],
                'Event update',
                'Event changed',
                '/events/1',
                'event_update',
                '<p>Event changed</p>'
            );

            $row = DB::table('notification_queue')
                ->where('user_id', $user->id)
                ->where('activity_type', 'event_update')
                ->orderByDesc('id')
                ->first();

            $this->assertTrue($sent);
            $this->assertNotNull($row);
            $this->assertSame($this->testTenantId, (int) $row->tenant_id);
        } finally {
            TenantContext::setById($this->testTenantId);
        }
    }

    public function test_identity_verification_reminder_cron_uses_session_tenant_for_email_body(): void
    {
        $otherTenantId = 999;
        $otherTenantSlug = 'test-999';
        $mailer = $this->fakeMailer(true);
        app()->instance(EmailDispatchService::class, $mailer);

        $user = User::factory()->forTenant($otherTenantId)->create([
            'status' => 'active',
            'email' => 'identity-reminder-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);

        DB::table('identity_verification_sessions')->insert([
            'tenant_id' => $otherTenantId,
            'user_id' => $user->id,
            'provider_slug' => 'mock',
            'verification_level' => 'document_only',
            'status' => 'created',
            'created_at' => now()->subHours(25),
            'updated_at' => now()->subHours(25),
        ]);

        TenantContext::setById($this->testTenantId);

        try {
            $sent = RegistrationOrchestrationService::sendVerificationReminders();

            $this->assertSame(1, $sent);
            $this->assertCount(1, $mailer->calls);
            $this->assertSame($otherTenantId, (int) $mailer->calls[0]['options']['tenant_id']);
            $this->assertSame('identity_verification', $mailer->calls[0]['options']['category']);
            $this->assertStringContainsString("/{$otherTenantSlug}/verify-identity", (string) $mailer->calls[0]['body']);
            $this->assertNotNull(DB::table('identity_verification_sessions')->where('user_id', $user->id)->value('reminder_sent_at'));
            $this->assertDatabaseHas('notifications', [
                'tenant_id' => $otherTenantId,
                'user_id' => $user->id,
                'type' => 'verification_reminder',
            ]);
        } finally {
            TenantContext::setById($this->testTenantId);
        }
    }

    public function test_identity_verification_reminder_failure_does_not_stamp_sent_or_create_bell(): void
    {
        $tenantId = 999;
        app()->instance(EmailDispatchService::class, $this->fakeMailer(false));

        $user = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'email' => 'identity-reminder-fail-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);

        DB::table('identity_verification_sessions')->insert([
            'tenant_id' => $tenantId,
            'user_id' => $user->id,
            'provider_slug' => 'mock',
            'verification_level' => 'document_only',
            'status' => 'created',
            'created_at' => now()->subHours(25),
            'updated_at' => now()->subHours(25),
        ]);

        TenantContext::setById($this->testTenantId);

        try {
            $sent = RegistrationOrchestrationService::sendVerificationReminders();

            $this->assertSame(0, $sent);
            $this->assertNull(DB::table('identity_verification_sessions')->where('user_id', $user->id)->value('reminder_sent_at'));
            $this->assertDatabaseMissing('notifications', [
                'tenant_id' => $tenantId,
                'user_id' => $user->id,
                'type' => 'verification_reminder',
            ]);
        } finally {
            TenantContext::setById($this->testTenantId);
        }
    }

    public function test_dispatch_uses_recipient_tenant_for_frequency_when_context_is_leaked(): void
    {
        $otherTenantId = 999;
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode(['notifications' => ['default_frequency' => 'off']]),
        ]);
        DB::table('tenants')->where('id', $otherTenantId)->update([
            'configuration' => json_encode(['notifications' => ['default_frequency' => 'instant']]),
        ]);

        $user = User::factory()->forTenant($otherTenantId)->create([
            'status' => 'active',
            'email' => 'dispatch-tenant-' . uniqid('', true) . '@example.test',
        ]);

        TenantContext::setById($this->testTenantId);

        NotificationDispatcher::dispatch(
            $user->id,
            'global',
            0,
            'new_topic',
            'Tenant-specific default check',
            '/notifications',
            '<p>Tenant-specific default check</p>'
        );

        $row = DB::table('notification_queue')
            ->where('user_id', $user->id)
            ->where('activity_type', 'new_topic')
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull($row);
        $this->assertSame($otherTenantId, (int) $row->tenant_id);
        $this->assertSame($this->testTenantId, TenantContext::currentId());
    }

    private function fakeMailer(bool $result): EmailDispatchService
    {
        return new class($result) extends EmailDispatchService {
            public array $calls = [];

            public function __construct(private bool $result)
            {
            }

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body', 'options');

                return $this->result;
            }
        };
    }
}
