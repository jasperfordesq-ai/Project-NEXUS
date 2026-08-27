<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventOfflineSyncBatchStatus;
use App\Enums\EventOfflineSyncOutcome;
use App\Exceptions\EventOfflineCheckinException;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Services\EventAttendanceService;
use App\Services\EventCheckinCredentialService;
use App\Services\EventCheckinDeviceService;
use App\Services\EventOfflineCheckinProcessor;
use App\Services\EventOfflineCheckinResolutionService;
use App\Services\EventOfflineCheckinSyncService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class EventOfflineCheckinPhaseBTest extends TestCase
{
    use DatabaseTransactions;

    private EventCheckinCredentialService $credentials;
    private EventCheckinDeviceService $devices;
    private EventOfflineCheckinSyncService $sync;
    private EventOfflineCheckinProcessor $processor;
    private EventOfflineCheckinResolutionService $resolutions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        Config::set('events.attendance_credit_mode', 'off');
        $this->credentials = app(EventCheckinCredentialService::class);
        $this->devices = app(EventCheckinDeviceService::class);
        $this->sync = new EventOfflineCheckinSyncService($this->devices);
        $attendance = app(EventAttendanceService::class);
        $this->processor = new EventOfflineCheckinProcessor($this->sync, $attendance);
        $this->resolutions = new EventOfflineCheckinResolutionService(
            $this->sync,
            $attendance,
            app(EventPolicy::class),
        );
    }

    public function test_processor_applies_one_canonical_transition_and_replays_without_wallet_effects(): void
    {
        $fixture = $this->fixture('Apply');
        $staged = $this->sync->stage(
            $fixture['event_id'],
            $fixture['device_secret'],
            (int) $fixture['owner']->id,
            'phase-b-apply-batch',
            $fixture['manifest_version'],
            [$this->item('phase-b-apply-nonce', $fixture['credential_secret'], 'check_in', 0)],
        );

        $processed = $this->processor->processBatch((int) $staged->batch->id);

        self::assertSame(EventOfflineSyncBatchStatus::Completed, $processed->status);
        self::assertSame(1, (int) $processed->accepted_count);
        self::assertSame(0, (int) $processed->conflict_count);
        self::assertSame('checked_in', DB::table('event_attendance')
            ->where('event_id', $fixture['event_id'])
            ->where('user_id', $fixture['attendee']->id)
            ->value('attendance_status'));
        self::assertSame(1, DB::table('event_attendance_activity')
            ->where('event_id', $fixture['event_id'])
            ->count());
        $activity = DB::table('event_attendance_activity')
            ->where('event_id', $fixture['event_id'])
            ->first();
        $decision = DB::table('event_offline_sync_decisions')
            ->where('batch_id', $staged->batch->id)
            ->first();
        self::assertNotNull($activity);
        self::assertNotNull($decision);
        $stableKey = 'event-offline:' . $fixture['device_id'] . ':phase-b-apply-nonce';
        $attendanceKeyHash = hash('sha256', implode('|', [
            'event-attendance-v2',
            $this->testTenantId,
            $fixture['event_id'],
            (int) $fixture['attendee']->id,
            'check_in',
            $stableKey,
        ]));
        $decisionKeyHash = hash('sha256', $stableKey);
        self::assertSame($attendanceKeyHash, $activity->idempotency_key);
        self::assertSame($decisionKeyHash, $decision->idempotency_key_hash);
        self::assertSame('attendance_applied', $decision->decision_code);

        $replayed = $this->processor->processBatch((int) $staged->batch->id);
        self::assertSame(EventOfflineSyncBatchStatus::Completed, $replayed->status);
        $replayedActivity = DB::table('event_attendance_activity')
            ->where('event_id', $fixture['event_id'])
            ->first();
        $replayedDecision = DB::table('event_offline_sync_decisions')
            ->where('batch_id', $staged->batch->id)
            ->first();
        self::assertNotNull($replayedActivity);
        self::assertNotNull($replayedDecision);
        self::assertSame($activity->id, $replayedActivity->id);
        self::assertSame($attendanceKeyHash, $replayedActivity->idempotency_key);
        self::assertSame($decision->id, $replayedDecision->id);
        self::assertSame($decisionKeyHash, $replayedDecision->idempotency_key_hash);
        self::assertSame(1, DB::table('event_attendance_activity')
            ->where('event_id', $fixture['event_id'])
            ->count());
        self::assertSame(1, DB::table('event_offline_sync_decisions')
            ->where('batch_id', $staged->batch->id)
            ->count());
        self::assertSame(0, DB::table('event_attendance_credit_claims')
            ->where('event_id', $fixture['event_id'])
            ->count());
        self::assertSame(0, DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('transaction_type', 'event_checkin')
            ->count());
    }

    public function test_stale_copied_scan_becomes_private_conflict_and_resolution_is_idempotent(): void
    {
        $fixture = $this->fixture('Conflict');
        $first = $this->sync->stage(
            $fixture['event_id'],
            $fixture['device_secret'],
            (int) $fixture['owner']->id,
            'phase-b-conflict-prime',
            $fixture['manifest_version'],
            [$this->item('phase-b-conflict-prime-nonce', $fixture['credential_secret'], 'check_in', 0)],
        );
        $this->processor->processBatch((int) $first->batch->id);
        $stale = $this->sync->stage(
            $fixture['event_id'],
            $fixture['device_secret'],
            (int) $fixture['owner']->id,
            'phase-b-conflict-stale',
            $fixture['manifest_version'],
            [$this->item('phase-b-conflict-stale-nonce', $fixture['credential_secret'], 'check_out', 0)],
        );
        $processed = $this->processor->processBatch((int) $stale->batch->id);

        self::assertSame(1, (int) $processed->conflict_count);
        $initialDecision = DB::table('event_offline_sync_decisions')
            ->where('batch_id', $stale->batch->id)
            ->first();
        self::assertNotNull($initialDecision);
        self::assertSame(EventOfflineSyncOutcome::Conflict->value, $initialDecision->outcome);
        self::assertSame('event_attendance_version_conflict', $initialDecision->decision_code);
        $projection = $this->resolutions->conflicts(
            $fixture['event_id'],
            $fixture['owner'],
        );
        self::assertSame(1, $projection['total']);
        self::assertSame('Conflict Attendee', $projection['items'][0]['member']['display_name']);
        self::assertTrue($projection['privacy']['credential_redacted']);
        self::assertStringNotContainsString(
            'private-conflict@example.test',
            json_encode($projection, JSON_THROW_ON_ERROR),
        );

        $resolved = $this->resolutions->resolve(
            $fixture['event_id'],
            (int) $stale->items[0]->id,
            $fixture['owner'],
            1,
            'apply',
            1,
            '<b>Desk lead confirmed the departure</b>',
            'phase-b-conflict-resolution',
        );
        $replay = $this->resolutions->resolve(
            $fixture['event_id'],
            (int) $stale->items[0]->id,
            $fixture['owner'],
            1,
            'apply',
            1,
            '<b>Desk lead confirmed the departure</b>',
            'phase-b-conflict-resolution',
        );

        self::assertTrue($resolved->recorded);
        self::assertFalse($replay->recorded);
        self::assertSame($resolved->decision->id, $replay->decision->id);
        self::assertSame(2, (int) $resolved->decision->decision_version);
        self::assertSame('Desk lead confirmed the departure', $resolved->decision->decision_reason);
        self::assertSame('checked_out', DB::table('event_attendance')
            ->where('event_id', $fixture['event_id'])
            ->value('attendance_status'));
        self::assertSame(2, DB::table('event_attendance_activity')
            ->where('event_id', $fixture['event_id'])
            ->count());
        self::assertSame(0, $this->resolutions->conflicts(
            $fixture['event_id'],
            $fixture['owner'],
        )['total']);

        $outsider = $this->user('Conflict Outsider');
        $this->assertReason(
            'event_offline_resolution_forbidden',
            fn () => $this->resolutions->conflicts($fixture['event_id'], $outsider),
        );
    }

    public function test_rotated_credentials_and_revoked_devices_are_rejected_before_attendance(): void
    {
        $rotated = $this->fixture('Rotated');
        $rotatedBatch = $this->sync->stage(
            $rotated['event_id'],
            $rotated['device_secret'],
            (int) $rotated['owner']->id,
            'phase-b-rotated-batch',
            $rotated['manifest_version'],
            [$this->item('phase-b-rotated-nonce', $rotated['credential_secret'], 'check_in', 0)],
        );
        $this->credentials->rotate(
            $rotated['event_id'],
            $rotated['credential_id'],
            (int) $rotated['owner']->id,
            1,
            'phase-b-credential-rotation',
        );
        $this->processor->processBatch((int) $rotatedBatch->batch->id);
        self::assertSame('credential_rotated', DB::table('event_offline_sync_decisions')
            ->where('batch_id', $rotatedBatch->batch->id)
            ->value('decision_code'));

        $revoked = $this->fixture('Revoked');
        $revokedBatch = $this->sync->stage(
            $revoked['event_id'],
            $revoked['device_secret'],
            (int) $revoked['owner']->id,
            'phase-b-revoked-batch',
            $revoked['manifest_version'],
            [$this->item('phase-b-revoked-nonce', $revoked['credential_secret'], 'check_in', 0)],
        );
        $this->devices->revoke(
            $revoked['event_id'],
            $revoked['device_id'],
            (int) $revoked['owner']->id,
            1,
            'Device reported lost',
        );
        $this->processor->processBatch((int) $revokedBatch->batch->id);
        self::assertSame('device_revoked', DB::table('event_offline_sync_decisions')
            ->where('batch_id', $revokedBatch->batch->id)
            ->value('decision_code'));

        self::assertSame(0, DB::table('event_attendance')
            ->whereIn('event_id', [$rotated['event_id'], $revoked['event_id']])
            ->count());
        self::assertSame(0, DB::table('event_attendance_credit_claims')
            ->whereIn('event_id', [$rotated['event_id'], $revoked['event_id']])
            ->count());
    }

    /**
     * @return array{
     *   owner:User,attendee:User,event_id:int,credential_id:int,credential_secret:string,
     *   device_id:int,device_secret:string,manifest_version:int
     * }
     */
    private function fixture(string $prefix): array
    {
        $owner = $this->user("{$prefix} Owner");
        $attendee = $this->user("{$prefix} Attendee", [
            'email' => 'private-' . strtolower($prefix) . '@example.test',
        ]);
        $eventId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $owner->id,
            'title' => "{$prefix} offline check-in fixture",
            'description' => 'Offline processor fixture.',
            'start_time' => now()->subHour(),
            'end_time' => now()->addHours(2),
            'timezone' => 'UTC',
            'timezone_source' => 'test',
            'all_day' => 0,
            'is_recurring_template' => 0,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'checkin_manifest_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('events')->where('id', $eventId)->update([
            'occurrence_key' => "occurrence:{$eventId}",
        ]);
        $registrationId = (int) DB::table('event_registrations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => (int) $attendee->id,
            'capacity_pool_key' => 'event',
            'registration_state' => 'confirmed',
            'registration_version' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => (int) $owner->id,
            'confirmed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => (int) $attendee->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $credential = $this->credentials->issue(
            $eventId,
            $registrationId,
            (int) $owner->id,
            "phase-b-{$prefix}-credential",
            CarbonImmutable::now('UTC')->addHours(4),
        );
        $device = $this->devices->register(
            $eventId,
            (int) $owner->id,
            "{$prefix} front desk",
            "phase-b-{$prefix}-device",
            CarbonImmutable::now('UTC')->addHours(4),
        );
        self::assertNotNull($credential->secret);
        self::assertNotNull($device->secret);

        return [
            'owner' => $owner,
            'attendee' => $attendee,
            'event_id' => $eventId,
            'credential_id' => (int) $credential->credential->id,
            'credential_secret' => $credential->secret,
            'device_id' => (int) $device->device->id,
            'device_secret' => $device->secret,
            'manifest_version' => $device->manifestVersion,
        ];
    }

    /** @param array<string,mixed> $overrides */
    private function user(string $name, array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            // last_name must be pinned too: UserObserver::saving() recomputes the
            // stored `name` from first_name + last_name, so leaving the faker's
            // surname beside a set first_name appends it to the display name.
            'first_name' => $name,
            'last_name' => '',
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    /** @return array<string,mixed> */
    private function item(
        string $nonce,
        string $credential,
        string $operation,
        int $expectedVersion,
    ): array {
        $hash = hash('sha256', $credential);

        return [
            'client_nonce' => $nonce,
            'operation' => $operation,
            'observed_at' => CarbonImmutable::now('UTC')->toIso8601String(),
            'expected_attendance_version' => $expectedVersion,
            'credential_fingerprint' => substr($hash, 0, 16),
            'credential_hash_reference' => $hash,
        ];
    }

    /** @param callable():mixed $operation */
    private function assertReason(string $reason, callable $operation): void
    {
        try {
            $operation();
            self::fail("Expected {$reason}.");
        } catch (EventOfflineCheckinException $exception) {
            self::assertSame($reason, $exception->reasonCode);
        }
    }
}
