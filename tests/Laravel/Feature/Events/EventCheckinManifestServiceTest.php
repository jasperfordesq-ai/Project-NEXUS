<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventCheckinDeviceStatus;
use App\Exceptions\EventOfflineCheckinException;
use App\Models\User;
use App\Services\EventCheckinCredentialService;
use App\Services\EventCheckinDeviceService;
use App\Services\EventCheckinManifestService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class EventCheckinManifestServiceTest extends TestCase
{
    use DatabaseTransactions;

    private EventCheckinCredentialService $credentials;
    private EventCheckinDeviceService $devices;
    private EventCheckinManifestService $manifests;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->credentials = new EventCheckinCredentialService();
        $this->devices = new EventCheckinDeviceService();
        $this->manifests = new EventCheckinManifestService($this->devices);
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_manifest_is_minimal_private_versioned_and_supports_manual_identity(): void
    {
        $owner = $this->user('Manifest Owner');
        $attendee = $this->user('Manifest Attendee', [
            'email' => 'private-attendee@example.test',
            'phone' => '+1 555 999 7777',
        ]);
        $eventId = $this->event((int) $owner->id);
        $registrationId = $this->registration($eventId, (int) $attendee->id);
        $credential = $this->credentials->issue(
            $eventId,
            $registrationId,
            (int) $owner->id,
            'manifest-credential-issue',
        );
        $device = $this->devices->register(
            $eventId,
            (int) $owner->id,
            '<b>Front desk tablet</b>',
            'manifest-device-register',
        );
        self::assertNotNull($credential->secret);
        self::assertNotNull($device->secret);
        self::assertSame('Front desk tablet', $device->device->label);
        DB::table('event_attendance')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => (int) $attendee->id,
            'attendance_status' => 'checked_in',
            'attendance_version' => 3,
            'status_changed_at' => now(),
            'status_changed_by' => (int) $owner->id,
            'checked_in_at' => now(),
            'checked_in_by' => (int) $owner->id,
            'notes' => 'Private accessibility note must not leave the server',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $manifest = $this->manifests->generate(
            $eventId,
            $device->secret,
            (int) $owner->id,
            60,
        );
        $payload = $manifest->toArray();
        self::assertSame(2, $payload['schema_version']);
        self::assertSame($this->testTenantId, $payload['tenant_id']);
        self::assertSame($eventId, $payload['event_id']);
        self::assertSame("occurrence:{$eventId}", $payload['occurrence_key']);
        self::assertSame(2, $payload['manifest_version']);
        self::assertSame([
            'registration_id',
            'user_id',
            'display_name',
            'credential_version',
            'credential_fingerprint',
            'credential_verifier',
            'attendance_status',
            'attendance_version',
        ], array_keys($payload['registrations'][0]));
        self::assertSame('Manifest Attendee', $payload['registrations'][0]['display_name']);
        self::assertSame('checked_in', $payload['registrations'][0]['attendance_status']);
        self::assertSame(3, $payload['registrations'][0]['attendance_version']);
        self::assertSame(
            hash('sha256', $credential->secret),
            $payload['registrations'][0]['credential_verifier'],
        );
        self::assertSame('nqx2', $payload['credential_verification']['format']);
        self::assertSame('Ed25519', $payload['credential_verification']['algorithm']);
        self::assertNotEmpty($payload['credential_verification']['keys']);
        self::assertTrue($payload['privacy']['encrypted_at_rest_required']);
        self::assertFalse($payload['privacy']['credential_contains_pii']);

        $encoded = json_encode($payload, JSON_THROW_ON_ERROR);
        foreach ([
            'private-attendee@example.test',
            '+1 555 999 7777',
            'Private accessibility note',
            $credential->secret,
            $device->secret,
            'registration_answers',
            'meeting_link',
            'phone',
            'email',
            'notes',
        ] as $forbidden) {
            self::assertStringNotContainsString($forbidden, $encoded, $forbidden);
        }
    }

    public function test_credential_and_device_rotation_or_revocation_change_the_projection_monotonically(): void
    {
        $owner = $this->user('Operations Owner');
        $attendee = $this->user('Operations Attendee');
        $eventId = $this->event((int) $owner->id);
        $registrationId = $this->registration($eventId, (int) $attendee->id);
        $firstCredential = $this->credentials->issue(
            $eventId,
            $registrationId,
            (int) $owner->id,
            'projection-credential-issue',
        );
        $firstDevice = $this->devices->register(
            $eventId,
            (int) $owner->id,
            'Operations tablet',
            'projection-device-register',
        );
        self::assertNotNull($firstCredential->secret);
        self::assertNotNull($firstDevice->secret);

        $rotatedCredential = $this->credentials->rotate(
            $eventId,
            (int) $firstCredential->credential->id,
            (int) $owner->id,
            1,
            'projection-credential-rotate',
        );
        $rotatedDevice = $this->devices->rotate(
            $eventId,
            (int) $firstDevice->device->id,
            (int) $owner->id,
            1,
            'projection-device-rotate',
        );
        $deviceReplay = $this->devices->rotate(
            $eventId,
            (int) $firstDevice->device->id,
            (int) $owner->id,
            1,
            'projection-device-rotate',
        );
        self::assertNotNull($rotatedCredential->secret);
        self::assertNotNull($rotatedDevice->secret);
        self::assertNull($deviceReplay->secret);
        self::assertFalse($deviceReplay->issued);

        $this->assertReason(
            'event_checkin_device_invalid',
            fn () => $this->manifests->generate(
                $eventId,
                (string) $firstDevice->secret,
                (int) $owner->id,
            ),
        );
        $manifest = $this->manifests->generate(
            $eventId,
            $rotatedDevice->secret,
            (int) $owner->id,
        );
        self::assertSame(4, $manifest->manifestVersion);
        self::assertCount(1, $manifest->registrations);
        self::assertSame(2, $manifest->registrations[0]['credential_version']);
        self::assertSame(
            hash('sha256', $rotatedCredential->secret),
            $manifest->registrations[0]['credential_verifier'],
        );
        self::assertNotSame(
            hash('sha256', (string) $firstCredential->secret),
            $manifest->registrations[0]['credential_verifier'],
        );

        $revoked = $this->devices->revoke(
            $eventId,
            (int) $rotatedDevice->device->id,
            (int) $owner->id,
            2,
            'Tablet lost in transit',
        );
        self::assertSame(EventCheckinDeviceStatus::Revoked, $revoked->status);
        self::assertSame(3, (int) $revoked->device_version);
        self::assertSame(5, (int) DB::table('events')
            ->where('id', $eventId)
            ->value('checkin_manifest_version'));
        $this->assertReason(
            'event_checkin_device_not_active',
            fn () => $this->manifests->generate(
                $eventId,
                $rotatedDevice->secret,
                (int) $owner->id,
            ),
        );
    }

    public function test_manifest_ttl_device_actor_expiry_and_cancelled_registration_fail_closed(): void
    {
        $now = CarbonImmutable::parse('2027-02-01T09:00:00Z');
        CarbonImmutable::setTestNow($now);
        $owner = $this->user('TTL Owner');
        $otherStaff = $this->user('Other Staff');
        $attendee = $this->user('TTL Attendee');
        $eventId = $this->event((int) $owner->id, $now->addDay());
        $registrationId = $this->registration($eventId, (int) $attendee->id);
        $credential = $this->credentials->issue(
            $eventId,
            $registrationId,
            (int) $owner->id,
            'ttl-credential-issue',
        );
        $device = $this->devices->register(
            $eventId,
            (int) $owner->id,
            'Short-lived tablet',
            'ttl-device-register',
            $now->addMinutes(5),
        );
        self::assertNotNull($credential->secret);
        self::assertNotNull($device->secret);

        $manifest = $this->manifests->generate(
            $eventId,
            $device->secret,
            (int) $owner->id,
            60,
        );
        self::assertSame(
            $now->addMinutes(5)->toIso8601String(),
            $manifest->expiresAt->toIso8601String(),
        );
        $this->assertReason(
            'event_checkin_actor_invalid',
            fn () => $this->manifests->generate(
                $eventId,
                $device->secret,
                (int) $otherStaff->id,
            ),
        );
        $this->assertReason(
            'event_checkin_manifest_ttl_invalid',
            fn () => $this->manifests->generate(
                $eventId,
                $device->secret,
                (int) $owner->id,
                1441,
            ),
        );

        DB::table('event_registrations')->where('id', $registrationId)->update([
            'registration_state' => 'cancelled',
            'registration_version' => 2,
            'state_changed_at' => now(),
            'cancelled_at' => now(),
            'updated_at' => now(),
        ]);
        self::assertCount(0, $this->manifests->generate(
            $eventId,
            $device->secret,
            (int) $owner->id,
        )->registrations);

        CarbonImmutable::setTestNow($now->addMinutes(6));
        $this->assertReason(
            'event_checkin_device_expired',
            fn () => $this->manifests->generate(
                $eventId,
                $device->secret,
                (int) $owner->id,
            ),
        );
        $expired = $this->devices->expire(
            $eventId,
            (int) $device->device->id,
            1,
        );
        self::assertSame(EventCheckinDeviceStatus::Expired, $expired->status);
        self::assertSame(2, (int) $expired->device_version);
    }

    private function user(string $name, array $overrides = []): User
    {
        // Split into the NAME PARTS. UserObserver::saving() recomputes the stored
        // `name` column from first_name/last_name, so passing `name` alone leaves
        // the faker-generated parts to overwrite it.
        [$first, $last] = array_pad(explode(' ', $name, 2), 2, '');

        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'first_name' => $first,
            'last_name' => $last,
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function event(int $ownerId, ?CarbonImmutable $start = null): int
    {
        $start ??= CarbonImmutable::now('UTC')->addMonth()->startOfHour();
        $eventId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'Manifest fixture',
            'description' => 'Manifest fixture.',
            'start_time' => $start,
            'end_time' => $start->addHours(4),
            'timezone' => 'UTC',
            'timezone_source' => 'test',
            'all_day' => false,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'is_recurring_template' => false,
            'checkin_manifest_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('events')->where('id', $eventId)->update([
            'occurrence_key' => "occurrence:{$eventId}",
        ]);

        return $eventId;
    }

    private function registration(int $eventId, int $userId): int
    {
        return (int) DB::table('event_registrations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $userId,
            'capacity_pool_key' => 'event',
            'registration_state' => 'confirmed',
            'registration_version' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => $userId,
            'confirmed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @param callable():mixed $operation */
    private function assertReason(string $reason, callable $operation): void
    {
        try {
            $operation();
            self::fail("Expected {$reason}.");
        } catch (EventOfflineCheckinException $exception) {
            self::assertSame($reason, $exception->reasonCode);
            self::assertSame($reason, $exception->getMessage());
        }
    }
}
