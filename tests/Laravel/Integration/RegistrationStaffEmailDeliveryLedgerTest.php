<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Services\RegistrationStaffEmailDeliveryLedger as Ledger;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class RegistrationStaffEmailDeliveryLedgerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_capture_is_tenant_scoped_unique_and_does_not_reopen_an_outcome(): void
    {
        $tenant = $this->tenant();
        $otherTenant = $this->tenant();
        $registrant = $this->user($tenant);
        $recipient = $this->user($tenant, 'admin');
        $foreign = $this->user($otherTenant, 'admin');

        $id = Ledger::captureInTransaction($tenant, $registrant, $recipient);
        $this->assertGreaterThan(0, $id);
        $this->assertSame($id, Ledger::captureInTransaction($tenant, $registrant, $recipient));
        $this->assertSame(1, DB::table('registration_staff_email_deliveries')->where('tenant_id', $tenant)->count());

        $token = Ledger::claimPending($tenant, $id);
        $this->assertNotNull($token);
        $this->assertTrue(Ledger::resolveClaim($tenant, $id, $token, 'accepted', 'synthetic-provider-id'));
        $this->assertSame($id, Ledger::captureInTransaction($tenant, $registrant, $recipient));
        $this->assertNull(Ledger::claimPending($tenant, $id));
        $this->assertSame('accepted', DB::table('registration_staff_email_deliveries')->where('id', $id)->value('status'));

        $this->expectException(\InvalidArgumentException::class);
        Ledger::captureInTransaction($tenant, $registrant, $foreign);
    }

    public function test_claim_token_and_unknown_outcome_cannot_be_replayed_or_reclaimed(): void
    {
        $tenant = $this->tenant();
        $id = Ledger::captureInTransaction($tenant, $this->user($tenant), $this->user($tenant, 'admin'));
        $token = Ledger::claimPending($tenant, $id);
        $this->assertNotNull($token);
        $this->assertNull(Ledger::claimPending($tenant, $id));
        $this->assertNull(Ledger::claimPending($tenant + 1, $id));
        $this->assertFalse(Ledger::resolveClaim($tenant, $id, 'wrong-token', 'accepted'));
        $this->assertFalse(Ledger::resolveClaim($tenant + 1, $id, $token, 'accepted'));
        $this->assertTrue(Ledger::resolveClaim($tenant, $id, $token, 'unknown', null, 'PROVIDER_RESPONSE_LOST'));
        $this->assertFalse(Ledger::resolveClaim($tenant, $id, $token, 'accepted'));
        $this->assertNull(Ledger::claimPending($tenant, $id));

        $row = DB::table('registration_staff_email_deliveries')->where('id', $id)->first();
        $this->assertSame('unknown', $row->status);
        $this->assertSame(1, (int) $row->attempts);
        $this->assertSame('PROVIDER_RESPONSE_LOST', $row->last_error_code);
        $this->assertNotNull($row->resolved_at);
    }

    public function test_two_recipients_keep_independent_terminal_outcomes(): void
    {
        $tenant = $this->tenant();
        $registrant = $this->user($tenant);
        $first = Ledger::captureInTransaction($tenant, $registrant, $this->user($tenant, 'admin'));
        $second = Ledger::captureInTransaction($tenant, $registrant, $this->user($tenant, 'admin'));

        $firstToken = Ledger::claimPending($tenant, $first);
        $secondToken = Ledger::claimPending($tenant, $second);
        $this->assertNotNull($firstToken);
        $this->assertNotNull($secondToken);
        $this->assertTrue(Ledger::resolveClaim($tenant, $first, $firstToken, 'accepted', 'synthetic-provider-id'));
        $this->assertTrue(Ledger::resolveClaim($tenant, $second, $secondToken, 'definite_failure', null, 'LOCAL_RECIPIENT_REFUSED'));

        $rows = DB::table('registration_staff_email_deliveries')
            ->where('tenant_id', $tenant)
            ->orderBy('id')
            ->pluck('status')
            ->all();
        $this->assertSame(['accepted', 'definite_failure'], $rows);
        $this->assertNull(Ledger::claimPending($tenant, $first));
        $this->assertNull(Ledger::claimPending($tenant, $second));
    }

    public function test_error_code_rejects_raw_recipient_or_provider_text(): void
    {
        $tenant = $this->tenant();
        $id = Ledger::captureInTransaction($tenant, $this->user($tenant), $this->user($tenant, 'admin'));
        $token = Ledger::claimPending($tenant, $id);
        $this->assertNotNull($token);

        $this->expectException(\InvalidArgumentException::class);
        Ledger::resolveClaim($tenant, $id, $token, 'definite_failure', null, 'person@example.com refused');
    }

    private function tenant(): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name' => 'Synthetic delivery tenant',
            'slug' => 'delivery-' . uniqid('', true),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function user(int $tenant, string $role = 'member'): int
    {
        $unique = uniqid('delivery_', true);
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenant,
            'name' => 'Synthetic delivery user',
            'first_name' => 'Synthetic',
            'last_name' => 'User',
            'email' => $unique . '@example.com',
            'role' => $role,
            'status' => 'active',
            'preferred_language' => 'en',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
