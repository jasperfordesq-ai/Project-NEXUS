<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\FederationApiMiddleware;
use App\Core\SuperPanelAccess;
use App\Core\TenantContext;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-483 (E-075 G-1) — the v1 partner API must never publish, address or credit
 * an account that is not `active`.
 *
 * Four reads on `FederationController` fork on
 * `$isExternal = !empty($auth['platform_id'])` and carry `u.status = 'active'`
 * on the EXTERNAL arm only:
 *
 *   members()                      :388 external has it, :394 internal did not
 *   member($id)                    :462 external has it, :476 internal did not
 *   sendMessage() recipient        :636 external has it, :640 internal did not
 *   createTransaction() recipient  :838 external has it, :841 internal did not
 *
 * So the federated directory published the username, display name, bio, avatar,
 * join date and federation preferences of members whose accounts are `banned`,
 * `suspended`, `rejected` (a registration an administrator REFUSED) or
 * `pending` (never verified their email) — 100 at a time, so the whole barred
 * set was enumerable, and the single-profile route returned a named account by
 * id. Every other federated surface excludes them on the same data
 * (`FederationV2Controller` members :1659, `FederationSearchService`:95,
 * `FederationKomunitinController`:1362, `FederationCreditCommonsController`
 * :1426).
 *
 * These tests assert the CORRECT behaviour on the INTERNAL arm and fail before
 * the fix. Each pair of fixtures differs ONLY in `users.status`.
 *
 * Prerequisite: the legacy v1 external-federation protocol switched on (it
 * ships disabled). The tests switch it on themselves.
 */
final class F483FederatedPartnerApiExcludesNonActiveMembersTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    private const PARTNER_TENANT_ID = 90875;

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
        $this->makeTenant(self::PARTNER_TENANT_ID, 'e075-f483-partner');
        $this->activePartnership($this->testTenantId, self::PARTNER_TENANT_ID);
        SuperPanelAccess::reset();
        $this->enableExternalFederation();
        $this->allowSafeguarding();
        FederationApiMiddleware::reset();
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        parent::tearDown();
    }

    /**
     * THE FIX, members() — barred, suspended, refused and unverified accounts
     * are not published in the federated directory.
     *
     * LEGITIMATE-ACCESS CONTROL, same test: the active member on identical
     * fixtures is still served. The rows differ only in `users.status`.
     */
    public function test_the_federated_directory_excludes_accounts_that_are_not_active(): void
    {
        $active = $this->federatedMember(self::PARTNER_TENANT_ID, 'active');
        $banned = $this->federatedMember(self::PARTNER_TENANT_ID, 'banned');
        $suspended = $this->federatedMember(self::PARTNER_TENANT_ID, 'suspended');
        $rejected = $this->federatedMember(self::PARTNER_TENANT_ID, 'rejected');

        $apiKey = $this->mintKey(['members:read']);
        $this->useKey($apiKey, 'GET', '/api/v1/federation/members');
        $response = $this->apiGet('/v1/federation/members?per_page=100', ['X-API-Key' => $apiKey]);
        self::assertSame(200, $response->status(), (string) $response->getContent());

        $ids = $this->idsIn($response->json('data') ?? []);

        self::assertContains(
            (int) $active->id,
            $ids,
            'CONTROL: an active federated member is still published. ' . (string) $response->getContent()
        );
        self::assertNotContains((int) $banned->id, $ids, 'a banned account must not be published');
        self::assertNotContains((int) $suspended->id, $ids, 'nor a suspended account');
        self::assertNotContains((int) $rejected->id, $ids, 'nor a registration an administrator refused');
    }

    /**
     * THE FIX, member($id) — the single-profile route must not return a barred
     * account by id, and must still return an active one.
     */
    public function test_the_profile_route_refuses_an_account_that_is_not_active(): void
    {
        $active = $this->federatedMember(self::PARTNER_TENANT_ID, 'active');
        $banned = $this->federatedMember(self::PARTNER_TENANT_ID, 'banned');

        $apiKey = $this->mintKey(['members:read']);

        $this->useKey($apiKey, 'GET', '/api/v1/federation/members/' . $banned->id);
        $barred = $this->apiGet('/v1/federation/members/' . $banned->id, ['X-API-Key' => $apiKey]);
        self::assertSame(404, $barred->status(), (string) $barred->getContent());
        $barred->assertJsonPath('code', 'MEMBER_NOT_FOUND');

        $this->useKey($apiKey, 'GET', '/api/v1/federation/members/' . $active->id);
        $ok = $this->apiGet('/v1/federation/members/' . $active->id, ['X-API-Key' => $apiKey]);
        self::assertSame(
            200,
            $ok->status(),
            'CONTROL: the active member\'s profile is still served. ' . (string) $ok->getContent()
        );
        self::assertSame((int) $active->id, (int) $ok->json('data.id'));
    }

    /**
     * THE FIX, sendMessage() — a barred account may not be addressed.
     *
     * LEGITIMATE-ACCESS CONTROL, same test: the identical message to the active
     * member is still delivered (201).
     */
    public function test_a_message_cannot_be_addressed_to_an_account_that_is_not_active(): void
    {
        $sender = $this->federatedMember($this->testTenantId, 'active');
        $active = $this->federatedMember(self::PARTNER_TENANT_ID, 'active');
        $banned = $this->federatedMember(self::PARTNER_TENANT_ID, 'banned');

        $apiKey = $this->mintKey(['messages:write']);

        $this->useKey($apiKey, 'POST', '/api/v1/federation/messages');
        $refused = $this->apiPost('/v1/federation/messages', [
            'sender_id' => (int) $sender->id,
            'recipient_id' => (int) $banned->id,
            'subject' => 'F483 subject',
            'body' => 'F483 body',
        ], ['X-API-Key' => $apiKey]);
        self::assertSame(404, $refused->status(), (string) $refused->getContent());
        $refused->assertJsonPath('code', 'RECIPIENT_NOT_FOUND');

        $this->useKey($apiKey, 'POST', '/api/v1/federation/messages');
        $delivered = $this->apiPost('/v1/federation/messages', [
            'sender_id' => (int) $sender->id,
            'recipient_id' => (int) $active->id,
            'subject' => 'F483 subject',
            'body' => 'F483 body',
        ], ['X-API-Key' => $apiKey]);
        self::assertSame(
            201,
            $delivered->status(),
            'CONTROL: the identical message to the active member is still delivered. '
            . (string) $delivered->getContent()
        );
    }

    /**
     * THE FIX, createTransaction() — a barred account may not be credited.
     *
     * LEGITIMATE-ACCESS CONTROL, same test: the identical transfer to the
     * active member still completes (201).
     */
    public function test_a_transaction_cannot_be_addressed_to_an_account_that_is_not_active(): void
    {
        $sender = $this->federatedMember($this->testTenantId, 'active');
        DB::table('users')->where('id', $sender->id)->update(['balance' => 50]);
        $active = $this->federatedMember(self::PARTNER_TENANT_ID, 'active');
        $banned = $this->federatedMember(self::PARTNER_TENANT_ID, 'banned');
        $this->activeCreditAgreement($this->testTenantId, self::PARTNER_TENANT_ID);

        $apiKey = $this->mintKey(['transactions:write']);

        $this->useKey($apiKey, 'POST', '/api/v1/federation/transactions');
        $refused = $this->apiPost('/v1/federation/transactions', [
            'sender_id' => (int) $sender->id,
            'recipient_id' => (int) $banned->id,
            'amount' => 1,
            'description' => 'F483 refused transfer',
        ], ['X-API-Key' => $apiKey]);
        self::assertSame(404, $refused->status(), (string) $refused->getContent());
        $refused->assertJsonPath('code', 'RECIPIENT_NOT_FOUND');

        self::assertSame(
            0,
            DB::table('transactions')->where('receiver_id', (int) $banned->id)->count(),
            'and nothing is recorded against the barred account'
        );

        $this->useKey($apiKey, 'POST', '/api/v1/federation/transactions');
        $accepted = $this->apiPost('/v1/federation/transactions', [
            'sender_id' => (int) $sender->id,
            'recipient_id' => (int) $active->id,
            'amount' => 1,
            'description' => 'F483 accepted transfer',
        ], ['X-API-Key' => $apiKey]);
        self::assertSame(
            201,
            $accepted->status(),
            'CONTROL: the identical transfer to the active member still works. '
            . (string) $accepted->getContent()
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @param array<int,string> $scopes */
    private function mintKey(array $scopes): string
    {
        $god = $this->god();
        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($god->id), ['*']);

        $created = $this->apiPost('/v2/admin/federation/api-keys', [
            'name' => 'E075 F483 key ' . bin2hex(random_bytes(3)),
            'scopes' => $scopes,
        ]);
        self::assertSame(201, $created->getStatusCode(), 'the key was issued. ' . $created->getContent());

        $this->app['auth']->forgetGuards();

        return (string) $created->json('data.api_key');
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
                'name' => 'E075 F483 ' . $slug,
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

    private function activeCreditAgreement(int $from, int $to): void
    {
        DB::table('federation_credit_agreements')->insert([
            'from_tenant_id' => $from,
            'to_tenant_id' => $to,
            'exchange_rate' => 1,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function federatedMember(int $tenantId, string $status): User
    {
        $user = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $user->id)->update([
            'tenant_id' => $tenantId,
            'status' => $status,
            'bio' => 'E075 F483 ' . $status . ' member bio',
        ]);

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

    private function allowSafeguarding(): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateExternalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateCrossTenantContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateLocalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('assertLocalContactAllowed')->andReturnNull();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    private function allowDecision(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'ALLOWED',
            recipientTenantId: self::PARTNER_TENANT_ID,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            policyVersion: 'e076-c',
        );
    }
}
