<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E088;

use App\Services\TenantBillingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-088 import/export sweep: the super-admin billing CSV wrote community and
 * plan names with only quote-doubling. A community's own admin sets its name,
 * so a name like =HYPERLINK(...) became a live formula on the platform
 * administrator's machine.
 */
final class BillingCsvFormulaTest extends TestCase
{
    use DatabaseTransactions;

    public function test_community_and_plan_names_are_formula_neutralised(): void
    {
        $tenantId = 98088;
        DB::table('tenants')->insertOrIgnore([
            'id' => $tenantId, 'name' => '=HYPERLINK("http://x","y")', 'slug' => 'e088-billing-' . $tenantId,
            'is_active' => 1, 'depth' => 1, 'allows_subtenants' => 0, 'parent_id' => 1,
            'path' => '/1/' . $tenantId . '/', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $planId = DB::table('pay_plans')->insertGetId([
            'name' => '+1+1 plan', 'slug' => 'e088-plan-' . uniqid(), 'price_monthly' => 1, 'price_yearly' => 10,
            'tier_level' => 1, 'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $tenantId, 'pay_plan_id' => $planId, 'status' => 'active', 'starts_at' => now(),
            'is_paused' => 0, 'nonprofit_verified' => 0, 'discount_percentage' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $line = collect(preg_split('/\r?\n/', TenantBillingService::exportCsv()) ?: [])
            ->first(static fn (string $l): bool => str_starts_with($l, $tenantId . ','));

        $this->assertNotNull($line, 'the community row is in the export');
        $cells = str_getcsv((string) $line);
        $this->assertSame('\'=HYPERLINK("http://x","y")', $cells[1]);
        $this->assertSame("'+1+1 plan", $cells[3]);
    }
}
