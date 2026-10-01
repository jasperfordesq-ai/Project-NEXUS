<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-472 (E-075) — DELETE /v2/admin/sso/providers/{providerKey} must not report
 * a deletion it did not perform, and must not write one to the admin audit log.
 *
 * `AdminSsoProvidersController::destroy()` called the (correctly
 * community-scoped) `SsoOidcService::delete()`, threw away the fact that it had
 * removed nothing, answered `{"deleted": true}` and wrote an
 * `sso_provider_deleted` row to `org_audit_log` naming the supplied key. No
 * provider in another community was ever touched; the defect is the assurance
 * record and the API contract.
 *
 * Correct behaviour, asserted here: no rows deleted is a 404 with no audit row,
 * and the refusal must stay identical for a key that exists in another
 * community and one that exists nowhere, so this does not become an existence
 * oracle.
 *
 * Adapted from
 * `.local-docs-archive/security-log/E-075/repro/c/C5UnverifiedAdminDeleteReportsSuccessTest.php`,
 * which asserted the bad outcome.
 */
final class F472SsoProviderDeleteReportsWhatItDeletedTest extends TestCase
{
    use DatabaseTransactions;

    private const HOME = 2;    // victim community
    private const OTHER = 999; // caller's own community

    private function admin(int $tenant): User
    {
        return User::factory()->forTenant($tenant)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'admin',
        ]);
    }

    private function seedSsoProvider(int $tenantId, string $key): int
    {
        return (int) DB::table('tenant_sso_providers')->insertGetId([
            'tenant_id' => $tenantId,
            'provider_key' => $key,
            'display_name' => 'E076E Provider',
            'preset' => 'generic',
            'issuer_url' => 'https://issuer.example.invalid',
            'client_id' => 'e076e-client',
            'is_enabled' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function destroyAs(User $as, int $tenant, string $key): \Illuminate\Testing\TestResponse
    {
        Sanctum::actingAs($as, ['*']);
        $this->withTenant($tenant);

        return $this->deleteJson('/api/v2/admin/sso/providers/' . $key, [], [
            'X-Tenant-ID' => (string) $tenant,
            'Accept' => 'application/json',
        ]);
    }

    /**
     * CORRECT BEHAVIOUR — a provider key the caller's community does not have
     * is refused, no audit row is written, and the refusal is indistinguishable
     * from one for a key that exists nowhere.
     */
    public function test_a_provider_key_of_another_community_is_refused_and_not_audited(): void
    {
        $key = 'e076e-oidc';
        $this->withTenant(self::HOME);
        $providerId = $this->seedSsoProvider(self::HOME, $key);

        $stranger = $this->admin(self::OTHER);

        $auditBefore = DB::table('org_audit_log')
            ->where('action', 'sso_provider_deleted')
            ->where('tenant_id', self::OTHER)
            ->count();

        $attack = $this->destroyAs($stranger, self::OTHER, $key);
        $this->withTenant(self::OTHER);

        $attack->assertStatus(404);
        self::assertNull(
            $attack->json('data.deleted'),
            'nothing was deleted, so the response must not claim a deletion'
        );

        self::assertSame(
            1,
            DB::table('tenant_sso_providers')->where('id', $providerId)->count(),
            'the victim community keeps its provider'
        );

        self::assertSame(
            $auditBefore,
            DB::table('org_audit_log')
                ->where('action', 'sso_provider_deleted')
                ->where('tenant_id', self::OTHER)
                ->count(),
            'the administrative audit log must not record a deletion that did not happen'
        );

        // Not an existence oracle: a key that exists nowhere answers identically.
        $absent = $this->destroyAs($stranger, self::OTHER, 'e076e-does-not-exist');
        $this->withTenant(self::OTHER);
        $absent->assertStatus(404);
        self::assertSame(
            $attack->getContent(),
            $absent->getContent(),
            'a key held by another community and a key held by nobody must be indistinguishable'
        );
    }

    /**
     * CONTROL — the owning community's administrator's identical call still
     * really removes the provider and still writes exactly one audit row.
     */
    public function test_control_the_owning_administrator_still_really_deletes_the_provider(): void
    {
        $key = 'e076e-oidc';
        $this->withTenant(self::HOME);
        $this->seedSsoProvider(self::HOME, $key);
        $owner = $this->admin(self::HOME);

        $auditBefore = DB::table('org_audit_log')
            ->where('action', 'sso_provider_deleted')
            ->where('tenant_id', self::HOME)
            ->count();

        $control = $this->destroyAs($owner, self::HOME, $key);
        $this->withTenant(self::HOME);

        $control->assertStatus(200);
        self::assertTrue((bool) $control->json('data.deleted'));

        self::assertSame(
            0,
            DB::table('tenant_sso_providers')
                ->where('tenant_id', self::HOME)->where('provider_key', $key)->count(),
            'control: the owning administrator really removes the provider'
        );
        self::assertSame(
            $auditBefore + 1,
            DB::table('org_audit_log')
                ->where('action', 'sso_provider_deleted')
                ->where('tenant_id', self::HOME)
                ->count(),
            'control: exactly one audit row for one real deletion'
        );
    }
}
