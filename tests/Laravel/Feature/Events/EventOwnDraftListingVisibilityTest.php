<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\Event;
use App\Models\User;
use App\Services\EventService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Regression cover for the creator's own unpublished events in the directory.
 *
 * Draft AND pending-review events mirror to legacy status 'draft'
 * (EventLifecycleCompatibility::legacyMirror), and the discovery query
 * hard-filtered on `status IS NULL OR status = 'active'` BEFORE the
 * publication-visibility block. So the "members see their OWN drafts/pending"
 * clause never matched: a member who created an event and navigated away had
 * no list anywhere showing it — the event simply looked lost.
 */
final class EventOwnDraftListingVisibilityTest extends TestCase
{
    use DatabaseTransactions;

    private const ACTING_TENANT = 2;
    private const HOME_TENANT = 999;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::ACTING_TENANT);
    }

    private function eventWithState(int $organizerId, string $publicationState): Event
    {
        $event = Event::factory()->forTenant(self::ACTING_TENANT)->create([
            'user_id' => $organizerId,
        ]);
        DB::table('events')->where('id', $event->id)->update([
            'status' => $publicationState === 'published' ? 'active' : 'draft',
            'publication_status' => $publicationState,
            'operational_status' => 'scheduled',
        ]);

        return $event;
    }

    /** @return list<int> */
    private function listedIdsFor(?int $viewerId): array
    {
        $filters = ['when' => 'upcoming', 'limit' => 100];
        if ($viewerId !== null) {
            $filters['viewer_id'] = $viewerId;
        }
        $result = EventService::getAll($filters);

        return array_map(
            static fn (array $item): int => (int) $item['id'],
            $result['items'],
        );
    }

    public function test_creator_sees_their_own_draft_in_the_list(): void
    {
        $creator = User::factory()->forTenant(self::ACTING_TENANT)->create(['status' => 'active']);
        $draft = $this->eventWithState((int) $creator->id, 'draft');

        self::assertContains(
            (int) $draft->id,
            $this->listedIdsFor((int) $creator->id),
            'The creator must see their own draft in the events list — otherwise it looks lost.',
        );
    }

    public function test_creator_sees_their_own_pending_review_event_in_the_list(): void
    {
        $creator = User::factory()->forTenant(self::ACTING_TENANT)->create(['status' => 'active']);
        $pending = $this->eventWithState((int) $creator->id, 'pending_review');

        self::assertContains((int) $pending->id, $this->listedIdsFor((int) $creator->id));
    }

    /** The production shape: the creator's account row lives on another tenant. */
    public function test_cross_tenant_creator_sees_their_own_draft_in_the_list(): void
    {
        $creator = User::factory()->forTenant(self::HOME_TENANT)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $draft = $this->eventWithState((int) $creator->id, 'draft');

        self::assertContains((int) $draft->id, $this->listedIdsFor((int) $creator->id));
    }

    public function test_another_member_does_not_see_someone_elses_draft(): void
    {
        $creator = User::factory()->forTenant(self::ACTING_TENANT)->create(['status' => 'active']);
        $draft = $this->eventWithState((int) $creator->id, 'draft');
        $other = User::factory()->forTenant(self::ACTING_TENANT)->create(['status' => 'active']);

        self::assertNotContains((int) $draft->id, $this->listedIdsFor((int) $other->id));
    }

    public function test_anonymous_visitors_do_not_see_drafts(): void
    {
        $creator = User::factory()->forTenant(self::ACTING_TENANT)->create(['status' => 'active']);
        $draft = $this->eventWithState((int) $creator->id, 'draft');

        self::assertNotContains((int) $draft->id, $this->listedIdsFor(null));
    }

    public function test_published_events_remain_visible_to_everyone(): void
    {
        $creator = User::factory()->forTenant(self::ACTING_TENANT)->create(['status' => 'active']);
        $published = $this->eventWithState((int) $creator->id, 'published');
        $other = User::factory()->forTenant(self::ACTING_TENANT)->create(['status' => 'active']);

        self::assertContains((int) $published->id, $this->listedIdsFor((int) $other->id));
        self::assertContains((int) $published->id, $this->listedIdsFor(null));
    }
}
