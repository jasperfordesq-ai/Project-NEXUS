<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Privilege-field injection ("mass assignment") through the member's own
 * profile update.
 *
 * The first thing a tester tries on PUT /v2/users/me is to add the fields the
 * form does not show: role, the super-admin flags, tenant_id, the wallet
 * balance, verification. The request must be accepted or rejected on its
 * legitimate fields alone and every privileged column must be untouched
 * afterwards. Read back with the query builder, not the model, so no model
 * scope or cast can soften the check.
 */
class PrivilegeFieldInjectionTest extends TestCase
{
    use DatabaseTransactions;

    private const INJECTED = [
        'role' => 'admin',
        'is_super_admin' => true,
        'is_tenant_super_admin' => true,
        'tenant_id' => 999,
        'balance' => 999999,
        'is_verified' => true,
        'email_verified_at' => '2026-01-01 00:00:00',
        'id' => 1,
    ];

    public function test_member_cannot_grant_themselves_privileges_through_profile_update(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'is_super_admin' => false,
            'is_tenant_super_admin' => false,
            'is_approved' => true,
            'is_verified' => false,
            'status' => 'active',
            'balance' => 10,
        ]);
        Sanctum::actingAs($user, ['*']);

        $before = DB::table('users')->where('id', $user->id)->first();

        $response = $this->apiPut('/v2/users/me', ['first_name' => 'Legitimate'] + self::INJECTED);

        $this->assertContains(
            $response->getStatusCode(),
            [200, 422],
            'Profile update should succeed on its legitimate field or reject the payload — not error. Body: '
            . mb_substr((string) $response->getContent(), 0, 300)
        );

        $after = DB::table('users')->where('id', $user->id)->first();
        $this->assertNotNull($after, 'The member row vanished (the injected id may have been honoured).');

        $this->assertSame('member', $after->role, 'role was changed by a profile update');
        $this->assertSame(0, (int) $after->is_super_admin, 'is_super_admin was set by a profile update');
        $this->assertSame(0, (int) $after->is_tenant_super_admin, 'is_tenant_super_admin was set by a profile update');
        $this->assertSame($this->testTenantId, (int) $after->tenant_id, 'tenant_id was moved by a profile update');
        $this->assertEquals((float) $before->balance, (float) $after->balance, 'wallet balance was changed by a profile update');
        $this->assertSame(0, (int) $after->is_verified, 'is_verified (a trust badge) was self-granted through a profile update');
        $this->assertSame($before->email_verified_at, $after->email_verified_at, 'email_verified_at was set by a profile update');

        // No member of ANY community may end up with the injected id.
        $this->assertSame(
            (int) $before->id,
            (int) $after->id,
            'primary key changed'
        );
    }

    public function test_injected_privilege_fields_are_not_echoed_back_as_accepted(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'is_super_admin' => false,
            'is_tenant_super_admin' => false,
            'is_approved' => true,
            'status' => 'active',
        ]);
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPut('/v2/users/me', ['first_name' => 'Legitimate'] + self::INJECTED);

        if ($response->getStatusCode() !== 200) {
            $this->markTestSkipped('Profile update rejected the payload outright (' . $response->getStatusCode() . '); nothing to echo.');
        }

        $data = $response->json('data') ?? [];

        foreach (['role' => 'admin', 'is_super_admin' => true, 'is_tenant_super_admin' => true] as $field => $injected) {
            if (array_key_exists($field, $data)) {
                $this->assertNotEquals($injected, $data[$field], "response echoed the injected {$field} as if accepted");
            }
        }
    }
}
