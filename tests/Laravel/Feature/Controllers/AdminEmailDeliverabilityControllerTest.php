<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class AdminEmailDeliverabilityControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_queues_endpoint_returns_source_diagnostics_and_stale_rows(): void
    {
        if (!Schema::hasTable('notification_queue') || !Schema::hasTable('newsletter_queue') || !Schema::hasTable('newsletters')) {
            $this->markTestSkipped('Email deliverability queue tables are not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'queue-diagnostics-member@example.test',
        ]);
        Sanctum::actingAs($admin);

        DB::table('notification_queue')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'activity_type' => 'new_message',
            'content_snippet' => 'Queue diagnostics notification',
            'link' => '/messages',
            'status' => 'pending',
            'frequency' => 'instant',
            'created_at' => now()->subMinutes(20),
        ]);

        $newsletterId = DB::table('newsletters')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'created_by' => $admin->id,
            'subject' => 'Queue Diagnostics Newsletter',
            'content' => '<p>Queue diagnostics</p>',
            'status' => 'sending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('newsletter_queue')->insert([
            'tenant_id' => $this->testTenantId,
            'newsletter_id' => $newsletterId,
            'user_id' => $member->id,
            'email' => 'queue-diagnostics-member@example.test',
            'status' => 'failed',
            'attempts' => 2,
            'error_message' => 'simulated queue failure',
            'last_attempted_at' => now()->subMinutes(3),
            'created_at' => now()->subMinutes(4),
        ]);

        $response = $this->apiGet('/v2/admin/email-deliverability/queues?limit=10');

        $response->assertOk();
        $response->assertJsonPath('data.diagnostics.notification_queue.available', true);
        $response->assertJsonPath('data.diagnostics.newsletter_queue.available', true);
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.notification_queue.stale_pending'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.newsletter_queue.failed_recent'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.notification_queue.status_counts.pending'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.newsletter_queue.status_counts.failed'));
        $this->assertNotEmpty($response->json('data.rows'));
    }

    public function test_queues_endpoint_scopes_rows_to_admin_tenant(): void
    {
        if (!Schema::hasTable('notification_queue')) {
            $this->markTestSkipped('Notification queue table is not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $tenantMember = User::factory()->forTenant($this->testTenantId)->create();
        $otherMember = User::factory()->forTenant(999)->create();
        Sanctum::actingAs($admin);

        DB::table('notification_queue')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $tenantMember->id,
                'activity_type' => 'tenant_message',
                'content_snippet' => 'Tenant queue row',
                'link' => '/messages',
                'status' => 'pending',
                'frequency' => 'instant',
                'created_at' => now()->subMinutes(20),
            ],
            [
                'tenant_id' => 999,
                'user_id' => $otherMember->id,
                'activity_type' => 'other_message',
                'content_snippet' => 'Other tenant queue row',
                'link' => '/messages',
                'status' => 'pending',
                'frequency' => 'instant',
                'created_at' => now()->subMinutes(20),
            ],
        ]);

        $response = $this->apiGet('/v2/admin/email-deliverability/queues?source=notification_queue&limit=25');

        $response->assertOk();
        $tenantIds = collect($response->json('data.rows'))->pluck('tenant_id')->unique()->values()->all();

        $this->assertContains($this->testTenantId, $tenantIds);
        $this->assertNotContains(999, $tenantIds);
    }

    public function test_queues_endpoint_surfaces_marketplace_report_notifications(): void
    {
        if (!Schema::hasTable('marketplace_report_notifications')) {
            $this->markTestSkipped('Marketplace report notification table is not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'marketplace-report-queue@example.test',
        ]);
        Sanctum::actingAs($admin);

        DB::table('marketplace_report_notifications')->insert([
            'tenant_id' => $this->testTenantId,
            'marketplace_report_id' => 123456,
            'recipient_user_id' => $member->id,
            'event_type' => 'received',
            'channel' => 'email',
            'dedupe_key' => 'test-marketplace-report-queue-' . uniqid(),
            'status' => 'pending',
            'attempts' => 0,
            'created_at' => now()->subMinutes(20),
            'updated_at' => now()->subMinutes(20),
        ]);

        $response = $this->apiGet('/v2/admin/email-deliverability/queues?source=marketplace_report_notifications&limit=10');

        $response->assertOk();
        $response->assertJsonPath('data.diagnostics.marketplace_report_notifications.available', true);
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.marketplace_report_notifications.stale_pending'));

        $sources = collect($response->json('data.rows'))->pluck('source')->unique()->values()->all();
        $this->assertSame(['marketplace_report_notifications'], $sources);
    }

    public function test_queues_endpoint_surfaces_marketplace_rating_and_dispute_email_evidence(): void
    {
        foreach (['marketplace_listings', 'marketplace_orders', 'marketplace_seller_ratings', 'marketplace_disputes'] as $table) {
            if (!Schema::hasTable($table)) {
                $this->markTestSkipped("{$table} table is not available.");
            }
        }

        foreach (['marketplace_seller_ratings', 'marketplace_disputes'] as $table) {
            if (
                !Schema::hasColumn($table, 'notification_email_sent_at')
                || !Schema::hasColumn($table, 'notification_email_failed_at')
                || !Schema::hasColumn($table, 'notification_email_last_error')
            ) {
                $this->markTestSkipped("{$table} email evidence columns are not available.");
            }
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $buyer = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'marketplace-rating-dispute-buyer@example.test',
        ]);
        $seller = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'marketplace-rating-dispute-seller@example.test',
        ]);
        $otherTenantUser = User::factory()->forTenant(999)->create([
            'email' => 'other-tenant-marketplace-evidence@example.test',
        ]);
        Sanctum::actingAs($admin);

        $orderId = $this->createMarketplaceOrder($buyer->id, $seller->id, $this->testTenantId, 'audit-main');
        $sentOrderId = $this->createMarketplaceOrder($buyer->id, $seller->id, $this->testTenantId, 'audit-sent');
        $otherOrderId = $this->createMarketplaceOrder($otherTenantUser->id, $otherTenantUser->id, 999, 'audit-other');

        DB::table('marketplace_seller_ratings')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'order_id' => $orderId,
                'rater_id' => $buyer->id,
                'ratee_id' => $seller->id,
                'rater_role' => 'buyer',
                'rating' => 5,
                'comment' => 'Pending rating evidence',
                'is_anonymous' => 0,
                'notification_email_sent_at' => null,
                'notification_email_failed_at' => null,
                'notification_email_last_error' => null,
                'created_at' => now()->subMinutes(20),
                'updated_at' => now()->subMinutes(20),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'order_id' => $sentOrderId,
                'rater_id' => $seller->id,
                'ratee_id' => $buyer->id,
                'rater_role' => 'seller',
                'rating' => 4,
                'comment' => 'Sent rating evidence',
                'is_anonymous' => 0,
                'notification_email_sent_at' => now()->subMinutes(5),
                'notification_email_failed_at' => null,
                'notification_email_last_error' => null,
                'created_at' => now()->subMinutes(20),
                'updated_at' => now()->subMinutes(5),
            ],
            [
                'tenant_id' => 999,
                'order_id' => $otherOrderId,
                'rater_id' => $otherTenantUser->id,
                'ratee_id' => $otherTenantUser->id,
                'rater_role' => 'buyer',
                'rating' => 3,
                'comment' => 'Other tenant rating evidence',
                'is_anonymous' => 0,
                'notification_email_sent_at' => null,
                'notification_email_failed_at' => now()->subMinutes(2),
                'notification_email_last_error' => 'other tenant failure',
                'created_at' => now()->subMinutes(20),
                'updated_at' => now()->subMinutes(2),
            ],
        ]);

        DB::table('marketplace_disputes')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'order_id' => $orderId,
                'opened_by' => $buyer->id,
                'reason' => 'other',
                'description' => 'Failed dispute evidence',
                'status' => 'open',
                'notification_email_sent_at' => null,
                'notification_email_failed_at' => now()->subMinutes(2),
                'notification_email_last_error' => 'simulated dispute mail failure',
                'created_at' => now()->subMinutes(20),
                'updated_at' => now()->subMinutes(2),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'order_id' => $sentOrderId,
                'opened_by' => $seller->id,
                'reason' => 'not_received',
                'description' => 'Sent dispute evidence',
                'status' => 'under_review',
                'notification_email_sent_at' => now()->subMinutes(4),
                'notification_email_failed_at' => null,
                'notification_email_last_error' => null,
                'created_at' => now()->subMinutes(20),
                'updated_at' => now()->subMinutes(4),
            ],
        ]);

        $ratingResponse = $this->apiGet('/v2/admin/email-deliverability/queues?source=marketplace_seller_ratings&limit=10');
        $ratingResponse->assertOk();
        $ratingResponse->assertJsonPath('data.diagnostics.marketplace_seller_ratings.available', true);
        $this->assertGreaterThanOrEqual(1, $ratingResponse->json('data.diagnostics.marketplace_seller_ratings.stale_pending'));
        $this->assertGreaterThanOrEqual(1, $ratingResponse->json('data.diagnostics.marketplace_seller_ratings.status_counts.pending'));
        $this->assertGreaterThanOrEqual(1, $ratingResponse->json('data.diagnostics.marketplace_seller_ratings.status_counts.sent'));
        $this->assertSame(
            ['marketplace_seller_ratings'],
            collect($ratingResponse->json('data.rows'))->pluck('source')->unique()->values()->all()
        );
        $this->assertNotContains(
            'other-tenant-marketplace-evidence@example.test',
            collect($ratingResponse->json('data.rows'))->pluck('email')->all()
        );

        $disputeResponse = $this->apiGet('/v2/admin/email-deliverability/queues?source=marketplace_disputes&limit=10');
        $disputeResponse->assertOk();
        $disputeResponse->assertJsonPath('data.diagnostics.marketplace_disputes.available', true);
        $this->assertGreaterThanOrEqual(1, $disputeResponse->json('data.diagnostics.marketplace_disputes.failed_recent'));
        $this->assertGreaterThanOrEqual(1, $disputeResponse->json('data.diagnostics.marketplace_disputes.status_counts.failed'));
        $this->assertGreaterThanOrEqual(1, $disputeResponse->json('data.diagnostics.marketplace_disputes.status_counts.sent'));
        $this->assertSame(
            ['marketplace_disputes'],
            collect($disputeResponse->json('data.rows'))->pluck('source')->unique()->values()->all()
        );
        $this->assertContains(
            'marketplace-rating-dispute-seller@example.test',
            collect($disputeResponse->json('data.rows'))->pluck('email')->all()
        );
        $this->assertNotContains(
            'marketplace-rating-dispute-buyer@example.test',
            collect($disputeResponse->json('data.rows'))->where('subject', 'Failed dispute evidence')->pluck('email')->all()
        );
    }

    public function test_queues_endpoint_surfaces_event_reminders(): void
    {
        if (!Schema::hasTable('event_reminders') || !Schema::hasTable('events')) {
            $this->markTestSkipped('Event reminder tables are not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'event-reminder-queue@example.test',
        ]);
        Sanctum::actingAs($admin);

        $eventId = DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $admin->id,
            'title' => 'Email Queue Diagnostic Event',
            'description' => 'Event reminder queue diagnostics',
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
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $member->id,
            'remind_before_minutes' => 60,
            'reminder_type' => 'email',
            'scheduled_for' => now()->subHour(),
            'status' => 'pending',
            'created_at' => now()->subHours(2),
            'updated_at' => now()->subHour(),
        ]);

        $response = $this->apiGet('/v2/admin/email-deliverability/queues?source=event_reminders&limit=10');

        $response->assertOk();
        $response->assertJsonPath('data.diagnostics.event_reminders.available', true);
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.event_reminders.stale_pending'));

        $sources = collect($response->json('data.rows'))->pluck('source')->unique()->values()->all();
        $this->assertSame(['event_reminders'], $sources);
    }

    public function test_queues_endpoint_surfaces_listing_expiry_sent_rows_without_email_evidence(): void
    {
        if (!Schema::hasTable('listing_expiry_reminders_sent') || !Schema::hasTable('listings') || !Schema::hasTable('email_log')) {
            $this->markTestSkipped('Listing expiry reminder evidence tables are not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'listing-expiry-evidence@example.com',
        ]);
        Sanctum::actingAs($admin);

        $listingId = DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'title' => 'Listing Expiry Evidence Gap',
            'status' => 'active',
            'expires_at' => now()->addDays(3),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('listing_expiry_reminders_sent')->insert([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listingId,
            'user_id' => $member->id,
            'days_before_expiry' => 3,
            'sent_at' => now()->subMinutes(5),
        ]);

        $response = $this->apiGet('/v2/admin/email-deliverability/queues?source=listing_expiry_reminders_sent&limit=10');

        $response->assertOk();
        $response->assertJsonPath('data.diagnostics.listing_expiry_reminders_sent.available', true);
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.listing_expiry_reminders_sent.failed_recent'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.listing_expiry_reminders_sent.status_counts.failed'));

        $rows = collect($response->json('data.rows'));
        $this->assertSame(['listing_expiry_reminders_sent'], $rows->pluck('source')->unique()->values()->all());
        $this->assertSame('failed', $rows->first()['status'] ?? null);
        $this->assertSame('listing-expiry-evidence@example.com', $rows->first()['email'] ?? null);
    }

    public function test_queues_endpoint_surfaces_civic_digest_delivery_claim_gaps(): void
    {
        if (
            !Schema::hasTable('civic_digest_delivery_claims')
            || !Schema::hasTable('email_log')
            || !Schema::hasColumn('civic_digest_delivery_claims', 'claimed_at')
            || !Schema::hasColumn('civic_digest_delivery_claims', 'sent_at')
        ) {
            $this->markTestSkipped('Civic digest delivery claim tables are not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'civic-digest-claim-queue@example.test',
        ]);
        Sanctum::actingAs($admin);

        DB::table('civic_digest_delivery_claims')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
                'cadence' => 'daily',
                'window_key' => 'queue-stale-' . uniqid(),
                'status' => 'claimed',
                'claimed_at' => now()->subMinutes(20),
                'sent_at' => null,
                'delivery_evidence' => null,
                'created_at' => now()->subMinutes(20),
                'updated_at' => now()->subMinutes(20),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
                'cadence' => 'daily',
                'window_key' => 'queue-sent-' . uniqid(),
                'status' => 'sent',
                'claimed_at' => now()->subMinutes(10),
                'sent_at' => now()->subMinutes(5),
                'delivery_evidence' => json_encode(['channel' => 'email', 'accepted' => true]),
                'created_at' => now()->subMinutes(10),
                'updated_at' => now()->subMinutes(5),
            ],
        ]);

        $response = $this->apiGet('/v2/admin/email-deliverability/queues?source=civic_digest_delivery_claims&limit=10');

        $response->assertOk();
        $response->assertJsonPath('data.diagnostics.civic_digest_delivery_claims.available', true);
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.civic_digest_delivery_claims.stale_pending'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.civic_digest_delivery_claims.failed_recent'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.civic_digest_delivery_claims.status_counts.pending'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.civic_digest_delivery_claims.status_counts.failed'));

        $rows = collect($response->json('data.rows'));
        $this->assertSame(['civic_digest_delivery_claims'], $rows->pluck('source')->unique()->values()->all());
        $this->assertContains('pending', $rows->pluck('status')->all());
        $this->assertContains('failed', $rows->pluck('status')->all());
        $this->assertSame(
            ['civic-digest-claim-queue@example.test'],
            $rows->pluck('email')->unique()->values()->all()
        );
    }

    public function test_queues_endpoint_distinguishes_newsletter_queue_statuses(): void
    {
        if (!Schema::hasTable('newsletter_queue') || !Schema::hasTable('newsletters')) {
            $this->markTestSkipped('Newsletter queue tables are not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'newsletter-statuses@example.test',
        ]);
        Sanctum::actingAs($admin);

        $newsletterId = DB::table('newsletters')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'created_by' => $admin->id,
            'subject' => 'Newsletter Queue Status Visibility',
            'content' => '<p>Status visibility</p>',
            'status' => 'sending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        foreach (['pending', 'failed', 'suppressed', 'sent'] as $status) {
            DB::table('newsletter_queue')->insert([
                'tenant_id' => $this->testTenantId,
                'newsletter_id' => $newsletterId,
                'user_id' => $member->id,
                'email' => "newsletter-{$status}@example.test",
                'status' => $status,
                'attempts' => $status === 'failed' ? 5 : 0,
                'error_message' => in_array($status, ['failed', 'suppressed'], true) ? "simulated {$status}" : null,
                'last_attempted_at' => in_array($status, ['failed', 'suppressed', 'sent'], true) ? now()->subMinutes(2) : null,
                'sent_at' => $status === 'sent' ? now()->subMinutes(2) : null,
                'created_at' => $status === 'pending' ? now()->subMinutes(20) : now()->subMinutes(5),
            ]);
        }

        foreach (['pending', 'failed', 'suppressed', 'sent'] as $status) {
            $response = $this->apiGet("/v2/admin/email-deliverability/queues?source=newsletter_queue&status={$status}&limit=10");

            $response->assertOk();
            $rows = collect($response->json('data.rows'));
            $this->assertContains($status, $rows->pluck('status')->all());
            $this->assertContains("newsletter-{$status}@example.test", $rows->pluck('email')->all());
            $this->assertGreaterThanOrEqual(1, $response->json("data.diagnostics.newsletter_queue.status_counts.{$status}"));
        }
    }

    public function test_queues_endpoint_distinguishes_civic_digest_claim_statuses(): void
    {
        if (
            !Schema::hasTable('civic_digest_delivery_claims')
            || !Schema::hasTable('email_log')
            || !Schema::hasColumn('civic_digest_delivery_claims', 'claimed_at')
            || !Schema::hasColumn('civic_digest_delivery_claims', 'sent_at')
        ) {
            $this->markTestSkipped('Civic digest delivery claim tables are not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'civic-digest-statuses@example.test',
        ]);
        $failedMember = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'civic-digest-failed-status@example.test',
        ]);
        Sanctum::actingAs($admin);

        foreach (['claimed', 'suppressed', 'sent'] as $status) {
            DB::table('civic_digest_delivery_claims')->insert([
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
                'cadence' => 'daily',
                'window_key' => 'queue-' . $status . '-' . uniqid(),
                'status' => $status,
                'claimed_at' => $status === 'claimed' ? now()->subMinutes(20) : now()->subMinutes(10),
                'sent_at' => in_array($status, ['suppressed', 'sent'], true) ? now()->subMinutes(5) : null,
                'delivery_evidence' => json_encode(['channel' => 'email', 'status' => $status]),
                'created_at' => now()->subMinutes(20),
                'updated_at' => now()->subMinutes(5),
            ]);
        }

        DB::table('email_log')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'recipient_email' => 'civic-digest-statuses@example.test',
            'category' => 'civic_digest',
            'subject' => 'Civic digest sent evidence',
            'provider' => 'smtp',
            'status' => 'sent',
            'sent_at' => now()->subMinutes(5),
            'created_at' => now()->subMinutes(5),
            'updated_at' => now()->subMinutes(5),
        ]);

        $sentClaimId = DB::table('civic_digest_delivery_claims')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $failedMember->id,
            'cadence' => 'daily',
            'window_key' => 'queue-failed-' . uniqid(),
            'status' => 'sent',
            'claimed_at' => now()->subMinutes(10),
            'sent_at' => now()->subMinutes(5),
            'delivery_evidence' => json_encode(['channel' => 'email', 'accepted' => true]),
            'created_at' => now()->subMinutes(10),
            'updated_at' => now()->subMinutes(5),
        ]);

        foreach (['pending', 'failed', 'suppressed', 'sent'] as $status) {
            $response = $this->apiGet("/v2/admin/email-deliverability/queues?source=civic_digest_delivery_claims&status={$status}&limit=10");

            $response->assertOk();
            $rows = collect($response->json('data.rows'));
            $this->assertContains($status, $rows->pluck('status')->all(), "Expected civic digest {$status} row.");
            $this->assertGreaterThanOrEqual(1, $response->json("data.diagnostics.civic_digest_delivery_claims.status_counts.{$status}"));
        }

        $failedResponse = $this->apiGet('/v2/admin/email-deliverability/queues?source=civic_digest_delivery_claims&status=failed&limit=10');
        $this->assertContains($sentClaimId, collect($failedResponse->json('data.rows'))->pluck('id')->all());
    }

    public function test_queues_endpoint_surfaces_notification_delivery_ledger_gaps(): void
    {
        if (
            !Schema::hasTable('transaction_notification_deliveries')
            || !Schema::hasTable('marketplace_order_notification_deliveries')
            || !Schema::hasTable('email_log')
        ) {
            $this->markTestSkipped('Notification delivery ledger tables are not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'delivery-ledger-queue@example.test',
        ]);
        Sanctum::actingAs($admin);

        DB::table('transaction_notification_deliveries')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'transaction_id' => 920001,
                'user_id' => $member->id,
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
                'tenant_id' => $this->testTenantId,
                'transaction_id' => 920002,
                'user_id' => $member->id,
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
                'tenant_id' => $this->testTenantId,
                'order_id' => 930001,
                'user_id' => $member->id,
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
                'tenant_id' => $this->testTenantId,
                'order_id' => 930002,
                'user_id' => $member->id,
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

        $transactionResponse = $this->apiGet('/v2/admin/email-deliverability/queues?source=transaction_notification_deliveries&limit=10');
        $transactionResponse->assertOk();
        $transactionResponse->assertJsonPath('data.diagnostics.transaction_notification_deliveries.available', true);
        $this->assertGreaterThanOrEqual(1, $transactionResponse->json('data.diagnostics.transaction_notification_deliveries.stale_pending'));
        $this->assertGreaterThanOrEqual(1, $transactionResponse->json('data.diagnostics.transaction_notification_deliveries.failed_recent'));
        $this->assertSame(
            ['transaction_notification_deliveries'],
            collect($transactionResponse->json('data.rows'))->pluck('source')->unique()->values()->all()
        );

        $marketplaceResponse = $this->apiGet('/v2/admin/email-deliverability/queues?source=marketplace_order_notification_deliveries&limit=10');
        $marketplaceResponse->assertOk();
        $marketplaceResponse->assertJsonPath('data.diagnostics.marketplace_order_notification_deliveries.available', true);
        $this->assertGreaterThanOrEqual(1, $marketplaceResponse->json('data.diagnostics.marketplace_order_notification_deliveries.stale_pending'));
        $this->assertGreaterThanOrEqual(1, $marketplaceResponse->json('data.diagnostics.marketplace_order_notification_deliveries.failed_recent'));
        $this->assertSame(
            ['marketplace_order_notification_deliveries'],
            collect($marketplaceResponse->json('data.rows'))->pluck('source')->unique()->values()->all()
        );
    }

    public function test_queues_endpoint_surfaces_reminder_delivery_claim_gaps(): void
    {
        if (
            !Schema::hasTable('event_reminder_delivery_claims')
            || !Schema::hasTable('vol_reminder_delivery_claims')
            || !Schema::hasTable('email_log')
        ) {
            $this->markTestSkipped('Reminder delivery claim tables are not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'reminder-claim-queue@example.test',
        ]);
        Sanctum::actingAs($admin);

        DB::table('event_reminder_delivery_claims')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => 940101,
                'user_id' => $member->id,
                'reminder_type' => '24h',
                'status' => 'claimed',
                'claimed_at' => now()->subMinutes(20),
                'delivered_at' => null,
                'created_at' => now()->subMinutes(20),
                'updated_at' => now()->subMinutes(20),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => 940102,
                'user_id' => $member->id,
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
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
                'reminder_type' => 'pre_shift',
                'reference_id' => 950101,
                'channel' => 'email',
                'status' => 'claimed',
                'claimed_at' => now()->subMinutes(20),
                'delivered_at' => null,
                'created_at' => now()->subMinutes(20),
                'updated_at' => now()->subMinutes(20),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
                'reminder_type' => 'pre_shift',
                'reference_id' => 950102,
                'channel' => 'email',
                'status' => 'delivered',
                'claimed_at' => now()->subMinutes(10),
                'delivered_at' => now()->subMinutes(5),
                'created_at' => now()->subMinutes(10),
                'updated_at' => now()->subMinutes(5),
            ],
        ]);

        $eventResponse = $this->apiGet('/v2/admin/email-deliverability/queues?source=event_reminder_delivery_claims&limit=10');
        $eventResponse->assertOk();
        $eventResponse->assertJsonPath('data.diagnostics.event_reminder_delivery_claims.available', true);
        $this->assertGreaterThanOrEqual(1, $eventResponse->json('data.diagnostics.event_reminder_delivery_claims.stale_pending'));
        $this->assertGreaterThanOrEqual(1, $eventResponse->json('data.diagnostics.event_reminder_delivery_claims.failed_recent'));
        $this->assertSame(
            ['event_reminder_delivery_claims'],
            collect($eventResponse->json('data.rows'))->pluck('source')->unique()->values()->all()
        );

        $volunteerResponse = $this->apiGet('/v2/admin/email-deliverability/queues?source=vol_reminder_delivery_claims&limit=10');
        $volunteerResponse->assertOk();
        $volunteerResponse->assertJsonPath('data.diagnostics.vol_reminder_delivery_claims.available', true);
        $this->assertGreaterThanOrEqual(1, $volunteerResponse->json('data.diagnostics.vol_reminder_delivery_claims.stale_pending'));
        $this->assertGreaterThanOrEqual(1, $volunteerResponse->json('data.diagnostics.vol_reminder_delivery_claims.failed_recent'));
        $this->assertSame(
            ['vol_reminder_delivery_claims'],
            collect($volunteerResponse->json('data.rows'))->pluck('source')->unique()->values()->all()
        );
    }

    public function test_queues_endpoint_surfaces_goal_reminders(): void
    {
        if (!Schema::hasTable('goal_reminders') || !Schema::hasTable('goals')) {
            $this->markTestSkipped('Goal reminder tables are not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'goal-reminder-queue@example.test',
        ]);
        Sanctum::actingAs($admin);

        $goalId = DB::table('goals')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'title' => 'Email Queue Diagnostic Goal',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('goal_reminders')->insert([
            'tenant_id' => $this->testTenantId,
            'goal_id' => $goalId,
            'user_id' => $member->id,
            'frequency' => 'weekly',
            'next_reminder_at' => now()->subHour(),
            'last_sent_at' => null,
            'enabled' => 1,
            'created_at' => now()->subHours(2),
            'updated_at' => now()->subHour(),
        ]);

        $response = $this->apiGet('/v2/admin/email-deliverability/queues?source=goal_reminders&limit=10');

        $response->assertOk();
        $response->assertJsonPath('data.diagnostics.goal_reminders.available', true);
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.goal_reminders.stale_pending'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.goal_reminders.status_counts.pending'));

        $rows = collect($response->json('data.rows'));
        $this->assertSame(['goal_reminders'], $rows->pluck('source')->unique()->values()->all());
        $this->assertSame('pending', $rows->first()['status'] ?? null);
        $this->assertSame('goal-reminder-queue@example.test', $rows->first()['email'] ?? null);
    }

    public function test_queues_endpoint_surfaces_job_interview_reminder_source_gaps(): void
    {
        if (
            !Schema::hasTable('job_interviews')
            || !Schema::hasTable('job_vacancies')
            || !Schema::hasTable('job_vacancy_applications')
            || !Schema::hasTable('email_log')
            || !Schema::hasColumn('job_interviews', 'reminder_24h_sent_at')
            || !Schema::hasColumn('job_interviews', 'reminder_1h_sent_at')
        ) {
            $this->markTestSkipped('Job interview reminder audit tables are not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $poster = User::factory()->forTenant($this->testTenantId)->create();
        $candidate = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'job-interview-reminder-queue@example.test',
        ]);
        Sanctum::actingAs($admin);

        $vacancyId = DB::table('job_vacancies')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $poster->id,
            'title' => 'Email Queue Diagnostic Vacancy',
            'description' => 'Job interview reminder diagnostics',
            'type' => 'paid',
            'commitment' => 'flexible',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // job_interviews.application_id FKs to job_vacancy_applications (the
        // canonical applications table), and the controller resolves the
        // candidate email by joining job_vacancy_applications.user_id -> users.
        $applicationId = DB::table('job_vacancy_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'vacancy_id' => $vacancyId,
            'user_id' => $candidate->id,
            'status' => 'applied',
            'stage' => 'applied',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('job_interviews')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'vacancy_id' => $vacancyId,
                'application_id' => $applicationId,
                'proposed_by' => $poster->id,
                'interview_type' => 'video',
                'scheduled_at' => now()->addHours(23),
                'status' => 'accepted',
                'reminder_24h_sent_at' => null,
                'reminder_1h_sent_at' => null,
                'created_at' => now()->subHours(2),
                'updated_at' => now()->subHours(2),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'vacancy_id' => $vacancyId,
                'application_id' => $applicationId,
                'proposed_by' => $poster->id,
                'interview_type' => 'video',
                'scheduled_at' => now()->addHours(2),
                'status' => 'accepted',
                'reminder_24h_sent_at' => now()->subMinutes(5),
                'reminder_1h_sent_at' => null,
                'created_at' => now()->subHours(3),
                'updated_at' => now()->subMinutes(5),
            ],
        ]);

        $response = $this->apiGet('/v2/admin/email-deliverability/queues?source=job_interviews&limit=10');

        $response->assertOk();
        $response->assertJsonPath('data.diagnostics.job_interviews.available', true);
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.job_interviews.stale_pending'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.job_interviews.failed_recent'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.job_interviews.status_counts.pending'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.job_interviews.status_counts.failed'));

        $rows = collect($response->json('data.rows'));
        $this->assertSame(['job_interviews'], $rows->pluck('source')->unique()->values()->all());
        $this->assertContains('pending', $rows->pluck('status')->all());
        $this->assertContains('failed', $rows->pluck('status')->all());
        $this->assertSame(
            ['job-interview-reminder-queue@example.test'],
            $rows->pluck('email')->unique()->values()->all()
        );
    }

    public function test_queues_endpoint_surfaces_volunteer_reminder_sent_rows_without_email_evidence(): void
    {
        if (!Schema::hasTable('vol_reminders_sent') || !Schema::hasTable('email_log')) {
            $this->markTestSkipped('Volunteer reminder evidence tables are not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'volunteer-reminder-evidence@example.com',
        ]);
        Sanctum::actingAs($admin);

        DB::table('vol_reminders_sent')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'reminder_type' => 'pre_shift',
            'reference_id' => 123456,
            'channel' => 'email',
            'sent_at' => now()->subMinutes(5),
        ]);

        $response = $this->apiGet('/v2/admin/email-deliverability/queues?source=vol_reminders_sent&limit=10');

        $response->assertOk();
        $response->assertJsonPath('data.diagnostics.vol_reminders_sent.available', true);
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.vol_reminders_sent.failed_recent'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.vol_reminders_sent.status_counts.failed'));

        $rows = collect($response->json('data.rows'));
        $this->assertSame(['vol_reminders_sent'], $rows->pluck('source')->unique()->values()->all());
        $this->assertSame('failed', $rows->first()['status'] ?? null);
        $this->assertSame('volunteer-reminder-evidence@example.com', $rows->first()['email'] ?? null);
    }

    public function test_queues_endpoint_surfaces_federated_review_delivery_failures(): void
    {
        if (
            !Schema::hasTable('reviews')
            || !Schema::hasColumn('reviews', 'external_partner_id')
            || !Schema::hasColumn('reviews', 'external_id')
            || !Schema::hasColumn('reviews', 'email_claimed_at')
            || !Schema::hasColumn('reviews', 'email_sent_at')
            || !Schema::hasColumn('reviews', 'email_skipped_at')
            || !Schema::hasColumn('reviews', 'email_failed_at')
            || !Schema::hasColumn('reviews', 'email_last_error')
        ) {
            $this->markTestSkipped('Federated review delivery columns are not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $reviewer = User::factory()->forTenant(999)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'federated-review-queue@example.test',
        ]);
        Sanctum::actingAs($admin);

        DB::table('reviews')->insert([
            'tenant_id' => $this->testTenantId,
            'external_partner_id' => 876543,
            'external_id' => 'admin-queue-fed-review-' . uniqid(),
            'reviewer_id' => $reviewer->id,
            'reviewer_tenant_id' => 999,
            'receiver_id' => $receiver->id,
            'receiver_tenant_id' => $this->testTenantId,
            'rating' => 5,
            'comment' => 'Federated review delivery diagnostics',
            'review_type' => 'federated',
            'status' => 'approved',
            'show_cross_tenant' => 1,
            'notification_sent_at' => null,
            'email_sent_at' => null,
            'email_skipped_at' => null,
            'email_failed_at' => now()->subMinutes(2),
            'email_last_error' => 'simulated federated review mail failure',
            'created_at' => now()->subMinutes(20),
            'updated_at' => now()->subMinutes(2),
        ]);

        $response = $this->apiGet('/v2/admin/email-deliverability/queues?source=reviews&limit=10');

        $response->assertOk();
        $response->assertJsonPath('data.diagnostics.reviews.available', true);
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.reviews.failed_recent'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.reviews.status_counts.failed'));

        $rows = collect($response->json('data.rows'));
        $this->assertSame(['reviews'], $rows->pluck('source')->unique()->values()->all());
        $this->assertSame('failed', $rows->first()['status'] ?? null);
        $this->assertSame('federated-review-queue@example.test', $rows->first()['email'] ?? null);
    }

    public function test_queues_endpoint_surfaces_federation_source_delivery_failures(): void
    {
        foreach (['federation_messages', 'federation_transactions', 'federation_inbound_connections'] as $table) {
            if (
                !Schema::hasTable($table)
                || !Schema::hasColumn($table, 'notification_sent_at')
                || !Schema::hasColumn($table, 'email_sent_at')
                || !Schema::hasColumn($table, 'email_failed_at')
                || !Schema::hasColumn($table, 'email_last_error')
            ) {
                $this->markTestSkipped("{$table} delivery columns are not available.");
            }
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $receiver = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'federation-source-queue@example.test',
        ]);
        Sanctum::actingAs($admin);

        DB::table('federation_messages')->insert([
            'sender_tenant_id' => 0,
            'sender_user_id' => 123456,
            'receiver_tenant_id' => $this->testTenantId,
            'receiver_user_id' => $receiver->id,
            'subject' => 'Admin federation message diagnostic',
            'body' => 'Admin federation message diagnostic body',
            'direction' => 'inbound',
            'status' => 'pending',
            'external_partner_id' => 987654,
            'external_receiver_name' => 'Remote Sender',
            'external_message_id' => 'admin-fed-msg-' . uniqid(),
            'notification_sent_at' => null,
            'email_sent_at' => null,
            'email_failed_at' => now()->subMinutes(2),
            'email_last_error' => 'simulated federation message failure',
            'created_at' => now()->subMinutes(20),
        ]);

        DB::table('federation_transactions')->insert([
            'sender_tenant_id' => 0,
            'sender_user_id' => 123456,
            'receiver_tenant_id' => $this->testTenantId,
            'receiver_user_id' => $receiver->id,
            'amount' => 2.5,
            'description' => 'Admin federation transaction diagnostic',
            'status' => 'completed',
            'completed_at' => now()->subMinute(),
            'external_partner_id' => 987654,
            'external_receiver_name' => 'Remote Sender',
            'external_transaction_id' => 'admin-fed-tx-' . uniqid(),
            'notification_sent_at' => null,
            'email_sent_at' => null,
            'email_failed_at' => now()->subMinutes(2),
            'email_last_error' => 'simulated federation transaction failure',
            'created_at' => now()->subMinutes(20),
        ]);

        DB::table('federation_inbound_connections')->insert([
            'tenant_id' => $this->testTenantId,
            'external_partner_id' => 987654,
            'local_user_id' => $receiver->id,
            'external_user_id' => 'admin-remote-user-' . uniqid(),
            'status' => 'pending',
            'message' => 'Admin federation connection diagnostic',
            'notification_sent_at' => null,
            'email_sent_at' => null,
            'email_failed_at' => now()->subMinutes(2),
            'email_last_error' => 'simulated federation connection failure',
            'created_at' => now()->subMinutes(20),
            'updated_at' => now()->subMinutes(2),
        ]);

        foreach (['federation_messages', 'federation_transactions', 'federation_inbound_connections'] as $source) {
            $response = $this->apiGet("/v2/admin/email-deliverability/queues?source={$source}&limit=10");

            $response->assertOk();
            $response->assertJsonPath("data.diagnostics.{$source}.available", true);
            $this->assertGreaterThanOrEqual(1, $response->json("data.diagnostics.{$source}.failed_recent"));
            $this->assertGreaterThanOrEqual(1, $response->json("data.diagnostics.{$source}.status_counts.failed"));

            $rows = collect($response->json('data.rows'));
            $this->assertSame([$source], $rows->pluck('source')->unique()->values()->all());
            $this->assertSame('failed', $rows->first()['status'] ?? null);
            $this->assertSame('federation-source-queue@example.test', $rows->first()['email'] ?? null);
        }
    }

    public function test_queues_endpoint_surfaces_safeguarding_email_evidence_gaps(): void
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

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'safeguarding-evidence-queue@example.test',
        ]);
        Sanctum::actingAs($admin);

        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'admin_audit_review_' . uniqid(),
            'label' => 'Admin audit review option',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
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
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'type' => 'safeguarding_flag',
            'message' => 'Safeguarding evidence queue',
            'link' => '/broker/safeguarding',
            'is_read' => 0,
            'created_at' => now()->subMinutes(4),
        ]);

        $reviewResponse = $this->apiGet('/v2/admin/email-deliverability/queues?source=user_safeguarding_preferences&limit=10');
        $reviewResponse->assertOk();
        $reviewResponse->assertJsonPath('data.diagnostics.user_safeguarding_preferences.available', true);
        $this->assertGreaterThanOrEqual(1, $reviewResponse->json('data.diagnostics.user_safeguarding_preferences.failed_recent'));
        $this->assertSame(
            ['user_safeguarding_preferences'],
            collect($reviewResponse->json('data.rows'))->pluck('source')->unique()->values()->all()
        );

        $notificationResponse = $this->apiGet('/v2/admin/email-deliverability/queues?source=notifications&limit=10');
        $notificationResponse->assertOk();
        $notificationResponse->assertJsonPath('data.diagnostics.notifications.available', true);
        $this->assertGreaterThanOrEqual(1, $notificationResponse->json('data.diagnostics.notifications.failed_recent'));
        $this->assertSame(
            ['notifications'],
            collect($notificationResponse->json('data.rows'))->pluck('source')->unique()->values()->all()
        );
    }

    public function test_queues_endpoint_surfaces_member_subscription_event_delivery_failures(): void
    {
        if (
            !Schema::hasTable('member_subscription_events')
            || !Schema::hasTable('member_subscriptions')
            || !Schema::hasTable('member_premium_tiers')
            || !Schema::hasColumn('member_subscription_events', 'notification_sent_at')
            || !Schema::hasColumn('member_subscription_events', 'notification_failed_at')
            || !Schema::hasColumn('member_subscription_events', 'notification_last_error')
        ) {
            $this->markTestSkipped('Member subscription event delivery columns are not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'member-subscription-event-queue@example.test',
        ]);
        Sanctum::actingAs($admin);

        $tierId = DB::table('member_premium_tiers')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'slug' => 'audit-tier-' . uniqid(),
            'name' => 'Audit Tier',
            'monthly_price_cents' => 500,
            'yearly_price_cents' => 5000,
            'features' => json_encode(['audit']),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $subscriptionId = DB::table('member_subscriptions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'tier_id' => $tierId,
            'stripe_subscription_id' => 'sub_audit_' . uniqid(),
            'stripe_customer_id' => 'cus_audit_' . uniqid(),
            'status' => 'active',
            'billing_interval' => 'monthly',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('member_subscription_events')->insert([
            'subscription_id' => $subscriptionId,
            'tenant_id' => $this->testTenantId,
            'event_type' => 'invoice.payment_failed',
            'stripe_event_id' => 'evt_member_subscription_queue_' . uniqid(),
            'payload' => json_encode(['object' => 'invoice']),
            'notification_sent_at' => null,
            'notification_failed_at' => now()->subMinutes(2),
            'notification_last_error' => 'simulated member subscription notification failure',
            'created_at' => now()->subMinutes(20),
        ]);

        $response = $this->apiGet('/v2/admin/email-deliverability/queues?source=member_subscription_events&limit=10');

        $response->assertOk();
        $response->assertJsonPath('data.diagnostics.member_subscription_events.available', true);
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.member_subscription_events.failed_recent'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.member_subscription_events.status_counts.failed'));

        $rows = collect($response->json('data.rows'));
        $this->assertSame(['member_subscription_events'], $rows->pluck('source')->unique()->values()->all());
        $this->assertSame('failed', $rows->first()['status'] ?? null);
        $this->assertSame('member-subscription-event-queue@example.test', $rows->first()['email'] ?? null);
    }

    public function test_queues_endpoint_surfaces_stripe_donation_receipt_delivery_failures(): void
    {
        if (
            !Schema::hasTable('vol_donations')
            || !Schema::hasColumn('vol_donations', 'receipt_email_sent_at')
            || !Schema::hasColumn('vol_donations', 'receipt_email_failed_at')
        ) {
            $this->markTestSkipped('Donation receipt email evidence columns are not available.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        DB::table('vol_donations')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => null,
            'amount' => 50.00,
            'currency' => 'EUR',
            'payment_method' => 'stripe',
            'payment_reference' => 'Donation queue diagnostics',
            'donor_name' => 'Donation Queue Donor',
            'donor_email' => 'donation-receipt-queue@example.test',
            'status' => 'completed',
            'stripe_payment_intent_id' => 'pi_donation_queue_' . uniqid(),
            'receipt_email_sent_at' => null,
            'receipt_email_failed_at' => now()->subMinutes(2),
            'created_at' => now()->subMinutes(20),
        ]);

        $response = $this->apiGet('/v2/admin/email-deliverability/queues?source=vol_donations&limit=10');

        $response->assertOk();
        $response->assertJsonPath('data.diagnostics.vol_donations.available', true);
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.vol_donations.failed_recent'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.diagnostics.vol_donations.status_counts.failed'));

        $rows = collect($response->json('data.rows'));
        $this->assertSame(['vol_donations'], $rows->pluck('source')->unique()->values()->all());
        $this->assertSame('failed', $rows->first()['status'] ?? null);
        $this->assertSame('donation-receipt-queue@example.test', $rows->first()['email'] ?? null);
    }

    private function createMarketplaceOrder(int $buyerId, int $sellerId, int $tenantId, string $suffix): int
    {
        $listingId = DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $sellerId,
            'title' => 'Email Evidence Listing ' . $suffix,
            'description' => 'Marketplace email evidence diagnostic listing',
            'price' => 10.00,
            'price_currency' => 'EUR',
            'price_type' => 'fixed',
            'quantity' => 1,
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return DB::table('marketplace_orders')->insertGetId([
            'tenant_id' => $tenantId,
            'order_number' => 'AUDIT-' . $suffix . '-' . uniqid(),
            'buyer_id' => $buyerId,
            'seller_id' => $sellerId,
            'marketplace_listing_id' => $listingId,
            'quantity' => 1,
            'unit_price' => 10.00,
            'total_price' => 10.00,
            'currency' => 'EUR',
            'status' => 'completed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
