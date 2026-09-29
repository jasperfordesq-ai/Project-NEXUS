<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E062;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\Auth\SsoOidcService;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-327 (E-062) — the connection runs with strict => false, so a string longer
 * than its column is silently truncated. Four write paths passed request input
 * straight into a fixed-width column: the stored value then differed from the
 * one sent, and every lookup by the sent value missed. Each path must now
 * refuse an over-long value instead of storing a shortened one, and an
 * in-range value must still be stored exactly.
 *
 * config/database.php is deliberately NOT changed (coordinator instruction).
 */
class F327WritePathsCapStringsToColumnWidthTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        // Open community: account admission is not what these tests are about.
        foreach (['general.registration_mode', 'registration_mode'] as $key) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => 'open', 'setting_type' => 'string', 'updated_at' => now()]
            );
        }
        DB::table('tenant_registration_policies')->where('tenant_id', $this->testTenantId)->delete();
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
        TenantContext::setById($this->testTenantId);
    }

    private function setFeature(string $feature): void
    {
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features[$feature] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    // --------------------------------------- super-admin create: users.email

    private function superAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        DB::table('users')->where('id', $admin->id)->update(['is_super_admin' => 1, 'is_tenant_super_admin' => 1]);
        $path = DB::table('tenants')->where('id', $this->testTenantId)->value('path');
        if (trim((string) $path) === '') {
            DB::table('tenants')->where('id', $this->testTenantId)->update(['path' => '/' . $this->testTenantId . '/']);
        }
        $admin->refresh();
        Sanctum::actingAs($admin);

        return $admin;
    }

    private function superCreate(array $overrides): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost('/v2/admin/super/users', array_merge([
            'tenant_id' => $this->testTenantId,
            'first_name' => 'F327',
            'last_name' => 'Super',
            'email' => 'f327-ok-' . bin2hex(random_bytes(4)) . '@example.test',
            'password' => 'Str0ng-F327-passphrase!',
            'role' => 'member',
        ], $overrides));
    }

    public function test_super_admin_create_refuses_an_email_longer_than_the_column(): void
    {
        $this->superAdmin();
        $long = 'f327-' . str_repeat('a', 60) . '@' . str_repeat('b', 60) . '.' . str_repeat('c', 60) . '.'
            . str_repeat('d', 60) . '.example.test';
        $this->assertGreaterThan(255, strlen($long));

        $this->superCreate(['email' => $long])->assertStatus(422);

        $this->assertSame(0, DB::table('users')->where('email', 'like', 'f327-' . str_repeat('a', 60) . '@%')->count(),
            'no shortened account may be created');
    }

    public function test_super_admin_create_refuses_names_longer_than_the_column(): void
    {
        $this->superAdmin();
        $email = 'f327-name-' . bin2hex(random_bytes(4)) . '@example.test';

        $this->superCreate(['email' => $email, 'first_name' => str_repeat('n', 101)])->assertStatus(422);

        $this->assertFalse(DB::table('users')->where('email', $email)->exists());
    }

    public function test_control_super_admin_create_stores_an_in_range_email_exactly(): void
    {
        $this->superAdmin();
        $local = str_repeat('e', 60);
        $email = $local . '@' . str_repeat('f', 60) . '.' . str_repeat('g', 60) . '.' . bin2hex(random_bytes(4)) . '.test';
        $this->assertLessThanOrEqual(255, strlen($email));

        $this->superCreate(['email' => $email])->assertStatus(201);

        $this->assertTrue(DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->exists(),
            'an in-range email is found by the value that was sent');
    }

    // ---------------------------------------- SSO provider: client_id / issuer

    private function ssoInput(array $overrides = []): array
    {
        return array_merge([
            'provider_key' => 'f327sso',
            'issuer_url' => 'https://idp.example.test/realm',
            'client_id' => 'f327-client',
            'display_name' => 'F327',
        ], $overrides);
    }

    public function test_sso_provider_refuses_a_client_id_longer_than_the_column(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sso = app(SsoOidcService::class);

        try {
            $sso->upsert($this->testTenantId, $this->ssoInput(['client_id' => str_repeat('c', 256)]), (int) $admin->id);
            $this->fail('an over-long client_id must be refused');
        } catch (\InvalidArgumentException $e) {
            $this->assertStringContainsString('255', $e->getMessage());
        }
        try {
            $sso->upsert($this->testTenantId, $this->ssoInput(['issuer_url' => 'https://idp.example.test/' . str_repeat('p', 500)]), (int) $admin->id);
            $this->fail('an over-long issuer_url must be refused');
        } catch (\InvalidArgumentException $e) {
            $this->assertStringContainsString('500', $e->getMessage());
        }

        $this->assertFalse(DB::table('tenant_sso_providers')->where('tenant_id', $this->testTenantId)->where('provider_key', 'f327sso')->exists());
    }

    public function test_control_sso_provider_stores_a_full_width_client_id_exactly(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $clientId = str_repeat('c', 255);

        app(SsoOidcService::class)->upsert($this->testTenantId, $this->ssoInput(['client_id' => $clientId]), (int) $admin->id);

        $this->assertSame($clientId, (string) DB::table('tenant_sso_providers')
            ->where('tenant_id', $this->testTenantId)->where('provider_key', 'f327sso')->value('client_id'));
    }

    // ------------------------------------------- volunteering outbound webhooks

    private function volunteeringAdmin(): User
    {
        $this->setFeature('volunteering');
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        return $admin;
    }

    private function webhookInput(array $overrides = []): array
    {
        return array_merge([
            'name' => 'F327 hook',
            'url' => 'https://93.184.216.34/f327-hook',
            'events' => ['vol.shift.created'],
        ], $overrides);
    }

    public function test_outbound_webhook_refuses_a_secret_longer_than_the_column(): void
    {
        $this->volunteeringAdmin();

        $this->apiPost('/v2/admin/volunteering/webhooks', $this->webhookInput([
            'name' => 'F327 long secret', 'secret' => str_repeat('s', 256),
        ]))->assertStatus(422);
        $this->assertFalse(DB::table('outbound_webhooks')->where('tenant_id', $this->testTenantId)->where('name', 'F327 long secret')->exists());

        $this->apiPost('/v2/admin/volunteering/webhooks', $this->webhookInput([
            'name' => str_repeat('n', 256),
        ]))->assertStatus(422);
    }

    public function test_outbound_webhook_update_refuses_a_secret_longer_than_the_column(): void
    {
        $this->volunteeringAdmin();
        $secret = str_repeat('k', 255);
        $id = (int) $this->apiPost('/v2/admin/volunteering/webhooks', $this->webhookInput(['secret' => $secret]))
            ->assertStatus(201)->json('data.id');

        $this->apiPut("/v2/admin/volunteering/webhooks/{$id}", ['secret' => str_repeat('z', 256)])->assertStatus(422);

        $this->assertSame($secret, (string) DB::table('outbound_webhooks')->where('id', $id)->value('secret'),
            'CONTROL + safe behaviour: the full-width secret was stored exactly and the over-long one did not replace it');
    }

    // ---------------------------------------------------- federation webhooks

    public function test_federation_webhook_refuses_a_url_or_description_longer_than_the_column(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create(['is_tenant_super_admin' => true]));
        $before = DB::table('federation_webhooks')->where('tenant_id', $this->testTenantId)->count();

        $res = $this->apiPost('/v2/admin/federation/webhooks', [
            'url' => 'https://93.184.216.34/' . str_repeat('u', 490),
            'events' => ['member.opted_in'],
        ]);
        $res->assertStatus(422);
        $res->assertJsonPath('errors.0.field', 'url');

        $this->apiPost('/v2/admin/federation/webhooks', [
            'url' => 'https://93.184.216.34/f327',
            'events' => ['member.opted_in'],
            'description' => str_repeat('d', 256),
        ])->assertStatus(422);

        $this->assertSame($before, DB::table('federation_webhooks')->where('tenant_id', $this->testTenantId)->count());
    }

    // ----------------------------------------- external partner inbound webhook

    private function partnerToken(): string
    {
        $this->enableExternalFederation();
        $token = 'f327-token-' . bin2hex(random_bytes(8));
        $row = [
            'tenant_id' => $this->testTenantId, 'name' => 'F327 Partner', 'base_url' => 'https://f327.example',
            'api_path' => '/api/v1/federation', 'signing_secret' => $token, 'status' => 'active',
            'allow_member_search' => 1, 'allow_listing_search' => 1, 'allow_messaging' => 1,
            'allow_transactions' => 1, 'allow_events' => 1, 'allow_groups' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ];
        foreach (['allow_connections', 'allow_volunteering', 'allow_member_sync'] as $flag) {
            if (Schema::hasColumn('federation_external_partners', $flag)) {
                $row[$flag] = 1;
            }
        }
        DB::table('federation_external_partners')->insert($row);
        TenantContext::setById($this->testTenantId);

        return $token;
    }

    private function postInbound(string $token, string $event, array $data): \Illuminate\Testing\TestResponse
    {
        return $this->withHeaders([
            'Authorization' => 'Bearer ' . $token,
            'Content-Type' => 'application/json',
            'X-Federation-Nonce' => 'f327-nonce-' . bin2hex(random_bytes(16)),
        ])->postJson('/api/v2/federation/external/webhooks/receive', ['event' => $event, 'data' => $data]);
    }

    public function test_inbound_webhook_refuses_an_external_id_longer_than_the_column(): void
    {
        $token = $this->partnerToken();
        $long = 'f327-' . str_repeat('x', 124); // 129 characters; the column is varchar(128)

        $this->postInbound($token, 'member.profile_updated', ['external_id' => $long, 'username' => 'f327'])
            ->assertStatus(400);
        $this->postInbound($token, 'listing.created', ['external_id' => $long, 'title' => 'F327'])
            ->assertStatus(400);
        $this->postInbound($token, 'listing.created', ['external_id' => 'f327-title', 'title' => str_repeat('t', 501)])
            ->assertStatus(400);

        $this->assertFalse(DB::table('federation_members')->where('external_id', 'like', 'f327-xxxx%')->exists(),
            'no mirror row may be stored under a shortened id');
        $this->assertFalse(DB::table('federation_listings')->where('external_id', 'like', 'f327-%')->exists());
    }

    public function test_control_inbound_webhook_stores_a_full_width_external_id_exactly(): void
    {
        $token = $this->partnerToken();
        $id = 'f327-' . str_repeat('y', 123); // exactly 128

        $this->postInbound($token, 'member.profile_updated', ['external_id' => $id, 'username' => 'f327'])
            ->assertStatus(200);

        $this->assertTrue(DB::table('federation_members')->where('tenant_id', $this->testTenantId)->where('external_id', $id)->exists(),
            'the mirror row is found by the id the partner sent');
    }
}
