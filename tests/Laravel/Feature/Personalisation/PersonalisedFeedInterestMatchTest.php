<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Personalisation;

use App\Models\User;
use App\Services\PersonalisedFeedService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The "interest match" signal of PersonalisedFeedService.
 *
 * user_skills.category_id points at skill_categories, while a listing's
 * category_id points at categories — two unrelated id spaces. The signal
 * used to compare those ids directly, so it matched only by coincidence of
 * numbers, and never at all for skills saved by the onboarding wizard
 * (category_id NULL). It now matches the member's skill names against the
 * listing's category name and skill tags.
 */
class PersonalisedFeedInterestMatchTest extends TestCase
{
    use DatabaseTransactions;

    private PersonalisedFeedService $service;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->service = new PersonalisedFeedService();
    }

    private function warmMember(): User
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        // Cross MIN_ENGAGEMENT_EVENTS so personalisation is active.
        for ($i = 1; $i <= PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS; $i++) {
            DB::table('likes')->insert([
                'tenant_id'   => $this->testTenantId,
                'user_id'     => $member->id,
                'target_type' => 'post',
                'target_id'   => 900_000 + $i,
                'created_at'  => now(),
            ]);
        }
        return $member;
    }

    private function category(string $name): int
    {
        return DB::table('categories')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'name'       => $name,
            'slug'       => 'pfs-' . strtolower($name) . '-' . uniqid(),
            'type'       => 'listing',
            'created_at' => now(),
        ]);
    }

    private function listing(int $authorId, string $title, ?int $categoryId, int $ageSeconds): int
    {
        return DB::table('listings')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $authorId,
            'title'       => $title,
            'type'        => 'offer',
            'status'      => 'active',
            'category_id' => $categoryId,
            'created_at'  => now()->subSeconds($ageSeconds),
            'updated_at'  => now()->subSeconds($ageSeconds),
        ]);
    }

    private function skill(int $userId, string $name, ?int $skillCategoryId = null): void
    {
        DB::table('user_skills')->insert([
            'tenant_id'    => $this->testTenantId,
            'user_id'      => $userId,
            'skill_name'   => $name,
            'category_id'  => $skillCategoryId,
            'is_offering'  => 1,
            'created_at'   => now(),
        ]);
    }

    /** Candidates in the shape ListingService hands to rank(). */
    private function candidates(array $listingIds): array
    {
        return DB::table('listings')
            ->whereIn('id', $listingIds)
            ->where('tenant_id', $this->testTenantId)
            ->get(['id', 'user_id', 'category_id', 'created_at'])
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    public function test_onboarding_skill_with_no_category_matches_listing_category_by_name(): void
    {
        $member = $this->warmMember();
        $author = User::factory()->forTenant($this->testTenantId)->create();

        $this->skill($member->id, 'Gardening'); // onboarding wizard: category_id NULL

        $gardening = $this->listing($author->id, 'Weekend help', $this->category('Gardening'), 3600);
        $plumbing  = $this->listing($author->id, 'Fix a tap', $this->category('Plumbing'), 60); // newer

        $ranked = $this->service->rank($member->id, 'listings', $this->candidates([$gardening, $plumbing]));

        $this->assertSame(
            $gardening,
            (int) $ranked[0]['id'],
            'a listing in the category named after the member\'s skill must outrank a slightly newer unrelated one'
        );
    }

    public function test_skill_matches_listing_skill_tag(): void
    {
        $member = $this->warmMember();
        $author = User::factory()->forTenant($this->testTenantId)->create();

        $this->skill($member->id, 'dog walking');

        $other   = $this->category('Other');
        $tagged  = $this->listing($author->id, 'Pet help', $other, 3600);
        $newer   = $this->listing($author->id, 'Something else', $other, 60);
        DB::table('listing_skill_tags')->insert([
            'tenant_id'  => $this->testTenantId,
            'listing_id' => $tagged,
            'tag'        => 'Dog Walking',
        ]);

        $ranked = $this->service->rank($member->id, 'listings', $this->candidates([$tagged, $newer]));

        $this->assertSame($tagged, (int) $ranked[0]['id']);
    }

    public function test_skill_category_id_colliding_with_listing_category_id_is_not_a_match(): void
    {
        $member = $this->warmMember();
        $author = User::factory()->forTenant($this->testTenantId)->create();

        // A listing category and a skill category that happen to share an id
        // but mean different things.
        $plumbingCat = $this->category('Plumbing');
        DB::table('skill_categories')->where('id', $plumbingCat)->delete();
        DB::table('skill_categories')->insert([
            'id'         => $plumbingCat,
            'tenant_id'  => $this->testTenantId,
            'name'       => 'Gardening skills',
            'slug'       => 'pfs-gardening-' . uniqid(),
            'created_at' => now(),
        ]);
        $this->skill($member->id, 'Gardening', $plumbingCat);

        $gardening = $this->listing($author->id, 'Weekend help', $this->category('Gardening'), 3600);
        $plumbing  = $this->listing($author->id, 'Fix a tap', $plumbingCat, 60); // newer

        $ranked = $this->service->rank($member->id, 'listings', $this->candidates([$gardening, $plumbing]));

        $this->assertSame(
            $gardening,
            (int) $ranked[0]['id'],
            'a shared numeric id between skill_categories and categories must not count as an interest match'
        );
    }

    public function test_listing_category_from_another_tenant_is_not_used(): void
    {
        $member = $this->warmMember();
        $author = User::factory()->forTenant($this->testTenantId)->create();

        $this->skill($member->id, 'Gardening');

        // A category row belonging to a different tenant, named after the skill.
        $foreignCat = DB::table('categories')->insertGetId([
            'tenant_id'  => 1,
            'name'       => 'Gardening',
            'slug'       => 'pfs-foreign-' . uniqid(),
            'type'       => 'listing',
            'created_at' => now(),
        ]);
        $foreign = $this->listing($author->id, 'Mislinked', $foreignCat, 3600);
        $newer   = $this->listing($author->id, 'Fix a tap', null, 60); // uncategorised, same neutral score

        $ranked = $this->service->rank($member->id, 'listings', $this->candidates([$foreign, $newer]));

        $this->assertSame($newer, (int) $ranked[0]['id']);
    }
}
