<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-407 — the external-webhook inbound credit protocol must be bound by the
 * same credit agreement the other three inbound protocols already use.
 *
 * An inbound external credit creates spendable time credit inside a community
 * with no matching local debit anywhere — `sender_tenant_id` is literally 0.
 * `SecurityBounds::MAX_SINGLE_EXTERNAL_CREDIT_HOURS` caps a SINGLE transfer at
 * 24 hours, and the only accumulation control was idempotency on
 * `external_transaction_id`, a string the sending partner chooses freely. So a
 * partner repeated the call with a fresh identifier and minted without limit.
 *
 * This is the same defect as F-345, which was fixed on the Credit Commons
 * protocol (`FederationCreditCommonsController::inboundCreditCeilingRefusal`)
 * one day before this engagement. The v1 partner API refuses outright without
 * an active agreement (`NO_CREDIT_AGREEMENT`) and Komunitin publishes its
 * credit limit from `max_monthly_credits`. This protocol — the fourth, and the
 * one actually wired to POST /v2/federation/external/webhooks/receive — was the
 * one the fix did not reach.
 *
 * Both money-moving handlers are covered: `transaction.requested` and
 * `transaction.completed` have the same shape and both credit `users.balance`.
 *
 * Observation point, stated honestly: these tests drive the handlers through
 * the public entry point `processTrustedEvent()`, which runs the same
 * `handleEvent()` the HTTP route runs, so the platform kill switch, the tenant
 * federation switch, the tenant `federation` feature and the partner's
 * `allow_transactions` flag all apply. They do NOT exercise the HMAC / Bearer
 * authentication or the nonce replay store in `receive()`; the finding is about
 * what an authenticated, active partner can do once through.
 */
final class F407ExternalWebhookCreditCeilingTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * CORRECT BEHAVIOUR — a partner cannot mint past the community's agreed
     * monthly ceiling by varying the transaction identifier.
     */
    public function test_partner_cannot_mint_past_the_monthly_credit_ceiling(): void
    {
        $this->enableFederation();
        $partner = $this->partner('ceiling', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->creditAgreement(maxMonthlyCredits: 50.0);

        $this->assertSame(0.0, $this->balance($member), 'precondition: the member starts at zero');

        // Two lawful transfers inside the ceiling.
        $this->credit($partner, $this->payload($member, 'f407-ceiling-1', 24.0));
        $this->credit($partner, $this->payload($member, 'f407-ceiling-2', 24.0));
        $this->assertSame(48.0, $this->balance($member), 'two transfers inside the ceiling are credited');

        // The third would take the month to 72 hours against a ceiling of 50.
        $refused = $this->credit($partner, $this->payload($member, 'f407-ceiling-3', 24.0));

        $this->assertSame('rejected', $refused['status'] ?? null, 'the transfer past the ceiling is refused');
        $this->assertSame(
            48.0,
            $this->balance($member),
            'nothing was credited by the refused call — the aggregate ceiling holds against a fresh identifier'
        );
        $this->assertSame(
            2,
            (int) DB::table('federation_transactions')
                ->where('receiver_user_id', (int) $member->id)
                ->where('external_partner_id', (int) $partner->id)
                ->count(),
            'no ledger row was written for the refused transfer'
        );
    }

    /**
     * CORRECT BEHAVIOUR — an agreement that records no number is not "unlimited".
     * The fallback ceiling applies, matching Credit Commons'
     * DEFAULT_MONTHLY_INBOUND_CREDIT_HOURS.
     */
    public function test_an_agreement_with_no_stated_limit_falls_back_to_the_default_ceiling(): void
    {
        $this->enableFederation();
        $partner = $this->partner('fallback', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->creditAgreement(maxMonthlyCredits: null);

        // 8 x 24 = 192, inside the 200-hour fallback.
        for ($i = 1; $i <= 8; $i++) {
            $this->credit($partner, $this->payload($member, 'f407-fallback-' . $i, 24.0));
        }
        $this->assertSame(192.0, $this->balance($member), 'transfers inside the fallback ceiling are credited');

        // The ninth would reach 216.
        $refused = $this->credit($partner, $this->payload($member, 'f407-fallback-9', 24.0));

        $this->assertSame('rejected', $refused['status'] ?? null, 'a null max_monthly_credits does not mean unlimited');
        $this->assertSame(192.0, $this->balance($member), 'nothing was credited past the fallback ceiling');
    }

    /**
     * CORRECT BEHAVIOUR — with no credit agreement at all, inbound credit is
     * refused outright, exactly as the v1 partner API already does.
     */
    public function test_without_a_credit_agreement_inbound_credit_is_refused(): void
    {
        $this->enableFederation();
        $partner = $this->partner('no-agreement', ['allow_transactions' => 1]);
        $member = $this->member();

        $this->assertSame(
            0,
            (int) DB::table('federation_credit_agreements')->where('to_tenant_id', $this->testTenantId)->count(),
            'precondition: nothing authorises this community to receive external credit'
        );

        $refused = $this->credit($partner, $this->payload($member, 'f407-unauthorised-1', 24.0));

        $this->assertSame('rejected', $refused['status'] ?? null, 'inbound credit with no agreement is refused');
        $this->assertSame(0.0, $this->balance($member), 'the member was not credited');
        $this->assertSame(
            0,
            (int) DB::table('federation_transactions')
                ->where('receiver_user_id', (int) $member->id)
                ->count(),
            'no ledger row was written'
        );
    }

    /**
     * CONTROL — the rightful case must keep working. A single lawful transfer
     * under an active agreement is still credited, so the fix is not
     * "stop crediting".
     */
    public function test_control_a_lawful_transfer_under_an_agreement_still_succeeds(): void
    {
        $this->enableFederation();
        $partner = $this->partner('lawful', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->creditAgreement(maxMonthlyCredits: 100.0);

        $this->credit($partner, $this->payload($member, 'f407-lawful-1', 24.0));

        $this->assertSame(24.0, $this->balance($member), 'control: a lawful transfer is credited');
        $this->assertSame(
            1,
            (int) DB::table('federation_transactions')
                ->where('receiver_user_id', (int) $member->id)
                ->where('external_partner_id', (int) $partner->id)
                ->where('status', 'completed')
                ->count(),
            'control: the ledger row exists'
        );
    }

    /**
     * CORRECT BEHAVIOUR — `transaction.completed` has the same shape and credits
     * the same balance, so it carries the same ceiling.
     */
    public function test_the_transaction_completed_handler_is_bounded_too(): void
    {
        $this->enableFederation();
        $partner = $this->partner('completed', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->creditAgreement(maxMonthlyCredits: 30.0);

        $this->credit($partner, $this->payload($member, 'f407-completed-1', 24.0), 'transaction.completed');
        $this->assertSame(24.0, $this->balance($member), 'the first completed transfer is credited');

        $refused = $this->credit($partner, $this->payload($member, 'f407-completed-2', 24.0), 'transaction.completed');

        $this->assertSame('rejected', $refused['status'] ?? null, 'transaction.completed is bounded by the same ceiling');
        $this->assertSame(24.0, $this->balance($member), 'nothing was credited past the ceiling');
    }

    /**
     * CORRECT BEHAVIOUR — the ceiling counts every externally-originated credit
     * into the community this month, not just this member's. Two members cannot
     * be used to double the community's budget.
     */
    public function test_the_ceiling_is_a_community_total_not_a_per_member_one(): void
    {
        $this->enableFederation();
        $partner = $this->partner('community-total', ['allow_transactions' => 1]);
        $first = $this->member();
        $second = $this->member();
        $this->creditAgreement(maxMonthlyCredits: 30.0);

        $this->credit($partner, $this->payload($first, 'f407-total-1', 24.0));
        $this->assertSame(24.0, $this->balance($first), 'the first member is credited');

        $refused = $this->credit($partner, $this->payload($second, 'f407-total-2', 24.0));

        $this->assertSame('rejected', $refused['status'] ?? null, 'a second member does not get a fresh budget');
        $this->assertSame(0.0, $this->balance($second), 'the second member was not credited');
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private function controller(): \App\Http\Controllers\Api\FederationExternalWebhookController
    {
        return app(\App\Http\Controllers\Api\FederationExternalWebhookController::class);
    }

    /** @return array<string,mixed> */
    private function payload(User $member, string $externalTxId, float $amount): array
    {
        return [
            'external_transaction_id' => $externalTxId,
            'amount' => $amount,
            'recipient_id' => (int) $member->id,
            'sender_id' => 'remote-sender',
            'sender_name' => 'F407 remote sender',
            'reason' => 'F407 synthetic inbound credit',
            'description' => 'F407 synthetic inbound credit',
        ];
    }

    /**
     * Drive one inbound credit.
     *
     * The handler commits the money and THEN dispatches the notification email
     * (finding J-2 / F-408, a separate defect). In this container there is no
     * reachable SMTP host, so the delivery half returns false and the handler
     * throws AFTER the commit. A refusal returns before delivery is reached and
     * so is returned normally, which is what these assertions read.
     *
     * @param array<string,mixed> $payload
     * @return array<string,mixed>
     */
    private function credit(object $partner, array $payload, string $event = 'transaction.requested'): array
    {
        try {
            return $this->controller()->processTrustedEvent($event, $payload, $partner);
        } catch (\RuntimeException $e) {
            $this->assertSame(
                'Email dispatch returned false',
                $e->getMessage(),
                'the only expected post-commit throw in this environment is the delivery one'
            );

            return ['status' => 'committed_then_threw'];
        }
    }

    private function balance(User $user): float
    {
        return (float) DB::table('users')
            ->where('id', (int) $user->id)
            ->where('tenant_id', $this->testTenantId)
            ->value('balance');
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function creditAgreement(?float $maxMonthlyCredits): void
    {
        DB::table('federation_credit_agreements')->insert([
            'from_tenant_id' => 0,
            'to_tenant_id' => $this->testTenantId,
            'exchange_rate' => 1.0,
            'status' => 'active',
            'max_monthly_credits' => $maxMonthlyCredits,
            'created_at' => now(),
        ]);
    }

    private function enableFederation(): void
    {
        DB::statement(
            "INSERT INTO federation_system_control (id, federation_enabled, whitelist_mode_enabled, emergency_lockdown_active, max_federation_level, created_at)
             VALUES (1, 1, 0, 0, 4, NOW())
             ON DUPLICATE KEY UPDATE federation_enabled = 1, whitelist_mode_enabled = 0, emergency_lockdown_active = 0"
        );

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
    private function partner(string $tag, array $flags): object
    {
        $id = (int) DB::table('federation_external_partners')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'name' => 'F407 partner ' . $tag,
            'base_url' => 'https://f407-' . $tag . '.example.org',
            'api_path' => '/api/v1',
            'protocol_type' => 'nexus',
            'auth_method' => 'api_key',
            'api_key' => 'f407-fixture-key-' . $tag,
            'signing_secret' => 'f407-fixture-secret-' . $tag,
            'status' => 'active',
            'created_at' => now(),
        ], $flags));

        return DB::table('federation_external_partners')->where('id', $id)->first();
    }

    private function member(): User
    {
        // A routable synthetic domain: EmailDispatchService::isUnroutableRecipient()
        // refuses .test/.local/.example outright, which would make the delivery
        // half fail for a reason unrelated to this finding.
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
            'balance' => 0,
            'email' => 'f407-' . bin2hex(random_bytes(6)) . '@f407-fixture.org',
        ]);

        // F-484 — inbound external credit now requires the member's own recorded
        // federation consent. This file is about the ceiling, not consent, so the
        // fixture records the consenting case.
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1,
                'transactions_enabled_federated' => 1,
                'updated_at' => now(),
            ]
        );

        return $user;
    }
}
