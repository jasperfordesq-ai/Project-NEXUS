<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\EventNotificationService;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

class EventContactPolicyTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
    }

    public function test_positive_rsvp_denial_writes_no_relationship_or_notification(): void
    {
        $organizer = $this->member();
        $attendee = $this->member();
        $eventId = $this->event($organizer->id);
        Sanctum::actingAs($attendee, ['*']);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($attendee->id, $organizer->id, $this->testTenantId, 'event_registration')
            ->andThrow($this->denial());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost("/v2/events/{$eventId}/rsvp", ['status' => 'going']);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertDatabaseMissing('event_rsvps', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
        ]);
        $this->assertDatabaseMissing('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizer->id,
            'type' => 'event_rsvp',
        ]);
    }

    public function test_negative_rsvp_safe_exit_remains_available_without_contact_check(): void
    {
        $organizer = $this->member();
        $attendee = $this->member();
        $eventId = $this->event($organizer->id);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Sanctum::actingAs($attendee, ['*']);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldNotReceive('assertLocalContactAllowed');
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost("/v2/events/{$eventId}/rsvp", ['status' => 'not_going']);

        $response->assertOk();
        $this->assertDatabaseHas('event_rsvps', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'status' => 'not_going',
        ]);
    }

    public function test_waitlist_denial_writes_no_waitlist_row(): void
    {
        $organizer = $this->member();
        $attendee = $this->member();
        $eventId = $this->event($organizer->id);
        Sanctum::actingAs($attendee, ['*']);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($attendee->id, $organizer->id, $this->testTenantId, 'event_waitlist')
            ->andThrow($this->denial());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost("/v2/events/{$eventId}/waitlist", []);

        $response->assertStatus(403);
        $this->assertDatabaseMissing('event_waitlist', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
        ]);
    }

    public function test_event_broadcast_denial_occurs_before_any_recipient_notification(): void
    {
        $organizer = $this->member();
        $attendee = $this->member();
        $eventId = $this->event($organizer->id);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertCommunitySpaceBroadcastAllowed')
            ->once()
            ->with($organizer->id, [$attendee->id], [], $this->testTenantId, 'event_broadcast')
            ->andThrow($this->denial());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        try {
            app(EventNotificationService::class)->notifyAttendees(
                $this->testTenantId,
                $eventId,
                'This broadcast must not be delivered',
            );
            $this->fail('Expected safeguarding denial');
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame('VETTING_REQUIRED', $e->reasonCode);
        }

        $this->assertDatabaseMissing('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $attendee->id,
            'type' => 'event_update',
        ]);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function event(int $organizerId): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => 'Safeguarded event',
            'description' => 'Safeguarding event relationship regression',
            'location' => 'Community venue',
            'start_time' => now()->addWeek(),
            'end_time' => now()->addWeek()->addHour(),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function denial(): SafeguardingPolicyException
    {
        return new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required');
    }
}
