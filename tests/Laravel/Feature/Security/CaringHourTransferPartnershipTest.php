<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Events\TransactionCompleted;
use App\Services\CaringCommunity\CaringHourTransferService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use RuntimeException;
use Tests\Laravel\TestCase;

/**
 * F-132 — a caring hour transfer may only go to a cooperative on this
 * installation that has Caring Community enabled AND an active federation
 * partnership (with transactions allowed) with the source cooperative. The
 * member-facing error must not reveal whether a slug or an email exists.
 */
class CaringHourTransferPartnershipTest extends TestCase
{
    use DatabaseTransactions;

    private const SOURCE_TENANT_ID = 2;

    private int $destinationTenantId;
    private string $destinationSlug;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([TransactionCompleted::class]);

        $this->setCaring(self::SOURCE_TENANT_ID, true);

        $this->destinationSlug = 'f132-dest-' . substr(md5(uniqid('', true)), 0, 8);
        $this->destinationTenantId = (int) DB::table('tenants')->insertGetId([
            'name'       => 'F-132 Destination Coop',
            'slug'       => $this->destinationSlug,
            'features'   => json_encode(['caring_community' => true]),
            'is_active'  => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        TenantContext::setById(self::SOURCE_TENANT_ID);
    }

    private function setCaring(int $tenantId, bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', $tenantId)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = $enabled;
        DB::table('tenants')->where('id', $tenantId)->update(['features' => json_encode($features)]);
    }

    private function partnership(string $status, bool $transactions = true, bool $reverse = false): int
    {
        $a = $reverse ? $this->destinationTenantId : self::SOURCE_TENANT_ID;
        $b = $reverse ? self::SOURCE_TENANT_ID : $this->destinationTenantId;

        DB::table('federation_partnerships')
            ->where(function ($q) {
                $q->where('tenant_id', self::SOURCE_TENANT_ID)->where('partner_tenant_id', $this->destinationTenantId);
            })
            ->orWhere(function ($q) {
                $q->where('tenant_id', $this->destinationTenantId)->where('partner_tenant_id', self::SOURCE_TENANT_ID);
            })
            ->delete();

        return (int) DB::table('federation_partnerships')->insertGetId([
            'tenant_id'            => $a,
            'partner_tenant_id'    => $b,
            'canonical_pair'       => min($a, $b) . '-' . max($a, $b),
            'status'               => $status,
            'federation_level'     => 2,
            'transactions_enabled' => $transactions ? 1 : 0,
            'requested_at'         => now(),
            'approved_at'          => $status === 'active' ? now() : null,
            'created_at'           => now(),
        ]);
    }

    private function user(int $tenantId, string $email, float $balance): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id'   => $tenantId,
            'first_name'  => 'F132',
            'last_name'   => 'Member',
            'email'       => $email,
            'username'    => 'f132_' . substr(md5($email . $tenantId . uniqid('', true)), 0, 10),
            'password'    => password_hash('password', PASSWORD_BCRYPT),
            'balance'     => $balance,
            'status'      => 'active',
            'is_approved' => 1,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);
    }

    private function service(): CaringHourTransferService
    {
        return app(CaringHourTransferService::class);
    }

    private function unavailableMessage(): string
    {
        return __('api.caring_hour_transfer_destination_unavailable');
    }

    /** Assert initiate() is refused with the generic message and records nothing. */
    private function assertInitiateRefused(int $sourceUserId, string $slug): void
    {
        $before = DB::table('caring_hour_transfers')->where('tenant_id', self::SOURCE_TENANT_ID)->count();
        $thrown = null;
        try {
            $this->service()->initiate($sourceUserId, $slug, 2.0, 'moving');
        } catch (RuntimeException $e) {
            $thrown = $e;
        }
        $this->assertNotNull($thrown, 'Transfer initiation should have been refused.');
        $this->assertSame($this->unavailableMessage(), $thrown->getMessage());
        $this->assertSame($before, DB::table('caring_hour_transfers')->where('tenant_id', self::SOURCE_TENANT_ID)->count());
    }

    // ── Refusals ──────────────────────────────────────────────────────────────

    public function test_transfer_without_any_partnership_is_refused(): void
    {
        $email = 'f132.none.' . uniqid() . '@example.test';
        $source = $this->user(self::SOURCE_TENANT_ID, $email, 10);
        $this->user($this->destinationTenantId, $email, 0);

        $this->assertInitiateRefused($source, $this->destinationSlug);
    }

    public function test_transfer_with_pending_suspended_or_non_transaction_partnership_is_refused(): void
    {
        $email = 'f132.status.' . uniqid() . '@example.test';
        $source = $this->user(self::SOURCE_TENANT_ID, $email, 10);
        $this->user($this->destinationTenantId, $email, 0);

        foreach (['pending', 'suspended', 'terminated', 'rejected'] as $status) {
            $this->partnership($status);
            $this->assertInitiateRefused($source, $this->destinationSlug);
        }

        $this->partnership('active', transactions: false);
        $this->assertInitiateRefused($source, $this->destinationSlug);
    }

    public function test_transfer_to_partner_without_caring_community_is_refused(): void
    {
        $email = 'f132.nocaring.' . uniqid() . '@example.test';
        $source = $this->user(self::SOURCE_TENANT_ID, $email, 10);
        $this->user($this->destinationTenantId, $email, 0);
        $this->partnership('active');
        $this->setCaring($this->destinationTenantId, false);

        $this->assertInitiateRefused($source, $this->destinationSlug);
    }

    public function test_unknown_slug_and_missing_email_get_the_same_error(): void
    {
        $email = 'f132.enum.' . uniqid() . '@example.test';
        $source = $this->user(self::SOURCE_TENANT_ID, $email, 10);
        $this->partnership('active'); // partner exists, but no account with this email there

        $this->assertInitiateRefused($source, 'no-such-coop-' . uniqid());
        $this->assertInitiateRefused($source, $this->destinationSlug);
    }

    public function test_endpoint_answers_identically_for_unknown_slug_non_partner_and_missing_account(): void
    {
        $email = 'f132.http.' . uniqid() . '@example.test';
        $source = $this->user(self::SOURCE_TENANT_ID, $email, 10);
        $member = \App\Models\User::query()->find($source);
        $this->assertNotNull($member);
        \Laravel\Sanctum\Sanctum::actingAs($member);

        $post = fn (string $slug) => $this->apiPost('/v2/caring-community/hour-transfer/initiate', [
            'destination_tenant_slug' => $slug,
            'hours'                   => 1,
            'reason'                  => 'probe',
        ]);

        // Non-partner cooperative where the member DOES have an account.
        $this->user($this->destinationTenantId, $email, 0);
        $nonPartner = $post($this->destinationSlug)->assertStatus(422);
        $unknown = $post('no-such-coop-' . uniqid())->assertStatus(422);

        $this->assertSame('DESTINATION_UNAVAILABLE', $nonPartner->json('errors.0.code'));
        $this->assertSame($unknown->json('errors'), $nonPartner->json('errors'));
    }

    public function test_approval_is_refused_if_the_partnership_ended_after_initiation(): void
    {
        $email = 'f132.suspend.' . uniqid() . '@example.test';
        $source = $this->user(self::SOURCE_TENANT_ID, $email, 10);
        $dest = $this->user($this->destinationTenantId, $email, 1);
        $admin = $this->user(self::SOURCE_TENANT_ID, 'f132.admin.' . uniqid() . '@example.test', 0);
        $partnershipId = $this->partnership('active');

        $init = $this->service()->initiate($source, $this->destinationSlug, 3.0, 'moving');
        DB::table('federation_partnerships')->where('id', $partnershipId)->update(['status' => 'suspended']);

        $thrown = null;
        try {
            $this->service()->approveAtSource($init['transfer_id'], $admin);
        } catch (RuntimeException $e) {
            $thrown = $e;
        }
        $this->assertNotNull($thrown, 'Approval should have been refused.');
        $this->assertSame($this->unavailableMessage(), $thrown->getMessage());

        $this->assertEqualsWithDelta(10, (float) DB::table('users')->where('id', $source)->value('balance'), 0.001);
        $this->assertEqualsWithDelta(1, (float) DB::table('users')->where('id', $dest)->value('balance'), 0.001);
        $this->assertSame('pending', DB::table('caring_hour_transfers')->where('id', $init['transfer_id'])->value('status'));
    }

    // ── Controls ──────────────────────────────────────────────────────────────

    public function test_control_active_partner_with_caring_enabled_receives_the_hours(): void
    {
        $email = 'f132.ok.' . uniqid() . '@example.test';
        $source = $this->user(self::SOURCE_TENANT_ID, $email, 10);
        $dest = $this->user($this->destinationTenantId, $email, 1);
        $admin = $this->user(self::SOURCE_TENANT_ID, 'f132.admin.' . uniqid() . '@example.test', 0);
        $this->partnership('active');

        $init = $this->service()->initiate($source, $this->destinationSlug, 3.0, 'moving');
        $this->assertSame('pending', $init['status']);

        $result = $this->service()->approveAtSource($init['transfer_id'], $admin);
        $this->assertSame('completed', $result['status']);
        $this->assertEqualsWithDelta(7, (float) DB::table('users')->where('id', $source)->value('balance'), 0.001);
        $this->assertEqualsWithDelta(4, (float) DB::table('users')->where('id', $dest)->value('balance'), 0.001);
    }

    public function test_control_partnership_recorded_in_the_other_direction_also_counts(): void
    {
        $email = 'f132.rev.' . uniqid() . '@example.test';
        $source = $this->user(self::SOURCE_TENANT_ID, $email, 10);
        $this->user($this->destinationTenantId, $email, 0);
        $this->partnership('active', reverse: true);

        $init = $this->service()->initiate($source, $this->destinationSlug, 1.5, 'moving');
        $this->assertSame('pending', $init['status']);
    }

    public function test_control_amount_bounds_still_apply_to_partners(): void
    {
        $email = 'f132.bounds.' . uniqid() . '@example.test';
        $source = $this->user(self::SOURCE_TENANT_ID, $email, 10);
        $this->user($this->destinationTenantId, $email, 0);
        $this->partnership('active');

        $this->expectException(\InvalidArgumentException::class);
        $this->service()->initiate($source, $this->destinationSlug, 0, 'zero');
    }
}
