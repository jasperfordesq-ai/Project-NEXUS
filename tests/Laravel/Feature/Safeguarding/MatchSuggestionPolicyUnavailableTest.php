<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Core\TenantContext;
use App\Models\Category;
use App\Models\Listing;
use App\Models\User;
use App\Services\SmartMatchingEngine;
use App\Services\SafeguardingJurisdictionService;
use App\Services\SafeguardingTriggerService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * What a member actually sees on their matches page when the community has NOT
 * configured a safeguarding jurisdiction.
 *
 * 🔴 Why this exists. Sentry issue 134069538 ("Safeguarding interaction policy
 * unavailable") began firing from a live member's page load —
 * `GET /api/v2/matches/all` — rather than an admin path, and nobody could say
 * what the member saw. Reading the code is not enough to answer that: the
 * matching engines call `evaluateLocalContact()` per candidate in BOTH
 * directions and drop the candidate when either side is not allowed, so a
 * pessimistic reading says "the whole page goes empty", which would be a
 * member-facing outage rather than a safeguarding control working.
 *
 * The answer, measured on 2026-08-28 against a 149-member local tenant with no
 * jurisdiction configured: the page came back FULL (50 of 50 requested). Only
 * members who require vetted interaction are withheld, because
 * `evaluateResolvedState()` returns `allowed()` before it ever consults
 * jurisdiction policy for anyone with no safeguarding trigger. That is the
 * intended fail-closed outcome — an unconfigured community must not be told who
 * its safeguarded members are — and admins are told separately by the scheduled
 * `safeguarding:check-policy-health` command, which alerts once with the fix.
 *
 * If someone later moves the jurisdiction lookup earlier, or makes the
 * unavailable decision apply to untriggered members, this test fails and the
 * matches page stops silently emptying itself in production instead.
 *
 * 🔴 Which code this exercises (corrected 17 Nov 2026). Until then these tests
 * called `MatchingService::getSuggestionsForUser()`, which was NOT what the
 * matches page runs: it returned random members for the (broken) match digest
 * and has been removed. They now drive `SmartMatchingEngine::findMatchesForUser()`,
 * the call behind `GET /api/v2/matches/all`, with real listings, so they prove
 * what the comment above always claimed to prove.
 */
class MatchSuggestionPolicyUnavailableTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        // The condition under test: NO usable contact gate for this tenant.
        // Deliberately removed rather than assumed absent, so the test states
        // its own precondition instead of inheriting a fixture's.
        DB::table('tenant_safeguarding_settings')
            ->where('tenant_id', $this->testTenantId)
            ->delete();
        app(SafeguardingJurisdictionService::class)->forget($this->testTenantId);

        TenantContext::setById($this->testTenantId);
    }

    public function test_unconfigured_jurisdiction_withholds_only_the_protected_member(): void
    {
        $category = $this->category();
        $viewer = $this->activeMember();
        $this->listing($viewer, 'offer', $category);
        $ordinary = $this->activeMember();
        $this->listing($ordinary, 'request', $category);
        $protected = $this->activeMember();
        $this->listing($protected, 'request', $category);

        $this->requireVettedInteraction($protected);

        $suggestedIds = $this->suggestedIdsFor($viewer);

        // The control, and the whole point of the test: an unconfigured
        // jurisdiction must NOT empty the page. Asserting only the protected
        // member's absence would pass just as happily on a blank page.
        self::assertContains(
            $ordinary->id,
            $suggestedIds,
            'An unconfigured safeguarding jurisdiction must not empty the matches page for ordinary members.',
        );

        self::assertNotContains(
            $protected->id,
            $suggestedIds,
            'A member who requires vetted interaction must be withheld while the contact gate is unusable.',
        );
    }

    public function test_a_protected_viewer_is_shielded_from_unvetted_members_too(): void
    {
        // The engine evaluates viewer->candidate AND candidate->viewer, and
        // drops the pair if either direction is refused. So a protected VIEWER
        // gets no unvetted suggestions either — the shield works both ways.
        $category = $this->category();
        $protectedViewer = $this->activeMember();
        $this->listing($protectedViewer, 'offer', $category);
        $ordinary = $this->activeMember();
        $this->listing($ordinary, 'request', $category);

        $this->requireVettedInteraction($protectedViewer);

        self::assertNotContains(
            $ordinary->id,
            $this->suggestedIdsFor($protectedViewer),
            'While the contact gate is unusable, a protected viewer must not be matched with unvetted members.',
        );
    }

    /**
     * The owners of the listings the matches page would show this member.
     *
     * @return list<int>
     */
    private function suggestedIdsFor(User $viewer): array
    {
        $matches = app(SmartMatchingEngine::class)->findMatchesForUser(
            $viewer->id,
            ['min_score' => 0, 'limit' => 50],
        );

        return array_values(array_map(
            static fn (array $match): int => (int) ($match['user_id'] ?? 0),
            $matches,
        ));
    }

    private function activeMember(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
            'latitude' => 51.5000,
            'longitude' => -0.1200,
            'last_active_at' => now(),
        ]);
    }

    private function category(): Category
    {
        return Category::factory()->create([
            'tenant_id' => $this->testTenantId,
            'type' => 'listing',
            'name' => 'Policy test ' . uniqid(),
        ]);
    }

    private function listing(User $owner, string $type, Category $category): Listing
    {
        return Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'type' => $type,
            'status' => 'active',
            'moderation_status' => 'approved',
            'category_id' => $category->id,
            'title' => 'Gardening help ' . uniqid(),
            'description' => 'Weeding, mowing and hedge trimming in the garden every week.',
            'latitude' => 51.5000,
            'longitude' => -0.1200,
            'service_type' => 'physical_only',
            'created_at' => now(),
        ]);
    }

    private function requireVettedInteraction(User $member): void
    {
        $optionId = (int) DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'match_protected_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'Protected match contact test',
            'description' => 'Protected match contact test',
            'sort_order' => 0,
            'is_active' => 1,
            'is_required' => 0,
            'triggers' => json_encode([
                'requires_vetted_interaction' => true,
                'vetting_type_required' => 'dbs_enhanced',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        SafeguardingTriggerService::invalidateCache($member->id, $this->testTenantId);
    }
}
