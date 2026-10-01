<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\MemberVettingAttestationService;
use App\Services\SafeguardingJurisdictionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-421 — a broker must not decide the safeguarding vetting of an account they
 * do not outrank.
 *
 * `MemberVettingAttestationService::assertActorMayDecideForMember()` blocked a
 * SELF decision and nothing else: no `AdminTier::outranks()`, no rank
 * comparison. `POST /v2/admin/vetting/user/{userId}/revoke` is reachable by any
 * broker (`BaseApiController::requireVettingDecisionMaker()` returns
 * immediately for role 'broker'), so a broker could revoke an ADMINISTRATOR's
 * confirmed attestation: `decision` became 'revoked' with `revoked_by` = the
 * broker, and `hasConfirmedAttestation()` — the predicate
 * `SafeguardingInteractionPolicy` reads before permitting contact with a
 * safeguarded member — flipped true to false for that administrator.
 *
 * The in-house counter-example is the F-219 fix in
 * `AdminTimebankingController::adjustBalance()`: the rank guard applies only
 * when the caller is NOT admin tier, so admin tiers keep full latitude while an
 * operational role may act only on accounts it strictly outranks.
 *
 * These tests assert the CORRECT behaviour — they fail before the fix.
 */
final class F421VettingDecisionRequiresRankOverTargetTest extends TestCase
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

    /** HARM — the broker must no longer be able to strip an administrator's clearance. */
    public function test_a_broker_is_refused_when_revoking_an_administrators_vetting(): void
    {
        $policy = $this->configurePolicy();
        $broker = $this->staff('broker');
        $admin = $this->staff('admin');
        $confirmer = $this->staff('admin');

        $attestations = app(MemberVettingAttestationService::class);
        $attestations->confirmForCurrentPolicy(
            $this->testTenantId,
            (int) $admin->id,
            (int) $confirmer->id,
        );

        self::assertTrue(
            $this->isVetted($attestations, $policy, (int) $admin->id),
            'precondition: the administrator is vetted for safeguarded contact'
        );

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiPost("/v2/admin/vetting/user/{$admin->id}/revoke", [
            'reason_code' => 'community_decision_withdrawn',
        ]);

        self::assertSame(403, $res->getStatusCode(), 'the broker must be refused. ' . $res->getContent());
        self::assertStringContainsString('INSUFFICIENT_PERMISSIONS', $res->getContent());

        $row = DB::table('member_vetting_attestations')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $admin->id)
            ->first();

        self::assertSame('confirmed', (string) $row->decision, 'the administrator\'s attestation is untouched');
        self::assertNull($row->revoked_by, 'nothing was recorded as revoking it');
        self::assertTrue(
            $this->isVetted($attestations, $policy, (int) $admin->id),
            'the administrator still passes the vetted-contact gate'
        );
    }

    /** HARM (sibling path) — the same rank rule must hold on CONFIRM, not only revoke. */
    public function test_a_broker_is_refused_when_confirming_an_administrators_vetting(): void
    {
        $this->configurePolicy();
        $broker = $this->staff('broker');
        $admin = $this->staff('admin');

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiPost("/v2/admin/vetting/user/{$admin->id}/confirm", [
            'acknowledgement' => true,
        ]);

        self::assertSame(403, $res->getStatusCode(), 'the broker must be refused. ' . $res->getContent());
        self::assertFalse(
            DB::table('member_vetting_attestations')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $admin->id)
                ->exists(),
            'no attestation row was written for the administrator'
        );
    }

    /**
     * CONTROL A — the existing self-decision refusal must still fire, with its
     * own reason code, unchanged.
     */
    public function test_control_the_same_broker_is_still_refused_when_revoking_their_own_vetting(): void
    {
        $this->configurePolicy();
        $broker = $this->staff('broker');
        $confirmer = $this->staff('admin');

        app(MemberVettingAttestationService::class)->confirmForCurrentPolicy(
            $this->testTenantId,
            (int) $broker->id,
            (int) $confirmer->id,
        );

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiPost("/v2/admin/vetting/user/{$broker->id}/revoke", [
            'reason_code' => 'community_decision_withdrawn',
        ]);

        self::assertSame(403, $res->getStatusCode(), 'CONTROL: the self-revocation is refused. ' . $res->getContent());
        self::assertStringContainsString('VETTING_SELF_CONFIRMATION_FORBIDDEN', $res->getContent());
        self::assertSame(
            'confirmed',
            (string) DB::table('member_vetting_attestations')
                ->where('tenant_id', $this->testTenantId)->where('user_id', $broker->id)->value('decision'),
            'CONTROL: the broker\'s own attestation is untouched'
        );
    }

    /**
     * CONTROL B — legitimate access. The same broker revoking an ORDINARY
     * member's vetting still works. It differs from the harm case only in the
     * tier of the subject.
     */
    public function test_control_a_broker_may_still_revoke_an_ordinary_members_vetting(): void
    {
        $this->configurePolicy();
        $broker = $this->staff('broker');
        $member = $this->staff('member');
        $confirmer = $this->staff('admin');

        app(MemberVettingAttestationService::class)->confirmForCurrentPolicy(
            $this->testTenantId,
            (int) $member->id,
            (int) $confirmer->id,
        );

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiPost("/v2/admin/vetting/user/{$member->id}/revoke", [
            'reason_code' => 'community_decision_withdrawn',
        ]);

        self::assertSame(200, $res->getStatusCode(), 'CONTROL: the legitimate case still works. ' . $res->getContent());
        self::assertSame(
            'revoked',
            (string) DB::table('member_vetting_attestations')
                ->where('tenant_id', $this->testTenantId)->where('user_id', $member->id)->value('decision')
        );
    }

    /**
     * CONTROL C — legitimate access at the admin tier. An administrator may
     * still revoke a PEER administrator's vetting; admin tiers keep full
     * latitude, exactly as the F-219 guard does. Differs from the harm case
     * only in the tier of the caller.
     */
    public function test_control_an_administrator_may_still_revoke_a_peer_administrators_vetting(): void
    {
        $this->configurePolicy();
        $actingAdmin = $this->staff('admin');
        $admin = $this->staff('admin');
        $confirmer = $this->staff('admin');

        app(MemberVettingAttestationService::class)->confirmForCurrentPolicy(
            $this->testTenantId,
            (int) $admin->id,
            (int) $confirmer->id,
        );

        Sanctum::actingAs($actingAdmin, ['*']);
        $res = $this->apiPost("/v2/admin/vetting/user/{$admin->id}/revoke", [
            'reason_code' => 'community_decision_withdrawn',
        ]);

        self::assertSame(200, $res->getStatusCode(), 'CONTROL: admin-tier latitude is preserved. ' . $res->getContent());
        self::assertSame(
            'revoked',
            (string) DB::table('member_vetting_attestations')
                ->where('tenant_id', $this->testTenantId)->where('user_id', $admin->id)->value('decision')
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @return array<string, mixed> */
    private function configurePolicy(): array
    {
        $jurisdictions = app(SafeguardingJurisdictionService::class);
        $configurer = $this->staff('admin');
        $jurisdictions->configure($this->testTenantId, 'ireland', (int) $configurer->id);
        $policy = $jurisdictions->getPolicyUncached($this->testTenantId);
        self::assertTrue((bool) $policy['configured'], 'fixture: the community has a safeguarding policy');

        return $policy;
    }

    /** @param array<string, mixed> $policy */
    private function isVetted(MemberVettingAttestationService $attestations, array $policy, int $userId): bool
    {
        return $attestations->hasConfirmedAttestation(
            $this->testTenantId,
            $userId,
            (string) $policy['scheme_code'],
            (string) $policy['attestation_code'],
            (string) $policy['purpose_code'],
            (string) $policy['scope_type'],
            (string) $policy['scope_identifier'],
        );
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
}
