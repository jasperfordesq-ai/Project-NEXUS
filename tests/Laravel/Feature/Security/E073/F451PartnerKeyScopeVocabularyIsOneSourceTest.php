<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\FederationApiMiddleware;
use App\Models\User;
use App\Support\Federation\FederationScopes;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-451 (E-073, slice F finding F-6) — the partner-key scope vocabulary had
 * drifted from the scopes the federation routes actually enforce.
 *
 * `AdminFederationController::createApiKey()` is the only
 * `INSERT INTO federation_api_keys` in the repository, and its allow-list held
 * six scopes while eleven were enforced — by `FederationController::fedAuth()`
 * on the v1 partner routes and by
 * `FederationApiAuth::requiredPermissionsForRequest()` on the v2 protocol
 * routes. Six enforced scopes (`timebanks:read`, `listings:read`,
 * `messages:read`, `messages:write`, `reviews:read`, `reviews:write`) could not
 * be granted at all, so six documented partner routes were unusable with any
 * supported credential. Two lists, two files, no shared constant, no test.
 *
 * The fix makes `App\Support\Federation\FederationScopes` the single source of
 * truth, and this test is the thing that keeps it one: it reads the enforcement
 * sites' source and fails the moment a route enforces a scope the issuance
 * route cannot grant, or the issuance route offers one nothing enforces.
 *
 * The legitimate-access controls are that the privilege split survives — a
 * community super-admin is still refused a privileged scope — and that a valid
 * two-scope issue still produces a key that really works.
 */
final class F451PartnerKeyScopeVocabularyIsOneSourceTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    private const V1_ROUTES = 'app/Http/Controllers/Api/FederationController.php';
    private const V2_MIDDLEWARE = 'app/Http/Middleware/FederationApiAuth.php';

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY'], $_SERVER['HTTP_AUTHORIZATION']);
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    //  The anti-drift guard — the two lists can no longer diverge
    // ------------------------------------------------------------------

    public function test_every_scope_a_route_enforces_can_be_issued(): void
    {
        $enforced = $this->enforcedScopes();

        $this->assertNotEmpty($enforced, 'the source scan found no enforced scopes at all — the scan is broken');

        $unissuable = array_values(array_diff($enforced, FederationScopes::issuable()));

        $this->assertSame(
            [],
            $unissuable,
            'these scopes are enforced by a federation route but cannot be granted by the only '
            . 'key-issuance path, so the routes behind them are unusable: ' . implode(', ', $unissuable),
        );
    }

    public function test_every_issuable_scope_is_enforced_somewhere(): void
    {
        $enforced = $this->enforcedScopes();

        $unenforced = array_values(array_diff(FederationScopes::issuable(), $enforced));

        $this->assertSame(
            [],
            $unenforced,
            'these scopes can be granted on a partner key but no federation route checks them: '
            . implode(', ', $unenforced),
        );
    }

    public function test_the_six_previously_unissuable_scopes_are_now_issued(): void
    {
        Sanctum::actingAs($this->platformSuperAdmin(), ['*']);

        $previouslyUnissuable = [
            'timebanks:read',
            'listings:read',
            'messages:read',
            'messages:write',
            'reviews:read',
            'reviews:write',
        ];

        foreach ($previouslyUnissuable as $scope) {
            $response = $this->apiPost('/v2/admin/federation/api-keys', [
                'name' => 'E073 F451 ' . $scope,
                'scopes' => [$scope],
            ]);

            $this->assertSame(201, $response->status(), $scope . ': ' . $response->getContent());
        }

        $this->assertSame(
            count($previouslyUnissuable),
            (int) DB::table('federation_api_keys')->where('name', 'like', 'E073 F451 %')->count(),
        );
    }

    /**
     * The guard above is only worth anything if the issuance route really reads
     * the shared vocabulary rather than keeping a private copy of it.
     */
    public function test_the_issuance_route_has_no_private_copy_of_the_vocabulary(): void
    {
        $source = (string) file_get_contents(base_path('app/Http/Controllers/Api/AdminFederationController.php'));

        $this->assertStringContainsString(
            'FederationScopes::issuable()',
            $source,
            'createApiKey() must take its allow-list from the shared vocabulary',
        );
        $this->assertStringContainsString(
            'FederationScopes::privileged()',
            $source,
            'createApiKey() must take its privilege split from the shared vocabulary',
        );
        $this->assertDoesNotMatchRegularExpression(
            "/\\\$validScopes\s*=\s*\[/",
            $source,
            'a second, local scope list has reappeared — that is the drift this finding is about',
        );
    }

    public function test_an_unknown_scope_is_still_refused(): void
    {
        Sanctum::actingAs($this->platformSuperAdmin(), ['*']);

        $response = $this->apiPost('/v2/admin/federation/api-keys', [
            'name' => 'E073 F451 nonsense',
            'scopes' => ['wallet:drain'],
        ]);

        $this->assertSame(422, $response->status(), $response->getContent());
        $response->assertJsonPath('errors.0.code', 'INVALID_SCOPE');
        $this->assertDatabaseMissing('federation_api_keys', ['name' => 'E073 F451 nonsense']);
    }

    // ------------------------------------------------------------------
    //  LEGITIMATE-ACCESS CONTROLS
    // ------------------------------------------------------------------

    public function test_control_a_valid_two_scope_issue_produces_a_key_that_works(): void
    {
        Sanctum::actingAs($this->platformSuperAdmin(), ['*']);

        $response = $this->apiPost('/v2/admin/federation/api-keys', [
            'name' => 'E073 F451 legitimate',
            'scopes' => ['members:read', 'transactions:write'],
        ]);

        $this->assertSame(201, $response->status(), $response->getContent());
        $apiKey = (string) $response->json('data.api_key');
        $this->assertNotSame('', $apiKey);

        $this->federatedMember();

        FederationApiMiddleware::reset();
        $_SERVER['HTTP_X_API_KEY'] = $apiKey;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/api/v1/federation/members';
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';

        // The key authenticates and the `members:read` gate lets it through.
        // (`createApiKey()` never sets `platform_id`, so `members()` treats the
        // key as an INTERNAL credential and returns other communities' members
        // via `federation_partnerships`; the row set is therefore not asserted
        // here — the point is that the issued credential is accepted.)
        $read = $this->apiGet('/v1/federation/members?per_page=100', ['X-API-Key' => $apiKey]);

        $this->assertSame(200, $read->status(), $read->getContent());
        $this->assertTrue((bool) $read->json('success'), $read->getContent());
    }

    public function test_control_a_community_super_admin_cannot_self_mint_a_money_scope(): void
    {
        Sanctum::actingAs($this->tenantSuperAdmin(), ['*']);

        $response = $this->apiPost('/v2/admin/federation/api-keys', [
            'name' => 'E073 F451 self-mint',
            'scopes' => ['transactions:write'],
        ]);

        $this->assertSame(403, $response->status(), $response->getContent());
        $response->assertJsonPath('errors.0.code', 'FORBIDDEN_SCOPE');
        $this->assertDatabaseMissing('federation_api_keys', ['name' => 'E073 F451 self-mint']);
    }

    public function test_control_a_community_super_admin_cannot_self_mint_the_new_write_scopes(): void
    {
        Sanctum::actingAs($this->tenantSuperAdmin(), ['*']);

        foreach (['messages:write', 'reviews:write', 'messages:read'] as $scope) {
            $response = $this->apiPost('/v2/admin/federation/api-keys', [
                'name' => 'E073 F451 newmint ' . $scope,
                'scopes' => [$scope],
            ]);

            $this->assertSame(403, $response->status(), $scope . ': ' . $response->getContent());
            $response->assertJsonPath('errors.0.code', 'FORBIDDEN_SCOPE');
        }

        $this->assertSame(
            0,
            (int) DB::table('federation_api_keys')->where('name', 'like', 'E073 F451 newmint %')->count(),
        );
    }

    public function test_control_a_community_super_admin_can_still_issue_an_unprivileged_scope(): void
    {
        Sanctum::actingAs($this->tenantSuperAdmin(), ['*']);

        $response = $this->apiPost('/v2/admin/federation/api-keys', [
            'name' => 'E073 F451 community read key',
            'scopes' => ['members:read', 'listings:read'],
        ]);

        $this->assertSame(201, $response->status(), $response->getContent());
        $this->assertNotEmpty($response->json('data.api_key'));
    }

    // ------------------------------------------------------------------
    //  Source scan — the enforcement sites, read rather than transcribed
    // ------------------------------------------------------------------

    /**
     * @return array<int,string>
     */
    private function enforcedScopes(): array
    {
        $scopes = [];

        // v1 partner routes: FederationController::fedAuth('<scope>')
        $v1 = (string) file_get_contents(base_path(self::V1_ROUTES));
        preg_match_all("/fedAuth\(\s*'([^']+)'/", $v1, $matches);
        foreach ($matches[1] as $scope) {
            $scopes[] = $scope;
        }

        // v2 protocol routes: the permission arrays returned by
        // FederationApiAuth::requiredPermissionsForRequest(). Path literals in
        // the same method carry no colon and are not 'admin', so the shape
        // filter separates them cleanly.
        $v2 = (string) file_get_contents(base_path(self::V2_MIDDLEWARE));
        $start = strpos($v2, 'private function requiredPermissionsForRequest');
        $this->assertNotFalse($start, 'requiredPermissionsForRequest has been renamed — update this scan');
        $body = substr($v2, $start);
        preg_match_all("/'([^']+)'/", $body, $v2Matches);
        foreach ($v2Matches[1] as $literal) {
            if ($literal === 'admin' || preg_match('/^[a-z]+:[a-z*]+$/', $literal) === 1) {
                $scopes[] = $literal;
            }
        }

        sort($scopes);

        return array_values(array_unique($scopes));
    }

    // ------------------------------------------------------------------
    //  Fixtures
    // ------------------------------------------------------------------

    private function platformSuperAdmin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'admin',
            'is_admin' => 1,
            'is_super_admin' => 1,
        ]);
    }

    private function tenantSuperAdmin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'admin',
            'is_admin' => 1,
            'is_tenant_super_admin' => 1,
        ]);
    }

    private function federatedMember(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'appear_in_federated_search' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'show_reviews_federated' => 1,
                'updated_at' => now(),
            ],
        );

        return $user;
    }
}
