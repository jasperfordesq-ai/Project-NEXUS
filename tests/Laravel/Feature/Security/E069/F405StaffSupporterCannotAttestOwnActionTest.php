<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-405 — a member of staff who is ALSO the supporter on a support relationship
 * must not be able to record the supported member's consent to their own
 * prepared action.
 *
 * The platform's own rule, in `App\Support\Safeguarding\SupportTiers`:
 *   "`co_decide` … supporter prepares; supported member confirms"
 *   "staff prepare, the member confirms; staff never act alone."
 *
 * The two member-facing paths honoured it — `confirmInApp()` scopes by
 * `supported_user_id`, `confirmByToken()` needs the member's emailed token.
 * The staff path `confirmAttested()` scoped on the action id alone, so a staff
 * supporter signed off their own request as "confirmed by the member, offline".
 * For a credit_transfer that moved real credits out of a supported member's
 * wallet — by definition a member who has a supporter — with no act of consent
 * by that member anywhere in the record.
 */
final class F405StaffSupporterCannotAttestOwnActionTest extends TestCase
{
    use DatabaseTransactions;

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
    }

    /**
     * THE FIX. The supporter is a member of safeguarding staff. They prepare a
     * transfer out of the supported member's wallet, then try to sign off their
     * own request. It must be refused and no credit may move.
     */
    public function test_a_staff_supporter_cannot_attest_their_own_pending_action(): void
    {
        $supporterStaff = $this->staff('admin');
        $supported = $this->staff('member');
        $recipient = $this->staff('member');

        DB::table('users')->where('id', $supported->id)->update(['balance' => 40]);
        DB::table('users')->where('id', $recipient->id)->update(['balance' => 0]);

        $relationshipId = $this->relationship((int) $supporterStaff->id, (int) $supported->id);
        $actionId = $this->pendingCreditTransfer(
            $relationshipId,
            (int) $supporterStaff->id,
            (int) $supported->id,
            (int) $recipient->id,
            12.0
        );

        Sanctum::actingAs($supporterStaff, ['*']);
        $res = $this->apiPost("/v2/admin/safeguarding/support-actions/{$actionId}/attest", [
            'channel' => 'phone',
            'witness' => 'F-405 regression',
        ]);

        self::assertNotSame(
            200,
            $res->getStatusCode(),
            'A staff supporter must not attest their own request. ' . $res->getContent()
        );

        $row = DB::table('support_pending_actions')->where('id', $actionId)->first();
        self::assertSame('pending', (string) $row->status, 'the action must stay pending');
        self::assertNull($row->attested_by_user_id, 'nobody may be recorded as having witnessed it');
        self::assertNull($row->result_id, 'no wallet transaction may be written');

        self::assertSame(40.0, $this->balance((int) $supported->id), 'the supported member keeps their credits');
        self::assertSame(0.0, $this->balance((int) $recipient->id), 'no credits arrive at the chosen recipient');
    }

    /**
     * CONTROL — legitimate access. A member of staff who is NOT a party still
     * attests successfully, so the fix is a party check and not the removal of
     * the route. This is the arm that must keep working: a supported member who
     * cannot use the platform directly still has to be able to agree by phone.
     */
    public function test_control_uninvolved_staff_may_still_attest(): void
    {
        $uninvolvedStaff = $this->staff('admin');
        $supporter = $this->staff('member');
        $supported = $this->staff('member');
        $recipient = $this->staff('member');

        DB::table('users')->where('id', $supported->id)->update(['balance' => 40]);
        DB::table('users')->where('id', $recipient->id)->update(['balance' => 0]);

        $relationshipId = $this->relationship((int) $supporter->id, (int) $supported->id);
        $actionId = $this->pendingCreditTransfer(
            $relationshipId,
            (int) $supporter->id,
            (int) $supported->id,
            (int) $recipient->id,
            5.0
        );

        Sanctum::actingAs($uninvolvedStaff, ['*']);
        $res = $this->apiPost("/v2/admin/safeguarding/support-actions/{$actionId}/attest", [
            'channel' => 'in_person',
        ]);

        self::assertSame(200, $res->getStatusCode(), 'the legitimate case must still work. ' . $res->getContent());
        self::assertSame(35.0, $this->balance((int) $supported->id), 'the legitimate attestation executes the action');
        self::assertSame(5.0, $this->balance((int) $recipient->id));
    }

    /**
     * CONTROL — the member's own route is untouched by the fix.
     */
    public function test_control_the_supported_member_can_still_confirm_in_app(): void
    {
        $supporter = $this->staff('member');
        $supported = $this->staff('member');
        $recipient = $this->staff('member');

        DB::table('users')->where('id', $supported->id)->update(['balance' => 40]);
        DB::table('users')->where('id', $recipient->id)->update(['balance' => 0]);

        $relationshipId = $this->relationship((int) $supporter->id, (int) $supported->id);
        $actionId = $this->pendingCreditTransfer(
            $relationshipId,
            (int) $supporter->id,
            (int) $supported->id,
            (int) $recipient->id,
            7.0
        );

        Sanctum::actingAs($supported, ['*']);
        $res = $this->apiPost("/v2/users/me/support-actions/{$actionId}/confirm", []);

        self::assertSame(200, $res->getStatusCode(), 'the member confirming their own action must still work. ' . $res->getContent());
        self::assertSame(33.0, $this->balance((int) $supported->id));
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function balance(int $userId): float
    {
        return (float) DB::table('users')->where('id', $userId)->value('balance');
    }

    private function staff(string $role): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => $role,
            'is_admin' => $role === 'admin' ? 1 : 0,
        ]);

        return User::find($u->id);
    }

    /** An active support relationship carrying co_decide on credits. */
    private function relationship(int $supporterId, int $supportedId): int
    {
        return (int) DB::table('account_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $supporterId,
            'child_user_id' => $supportedId,
            'relationship_type' => 'carer',
            'permissions' => json_encode([
                'tiers' => ['credits' => 'co_decide', 'activity' => 'assist'],
                'can_view_activity' => true,
                'can_manage_listings' => false,
                'can_transact' => false,
            ]),
            'status' => 'active',
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** The row SupportActionController::prepare() writes for a co_decide transfer. */
    private function pendingCreditTransfer(
        int $relationshipId,
        int $supporterId,
        int $supportedId,
        int $recipientId,
        float $amount
    ): int {
        return (int) DB::table('support_pending_actions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'relationship_id' => $relationshipId,
            'supported_user_id' => $supportedId,
            'supporter_user_id' => $supporterId,
            'action_type' => 'credit_transfer',
            'payload' => json_encode([
                'recipient' => (string) $recipientId,
                'amount' => $amount,
                'description' => 'F-405 regression fixture',
            ]),
            'status' => 'pending',
            'token_hash' => hash('sha256', bin2hex(random_bytes(16))),
            'expires_at' => now()->addDays(7),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
