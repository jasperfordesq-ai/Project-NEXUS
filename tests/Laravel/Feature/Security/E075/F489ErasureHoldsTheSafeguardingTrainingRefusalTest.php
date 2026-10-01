<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\Enterprise\GdprService;
use App\Services\SafeguardingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * F-489 (E-075 H-2) — F-339's erasure hold covered the staff VETTING decision
 * but not the staff SAFEGUARDING-TRAINING decision.
 *
 * F-339's reason, written into GdprService itself, is that "the subject of a
 * refused vetting decision could erase the community's record of it
 * themselves". Forty lines earlier the same erasure run still issued an
 * unconditional `DELETE FROM vol_safeguarding_training`, and once staff have
 * acted that row carries their decision: `status` = `rejected`, `verified_by`,
 * `verified_at`, and the free-text refusal reason `rejectTraining()` writes
 * into `notes`.
 *
 * The fix is deliberately the narrow half of the question, matching F-339's
 * stated reason exactly: a row that records a STAFF REFUSAL is held, minimised
 * to the decision; every other training row — the member's own unrefused
 * submissions — is still deleted. Whether a verified or pending training
 * certificate should also survive is an owner policy question and is NOT
 * decided here.
 *
 * Every string in this test is synthetic. No member data is used.
 */
final class F489ErasureHoldsTheSafeguardingTrainingRefusalTest extends TestCase
{
    use DatabaseTransactions;

    private const REJECTION_REASON = 'F489-REJECTED-CERTIFICATE-COULD-NOT-BE-VERIFIED';
    private const MEMBER_SUBMITTED_NAME = 'F489 synthetic safeguarding course';
    private const MEMBER_SUBMITTED_PROVIDER = 'F489 synthetic training provider';

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
     * THE FIX — the community's record of a staff REFUSAL survives the subject's
     * own erasure, minimised to the decision; and an unrefused submission by the
     * same member in the same run is still deleted.
     */
    public function test_erasure_holds_the_training_refusal_and_still_deletes_the_rest(): void
    {
        $member  = $this->member();
        $admin   = $this->admin();
        $service = app(SafeguardingService::class);

        // A real submission, refused by a real administrator through the
        // production service method.
        $refusedId = $this->submission($service, (int) $member->id);
        self::assertTrue(
            $service->rejectTraining($refusedId, (int) $admin->id, self::REJECTION_REASON, $this->testTenantId),
            'precondition: the administrator refused it'
        );

        // CONTROL (the counterweight) — a second submission by the same member
        // that no member of staff has refused. It must still be erased, so the
        // fix cannot be mistaken for "erasure stopped deleting this table".
        $untouchedId = $this->submission($service, (int) $member->id);

        $before = DB::table('vol_safeguarding_training')->where('id', $refusedId)->first();
        self::assertNotNull($before, 'precondition: the refusal row exists');
        self::assertSame('rejected', (string) $before->status, 'precondition: it records the refusal');
        self::assertSame((int) $admin->id, (int) $before->verified_by, 'precondition: it names the administrator');
        self::assertSame(self::REJECTION_REASON, (string) $before->notes, 'precondition: it records why');

        // The comparator F-339 explicitly holds: a refused vetting decision.
        $attestationId = $this->refusedVettingAttestation((int) $member->id, (int) $admin->id);

        // The member erases their own account (the self-service path).
        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $member->id);

        // THE FIX — the staff refusal survives, and still says who decided,
        // when, and why.
        $held = DB::table('vol_safeguarding_training')->where('id', $refusedId)->first();
        self::assertNotNull($held, 'the community\'s record of the staff refusal must survive the subject\'s erasure');
        self::assertSame('rejected', (string) $held->status, 'the refusal decision itself must survive');
        self::assertSame((int) $admin->id, (int) $held->verified_by, 'the deciding administrator must survive');
        self::assertNotNull($held->verified_at, 'the date of the decision must survive');
        self::assertSame(self::REJECTION_REASON, (string) $held->notes, 'the reason given for the refusal must survive');

        // The held row is minimised to the decision: the member's own submission
        // detail and its evidence pointers are still erased, the same way F-339
        // minimises a pointer-bearing vetting_records row.
        self::assertNull($held->training_name, 'the member\'s own submitted course name must still be erased');
        self::assertNull($held->provider, 'the member\'s own submitted provider must still be erased');
        self::assertNull($held->certificate_reference, 'the member\'s certificate reference must still be erased');
        self::assertNull($held->certificate_url, 'the certificate pointer must still be erased');
        self::assertNull($held->document_path, 'the document pointer must still be erased');

        // CONTROL (erasure still erases) — the unrefused submission is gone.
        self::assertNull(
            DB::table('vol_safeguarding_training')->where('id', $untouchedId)->first(),
            'control: a submission no member of staff refused is still deleted by erasure'
        );
        self::assertSame(
            1,
            DB::table('vol_safeguarding_training')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', (int) $member->id)
                ->count(),
            'control: exactly one row is held — the refusal — and nothing else'
        );

        // CONTROL (F-339's own hold still works) — unchanged by this fix.
        $heldVetting = DB::table('member_vetting_attestations')->where('id', $attestationId)->first();
        self::assertNotNull($heldVetting, 'control: F-339 still holds the refused vetting decision');
        self::assertSame(
            (int) $admin->id,
            (int) $heldVetting->confirmed_by,
            'control: and it still names the staff member who made it'
        );

        // CONTROL (the erasure really ran) — the users row was anonymised, so
        // none of the above is a no-op or a failed run.
        $erasedUser = DB::table('users')->where('id', (int) $member->id)->first(['name', 'anonymized_at']);
        self::assertNotNull($erasedUser, 'control: the users row is anonymised in place, not dropped');
        self::assertSame('Deleted User', (string) $erasedUser->name, 'control: the erasure really executed');
        self::assertNotNull($erasedUser->anonymized_at, 'control: and stamped anonymized_at');
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function submission(SafeguardingService $service, int $userId): int
    {
        $record = $service->recordTraining($userId, [
            'training_type'   => 'vulnerable_adults',
            'training_name'   => self::MEMBER_SUBMITTED_NAME,
            'provider'        => self::MEMBER_SUBMITTED_PROVIDER,
            'certificate_url' => 'https://example.invalid/f489-synthetic-certificate',
            'completed_at'    => now()->subMonth()->toDateString(),
        ], $this->testTenantId);

        self::assertIsArray($record, 'precondition: the training submission was recorded');
        $id = (int) ($record['id'] ?? 0);
        self::assertGreaterThan(0, $id, 'precondition: the submission has an id');

        DB::table('vol_safeguarding_training')
            ->where('id', $id)
            ->update(['certificate_reference' => 'F489-REF', 'document_path' => 'f489/synthetic/path.pdf']);

        return $id;
    }

    private function refusedVettingAttestation(int $userId, int $adminId): int
    {
        return (int) DB::table('member_vetting_attestations')->insertGetId([
            'tenant_id'         => $this->testTenantId,
            'user_id'           => $userId,
            'scheme_code'       => 'f489_scheme',
            'attestation_code'  => 'f489_attestation',
            'purpose_code'      => 'f489_purpose',
            'scope_type'        => 'tenant',
            'scope_identifier'  => '',
            'decision'          => 'refused',
            'confirmed_by'      => $adminId,
            'confirmed_at'      => now(),
            'policy_version'    => '1',
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);
    }

    private function member(): User
    {
        return $this->account([]);
    }

    private function admin(): User
    {
        return $this->account(['role' => 'admin', 'is_admin' => 1]);
    }

    /** @param array<string,mixed> $flags */
    private function account(array $flags): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => 1, 'role' => 'member',
        ]);
        DB::table('users')->where('id', $u->id)->update(array_merge([
            'role' => 'member',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
            'status' => 'active',
        ], $flags));

        return User::withoutGlobalScopes()->find($u->id);
    }
}
