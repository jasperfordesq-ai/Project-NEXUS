<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Core\TenantContext;
use App\Http\Controllers\Api\FederationExternalWebhookController;
use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-423 (E-069 slice J, J-3) — a suspended external partner must not be able to
 * reinstate itself, and a partner-initiated event must not erase the operator's
 * record of why it was suspended.
 *
 * `handlePartnershipActivated()` set `status = 'active'`, `error_count = 0` and
 * `last_error = null`. `VALID_TRANSITIONS` permits `suspended => active`,
 * `handleEvent()` never checks the partner's status, and `partnerAllowsEvent()`
 * maps no permission flag to the three `partnership.*` events, so they are
 * always permitted.
 *
 * 🔴 LATENT, NOT LIVE. Both HTTP entry points refuse a non-active partner
 * before dispatch — `receive()` (`:136-138`) and
 * `FederationNativeIngestController` (`:177-179`) — so this was never reachable
 * over the wire. It is fixed because `processTrustedEvent()` is a PUBLIC method
 * whose contract carries no status check: a third caller that omitted that one
 * line would have handed a suspended partner its own reinstatement, and partner
 * suspension is the operator's only lever against a hostile partner. Same shape
 * as F-173.
 *
 * The defect is therefore driven through `processTrustedEvent()` directly. The
 * HTTP refusal is asserted as a control so the fix cannot be mistaken for a
 * reason to weaken it.
 *
 * These tests assert the CORRECT behaviour and fail before the fix.
 */
final class F423SuspendedPartnerCannotReinstateItselfTest extends TestCase
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
     * A partner the operator has suspended must not be able to reactivate
     * itself, and the operator's error record must survive.
     */
    public function test_a_suspended_partner_cannot_reinstate_itself(): void
    {
        $partner = $this->partner('f423-suspended');

        DB::table('federation_external_partners')
            ->where('id', (int) $partner->id)
            ->update([
                'status' => 'suspended',
                'error_count' => 7,
                'last_error' => 'operator suspended this partner',
            ]);

        $partner = $this->reload($partner);
        self::assertSame('suspended', (string) $partner->status, 'precondition: the operator has suspended this partner');

        $result = app(FederationExternalWebhookController::class)
            ->processTrustedEvent('partnership.activated', [], $partner);

        self::assertSame('rejected', $result['status'] ?? null, 'a suspended partner must not be able to reactivate itself');

        $row = $this->reload($partner);
        self::assertSame('suspended', (string) $row->status, 'and the suspension must stand');
        self::assertSame(7, (int) $row->error_count, 'and the operator\'s error count must survive');
        self::assertSame(
            'operator suspended this partner',
            (string) $row->last_error,
            'and the operator\'s recorded reason must survive'
        );
    }

    /**
     * CONTROL — the rightful case. A partner that is still `pending` is genuinely
     * activated, which is what this handler exists for. It differs from the case
     * above only in the partner's status.
     */
    public function test_control_a_pending_partner_is_still_activated(): void
    {
        $partner = $this->partner('f423-pending');

        DB::table('federation_external_partners')
            ->where('id', (int) $partner->id)
            ->update(['status' => 'pending']);

        $partner = $this->reload($partner);

        $result = app(FederationExternalWebhookController::class)
            ->processTrustedEvent('partnership.activated', [], $partner);

        self::assertSame('activated', $result['status'] ?? null, 'control: a legitimate activation still works');
        self::assertSame('active', (string) $this->reload($partner)->status, 'control: and the partner really is active');
    }

    /**
     * CONTROL — a partner-initiated activation must not erase the operator's
     * record even when the activation itself is legitimate. `error_count` and
     * `last_error` are reset by the operator and by the sync command, never by
     * the partner.
     */
    public function test_control_a_legitimate_activation_does_not_erase_the_error_record(): void
    {
        $partner = $this->partner('f423-record');

        DB::table('federation_external_partners')
            ->where('id', (int) $partner->id)
            ->update([
                'status' => 'pending',
                'error_count' => 4,
                'last_error' => 'three sync timeouts last week',
            ]);

        $partner = $this->reload($partner);

        app(FederationExternalWebhookController::class)
            ->processTrustedEvent('partnership.activated', [], $partner);

        $row = $this->reload($partner);
        self::assertSame('active', (string) $row->status, 'control: the activation still happened');
        self::assertSame(4, (int) $row->error_count, 'the partner may not clear the operator\'s error counter');
        self::assertSame(
            'three sync timeouts last week',
            (string) $row->last_error,
            'nor the operator\'s recorded reason'
        );
    }

    /**
     * CONTROL, end to end over HTTP — the compensating control that kept this
     * latent. It must NOT be weakened by the handler-level fix: the same
     * partner, over the real webhook route with real Bearer authentication and
     * a real nonce, is still refused 403 before dispatch. The first arm proves
     * the request is otherwise well formed.
     */
    public function test_control_the_http_entry_point_still_refuses_a_suspended_partner(): void
    {
        $partner = $this->partner('f423-http');

        // Arm 1 — active partner, same auth and nonce shape: accepted.
        $this->postWebhook($partner, 'health_check', 'f423-nonce-active-' . uniqid())->assertStatus(200);

        // Arm 2 — the single property under test flipped to 'suspended'.
        DB::table('federation_external_partners')
            ->where('id', (int) $partner->id)
            ->update(['status' => 'suspended']);

        $this->postWebhook($partner, 'partnership.activated', 'f423-nonce-susp-' . uniqid())->assertStatus(403);

        self::assertSame(
            'suspended',
            (string) $this->reload($partner)->status,
            'CONTROL HELD: the suspended partner could not reinstate itself over HTTP'
        );
    }

    /** CONTROL — `failed` is terminal and stays terminal. */
    public function test_control_a_terminated_partnership_is_still_terminal(): void
    {
        $partner = $this->partner('f423-terminal');

        app(FederationExternalWebhookController::class)
            ->processTrustedEvent('partnership.terminated', [], $partner);
        self::assertSame('failed', (string) $this->reload($partner)->status);

        $partner = $this->reload($partner);
        $result = app(FederationExternalWebhookController::class)
            ->processTrustedEvent('partnership.activated', [], $partner);

        self::assertSame('rejected', $result['status'] ?? null);
        self::assertSame('failed', (string) $this->reload($partner)->status, 'CONTROL HELD: terminated is terminal');
    }

    /**
     * CONTROL — a partner still cannot reach another partner's row. Every id an
     * attacker might hope is honoured is sent in the payload; none is read.
     */
    public function test_control_a_partner_can_only_change_its_own_row(): void
    {
        $a = $this->partner('f423-self');
        $b = $this->partner('f423-other');

        app(FederationExternalWebhookController::class)->processTrustedEvent('partnership.suspended', [
            'partner_id' => (int) $b->id,
            'tenant_id' => (int) $b->tenant_id,
            'id' => (int) $b->id,
        ], $a);

        self::assertSame('suspended', (string) $this->reload($a)->status, 'the sending partner suspended itself');
        self::assertSame(
            'active',
            (string) $this->reload($b)->status,
            'CONTROL HELD: the other partnership named in the payload is untouched'
        );
    }

    // ── harness ─────────────────────────────────────────────────────────────

    private function postWebhook(object $partner, string $event, string $nonce): TestResponse
    {
        return $this->withHeaders([
            'Authorization' => 'Bearer ' . $partner->signing_secret,
            'X-Federation-Nonce' => $nonce,
            'Content-Type' => 'application/json',
        ])->postJson('/api/v2/federation/external/webhooks/receive', [
            'event' => $event,
            'partner_id' => (int) $partner->id,
            'data' => [],
        ]);
    }

    private function reload(object $partner): object
    {
        return DB::table('federation_external_partners')->where('id', (int) $partner->id)->first();
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

    private function partner(string $tag): object
    {
        $id = (int) DB::table('federation_external_partners')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'E076 F-423 partner ' . $tag,
            'base_url' => 'https://93.184.216.' . (1 + (self::$urlSeq++ % 254)),
            'api_path' => '/api/v1',
            'protocol_type' => 'nexus',
            'auth_method' => 'api_key',
            'api_key' => 'f423-fixture-key-' . $tag,
            'signing_secret' => 'f423-fixture-secret-' . $tag,
            'status' => 'active',
            'created_at' => now(),
        ]);

        return DB::table('federation_external_partners')->where('id', $id)->first();
    }
}
