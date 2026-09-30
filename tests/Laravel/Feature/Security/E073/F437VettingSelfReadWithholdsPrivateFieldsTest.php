<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-437 (E-073, residual gap in F-402) — a vetting decision-maker read the
 * safeguarding officer's decrypted private notes about their own clearance.
 *
 * `BaseApiController::requireVettingDecisionMaker()` admits role `broker`
 * deliberately, and neither `AdminVettingController::getUserRecords()` nor
 * `::show()` compared the record's subject with the caller.
 * `MemberVettingAttestationService::serializeAttestationRow()` decrypts
 * `scope_summary` and `private_notes`, so the subject received both, plus the
 * internal `revocation_reason_code` and the deciding officer's name.
 *
 * The platform had already decided what a subject may see about their own
 * vetting: `MemberVettingAttestationService::getMemberStatus()` (the member
 * route GET /v2/safeguarding/my-vetting-status) returns the policy, the
 * decision, the review status and four dates, and withholds exactly those four
 * fields. The admin routes now agree with it: a decision-maker still reads
 * their own clearance state — the capability is kept — but the four private
 * fields are withheld from their own record.
 *
 * F-402's write guard (a self-decision is refused) is unchanged and re-tested
 * here, because this is a residual gap in that fix rather than a rediscovery.
 *
 * Adapted from `.local-docs-archive/security-log/E-073/repro/c/C5BrokerReadsOwnVettingPrivateNotesTest.php`,
 * which asserted the harm; the attack assertions are inverted.
 */
final class F437VettingSelfReadWithholdsPrivateFieldsTest extends TestCase
{
    use DatabaseTransactions;

    private const PRIVATE_NOTE = 'F437-PRIVATENOTE-disclosure-withheld-pending-police-response';
    private const SCOPE_SUMMARY = 'F437-SCOPE-child-facing-activity-restricted';

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
     * HARM — the subject asks the admin vetting route about themselves. The
     * request still succeeds (they may see their own clearance state), but the
     * four private fields must not be in the answer.
     */
    public function test_the_subject_does_not_receive_the_private_fields_of_their_own_record(): void
    {
        $broker = $this->staff('broker');
        $officer = $this->staff('admin');
        $this->attestation((int) $broker->id, (int) $officer->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet('/v2/admin/vetting/user/' . $broker->id);

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        $records = $res->json('data');
        self::assertIsArray($records);
        self::assertNotEmpty($records, 'precondition: the caller has a vetting record');
        $record = $records[0];

        // Precondition: this really is the caller's own record.
        self::assertSame((int) $broker->id, (int) $record['user_id']);

        // The clearance state itself is still readable — this is a guard, not a
        // removed capability.
        self::assertSame('revoked', (string) $record['decision']);
        self::assertNotNull($record['revoked_at']);

        self::assertNull($record['private_notes'] ?? null,
            'the officer\'s private note about the caller must be withheld');
        self::assertNull($record['scope_summary'] ?? null,
            'the private scope summary about the caller must be withheld');
        self::assertNull($record['revocation_reason_code'] ?? null,
            'the internal reason code for the caller\'s own revocation must be withheld');
        self::assertNull($record['confirmed_by_name'] ?? null,
            'the name of the officer who decided the caller\'s case must be withheld');

        $body = (string) $res->getContent();
        self::assertStringNotContainsString(self::PRIVATE_NOTE, $body);
        self::assertStringNotContainsString(self::SCOPE_SUMMARY, $body);
        self::assertStringNotContainsString('safeguarding_concern', $body);
    }

    /**
     * HARM 2 — the single-record route has the same gate and had the same gap,
     * so a fix to getUserRecords() alone would leave this route serving it.
     */
    public function test_the_single_record_route_also_withholds_them(): void
    {
        $broker = $this->staff('broker');
        $officer = $this->staff('admin');
        $attestationId = $this->attestation((int) $broker->id, (int) $officer->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet('/v2/admin/vetting/' . $attestationId);

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        $record = $res->json('data');
        self::assertSame((int) $broker->id, (int) $record['user_id']);

        self::assertNull($record['private_notes'] ?? null,
            'the single-record route must withhold the private note too');
        self::assertNull($record['scope_summary'] ?? null);
        self::assertNull($record['revocation_reason_code'] ?? null);
        self::assertNull($record['confirmed_by_name'] ?? null);

        $body = (string) $res->getContent();
        self::assertStringNotContainsString(self::PRIVATE_NOTE, $body);
        self::assertStringNotContainsString(self::SCOPE_SUMMARY, $body);
    }

    /**
     * CONTROL 1 — legitimate vetting work is unaffected: the same broker
     * reading ANOTHER member's record still receives every field, so the
     * guarded case differs only in whose record it is.
     */
    public function test_control_the_same_broker_still_reads_another_members_record_in_full(): void
    {
        $broker = $this->staff('broker');
        $other = $this->staff('member');
        $officer = $this->staff('admin');
        $this->attestation((int) $other->id, (int) $officer->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet('/v2/admin/vetting/user/' . $other->id);

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        $record = ($res->json('data'))[0];
        self::assertSame((int) $other->id, (int) $record['user_id']);
        self::assertSame(self::PRIVATE_NOTE, (string) $record['private_notes'],
            'CONTROL: a broker reading someone else\'s record is unchanged');
        self::assertSame(self::SCOPE_SUMMARY, (string) $record['scope_summary']);
        self::assertSame('safeguarding_concern', (string) $record['revocation_reason_code']);
        self::assertNotNull($record['confirmed_by_name']);
    }

    /**
     * CONTROL 2 — the same holds for the single-record route, which is the one
     * an officer uses to open a member's record.
     */
    public function test_control_the_single_record_route_still_serves_another_members_record(): void
    {
        $broker = $this->staff('broker');
        $other = $this->staff('member');
        $officer = $this->staff('admin');
        $attestationId = $this->attestation((int) $other->id, (int) $officer->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet('/v2/admin/vetting/' . $attestationId);

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        $record = $res->json('data');
        self::assertSame(self::PRIVATE_NOTE, (string) $record['private_notes'],
            'CONTROL: the single-record route is unchanged for another member');
        self::assertSame('safeguarding_concern', (string) $record['revocation_reason_code']);
    }

    /**
     * CONTROL 3 — the member-facing route is the platform's own decision about
     * what a subject may see, and it withholds the same four fields. This keeps
     * the comparison measured rather than asserted.
     */
    public function test_control_the_member_facing_route_still_withholds_all_of_it(): void
    {
        $broker = $this->staff('broker');
        $officer = $this->staff('admin');
        $this->attestation((int) $broker->id, (int) $officer->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet('/v2/safeguarding/my-vetting-status');

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        $body = (string) $res->getContent();
        self::assertStringNotContainsString(self::PRIVATE_NOTE, $body);
        self::assertStringNotContainsString(self::SCOPE_SUMMARY, $body);
        self::assertStringNotContainsString('safeguarding_concern', $body);
    }

    /**
     * RE-TEST of F-402 — the write guard still refuses a self-decision, which
     * is what makes this a residual gap in that fix rather than a rediscovery.
     */
    public function test_retest_f402_the_self_decision_guard_still_refuses(): void
    {
        $broker = $this->staff('broker');
        $officer = $this->staff('admin');
        $this->attestation((int) $broker->id, (int) $officer->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiPost('/v2/admin/vetting/user/' . $broker->id . '/confirm', [
            'scheme_code' => 'f437', 'attestation_code' => 'f437', 'purpose_code' => 'f437',
        ]);

        self::assertNotSame(200, $res->getStatusCode(),
            'F-402 guard HELD check: a self-confirmation must not succeed. ' . $res->getContent());
        self::assertStringNotContainsString('"decision":"confirmed"', (string) $res->getContent());
    }

    // ----- fixtures -----

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

    /** A revoked attestation carrying the officer's encrypted private notes. */
    private function attestation(int $memberId, int $officerId): int
    {
        return (int) DB::table('member_vetting_attestations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $memberId,
            'scheme_code' => 'f437_scheme',
            'attestation_code' => 'f437_attestation',
            'purpose_code' => 'f437_purpose',
            'certification_codes' => json_encode(['f437_cert']),
            'scope_type' => 'tenant',
            'scope_identifier' => '',
            'scope_summary_encrypted' => Crypt::encryptString(self::SCOPE_SUMMARY),
            'private_notes_encrypted' => Crypt::encryptString(self::PRIVATE_NOTE),
            'decision' => 'revoked',
            'confirmed_by' => $officerId,
            'confirmed_at' => now()->subDays(30),
            'revoked_by' => $officerId,
            'revoked_at' => now(),
            'revocation_reason_code' => 'safeguarding_concern',
            'policy_version' => '1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
