<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Commands;

use App\Models\Listing;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class SafeguardingCorrectiveAuditCommandsTest extends TestCase
{
    use DatabaseTransactions;

    public function test_inferred_jurisdiction_audit_is_dry_run_by_default(): void
    {
        [$optionId] = $this->seedInferredPresetState();

        $exit = Artisan::call('safeguarding:audit-inferred-jurisdictions', [
            '--tenant' => (string) $this->testTenantId,
        ]);

        $this->assertSame(0, $exit);
        $this->assertSame('england_wales', DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'onboarding.country_preset')
            ->value('setting_value'));
        $this->assertSame(1, (int) DB::table('tenant_safeguarding_options')
            ->where('id', $optionId)
            ->value('is_active'));
    }

    public function test_inferred_jurisdiction_apply_requires_scope_and_acknowledgement_then_preserves_live_protections_atomically(): void
    {
        [$optionId, $preferenceId] = $this->seedInferredPresetState();

        $withoutScope = Artisan::call('safeguarding:audit-inferred-jurisdictions', [
            '--apply' => true,
            '--acknowledge' => 'DEACTIVATE_INFERRED_PRESETS',
        ]);
        $this->assertSame(2, $withoutScope);

        $withoutAck = Artisan::call('safeguarding:audit-inferred-jurisdictions', [
            '--tenant' => (string) $this->testTenantId,
            '--apply' => true,
        ]);
        $this->assertSame(1, $withoutAck);

        $exit = Artisan::call('safeguarding:audit-inferred-jurisdictions', [
            '--tenant' => (string) $this->testTenantId,
            '--apply' => true,
            '--acknowledge' => 'DEACTIVATE_INFERRED_PRESETS',
        ]);

        $this->assertSame(0, $exit, Artisan::output());
        $this->assertSame('custom', DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'onboarding.country_preset')
            ->value('setting_value'));
        $this->assertSame(1, (int) DB::table('tenant_safeguarding_options')
            ->where('id', $optionId)
            ->value('is_active'));
        $this->assertNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('revoked_at'));
        $this->assertNotNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('policy_review_required_at'));
    }

    public function test_legacy_listing_flag_audit_is_dry_run_and_apply_is_explicitly_scoped(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create();
        DB::table('listing_risk_tags')->insert([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listing->id,
            'risk_level' => 'high',
            'risk_category' => 'safeguarding',
            'dbs_required' => 1,
            'tagged_by' => $admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertSame(0, Artisan::call('safeguarding:audit-listing-vetting-flags', [
            '--tenant' => (string) $this->testTenantId,
        ]));
        $this->assertSame(1, (int) DB::table('listing_risk_tags')
            ->where('listing_id', $listing->id)
            ->value('dbs_required'));

        $this->assertSame(2, Artisan::call('safeguarding:audit-listing-vetting-flags', [
            '--apply' => true,
            '--acknowledge' => 'CLEAR_UNSUPPORTED_ROLE_FLAGS',
        ]));

        // F-427: an --apply run now names its operator, so the change can be
        // recorded in gdpr_audit_log.
        $this->assertSame(2, Artisan::call('safeguarding:audit-listing-vetting-flags', [
            '--tenant' => (string) $this->testTenantId,
            '--apply' => true,
            '--acknowledge' => 'CLEAR_UNSUPPORTED_ROLE_FLAGS',
        ]));

        $this->assertSame(0, Artisan::call('safeguarding:audit-listing-vetting-flags', [
            '--tenant' => (string) $this->testTenantId,
            '--apply' => true,
            '--actor' => 'Corrective audit command test operator',
            '--acknowledge' => 'CLEAR_UNSUPPORTED_ROLE_FLAGS',
        ]), Artisan::output());
        $this->assertSame(0, (int) DB::table('listing_risk_tags')
            ->where('listing_id', $listing->id)
            ->value('dbs_required'));
    }

    /** @return array{int, int} */
    private function seedInferredPresetState(): array
    {
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        DB::table('tenant_safeguarding_settings')->where('tenant_id', $this->testTenantId)->delete();
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'onboarding.country_preset'],
            [
                'setting_value' => 'england_wales',
                'setting_type' => 'string',
                'updated_at' => now(),
                'created_at' => now(),
            ],
        );
        $optionId = (int) DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'test_inferred_preset_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'Test inferred preset',
            'sort_order' => 999,
            'is_active' => 1,
            'is_required' => 0,
            'triggers' => json_encode(['restricts_messaging' => true]),
            'preset_source' => 'england_wales',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $preferenceId = (int) DB::table('user_safeguarding_preferences')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$optionId, $preferenceId];
    }
}
