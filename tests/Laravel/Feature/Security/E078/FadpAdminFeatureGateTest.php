<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E078;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-530 (E-078): the Swiss FADP admin routes must follow the
 * `fadp_compliance` switch (off by default). Before the fix every admin
 * route checked only that the caller was an administrator.
 */
class FadpAdminFeatureGateTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array<string, array{string, string}> */
    public static function adminRoutes(): array
    {
        return [
            'retention config read'     => ['GET', '/v2/admin/fadp/retention-config'],
            'retention config write'    => ['PUT', '/v2/admin/fadp/retention-config'],
            'activities read'           => ['GET', '/v2/admin/fadp/processing-activities'],
            'activities write'          => ['POST', '/v2/admin/fadp/processing-activities'],
            'activity delete'           => ['DELETE', '/v2/admin/fadp/processing-activities/999999999'],
            'consent ledger export'     => ['GET', '/v2/admin/fadp/consent-ledger'],
            'processing register'       => ['GET', '/v2/admin/fadp/processing-register'],
            'processing register csv'   => ['GET', '/v2/admin/fadp/processing-register.csv'],
            'disclosure pack'           => ['GET', '/v2/admin/fadp/disclosure-pack'],
        ];
    }

    /** @dataProvider adminRoutes */
    public function test_admin_route_is_refused_when_fadp_compliance_is_off(string $method, string $uri): void
    {
        $this->setFadp(false);
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());

        $this->send($method, $uri)->assertStatus(403);
    }

    /** @dataProvider adminRoutes */
    public function test_control_admin_route_is_not_refused_when_fadp_compliance_is_on(string $method, string $uri): void
    {
        $this->setFadp(true);
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());

        $response = $this->send($method, $uri);

        $this->assertNotSame(403, $response->getStatusCode(), "{$method} {$uri} refused with the feature on");
        if ($method === 'GET') {
            $response->assertStatus(200);
        }
    }

    private function send(string $method, string $uri): \Illuminate\Testing\TestResponse
    {
        return match ($method) {
            'GET' => $this->apiGet($uri),
            'POST' => $this->apiPost($uri),
            'PUT' => $this->apiPut($uri),
            'DELETE' => $this->apiDelete($uri),
        };
    }

    private function setFadp(bool $enabled): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $current = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        $current['fadp_compliance'] = $enabled;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($current)]);
        TenantContext::setById($this->testTenantId);
    }
}
