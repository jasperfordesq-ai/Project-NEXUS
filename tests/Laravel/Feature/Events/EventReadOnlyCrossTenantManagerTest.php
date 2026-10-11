<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventSessionType;
use App\Enums\EventSessionVisibility;
use App\Exceptions\EventLifecycleHistoryException;
use App\Exceptions\EventSessionException;
use App\Services\EventCalendarService;
use App\Services\EventLifecycleHistoryQueryService;
use App\Services\EventSessionService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\MakesCrossTenantEventActors;
use Tests\Laravel\TestCase;

/**
 * Read-only event surfaces for a manager whose own account lives on another
 * community: the Lifecycle history tab and the per-event calendar actions.
 *
 * Both resolved the ACTOR with `users.tenant_id = current tenant`, so a network
 * admin overseeing the community, a platform admin from elsewhere, or the
 * event's own cross-community organiser was refused. Same bug family as
 * 766b867d2 / 6adcd4ff6; authority stays with EventPolicy (admin authority
 * confined by TenantAdminScope, f9b568a05). Neither surface writes anything.
 *
 * The calendar actions also serve ordinary members, so a viewer from another
 * community is admitted there only with management authority over the event.
 *
 * Most other organiser tabs (agenda, safety, tickets, broadcasts, templates,
 * offline check-in, analytics) are NOT widened: their tables carry composite
 * foreign keys `(actor column, tenant_id) -> users (id, tenant_id)`, so the
 * schema itself requires every recorded actor to be a member of the event's
 * community. Widening their actor lookup would turn a clean refusal into a
 * database error. The agenda case is pinned below so a later pass sees why.
 */
final class EventReadOnlyCrossTenantManagerTest extends TestCase
{
    use DatabaseTransactions;
    use MakesCrossTenantEventActors;

    // ---- Lifecycle history --------------------------------------------------

    public function test_overseeing_network_admin_and_cross_tenant_organiser_can_read_lifecycle_history(): void
    {
        $this->makeNetworkOverseeEventTenant();
        $admin = $this->overseeingNetworkAdmin();
        $organiser = $this->crossTenantActorUser($this->networkHomeTenantId);
        $adminEvent = $this->crossTenantFixtureEvent((int) $this->eventTenantUser()->id);
        $ownEvent = $this->crossTenantFixtureEvent((int) $organiser->id);
        $history = app(EventLifecycleHistoryQueryService::class);

        self::assertSame($adminEvent, (int) $history->index($adminEvent, $admin)['event']->getKey());
        self::assertSame($ownEvent, (int) $history->index($ownEvent, $organiser)['event']->getKey());
    }

    public function test_cross_tenant_platform_admin_can_read_lifecycle_history_over_http(): void
    {
        $admin = $this->crossTenantPlatformAdmin();
        $eventId = $this->crossTenantFixtureEvent((int) $this->eventTenantUser()->id);

        Sanctum::actingAs($admin, ['*']);
        $this->apiGet("/v2/events/{$eventId}/lifecycle-history")->assertOk();
    }

    public function test_lifecycle_history_stays_refused_to_outsiders(): void
    {
        $this->makeNetworkOverseeEventTenant();
        $eventId = $this->crossTenantFixtureEvent((int) $this->eventTenantUser()->id);

        foreach ([$this->crossTenantMember(), $this->unrelatedCommunityAdmin()] as $outsider) {
            try {
                app(EventLifecycleHistoryQueryService::class)->index($eventId, $outsider);
                self::fail('A member or unrelated admin of another community read an event lifecycle history.');
            } catch (EventLifecycleHistoryException $exception) {
                self::assertSame('event_lifecycle_history_authorization_denied', $exception->reasonCode);
            }
            Sanctum::actingAs($outsider, ['*']);
            $this->apiGet("/v2/events/{$eventId}/lifecycle-history")->assertForbidden();
        }
    }

    // ---- Calendar actions ---------------------------------------------------

    public function test_cross_tenant_manager_gets_calendar_actions_for_an_event_they_manage(): void
    {
        $this->makeNetworkOverseeEventTenant();
        $admin = $this->overseeingNetworkAdmin();
        $draftId = $this->crossTenantFixtureEvent((int) $this->eventTenantUser()->id, [
            'publication_status' => 'draft',
            'status' => 'draft',
        ]);

        self::assertNotNull(app(EventCalendarService::class)->projectionForEvent($admin, $draftId));

        Sanctum::actingAs($this->crossTenantPlatformAdmin(), ['*']);
        $this->apiGet("/v2/events/{$draftId}/calendar-actions")->assertOk();
    }

    public function test_calendar_actions_stay_refused_to_outsiders_even_for_a_published_event(): void
    {
        $this->makeNetworkOverseeEventTenant();
        $eventId = $this->crossTenantFixtureEvent((int) $this->eventTenantUser()->id);

        foreach ([$this->crossTenantMember(), $this->unrelatedCommunityAdmin()] as $outsider) {
            self::assertNull(app(EventCalendarService::class)->projectionForEvent($outsider, $eventId));
            Sanctum::actingAs($outsider, ['*']);
            $this->apiGet("/v2/events/{$eventId}/calendar-actions")->assertForbidden();
        }
    }

    public function test_local_member_still_gets_calendar_actions_for_a_published_event(): void
    {
        $eventId = $this->crossTenantFixtureEvent((int) $this->eventTenantUser()->id);

        self::assertNotNull(
            app(EventCalendarService::class)->projectionForEvent($this->eventTenantUser(), $eventId),
        );
    }

    // ---- Known limitation, pinned -------------------------------------------

    /**
     * `event_sessions.created_by` (and the session history actor) are composite
     * foreign keys to users (id, tenant_id): the schema requires the author of
     * an agenda change to be a member of the event's community. Until that data
     * model decision changes, a cross-community manager is refused cleanly at
     * the actor lookup rather than failing on the insert. When it changes,
     * invert this test rather than deleting it.
     */
    public function test_agenda_changes_still_require_a_manager_from_the_events_community(): void
    {
        $this->makeNetworkOverseeEventTenant();
        $admin = $this->overseeingNetworkAdmin();
        $start = CarbonImmutable::now('UTC')->addMonth()->startOfHour();
        $eventId = $this->crossTenantFixtureEvent((int) $this->eventTenantUser()->id, [
            'start_time' => $start,
            'end_time' => $start->addHours(6),
            'timezone' => 'UTC',
            'timezone_source' => 'test',
            'agenda_version' => 0,
        ]);

        try {
            app(EventSessionService::class)->create($eventId, $admin, [
                'title' => 'Cross-community session',
                'description' => 'A useful session.',
                'session_type' => EventSessionType::Session->value,
                'visibility' => EventSessionVisibility::Public->value,
                'start_at' => $start->toIso8601String(),
                'end_at' => $start->addHour()->toIso8601String(),
                'timezone' => 'UTC',
                'track_name' => null,
                'room_name' => null,
                'speakers' => [],
            ], 'x-agenda-pinned');
            self::fail('Agenda changes by a cross-community manager now succeed — the data model changed, so invert this test.');
        } catch (EventSessionException $exception) {
            self::assertSame('event_agenda_actor_invalid', $exception->reasonCode);
        }
    }
}
