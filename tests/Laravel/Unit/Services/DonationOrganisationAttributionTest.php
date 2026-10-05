<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Models\User;
use App\Services\StripeDonationService;
use App\Services\VolunteerDonationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Stripe\ApiRequestor;
use Stripe\HttpClient\ClientInterface;
use Tests\Laravel\TestCase;

/**
 * A fundraising campaign can raise money for one volunteering organisation,
 * and every donation to it records that organisation — on the donation row,
 * on the receipt, and in the Stripe PaymentIntent (description + metadata).
 *
 * @covers \App\Services\VolunteerDonationService
 * @covers \App\Services\StripeDonationService
 */
class DonationOrganisationAttributionTest extends TestCase
{
    use DatabaseTransactions;

    /** @var array<int, array{method:string,url:string,params:array<string,mixed>}> */
    private array $stripeCalls = [];

    protected function tearDown(): void
    {
        ApiRequestor::setHttpClient(null);
        parent::tearDown();
    }

    private function makeOrganisation(string $name, string $status = 'approved', ?int $tenantId = null): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'user_id' => 1,
            'name' => $name,
            'slug' => 'attribution-org-' . uniqid(),
            'description' => 'Organisation for donation attribution coverage.',
            'contact_email' => 'attribution-org@example.test',
            'status' => $status,
            'created_at' => now(),
        ]);
    }

    private function makeCampaign(?int $organisationId, string $title = 'Winter appeal', ?int $tenantId = null): int
    {
        return (int) DB::table('vol_giving_days')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'title' => $title,
            'start_date' => now()->subDay()->toDateString(),
            'end_date' => now()->addWeek()->toDateString(),
            'goal_amount' => 1000,
            'raised_amount' => 0,
            'is_active' => 1,
            'organization_id' => $organisationId,
            'created_by' => 1,
            'created_at' => now(),
        ]);
    }

    /** Route every Stripe API call to an in-memory fake and record it. */
    private function fakeStripe(): void
    {
        config(['services.stripe.secret' => 'sk_test_attribution_fake']);
        $calls = &$this->stripeCalls;

        ApiRequestor::setHttpClient(new class ($calls) implements ClientInterface {
            /** @param array<int, mixed> $calls */
            public function __construct(private array &$calls)
            {
            }

            public function request($method, $absUrl, $headers, $params, $hasFile, $apiMode = 'v1')
            {
                $this->calls[] = ['method' => strtolower($method), 'url' => $absUrl, 'params' => $params];

                if (str_contains($absUrl, '/v1/customers')) {
                    $body = ['id' => 'cus_attribution_fake', 'object' => 'customer'];
                } elseif (str_contains($absUrl, '/v1/payment_intents')) {
                    $id = 'pi_attribution_' . count($this->calls) . '_' . bin2hex(random_bytes(4));
                    $body = ['id' => $id, 'object' => 'payment_intent', 'client_secret' => $id . '_secret_fake'];
                } else {
                    return [json_encode(['error' => ['message' => 'unexpected call ' . $absUrl]]), 400, []];
                }

                return [json_encode($body), 200, []];
            }
        });
    }

    /** @return array<string, mixed> */
    private function capturedPaymentIntent(): array
    {
        $intents = array_values(array_filter(
            $this->stripeCalls,
            fn ($call) => $call['method'] === 'post' && str_ends_with($call['url'], '/v1/payment_intents'),
        ));
        $this->assertCount(1, $intents, 'exactly one PaymentIntent should have been created');

        return $intents[0]['params'];
    }

    // ── Campaign set-up ────────────────────────────────────────────────────

    public function test_a_campaign_can_be_created_for_an_organisation_and_lists_its_name(): void
    {
        $orgId = $this->makeOrganisation('Food Bank');

        $created = VolunteerDonationService::createGivingDay([
            'title' => 'Food appeal',
            'start_date' => now()->toDateString(),
            'end_date' => now()->addWeek()->toDateString(),
            'goal_amount' => 500,
            'created_by' => 1,
            'organization_id' => $orgId,
        ], $this->testTenantId);

        $this->assertSame($orgId, $created['organization_id']);
        $this->assertSame('Food Bank', $created['organization_name']);
        $this->assertSame($orgId, (int) DB::table('vol_giving_days')->where('id', $created['id'])->value('organization_id'));

        $listed = collect(VolunteerDonationService::adminGetGivingDays())->firstWhere('id', $created['id']);
        $this->assertSame('Food Bank', $listed['organization_name']);
        $member = collect(VolunteerDonationService::getGivingDays())->firstWhere('id', $created['id']);
        $this->assertSame('Food Bank', $member['organization_name']);
    }

    public function test_a_campaign_without_an_organisation_is_for_the_whole_community(): void
    {
        $created = VolunteerDonationService::createGivingDay([
            'title' => 'Community appeal',
            'start_date' => now()->toDateString(),
            'end_date' => now()->addWeek()->toDateString(),
            'goal_amount' => 500,
            'created_by' => 1,
        ], $this->testTenantId);

        $this->assertNull($created['organization_id']);
        $this->assertNull(DB::table('vol_giving_days')->where('id', $created['id'])->value('organization_id'));
    }

    public function test_a_campaign_refuses_an_organisation_from_another_community(): void
    {
        $foreignOrgId = $this->makeOrganisation('Foreign Org', 'approved', 999);

        $this->expectException(\InvalidArgumentException::class);
        VolunteerDonationService::createGivingDay([
            'title' => 'Cross-community appeal',
            'start_date' => now()->toDateString(),
            'end_date' => now()->addWeek()->toDateString(),
            'goal_amount' => 500,
            'created_by' => 1,
            'organization_id' => $foreignOrgId,
        ], $this->testTenantId);
    }

    public function test_a_campaign_refuses_an_organisation_that_is_not_yet_approved(): void
    {
        $pendingOrgId = $this->makeOrganisation('Pending Org', 'pending');

        $this->expectException(\InvalidArgumentException::class);
        VolunteerDonationService::createGivingDay([
            'title' => 'Premature appeal',
            'start_date' => now()->toDateString(),
            'end_date' => now()->addWeek()->toDateString(),
            'goal_amount' => 500,
            'created_by' => 1,
            'organization_id' => $pendingOrgId,
        ], $this->testTenantId);
    }

    public function test_editing_a_campaign_can_change_or_clear_the_organisation_and_leaves_it_alone_otherwise(): void
    {
        $orgA = $this->makeOrganisation('Food Bank');
        $orgB = $this->makeOrganisation('Youth Club');
        $campaignId = $this->makeCampaign($orgA);

        VolunteerDonationService::updateGivingDay($campaignId, ['title' => 'Renamed appeal'], $this->testTenantId);
        $this->assertSame($orgA, (int) DB::table('vol_giving_days')->where('id', $campaignId)->value('organization_id'));

        VolunteerDonationService::updateGivingDay($campaignId, ['organization_id' => $orgB], $this->testTenantId);
        $this->assertSame($orgB, (int) DB::table('vol_giving_days')->where('id', $campaignId)->value('organization_id'));

        VolunteerDonationService::updateGivingDay($campaignId, ['organization_id' => null], $this->testTenantId);
        $this->assertNull(DB::table('vol_giving_days')->where('id', $campaignId)->value('organization_id'));
    }

    // ── Pledges (offline gifts) ────────────────────────────────────────────

    public function test_a_pledge_to_an_organisation_campaign_records_the_organisation_and_ignores_the_client(): void
    {
        $orgId = $this->makeOrganisation('Food Bank');
        $otherOrgId = $this->makeOrganisation('Somebody Else');
        $campaignId = $this->makeCampaign($orgId);

        $donation = VolunteerDonationService::createDonation(1, [
            'amount' => 20,
            'payment_method' => 'bank_transfer',
            'giving_day_id' => $campaignId,
            // A client cannot redirect the attribution.
            'organization_id' => $otherOrgId,
        ]);

        $this->assertSame($orgId, $donation['organization_id']);
        $this->assertSame($orgId, (int) DB::table('vol_donations')->where('id', $donation['id'])->value('organization_id'));

        $listed = collect(VolunteerDonationService::getDonations(['user_id' => 1])['items'])->firstWhere('id', $donation['id']);
        $this->assertSame('Food Bank', $listed['organization_name']);

        $exported = collect(VolunteerDonationService::exportDonations($this->testTenantId, ['organization_id' => $orgId]))
            ->firstWhere('id', $donation['id']);
        $this->assertNotNull($exported, 'the export can be filtered by organisation');
        $this->assertSame('Food Bank', $exported['organization_name']);
    }

    public function test_a_pledge_to_a_whole_community_campaign_names_no_organisation(): void
    {
        $campaignId = $this->makeCampaign(null);

        $donation = VolunteerDonationService::createDonation(1, [
            'amount' => 20,
            'payment_method' => 'cash',
            'giving_day_id' => $campaignId,
        ]);

        $this->assertNull($donation['organization_id']);
    }

    public function test_a_gift_against_an_opportunity_goes_to_the_opportunitys_organisation(): void
    {
        $orgId = $this->makeOrganisation('Garden Group');
        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'title' => 'Garden day',
            'description' => 'Opportunity used for donation attribution coverage.',
            'status' => 'active',
            'is_active' => 1,
            'created_by' => 1,
            'created_at' => now(),
        ]);

        $this->assertSame(
            ['id' => $orgId, 'name' => 'Garden Group'],
            VolunteerDonationService::resolveDonationOrganisation($this->testTenantId, null, $opportunityId),
        );
    }

    public function test_a_suspended_organisation_is_not_attached_to_new_gifts(): void
    {
        $orgId = $this->makeOrganisation('Suspended Org', 'suspended');
        $campaignId = $this->makeCampaign($orgId);

        $this->assertNull(VolunteerDonationService::resolveDonationOrganisation($this->testTenantId, $campaignId, null));
    }

    // ── Card payments through Stripe ───────────────────────────────────────

    public function test_a_card_payment_tells_stripe_which_organisation_and_campaign_it_is_for(): void
    {
        $this->fakeStripe();
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $orgId = $this->makeOrganisation('Food Bank');
        $campaignId = $this->makeCampaign($orgId, 'Winter appeal');

        $result = StripeDonationService::createPaymentIntent((int) $user->id, $this->testTenantId, [
            'amount' => 25,
            'currency' => 'eur',
            'giving_day_id' => $campaignId,
        ]);

        $params = $this->capturedPaymentIntent();
        $this->assertSame('organization', $params['metadata']['nexus_beneficiary']);
        $this->assertSame((string) $orgId, $params['metadata']['nexus_organization_id']);
        $this->assertSame('Food Bank', $params['metadata']['nexus_organization_name']);
        $this->assertSame((string) $campaignId, $params['metadata']['nexus_giving_day_id']);
        $this->assertSame('Winter appeal', $params['metadata']['nexus_giving_day_title']);
        $this->assertStringContainsString('Donation to Food Bank via ', $params['description']);
        $this->assertStringContainsString('Winter appeal', $params['description']);

        $row = DB::table('vol_donations')->where('id', $result['donation_id'])->first();
        $this->assertSame($orgId, (int) $row->organization_id);
        $this->assertSame($campaignId, (int) $row->giving_day_id);

        $receipt = StripeDonationService::getDonationReceipt((int) $row->id, (int) $user->id, $this->testTenantId);
        $this->assertSame('Food Bank', $receipt['organization_name']);
        $this->assertSame('Winter appeal', $receipt['giving_day_title']);
    }

    public function test_a_whole_community_card_payment_is_marked_as_such_in_stripe(): void
    {
        $this->fakeStripe();
        $user = User::factory()->forTenant($this->testTenantId)->create();

        $result = StripeDonationService::createPaymentIntent((int) $user->id, $this->testTenantId, [
            'amount' => 10,
            'currency' => 'eur',
        ]);

        $params = $this->capturedPaymentIntent();
        $this->assertSame('community', $params['metadata']['nexus_beneficiary']);
        $this->assertArrayNotHasKey('nexus_organization_id', $params['metadata']);
        $this->assertArrayNotHasKey('nexus_giving_day_id', $params['metadata']);
        $this->assertStringStartsWith('Donation to ', $params['description']);
        $this->assertNull(DB::table('vol_donations')->where('id', $result['donation_id'])->value('organization_id'));
    }

    public function test_a_card_payment_refuses_another_communitys_campaign_before_calling_stripe(): void
    {
        $this->fakeStripe();
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $foreignCampaignId = $this->makeCampaign(null, 'Foreign appeal', 999);

        try {
            StripeDonationService::createPaymentIntent((int) $user->id, $this->testTenantId, [
                'amount' => 10,
                'currency' => 'eur',
                'giving_day_id' => $foreignCampaignId,
            ]);
            $this->fail('A foreign campaign id must be refused.');
        } catch (\InvalidArgumentException $e) {
            $this->assertSame([], $this->stripeCalls, 'Stripe must not be called for a refused campaign');
        }
    }
}
