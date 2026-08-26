<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Feature coverage for the v2 member self-service surface — the account a member
 * manages for themselves: read profile, edit profile, change password, manage
 * notification preferences, and delete (anonymize) the account.
 *
 * This is security/privacy-sensitive (password change requires the current
 * password; account deletion requires re-auth and must actually anonymize PII).
 * It was the real-coverage gap left when the reflection-only Migrated
 * UsersApiControllerTest was deleted (commit ffa90d82a). See docs/TESTING.md.
 *
 * Routes exercised (routes/api.php):
 *   GET    /v2/users/me                  -> UsersController::me
 *   PUT    /v2/users/me                  -> UsersController::update
 *   POST   /v2/users/me/password         -> UsersController::updatePassword
 *   GET    /v2/users/me/notifications    -> UsersController::notificationPreferences
 *   PUT    /v2/users/me/notifications    -> UsersController::updateNotificationPreferences
 *   DELETE /v2/users/me                  -> UsersController::deleteAccount
 */
class MemberSelfServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        // Re-pin the tenant before each test: factory create() + the GDPR erasure
        // flow drift TenantContext, and a prior test's drift would otherwise make
        // a later test's tenant-scoped DELETE (e.g. the notifications purge) miss.
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    private function makeMember(string $password = 'OldPassword123!'): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status'        => 'active',
            'is_approved'   => true,
            'password_hash' => Hash::make($password),
        ]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------ profile

    public function test_me_returns_the_authenticated_members_profile(): void
    {
        $user = $this->makeMember();

        $response = $this->apiGet('/v2/users/me');

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame((int) $user->id, (int) $response->json('data.id'));
        $this->assertSame($user->email, $response->json('data.email'));
    }

    public function test_update_profile_persists_the_change(): void
    {
        $user = $this->makeMember();
        $newBio = 'I help neighbours with gardening and small repairs.';

        $response = $this->apiPut('/v2/users/me', ['bio' => $newBio]);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame($newBio, $response->json('data.bio'));
        // And it is durably written, not just echoed back.
        $this->assertSame($newBio, DB::table('users')->where('id', $user->id)->value('bio'));
    }

    // ----------------------------------------------------------------- password

    public function test_update_password_rotates_the_hash_with_the_correct_current_password(): void
    {
        $user = $this->makeMember('OldPassword123!');
        $oldHash = DB::table('users')->where('id', $user->id)->value('password_hash');

        $response = $this->apiPost('/v2/users/me/password', [
            'current_password' => 'OldPassword123!',
            'new_password'     => 'BrandNewPassw0rd!', // >= 12 chars, not a reuse
        ]);

        $this->assertSame(200, $response->getStatusCode());

        $newHash = DB::table('users')->where('id', $user->id)->value('password_hash');
        $this->assertNotSame($oldHash, $newHash, 'password_hash must change');
        $this->assertTrue(Hash::check('BrandNewPassw0rd!', $newHash), 'new password must verify against the stored hash');
    }

    public function test_update_password_invalidates_only_this_tenants_reset_links(): void
    {
        $user = $this->makeMember('OldPassword123!');
        $email = strtolower((string) $user->email);
        DB::table('password_resets')->insert([
            [
                'email' => $email,
                'tenant_id' => $this->testTenantId,
                'token' => hash('sha256', 'current-tenant-reset-one'),
                'created_at' => now(),
            ],
            [
                'email' => $email,
                'tenant_id' => $this->testTenantId,
                'token' => hash('sha256', 'current-tenant-reset-two'),
                'created_at' => now(),
            ],
            [
                'email' => $email,
                'tenant_id' => 999,
                'token' => hash('sha256', 'other-tenant-reset'),
                'created_at' => now(),
            ],
        ]);

        $this->apiPost('/v2/users/me/password', [
            'current_password' => 'OldPassword123!',
            'new_password' => 'BrandNewPassw0rd!',
        ])->assertOk();

        $this->assertSame(0, DB::table('password_resets')
            ->where('tenant_id', $this->testTenantId)
            ->where('email', $email)
            ->count());
        $this->assertSame(1, DB::table('password_resets')
            ->where('tenant_id', 999)
            ->where('email', $email)
            ->count());
    }

    public function test_update_password_rolls_reset_link_invalidation_back_when_session_revocation_fails(): void
    {
        $user = $this->makeMember('OldPassword123!');
        $email = strtolower((string) $user->email);
        $oldHash = (string) $user->password_hash;
        $resetToken = hash('sha256', 'rollback-reset-link');
        DB::table('password_resets')->insert([
            'email' => $email,
            'tenant_id' => $this->testTenantId,
            'token' => $resetToken,
            'created_at' => now(),
        ]);

        $tokenService = Mockery::mock(TokenService::class);
        $tokenService->shouldReceive('revokeAllTokensForUser')
            ->once()
            ->with((int) $user->id, 'password_change')
            ->andReturn(0);
        $this->app->instance(TokenService::class, $tokenService);

        $this->apiPost('/v2/users/me/password', [
            'current_password' => 'OldPassword123!',
            'new_password' => 'BrandNewPassw0rd!',
        ])->assertStatus(400);

        $this->assertSame($oldHash, DB::table('users')->where('id', $user->id)->value('password_hash'));
        $this->assertDatabaseHas('password_resets', [
            'email' => $email,
            'tenant_id' => $this->testTenantId,
            'token' => $resetToken,
        ]);
        $this->assertDatabaseMissing('user_password_history', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
        ]);
    }

    public function test_update_password_revokes_every_existing_session_type(): void
    {
        $user = $this->makeMember('OldPassword123!');
        $tokens = app(TokenService::class);
        $access = $tokens->generateToken((int) $user->id, $this->testTenantId);
        $refresh = $tokens->generateRefreshToken((int) $user->id, $this->testTenantId);
        $user->createToken('password-change-test');
        DB::table('user_trusted_devices')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'device_token_hash' => hash('sha256', 'password-change-trusted-device'),
            'device_name' => 'Password change regression device',
            'ip_address' => '127.0.0.1',
            'expires_at' => now()->addMonth(),
            'is_revoked' => 0,
        ]);
        if (Schema::hasTable('api_tokens')) {
            DB::table('api_tokens')->insert([
                'user_id' => $user->id,
                'token' => hash('sha256', 'legacy-password-change-token'),
                'device_type' => 'web',
                'expires_at' => now()->addMonth(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $response = $this->apiPost('/v2/users/me/password', [
            'current_password' => 'OldPassword123!',
            'new_password' => 'BrandNewPassw0rd!',
        ]);

        $response->assertStatus(200);
        $this->assertNull($tokens->validateToken($access));
        $this->assertNull($tokens->validateRefreshToken($refresh));
        $this->assertSame(0, $user->tokens()->count());
        if (Schema::hasTable('api_tokens')) {
            $this->assertDatabaseMissing('api_tokens', ['user_id' => $user->id]);
        }
        $this->assertDatabaseHas('refresh_token_sessions', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'revocation_reason' => 'password_change',
        ]);
        $this->assertDatabaseHas('user_trusted_devices', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'is_revoked' => 1,
            'revoked_reason' => 'password_change',
        ]);
    }

    public function test_update_password_rejects_a_wrong_current_password(): void
    {
        $user = $this->makeMember('OldPassword123!');
        $oldHash = DB::table('users')->where('id', $user->id)->value('password_hash');

        $response = $this->apiPost('/v2/users/me/password', [
            'current_password' => 'definitely-not-it',
            'new_password'     => 'BrandNewPassw0rd!',
        ]);

        $this->assertSame(400, $response->getStatusCode());
        // The hash must be untouched.
        $this->assertSame($oldHash, DB::table('users')->where('id', $user->id)->value('password_hash'));
    }

    // ------------------------------------------------------------- notifications

    public function test_notification_preferences_returns_the_flag_set(): void
    {
        $this->makeMember();

        $response = $this->apiGet('/v2/users/me/notifications');

        $this->assertSame(200, $response->getStatusCode());
        $data = $response->json('data');
        $this->assertIsArray($data);
        foreach (['email_messages', 'email_digest', 'email_events', 'push_enabled'] as $key) {
            $this->assertArrayHasKey($key, $data);
            $this->assertIsBool($data[$key]);
        }
    }

    public function test_update_notification_preferences_persists_a_toggle(): void
    {
        $this->makeMember();

        $update = $this->apiPut('/v2/users/me/notifications', ['email_messages' => false]);
        $this->assertSame(200, $update->getStatusCode());

        $after = $this->apiGet('/v2/users/me/notifications');
        $this->assertSame(200, $after->getStatusCode());
        $this->assertFalse($after->json('data.email_messages'), 'the toggle must persist and read back false');
    }

    public function test_partial_notification_update_preserves_events_opt_out(): void
    {
        $this->makeMember();

        $this->apiPut('/v2/users/me/notifications', ['email_events' => false])->assertStatus(200);
        $this->apiPut('/v2/users/me/notifications', ['email_messages' => false])->assertStatus(200);

        $after = $this->apiGet('/v2/users/me/notifications');
        $after->assertStatus(200);
        $this->assertFalse($after->json('data.email_events'));
        $this->assertFalse($after->json('data.email_messages'));
    }

    public function test_string_false_notification_value_is_normalized_without_becoming_true(): void
    {
        $this->makeMember();

        $this->apiPut('/v2/users/me/notifications', ['email_events' => 'false'])
            ->assertStatus(200);

        $this->apiGet('/v2/users/me/notifications')
            ->assertStatus(200)
            ->assertJsonPath('data.email_events', false);
    }

    public function test_invalid_notification_boolean_is_rejected(): void
    {
        $this->makeMember();

        $this->apiPut('/v2/users/me/notifications', ['email_events' => 'definitely'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_atomic_partial_preference_writes_preserve_independent_keys(): void
    {
        $this->makeMember();

        $this->apiPut('/v2/users/me/notifications', [
            'email_events' => false,
            'email_messages' => true,
        ])->assertStatus(200);
        $this->apiPut('/v2/users/me/notifications', [
            'email_messages' => false,
            'push_enabled' => false,
        ])->assertStatus(200);

        $this->apiGet('/v2/users/me/notifications')
            ->assertStatus(200)
            ->assertJsonPath('data.email_events', false)
            ->assertJsonPath('data.email_messages', false)
            ->assertJsonPath('data.push_enabled', false);
    }

    public function test_update_notification_preferences_rejects_an_empty_payload(): void
    {
        $this->makeMember();

        $response = $this->apiPut('/v2/users/me/notifications', ['not_a_real_pref' => true]);

        $this->assertSame(400, $response->getStatusCode());
    }

    // --------------------------------------------------------------- delete acct

    public function test_delete_account_rejects_a_missing_password(): void
    {
        // H1: the primary React UI must send the re-auth password (SettingsPage
        // sends { body: { password } }); a passwordless request must be refused
        // with a 400 BEFORE any erasure, and the account must be left intact.
        $user = $this->makeMember('OldPassword123!');

        $response = $this->apiDelete('/v2/users/me', []);

        $this->assertSame(400, $response->getStatusCode());
        $row = DB::table('users')->where('id', $user->id)->first();
        $this->assertSame('active', $row->status, 'account must remain active when no password is supplied');
        $this->assertSame($user->email, $row->email, 'account must not be anonymized without re-auth');
    }

    public function test_delete_account_rejects_a_wrong_password(): void
    {
        $user = $this->makeMember('OldPassword123!');

        // delete_account is rate-limited to 1/min, so this is the only delete call here.
        $response = $this->apiDelete('/v2/users/me', ['password' => 'wrong-password']);

        $this->assertSame(403, $response->getStatusCode());
        // The account must remain active and un-anonymized.
        $row = DB::table('users')->where('id', $user->id)->first();
        $this->assertSame('active', $row->status);
        $this->assertSame($user->email, $row->email);
    }

    public function test_delete_account_with_correct_password_anonymizes_the_account(): void
    {
        $user = $this->makeMember('OldPassword123!');

        $response = $this->apiDelete('/v2/users/me', ['password' => 'OldPassword123!']);

        $this->assertSame(200, $response->getStatusCode());

        $row = DB::table('users')->where('id', $user->id)->first();
        $this->assertSame('inactive', $row->status, 'deleted account must be soft-deleted to inactive');
        $this->assertNotNull($row->anonymized_at, 'anonymized_at must be stamped');
        $this->assertStringStartsWith('deleted_', (string) $row->email, 'email must be anonymized');
        $this->assertNotSame($user->email, $row->email);
    }

    /**
     * H2 regression: DELETE /v2/users/me must run the full GDPR Article 17
     * erasure (GdprService::executeAccountDeletion), not the shallow PII-column
     * anonymize. The shallow path left related personal records and the
     * password hash behind; full erasure purges them.
     */
    public function test_delete_account_with_correct_password_purges_related_records(): void
    {
        $user = $this->makeMember('OldPassword123!');

        // A personal record the full erasure must DELETE (the shallow path left
        // these behind — that was the H2 bug).
        DB::table('notifications')->insert([
            'user_id'    => $user->id,
            'tenant_id'  => $this->testTenantId,
            'message'    => 'You have a new message',
            'type'       => 'system',
            'created_at' => now(),
        ]);

        $response = $this->apiDelete('/v2/users/me', ['password' => 'OldPassword123!']);

        $this->assertSame(200, $response->getStatusCode());

        // Related personal data is purged, not merely anonymized.
        $this->assertSame(
            0,
            DB::table('notifications')->where('user_id', $user->id)->count(),
            'full GDPR erasure must delete the user\'s notifications'
        );

        // Credentials are destroyed by the full purge (the shallow path left
        // password_hash intact); the account is anonymized + deactivated, with
        // the GdprService-style @anonymized.local address.
        $row = DB::table('users')->where('id', $user->id)->first();
        $this->assertSame('', (string) $row->password_hash, 'password_hash must be wiped by full erasure');
        $this->assertSame('inactive', $row->status);
        $this->assertNotNull($row->anonymized_at);
        $this->assertStringEndsWith('@anonymized.local', (string) $row->email);
    }

    /**
     * Regression: the 2FA erasure step targeted non-existent columns
     * (users.totp_secret / totp_backup_codes), so the statement threw and the
     * swallowing try/catch hid it — the AES-encrypted TOTP secret in
     * user_totp_settings, and any trusted-device tokens, survived a
     * right-to-erasure request. Full erasure must delete both.
     */
    public function test_delete_account_erases_two_factor_secrets_and_trusted_devices(): void
    {
        $user = $this->makeMember('OldPassword123!');

        DB::table('user_totp_settings')->insert([
            'user_id'               => $user->id,
            'tenant_id'             => $this->testTenantId,
            'totp_secret_encrypted' => 'encrypted-secret-placeholder',
            'is_enabled'            => 1,
            'created_at'            => now(),
            'updated_at'            => now(),
        ]);
        DB::table('user_trusted_devices')->insert([
            'user_id'           => $user->id,
            'tenant_id'         => $this->testTenantId,
            'device_token_hash' => hash('sha256', 'device-' . $user->id),
            'ip_address'        => '203.0.113.7',
            'expires_at'        => now()->addDays(30),
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        $response = $this->apiDelete('/v2/users/me', ['password' => 'OldPassword123!']);
        $this->assertSame(200, $response->getStatusCode());

        $this->assertSame(
            0,
            DB::table('user_totp_settings')->where('user_id', $user->id)->count(),
            'the encrypted 2FA secret must not survive GDPR erasure'
        );
        $this->assertSame(
            0,
            DB::table('user_trusted_devices')->where('user_id', $user->id)->count(),
            'trusted-device tokens must not survive GDPR erasure'
        );
        $this->assertSame(
            0,
            (int) DB::table('users')->where('id', $user->id)->value('totp_enabled'),
            'the users.totp_enabled flag must be cleared by erasure'
        );
    }

    /**
     * Direct self-service deletion must not make a second complete copy of the
     * member's data. The former "legal retention" ZIP had no gdpr_requests row,
     * so the seven-day cleanup query could never find it and the copy survived
     * indefinitely after a supposedly successful Article 17 erasure.
     */
    public function test_delete_account_does_not_create_an_untracked_retention_export(): void
    {
        $user = $this->makeMember('OldPassword123!');

        $response = $this->apiDelete('/v2/users/me', ['password' => 'OldPassword123!']);
        $this->assertSame(200, $response->getStatusCode());

        $exported = DB::table('gdpr_audit_log')
            ->where('user_id', $user->id)
            ->where('action', 'data_exported')
            ->exists();
        $this->assertFalse(
            $exported,
            'self-service deletion must not create an untracked full-data export'
        );
    }

}
