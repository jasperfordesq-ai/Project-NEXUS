<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Policies;

use App\Core\TenantContext;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Regression cover for EventPolicy::hasValidContext().
 *
 * The context check compared the ACTING user's home tenant against the
 * current tenant, so every ability — including view and manage of the actor's
 * own event — returned false for any actor whose account row lives on another
 * tenant. In production this 404'd an organiser off the detail page of the
 * draft they had created seconds earlier, and hid the Publish button, because
 * can_publish derives from manage().
 *
 * The rule this pins: auth is GLOBAL, resources are tenant-scoped. The EVENT
 * must belong to the current tenant (still asserted below); the actor's home
 * tenant must not be compared against it.
 */
final class EventPolicyCrossTenantActorTest extends TestCase
{
    use DatabaseTransactions;

    private const ACTING_TENANT = 2;
    private const HOME_TENANT = 999;

    private EventPolicy $policy;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::ACTING_TENANT);
        $this->policy = new EventPolicy();
    }

    private function crossTenantUser(array $overrides = []): User
    {
        return User::factory()->forTenant(self::HOME_TENANT)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function eventOnActingTenant(int $organizerId, string $publicationState): Event
    {
        $event = Event::factory()->forTenant(self::ACTING_TENANT)->create([
            'user_id' => $organizerId,
        ]);
        DB::table('events')->where('id', $event->id)->update([
            'status' => $publicationState === 'published' ? 'active' : 'draft',
            'publication_status' => $publicationState,
            'operational_status' => 'scheduled',
        ]);

        return $event->fresh() ?? $event;
    }

    public function test_cross_tenant_organizer_can_view_and_manage_their_own_draft(): void
    {
        $organizer = $this->crossTenantUser();
        $event = $this->eventOnActingTenant((int) $organizer->id, 'draft');

        self::assertTrue(
            $this->policy->view($organizer, $event),
            'The organiser must see the draft they created, wherever their account row lives.',
        );
        self::assertTrue(
            $this->policy->manage($organizer, $event),
            'manage() drives can_publish — refusing it hides the Publish button from the organiser.',
        );
    }

    public function test_cross_tenant_stranger_cannot_view_or_manage_a_draft(): void
    {
        $organizer = User::factory()->forTenant(self::ACTING_TENANT)->create(['status' => 'active']);
        $event = $this->eventOnActingTenant((int) $organizer->id, 'draft');
        $stranger = $this->crossTenantUser(['role' => 'member']);

        self::assertFalse($this->policy->view($stranger, $event));
        self::assertFalse($this->policy->manage($stranger, $event));
    }

    public function test_cross_tenant_member_can_view_a_published_event(): void
    {
        $organizer = User::factory()->forTenant(self::ACTING_TENANT)->create(['status' => 'active']);
        $event = $this->eventOnActingTenant((int) $organizer->id, 'published');
        $member = $this->crossTenantUser(['role' => 'member']);

        self::assertTrue($this->policy->view($member, $event));
        self::assertFalse($this->policy->manage($member, $event));
    }

    public function test_suspended_actor_is_still_refused(): void
    {
        $organizer = $this->crossTenantUser(['status' => 'suspended']);
        $event = $this->eventOnActingTenant((int) $organizer->id, 'draft');

        self::assertFalse($this->policy->view($organizer, $event));
        self::assertFalse($this->policy->manage($organizer, $event));
    }

    /** Resource scoping is untouched: an event of another tenant fails closed. */
    public function test_event_belonging_to_another_tenant_is_refused(): void
    {
        $organizer = $this->crossTenantUser();
        $foreignEvent = Event::factory()->forTenant(self::HOME_TENANT)->create([
            'user_id' => (int) $organizer->id,
        ]);
        DB::table('events')->where('id', $foreignEvent->id)->update([
            'status' => 'active',
            'publication_status' => 'published',
        ]);
        $foreignEvent = $foreignEvent->fresh() ?? $foreignEvent;

        self::assertFalse($this->policy->view($organizer, $foreignEvent));
        self::assertFalse($this->policy->manage($organizer, $foreignEvent));
    }
}
