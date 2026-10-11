<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventNotificationDeliveryMode;
use App\Models\Tenant;
use App\Models\User;
use App\Models\EventWaitlistEntry;
use App\Services\EventDomainOutboxService;
use App\Services\EventHealthService;
use App\Services\EventNotificationOutboxScope;
use App\Services\EventRecurrenceService;
use App\Services\EventWaitlistOfferEnvelopeService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class EventHealthCommandTest extends TestCase
{
    use DatabaseTransactions;

    public function test_clean_tenant_snapshot_is_payload_free_and_command_succeeds(): void
    {
        $tenant = Tenant::factory()->create();

        $snapshot = app(EventHealthService::class)->snapshot((int) $tenant->id, 600);

        self::assertTrue($snapshot['read_only']);
        self::assertTrue($snapshot['payload_free']);
        self::assertTrue($snapshot['healthy']);
        self::assertSame([], $snapshot['schema']['missing']);
        foreach ([
            'event_status_history',
            'event_series',
            'event_waitlist_offer_envelopes',
            'event_waitlist_offer_envelope_access',
        ] as $requiredTable) {
            self::assertContains($requiredTable, $snapshot['schema']['available']);
        }
        self::assertNotContains('event_lifecycle_history', $snapshot['schema']['available']);
        self::assertNotContains('event_lifecycle_history', $snapshot['schema']['missing']);
        self::assertSame([], $snapshot['integrity']['issues']);
        self::assertArrayNotHasKey('payload', $snapshot['notifications']);
        self::assertStringNotContainsString('sample_ids', json_encode($snapshot, JSON_THROW_ON_ERROR));

        $this->artisan('events:health', [
            '--tenant' => (int) $tenant->id,
            '--json' => true,
        ])->assertExitCode(0);
    }

    public function test_overdue_reminder_fails_health_without_exposing_event_or_recipient_data(): void
    {
        $tenant = Tenant::factory()->create();
        $organizer = User::factory()->forTenant((int) $tenant->id)->create([
            'status' => 'active',
            'is_approved' => true,
            'email' => 'health-organizer-private@example.test',
        ]);
        $attendee = User::factory()->forTenant((int) $tenant->id)->create([
            'status' => 'active',
            'is_approved' => true,
            'email' => 'health-attendee-private@example.test',
        ]);
        $privateTitle = 'Private health fixture ' . bin2hex(random_bytes(8));
        $eventId = $this->event((int) $tenant->id, (int) $organizer->id, $privateTitle);
        DB::table('event_reminders')->insert([
            'tenant_id' => (int) $tenant->id,
            'event_id' => $eventId,
            'user_id' => (int) $attendee->id,
            'remind_before_minutes' => 60,
            'reminder_type' => 'both',
            'scheduled_for' => now()->subMinutes(15),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $snapshot = app(EventHealthService::class)->snapshot((int) $tenant->id, 600);
        $encoded = json_encode($snapshot, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

        self::assertFalse($snapshot['healthy']);
        self::assertTrue($snapshot['reminders']['unhealthy']);
        self::assertSame(1, $snapshot['reminders']['overdue_pending']);
        self::assertGreaterThan(600, $snapshot['reminders']['oldest_overdue_age_seconds']);
        self::assertStringNotContainsString($privateTitle, $encoded);
        self::assertStringNotContainsString('health-organizer-private@example.test', $encoded);
        self::assertStringNotContainsString('health-attendee-private@example.test', $encoded);
        self::assertSame([], array_intersect(
            ['event_id', 'recipient_user_id', 'user_id', 'sample_ids', 'payload'],
            $this->recursiveKeys($snapshot),
        ));

        $this->artisan('events:health', [
            '--tenant' => (int) $tenant->id,
            '--max-overdue' => 600,
            '--json' => true,
        ])->assertExitCode(1);
    }

    public function test_command_rejects_invalid_operational_bounds(): void
    {
        $this->artisan('events:health', ['--tenant' => 'not-an-id'])
            ->assertExitCode(2);
        $this->artisan('events:health', ['--max-overdue' => 59])
            ->assertExitCode(2);
        $this->artisan('events:health', ['--max-overdue' => 86_401])
            ->assertExitCode(2);
    }

    public function test_authoritative_delivery_mode_fails_closed_without_consumer(): void
    {
        $tenant = Tenant::factory()->create();
        config()->set('events.notification_delivery.mode', 'outbox_authoritative');
        config()->set('events.notification_delivery.consumer_enabled', false);

        $snapshot = app(EventHealthService::class)->snapshot((int) $tenant->id, 600);

        self::assertFalse($snapshot['healthy']);
        self::assertTrue($snapshot['notifications']['unhealthy']);
        self::assertTrue($snapshot['notifications']['authoritative_consumer_misconfigured']);
        self::assertSame('outbox_authoritative', $snapshot['notifications']['delivery_mode']);
        self::assertSame('global', $snapshot['notifications']['delivery_configuration']['source']);
        self::assertFalse($snapshot['notifications']['delivery_configuration_invalid']);
    }

    public function test_unowned_authoritative_domain_fact_blocks_cutover(): void
    {
        $tenant = Tenant::factory()->create();
        $organizer = User::factory()->forTenant((int) $tenant->id)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $eventId = $this->event(
            (int) $tenant->id,
            (int) $organizer->id,
            'Unowned outbox health fixture',
        );
        config()->set('events.notification_delivery.mode', 'outbox_authoritative');
        config()->set('events.notification_delivery.consumer_enabled', true);
        (new EventDomainOutboxService())->record(
            (int) $tenant->id,
            $eventId,
            1,
            'event.unowned.fixture',
            'health-unowned:' . bin2hex(random_bytes(8)),
            [
                'schema_version' => 1,
                'tenant_id' => (int) $tenant->id,
                'event_id' => $eventId,
            ],
            EventNotificationDeliveryMode::OutboxAuthoritative,
        );
        $corrupt = (new EventDomainOutboxService())->record(
            (int) $tenant->id,
            $eventId,
            2,
            'event.lifecycle.transitioned',
            'health-corrupt-status:' . bin2hex(random_bytes(8)),
            [
                'schema_version' => 1,
                'tenant_id' => (int) $tenant->id,
                'event_id' => $eventId,
            ],
            EventNotificationDeliveryMode::OutboxAuthoritative,
        );
        DB::table('event_domain_outbox')->where('id', $corrupt['id'])->update(['status' => 'unknown_status']);

        $snapshot = app(EventHealthService::class)->snapshot((int) $tenant->id, 600);

        self::assertFalse($snapshot['healthy']);
        self::assertTrue($snapshot['domain_outbox']['unhealthy']);
        self::assertSame(1, $snapshot['domain_outbox']['unowned_authoritative_facts']);
        self::assertSame(1, $snapshot['domain_outbox']['invalid_authoritative_statuses']);
    }

    public function test_tenant_delivery_mode_override_and_invalid_configuration_are_visible_but_payload_free(): void
    {
        Config::set('events.notification_delivery.mode', 'direct');
        Config::set('events.notification_delivery.consumer_enabled', false);
        $authoritativeTenant = Tenant::factory()->create();
        DB::table('tenants')->where('id', $authoritativeTenant->id)->update([
            'configuration' => json_encode([
                'events' => ['notification_delivery_mode' => 'outbox_authoritative'],
            ], JSON_THROW_ON_ERROR),
        ]);

        $authoritative = app(EventHealthService::class)->snapshot((int) $authoritativeTenant->id, 600);

        self::assertFalse($authoritative['healthy']);
        self::assertSame('outbox_authoritative', $authoritative['notifications']['delivery_mode']);
        self::assertSame('tenant_override', $authoritative['notifications']['delivery_configuration']['source']);
        self::assertTrue($authoritative['notifications']['delivery_configuration']['tenant_override_present']);
        self::assertTrue($authoritative['notifications']['delivery_configuration']['tenant_configuration_valid']);
        self::assertTrue($authoritative['notifications']['authoritative_consumer_misconfigured']);

        $invalidTenantValue = 'private-invalid-mode-' . bin2hex(random_bytes(8));
        $invalidTenant = Tenant::factory()->create();
        DB::table('tenants')->where('id', $invalidTenant->id)->update([
            'configuration' => json_encode([
                'events' => ['notification_delivery_mode' => $invalidTenantValue],
            ], JSON_THROW_ON_ERROR),
        ]);
        $invalidOverride = app(EventHealthService::class)->snapshot((int) $invalidTenant->id, 600);
        $invalidOverrideJson = json_encode($invalidOverride, JSON_THROW_ON_ERROR);

        self::assertFalse($invalidOverride['healthy']);
        self::assertSame('direct', $invalidOverride['notifications']['delivery_mode']);
        self::assertSame('global', $invalidOverride['notifications']['delivery_configuration']['source']);
        self::assertFalse($invalidOverride['notifications']['delivery_configuration']['tenant_configuration_valid']);
        self::assertTrue($invalidOverride['notifications']['delivery_configuration_invalid']);
        self::assertStringNotContainsString($invalidTenantValue, $invalidOverrideJson);

        $invalidGlobalValue = 'private-invalid-global-' . bin2hex(random_bytes(8));
        Config::set('events.notification_delivery.mode', $invalidGlobalValue);
        $globalTenant = Tenant::factory()->create();
        $invalidGlobal = app(EventHealthService::class)->snapshot((int) $globalTenant->id, 600);
        $invalidGlobalJson = json_encode($invalidGlobal, JSON_THROW_ON_ERROR);

        self::assertFalse($invalidGlobal['healthy']);
        self::assertSame('direct', $invalidGlobal['notifications']['delivery_mode']);
        self::assertSame('safe_default', $invalidGlobal['notifications']['delivery_configuration']['source']);
        self::assertFalse($invalidGlobal['notifications']['delivery_configuration']['global_configuration_valid']);
        self::assertTrue($invalidGlobal['notifications']['delivery_configuration_invalid']);
        self::assertStringNotContainsString($invalidGlobalValue, $invalidGlobalJson);
    }

    /**
     * E-102: attendance facts are an audit record — nothing consumes them,
     * by design (the attendance history itself lives in
     * event_attendance_activity). Written as outbox_authoritative under the
     * default delivery mode they sat `pending` for ever and the health check
     * reported them as an unowned backlog blocking cutover. They no longer
     * count; a genuinely unowned action still does.
     */
    public function test_audit_only_attendance_facts_are_not_an_unowned_backlog(): void
    {
        $tenant = Tenant::factory()->create();
        $organizer = User::factory()->forTenant((int) $tenant->id)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $eventId = $this->event(
            (int) $tenant->id,
            (int) $organizer->id,
            'Audit-only attendance health fixture',
        );
        config()->set('events.notification_delivery.mode', 'outbox_authoritative');
        config()->set('events.notification_delivery.consumer_enabled', true);
        foreach (['event.attendance.recorded', 'event.attendance.transitioned'] as $version => $action) {
            (new EventDomainOutboxService())->record(
                (int) $tenant->id,
                $eventId,
                $version + 1,
                $action,
                'health-audit-only:' . bin2hex(random_bytes(8)),
                [
                    'schema_version' => 2,
                    'tenant_id' => (int) $tenant->id,
                    'event_id' => $eventId,
                    'attendance_id' => 1,
                ],
                EventNotificationDeliveryMode::OutboxAuthoritative,
            );
        }

        $snapshot = app(EventHealthService::class)->snapshot((int) $tenant->id, 600);

        self::assertSame(0, $snapshot['domain_outbox']['unowned_authoritative_facts']);
        self::assertFalse($snapshot['domain_outbox']['unhealthy']);
        // Still never claimed by the notification consumer.
        self::assertFalse(EventNotificationOutboxScope::includes('event.attendance.transitioned'));
        self::assertFalse(EventNotificationOutboxScope::includes('event.attendance.recorded'));

        (new EventDomainOutboxService())->record(
            (int) $tenant->id,
            $eventId,
            3,
            'event.unowned.fixture',
            'health-audit-only-control:' . bin2hex(random_bytes(8)),
            ['schema_version' => 1, 'tenant_id' => (int) $tenant->id, 'event_id' => $eventId],
            EventNotificationDeliveryMode::OutboxAuthoritative,
        );

        $control = app(EventHealthService::class)->snapshot((int) $tenant->id, 600);

        self::assertSame(1, $control['domain_outbox']['unowned_authoritative_facts']);
        self::assertTrue($control['domain_outbox']['unhealthy']);
    }

    public function test_tenant_health_excludes_other_tenant_backlogs(): void
    {
        $healthyTenant = Tenant::factory()->create();
        $backloggedTenant = Tenant::factory()->create();
        $organizer = User::factory()->forTenant((int) $backloggedTenant->id)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $attendee = User::factory()->forTenant((int) $backloggedTenant->id)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $eventId = $this->event(
            (int) $backloggedTenant->id,
            (int) $organizer->id,
            'Cross-tenant private health fixture',
        );
        DB::table('event_reminders')->insert([
            'tenant_id' => (int) $backloggedTenant->id,
            'event_id' => $eventId,
            'user_id' => (int) $attendee->id,
            'remind_before_minutes' => 60,
            'reminder_type' => 'both',
            'scheduled_for' => now()->subMinutes(15),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        (new EventDomainOutboxService())->record(
            (int) $backloggedTenant->id,
            $eventId,
            1,
            'event.unowned.fixture',
            'health-cross-tenant:' . bin2hex(random_bytes(8)),
            [
                'schema_version' => 1,
                'tenant_id' => (int) $backloggedTenant->id,
                'event_id' => $eventId,
            ],
            EventNotificationDeliveryMode::OutboxAuthoritative,
        );

        $healthy = app(EventHealthService::class)->snapshot((int) $healthyTenant->id, 600);
        $backlogged = app(EventHealthService::class)->snapshot((int) $backloggedTenant->id, 600);
        $global = app(EventHealthService::class)->snapshot(null, 600);

        self::assertTrue($healthy['healthy']);
        self::assertSame(0, $healthy['reminders']['overdue_pending']);
        self::assertSame(0, $healthy['domain_outbox']['unowned_authoritative_facts']);
        self::assertFalse($backlogged['healthy']);
        self::assertSame(1, $backlogged['reminders']['overdue_pending']);
        self::assertSame(1, $backlogged['domain_outbox']['unowned_authoritative_facts']);
        self::assertFalse($global['healthy']);
        self::assertSame(1, $global['reminders']['overdue_pending']);
        self::assertSame(1, $global['domain_outbox']['unowned_authoritative_facts']);
    }

    public function test_invalid_channel_configuration_fails_health_without_echoing_values(): void
    {
        $tenant = Tenant::factory()->create();
        $unknownChannel = 'private-channel-' . bin2hex(random_bytes(8));
        Config::set('events.notification_delivery.channels', ['email', $unknownChannel]);

        $unknown = app(EventHealthService::class)->snapshot((int) $tenant->id, 600);
        $encoded = json_encode($unknown, JSON_THROW_ON_ERROR);

        self::assertFalse($unknown['healthy']);
        self::assertTrue($unknown['notifications']['unhealthy']);
        self::assertTrue($unknown['notifications']['channel_configuration_invalid']);
        self::assertFalse($unknown['notifications']['channel_configuration']['valid']);
        self::assertSame(1, $unknown['notifications']['channel_configuration']['invalid_entry_count']);
        self::assertStringNotContainsString($unknownChannel, $encoded);

        Config::set('events.notification_delivery.channels', []);
        $empty = app(EventHealthService::class)->snapshot((int) $tenant->id, 600);

        self::assertFalse($empty['healthy']);
        self::assertSame('empty', $empty['notifications']['channel_configuration']['reason']);
    }

    public function test_recurrence_health_reports_v2_identity_cutover_gaps_without_identifiers(): void
    {
        $tenant = Tenant::factory()->create();
        $organizer = User::factory()->forTenant((int) $tenant->id)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $templateId = $this->event(
            (int) $tenant->id,
            (int) $organizer->id,
            'Recurrence health template',
        );
        DB::table('events')->where('id', $templateId)->update([
            'is_recurring_template' => 1,
            'recurrence_engine' => EventRecurrenceService::ENGINE,
            'recurrence_engine_version' => EventRecurrenceService::ENGINE_VERSION,
        ]);
        $privateTitle = 'Private recurrence identity gap ' . bin2hex(random_bytes(8));
        $occurrenceId = $this->event(
            (int) $tenant->id,
            (int) $organizer->id,
            $privateTitle,
        );
        DB::table('events')->where('id', $occurrenceId)->update([
            'parent_event_id' => $templateId,
            'recurrence_engine' => EventRecurrenceService::ENGINE,
            'recurrence_engine_version' => EventRecurrenceService::ENGINE_VERSION,
            'recurrence_id' => null,
        ]);

        $snapshot = app(EventHealthService::class)->snapshot((int) $tenant->id, 600);
        $encoded = json_encode($snapshot, JSON_THROW_ON_ERROR);

        self::assertFalse($snapshot['healthy']);
        self::assertTrue($snapshot['recurrence']['unhealthy']);
        self::assertSame(1, $snapshot['recurrence']['v2_missing_recurrence_id']);
        self::assertSame(0, $snapshot['recurrence']['recurrence_identity_violations']);
        self::assertSame(0, $snapshot['recurrence']['override_evidence_violations']);
        self::assertStringNotContainsString($privateTitle, $encoded);
        self::assertSame([], array_intersect(
            ['event_id', 'recipient_user_id', 'user_id', 'sample_ids', 'payload'],
            $this->recursiveKeys($snapshot),
        ));
    }

    public function test_expired_offer_uses_overdue_grace_but_reports_total(): void
    {
        $tenant = Tenant::factory()->create();
        $organizer = User::factory()->forTenant((int) $tenant->id)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $eventId = $this->event((int) $tenant->id, (int) $organizer->id, 'Offer grace fixture');
        $offer = $this->sealedOfferFixture((int) $tenant->id, $eventId, (int) $organizer->id);
        $recentExpiry = now()->subSeconds(30);
        DB::table('event_waitlist_entries')->where('id', $offer['entry_id'])->update([
            'offer_expires_at' => $recentExpiry,
        ]);
        DB::table('event_waitlist_offer_envelopes')->where('id', $offer['envelope_id'])->update([
            'expires_at' => $recentExpiry,
        ]);

        $withinGrace = app(EventHealthService::class)->snapshot((int) $tenant->id, 600);

        self::assertTrue($withinGrace['healthy']);
        self::assertSame(1, $withinGrace['waitlist']['expired_active_offers']);
        self::assertSame(0, $withinGrace['waitlist']['overdue_expired_active_offers']);
        self::assertFalse($withinGrace['waitlist']['unhealthy']);

        $overdueExpiry = now()->subSeconds(900);
        DB::table('event_waitlist_entries')->where('id', $offer['entry_id'])->update([
            'offer_expires_at' => $overdueExpiry,
        ]);
        DB::table('event_waitlist_offer_envelopes')->where('id', $offer['envelope_id'])->update([
            'expires_at' => $overdueExpiry,
        ]);
        $beyondGrace = app(EventHealthService::class)->snapshot((int) $tenant->id, 600);

        self::assertFalse($beyondGrace['healthy']);
        self::assertSame(1, $beyondGrace['waitlist']['overdue_expired_active_offers']);
        self::assertTrue($beyondGrace['waitlist']['unhealthy']);
    }

    public function test_health_never_exposes_outbox_replay_delivery_or_envelope_secrets(): void
    {
        $tenant = Tenant::factory()->create();
        $organizer = User::factory()->forTenant((int) $tenant->id)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $eventId = $this->event((int) $tenant->id, (int) $organizer->id, 'Leakage guard fixture');
        $offer = $this->sealedOfferFixture((int) $tenant->id, $eventId, (int) $organizer->id);
        $payloadSecret = 'private-payload-' . bin2hex(random_bytes(8));
        $errorSecret = 'private-error-' . bin2hex(random_bytes(8));
        $replaySecret = 'private-replay-' . bin2hex(random_bytes(8));
        $operatorSecret = 'private-operator-' . bin2hex(random_bytes(8)) . '@example.test';
        DB::table('event_domain_outbox')->where('id', $offer['outbox_id'])->update([
            'payload' => json_encode(['private' => $payloadSecret], JSON_THROW_ON_ERROR),
            'last_error' => $errorSecret,
        ]);
        $deliveryKey = EventDomainOutboxService::deliveryKey(
            (int) $tenant->id,
            $eventId,
            'event.waitlist.offered',
            (int) $organizer->id,
            'in_app',
            1,
        );
        $delivery = (new EventDomainOutboxService())->ensureDelivery(
            $offer['outbox_id'],
            (int) $organizer->id,
            'in_app',
            $deliveryKey,
        );
        DB::table('event_notification_deliveries')->where('id', $delivery['id'])->update([
            'last_error' => $errorSecret,
        ]);
        DB::table('event_notification_outbox_replays')->insert([
            'tenant_id' => (int) $tenant->id,
            'outbox_id' => $offer['outbox_id'],
            'requested_by' => $operatorSecret,
            'reason' => $replaySecret,
            'previous_attempts' => 1,
            'previous_error_fingerprint' => hash('sha256', $errorSecret),
            'created_at' => now(),
        ]);
        $ciphertext = (string) DB::table('event_waitlist_offer_envelopes')
            ->where('id', $offer['envelope_id'])
            ->value('token_ciphertext');
        self::assertNotSame('', $ciphertext);

        $snapshot = app(EventHealthService::class)->snapshot((int) $tenant->id, 600);
        $encoded = json_encode($snapshot, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

        self::assertTrue($snapshot['payload_free']);
        foreach ([$offer['offer_token'], $payloadSecret, $errorSecret, $replaySecret, $operatorSecret, $ciphertext] as $secret) {
            self::assertStringNotContainsString($secret, $encoded);
        }
        self::assertSame([], array_intersect(
            ['event_id', 'recipient_user_id', 'user_id', 'sample_ids', 'payload', 'last_error', 'token_ciphertext'],
            $this->recursiveKeys($snapshot),
        ));
    }

    /** @param array<string,mixed> $value @return list<string> */
    private function recursiveKeys(array $value): array
    {
        $keys = [];
        foreach ($value as $key => $child) {
            $keys[] = (string) $key;
            if (is_array($child)) {
                $keys = [...$keys, ...$this->recursiveKeys($child)];
            }
        }

        return array_values(array_unique($keys));
    }

    /** @return array{entry_id:int,outbox_id:int,envelope_id:int,offer_token:string} */
    private function sealedOfferFixture(int $tenantId, int $eventId, int $userId): array
    {
        Config::set('app.key', 'base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=');
        Config::set('event_waitlist.envelope.active_key_version', 'health-test-v1');
        Config::set('event_waitlist.envelope.active_key', null);
        Config::set('event_waitlist.envelope.previous_keys', []);
        Config::set('event_waitlist.envelope.fallback_to_app_key', true);
        $offerToken = 'health-offer-' . bin2hex(random_bytes(24));
        $offeredAt = now()->subHour();
        $expiresAt = now()->addHour();
        $entryId = (int) DB::table('event_waitlist_entries')->insertGetId([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'user_id' => $userId,
            'capacity_pool_key' => 'event',
            'allocation_key' => null,
            'queue_state' => 'offered',
            'queue_version' => 1,
            'queue_sequence' => 1,
            'state_changed_at' => $offeredAt,
            'state_changed_by' => $userId,
            'offered_at' => $offeredAt,
            'offer_expires_at' => $expiresAt,
            'offer_token_hash' => hash('sha256', $offerToken),
            'created_at' => $offeredAt,
            'updated_at' => now(),
        ]);
        DB::table('event_waitlist_entry_history')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'waitlist_entry_id' => $entryId,
            'user_id' => $userId,
            'actor_user_id' => $userId,
            'capacity_pool_key' => 'event',
            'allocation_key' => null,
            'queue_version' => 1,
            'queue_sequence' => 1,
            'action' => 'offered',
            'from_state' => 'waiting',
            'to_state' => 'offered',
            'idempotency_key' => 'health-offer-history:' . bin2hex(random_bytes(12)),
            'reason' => null,
            'metadata' => json_encode(['schema_version' => 1, 'source' => 'health_test'], JSON_THROW_ON_ERROR),
            'created_at' => $offeredAt,
        ]);
        $outbox = (new EventDomainOutboxService())->record(
            $tenantId,
            $eventId,
            1,
            'event.waitlist.offered',
            'health-offer-outbox:' . bin2hex(random_bytes(12)),
            [
                'schema_version' => 1,
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'waitlist_entry_id' => $entryId,
                'user_id' => $userId,
                'queue_version' => 1,
                'to_state' => 'offered',
            ],
            EventNotificationDeliveryMode::Direct,
        );
        /** @var EventWaitlistEntry $entry */
        $entry = EventWaitlistEntry::withoutGlobalScopes()->whereKey($entryId)->firstOrFail();
        $envelope = TenantContext::runForTenant(
            $tenantId,
            static fn () => DB::transaction(
                static fn () => (new EventWaitlistOfferEnvelopeService())->seal(
                    $entry,
                    (int) $outbox['id'],
                    'event.waitlist.offered',
                    $offerToken,
                ),
                3,
            ),
        );

        return [
            'entry_id' => $entryId,
            'outbox_id' => (int) $outbox['id'],
            'envelope_id' => (int) $envelope->getKey(),
            'offer_token' => $offerToken,
        ];
    }

    private function event(int $tenantId, int $organizerId, string $title): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $organizerId,
            'title' => $title,
            'description' => 'Health fixture description.',
            'start_time' => now()->addDay(),
            'end_time' => now()->addDay()->addHour(),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'occurrence_key' => 'health:' . bin2hex(random_bytes(12)),
            'is_recurring_template' => 0,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
