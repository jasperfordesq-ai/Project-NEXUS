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
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-487 (E-075 slice G, G-5) — the v1 partner transaction read must not serve
 * one community another community's transfer.
 *
 * `transactions.receiver_tenant_id` carries TWO identifier spaces with no
 * discriminator column:
 *
 *   - a real `tenants.id` on an INTERNAL cross-community transfer
 *     (`FederationV2Controller::sendTransaction()` :3960-3963);
 *   - a `federation_external_partners.id` on an OUTBOUND EXTERNAL transfer
 *     (`sendExternalTransaction()` :4143-4156).
 *
 * `ReconcileFederationPendingTxJob` (:70-73) relies on the second reading, so
 * that is the platform's settled convention. `FederationController::
 * getTransaction()` filtered on the first, with the calling key's own
 * `tenant_id`:
 *
 *     AND (t.sender_tenant_id = ? OR t.receiver_tenant_id = ?)
 *
 * Both id spaces are small auto-increment sequences from 1. Wherever a
 * community's id equals an external partner row's id, that community's partner
 * key was served another community's outbound transfer — its amount, the
 * sending member's free-text description, and the sender's name.
 *
 * THE FIX FAILS CLOSED ON AN AMBIGUOUS ID, DELIBERATELY. The receiver arm now
 * matches only when the row is demonstrably NOT an outbound external transfer.
 * The two `IS NULL` tests are the precise discriminator; the `NOT EXISTS` is a
 * belt for any legacy row written before those columns existed. 🔴 The belt
 * carries a known, accepted cost: under the same double id collision this
 * finding needs, a legitimate INTERNAL receiving community would be refused its
 * own transfer. That trade was confirmed by the engagement coordinator — a rare
 * false refusal is the right price against serving one community another
 * community's transfer amount, sender name and member-written description. Do
 * not "fix" the false negative by removing the guard.
 *
 * 🔴 This change does NOT touch the reconcile job, and does not disturb the
 * condition that accidentally blocks the more dangerous arm of the same
 * conflation (an internal transfer refunded on a third party's word). It relies
 * on the same discriminator from the other direction.
 *
 * These tests assert the CORRECT behaviour and fail before the fix.
 *
 * Prerequisite: the legacy v1 external-federation protocol switched on. It
 * ships disabled; the tests switch it on themselves rather than inheriting it.
 */
final class F487TransactionReadDoesNotConflateTenantAndPartnerIdsTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    /** The community that makes the outbound external transfer. */
    private const OWNER_TENANT_ID = 90894;

    /** The COLLIDING id: both a tenants.id and a federation_external_partners.id. */
    private const COLLIDING_ID = 90895;

    /** A third community with no collision. */
    private const BYSTANDER_TENANT_ID = 90896;

    /** The receiving community of a genuine INTERNAL cross-community transfer. */
    private const INTERNAL_RECEIVER_TENANT_ID = 90897;

    private const SECRET_DESCRIPTION = 'F487 private transfer memo, written by the sending member';

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
        $this->makeTenant(self::OWNER_TENANT_ID, 'e076f487-owner');
        $this->makeTenant(self::COLLIDING_ID, 'e076f487-colliding');
        $this->makeTenant(self::BYSTANDER_TENANT_ID, 'e076f487-bystander');
        $this->makeTenant(self::INTERNAL_RECEIVER_TENANT_ID, 'e076f487-internal-receiver');
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
     * A community whose id happens to equal an external partner's id must NOT be
     * served that partner's transfer.
     */
    public function test_a_colliding_community_is_refused_another_communitys_external_transfer(): void
    {
        $txId = $this->ownerOutboundExternalTransfer();

        $response = $this->readAs(self::COLLIDING_ID, $txId);

        self::assertSame(404, $response->status(), 'an id collision must not be access');
        self::assertStringNotContainsString(
            self::SECRET_DESCRIPTION,
            (string) $response->getContent(),
            'and nothing may leak in the body'
        );
    }

    /**
     * CONTROL, LEGITIMATE ACCESS — the community that actually made the transfer
     * still reads it, through the sender arm.
     */
    public function test_control_the_owning_community_can_still_read_its_own_transfer(): void
    {
        $txId = $this->ownerOutboundExternalTransfer();

        $response = $this->readAs(self::OWNER_TENANT_ID, $txId);

        self::assertSame(200, $response->status(), 'control: the owner reads its own transfer');
        self::assertSame(
            self::SECRET_DESCRIPTION,
            (string) ($response->json('data.description') ?? ''),
            'control: with its own content intact'
        );
    }

    /**
     * CONTROL, LEGITIMATE ACCESS — the receiver arm is narrowed, not removed. A
     * genuine INTERNAL cross-community transfer is still readable by the
     * community that received it. It differs from the refused case above only in
     * being an internal transfer rather than an outbound external one.
     */
    public function test_control_an_internal_cross_community_receiver_can_still_read_its_transfer(): void
    {
        $txId = $this->internalCrossCommunityTransfer();

        $response = $this->readAs(self::INTERNAL_RECEIVER_TENANT_ID, $txId);

        self::assertSame(200, $response->status(), 'control: the receiving community still reads it');
        self::assertSame(
            self::SECRET_DESCRIPTION,
            (string) ($response->json('data.description') ?? ''),
            'control: with its own content intact'
        );
    }

    /** CONTROL — an unrelated community with no collision is still refused. */
    public function test_control_a_non_colliding_community_is_refused(): void
    {
        $txId = $this->ownerOutboundExternalTransfer();

        $response = $this->readAs(self::BYSTANDER_TENANT_ID, $txId);

        self::assertSame(404, $response->status(), 'control: no collision, no access');
        self::assertStringNotContainsString(
            self::SECRET_DESCRIPTION,
            (string) $response->getContent(),
            'control: and nothing leaks in the body'
        );
    }

    /**
     * THE CAUSE, pinned — the column really does carry two id spaces, and the
     * platform's own reconcile join still reads it as a partner id. The fix must
     * not have disturbed that convention.
     */
    public function test_the_reconcile_join_still_reads_the_column_as_a_partner_id(): void
    {
        $txId = $this->ownerOutboundExternalTransfer();

        $resolvedPartner = DB::table('transactions as tx')
            ->join('federation_external_partners as ep', function ($join): void {
                $join->on('ep.id', '=', 'tx.receiver_tenant_id')
                    ->on('ep.tenant_id', '=', 'tx.tenant_id');
            })
            ->where('tx.id', $txId)
            ->value('ep.id');

        self::assertSame(
            self::COLLIDING_ID,
            (int) $resolvedPartner,
            'the same column resolves to an external PARTNER here'
        );
        self::assertSame(
            self::COLLIDING_ID,
            (int) DB::table('tenants')->where('id', self::COLLIDING_ID)->value('id'),
            'and to a real COMMUNITY there — one column, two id spaces, no discriminator'
        );
    }

    // ── harness ─────────────────────────────────────────────────────────────

    private function readAs(int $tenantId, int $txId): \Illuminate\Testing\TestResponse
    {
        $apiKey = $this->mintKeyFor($tenantId, ['transactions:read']);
        $this->useKey($apiKey, 'GET', '/api/v1/federation/transactions/' . $txId);

        return $this->apiGet('/v1/federation/transactions/' . $txId, ['X-API-Key' => $apiKey]);
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /**
     * The owning community sends time credits to an external partner, exactly
     * the way FederationV2Controller::sendExternalTransaction() records it —
     * partner id in `receiver_tenant_id`, plus the partner idempotency key only
     * that path writes.
     */
    private function ownerOutboundExternalTransfer(): int
    {
        $sender = $this->memberOf(self::OWNER_TENANT_ID, 'F487owner');

        DB::table('federation_external_partners')->insert([
            'id' => self::COLLIDING_ID,
            'tenant_id' => self::OWNER_TENANT_ID,
            'name' => 'E076 F-487 external partner',
            'base_url' => 'https://93.184.216.202',
            'api_path' => '/api/v1',
            'protocol_type' => 'nexus',
            'auth_method' => 'api_key',
            'api_key' => 'f487-fixture-key',
            'signing_secret' => 'f487-fixture-secret',
            'status' => 'active',
            'allow_transactions' => 1,
            'created_at' => now(),
        ]);

        // The local record's receiver_id is externalMemberNumericSurrogate() of
        // the remote member id. getTransaction() INNER JOINs users on it, so the
        // second collision this finding needs is modelled rather than assumed.
        $surrogate = $this->memberOf(self::OWNER_TENANT_ID, 'F487surrogate');

        return (int) DB::table('transactions')->insertGetId([
            'tenant_id' => self::OWNER_TENANT_ID,
            'sender_id' => (int) $sender->id,
            'receiver_id' => (int) $surrogate->id,
            'amount' => 42.0,
            'description' => self::SECRET_DESCRIPTION,
            'status' => 'pending',
            'is_federated' => 1,
            'sender_tenant_id' => self::OWNER_TENANT_ID,
            'receiver_tenant_id' => self::COLLIDING_ID,
            'federation_partner_idempotency_key' => 'f487-outbound-' . uniqid('', true),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * A genuine INTERNAL cross-community transfer, recorded the way
     * FederationV2Controller::sendTransaction() records one: `receiver_tenant_id`
     * is a real community id and no partner idempotency key is written.
     */
    private function internalCrossCommunityTransfer(): int
    {
        $sender = $this->memberOf(self::OWNER_TENANT_ID, 'F487intsender');
        $receiver = $this->memberOf(self::INTERNAL_RECEIVER_TENANT_ID, 'F487intreceiver');

        return (int) DB::table('transactions')->insertGetId([
            'tenant_id' => self::OWNER_TENANT_ID,
            'sender_id' => (int) $sender->id,
            'receiver_id' => (int) $receiver->id,
            'amount' => 9.0,
            'description' => self::SECRET_DESCRIPTION,
            'status' => 'completed',
            'is_federated' => 1,
            'sender_tenant_id' => self::OWNER_TENANT_ID,
            'receiver_tenant_id' => self::INTERNAL_RECEIVER_TENANT_ID,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function memberOf(int $tenantId, string $firstName): User
    {
        $user = User::factory()->forTenant($tenantId)->create(['status' => 'active']);
        DB::table('users')->where('id', $user->id)->update([
            'tenant_id' => $tenantId,
            'first_name' => $firstName,
            'last_name' => 'Member',
        ]);

        return $user;
    }

    /** @param array<int,string> $scopes */
    private function mintKeyFor(int $tenantId, array $scopes): string
    {
        $keyValue = bin2hex(random_bytes(32));
        DB::table('federation_api_keys')->insert([
            'tenant_id' => $tenantId,
            'name' => 'F487 key for tenant ' . $tenantId,
            'key_hash' => hash('sha256', $keyValue),
            'key_prefix' => substr($keyValue, 0, 8),
            'permissions' => json_encode($scopes),
            'status' => 'active',
            'created_at' => now(),
        ]);

        return $keyValue;
    }

    private function makeTenant(int $id, string $slug): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => $id],
            [
                'name' => 'E076 F-487 ' . $slug,
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

    private function useKey(string $apiKey, string $method, string $uri): void
    {
        FederationApiMiddleware::reset();
        $_SERVER['HTTP_X_API_KEY'] = $apiKey;
        $_SERVER['REQUEST_METHOD'] = $method;
        $_SERVER['REQUEST_URI'] = $uri;
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    }
}
