<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Services;

use App\Core\TenantContext;
use App\Services\CrossModuleMatchingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Match sources follow the community's switches (29 Oct 2026): a community
 * with groups switched off must not be offered group matches.
 */
final class CrossModuleMatchingEnabledModulesTest extends TestCase
{
    use DatabaseTransactions;

    private function setFeatures(array $changes): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $features = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode(array_merge($features, $changes))]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_switched_off_features_are_not_matched(): void
    {
        $this->setFeatures(['groups' => false, 'volunteering' => true, 'events' => false]);

        $modules = CrossModuleMatchingService::enabledModules(['listings', 'groups', 'volunteering', 'events']);

        $this->assertNotContains('groups', $modules);
        $this->assertNotContains('events', $modules);
        $this->assertContains('volunteering', $modules);
    }

    public function test_switched_on_features_are_kept(): void
    {
        $this->setFeatures(['groups' => true, 'events' => true]);

        $modules = CrossModuleMatchingService::enabledModules(['groups', 'events', 'unknown']);

        $this->assertSame(['groups', 'events'], $modules);
    }
}
