<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Gdpr;

use App\Core\TenantContext;
use App\Models\TenantSafeguardingOption;
use App\Models\User;
use App\Services\Enterprise\GdprService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Owner decision, 26 Oct 2026: erasing an account deletes the member's
 * safeguarding choices (for example "I consider myself a vulnerable adult").
 * They used to survive erasure. Vetting decisions are still held (F-339).
 */
class SafeguardingChoicesErasureTest extends TestCase
{
    use DatabaseTransactions;

    public function test_erasure_deletes_the_members_safeguarding_choices_only(): void
    {
        TenantContext::setById($this->testTenantId);
        $leaving = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $staying = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        TenantContext::setById($this->testTenantId);

        $option = TenantSafeguardingOption::create([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'erasure_test_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'Erasure test option',
            'sort_order' => 1,
            'is_active' => true,
            'triggers' => [],
        ]);
        foreach ([$leaving, $staying] as $member) {
            DB::table('user_safeguarding_preferences')->insert([
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
                'option_id' => $option->id,
                'selected_value' => '1',
                'notes' => 'Private note from the member',
                'consent_given_at' => now(),
                'created_at' => now(),
            ]);
        }

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $leaving->id);

        $this->assertSame(0, DB::table('user_safeguarding_preferences')->where('user_id', $leaving->id)->count());
        $this->assertSame(1, DB::table('user_safeguarding_preferences')->where('user_id', $staying->id)->count());
    }
}
