<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EventCheckinCredentialService;
use App\Services\EventCheckinDeviceService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-102: offline check-in refusals all answered "Invalid input" — including a
 * member asking for a check-in code for someone else's registration (a
 * permission refusal) and the sync refusals a person causes and can act on.
 */
final class EventOfflineCheckinErrorMessagesTest extends TestCase
{
    use DatabaseTransactions;

    private const HEADERS = [
        'X-Events-Contract' => '2',
        'X-Event-Checkin-Contract' => '1',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        App::setLocale('en');
        TenantContext::setById($this->testTenantId);
        Config::set('events.attendance_credit_mode', 'off');
    }

    public function test_a_code_for_someone_elses_registration_is_refused_as_forbidden_not_invalid_input(): void
    {
        $fixture = $this->fixture('Forbidden');
        $stranger = $this->user('Forbidden Stranger');
        Sanctum::actingAs($stranger, ['*']);

        $response = $this->postJson(
            $this->url($fixture['event_id'], '/credentials'),
            ['registration_id' => $fixture['registration_id']],
            $this->headers() + ['Idempotency-Key' => 'forbidden-credential-request'],
        );

        $response->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'EVENT_CHECKIN_FORBIDDEN')
            ->assertJsonPath('errors.0.message', __('api.forbidden'))
            ->assertJsonMissingPath('errors.0.reason');
        self::assertNotSame(__('api.invalid_input'), $response->json('errors.0.message'));
    }

    public function test_an_unknown_batch_is_refused_as_not_found_not_invalid_input(): void
    {
        $fixture = $this->fixture('NotFound');
        Sanctum::actingAs($fixture['owner'], ['*']);

        $this->getJson($this->url($fixture['event_id'], '/batches/lookup?' . http_build_query([
            'device_id' => $fixture['device_id'],
            'client_batch_id' => 'never-sent',
        ])), $this->headers())
            ->assertStatus(404)
            ->assertJsonPath('errors.0.code', 'EVENT_CHECKIN_NOT_FOUND')
            ->assertJsonPath('errors.0.message', __('api.resource_not_found'));
    }

    public function test_sync_with_a_repeated_check_in_says_it_was_already_sent(): void
    {
        $fixture = $this->fixture('Duplicate');
        Sanctum::actingAs($fixture['owner'], ['*']);
        $item = $this->item('duplicate-nonce', $fixture['credential_secret']);

        $this->assertExplained(
            $this->sync($fixture, 'duplicate-batch', [$item, $item]),
            'event_offline_nonce_duplicate',
            'event_offline_checkin.errors.duplicate',
        );
    }

    public function test_sync_with_a_check_in_recorded_outside_the_replay_window_says_so(): void
    {
        $fixture = $this->fixture('Window');
        Sanctum::actingAs($fixture['owner'], ['*']);
        $item = $this->item('window-nonce', $fixture['credential_secret']);
        $item['observed_at'] = CarbonImmutable::now('UTC')->subDays(5)->toIso8601String();

        $this->assertExplained(
            $this->sync($fixture, 'window-batch', [$item]),
            'event_offline_observed_at_outside_window',
            'event_offline_checkin.errors.observed_at_outside_window',
        );
    }

    public function test_sync_against_a_roster_the_server_does_not_have_says_the_roster_is_out_of_date(): void
    {
        $fixture = $this->fixture('Manifest');
        Sanctum::actingAs($fixture['owner'], ['*']);
        $fixture['manifest_version'] += 50;

        $this->assertExplained(
            $this->sync($fixture, 'manifest-batch', [$this->item('manifest-nonce', $fixture['credential_secret'])]),
            'event_offline_manifest_version_ahead',
            'event_offline_checkin.errors.manifest_out_of_date',
        );
    }

    public function test_sync_from_a_revoked_device_says_the_device_must_be_registered_again(): void
    {
        $fixture = $this->fixture('Device');
        app(EventCheckinDeviceService::class)->revoke(
            $fixture['event_id'],
            $fixture['device_id'],
            (int) $fixture['owner']->id,
            1,
            'Device reported lost',
        );
        Sanctum::actingAs($fixture['owner'], ['*']);

        $this->assertExplained(
            $this->sync($fixture, 'device-batch', [$this->item('device-nonce', $fixture['credential_secret'])]),
            'event_checkin_device_not_active',
            'event_offline_checkin.errors.device_not_active',
        );
    }

    public function test_scanning_a_revoked_code_says_it_was_revoked_or_replaced(): void
    {
        $fixture = $this->fixture('Revoked');
        app(EventCheckinCredentialService::class)->revoke(
            $fixture['event_id'],
            $fixture['credential_id'],
            (int) $fixture['owner']->id,
            1,
            'Lost printed copy',
        );
        Sanctum::actingAs($fixture['owner'], ['*']);

        $this->assertExplained(
            $this->postJson($this->url($fixture['event_id'], '/scan'), [
                'device_secret' => $fixture['device_secret'],
                'credential' => $fixture['credential_secret'],
                'action' => 'check_in',
                'expected_attendance_version' => 0,
            ], $this->headers() + ['Idempotency-Key' => 'revoked-scan']),
            'event_qr_credential_not_active',
            'event_offline_checkin.errors.credential_not_active',
        );
    }

    private function assertExplained(TestResponse $response, string $reason, string $messageKey): void
    {
        self::assertContains($response->status(), [409, 422], (string) $response->getContent());
        $response->assertJsonPath('errors.0.reason', $reason)
            ->assertJsonPath('errors.0.message', __($messageKey));
        self::assertNotSame($messageKey, __($messageKey), "Translation {$messageKey} is missing.");
        self::assertNotSame(__('api.invalid_input'), $response->json('errors.0.message'));
    }

    /**
     * @param array<string,mixed> $fixture
     * @param list<array<string,mixed>> $items
     */
    private function sync(array $fixture, string $batchId, array $items): TestResponse
    {
        return $this->postJson($this->url((int) $fixture['event_id'], '/sync'), [
            'device_secret' => $fixture['device_secret'],
            'client_batch_id' => $batchId,
            'manifest_version' => $fixture['manifest_version'],
            'items' => $items,
        ], $this->headers());
    }

    private function url(int $eventId, string $suffix): string
    {
        return '/api/v2/events/' . $eventId . '/offline-checkin' . $suffix;
    }

    /** @return array<string,string> */
    private function headers(): array
    {
        return self::HEADERS + ['X-Tenant-ID' => (string) $this->testTenantId];
    }

    /**
     * @return array{
     *   owner:User,event_id:int,registration_id:int,credential_id:int,credential_secret:string,
     *   device_id:int,device_secret:string,manifest_version:int
     * }
     */
    private function fixture(string $prefix): array
    {
        $owner = $this->user("{$prefix} Owner");
        $attendee = $this->user("{$prefix} Attendee");
        $eventId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $owner->id,
            'title' => "{$prefix} offline check-in error fixture",
            'description' => 'Offline check-in error fixture.',
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
        $credential = app(EventCheckinCredentialService::class)->issue(
            $eventId,
            $registrationId,
            (int) $owner->id,
            "errors-{$prefix}-credential",
            CarbonImmutable::now('UTC')->addHours(4),
        );
        $device = app(EventCheckinDeviceService::class)->register(
            $eventId,
            (int) $owner->id,
            "{$prefix} front desk",
            "errors-{$prefix}-device",
            CarbonImmutable::now('UTC')->addHours(4),
        );
        self::assertNotNull($credential->secret);
        self::assertNotNull($device->secret);

        return [
            'owner' => $owner,
            'event_id' => $eventId,
            'registration_id' => $registrationId,
            'credential_id' => (int) $credential->credential->id,
            'credential_secret' => $credential->secret,
            'device_id' => (int) $device->device->id,
            'device_secret' => $device->secret,
            'manifest_version' => $device->manifestVersion,
        ];
    }

    private function user(string $name): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => $name,
            'last_name' => '',
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => 'en',
        ]);
    }

    /** @return array<string,mixed> */
    private function item(string $nonce, string $credential): array
    {
        $hash = hash('sha256', $credential);

        return [
            'client_nonce' => $nonce,
            'operation' => 'check_in',
            'observed_at' => CarbonImmutable::now('UTC')->toIso8601String(),
            'expected_attendance_version' => 0,
            'credential_fingerprint' => substr($hash, 0, 16),
            'credential_hash_reference' => $hash,
        ];
    }
}
