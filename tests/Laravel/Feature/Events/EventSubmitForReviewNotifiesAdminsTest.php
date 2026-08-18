<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EventNotificationOutboxProcessor;
use App\Services\EventPublicationWorkflowService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * End-to-end cover for "an event lands in the review queue → admins hear
 * about it": a REAL submit() through EventPublicationWorkflowService, then the
 * scheduled outbox processor, asserting both the bell notification and the
 * email delivery for a tenant admin.
 *
 * EventNotificationOutboxProcessorTest already covers the processor against a
 * hand-written outbox fact and the in_app channel only (its member() fixture
 * turns email preferences OFF). This test pins the two ends that test cannot
 * see: that submit() itself records a processable fact, and that the email
 * channel completes for an admin with default notification preferences.
 */
final class EventSubmitForReviewNotifiesAdminsTest extends TestCase
{
    use DatabaseTransactions;

    /** @var list<array{to:string,subject:string}> */
    private static array $sentEmails = [];

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.channels', ['email', 'in_app']);
        Config::set('events.notification_delivery.max_attempts', 3);
        $this->setModerationRequired(true);

        // The instant-email path resolves the dispatcher from the container;
        // the test box has no reachable mail transport, so bind a recording
        // no-op success (same isolation as FederationIntegrationHarness).
        self::$sentEmails = [];
        $stub = new class extends \App\Services\EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                EventSubmitForReviewNotifiesAdminsTest::recordEmail($to, $subject);
                return true;
            }
        };
        $this->app->instance(\App\Services\EmailDispatchService::class, $stub);
    }

    public static function recordEmail(string $to, string $subject): void
    {
        self::$sentEmails[] = ['to' => $to, 'subject' => $subject];
    }

    private function setModerationRequired(bool $required): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $configuration = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $configuration['events'] = array_merge(
            is_array($configuration['events'] ?? null) ? $configuration['events'] : [],
            ['moderation_required' => $required],
        );
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode($configuration, JSON_THROW_ON_ERROR),
        ]);
    }

    private function draftEventOwnedBy(int $organizerId): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => 'Repair café afternoon',
            'description' => 'Review notification fixture.',
            'start_time' => now()->addWeek(),
            'end_time' => now()->addWeek()->addHours(2),
            'status' => 'draft',
            'publication_status' => 'draft',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_submit_for_review_delivers_admin_bell_and_email(): void
    {
        $organizer = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ]);
        // Default notification preferences — email deliberately NOT disabled.
        $admin = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $eventId = $this->draftEventOwnedBy((int) $organizer->id);

        app(EventPublicationWorkflowService::class)->submit($eventId, $organizer);

        self::assertSame(
            'pending_review',
            (string) DB::table('events')->where('id', $eventId)->value('publication_status'),
        );
        self::assertSame(1, DB::table('content_moderation_queue')
            ->where('tenant_id', $this->testTenantId)
            ->where('content_type', 'event')
            ->where('content_id', $eventId)
            ->where('status', 'pending')
            ->count(), 'submit() must enqueue exactly one review-queue row.');

        $summary = app(EventNotificationOutboxProcessor::class)
            ->processBatch(10, $this->testTenantId);
        self::assertGreaterThanOrEqual(1, $summary['processed']);

        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $admin->id,
            'type' => 'event_moderation',
            'link' => '/admin/events?publication_state=pending_review',
        ]);
        self::assertSame(1, DB::table('event_notification_deliveries')
            ->where('tenant_id', $this->testTenantId)
            ->where('recipient_user_id', (int) $admin->id)
            ->where('channel', 'in_app')
            ->where('status', 'delivered')
            ->count(), 'The admin must receive the bell notification.');
        self::assertSame(1, DB::table('event_notification_deliveries')
            ->where('tenant_id', $this->testTenantId)
            ->where('recipient_user_id', (int) $admin->id)
            ->where('channel', 'email')
            ->where('status', 'delivered')
            ->count(), 'The admin must receive the email even though the platform default event-email cadence is off — an admin review alert is operational mail.');
        self::assertContains(
            (string) $admin->email,
            array_column(self::$sentEmails, 'to'),
            'The instant operational email must actually reach the dispatcher.',
        );
    }

    public function test_admin_who_explicitly_opted_out_of_email_is_not_emailed(): void
    {
        $organizer = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $admin = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin',
            'status' => 'active',
            'is_approved' => true,
            'notification_preferences' => ['email_events' => false],
        ]);
        $eventId = $this->draftEventOwnedBy((int) $organizer->id);

        app(EventPublicationWorkflowService::class)->submit($eventId, $organizer);
        app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        // Bell still arrives; the email respects the explicit opt-out.
        self::assertSame(1, DB::table('event_notification_deliveries')
            ->where('tenant_id', $this->testTenantId)
            ->where('recipient_user_id', (int) $admin->id)
            ->where('channel', 'in_app')
            ->where('status', 'delivered')
            ->count());
        self::assertSame(1, DB::table('event_notification_deliveries')
            ->where('tenant_id', $this->testTenantId)
            ->where('recipient_user_id', (int) $admin->id)
            ->where('channel', 'email')
            ->where('status', 'suppressed')
            ->count());
    }
}
