<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\GovukAlpha;

use App\Core\TenantContext;
use App\Models\Event;
use App\Models\PartnerVenue;
use App\Models\User;
use App\Services\PartnerVenueService;
use App\Services\PartnerVenueVisitService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Accessible-frontend parity for partner venues and the public What's On pages.
 *
 * Two properties carry the weight here:
 *  - the venue check-in GET must record NOTHING (link-preview crawlers prefetch
 *    URLs; only the deliberate POST is a visit), and the recorded visit must go
 *    through the same PartnerVenueVisitService rules as the React flow —
 *    including staff authorization and the one-per-day key;
 *  - What's On is the accessible frontend's only logged-out events surface, so
 *    it must be reachable anonymously when (and only when) BOTH feature flags
 *    are on, and must serve exactly the public projection — no joining links,
 *    no attendee data, organiser first-name only.
 */
class AccessibleVenuesAndWhatsOnTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode([
                'events' => true,
                'public_events' => true,
                'partner_venues' => true,
            ], JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    private function setFeatures(array $features): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features, JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function venue(string $name = 'The Time Union Cafe'): PartnerVenue
    {
        $venue = new PartnerVenue([
            'name' => $name,
            'category' => 'cafe',
            'offer_summary' => '10% off hot drinks',
            'status' => 'active',
        ]);
        $venue->tenant_id = $this->testTenantId;
        $venue->slug = str($name)->slug()->value() . '-' . uniqid();
        $venue->save();

        return $venue;
    }

    private function publicEvent(User $organiser, string $title = 'Wassail Night'): Event
    {
        $event = new Event([
            'user_id' => $organiser->id,
            'title' => $title,
            'description' => 'A community wassail.',
            'start_time' => now()->addWeek(),
            'end_time' => now()->addWeek()->addHours(2),
            'location' => 'The Orchard',
        ]);
        $event->tenant_id = $this->testTenantId;
        $event->status = 'active';
        $event->publication_status = 'published';
        $event->save();

        return $event;
    }

    private function accessiblePost(string $uri, array $data = []): TestResponse
    {
        $token = 'accessible-venues-token';
        $this->withSession(['_token' => $token]);

        return $this->post($uri, array_merge(['_token' => $token], $data));
    }

    // ── Partner venues ──────────────────────────────────────────────────

    public function test_venue_pages_redirect_anonymous_visitors_to_login(): void
    {
        $this->get("/{$this->testTenantSlug}/accessible/venues")
            ->assertRedirect();
    }

    public function test_venue_directory_and_pass_render_for_members(): void
    {
        $venue = $this->venue();
        $member = $this->member();
        Sanctum::actingAs($member, ['*']);

        $directory = $this->get("/{$this->testTenantSlug}/accessible/venues");
        $directory->assertStatus(200);
        $directory->assertSee($venue->name);
        $directory->assertSee('10% off hot drinks');

        $pass = $this->get("/{$this->testTenantSlug}/accessible/venues/pass");
        $pass->assertStatus(200);
        // Server-side SVG — the page must carry the QR inline, no JS required.
        $pass->assertSee('<svg', false);

        $this->assertDatabaseHas('partner_member_passes', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
        ]);
    }

    public function test_venue_pages_are_feature_gated(): void
    {
        $this->setFeatures(['events' => true, 'partner_venues' => false]);
        Sanctum::actingAs($this->member(), ['*']);

        $this->get("/{$this->testTenantSlug}/accessible/venues")->assertStatus(403);
    }

    public function test_checkin_get_records_nothing_and_post_records_a_visit(): void
    {
        $venue = $this->venue();
        $memberUser = $this->member();
        $staff = $this->member();
        app(PartnerVenueService::class)->addStaff((int) $venue->id, (int) $staff->id, 'member');

        $pass = app(PartnerVenueVisitService::class)->getOrCreatePass((int) $memberUser->id);
        $token = (string) $pass['token'];

        Sanctum::actingAs($staff, ['*']);

        // GET: the confirm page, and NO visit row.
        $landing = $this->get("/{$this->testTenantSlug}/accessible/venues/checkin/{$token}");
        $landing->assertStatus(200);
        $this->assertSame(0, DB::table('partner_venue_visits')->where('user_id', $memberUser->id)->count());

        // POST: exactly one visit, through the same service rules as React.
        $confirm = $this->accessiblePost("/{$this->testTenantSlug}/accessible/venues/checkin/{$token}");
        $confirm->assertStatus(200);
        $confirm->assertSee($venue->name);

        $this->assertSame(1, DB::table('partner_venue_visits')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $memberUser->id)
            ->where('venue_id', $venue->id)
            ->count());

        // A rescan the same day is the friendly no-op, not a second row.
        $this->accessiblePost("/{$this->testTenantSlug}/accessible/venues/checkin/{$token}")
            ->assertStatus(200);
        $this->assertSame(1, DB::table('partner_venue_visits')->where('user_id', $memberUser->id)->count());
    }

    public function test_non_staff_cannot_record_visits(): void
    {
        $this->venue();
        $memberUser = $this->member();
        $notStaff = $this->member();

        $pass = app(PartnerVenueVisitService::class)->getOrCreatePass((int) $memberUser->id);

        Sanctum::actingAs($notStaff, ['*']);

        $this->accessiblePost("/{$this->testTenantSlug}/accessible/venues/checkin/{$pass['token']}")
            ->assertStatus(200)
            ->assertSee(__('govuk_alpha_venues.checkin.forbidden_title'));

        $this->assertSame(0, DB::table('partner_venue_visits')->where('user_id', $memberUser->id)->count());
    }

    // ── What's On (public) ──────────────────────────────────────────────

    public function test_whats_on_lists_published_events_to_anonymous_visitors(): void
    {
        $organiser = $this->member(['first_name' => 'Marie', 'last_name' => 'Curie']);
        $event = $this->publicEvent($organiser);

        $response = $this->get("/{$this->testTenantSlug}/accessible/whats-on");

        $response->assertStatus(200);
        $response->assertSee('Wassail Night');

        $detail = $this->get("/{$this->testTenantSlug}/accessible/whats-on/{$event->id}");
        $detail->assertStatus(200);
        $detail->assertSee('Wassail Night');
        $detail->assertSee('The Orchard');
        // Organiser is FIRST NAME ONLY on the public page.
        $detail->assertSee('Marie');
        $detail->assertDontSee('Curie');
    }

    public function test_whats_on_hides_drafts_and_404s_their_detail_pages(): void
    {
        $organiser = $this->member();
        $draft = new Event([
            'user_id' => $organiser->id,
            'title' => 'Secret Draft Gathering',
            'start_time' => now()->addWeek(),
        ]);
        $draft->tenant_id = $this->testTenantId;
        $draft->status = 'active';
        $draft->publication_status = 'draft';
        $draft->save();

        $this->get("/{$this->testTenantSlug}/accessible/whats-on")
            ->assertStatus(200)
            ->assertDontSee('Secret Draft Gathering');

        // Identical 404 for "draft" and "does not exist" — no probing.
        $this->get("/{$this->testTenantSlug}/accessible/whats-on/{$draft->id}")->assertStatus(404);
        $this->get("/{$this->testTenantSlug}/accessible/whats-on/999999999")->assertStatus(404);
    }

    public function test_whats_on_is_gated_on_both_feature_flags(): void
    {
        $this->setFeatures(['events' => true, 'public_events' => false]);
        $this->get("/{$this->testTenantSlug}/accessible/whats-on")->assertStatus(404);

        $this->setFeatures(['events' => false, 'public_events' => true]);
        $this->get("/{$this->testTenantSlug}/accessible/whats-on")->assertStatus(404);
    }
}
