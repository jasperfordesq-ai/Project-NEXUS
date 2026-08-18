<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Enums\EventAttendanceAction;
use App\Exceptions\EventAttendanceException;
use App\Models\User;
use App\Services\EventAttendanceService;
use App\Services\EventService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Regression cover for the ACTOR lookups in the Event attendance path.
 *
 * Four lookups resolved the ACTING user with `WHERE id = ? AND tenant_id = ?`
 * against the event's tenant: EventService::attendanceActor(),
 * EventsController::attendanceActor(), and the persisted-actor re-reads inside
 * EventAttendanceService::record() and ::transition(). Together they refused
 * event check-in / attendance marking (event_attendance_authorization_denied)
 * to any actor whose account row lives on a different tenant than the one
 * being acted in — platform admins and network admins acting on a sub-tenant,
 * and cross-tenant organisers of the event itself. Commit 5373940c8 fixed the
 * same bug class across the publish path but left attendance out of scope.
 *
 * The rule this pins: auth is GLOBAL, resources are tenant-scoped. Never add
 * `AND tenant_id = ?` to a lookup of the acting user's own row.
 *
 * These assert the services directly rather than POSTing the check-in
 * endpoint, because Sanctum::actingAs() takes the guard branch of the
 * Authenticate middleware, whose own cross-tenant check would 403 first and
 * mask the behaviour under test (same reasoning as
 * EventPublicationWorkflowCrossTenantActorTest).
 */
final class EventAttendanceCrossTenantActorTest extends TestCase
{
    use DatabaseTransactions;

    /** Tenant the Event lives on. The actor's home tenant is 999. */
    private const ACTING_TENANT = 2;
    private const HOME_TENANT = 999;

    private EventAttendanceService $service;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::ACTING_TENANT);
        Config::set('events.attendance_credit_mode', 'off');
        $this->service = app(EventAttendanceService::class);
    }

    private function crossTenantUser(array $overrides = []): User
    {
        return User::factory()->forTenant(self::HOME_TENANT)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function localUser(array $overrides = []): User
    {
        return User::factory()->forTenant(self::ACTING_TENANT)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function event(int $organizerId, int $tenantId = self::ACTING_TENANT): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $organizerId,
            'title' => 'Cross-tenant attendance fixture',
            'description' => 'Cross-tenant attendance fixture.',
            'start_time' => now()->subMinutes(5),
            'end_time' => now()->addHours(2),
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'is_recurring_template' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function rsvp(int $eventId, User $attendee, int $tenantId = self::ACTING_TENANT): void
    {
        DB::table('event_rsvps')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'user_id' => (int) $attendee->id,
            'status' => 'going',
            'created_at' => now(),
        ]);
    }

    private function attendanceStatus(int $eventId, User $attendee): ?string
    {
        $value = DB::table('event_attendance')
            ->where('event_id', $eventId)
            ->where('user_id', $attendee->id)
            ->value('attendance_status');

        return $value === null ? null : (string) $value;
    }

    /**
     * Covers EventService::attendanceActor() AND the persisted-actor re-read
     * inside EventAttendanceService::record() — markAttended() runs through
     * both lookups.
     */
    public function test_cross_tenant_organizer_can_mark_attendance_on_their_own_event(): void
    {
        $organizer = $this->crossTenantUser();
        $attendee = $this->localUser();
        $eventId = $this->event((int) $organizer->id);
        $this->rsvp($eventId, $attendee);

        $ok = EventService::markAttended($eventId, (int) $attendee->id, (int) $organizer->id);

        self::assertTrue(
            $ok,
            'The organiser must be able to check in an attendee even when their own account row lives on another tenant. Errors: '
                . json_encode(EventService::getErrors()),
        );
        self::assertSame('checked_in', $this->attendanceStatus($eventId, $attendee));
    }

    /**
     * The exact production shape: role='admin', is_tenant_super_admin=1,
     * home tenant != the tenant being acted on.
     */
    public function test_cross_tenant_network_admin_can_record_attendance(): void
    {
        $admin = $this->crossTenantUser([
            'role' => 'admin',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 1,
        ]);
        $organizer = $this->localUser();
        $attendee = $this->localUser();
        $eventId = $this->event((int) $organizer->id);
        $this->rsvp($eventId, $attendee);

        $result = $this->service->record($eventId, (int) $attendee->id, $admin);

        self::assertSame('checked_in', $result->outcome);
    }

    /**
     * transition() carries its own persisted-actor re-read with the same
     * tenant predicate; a cross-tenant organiser undoing a check-in hit it.
     */
    public function test_cross_tenant_organizer_can_transition_attendance(): void
    {
        $organizer = $this->crossTenantUser();
        $attendee = $this->localUser();
        $eventId = $this->event((int) $organizer->id);
        $this->rsvp($eventId, $attendee);
        $this->service->record($eventId, (int) $attendee->id, $organizer);

        $result = $this->service->transition(
            $eventId,
            (int) $attendee->id,
            EventAttendanceAction::Undo,
            $organizer,
            1,
            'Checked in the wrong member.',
            'cross-tenant-undo-1',
        );

        self::assertSame(EventAttendanceAction::Undo, $result->action);
    }

    /** The fix must not widen authority: a cross-tenant stranger is refused. */
    public function test_cross_tenant_stranger_cannot_record_attendance(): void
    {
        $organizer = $this->localUser();
        $attendee = $this->localUser();
        $eventId = $this->event((int) $organizer->id);
        $this->rsvp($eventId, $attendee);
        $stranger = $this->crossTenantUser(['role' => 'member']);

        try {
            $this->service->record($eventId, (int) $attendee->id, $stranger);
            self::fail('A cross-tenant stranger must not be able to record attendance.');
        } catch (EventAttendanceException $exception) {
            self::assertSame('event_attendance_authorization_denied', $exception->reasonCode);
        }
        self::assertNull($this->attendanceStatus($eventId, $attendee));
    }

    public function test_suspended_cross_tenant_organizer_is_refused(): void
    {
        $organizer = $this->crossTenantUser(['status' => 'suspended']);
        $attendee = $this->localUser();
        $eventId = $this->event((int) $organizer->id);
        $this->rsvp($eventId, $attendee);

        $ok = EventService::markAttended($eventId, (int) $attendee->id, (int) $organizer->id);

        self::assertFalse($ok, 'A suspended actor must stay refused regardless of tenant.');
        self::assertNull($this->attendanceStatus($eventId, $attendee));
    }

    /** Resource scoping is untouched: an event on another tenant stays invisible. */
    public function test_event_on_another_tenant_is_not_reachable(): void
    {
        $organizer = $this->crossTenantUser();
        $attendee = $this->crossTenantUser();
        $foreignEventId = $this->event((int) $organizer->id, self::HOME_TENANT);
        $this->rsvp($foreignEventId, $attendee, self::HOME_TENANT);

        try {
            $this->service->record($foreignEventId, (int) $attendee->id, $organizer);
            self::fail('Recording attendance on an event that belongs to another tenant must be refused.');
        } catch (EventAttendanceException $exception) {
            self::assertSame('event_attendance_event_not_found', $exception->reasonCode);
        }
    }
}
