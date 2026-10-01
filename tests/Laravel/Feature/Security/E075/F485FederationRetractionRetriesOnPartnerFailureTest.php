<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Events\UserFederatedOptOut;
use App\Listeners\PushFederationDataRetraction;
use App\Models\User;
use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-485 (E-075 slice G, G-3) — the outbound GDPR erasure must survive a partner
 * that is down or refusing.
 *
 * `PushFederationDataRetraction` declares `$tries = 4`, a 5 min / 30 min / 2 h
 * backoff and a `failed()` hook whose purpose is to page an operator for a
 * manual retraction. None of it could ever run: the listener collected a failed
 * partner only inside `catch (\Throwable)`, while
 * `FederationExternalApiClient::request()` (`:573-728`) catches every transport
 * exception itself and RETURNS `['success' => false, …]`. Nothing was thrown,
 * `$failedPartners` stayed empty, and the queue recorded a success for an
 * erasure instruction that was dropped.
 *
 * The correct pattern is two files away:
 * `PushTransactionToFederatedPartner:88-101` inspects the returned array and
 * throws. This fix copies it, including its documented exception for a push
 * refused by the external-federation kill switch — that is a deliberate
 * operator state, not a transient partner fault, and retrying it would burn
 * the job's attempts and raise alerts on every queued retraction until the
 * switch is turned back on.
 *
 * These tests assert the CORRECT behaviour and fail before the fix.
 *
 * NOT FIXED HERE, reported instead: the loop is keyed on `federated_identities`,
 * whose only writer `FederatedIdentityService::link()` has no callers anywhere,
 * so no external retraction has ever actually been sent. Inventing a caller
 * was out of scope.
 *
 * OBSERVATION POINT, stated honestly. `Http::fake()` intercepts the request, so
 * no bytes leave the container and no real partner is contacted — the container
 * has no outbound DNS, which is why the partner fixture uses a public-IP
 * literal. Real wire transmission is not exercised.
 */
final class F485FederationRetractionRetriesOnPartnerFailureTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    /** federation_external_partners has UNIQUE (tenant_id, base_url). */
    private static int $urlSeq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        $this->enableTenantFederation();
        $this->enableExternalFederation();
    }

    /**
     * A partner that refuses the erasure with a hard 500 must leave the job in a
     * failed state, so the declared retries run and `failed()` can page an
     * operator. Returning normally records a success for an erasure that never
     * happened.
     */
    public function test_a_refused_retraction_fails_the_job_so_it_can_be_retried(): void
    {
        Http::fake(['*' => Http::response(['error' => 'partner exploded'], 500)]);

        $member = $this->member();
        $partner = $this->partner('f485-refused', ['allow_member_sync' => 1]);
        $this->identity((int) $member->id, $partner);

        $threw = null;
        try {
            app(PushFederationDataRetraction::class)->handle(
                new UserFederatedOptOut((int) $member->id, $this->testTenantId, 'account_deleted')
            );
        } catch (\Throwable $e) {
            $threw = $e;
        }

        self::assertNotNull(
            $threw,
            'a refused GDPR erasure must fail the job so the declared retries and failed() can run'
        );

        $log = DB::table('federation_external_partner_logs')
            ->where('partner_id', $partner)
            ->orderByDesc('id')
            ->first();
        self::assertNotNull($log, 'precondition: the retraction really was attempted');
        self::assertSame(500, (int) $log->response_code, 'precondition: with a hard 500, not a local guard refusal');
    }

    /**
     * CONTROL — the rightful case. A healthy partner accepts the erasure, it is
     * delivered, and the job completes normally. Differs from the case above
     * only in the partner's answer.
     */
    public function test_control_an_accepted_retraction_is_delivered_and_does_not_fail(): void
    {
        Http::fake(['*' => Http::response(['success' => true], 200)]);

        $member = $this->member();
        $partner = $this->partner('f485-accepted', ['allow_member_sync' => 1]);
        $this->identity((int) $member->id, $partner);

        app(PushFederationDataRetraction::class)->handle(
            new UserFederatedOptOut((int) $member->id, $this->testTenantId, 'account_deleted')
        );

        Http::assertSentCount(1);
    }

    /**
     * CONTROL — a retraction refused by the external-federation KILL SWITCH must
     * NOT fail the job. The switch is a deliberate operator state, so retrying
     * cannot help: it would burn the attempts and alert on every queued
     * retraction until the switch is turned back on. This is the same exception
     * the sibling listener documents at
     * PushTransactionToFederatedPartner::isRetryablePartnerFailure().
     */
    public function test_control_a_kill_switch_refusal_does_not_fail_the_job(): void
    {
        Http::fake(['*' => Http::response(['success' => true], 200)]);

        // Turn the external transport off, which is how it ships.
        DB::table('federation_system_control')->updateOrInsert(
            ['id' => 1],
            ['external_federation_enabled' => 0, 'updated_at' => now()]
        );
        app(FederationFeatureService::class)->clearCache();

        $member = $this->member();
        $partner = $this->partner('f485-blocked', ['allow_member_sync' => 1]);
        $this->identity((int) $member->id, $partner);

        app(PushFederationDataRetraction::class)->handle(
            new UserFederatedOptOut((int) $member->id, $this->testTenantId, 'account_deleted')
        );

        Http::assertNothingSent();
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** Established explicitly rather than inherited from a developer `.env`. */
    private function enableTenantFederation(): void
    {
        DB::table('federation_tenant_features')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'feature_key' => FederationFeatureService::TENANT_FEDERATION_ENABLED],
            ['is_enabled' => 1]
        );

        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true);
        $features = is_array($features) ? $features : [];
        $features['federation'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);

        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    /** @param array<string,int> $flags */
    private function partner(string $tag, array $flags): int
    {
        return (int) DB::table('federation_external_partners')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'name' => 'E076 F-485 partner ' . $tag,
            // A public-IP LITERAL: OutboundUrlGuard short-circuits on IP
            // literals, so no DNS is needed. Nothing leaves the container —
            // Http::fake() intercepts every request.
            'base_url' => 'https://93.184.216.' . (1 + (self::$urlSeq++ % 254)),
            'api_path' => '/api/v1',
            'protocol_type' => 'nexus',
            'auth_method' => 'api_key',
            'api_key' => 'f485-fixture-key-' . $tag,
            'signing_secret' => 'f485-fixture-secret-' . $tag,
            'status' => 'active',
            'created_at' => now(),
        ], $flags));
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
            'balance' => 0,
        ]);
    }

    private function identity(int $memberId, int $partnerId): void
    {
        DB::table('federated_identities')->insert([
            'tenant_id' => $this->testTenantId,
            'local_user_id' => $memberId,
            'partner_id' => $partnerId,
            'external_user_id' => 'f485-external-' . $memberId,
            'external_handle' => 'f485-handle',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
