<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Public (anonymous) events advertising.
 *
 * Two things are being protected here, and both have a specific failure mode:
 *
 *  1. AUDIENCE. An event that would not appear in the public list must not be
 *     openable by guessing its id — private-group events, drafts and archived
 *     events all 404 rather than 403, so the endpoint cannot be used to probe
 *     for their existence.
 *
 *  2. PROJECTION. The public payload is an allowlist. These tests assert on the
 *     ABSENCE of member-only fields, because the failure this guards against is
 *     a future field being added to the shared serializer and silently
 *     published — which no positive assertion would ever catch.
 */
class PublicEventsTest extends TestCase
{
    use DatabaseTransactions;

    private function setPublicEventsFeature(bool $enabled): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($row && ! empty($row->features)) {
            $decoded = is_string($row->features) ? json_decode($row->features, true) : $row->features;
            if (is_array($decoded)) {
                $features = $decoded;
            }
        }
        $features['events'] = true;
        $features['public_events'] = $enabled;

        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    private function organiser(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'first_name' => 'Marie',
            'last_name' => 'Delacroix',
        ]);
    }

    /**
     * `status` and `publication_status` are deliberately NOT in Event::$fillable
     * — they are lifecycle state owned by the service layer, so passing them to
     * the constructor makes Eloquent discard them silently and the fixture then
     * proves nothing. They are assigned directly here for that reason.
     *
     * @param  array<string, mixed>  $overrides
     * @param  array<string, mixed>  $lifecycle
     */
    private function event(User $organiser, array $overrides = [], array $lifecycle = []): Event
    {
        $event = new Event(array_merge([
            'user_id' => $organiser->id,
            'title' => 'Wassail in the Orchard',
            'description' => 'A community celebration.',
            'location' => 'Coventry Community Orchard',
            'start_time' => now()->addDays(7),
            'end_time' => now()->addDays(7)->addHours(3),
            'max_attendees' => 40,
        ], $overrides));
        $event->tenant_id = $this->testTenantId;
        $event->status = 'active';

        foreach ($lifecycle as $column => $value) {
            $event->{$column} = $value;
        }

        $event->save();

        return $event;
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->setPublicEventsFeature(true);
    }

    // ── Feature gate ────────────────────────────────────────────────────

    public function test_public_listing_403s_when_the_feature_is_disabled(): void
    {
        $this->setPublicEventsFeature(false);

        $response = $this->apiGet('/v2/public/events');

        $this->assertSame(403, $response->getStatusCode());
    }

    // ── Anonymous access ────────────────────────────────────────────────

    public function test_anonymous_visitor_can_list_published_events(): void
    {
        $organiser = $this->organiser();
        $event = $this->event($organiser);

        $response = $this->apiGet('/v2/public/events');

        $this->assertSame(200, $response->getStatusCode(), 'Public listing must succeed before its payload is trusted.');
        $ids = array_column($response->json('data') ?? [], 'id');
        $this->assertContains((int) $event->id, $ids);
    }

    public function test_anonymous_visitor_can_open_a_published_event(): void
    {
        $organiser = $this->organiser();
        $event = $this->event($organiser);

        $response = $this->apiGet('/v2/public/events/' . $event->id);

        $this->assertSame(200, $response->getStatusCode());
        $response->assertJsonPath('data.id', (int) $event->id);
        $response->assertJsonPath('data.title', 'Wassail in the Orchard');
    }

    // ── Projection: what must NOT be published ──────────────────────────

    public function test_public_payload_omits_member_only_fields(): void
    {
        $organiser = $this->organiser();
        $event = $this->event($organiser, [
            'is_online' => true,
            'online_link' => 'https://meet.example.test/secret-room',
        ]);

        $detail = $this->apiGet('/v2/public/events/' . $event->id)->json('data');
        $listItem = ($this->apiGet('/v2/public/events')->json('data') ?? [])[0] ?? [];

        foreach ([$detail, $listItem] as $payload) {
            $this->assertIsArray($payload);

            foreach ([
                'online_link',
                'online_access',
                'join_url',
                'my_rsvp',
                'user_rsvp',
                'rsvps',
                'rsvp_counts',
                'attendee_count',
                'attendees_count',
                'interested_count',
                'spots_left',
                'is_full',
                'max_attendees',
                'registration',
                'permissions',
                'user',
            ] as $forbidden) {
                $this->assertArrayNotHasKey(
                    $forbidden,
                    $payload,
                    "'{$forbidden}' must never reach an anonymous visitor — the public projection is an allowlist."
                );
            }
        }

        // Positive control: the allowlist really is producing content, so the
        // absence assertions above cannot be passing on an empty payload.
        $this->assertSame('Wassail in the Orchard', $detail['title']);
        $this->assertSame('Coventry Community Orchard', $detail['location']);
    }

    public function test_individual_organisers_are_published_by_first_name_only(): void
    {
        $organiser = $this->organiser();
        $event = $this->event($organiser);

        $detail = $this->apiGet('/v2/public/events/' . $event->id)->json('data');

        $this->assertSame('Marie', $detail['organizer_name']);
        $this->assertStringNotContainsString(
            'Delacroix',
            json_encode($detail, JSON_THROW_ON_ERROR),
            "A resident's surname must not be published on the open web."
        );
        $this->assertStringNotContainsString(
            (string) $organiser->email,
            json_encode($detail, JSON_THROW_ON_ERROR),
        );
    }

    // ── Audience ────────────────────────────────────────────────────────

    public function test_draft_and_archived_events_are_not_public(): void
    {
        $organiser = $this->organiser();
        $draft = $this->event($organiser, ['title' => 'Draft event'], ['publication_status' => 'draft']);
        $archived = $this->event($organiser, ['title' => 'Archived event'], ['publication_status' => 'archived']);

        // Positive control: the lifecycle columns really were persisted, so the
        // assertions below cannot pass merely because Eloquent dropped them.
        $this->assertSame('draft', $draft->fresh()->getRawOriginal('publication_status'));
        $this->assertSame('archived', $archived->fresh()->getRawOriginal('publication_status'));

        $ids = array_column($this->apiGet('/v2/public/events')->json('data') ?? [], 'id');

        $this->assertNotContains((int) $draft->id, $ids);
        $this->assertNotContains((int) $archived->id, $ids);
        $this->assertSame(404, $this->apiGet('/v2/public/events/' . $draft->id)->getStatusCode());
        $this->assertSame(
            404,
            $this->apiGet('/v2/public/events/' . $archived->id)->getStatusCode(),
            'A non-public event must 404, not 403 — a 403 would confirm it exists.'
        );
    }

    public function test_events_in_a_private_group_are_not_public(): void
    {
        $organiser = $this->organiser();

        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Private Circle',
            'slug' => 'private-circle-' . uniqid(),
            'owner_id' => $organiser->id,
            'visibility' => 'private',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $event = $this->event($organiser, ['group_id' => $groupId, 'title' => 'Members only']);

        $ids = array_column($this->apiGet('/v2/public/events')->json('data') ?? [], 'id');

        $this->assertNotContains((int) $event->id, $ids);
        $this->assertSame(404, $this->apiGet('/v2/public/events/' . $event->id)->getStatusCode());
    }

    public function test_events_in_a_public_group_are_public(): void
    {
        $organiser = $this->organiser();

        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Open Circle',
            'slug' => 'open-circle-' . uniqid(),
            'owner_id' => $organiser->id,
            'visibility' => 'public',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $event = $this->event($organiser, ['group_id' => $groupId, 'title' => 'Open to all']);

        $this->assertSame(200, $this->apiGet('/v2/public/events/' . $event->id)->getStatusCode());
    }

    public function test_another_tenants_event_is_not_public_here(): void
    {
        $otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Other Community',
            'slug' => 'other-public-events-' . uniqid(),
            'features' => json_encode(['events' => true, 'public_events' => true]),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        TenantContext::setById($otherTenantId);
        $foreignOrganiser = User::factory()->forTenant($otherTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $foreignEvent = new Event([
            'user_id' => $foreignOrganiser->id,
            'title' => 'Someone else\'s event',
            'start_time' => now()->addDays(3),
            'status' => 'active',
        ]);
        $foreignEvent->tenant_id = $otherTenantId;
        $foreignEvent->save();

        TenantContext::setById($this->testTenantId);

        $ids = array_column($this->apiGet('/v2/public/events')->json('data') ?? [], 'id');
        $this->assertNotContains((int) $foreignEvent->id, $ids);
        $this->assertSame(404, $this->apiGet('/v2/public/events/' . $foreignEvent->id)->getStatusCode());
    }

    // ── Member API unaffected ───────────────────────────────────────────

    public function test_the_member_events_endpoint_still_requires_authentication(): void
    {
        $this->event($this->organiser());

        $response = $this->apiGet('/v2/events');

        $this->assertContains(
            $response->getStatusCode(),
            [401, 403],
            'Adding a public listing must not open the member events endpoint.'
        );
    }

    public function test_an_authenticated_member_still_gets_the_full_member_payload(): void
    {
        $organiser = $this->organiser();
        $this->event($organiser);
        $this->actingAs($organiser);

        $response = $this->apiGet('/v2/events');

        $this->assertSame(200, $response->getStatusCode());
        $first = ($response->json('data') ?? [])[0] ?? [];
        $this->assertNotSame([], $first, 'Member listing must still return events.');
        $this->assertArrayHasKey(
            'user_rsvp',
            $first,
            'The member projection is unchanged — only the public one is reduced.'
        );
    }
}
