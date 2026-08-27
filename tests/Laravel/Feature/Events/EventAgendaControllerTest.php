<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventStaffRole;
use App\Models\User;
use App\Services\EventRoleService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class EventAgendaControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_routes_require_authentication(): void
    {
        $this->apiGet('/v2/events/1/agenda')->assertUnauthorized();
        $this->apiPost('/v2/events/1/agenda/sessions', [])->assertUnauthorized();
        $this->apiPut('/v2/events/1/agenda/sessions/1', [])->assertUnauthorized();
        $this->apiPut('/v2/events/1/agenda/order', [])->assertUnauthorized();
        $this->apiPost('/v2/events/1/agenda/sessions/1/cancel', [])->assertUnauthorized();
    }

    public function test_owner_can_create_update_reorder_and_cancel_with_stable_contract(): void
    {
        $owner = $this->user();
        // Name PARTS: UserObserver::saving() recomputes the stored `name` column.
        $speaker = $this->user(['first_name' => 'Linked', 'last_name' => 'Speaker']);
        [$eventId, $start] = $this->event((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);

        $firstPayload = $this->payload($start, [
            'title' => '<b>Opening workshop</b>',
            'session_type' => 'workshop',
            'visibility' => 'registered',
            'room_name' => 'Main Hall',
            'speakers' => [
                ['user_id' => (int) $speaker->id, 'role_label' => 'Facilitator'],
                ['display_name' => 'External Expert', 'role_label' => 'Guest'],
            ],
        ]);
        $created = $this->apiPost(
            "/v2/events/{$eventId}/agenda/sessions",
            $firstPayload,
            ['Idempotency-Key' => 'agenda-api-create-1'],
        );
        $created->assertCreated()
            ->assertJsonPath('data.changed', true)
            ->assertJsonPath('data.idempotent_replay', false)
            ->assertJsonPath('data.agenda_version', 1)
            ->assertJsonPath('data.session.title', 'Opening workshop')
            ->assertJsonPath('data.session.type', 'workshop')
            ->assertJsonPath('data.session.visibility', 'registered')
            ->assertJsonPath('data.session.speakers.0.display_name', 'Linked Speaker')
            ->assertJsonPath('data.session.speakers.1.display_name', 'External Expert');
        $firstId = (int) $created->json('data.session.id');
        $firstHistoryId = (int) $created->json('data.history_entry_id');

        $this->apiPost(
            "/v2/events/{$eventId}/agenda/sessions",
            $firstPayload,
            ['Idempotency-Key' => 'agenda-api-create-1'],
        )->assertOk()
            ->assertJsonPath('data.changed', false)
            ->assertJsonPath('data.idempotent_replay', true)
            ->assertJsonPath('data.history_entry_id', $firstHistoryId);

        $second = $this->apiPost(
            "/v2/events/{$eventId}/agenda/sessions",
            $this->payload($start->addHours(2), ['title' => 'Closing panel']),
            ['Idempotency-Key' => 'agenda-api-create-2'],
        )->assertCreated();
        $secondId = (int) $second->json('data.session.id');

        $agendaResponse = $this->apiGet("/v2/events/{$eventId}/agenda?include_cancelled=true");
        $agendaResponse->assertOk()
            ->assertJsonPath('data.contract_version', 1)
            ->assertJsonPath('data.event_id', $eventId)
            ->assertJsonPath('data.agenda_version', 2)
            ->assertJsonPath('data.permissions.manage', true)
            ->assertJsonCount(2, 'data.sessions')
            ->assertJsonMissingPath('data.sessions.0.tenant_id')
            ->assertJsonMissingPath('data.sessions.0.room_key');
        self::assertStringContainsString(
            'no-store',
            (string) $agendaResponse->headers->get('Cache-Control'),
        );
        self::assertStringContainsString(
            'Authorization',
            (string) $agendaResponse->headers->get('Vary'),
        );

        $updated = $this->apiPut(
            "/v2/events/{$eventId}/agenda/sessions/{$firstId}",
            [
                ...$firstPayload,
                'title' => 'Opening workshop updated',
                'expected_version' => 1,
            ],
            ['Idempotency-Key' => 'agenda-api-update-1'],
        );
        $updated->assertOk()
            ->assertJsonPath('data.changed', true)
            ->assertJsonPath('data.session.version', 2)
            ->assertJsonPath('data.agenda_version', 3);

        $reordered = $this->apiPut(
            "/v2/events/{$eventId}/agenda/order",
            [
                'ordered_session_ids' => [$secondId, $firstId],
                'expected_agenda_version' => 3,
            ],
            ['Idempotency-Key' => 'agenda-api-reorder-1'],
        );
        $reordered->assertOk()
            ->assertJsonPath('data.changed', true)
            ->assertJsonPath('data.agenda_version', 4)
            ->assertJsonPath('data.sessions.0.id', $secondId)
            ->assertJsonPath('data.sessions.1.id', $firstId);
        $secondVersion = (int) $reordered->json('data.sessions.0.version');

        $this->apiPost(
            "/v2/events/{$eventId}/agenda/sessions/{$secondId}/cancel",
            [
                'expected_version' => $secondVersion,
                'reason' => 'Speaker unavailable',
            ],
            ['Idempotency-Key' => 'agenda-api-cancel-1'],
        )->assertOk()
            ->assertJsonPath('data.changed', true)
            ->assertJsonPath('data.session.status', 'cancelled')
            ->assertJsonPath('data.session.cancellation_reason', 'Speaker unavailable')
            ->assertJsonPath('data.agenda_version', 5);

        self::assertSame(2, DB::table('event_sessions')->where('event_id', $eventId)->count());
        self::assertSame(5, DB::table('event_session_history')->where('event_id', $eventId)->count());
    }

    public function test_viewer_receives_only_their_authorized_session_visibilities(): void
    {
        $owner = $this->user();
        $member = $this->user();
        $registered = $this->user();
        $staff = $this->user();
        [$eventId, $start] = $this->event((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);
        foreach ([
            ['Public session', 'public'],
            ['Attendee session', 'registered'],
            ['Staff briefing', 'staff'],
        ] as $index => [$title, $visibility]) {
            $this->apiPost(
                "/v2/events/{$eventId}/agenda/sessions",
                $this->payload($start->addHours($index), [
                    'title' => $title,
                    'visibility' => $visibility,
                ]),
                ['Idempotency-Key' => "agenda-visibility-{$index}"],
            )->assertCreated();
        }
        DB::table('event_registrations')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => (int) $registered->id,
            'capacity_pool_key' => 'event',
            'allocation_key' => null,
            'registration_state' => 'confirmed',
            'registration_version' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => (int) $owner->id,
            'confirmed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        TenantContext::setById($this->testTenantId);
        (new EventRoleService())->grant(
            $eventId,
            (int) $staff->id,
            EventStaffRole::CommunicationsManager,
            $owner,
            null,
            'agenda-staff-grant',
        );

        Sanctum::actingAs($member, ['*']);
        $this->apiGet("/v2/events/{$eventId}/agenda")
            ->assertOk()
            ->assertJsonCount(1, 'data.sessions')
            ->assertJsonPath('data.sessions.0.title', 'Public session')
            ->assertJsonPath('data.permissions.manage', false);

        Sanctum::actingAs($registered, ['*']);
        $this->apiGet("/v2/events/{$eventId}/agenda")
            ->assertOk()
            ->assertJsonCount(2, 'data.sessions');

        Sanctum::actingAs($staff, ['*']);
        $this->apiGet("/v2/events/{$eventId}/agenda")
            ->assertOk()
            ->assertJsonCount(3, 'data.sessions')
            ->assertJsonPath('data.permissions.manage', false);
    }

    public function test_mutation_validation_authorization_tenant_and_conflicts_fail_closed(): void
    {
        $owner = $this->user();
        $member = $this->user();
        $foreignOwner = $this->user([], 999);
        [$eventId, $start] = $this->event((int) $owner->id);
        [$foreignEventId] = $this->event((int) $foreignOwner->id, 999);
        Sanctum::actingAs($member, ['*']);

        $this->apiPost(
            "/v2/events/{$eventId}/agenda/sessions",
            $this->payload($start),
            ['Idempotency-Key' => 'agenda-denied'],
        )->assertForbidden()
            ->assertJsonPath('errors.0.code', 'EVENT_AGENDA_FORBIDDEN');

        Sanctum::actingAs($owner, ['*']);
        $this->apiGet("/v2/events/{$foreignEventId}/agenda")
            ->assertNotFound()
            ->assertJsonPath('errors.0.code', 'EVENT_AGENDA_NOT_FOUND');
        $this->apiPost("/v2/events/{$eventId}/agenda/sessions", $this->payload($start))
            ->assertUnprocessable()
            ->assertJsonPath('errors.0.field', 'idempotency_key');
        $this->apiPost(
            "/v2/events/{$eventId}/agenda/sessions",
            [...$this->payload($start), 'private_notes' => 'must fail'],
            ['Idempotency-Key' => 'agenda-unknown'],
        )->assertUnprocessable()
            ->assertJsonPath('errors.0.code', 'EVENT_AGENDA_VALIDATION_FAILED');

        $created = $this->apiPost(
            "/v2/events/{$eventId}/agenda/sessions",
            $this->payload($start),
            ['Idempotency-Key' => 'agenda-conflict-base'],
        )->assertCreated();
        $sessionId = (int) $created->json('data.session.id');
        $this->apiPut(
            "/v2/events/{$eventId}/agenda/sessions/{$sessionId}",
            [
                ...$this->payload($start),
                'title' => 'Stale update',
                'expected_version' => 99,
            ],
            ['Idempotency-Key' => 'agenda-stale-update'],
        )->assertConflict()
            ->assertJsonPath('errors.0.code', 'EVENT_AGENDA_CONFLICT');
    }

    private function user(array $overrides = [], int $tenantId = 2): User
    {
        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    /** @return array{int,CarbonImmutable} */
    private function event(int $ownerId, int $tenantId = 2): array
    {
        $start = CarbonImmutable::now('UTC')->addMonth()->startOfHour();
        $eventId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $ownerId,
            'title' => 'Agenda API fixture',
            'description' => 'Agenda API fixture.',
            'start_time' => $start,
            'end_time' => $start->addHours(8),
            'timezone' => 'UTC',
            'timezone_source' => 'test',
            'all_day' => false,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'is_recurring_template' => false,
            'agenda_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$eventId, $start];
    }

    /** @return array<string,mixed> */
    private function payload(CarbonImmutable $start, array $overrides = []): array
    {
        return array_merge([
            'title' => 'Agenda session',
            'description' => 'A useful session.',
            'session_type' => 'session',
            'visibility' => 'public',
            'start_at' => $start->toIso8601String(),
            'end_at' => $start->addHour()->toIso8601String(),
            'timezone' => 'UTC',
            'track_name' => null,
            'room_name' => null,
            'speakers' => [],
        ], $overrides);
    }
}
