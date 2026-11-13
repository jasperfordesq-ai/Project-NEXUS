<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Owner report, 13 Nov 2026: the Settings page drew "New members confirm their
 * email address" and "New members wait for approval" OFF while the
 * Registration policy page showed email verification ON.
 *
 * Cause: GET /v2/admin/settings returned the raw `general.` row, which is
 * absent on a community nobody has saved these for, and the page read "absent"
 * as off. The sign-up and sign-in gates (TenantSettingsService) read the bare
 * key as well and treat "nothing stored" as REQUIRED, which is what the
 * Registration policy page showed. The endpoint now reports what the gates
 * enforce.
 */
final class AdminSettingsSignupGatesShownAsEnforcedTest extends TestCase
{
    use DatabaseTransactions;

    private const GATE_KEYS = ['admin_approval', 'general.admin_approval', 'email_verification', 'general.email_verification'];

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('setting_key', self::GATE_KEYS)
            ->delete();
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create(), ['*']);
    }

    public function test_nothing_stored_is_shown_as_on_because_the_gates_enforce_it(): void
    {
        $tss = app(TenantSettingsService::class);
        $this->assertTrue($tss->requiresEmailVerification($this->testTenantId));
        $this->assertTrue($tss->requiresAdminApproval($this->testTenantId));

        $settings = $this->apiGet('/v2/admin/settings')->assertOk()->json('data.settings');

        $this->assertSame('true', $settings['email_verification']);
        $this->assertSame('true', $settings['admin_approval']);
    }

    public function test_a_bare_key_switched_off_is_shown_as_off_even_with_no_general_row(): void
    {
        // Written by a registration-policy save before both keys were kept in
        // step (E-073 F-458): the gate reads it, the old endpoint did not.
        $this->store('email_verification', 'false');
        $this->store('admin_approval', 'false');

        $settings = $this->apiGet('/v2/admin/settings')->assertOk()->json('data.settings');

        $this->assertSame('false', $settings['email_verification']);
        $this->assertSame('false', $settings['admin_approval']);
    }

    public function test_the_two_stored_keys_disagreeing_is_shown_as_the_gate_resolves_it(): void
    {
        // Either key saying "required" means required (fail closed).
        $this->store('email_verification', 'false');
        $this->store('general.email_verification', 'true');

        $settings = $this->apiGet('/v2/admin/settings')->assertOk()->json('data.settings');

        $this->assertTrue(app(TenantSettingsService::class)->requiresEmailVerification($this->testTenantId));
        $this->assertSame('true', $settings['email_verification']);
    }

    private function store(string $key, string $value): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
            ['setting_value' => $value, 'setting_type' => 'boolean'],
        );
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
    }
}
