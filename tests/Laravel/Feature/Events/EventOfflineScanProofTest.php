<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Exceptions\EventOfflineCheckinException;
use App\Models\User;
use App\Services\EventCheckinCredentialService;
use App\Services\EventCheckinDeviceService;
use App\Services\EventOfflineCheckinSyncService;
use App\Support\Events\EventCheckinSecurity;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Offline check-ins can prove the QR code was actually scanned.
 *
 * The device manifest ships each registrant's credential hash so a phone can
 * verify a scan with no signal — but sync then accepted that same hash back as
 * the evidence, so a device holding the manifest could fabricate a check-in
 * for anyone on the list without meeting them. It grants no privilege the
 * operator lacks, but it did mean the offline trail could not be trusted to
 * mean "this person's code was scanned".
 *
 * A device may now send the raw scanned credential. The server hashes it
 * itself, and the manifest hash cannot be reversed into that raw value, so
 * possession is proven.
 */
final class EventOfflineScanProofTest extends TestCase
{
    use DatabaseTransactions;

    private EventCheckinCredentialService $credentials;

    private EventCheckinDeviceService $devices;

    private EventOfflineCheckinSyncService $sync;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->credentials = new EventCheckinCredentialService();
        $this->devices = new EventCheckinDeviceService();
        $this->sync = new EventOfflineCheckinSyncService($this->devices);
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    private function user(string $name): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'name' => $name,
            'first_name' => $name,
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    /** @return array{0:User,1:int,2:string,3:string,4:int} */
    private function fixture(CarbonImmutable $now): array
    {
        $owner = $this->user('Scan proof owner');
        $attendee = $this->user('Scan proof attendee');

        $start = $now->addDay();
        $eventId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $owner->id,
            'title' => 'Scan proof fixture',
            'description' => 'Scan proof fixture.',
            'start_time' => $start,
            'end_time' => $start->addHours(2),
            'timezone' => 'UTC',
            'timezone_source' => 'test',
            'all_day' => false,
            'is_recurring_template' => false,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 1,
            'occurrence_key' => 'scan-proof:' . bin2hex(random_bytes(12)),
            'created_at' => now(),
            'updated_at' => now(),
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

        $credential = $this->credentials->issue(
            $eventId,
            $registrationId,
            (int) $owner->id,
            'scan-proof-credential-' . bin2hex(random_bytes(4)),
        );
        $device = $this->devices->register(
            $eventId,
            (int) $owner->id,
            'Scan proof tablet',
            'scan-proof-device-' . bin2hex(random_bytes(4)),
        );
        self::assertNotNull($credential->secret);
        self::assertNotNull($device->secret);

        return [$owner, $eventId, $credential->secret, $device->secret, $device->manifestVersion];
    }

    public function test_sending_the_raw_scanned_credential_is_verified_server_side(): void
    {
        $now = CarbonImmutable::parse('2027-03-04 10:00:00', 'UTC');
        CarbonImmutable::setTestNow($now);
        [$owner, $eventId, $credentialSecret, $deviceSecret, $manifestVersion] = $this->fixture($now);

        $staged = $this->sync->stage(
            $eventId,
            $deviceSecret,
            (int) $owner->id,
            'scan-proof-batch-1',
            $manifestVersion,
            [[
                'client_nonce' => 'scan-proof-nonce-1',
                'operation' => 'check_in',
                'observed_at' => $now->toIso8601String(),
                'expected_attendance_version' => 0,
                // The raw QR string the device actually scanned.
                'credential' => $credentialSecret,
            ]],
        );

        $item = DB::table('event_offline_sync_items')
            ->where('batch_id', (int) $staged->batch->id)
            ->first();
        self::assertNotNull($item);

        // The server derived the hash itself rather than trusting the client.
        $expected = EventCheckinSecurity::credentialVerifier($credentialSecret);
        self::assertSame($expected['hash'], (string) $item->credential_hash_reference);
        self::assertSame($expected['fingerprint'], (string) $item->credential_fingerprint);

        // And it still resolves to the right registrant.
        self::assertNotNull($item->credential_id);
    }

    public function test_a_manifest_hash_alone_still_syncs_for_existing_devices(): void
    {
        $now = CarbonImmutable::parse('2027-03-04 10:00:00', 'UTC');
        CarbonImmutable::setTestNow($now);
        [$owner, $eventId, $credentialSecret, $deviceSecret, $manifestVersion] = $this->fixture($now);

        $hash = EventCheckinSecurity::credentialVerifier($credentialSecret)['hash'];

        // Existing devices keep working exactly as before — this is the
        // compatibility path, not a regression.
        $staged = $this->sync->stage(
            $eventId,
            $deviceSecret,
            (int) $owner->id,
            'scan-proof-batch-2',
            $manifestVersion,
            [[
                'client_nonce' => 'scan-proof-nonce-2',
                'operation' => 'check_in',
                'observed_at' => $now->toIso8601String(),
                'expected_attendance_version' => 0,
                'credential_fingerprint' => substr($hash, 0, 16),
                'credential_hash_reference' => $hash,
            ]],
        );

        $item = DB::table('event_offline_sync_items')
            ->where('batch_id', (int) $staged->batch->id)
            ->first();
        self::assertNotNull(
            $item,
            'Devices that only have the manifest hash must keep syncing — this is the compatibility path.',
        );
        self::assertSame($hash, (string) $item->credential_hash_reference);
    }

    public function test_the_unproven_path_can_be_refused_outright(): void
    {
        config(['events.offline_checkin.require_scan_proof' => true]);

        $now = CarbonImmutable::parse('2027-03-04 10:00:00', 'UTC');
        CarbonImmutable::setTestNow($now);
        [$owner, $eventId, $credentialSecret, $deviceSecret, $manifestVersion] = $this->fixture($now);

        $hash = EventCheckinSecurity::credentialVerifier($credentialSecret)['hash'];

        try {
            $this->sync->stage(
                $eventId,
                $deviceSecret,
                (int) $owner->id,
                'scan-proof-batch-3',
                $manifestVersion,
                [[
                    'client_nonce' => 'scan-proof-nonce-3',
                    'operation' => 'check_in',
                    'observed_at' => $now->toIso8601String(),
                    'expected_attendance_version' => 0,
                    'credential_fingerprint' => substr($hash, 0, 16),
                    'credential_hash_reference' => $hash,
                ]],
            );
            self::fail('Expected the hash-only item to be refused when proof is required.');
        } catch (EventOfflineCheckinException $exception) {
            self::assertSame('event_offline_scan_proof_required', $exception->getMessage());
        }
    }
}
