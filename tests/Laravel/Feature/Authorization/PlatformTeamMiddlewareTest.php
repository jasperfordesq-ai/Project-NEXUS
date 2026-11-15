<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Authorization;

use App\Support\Names\NameReason;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * The `platform-team` route middleware (E-128): the route-group form of
 * BaseApiController::requireGodPlatformAdmin(). Both ask
 * App\Support\Authorization\PlatformTeam.
 */
final class PlatformTeamMiddlewareTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const PROBE = '/v2/__platform-team-probe';

    protected function setUp(): void
    {
        parent::setUp();

        Route::middleware(['api', 'auth:sanctum', 'platform-team'])
            ->get('/api' . self::PROBE, fn (Request $request) => response()->json([
                'success' => true,
                // NameAudience::GRANT_ATTRIBUTE (private): what every staff gate sets.
                'staff_names' => $request->attributes->get('names.full_reason') === NameReason::ADMIN_ROUTE,
            ]));
    }

    public function test_only_the_platform_team_passes(): void
    {
        $this->assertPlatformTeamOnly('GET', self::PROBE);
    }

    public function test_a_signed_out_caller_is_asked_to_sign_in(): void
    {
        $this->apiGet(self::PROBE)->assertStatus(401);
    }

    public function test_the_refusal_has_the_api_error_shape(): void
    {
        $this->actAsCommunityAdmin();

        $this->apiGet(self::PROBE)
            ->assertStatus(403)
            ->assertJsonPath('success', false)
            ->assertJsonPath('errors.0.code', 'forbidden');
    }

    public function test_a_tenant_super_admin_with_is_god_is_refused(): void
    {
        $this->actAsTier(['is_god' => true, 'is_tenant_super_admin' => true, 'role' => 'admin']);

        $this->apiGet(self::PROBE)->assertStatus(403);
    }

    public function test_an_admitted_caller_sees_full_names_like_other_staff_gates(): void
    {
        $this->actAsPlatformTeam();

        $this->apiGet(self::PROBE)->assertOk()->assertJsonPath('staff_names', true);
    }
}
