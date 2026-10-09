<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Events\OnboardingCompleted;
use App\Listeners\SendOnboardingCompletionEmail;
use App\Models\TenantSafeguardingOption;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\OnboardingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for OnboardingController — onboarding status, categories, completion.
 */
class OnboardingControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  GET /v2/onboarding/status
    // ------------------------------------------------------------------

    public function test_status_requires_auth(): void
    {
        $response = $this->apiGet('/v2/onboarding/status');

        $response->assertStatus(401);
    }

    public function test_status_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/onboarding/status');

        $response->assertStatus(200);
    }

    /**
     * @return array<string, array{0: ?string, 1: bool}>
     */
    public static function hasLocationProvider(): array
    {
        return [
            'null'        => [null, false],
            'empty'       => ['', false],
            'spaces only' => ['   ', false],
            'a town'      => ['Cork', true],
        ];
    }

    /**
     * @dataProvider hasLocationProvider
     */
    public function test_status_reports_whether_the_member_has_a_location(?string $location, bool $expected): void
    {
        $user = $this->authenticatedUser();
        DB::table('users')->where('id', $user->id)->update(['location' => $location]);

        $this->apiGet('/v2/onboarding/status')
            ->assertStatus(200)
            ->assertJsonPath('data.has_location', $expected);
    }

    // ------------------------------------------------------------------
    //  GET /v2/onboarding/categories
    // ------------------------------------------------------------------

    public function test_categories_requires_auth(): void
    {
        $response = $this->apiGet('/v2/onboarding/categories');

        $response->assertStatus(401);
    }

    public function test_categories_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/onboarding/categories');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /v2/onboarding/complete
    // ------------------------------------------------------------------

    public function test_complete_requires_auth(): void
    {
        $response = $this->apiPost('/v2/onboarding/complete');

        $response->assertStatus(401);
    }

    public function test_complete_marks_onboarding_done(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'avatar_url' => 'https://example.com/photo.jpg',
            'bio' => 'A valid bio that is long enough to pass validation.',
            'onboarding_completed' => false,
        ]);
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPost('/v2/onboarding/complete', [
            'interests' => [],
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
    }

    /**
     * Location is asked for firmly by the clients but never forced by the
     * server: older phone-app versions and the accessible site must still be
     * able to finish onboarding. Owner decision, 9 Oct 2026.
     */
    public function test_complete_succeeds_for_a_member_with_an_avatar_and_bio_but_no_location(): void
    {
        $user = $this->readyToCompleteUser();
        DB::table('users')->where('id', $user->id)->update(['location' => null]);

        $this->apiPost('/v2/onboarding/complete', ['interests' => []])
            ->assertStatus(200);

        $this->assertSame(1, (int) DB::table('users')->where('id', $user->id)->value('onboarding_completed'));
        $this->assertNull(DB::table('users')->where('id', $user->id)->value('location'));
    }

    public function test_complete_onboarding_dispatches_completion_event_once(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => false,
        ]);

        Event::fake([OnboardingCompleted::class]);

        $this->assertTrue(OnboardingService::completeOnboarding($user->id));
        $this->assertFalse(OnboardingService::completeOnboarding($user->id));

        Event::assertDispatchedTimes(OnboardingCompleted::class, 1);
    }

    public function test_completion_email_listener_skips_when_successful_email_log_exists(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email' => 'already-onboarded@example.com',
            'onboarding_completed' => true,
        ]);

        DB::table('email_log')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'recipient_email' => $user->email,
            'category' => 'onboarding_completed',
            'subject' => 'Onboarding complete',
            'provider' => 'smtp',
            'status' => 'sent',
            'sent_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $mailer = new class extends EmailDispatchService {
            public int $calls = 0;

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls++;

                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $mailer);

        (new SendOnboardingCompletionEmail())->handle(new OnboardingCompleted($user->id, $this->testTenantId));

        $this->assertSame(0, $mailer->calls);
    }

    public function test_complete_rejects_unauthenticated(): void
    {
        // No Sanctum::actingAs — request is unauthenticated
        $response = $this->apiPost('/v2/onboarding/complete', [
            'interests' => [1, 2],
        ]);

        $response->assertStatus(401);
    }

    private function readyToCompleteUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'avatar_url' => 'https://example.com/photo.jpg',
            'bio' => 'A valid bio that is long enough to pass validation.',
            'onboarding_completed' => false,
        ]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function giveSkill(int $userId, string $name, bool $offering, bool $requesting, string $level = 'intermediate'): void
    {
        DB::table('user_skills')->insert([
            'user_id' => $userId,
            'tenant_id' => $this->testTenantId,
            'skill_name' => $name,
            'proficiency' => $level,
            'is_offering' => (int) $offering,
            'is_requesting' => (int) $requesting,
        ]);
    }

    /** @return array<string, array{offering: bool, requesting: bool}> */
    private function savedSkills(int $userId): array
    {
        $out = [];
        foreach (DB::table('user_skills')->where('tenant_id', $this->testTenantId)->where('user_id', $userId)->get() as $row) {
            $out[$row->skill_name] = ['offering' => (bool) $row->is_offering, 'requesting' => (bool) $row->is_requesting];
        }
        ksort($out);

        return $out;
    }

    public function test_complete_saves_wizard_skills_into_user_skills(): void
    {
        $user = $this->readyToCompleteUser();

        $response = $this->apiPost('/v2/onboarding/complete', [
            'skills' => [
                'offer' => ['Gardening', '  Dog walking  ', 'gardening', '', '<b>Baking</b>'],
                'need'  => ['Computer help', 'Gardening'],
            ],
        ]);

        $response->assertStatus(200);
        $this->assertSame([
            'Baking'        => ['offering' => true,  'requesting' => false],
            'Computer help' => ['offering' => false, 'requesting' => true],
            'Dog walking'   => ['offering' => true,  'requesting' => false],
            'Gardening'     => ['offering' => true,  'requesting' => true],
        ], $this->savedSkills($user->id));

        // Nothing goes to the retired store any more.
        $this->assertSame(0, DB::table('user_interests')->where('user_id', $user->id)->count());
    }

    public function test_complete_skills_lists_replace_the_members_existing_flags(): void
    {
        $user = $this->readyToCompleteUser();
        $this->giveSkill($user->id, 'Cooking', true, false, 'expert');
        $this->giveSkill($user->id, 'Painting', true, true, 'beginner');

        // The member kept Cooking (typed in a different case), unticked
        // Painting as an offer but still wants help with it, and added Sewing.
        $this->apiPost('/v2/onboarding/complete', [
            'skills' => ['offer' => ['cooking', 'Sewing'], 'need' => ['Painting']],
        ])->assertStatus(200);

        $this->assertSame([
            'Cooking'  => ['offering' => true,  'requesting' => false],
            'Painting' => ['offering' => false, 'requesting' => true],
            'Sewing'   => ['offering' => true,  'requesting' => false],
        ], $this->savedSkills($user->id));
        // The existing row was updated, not replaced: its level survives.
        $this->assertSame('expert', DB::table('user_skills')->where('user_id', $user->id)->where('skill_name', 'Cooking')->value('proficiency'));
    }

    public function test_complete_removes_a_skill_the_member_unticked_in_both_lists(): void
    {
        $user = $this->readyToCompleteUser();
        $this->giveSkill($user->id, 'Cooking', true, false);

        $this->apiPost('/v2/onboarding/complete', ['skills' => ['offer' => [], 'need' => []]])->assertStatus(200);

        $this->assertSame([], $this->savedSkills($user->id));
    }

    public function test_complete_with_replace_false_only_adds(): void
    {
        // The wizard sends replace=false when it could not load the member's
        // existing skills — their earlier skills must survive.
        $user = $this->readyToCompleteUser();
        $this->giveSkill($user->id, 'Cooking', true, false);

        $this->apiPost('/v2/onboarding/complete', [
            'skills' => ['offer' => ['Sewing'], 'need' => [], 'replace' => false],
        ])->assertStatus(200);

        $this->assertSame([
            'Cooking' => ['offering' => true, 'requesting' => false],
            'Sewing'  => ['offering' => true, 'requesting' => false],
        ], $this->savedSkills($user->id));
    }

    public function test_complete_without_skills_leaves_existing_skills_alone(): void
    {
        // "Skip for now" sends no skills at all — it must not wipe anything.
        $user = $this->readyToCompleteUser();
        $this->giveSkill($user->id, 'Cooking', true, false);

        $this->apiPost('/v2/onboarding/complete', [])->assertStatus(200);

        $this->assertSame(['Cooking' => ['offering' => true, 'requesting' => false]], $this->savedSkills($user->id));
    }

    public function test_complete_rejects_over_long_skill_names_and_caps_the_count(): void
    {
        $user = $this->readyToCompleteUser();
        $many = array_map(fn ($i) => "Skill {$i}", range(1, 40));

        $this->apiPost('/v2/onboarding/complete', [
            'skills' => ['offer' => array_merge([str_repeat('x', 101)], $many), 'need' => 'not-a-list'],
        ])->assertStatus(200);

        $saved = $this->savedSkills($user->id);
        $this->assertCount(OnboardingService::SKILLS_PER_DIRECTION_MAX, $saved);
        $this->assertArrayNotHasKey(str_repeat('x', 101), $saved);
    }

    public function test_complete_from_older_app_maps_listing_categories_to_skills(): void
    {
        // App versions still on the store send listing-category ids as
        // offers/needs. Those become skills named after the category; a
        // category from another community is ignored; nothing is cleared;
        // interests are accepted but not stored; no listing is created.
        $user = $this->readyToCompleteUser();
        $this->giveSkill($user->id, 'Cooking', true, false);

        DB::insert(
            "INSERT INTO categories (tenant_id, name, slug, created_at) VALUES (?, ?, ?, NOW())",
            [999, 'Cross-Tenant Category', 'cross-tenant-cat-' . uniqid()]
        );
        $otherCatId = (int) DB::getPdo()->lastInsertId();
        DB::insert(
            "INSERT INTO categories (tenant_id, name, slug, created_at) VALUES (?, ?, ?, NOW())",
            [$this->testTenantId, 'Home Repairs', 'home-repairs-' . uniqid()]
        );
        $validCatId = (int) DB::getPdo()->lastInsertId();

        $this->apiPost('/v2/onboarding/complete', [
            'interests' => [$validCatId],
            'offers' => [$otherCatId, $validCatId],
            'needs' => [$validCatId],
        ])->assertStatus(200);

        $this->assertSame([
            'Cooking'      => ['offering' => true, 'requesting' => false],
            'Home Repairs' => ['offering' => true, 'requesting' => true],
        ], $this->savedSkills($user->id));
        $this->assertSame(0, DB::table('user_interests')->where('user_id', $user->id)->count());
        $this->assertSame(0, DB::table('listings')->where('user_id', $user->id)->count());
    }

    public function test_config_no_longer_offers_an_interests_step(): void
    {
        $this->authenticatedUser();

        $slugs = array_column($this->apiGet('/v2/onboarding/config')->assertStatus(200)->json('data.steps'), 'slug');

        $this->assertNotContains('interests', $slugs);
        $this->assertContains('skills', $slugs);
    }

    public function test_complete_validates_avatar_required(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'avatar_url' => null,
            'bio' => 'A valid bio that is long enough to pass validation.',
            'onboarding_completed' => false,
        ]);

        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPost('/v2/onboarding/complete', [
            'interests' => [1],
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.code', 'VALIDATION_REQUIRED_FIELD');
    }

    public function test_complete_validates_bio_required(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'avatar_url' => 'https://example.com/photo.jpg',
            'bio' => null,
            'onboarding_completed' => false,
        ]);

        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPost('/v2/onboarding/complete', [
            'interests' => [1],
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.code', 'VALIDATION_REQUIRED_FIELD');
    }

    public function test_save_safeguarding_enforces_required_options_server_side(): void
    {
        $this->authenticatedUser();

        TenantSafeguardingOption::create([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'required_support_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'Required support option',
            'sort_order' => 10,
            'is_active' => true,
            'is_required' => true,
            'triggers' => [],
        ]);

        $optional = TenantSafeguardingOption::create([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'optional_support_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'Optional support option',
            'sort_order' => 20,
            'is_active' => true,
            'is_required' => false,
            'triggers' => [],
        ]);

        $response = $this->apiPost('/v2/onboarding/safeguarding', [
            'preferences' => [
                ['option_id' => $optional->id, 'value' => '1'],
            ],
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
        $response->assertJsonPath('errors.0.field', 'preferences');
    }
}
