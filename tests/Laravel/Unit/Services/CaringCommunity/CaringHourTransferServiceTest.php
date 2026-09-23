<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\CaringHourTransferService;
use App\Services\CaringCommunity\FederationPeerService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use RuntimeException;
use Tests\Laravel\TestCase;

/**
 * CaringHourTransferServiceTest
 *
 * Money-critical: verifies time-credit ("hours") transfers between cooperative
 * tenants. Covers:
 *   - initiate: happy path, guards (zero/negative/over-limit hours, no balance,
 *               source member not found, destination not found, same-tenant cross)
 *   - approveAtSource (same-platform): wallet conservation, ledger rows created,
 *                    transfer rows completed, cross-link set
 *   - rejectAtSource: no funds movement, status flipped to 'rejected'
 *   - memberHistory: returns source-role rows for the member
 *   - pendingAtSource: returns pending source rows with member name
 *   - recentAtDestination: returns destination rows
 *   - signPayload / verifySignature / canonicalJson: crypto correctness
 *   - sharedPlatformSecret: returns a deterministic hex string
 *   - acceptRemoteTransfer: signature gate, idempotency, wallet credit
 */
class CaringHourTransferServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID      = 2;
    private const TENANT_SLUG    = 'hour-timebank';
    private const DST_TENANT_ID  = 999;
    private const DST_TENANT_SLUG = 'test-999';

    private CaringHourTransferService $svc;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);

        // Instantiate with a null FederationPeerService stub so no peers are
        // returned — all tests use same-platform (local tenant) delivery by default.
        $this->svc = $this->makeService(peers: null);

        $this->makeDestinationAPartner();
    }

    /**
     * Same-platform transfers require the destination to have Caring
     * Community enabled and an active partnership with transactions allowed
     * (F-132). Rolled back with the test transaction.
     */
    private function makeDestinationAPartner(): void
    {
        $tenant = DB::table('tenants')->where('id', self::DST_TENANT_ID)->first();
        if ($tenant === null) {
            DB::table('tenants')->insert([
                'id'         => self::DST_TENANT_ID,
                'name'       => 'Transfer Destination 999',
                'slug'       => self::DST_TENANT_SLUG,
                'features'   => json_encode(['caring_community' => true]),
                'is_active'  => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } else {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : null;
            $features = is_array($decoded) ? $decoded : [];
            $features['caring_community'] = true;
            DB::table('tenants')->where('id', self::DST_TENANT_ID)->update([
                'features'  => json_encode($features),
                'is_active' => 1,
            ]);
        }

        DB::table('federation_partnerships')
            ->where(function ($q) {
                $q->where('tenant_id', self::TENANT_ID)->where('partner_tenant_id', self::DST_TENANT_ID);
            })
            ->orWhere(function ($q) {
                $q->where('tenant_id', self::DST_TENANT_ID)->where('partner_tenant_id', self::TENANT_ID);
            })
            ->delete();

        DB::table('federation_partnerships')->insert([
            'tenant_id'            => self::TENANT_ID,
            'partner_tenant_id'    => self::DST_TENANT_ID,
            'canonical_pair'       => min(self::TENANT_ID, self::DST_TENANT_ID) . '-' . max(self::TENANT_ID, self::DST_TENANT_ID),
            'status'               => 'active',
            'federation_level'     => 2,
            'transactions_enabled' => 1,
            'requested_at'         => now(),
            'approved_at'          => now(),
            'created_at'           => now(),
        ]);
    }

    // ── helpers ────────────────────────────────────────────────────────────────

    /**
     * Build the service, optionally injecting a stub FederationPeerService.
     */
    private function makeService(?FederationPeerService $peers = null): CaringHourTransferService
    {
        $stub = $this->createMock(FederationPeerService::class);
        $stub->method('findByPeerSlug')->willReturn(null);
        return new CaringHourTransferService($peers ?? $stub);
    }

    private function insertUser(float $balance = 10.0, string $tag = '', int $tenantId = self::TENANT_ID): int
    {
        $uid = uniqid($tag ?: 'u', true);
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'name'       => 'Transfer Test ' . $uid,
            'first_name' => 'Transfer',
            'last_name'  => 'User',
            'email'      => 'xfer.' . $uid . '@example.test',
            'status'     => 'active',
            'balance'    => $balance,
            'role'       => 'member',
            'is_approved'=> 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Insert a user with a specific email (used for same-platform cross-tenant matching).
     */
    private function insertUserWithEmail(string $email, float $balance = 5.0, int $tenantId = self::TENANT_ID): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'name'       => 'Transfer Test Email ' . $tenantId,
            'first_name' => 'Cross',
            'last_name'  => 'Tenant',
            'email'      => $email,
            'status'     => 'active',
            'balance'    => $balance,
            'role'       => 'member',
            'is_approved'=> 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function getBalance(int $userId): float
    {
        return round((float) DB::table('users')->where('id', $userId)->value('balance'), 2);
    }

    private function getTransferStatus(int $transferId): string
    {
        return (string) DB::table('caring_hour_transfers')->where('id', $transferId)->value('status');
    }

    // ── initiate — happy path ──────────────────────────────────────────────────

    public function test_initiate_inserts_pending_source_row_and_returns_ids(): void
    {
        $email     = 'same.' . uniqid() . '@example.test';
        $sourceId  = $this->insertUserWithEmail($email, 20.0, self::TENANT_ID);
        // Destination tenant already inserted by TestCase::setUpTenantContext (id=999, slug=test-999)
        $this->insertUserWithEmail($email, 5.0, self::DST_TENANT_ID);

        $result = $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 3.00, 'test reason');

        $this->assertArrayHasKey('transfer_id', $result);
        $this->assertSame('pending', $result['status']);
        $this->assertIsInt($result['transfer_id']);

        $row = DB::table('caring_hour_transfers')->where('id', $result['transfer_id'])->first();
        $this->assertNotNull($row);
        $this->assertSame(self::TENANT_ID, (int) $row->tenant_id);
        $this->assertSame('source', (string) $row->role);
        $this->assertSame('pending', (string) $row->status);
        $this->assertSame(3.00, round((float) $row->hours_transferred, 2));
        $this->assertSame($sourceId, (int) $row->member_user_id);
        $this->assertSame(self::DST_TENANT_SLUG, (string) $row->counterpart_tenant_slug);
    }

    // ── initiate — guard: zero / negative hours ────────────────────────────────

    public function test_initiate_throws_for_zero_hours(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Hours must be greater than zero');

        $sourceId = $this->insertUser(10.0, 'src');
        $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 0.0, '');
    }

    public function test_initiate_throws_for_negative_hours(): void
    {
        $this->expectException(InvalidArgumentException::class);

        $sourceId = $this->insertUser(10.0, 'src');
        $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, -1.0, '');
    }

    // ── initiate — guard: hours exceeding SecurityBounds limit (24h) ───────────

    public function test_initiate_throws_when_hours_exceed_single_transfer_limit(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('exceed the permitted single-transfer limit');

        $sourceId = $this->insertUser(100.0, 'src');
        $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 25.0, '');
    }

    // ── initiate — guard: more than 2 decimal places ──────────────────────────

    public function test_initiate_throws_for_too_many_decimal_places(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('at most 2 decimal places');

        $sourceId = $this->insertUser(10.0, 'src');
        $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 1.001, '');
    }

    // ── initiate — guard: insufficient balance ─────────────────────────────────

    public function test_initiate_throws_when_source_has_insufficient_balance(): void
    {
        $email    = 'low.' . uniqid() . '@example.test';
        $sourceId = $this->insertUserWithEmail($email, 2.00, self::TENANT_ID);
        $this->insertUserWithEmail($email, 0.0, self::DST_TENANT_ID);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Insufficient banked hours');

        $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 5.00, 'more than balance');
    }

    // ── initiate — guard: source member not found ──────────────────────────────

    public function test_initiate_throws_when_source_member_not_found(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Source member not found');

        $this->svc->initiate(999999999, self::DST_TENANT_SLUG, 1.00, '');
    }

    // ── initiate — guard: destination not found ────────────────────────────────

    public function test_initiate_throws_when_destination_tenant_not_found(): void
    {
        $sourceId = $this->insertUser(10.0, 'src');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage(__('api.caring_hour_transfer_destination_unavailable'));

        $this->svc->initiate($sourceId, 'no-such-slug-' . uniqid(), 1.00, '');
    }

    // ── initiate — guard: destination is the SAME tenant ─────────────────────

    public function test_initiate_throws_when_destination_is_same_tenant(): void
    {
        $sourceId = $this->insertUser(10.0, 'src');

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Destination cooperative must be different from source');

        // Use own tenant slug → should be rejected
        $this->svc->initiate($sourceId, self::TENANT_SLUG, 1.00, '');
    }

    // ── initiate — guard: no matching member at destination ───────────────────

    public function test_initiate_throws_when_no_matching_member_at_destination(): void
    {
        // Source email does NOT exist in the destination tenant
        $uniqueEmail = 'nomatch.' . uniqid() . '@example.test';
        $sourceId    = $this->insertUserWithEmail($uniqueEmail, 10.0, self::TENANT_ID);
        // Do NOT insert matching user in DST_TENANT_ID

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage(__('api.caring_hour_transfer_destination_unavailable'));

        $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 1.00, 'no dest member');
    }

    // ── initiate — guard: empty destination slug ───────────────────────────────

    public function test_initiate_throws_when_destination_slug_empty(): void
    {
        $sourceId = $this->insertUser(10.0, 'src');

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Destination cooperative is required');

        $this->svc->initiate($sourceId, '', 1.00, '');
    }

    // ── approveAtSource — same-platform happy path ────────────────────────────

    public function test_approveAtSource_debits_source_credits_destination_and_completes_both_rows(): void
    {
        Event::fake();

        $email      = 'approve.' . uniqid() . '@example.test';
        $sourceId   = $this->insertUserWithEmail($email, 10.00, self::TENANT_ID);
        $destUserId = $this->insertUserWithEmail($email, 5.00, self::DST_TENANT_ID);
        $adminId    = $this->insertUser(0.0, 'admin');

        // Initiate then approve
        $initiated  = $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 3.00, 'care package');
        $transferId = $initiated['transfer_id'];

        $result = $this->svc->approveAtSource($transferId, $adminId);

        // Return shape
        $this->assertSame($transferId, $result['transfer_id']);
        $this->assertSame('completed', $result['status']);
        $this->assertIsInt($result['destination_transfer_id']);
        $this->assertGreaterThan(0, $result['destination_transfer_id']);

        // Source wallet DEBITED by exactly 3.00
        $this->assertSame(7.00, $this->getBalance($sourceId));

        // Destination wallet CREDITED by exactly 3.00
        $this->assertSame(8.00, $this->getBalance($destUserId));

        // Source transfer row → completed
        $this->assertSame('completed', $this->getTransferStatus($transferId));

        // Destination transfer row → completed
        $destRowId = $result['destination_transfer_id'];
        $this->assertSame('completed', $this->getTransferStatus($destRowId));

        // Cross-link set on both rows
        $sourceRow = DB::table('caring_hour_transfers')->where('id', $transferId)->first();
        $this->assertSame($destRowId, (int) $sourceRow->linked_transfer_id);

        $destRow = DB::table('caring_hour_transfers')->where('id', $destRowId)->first();
        $this->assertSame('destination', (string) $destRow->role);
        $this->assertSame($transferId, (int) $destRow->linked_transfer_id);
    }

    // ── approveAtSource — wallet conservation: debit == credit ───────────────

    public function test_approveAtSource_wallet_conservation_is_exact(): void
    {
        Event::fake();

        $email       = 'conserv.' . uniqid() . '@example.test';
        $sourceId    = $this->insertUserWithEmail($email, 8.50, self::TENANT_ID);
        $destUserId  = $this->insertUserWithEmail($email, 1.50, self::DST_TENANT_ID);
        $adminId     = $this->insertUser(0.0, 'admin2');

        $balBefore   = $this->getBalance($sourceId);   // 8.50
        $dstBefore   = $this->getBalance($destUserId);  // 1.50
        $hours       = 2.50;

        $initiated  = $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, $hours, 'conservation');
        $this->svc->approveAtSource($initiated['transfer_id'], $adminId);

        $this->assertSame($balBefore - $hours, $this->getBalance($sourceId));
        $this->assertSame($dstBefore + $hours, $this->getBalance($destUserId));
    }

    // ── approveAtSource — transaction rows created ─────────────────────────────

    public function test_approveAtSource_creates_out_and_in_transaction_rows(): void
    {
        Event::fake();

        $email      = 'txnrow.' . uniqid() . '@example.test';
        $sourceId   = $this->insertUserWithEmail($email, 10.00, self::TENANT_ID);
        $destUserId = $this->insertUserWithEmail($email, 0.0, self::DST_TENANT_ID);
        $adminId    = $this->insertUser(0.0, 'admin3');

        $initiated  = $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 4.00, 'txn test');
        $this->svc->approveAtSource($initiated['transfer_id'], $adminId);

        // Source-side debit transaction
        $outTxn = DB::table('transactions')
            ->where('tenant_id', self::TENANT_ID)
            ->where('sender_id', $sourceId)
            ->where('amount', 4.00)
            ->first();
        $this->assertNotNull($outTxn);
        $this->assertStringContainsString('[hour_transfer_out]', (string) $outTxn->description);
        $this->assertSame(1, (int) $outTxn->is_federated);
        $this->assertSame('other', (string) $outTxn->transaction_type);

        // Destination-side credit transaction
        $inTxn = DB::table('transactions')
            ->where('tenant_id', self::DST_TENANT_ID)
            ->where('receiver_id', $destUserId)
            ->where('amount', 4.00)
            ->first();
        $this->assertNotNull($inTxn);
        $this->assertStringContainsString('[hour_transfer_in]', (string) $inTxn->description);
        $this->assertSame(1, (int) $inTxn->is_federated);
    }

    // ── approveAtSource — guard: transfer not found ────────────────────────────

    public function test_approveAtSource_throws_when_transfer_not_found(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Transfer not found');

        $adminId = $this->insertUser(0.0, 'admin');
        $this->svc->approveAtSource(999999999, $adminId);
    }

    // ── approveAtSource — guard: transfer already approved ────────────────────

    public function test_approveAtSource_throws_when_transfer_not_pending(): void
    {
        Event::fake();

        $email      = 'notpend.' . uniqid() . '@example.test';
        $sourceId   = $this->insertUserWithEmail($email, 10.00, self::TENANT_ID);
        $this->insertUserWithEmail($email, 0.0, self::DST_TENANT_ID);
        $adminId    = $this->insertUser(0.0, 'admin');

        $initiated  = $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 1.00, '');
        $transferId = $initiated['transfer_id'];

        // Approve once → status = completed
        $this->svc->approveAtSource($transferId, $adminId);

        // Try to approve again → should fail
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not pending');

        $this->svc->approveAtSource($transferId, $adminId);
    }

    // ── rejectAtSource — happy path ───────────────────────────────────────────

    public function test_rejectAtSource_sets_rejected_status_without_funds_movement(): void
    {
        $email     = 'reject.' . uniqid() . '@example.test';
        $sourceId  = $this->insertUserWithEmail($email, 10.00, self::TENANT_ID);
        $this->insertUserWithEmail($email, 0.0, self::DST_TENANT_ID);
        $adminId   = $this->insertUser(0.0, 'admin');

        $initiated  = $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 2.00, 'reject me');
        $transferId = $initiated['transfer_id'];

        $balBefore = $this->getBalance($sourceId);

        $this->svc->rejectAtSource($transferId, $adminId, 'policy violation');

        // Status changed
        $this->assertSame('rejected', $this->getTransferStatus($transferId));

        // NO funds moved
        $this->assertSame($balBefore, $this->getBalance($sourceId));

        // Reason annotated
        $row = DB::table('caring_hour_transfers')->where('id', $transferId)->first();
        $this->assertStringContainsString('rejected by admin', (string) $row->reason);
        $this->assertStringContainsString('policy violation', (string) $row->reason);
    }

    // ── rejectAtSource — guard: transfer not found ────────────────────────────

    public function test_rejectAtSource_throws_when_transfer_not_found(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Transfer not found');

        $this->svc->rejectAtSource(999999999, 1, 'nope');
    }

    // ── rejectAtSource — guard: only pending may be rejected ──────────────────

    public function test_rejectAtSource_throws_when_transfer_is_not_pending(): void
    {
        Event::fake();

        $email     = 'rejnpend.' . uniqid() . '@example.test';
        $sourceId  = $this->insertUserWithEmail($email, 10.00, self::TENANT_ID);
        $this->insertUserWithEmail($email, 0.0, self::DST_TENANT_ID);
        $adminId   = $this->insertUser(0.0, 'admin');

        $initiated  = $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 1.00, '');
        $transferId = $initiated['transfer_id'];
        $this->svc->approveAtSource($transferId, $adminId);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Only pending transfers can be rejected');

        $this->svc->rejectAtSource($transferId, $adminId, 'too late');
    }

    // ── memberHistory ─────────────────────────────────────────────────────────

    public function test_memberHistory_returns_source_rows_for_member(): void
    {
        $email     = 'hist.' . uniqid() . '@example.test';
        $sourceId  = $this->insertUserWithEmail($email, 20.00, self::TENANT_ID);
        $this->insertUserWithEmail($email, 0.0, self::DST_TENANT_ID);

        // Initiate two transfers
        $r1 = $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 1.00, 'hist1');
        $r2 = $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 2.00, 'hist2');

        $history = $this->svc->memberHistory($sourceId);

        $this->assertIsArray($history);
        // At least the two we inserted
        $this->assertGreaterThanOrEqual(2, count($history));

        $ids = array_column($history, 'id');
        $this->assertContains($r1['transfer_id'], $ids);
        $this->assertContains($r2['transfer_id'], $ids);

        // Shape check on first returned row
        $firstRow = $history[0];
        $this->assertArrayHasKey('destination_tenant_slug', $firstRow);
        $this->assertArrayHasKey('hours', $firstRow);
        $this->assertArrayHasKey('status', $firstRow);
    }

    // ── pendingAtSource ────────────────────────────────────────────────────────

    public function test_pendingAtSource_lists_pending_transfers_with_member_name(): void
    {
        $email    = 'pend.' . uniqid() . '@example.test';
        $sourceId = $this->insertUserWithEmail($email, 10.00, self::TENANT_ID);
        $this->insertUserWithEmail($email, 0.0, self::DST_TENANT_ID);

        $initiated  = $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 1.50, 'for pending test');
        $transferId = $initiated['transfer_id'];

        $pending = $this->svc->pendingAtSource();

        $this->assertIsArray($pending);
        $ids = array_column($pending, 'id');
        $this->assertContains($transferId, $ids);

        $found = array_values(array_filter($pending, fn ($r) => $r['id'] === $transferId))[0];
        $this->assertSame('pending', $found['status']);
        $this->assertSame(1.50, $found['hours']);
        $this->assertArrayHasKey('member_name', $found);
        $this->assertArrayHasKey('destination_tenant_slug', $found);
    }

    // ── recentAtDestination ───────────────────────────────────────────────────

    public function test_recentAtDestination_lists_received_destination_rows(): void
    {
        Event::fake();

        $email      = 'destrecent.' . uniqid() . '@example.test';
        $sourceId   = $this->insertUserWithEmail($email, 10.00, self::TENANT_ID);
        $destUserId = $this->insertUserWithEmail($email, 0.0, self::DST_TENANT_ID);
        $adminId    = $this->insertUser(0.0, 'admin');

        $initiated  = $this->svc->initiate($sourceId, self::DST_TENANT_SLUG, 1.00, 'for dest recent');
        $result     = $this->svc->approveAtSource($initiated['transfer_id'], $adminId);
        $destRowId  = $result['destination_transfer_id'];

        // Switch to destination tenant to call recentAtDestination
        TenantContext::setById(self::DST_TENANT_ID);
        $svcDst = $this->makeService();
        $recent = $svcDst->recentAtDestination();

        TenantContext::setById(self::TENANT_ID); // restore

        $this->assertIsArray($recent);
        $ids = array_column($recent, 'id');
        $this->assertContains($destRowId, $ids);

        $found = array_values(array_filter($recent, fn ($r) => $r['id'] === $destRowId))[0];
        $this->assertArrayHasKey('source_tenant_slug', $found);
        $this->assertArrayHasKey('hours', $found);
    }

    // ── signPayload / verifySignature ─────────────────────────────────────────

    public function test_signPayload_produces_a_64_char_hex_string(): void
    {
        $payload = ['a' => 1, 'b' => 'two'];
        $sig     = $this->svc->signPayload($payload, 'secret123');

        $this->assertIsString($sig);
        $this->assertSame(64, strlen($sig));
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $sig);
    }

    public function test_signPayload_is_deterministic_for_same_input(): void
    {
        $payload = ['x' => 42, 'y' => 'hello'];
        $sig1    = $this->svc->signPayload($payload, 'mysecret');
        $sig2    = $this->svc->signPayload($payload, 'mysecret');

        $this->assertSame($sig1, $sig2);
    }

    public function test_signPayload_differs_for_different_secrets(): void
    {
        $payload = ['k' => 'v'];
        $sig1    = $this->svc->signPayload($payload, 'secretA');
        $sig2    = $this->svc->signPayload($payload, 'secretB');

        $this->assertNotSame($sig1, $sig2);
    }

    public function test_verifySignature_returns_true_for_correct_signature(): void
    {
        $payload = ['amount' => 3.0, 'tenant' => 'test'];
        $secret  = 'verify-secret';
        $sig     = $this->svc->signPayload($payload, $secret);

        $this->assertTrue($this->svc->verifySignature($payload, $sig, $secret));
    }

    public function test_verifySignature_returns_false_for_wrong_signature(): void
    {
        $payload = ['amount' => 3.0];
        $this->assertFalse($this->svc->verifySignature($payload, 'badsig', 'anysecret'));
    }

    public function test_verifySignature_returns_false_for_empty_signature(): void
    {
        $this->assertFalse($this->svc->verifySignature(['k' => 'v'], '', 'secret'));
    }

    public function test_verifySignature_returns_false_for_empty_secret(): void
    {
        $payload = ['k' => 'v'];
        $sig     = $this->svc->signPayload($payload, 'real-secret');
        $this->assertFalse($this->svc->verifySignature($payload, $sig, ''));
    }

    // ── canonicalJson ─────────────────────────────────────────────────────────

    public function test_canonicalJson_sorts_keys_alphabetically(): void
    {
        $payload = ['z' => 1, 'a' => 2, 'm' => 3];
        $json    = $this->svc->canonicalJson($payload);

        $this->assertSame('{"a":2,"m":3,"z":1}', $json);
    }

    public function test_canonicalJson_produces_same_string_regardless_of_insertion_order(): void
    {
        $p1 = ['b' => 2, 'a' => 1, 'c' => 3];
        $p2 = ['c' => 3, 'b' => 2, 'a' => 1];

        $this->assertSame($this->svc->canonicalJson($p1), $this->svc->canonicalJson($p2));
    }

    // ── sharedPlatformSecret ──────────────────────────────────────────────────

    public function test_sharedPlatformSecret_returns_a_64_char_hex_string(): void
    {
        $secret = $this->svc->sharedPlatformSecret();

        $this->assertIsString($secret);
        $this->assertSame(64, strlen($secret));
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $secret);
    }

    public function test_sharedPlatformSecret_is_deterministic(): void
    {
        $this->assertSame(
            $this->svc->sharedPlatformSecret(),
            $this->svc->sharedPlatformSecret(),
        );
    }

    // ── acceptRemoteTransfer — signature gate ─────────────────────────────────

    public function test_acceptRemoteTransfer_rejects_invalid_signature(): void
    {
        $peer    = ['shared_secret' => 'peer-secret'];
        $payload = [
            'source_tenant_slug'  => 'remote-coop',
            'transfer_id'         => 1,
            'source_member_email' => 'someone@example.test',
            'hours'               => 2.0,
            'reason'              => '',
            'generated_at'        => now()->toIso8601String(),
        ];

        $result = $this->svc->acceptRemoteTransfer(self::DST_TENANT_ID, $peer, $payload, 'wrong-sig');

        $this->assertFalse($result['accepted']);
        $this->assertSame('signature_invalid', $result['error']);
        $this->assertFalse($result['duplicated']);
    }

    public function test_acceptRemoteTransfer_rejects_when_peer_has_no_secret(): void
    {
        $peer    = ['shared_secret' => ''];
        $payload = ['source_tenant_slug' => 'x', 'transfer_id' => 1, 'source_member_email' => 'a@b.com', 'hours' => 1.0, 'reason' => ''];

        $result = $this->svc->acceptRemoteTransfer(self::TENANT_ID, $peer, $payload, 'anysig');

        $this->assertFalse($result['accepted']);
        $this->assertSame('peer_no_secret', $result['error']);
    }

    // ── acceptRemoteTransfer — happy path: credits destination ────────────────

    public function test_acceptRemoteTransfer_credits_destination_wallet_and_completes_row(): void
    {
        $email   = 'remote.' . uniqid() . '@example.test';
        $destId  = $this->insertUserWithEmail($email, 3.00, self::DST_TENANT_ID);

        $sourceSlug  = 'remote-coop-' . uniqid();
        $sourceTxnId = 77;
        $secret      = 'test-peer-secret';
        $peer        = ['shared_secret' => $secret];

        $payload = [
            'source_tenant_slug'  => $sourceSlug,
            'destination_tenant_slug' => self::DST_TENANT_SLUG,
            'source_member_email' => $email,
            'hours'               => 2.00,
            'reason'              => 'remote care',
            'transfer_id'         => $sourceTxnId,
            'generated_at'        => now()->toIso8601String(),
        ];
        $sig = $this->svc->signPayload($payload, $secret);

        $result = $this->svc->acceptRemoteTransfer(self::DST_TENANT_ID, $peer, $payload, $sig);

        $this->assertTrue($result['accepted']);
        $this->assertFalse($result['duplicated']);
        $this->assertNull($result['error']);
        $this->assertIsInt($result['destination_transfer_id']);

        // Wallet credited
        $this->assertSame(5.00, $this->getBalance($destId));

        // Transfer row
        $row = DB::table('caring_hour_transfers')->where('id', $result['destination_transfer_id'])->first();
        $this->assertNotNull($row);
        $this->assertSame('completed', (string) $row->status);
        $this->assertSame('destination', (string) $row->role);
        $this->assertSame(2.00, round((float) $row->hours_transferred, 2));
        $this->assertSame(1, (int) $row->is_remote);

        // Credit transaction row
        $txn = DB::table('transactions')
            ->where('tenant_id', self::DST_TENANT_ID)
            ->where('receiver_id', $destId)
            ->where('amount', 2.00)
            ->first();
        $this->assertNotNull($txn);
        $this->assertStringContainsString('[hour_transfer_in_remote]', (string) $txn->description);
    }

    // ── acceptRemoteTransfer — idempotency ────────────────────────────────────

    public function test_acceptRemoteTransfer_is_idempotent_on_duplicate_call(): void
    {
        $email  = 'idem.' . uniqid() . '@example.test';
        $destId = $this->insertUserWithEmail($email, 1.00, self::DST_TENANT_ID);

        $sourceSlug  = 'idem-coop-' . uniqid();
        $sourceTxnId = 55;
        $secret      = 'idem-secret';
        $peer        = ['shared_secret' => $secret];

        $payload = [
            'source_tenant_slug'  => $sourceSlug,
            'destination_tenant_slug' => self::DST_TENANT_SLUG,
            'source_member_email' => $email,
            'hours'               => 1.00,
            'reason'              => '',
            'transfer_id'         => $sourceTxnId,
            'generated_at'        => now()->toIso8601String(),
        ];
        $sig = $this->svc->signPayload($payload, $secret);

        // First call — accepted fresh
        $r1 = $this->svc->acceptRemoteTransfer(self::DST_TENANT_ID, $peer, $payload, $sig);
        $this->assertTrue($r1['accepted']);
        $this->assertFalse($r1['duplicated']);

        // Balance after first call
        $balAfterFirst = $this->getBalance($destId);

        // Second call — must be idempotent (no double-credit)
        $r2 = $this->svc->acceptRemoteTransfer(self::DST_TENANT_ID, $peer, $payload, $sig);
        $this->assertTrue($r2['accepted']);
        $this->assertTrue($r2['duplicated']);
        $this->assertSame($r1['destination_transfer_id'], $r2['destination_transfer_id']);

        // Balance must NOT increase a second time
        $this->assertSame($balAfterFirst, $this->getBalance($destId));
    }

    // ── acceptRemoteTransfer — guard: destination member not found ────────────

    public function test_acceptRemoteTransfer_rejects_when_destination_member_not_found(): void
    {
        $secret  = 'test-secret';
        $peer    = ['shared_secret' => $secret];
        $payload = [
            'source_tenant_slug'  => 'some-coop',
            'transfer_id'         => 99,
            'source_member_email' => 'nobody@no-such-tenant.test',
            'hours'               => 1.00,
            'reason'              => '',
            'generated_at'        => now()->toIso8601String(),
        ];
        $sig = $this->svc->signPayload($payload, $secret);

        $result = $this->svc->acceptRemoteTransfer(self::DST_TENANT_ID, $peer, $payload, $sig);

        $this->assertFalse($result['accepted']);
        $this->assertSame('destination_member_not_found', $result['error']);
    }

    // ── acceptRemoteTransfer — guard: amount exceeds limit ────────────────────

    public function test_acceptRemoteTransfer_rejects_amount_exceeding_security_bounds(): void
    {
        $email  = 'bigamount.' . uniqid() . '@example.test';
        $this->insertUserWithEmail($email, 0.0, self::DST_TENANT_ID);

        $secret  = 'bound-secret';
        $peer    = ['shared_secret' => $secret];
        $payload = [
            'source_tenant_slug'  => 'some-coop',
            'transfer_id'         => 100,
            'source_member_email' => $email,
            'hours'               => 25.0, // exceeds 24h max
            'reason'              => '',
            'generated_at'        => now()->toIso8601String(),
        ];
        $sig = $this->svc->signPayload($payload, $secret);

        $result = $this->svc->acceptRemoteTransfer(self::DST_TENANT_ID, $peer, $payload, $sig);

        $this->assertFalse($result['accepted']);
        $this->assertSame('amount_exceeds_limit', $result['error']);
    }
}
