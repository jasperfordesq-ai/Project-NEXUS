<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EventBroadcastService;
use App\Services\SafeguardingInteractionPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * E-102: organiser refusals in event communications and registration data
 * retention answered a bare "Validation failed" although the cause was known
 * and the organiser could fix it.
 */
final class EventBroadcastAndRetentionErrorMessagesTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        App::setLocale('en');
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['events' => true], JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertManyLocalContactsAllowed')->zeroOrMoreTimes();
        App::instance(SafeguardingInteractionPolicy::class, $policy);
    }

    public function test_retention_preview_before_the_event_has_ended_says_so(): void
    {
        $owner = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $this->registrationSettings($eventId, $owner, $start);
        Sanctum::actingAs($owner, ['*']);

        $this->assertExplained(
            $this->apiPost("/v2/events/{$eventId}/registration-product/retention/dry-run", [
                'as_of' => CarbonImmutable::now('UTC')->toIso8601String(),
                'idempotency_key' => 'retention-before-end',
            ]),
            'EVENT_REGISTRATION_VALIDATION_FAILED',
            'event_registration_retention_post_event_only',
            'event_errors.retention.post_event_only',
            'as_of',
        );
    }

    public function test_retention_preview_without_registration_settings_says_what_to_set_up(): void
    {
        $owner = $this->eventUser();
        [$eventId, , $end] = $this->registrationEvent((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);

        $this->assertExplained(
            $this->apiPost("/v2/events/{$eventId}/registration-product/retention/dry-run", [
                'as_of' => $end->addDay()->toIso8601String(),
                'idempotency_key' => 'retention-without-settings',
            ]),
            'EVENT_REGISTRATION_VALIDATION_FAILED',
            'event_registration_retention_settings_required',
            'event_errors.retention.settings_required',
            'registration_settings',
        );
    }

    public function test_scheduling_a_message_in_the_past_says_so(): void
    {
        [$organizer, $broadcastId] = $this->draft('announcement', ['registration_confirmed'], true);
        Sanctum::actingAs($organizer, ['*']);

        $this->assertExplained(
            $this->apiPost("/v2/event-broadcasts/{$broadcastId}/schedule", [
                'expected_version' => 1,
                'scheduled_at' => CarbonImmutable::now('UTC')->subHour()->toIso8601String(),
            ], ['Idempotency-Key' => 'past-schedule']),
            'EVENT_BROADCAST_SCHEDULE_IN_PAST',
            'event_broadcast_schedule_in_past',
            'event_errors.broadcast.schedule_in_past',
            'scheduled_at',
        );
    }

    public function test_a_follow_up_scheduled_before_the_event_ends_says_so(): void
    {
        [$organizer, $broadcastId] = $this->draft('follow_up', ['attendance_attended'], true);
        Sanctum::actingAs($organizer, ['*']);

        $this->assertExplained(
            $this->apiPost("/v2/event-broadcasts/{$broadcastId}/schedule", [
                'expected_version' => 1,
                'scheduled_at' => CarbonImmutable::now('UTC')->addHour()->toIso8601String(),
            ], ['Idempotency-Key' => 'early-follow-up']),
            'EVENT_BROADCAST_VALIDATION_FAILED',
            'event_broadcast_post_event_too_early',
            'event_errors.broadcast.post_event_too_early',
            'scheduled_at',
        );
    }

    public function test_sending_to_an_audience_with_nobody_in_it_says_so(): void
    {
        [$organizer, $broadcastId] = $this->draft('announcement', ['waitlist_active'], true);
        Sanctum::actingAs($organizer, ['*']);

        $this->assertExplained(
            $this->apiPost("/v2/event-broadcasts/{$broadcastId}/schedule", [
                'expected_version' => 1,
            ], ['Idempotency-Key' => 'empty-audience']),
            'EVENT_BROADCAST_VALIDATION_FAILED',
            'event_broadcast_audience_empty',
            'event_errors.broadcast.audience_empty',
            'segments',
        );
    }

    public function test_a_draft_with_no_audience_or_an_empty_body_says_what_is_missing(): void
    {
        $organizer = $this->organizer();
        $eventId = $this->broadcastEvent((int) $organizer->id);
        Sanctum::actingAs($organizer, ['*']);
        $draft = [
            'idempotency_key' => 'draft-validation',
            'variant' => 'announcement',
            'segments' => ['registration_confirmed'],
            'channels' => ['in_app'],
            'body' => 'A message',
        ];

        $this->assertExplained(
            $this->apiPost("/v2/events/{$eventId}/broadcasts", ['segments' => []] + $draft),
            'EVENT_BROADCAST_VALIDATION_FAILED',
            'event_broadcast_audience_empty',
            'event_errors.broadcast.audience_empty',
            'segments',
        );
        $this->assertExplained(
            $this->apiPost("/v2/events/{$eventId}/broadcasts", ['channels' => []] + $draft),
            'EVENT_BROADCAST_VALIDATION_FAILED',
            'event_broadcast_channel_empty',
            'event_errors.broadcast.channel_empty',
            'channels',
        );
        $this->assertExplained(
            $this->apiPost("/v2/events/{$eventId}/broadcasts", ['body' => ''] + $draft),
            'EVENT_BROADCAST_VALIDATION_FAILED',
            'event_broadcast_body_invalid',
            'event_errors.broadcast.body_invalid',
            'body',
        );
    }

    public function test_an_unexplained_broadcast_refusal_stays_generic(): void
    {
        $organizer = $this->organizer();
        $eventId = $this->broadcastEvent((int) $organizer->id);
        Sanctum::actingAs($organizer, ['*']);

        $response = $this->apiPost("/v2/events/{$eventId}/broadcasts", [
            'idempotency_key' => 'bad-variant',
            'variant' => 'not-a-variant',
            'segments' => ['registration_confirmed'],
            'channels' => ['in_app'],
            'body' => 'A message',
        ]);
        $response->assertStatus(422)
            ->assertJsonPath('errors.0.message', __('api.validation_failed'))
            ->assertJsonMissingPath('errors.0.reason');
    }

    private function assertExplained(
        TestResponse $response,
        string $code,
        string $reason,
        string $messageKey,
        ?string $field,
    ): void {
        $response->assertStatus(422)
            ->assertJsonPath('errors.0.code', $code)
            ->assertJsonPath('errors.0.reason', $reason)
            ->assertJsonPath('errors.0.message', __($messageKey, ['max' => 20000]))
            ->assertJsonPath('errors.0.field', $field);
        self::assertNotSame($messageKey, __($messageKey), "Translation {$messageKey} is missing.");
        self::assertNotSame(__('api.validation_failed'), $response->json('errors.0.message'));
    }

    /**
     * @param list<string> $segments
     * @return array{User,int}
     */
    private function draft(string $variant, array $segments, bool $withRecipient): array
    {
        $organizer = $this->organizer();
        $eventId = $this->broadcastEvent((int) $organizer->id);
        if ($withRecipient) {
            $recipient = $this->organizer();
            DB::table('event_registrations')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $recipient->id,
                'capacity_pool_key' => 'event',
                'registration_state' => 'confirmed',
                'registration_version' => 1,
                'state_changed_at' => now(),
                'state_changed_by' => $organizer->id,
                'confirmed_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        $created = app(EventBroadcastService::class)->createDraft(
            $eventId,
            $organizer,
            $variant,
            $segments,
            ['in_app'],
            'Error message fixture',
            'error-message-draft-' . $variant . '-' . implode('-', $segments),
        );

        return [$organizer, (int) $created['broadcast']->id];
    }

    private function organizer(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'preferred_language' => 'en',
            'status' => 'active',
            'is_approved' => true,
            'notification_preferences' => [],
        ]);
    }

    private function broadcastEvent(int $organizerId): int
    {
        $start = CarbonImmutable::now('UTC')->addDay()->startOfHour();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => 'Broadcast error message event',
            'description' => 'Broadcast error message fixture.',
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
            'occurrence_key' => 'broadcast-errors:' . bin2hex(random_bytes(12)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
