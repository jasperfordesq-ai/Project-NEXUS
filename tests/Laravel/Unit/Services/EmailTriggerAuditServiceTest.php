<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\EmailTriggerAuditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class EmailTriggerAuditServiceTest extends TestCase
{
    use DatabaseTransactions;

    public function test_event_matrix_covers_critical_enterprise_email_flows(): void
    {
        $matrix = app(EmailTriggerAuditService::class)->eventMatrix();
        $keys = array_map(
            fn (array $row): string => $row['module'] . ':' . $row['event'] . ':' . $row['category'],
            $matrix
        );

        $this->assertContains('auth:password_reset_requested:password_reset', $keys);
        $this->assertContains('registration:email_verification_required:email_verification', $keys);
        $this->assertContains('groups:group_email_invite:group_invite', $keys);
        $this->assertContains('safeguarding:incident_flag_vetting_guardian_training:safeguarding', $keys);
        $this->assertContains('newsletter:newsletter_queue_dispatch:newsletter', $keys);
        $this->assertContains('security:account_suspended_banned_deleted_reactivated:admin_user_status', $keys);
        $this->assertContains('insurance:insurance_certificate_verified_or_rejected:insurance_certificate', $keys);
        $this->assertContains('messages:direct_message_received:message', $keys);
        $this->assertContains('digests:civic_digest_claim_source:civic_digest', $keys);
        $this->assertContains('federation:federated_message_received:federation_message', $keys);
        $this->assertContains('federation:federated_review_source:federation_review', $keys);
        $this->assertContains('goals:goal_reminder_source:goal_reminder', $keys);
        $this->assertContains('jobs:job_interview_reminder_source:job_interview', $keys);
        $this->assertContains('listings:listing_expiry_reminder_source:listing_expiry', $keys);
        $this->assertContains('volunteering:volunteer_reminder_source:volunteer_reminder', $keys);
        $this->assertContains('billing:member_premium_billing:billing', $keys);
        $this->assertContains('donations:stripe_donation_receipt_source:donation_receipt', $keys);
        $this->assertContains('wallet:transaction_notification_delivery_source:transaction', $keys);
        $this->assertContains('marketplace:offer_order_refund_rating_report_dispute:marketplace_order', $keys);
        $this->assertContains('marketplace:marketplace_order_delivery_source:marketplace_order', $keys);
        $this->assertContains('verein:verein_dues_invoice_reminder_paid:verein_dues', $keys);
        $this->assertContains('events:event_created_update_cancellation_rsvp_reminder:event_notification', $keys);
        $this->assertContains('events:event_reminder_delivery_claim_source:event_reminder', $keys);
        $this->assertContains('volunteering:volunteer_reminder_delivery_claim_source:volunteer_reminder', $keys);
        $this->assertContains('safeguarding:safeguarding_review_reminder_source:safeguarding_review', $keys);
    }

    public function test_run_returns_score_and_issue_structure(): void
    {
        $result = app(EmailTriggerAuditService::class)->run(2, 24);

        $this->assertArrayHasKey('score', $result);
        $this->assertArrayHasKey('matrix', $result);
        $this->assertArrayHasKey('issues', $result);
        $this->assertArrayHasKey('issues_by_severity', $result);
        $this->assertGreaterThanOrEqual(0, $result['score']);
        $this->assertLessThanOrEqual(1000, $result['score']);
    }

    public function test_source_table_coverage_reports_audited_backend_sources(): void
    {
        $coverage = app(EmailTriggerAuditService::class)->sourceTableCoverage();
        $byTable = collect($coverage)->keyBy('source_table');

        foreach ([
            'billing_audit_log',
            'civic_digest_delivery_claims',
            'email_log',
            'event_reminder_delivery_claims',
            'event_reminders',
            'federation_inbound_connections',
            'federation_messages',
            'federation_transactions',
            'reviews',
            'goal_reminders',
            'group_members',
            'job_interviews',
            'listing_expiry_reminders_sent',
            'marketplace_report_notifications',
            'marketplace_reports',
            'marketplace_order_notification_deliveries',
            'member_subscription_events',
            'newsletter_queue',
            'notification_queue',
            'stripe_webhook_events',
            'transaction_notification_deliveries',
            'user_safeguarding_preferences',
            'verein_member_dues',
            'vol_donations',
            'vol_reminder_delivery_claims',
            'vol_reminders_sent',
        ] as $table) {
            $this->assertTrue($byTable->has($table), "Expected {$table} in email trigger source coverage.");
            $this->assertTrue((bool) $byTable[$table]['audited'], "Expected {$table} to be marked audited.");
            $this->assertNotEmpty($byTable[$table]['check'], "Expected {$table} to include the auditing check name.");
        }
    }

    public function test_direct_email_send_surface_is_empty_outside_dispatchers(): void
    {
        $surface = app(EmailTriggerAuditService::class)->directEmailSendSurface();

        $this->assertSame([], $surface);
    }

    public function test_dispatcher_categories_are_represented_in_audit_matrix(): void
    {
        $matrixCategories = collect(app(EmailTriggerAuditService::class)->eventMatrix())
            ->pluck('category')
            ->unique()
            ->values()
            ->all();

        $allowedNonProduction = [
            'email_test',
            'newsletter_test',
            'notification_queue',
        ];

        $categories = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app')));
        foreach ($iterator as $file) {
            if (!$file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }

            $code = file_get_contents($file->getPathname());
            if ($code === false || !str_contains($code, 'EmailDispatchService::send')) {
                continue;
            }

            preg_match_all('/(?:\\\\App\\\\Services\\\\)?EmailDispatchService::send(?:Raw|WithOptions)\s*\((.*?)\);/s', $code, $calls);
            foreach ($calls[1] as $call) {
                preg_match_all("/'([a-z0-9_]+)'\\s*,\\s*\\[/", $call, $matches);
                foreach ($matches[1] as $category) {
                    $categories[$category] = true;
                }
            }
        }

        $uncovered = array_values(array_diff(array_keys($categories), $matrixCategories, $allowedNonProduction));
        sort($uncovered);

        $this->assertSame([], $uncovered, 'Every production EmailDispatchService category must be represented in the audit matrix.');
    }

    public function test_dispatcher_send_surface_requires_explicit_tenant_options(): void
    {
        $surface = app(EmailTriggerAuditService::class)->tenantlessDispatcherSendSurface();

        $this->assertSame([], $surface);
    }

    public function test_run_detects_sent_newsletter_queue_without_successful_email_log(): void
    {
        if (!Schema::hasTable('newsletters') || !Schema::hasTable('newsletter_queue') || !Schema::hasTable('email_log')) {
            $this->markTestSkipped('Newsletter email audit tables are not available.');
        }

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Newsletter Audit Admin',
            'email' => 'newsletter-audit-admin@example.test',
            'role' => 'admin',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $newsletterId = DB::table('newsletters')->insertGetId([
            'tenant_id' => 2,
            'created_by' => $userId,
            'subject' => 'Newsletter Audit',
            'content' => '<p>Audit</p>',
            'status' => 'sent',
            'sent_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('newsletter_queue')->insert([
            'tenant_id' => 2,
            'newsletter_id' => $newsletterId,
            'user_id' => $userId,
            'email' => 'newsletter-audit-recipient@example.test',
            'status' => 'sent',
            'sent_at' => now(),
            'created_at' => now()->subMinute(),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('newsletter_queue_marked_sent_without_email_log', $codes);
    }

    public function test_run_surfaces_suppressed_notification_queue_rows(): void
    {
        if (!Schema::hasTable('notification_queue')) {
            $this->markTestSkipped('Notification queue table is not available.');
        }

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Digest Suppressed User',
            'email' => 'digest-suppressed@example.test',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('notification_queue')->insert([
            'tenant_id' => 2,
            'user_id' => $userId,
            'activity_type' => 'digest_suppressed',
            'content_snippet' => 'Suppressed digest audit row',
            'link' => '/notifications',
            'status' => 'suppressed',
            'frequency' => 'daily',
            'created_at' => now()->subMinute(),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('notification_queue_suppressed_recently', $codes);
        $this->assertNotContains('notification_queue_marked_sent_without_email_log', $codes);
    }

    public function test_run_detects_sent_notification_queue_with_only_failed_email_log(): void
    {
        if (!Schema::hasTable('notification_queue') || !Schema::hasTable('email_log')) {
            $this->markTestSkipped('Notification queue/email log tables are not available.');
        }

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Failed Queue Evidence User',
            'email' => 'failed-queue-evidence@example.test',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $createdAt = now()->subMinutes(3);
        DB::table('notification_queue')->insert([
            'tenant_id' => 2,
            'user_id' => $userId,
            'activity_type' => 'new_message',
            'content_snippet' => 'Message audit row',
            'link' => '/messages',
            'status' => 'sent',
            'frequency' => 'instant',
            'sent_at' => now()->subMinute(),
            'created_at' => $createdAt,
        ]);

        DB::table('email_log')->insert([
            'tenant_id' => 2,
            'user_id' => $userId,
            'recipient_email' => 'failed-queue-evidence@example.test',
            'category' => 'notification_queue',
            'subject' => 'Message audit row',
            'provider' => 'sendgrid',
            'status' => 'failed',
            'error' => 'simulated failure',
            'created_at' => now()->subMinutes(2),
            'updated_at' => now()->subMinutes(2),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('notification_queue_marked_sent_without_email_log', $codes);
    }

    public function test_run_accepts_business_category_email_log_as_notification_queue_evidence(): void
    {
        if (!Schema::hasTable('notification_queue') || !Schema::hasTable('email_log')) {
            $this->markTestSkipped('Notification queue/email log tables are not available.');
        }

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Mapped Queue Evidence User',
            'email' => 'mapped-queue-evidence@example.test',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $createdAt = now()->subMinutes(3);
        DB::table('notification_queue')->insert([
            'tenant_id' => 2,
            'user_id' => $userId,
            'activity_type' => 'new_message',
            'content_snippet' => 'Message audit row',
            'link' => '/messages',
            'status' => 'sent',
            'frequency' => 'instant',
            'sent_at' => now()->subMinute(),
            'created_at' => $createdAt,
        ]);

        DB::table('email_log')->insert([
            'tenant_id' => 2,
            'user_id' => $userId,
            'recipient_email' => 'mapped-queue-evidence@example.test',
            'category' => 'message',
            'subject' => 'Message audit row',
            'provider' => 'sendgrid',
            'status' => 'sent',
            'created_at' => now()->subMinutes(2),
            'updated_at' => now()->subMinutes(2),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertNotContains('notification_queue_marked_sent_without_email_log', $codes);
    }

    /** @return list<array<string,mixed>> */
    private function sentWithoutLogIssues(): array
    {
        $result = app(EmailTriggerAuditService::class)->run(2, 24);

        return array_values(array_filter(
            $result['issues'],
            fn (array $issue) => $issue['code'] === 'notification_queue_marked_sent_without_email_log'
        ));
    }

    /** @param list<array<string,mixed>> $issues */
    private function flaggedCount(array $issues): int
    {
        return array_sum(array_map(fn (array $issue) => (int) ($issue['params']['count'] ?? 0), $issues));
    }

    /**
     * A sent instant queue row plus, optionally, one email_log row after it.
     * Returns how many MORE tenant-2 queue rows the check flags than before
     * (other rows in the local database may already be flagged), and the issues.
     *
     * @return array{0: int, 1: list<array<string,mixed>>}
     */
    private function queueRowWithEmail(string $activityType, ?string $emailCategory, string $emailStatus = 'delivered'): array
    {
        $before = $this->flaggedCount($this->sentWithoutLogIssues());

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Queue Category Evidence User',
            'email' => 'queue-category-evidence-' . bin2hex(random_bytes(4)) . '@example.test',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('notification_queue')->insert([
            'tenant_id' => 2,
            'user_id' => $userId,
            'activity_type' => $activityType,
            'content_snippet' => 'Queue category audit row',
            'link' => '/connections',
            'status' => 'sent',
            'frequency' => 'instant',
            'sent_at' => now()->subMinute(),
            'created_at' => now()->subMinutes(3),
        ]);

        if ($emailCategory !== null) {
            DB::table('email_log')->insert([
                'tenant_id' => 2,
                'user_id' => $userId,
                'recipient_email' => 'queue-category-evidence@example.test',
                'category' => $emailCategory,
                'subject' => 'Queue category audit row',
                'provider' => 'sendgrid',
                'status' => $emailStatus,
                'created_at' => now()->subMinutes(2),
                'updated_at' => now()->subMinutes(2),
            ]);
        }

        $issues = $this->sentWithoutLogIssues();

        return [$this->flaggedCount($issues) - $before, $issues];
    }

    /**
     * Measured on live data (17 Nov 2026): every `connection_request` row
     * marked sent had a delivered `connection` email after it, yet each was
     * flagged critical, because `connection` was not an evidence category.
     */
    public function test_a_connection_request_with_a_delivered_connection_email_is_not_flagged(): void
    {
        if (!Schema::hasTable('notification_queue') || !Schema::hasTable('email_log')) {
            $this->markTestSkipped('Notification queue/email log tables are not available.');
        }

        [$added] = $this->queueRowWithEmail('connection_request', 'connection');

        $this->assertSame(0, $added);
    }

    public function test_a_sent_queue_row_with_no_email_at_all_is_still_flagged_critical(): void
    {
        if (!Schema::hasTable('notification_queue') || !Schema::hasTable('email_log')) {
            $this->markTestSkipped('Notification queue/email log tables are not available.');
        }

        [$added, $issues] = $this->queueRowWithEmail('connection_request', null);

        $this->assertSame(1, $added);
        $this->assertNotSame([], $issues);
        $this->assertSame('critical', $issues[0]['severity']);
    }

    /**
     * The cause, pinned: every category under which the instant/digest queue
     * sender logs an email (CronJobRunner::resolveNotificationQueueAuditCategory)
     * must count as evidence for a sent queue row.
     */
    public function test_every_category_the_queue_sender_logs_under_is_evidence(): void
    {
        $evidence = (new \ReflectionMethod(EmailTriggerAuditService::class, 'notificationQueueEvidenceCategories'))
            ->invoke(app(EmailTriggerAuditService::class));

        foreach (\App\Services\CronJobRunner::notificationQueueAuditCategories() as $category) {
            $this->assertContains($category, $evidence, "Queue emails logged as '{$category}' would be flagged as never sent");
        }
        foreach (['connection', 'group', 'exchange', 'job_alert', 'message', 'notification_queue'] as $category) {
            $this->assertContains($category, \App\Services\CronJobRunner::notificationQueueAuditCategories());
        }
    }

    public function test_run_detects_recent_group_join_without_owner_notification_queue(): void
    {
        if (!Schema::hasTable('groups') || !Schema::hasTable('group_members') || !Schema::hasTable('notification_queue')) {
            $this->markTestSkipped('Group membership notification audit tables are not available.');
        }

        $ownerId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Group Audit Owner',
            'email' => 'group-audit-owner@example.test',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $memberId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Group Audit Member',
            'email' => 'group-audit-member@example.test',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $groupId = DB::table('groups')->insertGetId([
            'tenant_id' => 2,
            'owner_id' => $ownerId,
            'name' => 'Group Audit Fixture',
            'slug' => 'group-audit-fixture-' . uniqid(),
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('group_members')->insert([
            'tenant_id' => 2,
            'group_id' => $groupId,
            'user_id' => $memberId,
            'role' => 'member',
            'status' => 'active',
            'joined_at' => now()->subMinutes(4),
            'created_at' => now()->subMinutes(4),
            'updated_at' => now()->subMinutes(4),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('group_member_joined_without_owner_notification_queue', $codes);
    }

    public function test_run_detects_new_user_with_only_failed_account_email_log(): void
    {
        if (!Schema::hasTable('email_log')) {
            $this->markTestSkipped('Email log table is not available.');
        }

        $createdAt = now()->subMinutes(5);
        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Failed Welcome User',
            'email' => 'failed-welcome-user@audit-fixture.localhost.testmail',
            'role' => 'member',
            'status' => 'active',
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);

        DB::table('email_log')->insert([
            'tenant_id' => 2,
            'user_id' => $userId,
            'recipient_email' => 'failed-welcome-user@audit-fixture.localhost.testmail',
            'category' => 'welcome',
            'subject' => 'Welcome',
            'provider' => 'sendgrid',
            'status' => 'failed',
            'error' => 'simulated failure',
            'created_at' => now()->subMinutes(4),
            'updated_at' => now()->subMinutes(4),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('new_users_without_account_email_attempt', $codes);
    }

    public function test_run_detects_new_user_without_admin_registration_alert_even_when_activation_sent(): void
    {
        if (!Schema::hasTable('email_log')) {
            $this->markTestSkipped('Email log table is not available.');
        }

        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Email Trigger Audit Tenant',
            'slug' => 'email-trigger-audit-' . uniqid(),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $createdAt = now()->subMinutes(5);
        $email = 'missing-admin-registration-alert-' . uniqid() . '@audit-fixture.testmail';
        $userId = DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Missing Admin Alert User',
            'email' => $email,
            'role' => 'member',
            'status' => 'pending',
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);

        DB::table('email_log')->insert([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'recipient_email' => $email,
            'category' => 'activation',
            'subject' => 'Activation',
            'provider' => 'sendgrid',
            'status' => 'sent',
            'created_at' => now()->subMinutes(4),
            'updated_at' => now()->subMinutes(4),
        ]);

        $result = app(EmailTriggerAuditService::class)->run($tenantId, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('new_users_without_admin_registration_alert', $codes);
        $this->assertNotContains('new_users_without_account_email_attempt', $codes);
    }

    public function test_run_detects_failed_and_stale_stripe_webhook_events(): void
    {
        if (!Schema::hasTable('stripe_webhook_events') || !Schema::hasColumn('stripe_webhook_events', 'status')) {
            $this->markTestSkipped('Stripe webhook audit table is not available.');
        }

        DB::table('stripe_webhook_events')->insert([
            [
                'event_id' => 'evt_audit_failed_' . uniqid(),
                'event_type' => 'invoice.payment_failed',
                'status' => 'failed',
                'processed_at' => now()->subMinutes(3),
            ],
            [
                'event_id' => 'evt_audit_stale_' . uniqid(),
                'event_type' => 'invoice.paid',
                'status' => 'processing',
                'processed_at' => now()->subMinutes(15),
            ],
        ]);

        $result = app(EmailTriggerAuditService::class)->run(null, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('stripe_webhook_events_failed_recently', $codes);
        $this->assertContains('stripe_webhook_events_stale_processing', $codes);
    }

    public function test_run_detects_billing_audit_event_without_successful_email_log(): void
    {
        if (!Schema::hasTable('billing_audit_log') || !Schema::hasTable('email_log')) {
            $this->markTestSkipped('Billing audit/email log tables are not available.');
        }

        DB::table('billing_audit_log')->insert([
            'tenant_id' => 2,
            'acted_by_user_id' => null,
            'action' => 'upgrade_requested',
            'old_value' => null,
            'new_value' => json_encode(['message' => 'audit']),
            'notes' => 'Audit fixture',
            'created_at' => now()->subMinutes(4),
            'updated_at' => now()->subMinutes(4),
        ]);

        DB::table('email_log')->insert([
            'tenant_id' => 2,
            'user_id' => null,
            'recipient_email' => 'billing-audit@example.test',
            'category' => 'billing',
            'subject' => 'Billing audit',
            'provider' => 'sendgrid',
            'status' => 'failed',
            'error' => 'simulated failure',
            'created_at' => now()->subMinutes(3),
            'updated_at' => now()->subMinutes(3),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('billing_audit_event_without_email_log', $codes);
    }

    public function test_run_detects_failed_marketplace_report_notifications(): void
    {
        if (!Schema::hasTable('marketplace_report_notifications')) {
            $this->markTestSkipped('Marketplace report notification outbox table is not available.');
        }

        DB::table('marketplace_report_notifications')->insert([
            'tenant_id' => 2,
            'marketplace_report_id' => 987654,
            'recipient_user_id' => 123456,
            'event_type' => 'resolved',
            'channel' => 'email',
            'dedupe_key' => 'marketplace_report:987654:resolved',
            'status' => 'failed',
            'attempts' => 1,
            'last_error' => 'simulated failure',
            'last_attempted_at' => now()->subMinute(),
            'next_retry_at' => now()->addMinutes(5),
            'payload' => json_encode(['subject_key' => 'emails_misc.marketplace_report.resolved_subject']),
            'created_at' => now()->subMinutes(2),
            'updated_at' => now()->subMinute(),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('marketplace_report_notifications_failed_recently', $codes);
    }

    public function test_run_detects_marketplace_report_source_without_notification_outbox(): void
    {
        if (
            !Schema::hasTable('marketplace_reports')
            || !Schema::hasTable('marketplace_report_notifications')
            || !Schema::hasTable('marketplace_listings')
        ) {
            $this->markTestSkipped('Marketplace report audit tables are not available.');
        }

        $sellerId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Marketplace Audit Seller',
            'email' => 'marketplace-audit-seller@example.test',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $reporterId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Marketplace Audit Reporter',
            'email' => 'marketplace-audit-reporter@example.test',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $listingId = DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $sellerId,
            'title' => 'Marketplace report audit listing',
            'description' => 'Marketplace report audit listing description',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('marketplace_reports')->insert([
            'tenant_id' => 2,
            'marketplace_listing_id' => $listingId,
            'reporter_id' => $reporterId,
            'reason' => 'other',
            'description' => 'Source row without outbox evidence',
            'status' => 'received',
            'created_at' => now()->subMinutes(5),
            'updated_at' => now()->subMinutes(5),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('marketplace_report_received_without_notification_outbox', $codes);
    }

    public function test_run_detects_verein_dues_without_email_evidence(): void
    {
        if (!Schema::hasTable('verein_member_dues') || !Schema::hasColumn('verein_member_dues', 'generated_email_sent_at')) {
            $this->markTestSkipped('Verein dues email evidence columns are not available.');
        }

        DB::table('verein_member_dues')->insert([
            'organization_id' => 987654,
            'tenant_id' => 2,
            'user_id' => 123456,
            'membership_year' => (int) date('Y'),
            'amount_cents' => 5000,
            'currency' => 'CHF',
            'status' => 'paid',
            'due_date' => now()->toDateString(),
            'paid_at' => now()->subMinute(),
            'stripe_payment_intent_id' => 'pi_audit_' . uniqid('', true),
            'reminder_count' => 0,
            'generated_email_sent_at' => null,
            'paid_email_sent_at' => null,
            'created_at' => now()->subMinutes(2),
            'updated_at' => now()->subMinute(),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('verein_dues_generated_without_email_evidence', $codes);
        $this->assertContains('verein_dues_paid_without_email_evidence', $codes);
    }

    public function test_run_detects_member_premium_billing_event_without_email_evidence(): void
    {
        if (!Schema::hasTable('member_subscription_events') || !Schema::hasColumn('member_subscription_events', 'notification_sent_at')) {
            $this->markTestSkipped('Member subscription event notification evidence columns are not available.');
        }

        DB::table('member_subscription_events')->insert([
            'subscription_id' => 987654,
            'tenant_id' => 2,
            'event_type' => 'invoice.paid',
            'stripe_event_id' => 'evt_member_premium_audit_' . uniqid('', true),
            'payload' => json_encode(['object' => 'invoice']),
            'notification_sent_at' => null,
            'notification_failed_at' => now()->subMinute(),
            'notification_last_error' => 'simulated failure',
            'created_at' => now()->subMinutes(2),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('member_subscription_event_without_email_evidence', $codes);
    }

    public function test_run_detects_stripe_donation_without_receipt_email_evidence(): void
    {
        if (
            !Schema::hasTable('vol_donations')
            || !Schema::hasColumn('vol_donations', 'receipt_email_sent_at')
            || !Schema::hasColumn('vol_donations', 'receipt_email_failed_at')
        ) {
            $this->markTestSkipped('Donation receipt email evidence columns are not available.');
        }

        DB::table('vol_donations')->insert([
            'tenant_id' => 2,
            'user_id' => null,
            'amount' => 25.00,
            'currency' => 'EUR',
            'payment_method' => 'stripe',
            'payment_reference' => 'Donation audit',
            'donor_name' => 'Donation Audit Donor',
            'donor_email' => 'donation-audit@example.test',
            'status' => 'completed',
            'stripe_payment_intent_id' => 'pi_donation_audit_' . uniqid('', true),
            'receipt_email_sent_at' => null,
            'receipt_email_failed_at' => now()->subMinute(),
            'created_at' => now()->subMinutes(2),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('stripe_donation_without_receipt_email_evidence', $codes);
    }

    public function test_run_detects_federation_message_without_delivery_evidence(): void
    {
        if (!Schema::hasTable('federation_messages') || !Schema::hasColumn('federation_messages', 'email_sent_at')) {
            $this->markTestSkipped('Federation message delivery evidence columns are not available.');
        }

        DB::table('federation_messages')->insert([
            'sender_tenant_id' => 0,
            'sender_user_id' => 123456,
            'receiver_tenant_id' => 2,
            'receiver_user_id' => 654321,
            'subject' => 'Audit federation message',
            'body' => 'Audit federation message body',
            'direction' => 'inbound',
            'status' => 'pending',
            'external_partner_id' => 987654,
            'external_receiver_name' => 'Remote Sender',
            'external_message_id' => 'audit-fed-msg-' . uniqid('', true),
            'notification_sent_at' => null,
            'email_sent_at' => null,
            'email_failed_at' => now()->subMinute(),
            'email_last_error' => 'simulated failure',
            'created_at' => now()->subMinutes(2),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('federation_message_without_email_evidence', $codes);
        $this->assertContains('federation_message_without_bell_evidence', $codes);
    }

    public function test_run_detects_federation_transaction_without_delivery_evidence(): void
    {
        if (!Schema::hasTable('federation_transactions') || !Schema::hasColumn('federation_transactions', 'email_sent_at')) {
            $this->markTestSkipped('Federation transaction delivery evidence columns are not available.');
        }

        DB::table('federation_transactions')->insert([
            'sender_tenant_id' => 0,
            'sender_user_id' => 123456,
            'receiver_tenant_id' => 2,
            'receiver_user_id' => 654321,
            'amount' => 2.5,
            'description' => 'Audit federation transaction',
            'status' => 'completed',
            'completed_at' => now()->subMinute(),
            'external_partner_id' => 987654,
            'external_receiver_name' => 'Remote Sender',
            'external_transaction_id' => 'audit-fed-tx-' . uniqid('', true),
            'notification_sent_at' => null,
            'email_sent_at' => null,
            'email_failed_at' => now()->subMinute(),
            'email_last_error' => 'simulated failure',
            'created_at' => now()->subMinutes(2),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('federation_transaction_without_email_evidence', $codes);
        $this->assertContains('federation_transaction_without_bell_evidence', $codes);
    }

    public function test_run_detects_federation_connection_without_delivery_evidence(): void
    {
        if (!Schema::hasTable('federation_inbound_connections') || !Schema::hasColumn('federation_inbound_connections', 'email_sent_at')) {
            $this->markTestSkipped('Federation connection delivery evidence columns are not available.');
        }

        DB::table('federation_inbound_connections')->insert([
            'tenant_id' => 2,
            'external_partner_id' => 987654,
            'local_user_id' => 654321,
            'external_user_id' => 'audit-remote-user-' . uniqid('', true),
            'status' => 'pending',
            'message' => 'Audit connection request',
            'notification_sent_at' => null,
            'email_sent_at' => null,
            'email_failed_at' => now()->subMinute(),
            'email_last_error' => 'simulated failure',
            'created_at' => now()->subMinutes(2),
            'updated_at' => now()->subMinute(),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('federation_connection_without_email_evidence', $codes);
        $this->assertContains('federation_connection_without_bell_evidence', $codes);
    }

    public function test_run_detects_federation_review_without_delivery_evidence(): void
    {
        if (
            !Schema::hasTable('reviews')
            || !Schema::hasColumn('reviews', 'external_partner_id')
            || !Schema::hasColumn('reviews', 'email_sent_at')
            || !Schema::hasColumn('reviews', 'email_skipped_at')
        ) {
            $this->markTestSkipped('Federation review delivery evidence columns are not available.');
        }

        $reviewerId = DB::table('users')->insertGetId([
            'tenant_id' => 999,
            'name' => 'Federation Review Audit Reviewer',
            'email' => 'federation-review-audit-reviewer@example.test',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $receiverId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Federation Review Audit Receiver',
            'email' => 'federation-review-audit-receiver@example.test',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('reviews')->insert([
            'tenant_id' => 2,
            'external_partner_id' => 987654,
            'external_id' => 'audit-fed-review-' . uniqid('', true),
            'reviewer_id' => $reviewerId,
            'reviewer_tenant_id' => 999,
            'receiver_id' => $receiverId,
            'receiver_tenant_id' => 2,
            'rating' => 5,
            'comment' => 'Audit federated review',
            'review_type' => 'federated',
            'status' => 'approved',
            'show_cross_tenant' => 1,
            'notification_sent_at' => null,
            'email_sent_at' => null,
            'email_skipped_at' => null,
            'email_failed_at' => now()->subMinute(),
            'email_last_error' => 'simulated failure',
            'created_at' => now()->subMinutes(2),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('federation_review_without_email_evidence', $codes);
        $this->assertContains('federation_review_without_bell_evidence', $codes);
    }

    public function test_run_detects_event_reminder_source_delivery_gaps(): void
    {
        if (!Schema::hasTable('event_reminders') || !Schema::hasTable('events') || !Schema::hasTable('email_log')) {
            $this->markTestSkipped('Event reminder audit tables are not available.');
        }

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Event Reminder Audit User',
            'email' => 'event-reminder-audit@example.test',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $eventId = DB::table('events')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $userId,
            'title' => 'Audit Event Reminder',
            'description' => 'Audit event reminder source rows',
            'location' => 'Online',
            'start_time' => now()->addDay(),
            'start_date' => now()->addDay(),
            'end_time' => now()->addDay()->addHour(),
            'is_online' => 1,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('event_reminders')->insert([
            [
                'tenant_id' => 2,
                'event_id' => $eventId,
                'user_id' => $userId,
                'remind_before_minutes' => 60,
                'reminder_type' => 'email',
                'sent_at' => null,
                'scheduled_for' => now()->subHour(),
                'status' => 'pending',
                'created_at' => now()->subHours(2),
                'updated_at' => now()->subHour(),
            ],
            [
                'tenant_id' => 2,
                'event_id' => $eventId,
                'user_id' => $userId,
                'remind_before_minutes' => 1440,
                'reminder_type' => 'both',
                'sent_at' => null,
                'scheduled_for' => now()->subMinutes(30),
                'status' => 'failed',
                'created_at' => now()->subHour(),
                'updated_at' => now()->subMinutes(10),
            ],
            [
                'tenant_id' => 2,
                'event_id' => $eventId,
                'user_id' => $userId,
                'remind_before_minutes' => 10080,
                'reminder_type' => 'email',
                'sent_at' => now()->subMinutes(5),
                'scheduled_for' => now()->subMinutes(10),
                'status' => 'sent',
                'created_at' => now()->subHour(),
                'updated_at' => now()->subMinutes(5),
            ],
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('event_reminders_overdue_pending', $codes);
        $this->assertContains('event_reminders_failed_recently', $codes);
        $this->assertContains('event_reminders_marked_sent_without_email_log', $codes);
    }

    public function test_run_detects_listing_and_volunteer_reminder_sent_rows_without_email_log(): void
    {
        if (
            !Schema::hasTable('listing_expiry_reminders_sent')
            || !Schema::hasTable('vol_reminders_sent')
            || !Schema::hasTable('listings')
            || !Schema::hasTable('email_log')
        ) {
            $this->markTestSkipped('Reminder source audit tables are not available.');
        }

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Reminder Source Audit User',
            'email' => 'reminder-source-audit@example.com',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $listingId = DB::table('listings')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $userId,
            'title' => 'Audit Listing Reminder Source',
            'status' => 'active',
            'expires_at' => now()->addDays(3),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('listing_expiry_reminders_sent')->insert([
            'tenant_id' => 2,
            'listing_id' => $listingId,
            'user_id' => $userId,
            'days_before_expiry' => 3,
            'sent_at' => now()->subMinutes(5),
        ]);

        DB::table('vol_reminders_sent')->insert([
            'tenant_id' => 2,
            'user_id' => $userId,
            'reminder_type' => 'pre_shift',
            'reference_id' => 123456,
            'channel' => 'email',
            'sent_at' => now()->subMinutes(5),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('listing_expiry_reminder_marked_sent_without_email_log', $codes);
        $this->assertContains('volunteer_reminder_marked_sent_without_email_log', $codes);
    }

    public function test_run_detects_job_interview_reminder_source_gaps(): void
    {
        if (
            !Schema::hasTable('job_interviews')
            || !Schema::hasTable('job_vacancies')
            || !Schema::hasTable('job_vacancy_applications')
            || !Schema::hasColumn('job_interviews', 'reminder_24h_sent_at')
            || !Schema::hasColumn('job_interviews', 'reminder_1h_sent_at')
        ) {
            $this->markTestSkipped('Job interview reminder audit tables are not available.');
        }

        $posterId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Interview Poster Audit User',
            'email' => 'job-poster-audit@example.com',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $candidateId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Interview Candidate Audit User',
            'email' => 'job-candidate-audit@example.com',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $vacancyId = DB::table('job_vacancies')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $posterId,
            'title' => 'Audit Interview Role',
            'description' => 'Audit interview source rows',
            'type' => 'paid',
            'commitment' => 'flexible',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        // job_interviews.application_id FKs to job_vacancy_applications (canonical),
        // NOT the legacy job_applications table — insert there to satisfy the FK.
        $applicationId = DB::table('job_vacancy_applications')->insertGetId([
            'tenant_id' => 2,
            'vacancy_id' => $vacancyId,
            'user_id' => $candidateId,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('job_interviews')->insert([
            [
                'tenant_id' => 2,
                'vacancy_id' => $vacancyId,
                'application_id' => $applicationId,
                'proposed_by' => $posterId,
                'interview_type' => 'video',
                'scheduled_at' => now()->addHours(23),
                'duration_mins' => 30,
                'status' => 'accepted',
                'reminder_24h_sent_at' => null,
                'reminder_1h_sent_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => 2,
                'vacancy_id' => $vacancyId,
                'application_id' => $applicationId,
                'proposed_by' => $posterId,
                'interview_type' => 'video',
                'scheduled_at' => now()->addMinutes(30),
                'duration_mins' => 30,
                'status' => 'accepted',
                'reminder_24h_sent_at' => now()->subHour(),
                'reminder_1h_sent_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => 2,
                'vacancy_id' => $vacancyId,
                'application_id' => $applicationId,
                'proposed_by' => $posterId,
                'interview_type' => 'video',
                'scheduled_at' => now()->addHours(2),
                'duration_mins' => 30,
                'status' => 'accepted',
                'reminder_24h_sent_at' => now()->subMinutes(5),
                'reminder_1h_sent_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('job_interview_24h_reminder_overdue_pending', $codes);
        $this->assertContains('job_interview_1h_reminder_overdue_pending', $codes);
        $this->assertContains('job_interview_reminder_marked_sent_without_email_log', $codes);
    }

    public function test_run_detects_civic_digest_claim_source_gaps(): void
    {
        if (
            !Schema::hasTable('civic_digest_delivery_claims')
            || !Schema::hasTable('email_log')
            || !Schema::hasColumn('civic_digest_delivery_claims', 'claimed_at')
            || !Schema::hasColumn('civic_digest_delivery_claims', 'sent_at')
        ) {
            $this->markTestSkipped('Civic digest delivery claim audit tables are not available.');
        }

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Civic Digest Audit User',
            'email' => 'civic-digest-audit@example.com',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('civic_digest_delivery_claims')->insert([
            [
                'tenant_id' => 2,
                'user_id' => $userId,
                'cadence' => 'daily',
                'window_key' => 'audit-stale-' . uniqid(),
                'status' => 'claimed',
                'claimed_at' => now()->subMinutes(20),
                'sent_at' => null,
                'delivery_evidence' => null,
                'created_at' => now()->subMinutes(20),
                'updated_at' => now()->subMinutes(20),
            ],
            [
                'tenant_id' => 2,
                'user_id' => $userId,
                'cadence' => 'daily',
                'window_key' => 'audit-sent-' . uniqid(),
                'status' => 'sent',
                'claimed_at' => now()->subMinutes(10),
                'sent_at' => now()->subMinutes(5),
                'delivery_evidence' => json_encode(['channel' => 'email', 'accepted' => true]),
                'created_at' => now()->subMinutes(10),
                'updated_at' => now()->subMinutes(5),
            ],
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('civic_digest_claim_stale_pending', $codes);
        $this->assertContains('civic_digest_claim_marked_sent_without_email_log', $codes);
    }

    public function test_run_detects_transaction_and_marketplace_order_delivery_ledger_gaps(): void
    {
        if (
            !Schema::hasTable('transaction_notification_deliveries')
            || !Schema::hasTable('marketplace_order_notification_deliveries')
            || !Schema::hasTable('email_log')
        ) {
            $this->markTestSkipped('Notification delivery ledger tables are not available.');
        }

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Delivery Ledger Audit User',
            'email' => 'delivery-ledger-audit@example.com',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('transaction_notification_deliveries')->insert([
            [
                'tenant_id' => 2,
                'transaction_id' => 900001,
                'user_id' => $userId,
                'event' => 'credit_received',
                'channel' => 'email',
                'status' => 'claimed',
                'attempts' => 1,
                'claimed_at' => now()->subMinutes(20),
                'delivered_at' => null,
                'failed_at' => null,
                'evidence_id' => null,
                'last_error' => null,
                'created_at' => now()->subMinutes(20),
                'updated_at' => now()->subMinutes(20),
            ],
            [
                'tenant_id' => 2,
                'transaction_id' => 900002,
                'user_id' => $userId,
                'event' => 'credit_sent',
                'channel' => 'email',
                'status' => 'delivered',
                'attempts' => 1,
                'claimed_at' => now()->subMinutes(10),
                'delivered_at' => now()->subMinutes(5),
                'failed_at' => null,
                'evidence_id' => null,
                'last_error' => null,
                'created_at' => now()->subMinutes(10),
                'updated_at' => now()->subMinutes(5),
            ],
        ]);

        DB::table('marketplace_order_notification_deliveries')->insert([
            [
                'tenant_id' => 2,
                'order_id' => 910001,
                'user_id' => $userId,
                'event' => 'confirmed',
                'channel' => 'email',
                'status' => 'claimed',
                'attempts' => 1,
                'claimed_at' => now()->subMinutes(20),
                'delivered_at' => null,
                'failed_at' => null,
                'evidence_id' => null,
                'last_error' => null,
                'created_at' => now()->subMinutes(20),
                'updated_at' => now()->subMinutes(20),
            ],
            [
                'tenant_id' => 2,
                'order_id' => 910002,
                'user_id' => $userId,
                'event' => 'paid',
                'channel' => 'email',
                'status' => 'delivered',
                'attempts' => 1,
                'claimed_at' => now()->subMinutes(10),
                'delivered_at' => now()->subMinutes(5),
                'failed_at' => null,
                'evidence_id' => null,
                'last_error' => null,
                'created_at' => now()->subMinutes(10),
                'updated_at' => now()->subMinutes(5),
            ],
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('transaction_notification_delivery_stale_claimed', $codes);
        $this->assertContains('transaction_notification_delivery_delivered_without_email_log', $codes);
        $this->assertContains('marketplace_order_notification_delivery_stale_claimed', $codes);
        $this->assertContains('marketplace_order_notification_delivery_delivered_without_email_log', $codes);
    }

    public function test_run_detects_event_and_volunteer_reminder_delivery_claim_gaps(): void
    {
        if (
            !Schema::hasTable('event_reminder_delivery_claims')
            || !Schema::hasTable('vol_reminder_delivery_claims')
            || !Schema::hasTable('email_log')
        ) {
            $this->markTestSkipped('Reminder delivery claim tables are not available.');
        }

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Reminder Claim Audit User',
            'email' => 'reminder-claim-audit@example.com',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('event_reminder_delivery_claims')->insert([
            [
                'tenant_id' => 2,
                'event_id' => 940001,
                'user_id' => $userId,
                'reminder_type' => '24h',
                'status' => 'claimed',
                'claimed_at' => now()->subMinutes(20),
                'delivered_at' => null,
                'created_at' => now()->subMinutes(20),
                'updated_at' => now()->subMinutes(20),
            ],
            [
                'tenant_id' => 2,
                'event_id' => 940002,
                'user_id' => $userId,
                'reminder_type' => '1h',
                'status' => 'delivered',
                'claimed_at' => now()->subMinutes(10),
                'delivered_at' => now()->subMinutes(5),
                'created_at' => now()->subMinutes(10),
                'updated_at' => now()->subMinutes(5),
            ],
        ]);

        DB::table('vol_reminder_delivery_claims')->insert([
            [
                'tenant_id' => 2,
                'user_id' => $userId,
                'reminder_type' => 'pre_shift',
                'reference_id' => 950001,
                'channel' => 'email',
                'status' => 'claimed',
                'claimed_at' => now()->subMinutes(20),
                'delivered_at' => null,
                'created_at' => now()->subMinutes(20),
                'updated_at' => now()->subMinutes(20),
            ],
            [
                'tenant_id' => 2,
                'user_id' => $userId,
                'reminder_type' => 'pre_shift',
                'reference_id' => 950002,
                'channel' => 'email',
                'status' => 'delivered',
                'claimed_at' => now()->subMinutes(10),
                'delivered_at' => now()->subMinutes(5),
                'created_at' => now()->subMinutes(10),
                'updated_at' => now()->subMinutes(5),
            ],
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('event_reminder_delivery_claim_stale_claimed', $codes);
        $this->assertContains('event_reminder_delivery_claim_delivered_without_email_log', $codes);
        $this->assertContains('volunteer_reminder_delivery_claim_stale_claimed', $codes);
        $this->assertContains('volunteer_reminder_delivery_claim_delivered_without_email_log', $codes);
    }

    public function test_run_detects_safeguarding_review_and_notification_email_evidence_gaps(): void
    {
        if (
            !Schema::hasTable('user_safeguarding_preferences')
            || !Schema::hasTable('tenant_safeguarding_options')
            || !Schema::hasTable('notifications')
            || !Schema::hasTable('email_log')
            || !Schema::hasColumn('user_safeguarding_preferences', 'review_reminder_sent_at')
        ) {
            $this->markTestSkipped('Safeguarding email evidence tables are not available.');
        }

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Safeguarding Evidence Audit User',
            'email' => 'safeguarding-evidence-audit@example.com',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => 2,
            'option_key' => 'audit_review_' . uniqid(),
            'label' => 'Audit review option',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => 2,
            'user_id' => $userId,
            'option_id' => $optionId,
            'selected_value' => '1',
            'notes' => null,
            'consent_given_at' => now()->subYear(),
            'consent_ip' => '127.0.0.1',
            'revoked_at' => null,
            'review_reminder_sent_at' => now()->subMinutes(5),
            'review_confirmed_at' => null,
            'review_escalated_at' => null,
            'created_at' => now()->subYear(),
            'updated_at' => now()->subMinutes(5),
        ]);

        DB::table('notifications')->insert([
            'tenant_id' => 2,
            'user_id' => $userId,
            'type' => 'safeguarding_flag',
            'message' => 'Safeguarding evidence audit',
            'link' => '/broker/safeguarding',
            'is_read' => 0,
            'created_at' => now()->subMinutes(4),
        ]);

        $result = app(EmailTriggerAuditService::class)->run(2, 24);
        $codes = array_column($result['issues'], 'code');

        $this->assertContains('safeguarding_review_reminder_marked_sent_without_email_log', $codes);
        $this->assertContains('safeguarding_notification_without_email_log', $codes);
    }
}
