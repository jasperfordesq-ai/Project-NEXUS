<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Models\TenantSafeguardingOption;
use App\Models\User;
use App\Models\UserSafeguardingPreference;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Lang;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class SafeguardingPresetLocalizationTest extends TestCase
{
    use DatabaseTransactions;

    public function test_admin_apis_localize_preset_metadata_and_option_copy_for_request_locale(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $keyed = $this->createPresetOption();
        $legacy = TenantSafeguardingOption::create([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'works_with_children',
            'option_type' => 'checkbox',
            'label' => Lang::get(
                'safeguarding.presets.common.options.works_with_children.label',
                [],
                'en',
                false,
            ),
            'description' => Lang::get(
                'safeguarding.presets.england_wales.options.works_with_children.description',
                [],
                'en',
                false,
            ),
            'sort_order' => 20,
            'is_active' => true,
            'is_required' => false,
            'triggers' => [],
            'preset_source' => 'england_wales',
        ]);
        $custom = TenantSafeguardingOption::create([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'broker_custom_wording',
            'option_type' => 'checkbox',
            'label' => 'Broker-authored safeguarding wording',
            'description' => 'safeguarding.presets.common.options.none_apply.description',
            'sort_order' => 30,
            'is_active' => true,
            'is_required' => false,
            'triggers' => [],
            'preset_source' => null,
        ]);
        $migratedDeclination = TenantSafeguardingOption::create([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'none_apply',
            'option_type' => 'checkbox',
            'label' => Lang::get(
                'safeguarding.presets.common.options.none_apply.label',
                [],
                'en',
                false,
            ),
            'description' => Lang::get(
                'safeguarding.presets.common.options.none_apply.description',
                [],
                'en',
                false,
            ),
            'sort_order' => 40,
            'is_active' => true,
            'is_required' => false,
            'triggers' => [],
            'preset_source' => 'migration_2026_05_02_seed_none_apply',
        ]);

        $options = $this->apiGet('/v2/admin/safeguarding/options?locale=ga');
        $options->assertOk()->assertHeader('Content-Language', 'ga');
        $byKey = collect($options->json('data'))->keyBy('option_key');

        $this->assertSame(
            Lang::get('safeguarding.presets.common.options.requires_vetted_partners.label', [], 'ga', false),
            $byKey[$keyed->option_key]['label'],
        );
        $this->assertSame(
            Lang::get('safeguarding.presets.common.options.works_with_children.label', [], 'ga', false),
            $byKey[$legacy->option_key]['label'],
        );
        $this->assertSame('Broker-authored safeguarding wording', $byKey[$custom->option_key]['label']);
        $this->assertSame(
            'safeguarding.presets.common.options.none_apply.description',
            $byKey[$custom->option_key]['description'],
        );
        $this->assertSame(
            Lang::get('safeguarding.presets.common.options.none_apply.label', [], 'ga', false),
            $byKey[$migratedDeclination->option_key]['label'],
        );

        $presets = $this->apiGet('/v2/admin/config/onboarding/presets?locale=ga');
        $presets->assertOk()->assertHeader('Content-Language', 'ga');
        $byPreset = collect($presets->json('data'))->keyBy('key');

        $this->assertSame(
            Lang::get('safeguarding.presets.england_wales.name', [], 'ga', false),
            $byPreset['england_wales']['name'],
        );
        $this->assertSame(
            Lang::get('safeguarding.presets.england_wales.vetting_authority', [], 'ga', false),
            $byPreset['england_wales']['vetting_authority'],
        );
    }

    public function test_admin_no_op_save_retains_translation_key_but_custom_edit_remains_literal(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $option = $this->createPresetOption();
        $translationKey = 'safeguarding.presets.common.options.requires_vetted_partners.label';

        $localizedLabel = Lang::get($translationKey, [], 'ga', false);
        $this->apiPut("/v2/admin/safeguarding/options/{$option->id}?locale=ga", [
            'label' => $localizedLabel,
        ])->assertOk();

        $this->assertSame(
            $translationKey,
            TenantSafeguardingOption::withoutGlobalScopes()->findOrFail($option->id)->getRawOriginal('label'),
        );

        $customLabel = 'Tenant-specific safeguarding wording';
        $this->apiPut("/v2/admin/safeguarding/options/{$option->id}?locale=ga", [
            'label' => $customLabel,
        ])->assertOk();

        $this->assertSame(
            $customLabel,
            TenantSafeguardingOption::withoutGlobalScopes()->findOrFail($option->id)->getRawOriginal('label'),
        );
    }

    public function test_member_api_returns_preset_copy_in_request_locale(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($member);
        $option = $this->createPresetOption();
        $this->createPreference((int) $member->id, (int) $option->id);

        $response = $this->apiGet('/v2/safeguarding/my-preferences?locale=ga');

        $response->assertOk()
            ->assertHeader('Content-Language', 'ga')
            ->assertJsonPath(
                'data.preferences.0.label',
                Lang::get('safeguarding.presets.common.options.requires_vetted_partners.label', [], 'ga', false),
            )
            ->assertJsonPath(
                'data.preferences.0.description',
                Lang::get(
                    'safeguarding.presets.england_wales.options.requires_vetted_partners.description',
                    [],
                    'ga',
                    false,
                ),
            );
    }

    // 🔴 `test_accessible_settings_returns_preset_copy_in_request_locale` was
    // removed on 2026-08-14 with the Blade accessible frontend. It fetched
    // `/{tenantSlug}/accessible/profile/settings?locale=ga` and asserted the
    // rendered page carried Irish preset labels and a `Content-Language: ga`
    // header. That route no longer exists, so the test could only fail.
    //
    // No coverage was lost. The property — safeguarding preset copy resolves in
    // the REQUEST's locale, not the server default — is already asserted one
    // method above in `test_member_api_returns_preset_copy_in_request_locale()`,
    // against `/api/v2/...`, which is the path web-uk actually reads. The Blade
    // test only added "and a Blade template printed it".

    private function createPresetOption(): TenantSafeguardingOption
    {
        return TenantSafeguardingOption::create([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'requires_vetted_partners',
            'option_type' => 'checkbox',
            'label' => 'safeguarding.presets.common.options.requires_vetted_partners.label',
            'description' => 'safeguarding.presets.england_wales.options.requires_vetted_partners.description',
            'sort_order' => 10,
            'is_active' => true,
            'is_required' => false,
            'triggers' => [
                'requires_vetted_interaction' => true,
            ],
            'preset_source' => 'england_wales',
        ]);
    }

    private function createPreference(int $userId, int $optionId): UserSafeguardingPreference
    {
        return UserSafeguardingPreference::create([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
        ]);
    }
}
