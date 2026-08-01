<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\PartnerVenues;

use App\Core\TenantContext;
use App\Models\PartnerVenue;
use App\Models\User;
use App\Services\PartnerVenueService;
use App\Services\PartnerVenueVisitService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Partner venue engagement recording.
 *
 * The load-bearing guarantees, each of which has a specific failure mode this
 * asserts against:
 *
 *  - Only authorised venue staff (or a tenant admin) can record a visit, so the
 *    ledger is a staff attestation rather than member self-report.
 *  - A member cannot be recorded twice at the same venue on the same day — the
 *    DB unique key makes a rescan a no-op, not an error and not a double count.
 *  - A pass token from another tenant resolves to nothing (tenant isolation).
 *  - Recording engagement drives BOTH reward systems: XP and admin-defined
 *    challenge progress. Challenge progress had zero production callers before
 *    EngagementService, so this is the test that keeps it wired.
 */
class PartnerVenueVisitTest extends TestCase
{
    use DatabaseTransactions;

    private PartnerVenueVisitService $visits;

    private PartnerVenueService $venues;

    protected function setUp(): void
    {
        parent::setUp();

        $this->setPartnerVenuesFeature(true);

        $this->venues = $this->app->make(PartnerVenueService::class);
        $this->visits = $this->app->make(PartnerVenueVisitService::class);
    }

    private function setPartnerVenuesFeature(bool $enabled, ?int $tenantId = null): void
    {
        $tenantId ??= $this->testTenantId;

        $row = DB::table('tenants')->where('id', $tenantId)->first();
        $features = [];
        if ($row && ! empty($row->features)) {
            $decoded = is_string($row->features) ? json_decode($row->features, true) : $row->features;
            if (is_array($decoded)) {
                $features = $decoded;
            }
        }
        $features['partner_venues'] = $enabled;

        DB::table('tenants')->where('id', $tenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($tenantId);
    }

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function venue(string $name = 'The Time Union Cafe', string $status = 'active'): PartnerVenue
    {
        $venue = new PartnerVenue([
            'name' => $name,
            'category' => 'cafe',
            'offer_summary' => '10% off hot drinks',
            'status' => $status,
        ]);
        $venue->tenant_id = $this->testTenantId;
        $venue->slug = str($name)->slug()->value() . '-' . uniqid();
        $venue->save();

        return $venue;
    }

    private function staffFor(PartnerVenue $venue, string $role = 'member'): User
    {
        $staff = $this->member();
        $this->venues->addStaff((int) $venue->id, (int) $staff->id, $role);

        return $staff;
    }

    /**
     * An active challenge keyed to the venue_visit action, so challenge
     * progress can be observed rather than assumed.
     */
    private function createVenueVisitChallenge(int $targetCount = 1): int
    {
        return (int) DB::table('challenges')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Visit a partner venue',
            'description' => 'Fixture for venue visit engagement.',
            'challenge_type' => 'weekly',
            'action_type' => PartnerVenueVisitService::ENGAGEMENT_ACTION,
            'target_count' => $targetCount,
            'xp_reward' => 25,
            'badge_reward' => null,
            'start_date' => now()->subDay()->toDateString(),
            'end_date' => now()->addDay()->toDateString(),
            'is_active' => 1,
        ]);
    }

    // ── Pass lifecycle ──────────────────────────────────────────────────

    public function test_pass_is_created_once_and_reused(): void
    {
        $member = $this->member();

        $first = $this->visits->getOrCreatePass((int) $member->id);
        $second = $this->visits->getOrCreatePass((int) $member->id);

        $this->assertSame($first['token'], $second['token'], 'A second call must reuse the existing pass, not mint a new one.');
        $this->assertSame(64, strlen($first['token']));
        $this->assertStringContainsString('/venues/checkin/' . $first['token'], $first['qr_url']);
        $this->assertSame(
            1,
            DB::table('partner_member_passes')->where('user_id', $member->id)->count(),
            'Exactly one pass row per member per tenant.'
        );
    }

    public function test_rotating_a_pass_invalidates_the_previous_token(): void
    {
        $member = $this->member();
        $venue = $this->venue();
        $staff = $this->staffFor($venue);

        $old = $this->visits->getOrCreatePass((int) $member->id)['token'];
        $new = $this->visits->rotatePass((int) $member->id)['token'];

        $this->assertNotSame($old, $new);
        $this->assertSame('invalid_pass', $this->visits->recordVisit($old, (int) $staff->id)['status']);
        $this->assertSame('recorded', $this->visits->recordVisit($new, (int) $staff->id)['status']);
    }

    // ── Authorisation ───────────────────────────────────────────────────

    public function test_venue_staff_can_record_a_visit(): void
    {
        $member = $this->member();
        $venue = $this->venue();
        $staff = $this->staffFor($venue);
        $token = $this->visits->getOrCreatePass((int) $member->id)['token'];

        $result = $this->visits->recordVisit($token, (int) $staff->id);

        $this->assertSame('recorded', $result['status']);
        $this->assertSame((int) $venue->id, $result['venue']['id']);
        $this->assertSame(1, $result['visits_this_month']);
        $this->assertDatabaseHas('partner_venue_visits', [
            'tenant_id' => $this->testTenantId,
            'venue_id' => $venue->id,
            'user_id' => $member->id,
            'recorded_by_user_id' => $staff->id,
            'source' => 'member_pass',
        ]);
    }

    public function test_a_member_who_is_not_staff_cannot_record_a_visit(): void
    {
        $member = $this->member();
        $bystander = $this->member();
        $this->venue();
        $token = $this->visits->getOrCreatePass((int) $member->id)['token'];

        $result = $this->visits->recordVisit($token, (int) $bystander->id);

        $this->assertSame('forbidden', $result['status']);
        $this->assertDatabaseMissing('partner_venue_visits', ['user_id' => $member->id]);
    }

    public function test_staff_cannot_record_against_a_venue_they_do_not_work_at(): void
    {
        $member = $this->member();
        $theirVenue = $this->venue('Their Cafe');
        $otherVenue = $this->venue('Other Cafe');
        $staff = $this->staffFor($theirVenue);
        $token = $this->visits->getOrCreatePass((int) $member->id)['token'];

        $result = $this->visits->recordVisit($token, (int) $staff->id, (int) $otherVenue->id);

        $this->assertSame('forbidden', $result['status']);
        $this->assertDatabaseMissing('partner_venue_visits', ['venue_id' => $otherVenue->id]);
    }

    public function test_tenant_admin_can_record_a_visit(): void
    {
        $member = $this->member();
        $venue = $this->venue();
        $admin = $this->member(['role' => 'admin']);
        $token = $this->visits->getOrCreatePass((int) $member->id)['token'];

        $this->assertSame('recorded', $this->visits->recordVisit($token, (int) $admin->id)['status']);
    }

    public function test_staff_cannot_record_their_own_visit(): void
    {
        $venue = $this->venue();
        $staff = $this->staffFor($venue);
        $token = $this->visits->getOrCreatePass((int) $staff->id)['token'];

        $result = $this->visits->recordVisit($token, (int) $staff->id);

        $this->assertSame('forbidden', $result['status'], 'A self-recorded visit would make the ledger self-attested.');
        $this->assertDatabaseMissing('partner_venue_visits', ['user_id' => $staff->id]);
    }

    public function test_paused_venue_cannot_record_visits(): void
    {
        $member = $this->member();
        $venue = $this->venue('Closed For Refit', 'paused');
        $staff = $this->staffFor($venue);
        $token = $this->visits->getOrCreatePass((int) $member->id)['token'];

        $this->assertSame('forbidden', $this->visits->recordVisit($token, (int) $staff->id, (int) $venue->id)['status']);
    }

    public function test_staff_of_several_venues_must_choose_one(): void
    {
        $member = $this->member();
        $first = $this->venue('First Cafe');
        $second = $this->venue('Second Cafe');
        $staff = $this->member();
        $this->venues->addStaff((int) $first->id, (int) $staff->id);
        $this->venues->addStaff((int) $second->id, (int) $staff->id);
        $token = $this->visits->getOrCreatePass((int) $member->id)['token'];

        $ambiguous = $this->visits->recordVisit($token, (int) $staff->id);

        $this->assertSame('needs_venue', $ambiguous['status']);
        $this->assertCount(2, $ambiguous['venues']);
        $this->assertDatabaseMissing('partner_venue_visits', ['user_id' => $member->id]);

        $resolved = $this->visits->recordVisit($token, (int) $staff->id, (int) $second->id);
        $this->assertSame('recorded', $resolved['status']);
        $this->assertSame((int) $second->id, $resolved['venue']['id']);
    }

    // ── Idempotency ─────────────────────────────────────────────────────

    public function test_rescanning_the_same_day_does_not_double_count(): void
    {
        $member = $this->member();
        $venue = $this->venue();
        $staff = $this->staffFor($venue);
        $token = $this->visits->getOrCreatePass((int) $member->id)['token'];

        $this->assertSame('recorded', $this->visits->recordVisit($token, (int) $staff->id)['status']);
        $repeat = $this->visits->recordVisit($token, (int) $staff->id);

        $this->assertSame('already_recorded_today', $repeat['status']);
        $this->assertSame(
            1,
            DB::table('partner_venue_visits')
                ->where('tenant_id', $this->testTenantId)
                ->where('venue_id', $venue->id)
                ->where('user_id', $member->id)
                ->count(),
            'The daily unique key must keep a rescan to a single row.'
        );
    }

    public function test_a_rescan_awards_no_further_xp(): void
    {
        $member = $this->member();
        $venue = $this->venue();
        $staff = $this->staffFor($venue);
        $token = $this->visits->getOrCreatePass((int) $member->id)['token'];

        $this->visits->recordVisit($token, (int) $staff->id);
        $xpAfterFirst = (int) DB::table('user_xp_log')
            ->where('user_id', $member->id)
            ->where('action', PartnerVenueVisitService::ENGAGEMENT_ACTION)
            ->count();

        $repeat = $this->visits->recordVisit($token, (int) $staff->id);

        $this->assertSame(0, $repeat['xp_awarded']);
        $this->assertSame(
            $xpAfterFirst,
            (int) DB::table('user_xp_log')
                ->where('user_id', $member->id)
                ->where('action', PartnerVenueVisitService::ENGAGEMENT_ACTION)
                ->count(),
            'A rescan must not write another XP log row.'
        );
    }

    // ── Tenant isolation ────────────────────────────────────────────────

    public function test_a_pass_from_another_tenant_is_not_recognised(): void
    {
        $otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Other Community',
            'slug' => 'other-community-' . uniqid(),
            'features' => json_encode(['partner_venues' => true]),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Mint a pass inside the other tenant.
        TenantContext::setById($otherTenantId);
        $foreignMember = User::factory()->forTenant($otherTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $foreignToken = $this->visits->getOrCreatePass((int) $foreignMember->id)['token'];

        // Back in our tenant, that token must resolve to nothing.
        TenantContext::setById($this->testTenantId);
        $venue = $this->venue();
        $staff = $this->staffFor($venue);

        $result = $this->visits->recordVisit($foreignToken, (int) $staff->id);

        $this->assertSame('invalid_pass', $result['status']);
        $this->assertDatabaseMissing('partner_venue_visits', ['user_id' => $foreignMember->id]);
    }

    // ── Engagement wiring ───────────────────────────────────────────────

    public function test_recording_a_visit_awards_xp_and_advances_challenge_progress(): void
    {
        $challengeId = $this->createVenueVisitChallenge(2);
        $member = $this->member();
        $venue = $this->venue();
        $staff = $this->staffFor($venue);
        $token = $this->visits->getOrCreatePass((int) $member->id)['token'];

        $result = $this->visits->recordVisit($token, (int) $staff->id);

        $this->assertGreaterThan(0, $result['xp_awarded'], 'A visit must award XP.');
        $this->assertDatabaseHas('user_xp_log', [
            'user_id' => $member->id,
            'action' => PartnerVenueVisitService::ENGAGEMENT_ACTION,
        ]);

        $this->assertSame(
            1,
            (int) DB::table('user_challenge_progress')
                ->where('user_id', $member->id)
                ->where('challenge_id', $challengeId)
                ->value('current_count'),
            'Challenge progress must advance — EngagementService is the only production caller of updateProgress().'
        );
        $this->assertSame([], $result['completed_challenges'], 'Target is 2; one visit must not complete it.');
    }

    public function test_reaching_the_target_reports_a_completed_challenge(): void
    {
        $challengeId = $this->createVenueVisitChallenge(1);
        $member = $this->member();
        $venue = $this->venue();
        $staff = $this->staffFor($venue);
        $token = $this->visits->getOrCreatePass((int) $member->id)['token'];

        $result = $this->visits->recordVisit($token, (int) $staff->id);

        $this->assertCount(1, $result['completed_challenges']);
        $this->assertSame($challengeId, $result['completed_challenges'][0]['id']);
        $this->assertNotNull(
            DB::table('user_challenge_progress')
                ->where('user_id', $member->id)
                ->where('challenge_id', $challengeId)
                ->value('completed_at'),
            'Completion is recorded but the reward stays unclaimed until the member claims it.'
        );
    }

    // ── Feature gate ────────────────────────────────────────────────────

    public function test_endpoints_403_when_the_feature_is_disabled(): void
    {
        $this->setPartnerVenuesFeature(false);

        $member = $this->member();
        $this->actingAs($member);

        $response = $this->apiGet('/v2/partner-venues');

        $this->assertSame(403, $response->getStatusCode());
    }

    public function test_member_can_fetch_their_pass_over_http(): void
    {
        $member = $this->member();
        $this->actingAs($member);

        $response = $this->apiGet('/v2/partner-venues/pass');

        $this->assertSame(200, $response->getStatusCode(), 'Pass endpoint must succeed before its payload is trusted.');
        $response->assertJsonPath('data.status', 'active');
        $this->assertSame(
            64,
            strlen((string) $response->json('data.token')),
            'The pass token must be the full 32-byte hex credential.'
        );
    }

    // ── Directory / reporting ───────────────────────────────────────────

    public function test_directory_shows_only_active_venues(): void
    {
        $active = $this->venue('Active Cafe');
        $this->venue('Paused Cafe', 'paused');
        $this->venue('Archived Cafe', 'archived');

        $ids = array_column($this->venues->directory(), 'id');

        $this->assertContains((int) $active->id, $ids);
        $this->assertCount(1, $ids);
    }

    public function test_summary_and_csv_rows_report_recorded_visits(): void
    {
        $member = $this->member();
        $venue = $this->venue();
        $staff = $this->staffFor($venue);
        $token = $this->visits->getOrCreatePass((int) $member->id)['token'];
        $this->visits->recordVisit($token, (int) $staff->id);

        $summary = $this->visits->summary();
        $this->assertSame(1, $summary['total_visits']);
        $this->assertSame(1, $summary['venues'][0]['unique_members']);

        $rows = $this->visits->visitRows();
        $this->assertCount(1, $rows);
        $this->assertSame((int) $member->id, $rows[0]['member_id']);
        $this->assertSame($venue->name, $rows[0]['venue_name']);
    }

    public function test_staff_roster_writes_the_typed_pivot(): void
    {
        $venue = $this->venue();
        $staff = $this->staffFor($venue, 'admin');

        $this->assertDatabaseHas('org_members', [
            'tenant_id' => $this->testTenantId,
            'org_type' => PartnerVenueService::ORG_TYPE,
            'organization_id' => $venue->id,
            'user_id' => $staff->id,
            'role' => 'admin',
            'status' => 'active',
        ]);

        // Re-adding must reactivate rather than duplicate.
        $this->venues->addStaff((int) $venue->id, (int) $staff->id, 'member');
        $this->assertSame(1, DB::table('org_members')
            ->where('org_type', PartnerVenueService::ORG_TYPE)
            ->where('organization_id', $venue->id)
            ->where('user_id', $staff->id)
            ->count());

        $this->assertTrue($this->venues->removeStaff((int) $venue->id, (int) $staff->id));
        $this->assertFalse($this->venues->isStaffOf((int) $venue->id, (int) $staff->id));
    }
}
