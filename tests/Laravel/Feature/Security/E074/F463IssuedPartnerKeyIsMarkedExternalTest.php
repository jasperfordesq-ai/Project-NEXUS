<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E074;

use App\Core\FederationApiMiddleware;
use App\Core\SuperPanelAccess;
use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-463 — a key issued for an OUTSIDE organisation must be stored as an
 * external credential.
 *
 * `AdminFederationController::createApiKey()` is the only
 * `INSERT INTO federation_api_keys` in `app/`. It writes `tenant_id` (the
 * issuing community) and, since M3 (`c8bdbbf92`), the optional
 * `external_partner_id` binding that says "this key acts as this
 * `federation_external_partners` row". It did NOT write `platform_id`.
 *
 * Every read on the v1 partner API forks on
 * `$isExternal = !empty($auth['platform_id'])`
 * (`FederationController.php:376` and ten siblings), so every key the platform
 * could issue took the INTERNAL branch. For `members()` that is the wrong data
 * set entirely: the external arm serves the issuing community's own federated
 * members (`u.tenant_id = ?`), while the internal arm serves members of
 * PARTNERED communities through `federation_partnerships`
 * (`u.tenant_id != ?`). A key handed to an outside organisation therefore
 * returned other communities' members instead of the issuer's own.
 *
 * `platform_id` is a partner identifier, resolved elsewhere in the same
 * controller against `federation_external_partners.name`
 * (`sendMessage():718`, `getMessages():1391`). So a key bound to an external
 * partner must carry that partner's name, and the two columns must agree.
 *
 * SCOPE: this pins what NEW keys are written as. Keys already in the database
 * are a data question for the owner; nothing here migrates them.
 *
 * These tests assert the CORRECT behaviour and fail before the fix.
 *
 * Prerequisite for the read: the legacy v1 external-federation protocol
 * switched on (it ships disabled). The tests switch it on themselves.
 */
final class F463IssuedPartnerKeyIsMarkedExternalTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    private const PARTNER_TENANT_ID = 90871;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        $this->makeTenant(self::PARTNER_TENANT_ID, 'e074-f463-partner');
        SuperPanelAccess::reset();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        parent::tearDown();
    }

    /**
     * THE FIX — a key bound to an external partner record is stored as an
     * external credential, carrying that partner's identifier.
     */
    public function test_a_key_bound_to_an_external_partner_is_stored_as_an_external_credential(): void
    {
        $partnerName = 'E074 F463 Outside Organisation ' . bin2hex(random_bytes(3));
        $partnerId = $this->externalPartner($this->testTenantId, $partnerName);

        $apiKey = $this->mintKey(['members:read'], $partnerId);

        $stored = DB::table('federation_api_keys')
            ->where('key_hash', hash('sha256', $apiKey))
            ->first(['tenant_id', 'platform_id', 'external_partner_id']);

        self::assertNotNull($stored, 'the key row exists');
        self::assertSame(
            $partnerId,
            (int) $stored->external_partner_id,
            'precondition: the binding the admin route accepts was stored'
        );
        self::assertSame(
            $partnerName,
            (string) ($stored->platform_id ?? ''),
            'a key issued for an outside organisation must be marked external, '
            . 'carrying the identifier the controller resolves partners by'
        );
    }

    /**
     * THE HARM THE MIS-STORAGE CAUSED — the key reads the ISSUING community's
     * own federated members, not a partnered community's. Before the fix the
     * row set was exactly inverted.
     */
    public function test_a_partner_bound_key_reads_the_issuing_communitys_own_members(): void
    {
        $own = $this->federatedMember($this->testTenantId);
        $elsewhere = $this->federatedMember(self::PARTNER_TENANT_ID);
        $this->activePartnership($this->testTenantId, self::PARTNER_TENANT_ID);

        $partnerName = 'E074 F463 Reader ' . bin2hex(random_bytes(3));
        $apiKey = $this->mintKey(
            ['members:read'],
            $this->externalPartner($this->testTenantId, $partnerName)
        );

        $this->useKey($apiKey, 'GET', '/api/v1/federation/members');
        $response = $this->apiGet('/v1/federation/members?per_page=200', ['X-API-Key' => $apiKey]);
        self::assertSame(200, $response->status(), (string) $response->getContent());

        $ids = $this->idsIn($response->json('data') ?? []);
        self::assertContains(
            (int) $own->id,
            $ids,
            'the key serves the community that issued it. ' . (string) $response->getContent()
        );
        self::assertNotContains(
            (int) $elsewhere->id,
            $ids,
            'and NOT a different community\'s members, which the internal branch returned'
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — an unbound key (no external partner) is still
     * issued, still authenticates and still reads. Nothing here rests on key
     * creation or key authentication failing.
     */
    public function test_control_a_key_with_no_partner_binding_is_still_issued_and_still_authenticates(): void
    {
        $apiKey = $this->mintKey(['members:read'], null);
        self::assertNotSame('', $apiKey, 'control: a key was issued');

        $stored = DB::table('federation_api_keys')
            ->where('key_hash', hash('sha256', $apiKey))
            ->first(['platform_id', 'external_partner_id']);
        self::assertNotNull($stored);
        self::assertNull(
            $stored->external_partner_id,
            'control: an unbound key stays unbound'
        );
        self::assertNull(
            $stored->platform_id,
            'control: and is not promoted to an external credential by guesswork'
        );

        $this->useKey($apiKey, 'GET', '/api/v1/federation/members');
        $response = $this->apiGet('/v1/federation/members?per_page=1', ['X-API-Key' => $apiKey]);
        self::assertSame(
            200,
            $response->status(),
            'control: the issued key still authenticates. ' . (string) $response->getContent()
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — the tenant check on the binding still holds:
     * a partner record belonging to another community is still refused, so the
     * new write cannot be pointed at a partner the issuer does not own.
     */
    public function test_control_a_partner_record_from_another_community_is_still_refused(): void
    {
        $foreign = $this->externalPartner(self::PARTNER_TENANT_ID, 'E074 F463 Foreign Partner');

        $god = $this->god();
        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($god->id), ['*']);

        $created = $this->apiPost('/v2/admin/federation/api-keys', [
            'name' => 'E074 F463 foreign binding',
            'scopes' => ['members:read'],
            'external_partner_id' => $foreign,
        ]);
        $this->app['auth']->forgetGuards();

        self::assertSame(
            404,
            $created->getStatusCode(),
            'control: a partner in another community is still refused. ' . $created->getContent()
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @param array<int,string> $scopes */
    private function mintKey(array $scopes, ?int $externalPartnerId): string
    {
        $god = $this->god();
        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($god->id), ['*']);

        $payload = [
            'name' => 'E074 F463 key ' . bin2hex(random_bytes(3)),
            'scopes' => $scopes,
        ];
        if ($externalPartnerId !== null) {
            $payload['external_partner_id'] = $externalPartnerId;
        }

        $created = $this->apiPost('/v2/admin/federation/api-keys', $payload);
        self::assertSame(201, $created->getStatusCode(), 'the key was issued. ' . $created->getContent());

        $this->app['auth']->forgetGuards();

        return (string) $created->json('data.api_key');
    }

    private function externalPartner(int $tenantId, string $name): int
    {
        return (int) DB::table('federation_external_partners')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => $name,
            'base_url' => 'https://e074-f463-' . bin2hex(random_bytes(5)) . '.invalid',
            'api_path' => '/api/v1/federation',
            'protocol_type' => 'nexus',
            'status' => 'active',
            'allow_member_search' => 1,
            'allow_messaging' => 1,
            'allow_transactions' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * @param array<int,array<string,mixed>> $rows
     * @return array<int,int>
     */
    private function idsIn(array $rows): array
    {
        $ids = [];
        foreach ($rows as $row) {
            if (is_array($row) && isset($row['id'])) {
                $ids[] = (int) $row['id'];
            }
        }

        return $ids;
    }

    private function makeTenant(int $id, string $slug): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => $id],
            [
                'name' => 'E074 F463 ' . $slug,
                'slug' => $slug,
                'domain' => null,
                'is_active' => 1,
                'depth' => 0,
                'path' => '/' . $id . '/',
                'allows_subtenants' => 0,
                'max_depth' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    private function activePartnership(int $a, int $b): void
    {
        DB::table('federation_partnerships')->updateOrInsert(
            ['tenant_id' => $a, 'partner_tenant_id' => $b],
            [
                'status' => 'active',
                'federation_level' => 3,
                'profiles_enabled' => 1,
                'listings_enabled' => 1,
                'messaging_enabled' => 1,
                'transactions_enabled' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    private function federatedMember(int $tenantId): User
    {
        $user = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $user->id)->update(['tenant_id' => $tenantId]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'appear_in_federated_search' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'show_location_federated' => 0,
                'show_skills_federated' => 0,
                'show_reviews_federated' => 1,
                'updated_at' => now(),
            ],
        );

        return User::withoutGlobalScopes()->find($user->id);
    }

    private function god(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $u->id)->update([
            'tenant_id' => $this->testTenantId,
            'role' => 'admin',
            'is_admin' => 1,
            'is_super_admin' => 1,
            'is_god' => 1,
        ]);

        return User::withoutGlobalScopes()->find($u->id);
    }

    private function useKey(string $apiKey, string $method, string $uri): void
    {
        FederationApiMiddleware::reset();
        $_SERVER['HTTP_X_API_KEY'] = $apiKey;
        $_SERVER['REQUEST_METHOD'] = $method;
        $_SERVER['REQUEST_URI'] = $uri;
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    }
}
