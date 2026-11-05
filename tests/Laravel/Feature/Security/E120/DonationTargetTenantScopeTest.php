<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E120;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Stripe\ApiRequestor;
use Stripe\HttpClient\ClientInterface;
use Tests\Laravel\TestCase;

/**
 * GHSA-4vw7-mwwm-6xq8: a card donation (POST /v2/donations/payment-intent, and
 * the hosted-page twin POST /v2/donations/checkout) must only point at an
 * opportunity, community project or giving day that belongs to the caller's
 * own community. A target id from another community is refused with a 422
 * BEFORE any Stripe call and BEFORE any donation row is written.
 */
class DonationTargetTenantScopeTest extends TestCase
{
    use DatabaseTransactions;

    /** @var array<int, array{method:string,url:string}> */
    private array $stripeCalls = [];

    private int $foreignTenantId;

    private User $member;

    private string $currency;

    protected function setUp(): void
    {
        parent::setUp();

        $this->foreignTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'E120 Foreign Tenant',
            'slug' => 'e120-foreign-' . strtolower(Str::random(8)),
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $currency = strtoupper(trim((string) TenantContext::runForTenant(
            $this->testTenantId,
            fn () => TenantContext::getCurrency()
        )));
        $this->currency = strlen($currency) === 3 ? $currency : 'EUR';

        $this->fakeStripe();
    }

    protected function tearDown(): void
    {
        ApiRequestor::setHttpClient(null);
        parent::tearDown();
    }

    /** Route every Stripe API call to an in-memory fake and record it. */
    private function fakeStripe(): void
    {
        config(['services.stripe.secret' => 'sk_test_e120_fake']);
        $calls = &$this->stripeCalls;

        ApiRequestor::setHttpClient(new class ($calls) implements ClientInterface {
            /** @param array<int, mixed> $calls */
            public function __construct(private array &$calls)
            {
            }

            public function request($method, $absUrl, $headers, $params, $hasFile, $apiMode = 'v1')
            {
                $this->calls[] = ['method' => strtolower($method), 'url' => $absUrl];

                if (str_contains($absUrl, '/v1/customers')) {
                    $body = ['id' => 'cus_e120_fake', 'object' => 'customer'];
                } elseif (str_contains($absUrl, '/v1/payment_intents')) {
                    $id = 'pi_e120_' . bin2hex(random_bytes(4));
                    $body = ['id' => $id, 'object' => 'payment_intent', 'client_secret' => $id . '_secret_fake'];
                } else {
                    return [json_encode(['error' => ['message' => 'unexpected call ' . $absUrl]]), 400, []];
                }

                return [json_encode($body), 200, []];
            }
        });
    }

    private function makeOrganisation(int $tenantId): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => 1,
            'name' => 'E120 Org',
            'slug' => 'e120-org-' . uniqid(),
            'description' => 'Organisation for E120 donation target coverage.',
            'contact_email' => 'e120-org@example.test',
            'status' => 'approved',
            'created_at' => now(),
        ]);
    }

    private function makeOpportunity(int $tenantId): int
    {
        return (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $tenantId,
            'organization_id' => $this->makeOrganisation($tenantId),
            'title' => 'E120 opportunity',
            'description' => 'Opportunity for E120 donation target coverage.',
            'status' => 'active',
            'is_active' => 1,
            'created_by' => 1,
            'created_at' => now(),
        ]);
    }

    private function makeCommunityProject(int $tenantId): int
    {
        return (int) DB::table('vol_community_projects')->insertGetId([
            'tenant_id' => $tenantId,
            'proposed_by' => 1,
            'title' => 'E120 project',
            'description' => 'Community project for E120 donation target coverage.',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeGivingDay(int $tenantId): int
    {
        return (int) DB::table('vol_giving_days')->insertGetId([
            'tenant_id' => $tenantId,
            'title' => 'E120 appeal',
            'start_date' => now()->subDay()->toDateString(),
            'end_date' => now()->addWeek()->toDateString(),
            'goal_amount' => 1000,
            'raised_amount' => 0,
            'is_active' => 1,
            'created_by' => 1,
            'created_at' => now(),
        ]);
    }

    private function makeTarget(string $field, int $tenantId): int
    {
        return match ($field) {
            'opportunity_id' => $this->makeOpportunity($tenantId),
            'community_project_id' => $this->makeCommunityProject($tenantId),
            'giving_day_id' => $this->makeGivingDay($tenantId),
        };
    }

    private function donationCount(): int
    {
        return DB::table('vol_donations')->where('user_id', $this->member->id)->count();
    }

    /** @return array<string, array{0:string, 1:string}> */
    public static function targetFields(): array
    {
        return [
            'opportunity / card form' => ['opportunity_id', '/v2/donations/payment-intent'],
            'community project / card form' => ['community_project_id', '/v2/donations/payment-intent'],
            'giving day / card form' => ['giving_day_id', '/v2/donations/payment-intent'],
            'opportunity / hosted page' => ['opportunity_id', '/v2/donations/checkout'],
            'community project / hosted page' => ['community_project_id', '/v2/donations/checkout'],
            'giving day / hosted page' => ['giving_day_id', '/v2/donations/checkout'],
        ];
    }

    /** @return array<string, array{0:string}> */
    public static function cardFormTargetFields(): array
    {
        return [
            'opportunity' => ['opportunity_id'],
            'community project' => ['community_project_id'],
            'giving day' => ['giving_day_id'],
        ];
    }

    /**
     * @dataProvider targetFields
     */
    public function test_a_target_from_another_community_is_refused_before_stripe_and_before_any_row(string $field, string $uri): void
    {
        $foreignTargetId = $this->makeTarget($field, $this->foreignTenantId);
        Sanctum::actingAs($this->member, ['*']);
        $before = $this->donationCount();

        $response = $this->apiPost($uri, [
            'amount' => 10,
            'currency' => $this->currency,
            $field => $foreignTargetId,
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
        $this->assertSame($before, $this->donationCount(), 'no donation row may be written for a foreign target');
        $this->assertSame(
            0,
            DB::table('vol_donations')->where($field, $foreignTargetId)->where('tenant_id', $this->testTenantId)->count(),
            'the foreign target id must never be stored on this community\'s donation'
        );
        $this->assertSame([], $this->stripeCalls, 'Stripe must not be called for a refused target');
    }

    /**
     * @dataProvider cardFormTargetFields
     */
    public function test_a_target_that_does_not_exist_anywhere_is_refused(string $field): void
    {
        Sanctum::actingAs($this->member, ['*']);
        $before = $this->donationCount();

        $response = $this->apiPost('/v2/donations/payment-intent', [
            'amount' => 10,
            'currency' => $this->currency,
            $field => 2147480000,
        ]);

        $response->assertStatus(422);
        $this->assertSame($before, $this->donationCount());
        $this->assertSame([], $this->stripeCalls);
    }

    /**
     * @dataProvider cardFormTargetFields
     */
    public function test_a_target_from_the_callers_own_community_still_works(string $field): void
    {
        $targetId = $this->makeTarget($field, $this->testTenantId);
        Sanctum::actingAs($this->member, ['*']);

        $response = $this->apiPost('/v2/donations/payment-intent', [
            'amount' => 10,
            'currency' => $this->currency,
            $field => $targetId,
        ]);

        $response->assertStatus(200);
        $donationId = (int) $response->json('data.donation_id');
        $this->assertGreaterThan(0, $donationId);

        $row = DB::table('vol_donations')->where('id', $donationId)->first();
        $this->assertNotNull($row);
        $this->assertSame($this->testTenantId, (int) $row->tenant_id);
        $this->assertSame($targetId, (int) $row->{$field});
        $this->assertSame('pending', $row->status);
    }
}
