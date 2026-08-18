<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Exceptions\EventLifecycleTransitionException;
use App\Models\Event;
use App\Models\User;
use App\Services\EventPublicationWorkflowService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\MakesNetworkAdminHierarchy;
use Tests\Laravel\TestCase;

/**
 * Regression cover for the ACTOR lookups in the Event publication path.
 *
 * Four lookups resolved the ACTING user with `WHERE id = ? AND tenant_id = ?`
 * against the event's tenant: EventsController::publicationTransition(),
 * EventPublicationWorkflowService::authorizedActorAndEvent(), the locked
 * actor re-read in transitionSeries(), and EventLifecycleService::transition().
 * EventPolicy::hasValidContext() additionally compared the actor's home
 * tenant against the current tenant. Together they made every publish,
 * submit, approve and reject refuse (or hide the button from) any actor whose
 * account row lives on a different tenant than the one being acted in —
 * including the organiser who had just created the event there.
 *
 * The rule this pins: auth is GLOBAL, resources are tenant-scoped. Never add
 * `AND tenant_id = ?` to a lookup of the acting user's own row.
 *
 * These assert the workflow service directly rather than POSTing the publish
 * endpoint, because Sanctum::actingAs() takes the guard branch of the
 * Authenticate middleware, whose own cross-tenant check would 403 first and
 * mask the behaviour under test. The HTTP-level controller lookup has its own
 * cover in EventsPublicationTransitionCrossTenantTest using a real JWT.
 */
final class EventPublicationWorkflowCrossTenantActorTest extends TestCase
{
    use DatabaseTransactions;
    use MakesNetworkAdminHierarchy;

    /** Tenant the Events live on. The actor's home tenant is 999. */
    private const ACTING_TENANT = 2;
    private const HOME_TENANT = 999;

    private EventPublicationWorkflowService $workflow;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::ACTING_TENANT);
        $this->workflow = app(EventPublicationWorkflowService::class);
        // The actor in these tests is a NETWORK admin — an admin who oversees the
        // community being acted on from a different home tenant. Build that
        // relationship for real: the home tenant becomes the parent of the acting
        // tenant, so the actor's authority over it is genuine rather than assumed
        // from an admin flag alone. Rolls back with the transaction.
        $this->makeHomeTenantOversee(self::HOME_TENANT, self::ACTING_TENANT);

    }

    private function setModerationRequired(bool $required): void
    {
        $raw = DB::table('tenants')->where('id', self::ACTING_TENANT)->value('configuration');
        $configuration = is_string($raw) ? (json_decode($raw, true) ?: []) : (is_array($raw) ? $raw : []);
        $configuration['events'] = array_merge(
            $configuration['events'] ?? [],
            ['moderation_required' => $required],
        );
        DB::table('tenants')->where('id', self::ACTING_TENANT)->update([
            'configuration' => json_encode($configuration),
        ]);
    }

    private function crossTenantUser(array $overrides = []): User
    {
        return User::factory()->forTenant(self::HOME_TENANT)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function draftEvent(int $organizerId, string $publicationState = 'draft'): Event
    {
        $event = Event::factory()->forTenant(self::ACTING_TENANT)->create([
            'user_id' => $organizerId,
        ]);
        DB::table('events')->where('id', $event->id)->update([
            'status' => 'draft',
            'publication_status' => $publicationState,
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
        ]);

        return $event->fresh() ?? $event;
    }

    private function publicationStateOf(Event $event): ?string
    {
        $value = DB::table('events')->where('id', $event->id)->value('publication_status');

        return $value === null ? null : (string) $value;
    }

    public function test_cross_tenant_organizer_can_publish_their_own_draft(): void
    {
        $this->setModerationRequired(false);
        $organizer = $this->crossTenantUser();
        $event = $this->draftEvent((int) $organizer->id);

        $this->workflow->publish((int) $event->id, $organizer);

        self::assertSame(
            'published',
            $this->publicationStateOf($event),
            'The organiser must be able to publish their own draft even when their account row lives on another tenant.',
        );
    }

    /**
     * The exact production shape: role='admin', is_tenant_super_admin=1,
     * home tenant != the tenant being acted on.
     */
    public function test_cross_tenant_network_admin_can_publish_a_draft(): void
    {
        $this->setModerationRequired(false);
        $admin = $this->crossTenantUser([
            'role' => 'admin',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 1,
        ]);
        $event = $this->draftEvent((int) $admin->id);

        $this->workflow->publish((int) $event->id, $admin);

        self::assertSame('published', $this->publicationStateOf($event));
    }

    /** The fix must not widen authority: a stranger still cannot publish. */
    public function test_cross_tenant_stranger_cannot_publish_someone_elses_draft(): void
    {
        $this->setModerationRequired(false);
        $organizer = User::factory()->forTenant(self::ACTING_TENANT)->create(['status' => 'active']);
        $event = $this->draftEvent((int) $organizer->id);
        $stranger = $this->crossTenantUser(['role' => 'member']);

        $this->expectException(EventLifecycleTransitionException::class);
        $this->workflow->publish((int) $event->id, $stranger);
    }

    /**
     * The security property the network-admin cases above must not blur.
     *
     * This actor is an admin of the PARENT community, but a plain one — no
     * is_tenant_super_admin. Being an admin of a community above this one is not
     * authority over this one; only the network tier reaches down the tree. Note
     * setUp() has made the home tenant the parent, so this is the strongest form
     * of the case: even the closest possible relationship is not enough without
     * the network flag. Before TenantAdminScope this actor could publish, and so
     * could an admin of a completely unrelated community.
     */
    public function test_plain_admin_of_another_community_cannot_publish_here(): void
    {
        $this->setModerationRequired(false);
        $organizer = User::factory()->forTenant(self::ACTING_TENANT)->create(['status' => 'active']);
        $event = $this->draftEvent((int) $organizer->id);
        $outsideAdmin = $this->crossTenantUser([
            'role' => 'admin',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
        ]);

        $this->expectException(EventLifecycleTransitionException::class);
        $this->workflow->publish((int) $event->id, $outsideAdmin);
    }

    public function test_suspended_cross_tenant_organizer_is_refused(): void
    {
        $this->setModerationRequired(false);
        $organizer = $this->crossTenantUser(['status' => 'suspended']);
        $event = $this->draftEvent((int) $organizer->id);

        $this->expectException(EventLifecycleTransitionException::class);
        $this->workflow->publish((int) $event->id, $organizer);
    }

    /**
     * approve() takes the locked actor re-read inside transitionSeries(),
     * which carried its own tenant-scoped predicate.
     */
    public function test_cross_tenant_admin_can_approve_a_pending_review_event(): void
    {
        $this->setModerationRequired(true);
        $organizer = User::factory()->forTenant(self::ACTING_TENANT)->create(['status' => 'active']);
        $event = $this->draftEvent((int) $organizer->id, 'pending_review');
        // A network admin, not a bare role='admin' on an unrelated tenant. What
        // this test exists to pin is the LOCKED ACTOR RE-READ — that it does not
        // refuse an actor authorisation has already granted — and the persona is
        // incidental to that. It has to be someone who genuinely holds authority
        // here, or the test passes for the wrong reason: a plain admin of another
        // community has no authority over this one (TenantAdminScope), so using
        // one would assert a cross-tenant escalation rather than the re-read.
        $admin = $this->crossTenantUser([
            'role' => 'admin',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 1,
        ]);

        $this->workflow->approve((int) $event->id, $admin);

        self::assertSame(
            'published',
            $this->publicationStateOf($event),
            'An admin acting on another community must be able to approve a pending event.',
        );
    }

    /** Resource scoping is untouched: an event on another tenant stays invisible. */
    public function test_event_on_another_tenant_is_not_reachable(): void
    {
        $this->setModerationRequired(false);
        $organizer = $this->crossTenantUser();
        $foreignEvent = Event::factory()->forTenant(self::HOME_TENANT)->create([
            'user_id' => (int) $organizer->id,
        ]);
        DB::table('events')->where('id', $foreignEvent->id)->update([
            'status' => 'draft',
            'publication_status' => 'draft',
        ]);

        try {
            $this->workflow->publish((int) $foreignEvent->id, $organizer);
            self::fail('Publishing an event that belongs to another tenant must be refused.');
        } catch (EventLifecycleTransitionException $exception) {
            self::assertSame('event_lifecycle_event_not_found', $exception->reasonCode);
        }
    }
}
