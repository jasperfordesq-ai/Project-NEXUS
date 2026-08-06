<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Models;

use App\Models\User;
use App\Services\TokenService;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use ReflectionMethod;
use Tests\Laravel\TestCase;

/**
 * User::moveTenant() Contract Tests
 *
 * Contract and lifecycle tests for tenant moves.
 */
class UserMoveTenantTest extends TestCase
{
    use DatabaseTransactions;

    /** The content-counts block a move returns when the member owns no content. */
    private const EMPTY_CONTENT = [
        'listings_moved' => 0,
        'listings_uncategorised' => 0,
        'exchange_requests_closed' => 0,
        'skills_moved' => 0,
        'interests_moved' => 0,
        'interests_dropped' => 0,
    ];

    // ==========================================
    // Method Existence & Signature Tests
    // ==========================================

    public function testMoveTenantMethodExists(): void
    {
        $this->assertTrue(
            method_exists(User::class, 'moveTenant'),
            'User::moveTenant() method should exist'
        );
    }

    public function testMoveTenantIsPublicStatic(): void
    {
        $method = new ReflectionMethod(User::class, 'moveTenant');

        $this->assertTrue($method->isPublic(), 'moveTenant should be public');
        $this->assertTrue($method->isStatic(), 'moveTenant should be static');
    }

    public function testMoveTenantParameterCount(): void
    {
        $method = new ReflectionMethod(User::class, 'moveTenant');
        $params = $method->getParameters();

        $this->assertCount(2, $params, 'moveTenant should have 2 parameters');
    }

    public function testMoveTenantParameterNames(): void
    {
        $method = new ReflectionMethod(User::class, 'moveTenant');
        $params = $method->getParameters();

        $this->assertEquals('userId', $params[0]->getName());
        $this->assertEquals('newTenantId', $params[1]->getName());
    }

    public function testMoveTenantParameterTypes(): void
    {
        $method = new ReflectionMethod(User::class, 'moveTenant');
        $params = $method->getParameters();

        $this->assertEquals('int', $params[0]->getType()->getName());
        $this->assertEquals('int', $params[1]->getType()->getName());
    }

    public function testMoveTenantBothParametersRequired(): void
    {
        $method = new ReflectionMethod(User::class, 'moveTenant');
        $params = $method->getParameters();

        $this->assertFalse($params[0]->isOptional(), 'userId should be required');
        $this->assertFalse($params[1]->isOptional(), 'newTenantId should be required');
    }

    public function testMoveTenantReturnType(): void
    {
        $method = new ReflectionMethod(User::class, 'moveTenant');
        $returnType = $method->getReturnType();

        $this->assertNotNull($returnType, 'moveTenant should declare a return type');
        // array{success,moved,failed} — the shape the super-admin move
        // endpoints consume (was bool before 8fa15107b).
        $this->assertEquals('array', $returnType->getName());
    }

    public function testMoveTenantSourceUpdatesTenantId(): void
    {
        $method = new ReflectionMethod(User::class, 'moveTenant');
        $lines = file($method->getFileName());
        $source = implode('', array_slice(
            $lines,
            $method->getStartLine() - 1,
            $method->getEndLine() - $method->getStartLine() + 1
        ));

        $this->assertStringContainsString('tenant_id', $source,
            'moveTenant should update tenant_id');
        $this->assertStringContainsString('newTenantId', $source,
            'moveTenant should use the newTenantId parameter');
    }

    public function testMoveTenantRevokesPasskeysBeforeChangingTenant(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $credentialId = $this->insertPasskey((int) $user->id, $this->testTenantId);

        $result = User::moveTenant((int) $user->id, 999);

        $this->assertSame(['success' => true, 'moved' => 1, 'failed' => [], 'pinned' => [], 'details' => [], 'content' => self::EMPTY_CONTENT], $result);
        $this->assertDatabaseHas('users', ['id' => $user->id, 'tenant_id' => 999]);
        $this->assertDatabaseMissing('webauthn_credentials', [
            'user_id' => $user->id,
            'credential_id' => $credentialId,
        ]);
    }

    public function testFailedTenantMoveRollsBackPasskeyRevocation(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $credentialId = $this->insertPasskey((int) $user->id, $this->testTenantId);

        try {
            User::moveTenant((int) $user->id, 2_000_000_000);
            $this->fail('Moving to a tenant that does not exist should fail.');
        } catch (QueryException) {
            // The users.tenant_id foreign key rejects the move. The credential
            // deletion must be rolled back by the same transaction.
        }

        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'tenant_id' => $this->testTenantId,
        ]);
        $this->assertDatabaseHas('webauthn_credentials', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'credential_id' => $credentialId,
        ]);
    }

    public function testPasskeyOnlyUserMoveFailsWithRecoveryRequirement(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('users')->where('id', $user->id)->update([
            'password' => null,
            'password_hash' => null,
        ]);
        $credentialId = $this->insertPasskey((int) $user->id, $this->testTenantId);

        $result = User::moveTenant((int) $user->id, 999);

        $this->assertSame([
            'success' => false,
            'moved' => 0,
            'failed' => ['passkey_recovery_required'],
            'pinned' => [],
            'details' => [],
            'content' => [],
        ], $result);
        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'tenant_id' => $this->testTenantId,
        ]);
        $this->assertDatabaseHas('webauthn_credentials', [
            'user_id' => $user->id,
            'credential_id' => $credentialId,
        ]);
    }

    public function testTenantMoveRevokesJwtAndSanctumSessions(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $tokenService = app(TokenService::class);
        $accessToken = $tokenService->generateToken(
            (int) $user->id,
            $this->testTenantId
        );
        $user->createToken('tenant-move-regression');

        $result = User::moveTenant((int) $user->id, 999);

        $this->assertSame(['success' => true, 'moved' => 1, 'failed' => [], 'pinned' => [], 'details' => [], 'content' => self::EMPTY_CONTENT], $result);
        $this->assertNull($tokenService->validateToken($accessToken));
        $this->assertDatabaseMissing('personal_access_tokens', [
            'tokenable_type' => User::class,
            'tokenable_id' => $user->id,
        ]);
    }

    /**
     * 🔴 Regression: fk_refresh_sessions_user_tenant pairs (user_id, tenant_id)
     * against users(id, tenant_id) and revokeAllTokensForUser() only stamps
     * revoked_at, so before the in-transaction DELETE was added, ANY member who
     * had ever signed in on the SPA could not be moved at all — the users UPDATE
     * died on error 1451 and surfaced as an HTTP 500. Factory users have no
     * sessions, which is exactly why every earlier test missed it.
     */
    public function testMoveSucceedsForUserWithRefreshTokenSessions(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $this->insertRefreshSession((int) $user->id, $this->testTenantId);
        $this->insertRefreshSession((int) $user->id, $this->testTenantId);

        $result = User::moveTenant((int) $user->id, 999);

        $this->assertSame(['success' => true, 'moved' => 1, 'failed' => [], 'pinned' => [], 'details' => [], 'content' => self::EMPTY_CONTENT], $result);
        $this->assertDatabaseHas('users', ['id' => $user->id, 'tenant_id' => 999]);
        $this->assertDatabaseMissing('refresh_token_sessions', ['user_id' => $user->id]);
    }

    public function testMoveFailsWhenDestinationHasSameEmail(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        User::factory()->forTenant(999)->create(['email' => $user->email]);

        $result = User::moveTenant((int) $user->id, 999);

        $this->assertSame([
            'success' => false,
            'moved' => 0,
            'failed' => ['email_conflict'],
            'pinned' => [],
            'details' => [],
            'content' => [],
        ], $result);
        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'tenant_id' => $this->testTenantId,
        ]);
    }

    public function testMoveFailsWhenDestinationHasSameUsername(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $username = 'move-conflict-' . bin2hex(random_bytes(6));
        DB::table('users')->where('id', $user->id)->update(['username' => $username]);
        $blocker = User::factory()->forTenant(999)->create();
        DB::table('users')->where('id', $blocker->id)->update(['username' => $username]);

        $result = User::moveTenant((int) $user->id, 999);

        $this->assertSame([
            'success' => false,
            'moved' => 0,
            'failed' => ['username_conflict'],
            'pinned' => [],
            'details' => [],
            'content' => [],
        ], $result);
        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'tenant_id' => $this->testTenantId,
        ]);
    }

    public function testMoveToCurrentTenantReportsAlreadyInTenant(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();

        $result = User::moveTenant((int) $user->id, $this->testTenantId);

        $this->assertSame([
            'success' => false,
            'moved' => 0,
            'failed' => ['already_in_tenant'],
            'pinned' => [],
            'details' => [],
            'content' => [],
        ], $result);
    }

    /**
     * Dozens of events-subsystem tables carry a composite FK
     * (actor col, tenant_id) → users(id, tenant_id) with no ON UPDATE action,
     * so a member with rows there cannot change tenant — MariaDB RESTRICTs the
     * parent UPDATE. moveTenant() must detect this up front and return a
     * structured failure naming the blocking tables instead of throwing.
     */
    public function testMoveFailsWithStructuredReasonWhenEventRecordsPinUser(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();

        $eventId = DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'title' => 'Pin regression event',
            'description' => 'Ensures composite-FK rows block the move cleanly.',
            'start_time' => now()->addDay(),
            'created_at' => now(),
        ]);
        DB::table('event_analytics_access_audits')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'actor_user_id' => $user->id,
            'access_scope' => 'organizer_summary',
            'purpose_code' => 'tenant_move_regression',
            'query_hash' => hash('sha256', 'tenant-move-regression'),
            'result_count' => 10,
            'suppressed_count' => 0,
            'privacy_threshold' => 5,
            'created_at' => now(),
        ]);

        $result = User::moveTenant((int) $user->id, 999);

        $this->assertFalse($result['success']);
        $this->assertSame(['tenant_records_pin_user'], $result['failed']);
        $this->assertSame(['event_analytics_access_audits' => 1], $result['pinned']);
        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'tenant_id' => $this->testTenantId,
        ]);
    }

    // ==========================================
    // Content follows the member (owner-approved plan, 2026-08-06)
    // ==========================================

    public function testMoveCarriesListingsAndRemapsCategories(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();

        $oldCat = DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId, 'name' => 'Gardening',
            'slug' => 'move-test-gardening', 'type' => 'listing',
        ]);
        $newCat = DB::table('categories')->insertGetId([
            'tenant_id' => 999, 'name' => 'Gardening',
            'slug' => 'move-test-gardening', 'type' => 'listing',
        ]);
        $orphanCat = DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId, 'name' => 'Only Here',
            'slug' => 'move-test-only-here', 'type' => 'listing',
        ]);

        $matched = DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $user->id,
            'category_id' => $oldCat, 'title' => 'Hedge trimming',
            'description' => 't', 'type' => 'offer', 'status' => 'active',
        ]);
        $unmatched = DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $user->id,
            'category_id' => $orphanCat, 'title' => 'Piano lessons',
            'description' => 't', 'type' => 'offer', 'status' => 'active',
        ]);

        $result = User::moveTenant((int) $user->id, 999);

        $this->assertTrue($result['success']);
        $this->assertSame(2, $result['content']['listings_moved']);
        $this->assertSame(1, $result['content']['listings_uncategorised']);
        $this->assertDatabaseHas('listings', ['id' => $matched, 'tenant_id' => 999, 'category_id' => $newCat]);
        $this->assertDatabaseHas('listings', ['id' => $unmatched, 'tenant_id' => 999, 'category_id' => null]);
    }

    public function testMoveCancelsOpenExchangesAndNotifiesCounterparty(): void
    {
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $provider->id,
            'title' => 'Dog walking', 'description' => 't', 'type' => 'offer', 'status' => 'active',
        ]);
        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 1, 'status' => 'pending_provider',
        ]);

        $result = User::moveTenant((int) $provider->id, 999);

        $this->assertTrue($result['success']);
        $this->assertSame(1, $result['content']['exchange_requests_closed']);
        $this->assertDatabaseHas('exchange_requests', ['id' => $exchangeId, 'status' => 'cancelled']);
        $this->assertDatabaseHas('exchange_history', [
            'exchange_id' => $exchangeId,
            'action' => 'cancelled_member_moved_tenant',
            'new_status' => 'cancelled',
        ]);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $requester->id,
            'tenant_id' => $this->testTenantId,
        ]);
    }

    public function testMoveBlocksWhenUserSolelyOwnsAGroup(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $groupId = DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId, 'owner_id' => $user->id,
            'name' => 'Move-test Knitting Circle', 'status' => 'active',
        ]);

        $result = User::moveTenant((int) $user->id, 999);

        $this->assertFalse($result['success']);
        $this->assertSame(['group_ownership_transfer_required'], $result['failed']);
        $this->assertSame(['Move-test Knitting Circle'], $result['details']['groups']);
        $this->assertDatabaseHas('users', ['id' => $user->id, 'tenant_id' => $this->testTenantId]);

        // A second active owner releases the block.
        $coOwner = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId, 'group_id' => $groupId,
            'user_id' => $coOwner->id, 'role' => 'owner', 'status' => 'active',
        ]);

        $retry = User::moveTenant((int) $user->id, 999);
        $this->assertTrue($retry['success']);
    }

    public function testMoveBlocksWhenExchangeCarriesMoney(): void
    {
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $provider->id,
            'title' => 'Bike repair', 'description' => 't', 'type' => 'offer', 'status' => 'active',
        ]);
        DB::table('exchange_requests')->insert([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 2, 'status' => 'pending_confirmation',
        ]);

        $result = User::moveTenant((int) $provider->id, 999);

        $this->assertFalse($result['success']);
        $this->assertSame(['exchanges_in_flight'], $result['failed']);
        $this->assertSame(1, $result['details']['exchange_count']);
        $this->assertDatabaseHas('users', ['id' => $provider->id, 'tenant_id' => $this->testTenantId]);
    }

    public function testMoveCarriesSkillsAndRemapsInterests(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();

        DB::table('user_skills')->insert([
            'user_id' => $user->id, 'tenant_id' => $this->testTenantId,
            'category_id' => null, 'skill_name' => 'Carpentry',
        ]);

        $oldCat = DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId, 'name' => 'Crafts',
            'slug' => 'move-test-crafts', 'type' => 'listing',
        ]);
        $newCat = DB::table('categories')->insertGetId([
            'tenant_id' => 999, 'name' => 'Crafts',
            'slug' => 'move-test-crafts', 'type' => 'listing',
        ]);
        $loneCat = DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId, 'name' => 'Lone',
            'slug' => 'move-test-lone', 'type' => 'listing',
        ]);
        DB::table('user_interests')->insert([
            ['user_id' => $user->id, 'tenant_id' => $this->testTenantId, 'category_id' => $oldCat, 'interest_type' => 'interest'],
            ['user_id' => $user->id, 'tenant_id' => $this->testTenantId, 'category_id' => $loneCat, 'interest_type' => 'interest'],
        ]);

        $result = User::moveTenant((int) $user->id, 999);

        $this->assertTrue($result['success']);
        $this->assertSame(1, $result['content']['skills_moved']);
        $this->assertSame(1, $result['content']['interests_moved']);
        $this->assertSame(1, $result['content']['interests_dropped']);
        $this->assertDatabaseHas('user_skills', ['user_id' => $user->id, 'tenant_id' => 999, 'skill_name' => 'Carpentry']);
        $this->assertDatabaseHas('user_interests', ['user_id' => $user->id, 'tenant_id' => 999, 'category_id' => $newCat]);
        $this->assertDatabaseMissing('user_interests', ['user_id' => $user->id, 'category_id' => $loneCat]);
    }

    private function insertRefreshSession(int $userId, int $tenantId): void
    {
        DB::table('refresh_token_sessions')->insert([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'family_hash' => hash('sha256', 'family-' . bin2hex(random_bytes(8))),
            'jti_hash' => hash('sha256', 'jti-' . bin2hex(random_bytes(8))),
            'issued_at' => now(),
            'expires_at' => now()->addMinutes(15),
            'family_expires_at' => now()->addDays(30),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertPasskey(int $userId, int $tenantId): string
    {
        $credentialId = 'tenant-move-' . bin2hex(random_bytes(16));
        $data = [
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'credential_id' => $credentialId,
            'public_key' => 'test-public-key',
            'sign_count' => 0,
            'created_at' => now(),
        ];

        // Keep this lifecycle regression executable before and after the
        // hardening migration is applied to a developer's existing test DB.
        if (Schema::hasColumn('webauthn_credentials', 'user_handle')) {
            $data['user_handle'] = rtrim(strtr(base64_encode(hash(
                'sha256',
                $userId . ':' . $tenantId,
                true
            )), '+/', '-_'), '=');
        }

        DB::table('webauthn_credentials')->insert($data);

        return $credentialId;
    }
}
