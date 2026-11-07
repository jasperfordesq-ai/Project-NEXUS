<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\RedisCache;
use App\Services\TranslationConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Owner decision, 7 Nov 2026: a community admin can switch on "Auto-translate
 * posts, listings and other content" (translation.auto_translate_content). It
 * is off by default. A member who never chose follows the community; a member
 * who chose differently from the community keeps their own choice.
 *
 * users.auto_translate_ugc alone cannot tell "never chose" from "chose off", so
 * users.auto_translate_ugc_chosen_at records an explicit choice. The effective
 * value is served as auto_translate_ugc, so no website or app changes.
 */
class MemberContentAutoTranslateTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER_TENANT_ID = 999;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    protected function tearDown(): void
    {
        Cache::flush();
        parent::tearDown();
    }

    private function member(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function communityContentAutoTranslate(bool $on): void
    {
        TranslationConfigurationService::set(TranslationConfigurationService::CONFIG_AUTO_TRANSLATE_CONTENT, $on);
    }

    private function effectiveFromPreferences(): bool
    {
        $value = $this->apiGet('/v2/users/me/preferences')
            ->assertOk()
            ->json('data.translation.auto_translate_ugc');
        $this->assertIsBool($value);

        return $value;
    }

    private function saveAutoTranslate(bool $value): \Illuminate\Testing\TestResponse
    {
        return $this->apiPut('/v2/users/me/preferences', [
            'translation' => ['auto_translate_ugc' => $value],
        ])->assertOk();
    }

    public function test_the_community_setting_is_off_by_default(): void
    {
        $this->assertFalse(TranslationConfigurationService::DEFAULTS[TranslationConfigurationService::CONFIG_AUTO_TRANSLATE_CONTENT]);
        $this->assertFalse(TranslationConfigurationService::publicSettingsForTenant($this->testTenantId)['auto_translate_content']);
    }

    public function test_community_off_and_member_never_chose_gives_off(): void
    {
        $this->member();

        $this->assertFalse($this->effectiveFromPreferences());
    }

    public function test_community_on_and_member_never_chose_gives_on(): void
    {
        $this->communityContentAutoTranslate(true);
        $this->member();

        $this->assertTrue($this->effectiveFromPreferences());
    }

    public function test_the_accessible_site_reads_the_effective_value_from_the_member_profile(): void
    {
        // web-uk's settings page reads auto_translate_ugc from GET /v2/users/me.
        // Showing it unticked while the community has it on would opt the member
        // out the next time they saved that form.
        $this->communityContentAutoTranslate(true);
        $this->member(['auto_translate_target_locale' => 'ga']);

        $this->apiGet('/v2/users/me')
            ->assertOk()
            ->assertJsonPath('data.auto_translate_ugc', true)
            ->assertJsonPath('data.auto_translate_target_locale', 'ga');
    }

    public function test_community_on_and_member_switches_it_off_stays_off(): void
    {
        $this->communityContentAutoTranslate(true);
        $user = $this->member();

        $this->saveAutoTranslate(false)->assertJsonPath('data.translation.auto_translate_ugc', false);

        $this->assertFalse($this->effectiveFromPreferences());
        $this->assertNotNull(DB::table('users')->where('id', $user->id)->value('auto_translate_ugc_chosen_at'));

        // Still off after the community setting is saved again.
        $this->communityContentAutoTranslate(true);
        $this->assertFalse($this->effectiveFromPreferences());
        $this->apiGet('/v2/users/me')->assertJsonPath('data.auto_translate_ugc', false);
    }

    public function test_a_member_who_saves_the_community_value_keeps_following_the_community(): void
    {
        $user = $this->member();

        // Community is off; the member saves "off" — the same as the community.
        $this->saveAutoTranslate(false);
        $this->assertNull(DB::table('users')->where('id', $user->id)->value('auto_translate_ugc_chosen_at'));

        // The admin then switches it on: the member follows.
        $this->communityContentAutoTranslate(true);
        $this->assertTrue($this->effectiveFromPreferences());
    }

    public function test_a_member_who_switches_it_on_against_the_community_keeps_it_on(): void
    {
        $user = $this->member();

        $this->saveAutoTranslate(true)->assertJsonPath('data.translation.auto_translate_ugc', true);

        $this->assertNotNull(DB::table('users')->where('id', $user->id)->value('auto_translate_ugc_chosen_at'));
        $this->assertTrue($this->effectiveFromPreferences());
    }

    public function test_saving_only_the_language_does_not_record_a_choice(): void
    {
        $this->communityContentAutoTranslate(true);
        $user = $this->member();

        $this->apiPut('/v2/users/me/preferences', [
            'translation' => ['auto_translate_target_locale' => 'fr'],
        ])->assertOk();

        $this->assertNull(DB::table('users')->where('id', $user->id)->value('auto_translate_ugc_chosen_at'));
        $this->assertTrue($this->effectiveFromPreferences());
    }

    public function test_a_backfilled_member_who_switched_it_on_stays_on_when_the_community_is_off(): void
    {
        $user = $this->member();
        DB::table('users')->where('id', $user->id)->update([
            'auto_translate_ugc' => 1,
            'auto_translate_ugc_chosen_at' => now()->subMonth(),
        ]);

        $this->assertTrue($this->effectiveFromPreferences());
        $this->apiGet('/v2/users/me')->assertJsonPath('data.auto_translate_ugc', true);
    }

    public function test_the_migration_marks_members_who_already_switched_it_on_as_having_chosen(): void
    {
        $on = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $off = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        DB::table('users')->where('id', $on->id)->update(['auto_translate_ugc' => 1, 'auto_translate_ugc_chosen_at' => null]);
        DB::table('users')->where('id', $off->id)->update(['auto_translate_ugc' => 0, 'auto_translate_ugc_chosen_at' => null]);

        $migration = require base_path('database/migrations/2026_11_07_130000_add_auto_translate_ugc_chosen_at_to_users.php');
        $migration->up();

        $this->assertNotNull(DB::table('users')->where('id', $on->id)->value('auto_translate_ugc_chosen_at'));
        $this->assertNull(DB::table('users')->where('id', $off->id)->value('auto_translate_ugc_chosen_at'));
    }

    public function test_another_communitys_setting_has_no_effect(): void
    {
        DB::table('tenants')->insertOrIgnore([
            'id' => self::OTHER_TENANT_ID, 'name' => 'Other', 'slug' => 'other',
            'is_active' => true, 'depth' => 0, 'allows_subtenants' => false,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => self::OTHER_TENANT_ID, 'setting_key' => TranslationConfigurationService::CONFIG_AUTO_TRANSLATE_CONTENT],
            ['setting_value' => 'true', 'setting_type' => 'boolean', 'updated_at' => now()],
        );
        Cache::flush();

        $this->assertTrue(TranslationConfigurationService::publicSettingsForTenant(self::OTHER_TENANT_ID)['auto_translate_content']);

        $this->member();
        $this->assertFalse($this->effectiveFromPreferences());
        $this->apiGet('/v2/users/me')->assertJsonPath('data.auto_translate_ugc', false);
    }

    public function test_an_admin_can_switch_the_community_setting_on_and_the_websites_are_told(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin, ['*']);

        $this->apiPut('/v2/admin/config/translation', [
            'key' => TranslationConfigurationService::CONFIG_AUTO_TRANSLATE_CONTENT,
            'value' => true,
        ])->assertOk()->assertJsonPath('data.value', true);

        $config = $this->apiGet('/v2/admin/config/translation')->assertOk()->json('data.config');
        $this->assertTrue($config[TranslationConfigurationService::CONFIG_AUTO_TRANSLATE_CONTENT]);

        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
        $this->apiGet('/v2/tenant/bootstrap?slug=' . $this->testTenantSlug)
            ->assertOk()
            ->assertJsonPath('data.translation.auto_translate_content', true)
            // The messages switch is a different setting and is untouched.
            ->assertJsonPath('data.translation.auto_translate_default', false);
    }
}
