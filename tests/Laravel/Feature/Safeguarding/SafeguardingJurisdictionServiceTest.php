<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\SafeguardingJurisdictionService;
use App\Services\SafeguardingTriggerService;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * Pins the jurisdiction policy table and the contact-gate behaviour that
 * depends on it.
 *
 * The POLICIES table in SafeguardingJurisdictionService is a product/legal
 * decision, not an implementation detail: whether a jurisdiction's
 * contact_policy_available flag is true decides whether "only vetted people
 * may contact me" can work AT ALL for every tenant in that jurisdiction.
 * Before 2026-08-28 `ireland` was false, which meant an Irish tenant had no
 * valid configuration and members' matches lists were silently emptied
 * (Sentry 134069538). Any change to a row here must be deliberate — update
 * the provider below in the same commit and say why in the commit message.
 */
class SafeguardingJurisdictionServiceTest extends TestCase
{
    use DatabaseTransactions;

    private SafeguardingJurisdictionService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(SafeguardingJurisdictionService::class);
        $this->service->forget($this->testTenantId);
    }

    /**
     * @return array<string, array{string, string|null, string|null, string, bool, list<string>}>
     */
    public static function jurisdictionPolicyProvider(): array
    {
        return [
            'united_kingdom' => [
                'united_kingdom',
                'uk_national_safeguarding',
                'uk_safeguarding_clearance',
                'safeguarded-contact-v2',
                true,
                ['dbs_enhanced', 'pvg_scotland', 'access_ni'],
            ],
            'england_wales' => [
                'england_wales',
                'dbs_england_wales',
                'dbs_enhanced',
                'safeguarded-contact-v1',
                true,
                ['dbs_enhanced'],
            ],
            'scotland' => [
                'scotland',
                'pvg_scotland',
                'pvg_scotland',
                'safeguarded-contact-v1',
                true,
                ['pvg_scotland'],
            ],
            'northern_ireland' => [
                'northern_ireland',
                'access_ni',
                'access_ni',
                'safeguarded-contact-v1',
                true,
                ['access_ni'],
            ],
            // Enabled 2026-08-28 by owner decision. Before that this row was
            // (false, []) — Garda Vetting gating was switched off, so an Irish
            // tenant had NO valid configuration and the contact gate was
            // permanently UNAVAILABLE (Sentry 134069538). Flipping this back
            // to false re-breaks every Irish tenant; do not do it casually.
            'ireland' => [
                'ireland',
                'garda_vetting',
                'garda_vetting',
                'safeguarded-contact-v1',
                true,
                ['garda_vetting'],
            ],
            'custom' => [
                'custom',
                null,
                null,
                'custom-unconfigured-v1',
                false,
                [],
            ],
        ];
    }

    /**
     * @param list<string> $expectedCertificationCodes
     */
    #[DataProvider('jurisdictionPolicyProvider')]
    public function test_jurisdiction_policy_definitions_are_pinned(
        string $jurisdiction,
        ?string $expectedSchemeCode,
        ?string $expectedAttestationCode,
        string $expectedPolicyVersionPrefix,
        bool $expectedContactPolicyAvailable,
        array $expectedCertificationCodes,
    ): void {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $this->service->configure($this->testTenantId, $jurisdiction, $admin->id);
        $policy = $this->service->getPolicyUncached($this->testTenantId);

        $this->assertTrue($policy['configured']);
        $this->assertSame($jurisdiction, $policy['jurisdiction']);
        $this->assertSame($expectedSchemeCode, $policy['scheme_code']);
        $this->assertSame($expectedAttestationCode, $policy['attestation_code']);
        $this->assertSame($expectedContactPolicyAvailable, $policy['contact_policy_available']);
        $this->assertStringStartsWith($expectedPolicyVersionPrefix . ':', (string) $policy['policy_version']);
        $this->assertSame(
            $expectedCertificationCodes,
            array_map(
                static fn (array $option): string => $option['code'],
                $policy['certification_options'],
            ),
        );
    }

    public function test_unconfigured_tenant_policy_is_unusable_for_the_contact_gate(): void
    {
        DB::table('tenant_safeguarding_settings')->where('tenant_id', $this->testTenantId)->delete();

        $policy = $this->service->getPolicyUncached($this->testTenantId);

        $this->assertFalse($policy['configured']);
        $this->assertFalse($policy['contact_policy_available']);
        $this->assertSame(SafeguardingJurisdictionService::UNCONFIGURED, $policy['jurisdiction']);
        $this->assertNull($policy['scheme_code']);
        $this->assertNull($policy['attestation_code']);
        $this->assertNull($policy['policy_version']);
    }

    public function test_configure_rejects_an_unknown_jurisdiction(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $this->expectException(SafeguardingPolicyException::class);
        $this->service->configure($this->testTenantId, 'atlantis', $admin->id);
    }

    public function test_unconfigured_reset_deletes_the_settings_row(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $this->service->configure($this->testTenantId, 'england_wales', $admin->id);
        $this->assertDatabaseHas('tenant_safeguarding_settings', ['tenant_id' => $this->testTenantId]);

        $this->service->configure($this->testTenantId, SafeguardingJurisdictionService::UNCONFIGURED, $admin->id);
        $this->assertDatabaseMissing('tenant_safeguarding_settings', ['tenant_id' => $this->testTenantId]);
    }

    public function test_garda_vetting_is_a_supported_attestation_code(): void
    {
        $this->assertTrue(SafeguardingJurisdictionService::isSupportedAttestationCode('garda_vetting'));
        $this->assertFalse(SafeguardingJurisdictionService::isSupportedAttestationCode('made_up_code'));
    }

    /**
     * The production defect behind Sentry 134069538: a tenant with a live
     * vetted-interaction preference but no configured jurisdiction makes the
     * contact gate UNAVAILABLE (fail closed), which silently drops candidates
     * from matches. This pins the failure mode so a rewrite cannot turn it
     * into a fail-open.
     */
    public function test_unconfigured_jurisdiction_makes_the_contact_gate_unavailable(): void
    {
        DB::table('tenant_safeguarding_settings')->where('tenant_id', $this->testTenantId)->delete();
        $this->service->forget($this->testTenantId);

        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->protectRecipient($recipient, 'garda_vetting');

        $decision = app(SafeguardingInteractionPolicy::class)->evaluateLocalContact(
            $sender->id,
            $recipient->id,
            $this->testTenantId,
            'match_discovery',
        );

        $this->assertSame(SafeguardingInteractionDecision::UNAVAILABLE, $decision->status);
        $this->assertSame('SAFEGUARDING_POLICY_UNAVAILABLE', $decision->code);
        $this->assertFalse($decision->isAllowed());
    }

    /**
     * The point of enabling Ireland: a configured Irish tenant gives real
     * decisions — DENY for an unvetted sender, ALLOW once a broker records a
     * Garda Vetting confirmation — instead of UNAVAILABLE for everyone.
     */
    public function test_configured_ireland_gate_denies_unvetted_and_allows_garda_vetted_contact(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        \Laravel\Sanctum\Sanctum::actingAs($admin);
        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'ireland'])
            ->assertStatus(200)
            ->assertJsonPath('data.policy.jurisdiction', 'ireland')
            ->assertJsonPath('data.policy.attestation_code', 'garda_vetting')
            ->assertJsonPath('data.policy.contact_policy_available', true)
            ->assertJsonPath('data.policy.certification_options.0.code', 'garda_vetting');

        $this->protectRecipient($recipient, 'garda_vetting');
        $policy = app(SafeguardingInteractionPolicy::class);

        $denied = $policy->evaluateLocalContact($sender->id, $recipient->id, $this->testTenantId, 'match_discovery');
        $this->assertSame(SafeguardingInteractionDecision::DENY, $denied->status);
        $this->assertSame('VETTING_REQUIRED', $denied->code);
        $this->assertSame(['garda_vetting'], $denied->requiredAttestationCodes);

        \Laravel\Sanctum\Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/vetting/user/{$sender->id}/confirm", [
            'acknowledgement' => true,
            'certification_codes' => ['garda_vetting'],
        ])->assertStatus(201)
            ->assertJsonPath('data.certification_codes.0', 'garda_vetting');

        $allowed = $policy->evaluateLocalContact($sender->id, $recipient->id, $this->testTenantId, 'match_discovery');
        $this->assertTrue(
            $allowed->isAllowed(),
            'A Garda-vetted sender must be allowed; got ' . $allowed->status . ' / ' . $allowed->code,
        );
    }

    /**
     * An unconfigured jurisdiction is a steady-state configuration fact, not
     * a per-request failure: it must log at WARNING (below the sentry
     * channel's ERROR threshold) and only once per policy instance per
     * tenant/reason, however many candidates a matching sweep evaluates.
     * Before 2026-08-28 one matches page load could emit hundreds of ERROR
     * lines (Sentry 134069538).
     */
    public function test_unconfigured_jurisdiction_logs_one_warning_not_an_error_per_candidate(): void
    {
        DB::table('tenant_safeguarding_settings')->where('tenant_id', $this->testTenantId)->delete();
        $this->service->forget($this->testTenantId);

        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipients = User::factory()->count(3)->forTenant($this->testTenantId)->create(['status' => 'active']);
        foreach ($recipients as $recipient) {
            $this->protectRecipient($recipient, 'garda_vetting');
        }

        \Illuminate\Support\Facades\Log::spy();

        $policy = app(SafeguardingInteractionPolicy::class);
        foreach ($recipients as $recipient) {
            $decision = $policy->evaluateLocalContact($sender->id, $recipient->id, $this->testTenantId, 'match_discovery');
            $this->assertSame(SafeguardingInteractionDecision::UNAVAILABLE, $decision->status);
        }

        \Illuminate\Support\Facades\Log::shouldHaveReceived('warning')
            ->with('Safeguarding interaction policy unavailable', \Mockery::on(
                static fn (array $context): bool => ($context['reason_code'] ?? null) === 'jurisdiction_unconfigured_or_unsupported',
            ))
            ->once();
        \Illuminate\Support\Facades\Log::shouldNotHaveReceived('error');
    }

    /**
     * End to end: a member in a tenant with an unusable safeguarding policy
     * opens their matches page and is TOLD why the list is limited, instead
     * of a bare empty state. The candidate pool is stubbed at the retriever
     * so the test controls exactly one candidate — owned by a protected
     * member — which the gate then drops as UNAVAILABLE.
     */
    public function test_matches_endpoint_reports_safeguarding_degradation_to_the_member(): void
    {
        DB::table('tenant_safeguarding_settings')->where('tenant_id', $this->testTenantId)->delete();
        $this->service->forget($this->testTenantId);

        // The searcher has coordinates so the pre-existing no_coordinates
        // degradation cannot mask the safeguarding one (it has precedence).
        $searcher = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'latitude' => 53.35,
            'longitude' => -6.26,
        ]);
        $protected = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->protectRecipient($protected, 'garda_vetting');

        $retriever = \Mockery::mock(\App\Services\Matching\CandidateRetriever::class);
        $retriever->shouldReceive('retrieveBatch')->andReturn([])->byDefault();
        $retriever->shouldReceive('retrieveColdStart')
            ->andReturn([[
                'id' => 424242,
                'user_id' => $protected->id,
                'title' => 'Gardening help',
                'description' => str_repeat('A neighbourly offer. ', 10),
                'type' => 'offer',
            ]])
            ->byDefault();
        $this->app->instance(\App\Services\Matching\CandidateRetriever::class, $retriever);

        \Laravel\Sanctum\Sanctum::actingAs($searcher);
        $this->apiGet('/v2/matches/all?modules=listings&limit=4')
            ->assertStatus(200)
            ->assertJsonPath('data.meta.degraded', true)
            ->assertJsonPath('data.meta.degraded_reason', 'safeguarding_policy_unavailable')
            ->assertJsonPath('data.meta.total', 0);
    }

    private function protectRecipient(User $recipient, string $vettingTypeRequired): void
    {
        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'test_vetted_contact_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'Test safeguarded contact',
            'description' => 'Test safeguarded contact',
            'sort_order' => 999,
            'is_active' => 1,
            'is_required' => 0,
            'triggers' => json_encode([
                'requires_vetted_interaction' => true,
                'vetting_type_required' => $vettingTypeRequired,
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $recipient->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        SafeguardingTriggerService::invalidateCache($recipient->id, $this->testTenantId);
    }
}
