<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Models\User;
use App\Services\ExchangeWorkflowService;
use App\Services\VolunteerCertificateService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use ReflectionMethod;
use Tests\Laravel\TestCase;

/**
 * Regressions for "ghost party" states: a member whose account moved to
 * another tenant while relational rows (listings, exchanges, certificates)
 * stayed behind. These states exist in production data from moves made before
 * content migration existed, and the in-flight-exchange guard cannot
 * retroactively remove them.
 */
class ExchangeGhostPartyTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * 🔴 The money bug: confirming an exchange whose payee is invisible to
     * tenant-scoped balance updates used to debit the payer and credit
     * NOBODY — credits silently destroyed. It must now refuse loudly and
     * leave every balance untouched.
     */
    public function testCreditTransferRefusesWhenPayeeLeftTheTenant(): void
    {
        [$provider, $requester, , $exchangeId] = $this->makeExchangeFixture('pending_confirmation');
        DB::table('users')->where('id', $requester->id)->update(['balance' => 10]);
        // Simulate a legacy pre-guard move: the provider's account is in
        // another tenant while the exchange row stayed behind.
        DB::table('users')->where('id', $provider->id)->update(['tenant_id' => 999]);

        $method = new ReflectionMethod(ExchangeWorkflowService::class, 'createTransaction');

        $thrown = null;
        try {
            DB::transaction(function () use ($method, $exchangeId) {
                $method->invoke(null, $exchangeId, 2.0);
            });
        } catch (\RuntimeException $e) {
            $thrown = $e;
        }

        $this->assertNotNull($thrown, 'Zero-row credit must throw, not silently destroy credits');
        $this->assertSame('EXCHANGE_PARTY_UNAVAILABLE', $thrown->getMessage());
        $this->assertSame(10.0, (float) DB::table('users')->where('id', $requester->id)->value('balance'));
        $this->assertDatabaseMissing('transactions', [
            'sender_id' => $requester->id,
            'receiver_id' => $provider->id,
            'transaction_type' => 'exchange',
        ]);
    }

    public function testNewExchangeRequestIsRefusedWhenListingOwnerLeftTheTenant(): void
    {
        [$provider, $requester, $listingId] = $this->makeExchangeFixture(null);
        DB::table('users')->where('id', $provider->id)->update(['tenant_id' => 999]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('LISTING_OWNER_UNAVAILABLE');

        ExchangeWorkflowService::createRequest((int) $requester->id, $listingId, ['proposed_hours' => 1]);
    }

    public function testVolunteerCertificateStillVerifiesAfterHolderMovesTenant(): void
    {
        $volunteer = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Certified',
            'last_name' => 'Mover',
        ]);
        $code = strtolower(bin2hex(random_bytes(12)));
        DB::table('vol_certificates')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $volunteer->id,
            'verification_code' => $code,
            'total_hours' => 42,
            'date_range_start' => '2026-01-01',
            'date_range_end' => '2026-06-30',
            'organizations' => json_encode([['name' => 'Test Org', 'hours' => 42]]),
            'generated_at' => now(),
        ]);

        DB::table('users')->where('id', $volunteer->id)->update(['tenant_id' => 999]);

        $cert = VolunteerCertificateService::verify($code);

        $this->assertNotNull($cert, 'A certificate must keep verifying after its holder moves community');
        $this->assertSame('Certified Mover', $cert['user_name']);
        $this->assertSame(42.0, (float) $cert['total_hours']);
        $this->assertTrue($cert['verified']);
    }

    /**
     * @return array{0: User, 1: User, 2: int, 3: int} provider, requester, listing id, exchange id
     */
    private function makeExchangeFixture(?string $exchangeStatus): array
    {
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();

        $listingId = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $provider->id,
            'title' => 'Ghost-party regression listing',
            'description' => 't',
            'type' => 'offer',
            'status' => 'active',
        ]);

        $exchangeId = 0;
        if ($exchangeStatus !== null) {
            $exchangeId = (int) DB::table('exchange_requests')->insertGetId([
                'tenant_id' => $this->testTenantId,
                'listing_id' => $listingId,
                'requester_id' => $requester->id,
                'provider_id' => $provider->id,
                'proposed_hours' => 2,
                'status' => $exchangeStatus,
            ]);
        }

        return [$provider, $requester, $listingId, $exchangeId];
    }
}
