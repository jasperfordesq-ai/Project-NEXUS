<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Core\TenantContext;
use App\Services\VolunteerDonationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class VolunteerDonationServiceTest extends TestCase
{
    use DatabaseTransactions;

    public function test_createDonation_throws_for_zero_amount(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('greater than zero');

        VolunteerDonationService::createDonation(1, [
            'amount' => 0,
            'currency' => 'EUR',
            'payment_method' => 'card',
        ]);
    }

    public function test_createDonation_throws_for_invalid_currency(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('3-letter ISO');

        VolunteerDonationService::createDonation(1, [
            'amount' => 10,
            'currency' => 'EURO',
            'payment_method' => 'card',
        ]);
    }

    public function test_createDonation_rejects_currency_different_from_tenant_currency(): void
    {
        // Giving-day totals sum raw numeric amounts with no FX conversion, so
        // a client-supplied foreign currency must be rejected, not recorded.
        $tenantCurrency = strtoupper(TenantContext::getCurrency());
        $foreignCurrency = $tenantCurrency === 'USD' ? 'EUR' : 'USD';

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('must match the community currency');

        VolunteerDonationService::createDonation(1, [
            'amount' => 10,
            'currency' => $foreignCurrency,
            'payment_method' => 'bank_transfer',
        ]);
    }

    public function test_createDonation_records_tenant_currency_when_none_supplied(): void
    {
        $tenantCurrency = strtoupper(TenantContext::getCurrency());

        $donation = VolunteerDonationService::createDonation(1, [
            'amount' => 10,
            'payment_method' => 'bank_transfer',
        ]);

        $this->assertSame($tenantCurrency, $donation['currency']);
        $this->assertSame(
            $tenantCurrency,
            strtoupper((string) DB::table('vol_donations')->where('id', $donation['id'])->value('currency'))
        );
    }

    public function test_createDonation_throws_for_missing_payment_method(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Payment method is required');

        VolunteerDonationService::createDonation(1, [
            'amount' => 10,
            'currency' => 'EUR',
            'payment_method' => '',
        ]);
    }

    public function test_createDonation_rejects_foreign_tenant_opportunity(): void
    {
        // Seed the FK parent organisation (vol_opportunities.organization_id
        // references vol_organizations.id) under the foreign tenant.
        $foreignOrgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => 999,
            'user_id' => 1,
            'name' => 'Foreign Tenant Org',
            'slug' => 'foreign-tenant-org-' . uniqid(),
            'description' => 'A foreign-tenant organisation for cross-tenant donation rejection coverage.',
            'contact_email' => 'foreign-org@example.test',
            'status' => 'active',
            'created_at' => now(),
        ]);

        $foreignOpportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => 999,
            'organization_id' => $foreignOrgId,
            'title' => 'Foreign Tenant Opportunity',
            'description' => 'This opportunity must not be donation-addressable from tenant 2.',
            'status' => 'active',
            'is_active' => 1,
            'created_by' => 1,
            'created_at' => now(),
        ]);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Opportunity not found');

        VolunteerDonationService::createDonation(1, [
            'amount' => 10,
            'currency' => 'EUR',
            'payment_method' => 'card',
            'opportunity_id' => $foreignOpportunityId,
        ]);
    }

    public function test_createDonation_rejects_foreign_tenant_giving_day(): void
    {
        $foreignGivingDayId = (int) DB::table('vol_giving_days')->insertGetId([
            'tenant_id' => 999,
            'title' => 'Foreign Tenant Giving Day',
            'start_date' => now()->toDateString(),
            'end_date' => now()->addDay()->toDateString(),
            'goal_amount' => 1000,
            'raised_amount' => 0,
            'is_active' => 1,
            'created_by' => 1,
            'created_at' => now(),
        ]);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Giving day not found');

        VolunteerDonationService::createDonation(1, [
            'amount' => 10,
            'currency' => 'EUR',
            'payment_method' => 'card',
            'giving_day_id' => $foreignGivingDayId,
        ]);
    }

    public function test_createDonation_keeps_unverified_donation_pending_and_does_not_increment_giving_day(): void
    {
        $givingDayId = (int) DB::table('vol_giving_days')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Tenant Giving Day',
            'start_date' => now()->toDateString(),
            'end_date' => now()->addDay()->toDateString(),
            'goal_amount' => 1000,
            'raised_amount' => 0,
            'is_active' => 1,
            'created_by' => 1,
            'created_at' => now(),
        ]);

        $donation = VolunteerDonationService::createDonation(1, [
            'amount' => 25,
            'currency' => 'EUR',
            'payment_method' => 'offline_pledge',
            'status' => 'completed',
            'giving_day_id' => $givingDayId,
        ]);

        $this->assertSame('pending', $donation['status']);
        $this->assertEquals(0.0, (float) DB::table('vol_giving_days')->where('id', $givingDayId)->value('raised_amount'));
    }

    public function test_exportDonations_includes_stripe_route_reporting_fields(): void
    {
        if (!Schema::hasColumn('vol_donations', 'payment_route')) {
            $source = file_get_contents(app_path('Services/VolunteerDonationService.php'));
            $this->assertStringContainsString("'payment_route', 'stripe_account_id', 'stripe_payment_intent_id'", $source);
            $this->assertStringContainsString('donationRoutingColumns', $source);
            return;
        }

        DB::table('vol_donations')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => 1,
            'amount' => 25,
            'currency' => 'EUR',
            'payment_method' => 'stripe',
            'payment_reference' => '',
            'payment_route' => 'tenant_connect',
            'stripe_account_id' => 'acct_test_123456',
            'stripe_payment_intent_id' => 'pi_test_123456',
            'message' => 'Thank you',
            'is_anonymous' => 0,
            'status' => 'completed',
            'created_at' => now(),
        ]);

        $rows = VolunteerDonationService::exportDonations($this->testTenantId, null);

        $this->assertNotEmpty($rows);
        $row = $rows[0];
        $this->assertSame('tenant_connect', $row['payment_route']);
        $this->assertSame('acct_test_123456', $row['stripe_account_id']);
        $this->assertSame('pi_test_123456', $row['stripe_payment_intent_id']);
    }

    public function test_getDonations_filters_by_community_project_id(): void
    {
        $userId = random_int(10_000_000, 99_999_999);
        $projectId = random_int(10_000_000, 99_999_999);

        $projectDonationId = (int) DB::table('vol_donations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'community_project_id' => $projectId,
            'amount' => 10.00,
            'currency' => 'EUR',
            'payment_method' => 'bank_transfer',
            'status' => 'pending',
            'created_at' => now(),
        ]);
        DB::table('vol_donations')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'community_project_id' => null,
            'amount' => 20.00,
            'currency' => 'EUR',
            'payment_method' => 'bank_transfer',
            'status' => 'pending',
            'created_at' => now(),
        ]);

        // Previously the community_project_id filter was accepted but never
        // applied, silently returning ALL of the user's donations.
        $result = VolunteerDonationService::getDonations([
            'user_id' => $userId,
            'community_project_id' => $projectId,
        ]);

        $this->assertCount(1, $result['items']);
        $this->assertSame($projectDonationId, (int) $result['items'][0]['id']);
        $this->assertSame($projectId, (int) $result['items'][0]['community_project_id']);
    }

    public function test_adminGetGivingDays_serves_stored_raised_amount_counter(): void
    {
        $givingDayId = (int) DB::table('vol_giving_days')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Stored Counter Giving Day',
            'start_date' => now()->toDateString(),
            'end_date' => now()->addDay()->toDateString(),
            'goal_amount' => 1000,
            // Stored counter deliberately differs from SUM(amount) of completed
            // donations to pin the source of truth.
            'raised_amount' => 50.00,
            'is_active' => 1,
            'created_by' => 1,
            'created_at' => now(),
        ]);

        DB::table('vol_donations')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => random_int(10_000_000, 99_999_999),
            'giving_day_id' => $givingDayId,
            'amount' => 10.00,
            'currency' => 'EUR',
            'payment_method' => 'bank_transfer',
            'status' => 'completed',
            'created_at' => now(),
        ]);

        $days = VolunteerDonationService::adminGetGivingDays();
        $day = collect($days)->firstWhere('id', $givingDayId);

        $this->assertNotNull($day);
        // The admin list must serve the SAME stored vol_giving_days counter as
        // the public getGivingDays()/getGivingDayStats() paths (the counter is
        // maintained on completion AND refund), not a recomputed SUM(amount)
        // that silently diverges from what members see.
        $this->assertSame(50.0, (float) $day['raised_amount']);
        $this->assertSame(1, $day['donation_count']);
        $this->assertSame(1, $day['donor_count']);
    }

    public function test_createGivingDay_throws_for_empty_title(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        VolunteerDonationService::createGivingDay(['title' => '', 'start_date' => '2025-01-01', 'end_date' => '2025-01-31', 'goal_amount' => 1000], 2);
    }

    public function test_createGivingDay_throws_when_end_before_start(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        VolunteerDonationService::createGivingDay(['title' => 'Test', 'start_date' => '2025-12-31', 'end_date' => '2025-01-01', 'goal_amount' => 1000], 2);
    }

    public function test_createGivingDay_throws_for_zero_goal(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        VolunteerDonationService::createGivingDay(['title' => 'Test', 'start_date' => '2025-01-01', 'end_date' => '2025-01-31', 'goal_amount' => 0], 2);
    }
}
