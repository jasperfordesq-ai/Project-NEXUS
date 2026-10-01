<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-484 — the external partner webhook must consult the receiving member's own
 * recorded federation choices before crediting their wallet.
 *
 * `federation_user_settings.federation_optin` and
 * `federation_user_settings.transactions_enabled_federated` are the member's
 * two recorded decisions about federation. Every other inbound protocol reads
 * them before moving money — Komunitin
 * (`FederationKomunitinController::localAccountCanTransact()`), Credit Commons
 * (`FederationCreditCommonsController::payerMayBeDebited()`), the v1 partner
 * API (`FederationController::createTransaction()`, TRANSACTIONS_DISABLED) and
 * the v2 member path. The external webhook looked the receiver up on
 * `id`, `tenant_id`, `status = 'active'` only, so time credits from an outside
 * organisation landed in the wallet of a member who had refused federation.
 *
 * Both money-moving arms are covered: `transaction.requested` and
 * `transaction.completed`.
 *
 * Observation point, stated honestly: these tests drive the handlers through
 * `processTrustedEvent()`, the same entry point F-407's and F-428's regression
 * tests use. It runs the same `handleEvent()` the HTTP route runs, so the
 * platform kill switch, the tenant federation switch, the tenant `federation`
 * feature and the partner's `allow_transactions` flag all apply. They do NOT
 * exercise the HMAC / Bearer authentication or the nonce replay store in
 * `receive()`.
 */
final class F484ExternalWebhookHonoursFederationConsentTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * CORRECT BEHAVIOUR — a member who never opted into federation is not
     * credited by an outside organisation.
     */
    public function test_a_member_who_never_opted_into_federation_is_not_credited(): void
    {
        $this->enableFederation();
        $partner = $this->partner('no-optin', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->consent($member, optin: 0, transactions: 0);
        $this->creditAgreement(100.0);

        $this->assertSame(0.0, $this->balance($member), 'precondition: the member starts at zero');

        $result = $this->credit($partner, $this->payload($member, 'f484-no-optin-1', 7.0));

        $this->assertSame('rejected', $result['status'] ?? null, 'the credit is refused');
        $this->assertSame(0.0, $this->balance($member), 'nothing was credited to a member who refused federation');
        $this->assertSame(0, $this->ledgerRows($member, $partner), 'no ledger row was written');
    }

    /**
     * CORRECT BEHAVIOUR — a member who is federated but switched federated
     * transactions off is not credited either. Both flags are consulted.
     */
    public function test_a_member_who_switched_federated_transactions_off_is_not_credited(): void
    {
        $this->enableFederation();
        $partner = $this->partner('no-transactions', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->consent($member, optin: 1, transactions: 0);
        $this->creditAgreement(100.0);

        $result = $this->credit($partner, $this->payload($member, 'f484-no-transactions-1', 5.0));

        $this->assertSame('rejected', $result['status'] ?? null, 'the credit is refused');
        $this->assertSame(0.0, $this->balance($member), 'the transactions switch is honoured on its own');
        $this->assertSame(0, $this->ledgerRows($member, $partner), 'no ledger row was written');
    }

    /**
     * CORRECT BEHAVIOUR — a member with no `federation_user_settings` row at all
     * has recorded no consent. The platform's own default for every flag in that
     * table is 0, so the absence of the row must not read as permission.
     */
    public function test_a_member_with_no_recorded_federation_settings_is_not_credited(): void
    {
        $this->enableFederation();
        $partner = $this->partner('no-row', ['allow_transactions' => 1]);
        $member = $this->member();
        DB::table('federation_user_settings')->where('user_id', (int) $member->id)->delete();
        $this->creditAgreement(100.0);

        $this->assertSame(
            0,
            (int) DB::table('federation_user_settings')->where('user_id', (int) $member->id)->count(),
            'precondition: the member has recorded no federation settings at all'
        );

        $result = $this->credit($partner, $this->payload($member, 'f484-no-row-1', 4.0));

        $this->assertSame('rejected', $result['status'] ?? null, 'the credit is refused');
        $this->assertSame(0.0, $this->balance($member), 'a missing settings row is not consent');
    }

    /**
     * CORRECT BEHAVIOUR — `transaction.completed` credits the same balance and
     * must carry the same consent check.
     */
    public function test_the_transaction_completed_arm_honours_the_same_choice(): void
    {
        $this->enableFederation();
        $partner = $this->partner('completed-arm', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->consent($member, optin: 0, transactions: 0);
        $this->creditAgreement(100.0);

        $result = $this->credit($partner, $this->payload($member, 'f484-completed-1', 3.0), 'transaction.completed');

        $this->assertSame('rejected', $result['status'] ?? null, 'the completed arm refuses too');
        $this->assertSame(0.0, $this->balance($member), 'nothing was credited by the completed arm');
        $this->assertSame(0, $this->ledgerRows($member, $partner), 'no ledger row was written');
    }

    /**
     * CONTROL — legitimate access. A member who DID opt in and DID leave
     * federated transactions on is credited normally, on both arms. The two
     * arms of this file differ only in the member's recorded choice, so the fix
     * cannot be "stop crediting".
     */
    public function test_control_a_consenting_member_is_credited_normally(): void
    {
        $this->enableFederation();
        $partner = $this->partner('consenting', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->consent($member, optin: 1, transactions: 1);
        $this->creditAgreement(100.0);

        $this->credit($partner, $this->payload($member, 'f484-consenting-1', 9.0));
        $this->assertSame(9.0, $this->balance($member), 'control: a consenting member is credited');

        $this->credit($partner, $this->payload($member, 'f484-consenting-2', 2.0), 'transaction.completed');
        $this->assertSame(11.0, $this->balance($member), 'control: the completed arm credits a consenting member too');

        $this->assertSame(2, $this->ledgerRows($member, $partner), 'control: both ledger rows exist');
    }

    /**
     * CONTROL — the refusal machinery in this handler already worked: a
     * suspended account is refused. This pins that the new check is an addition
     * and not a replacement, and that the two refusals are distinguishable.
     */
    public function test_control_the_same_handler_still_refuses_a_suspended_account(): void
    {
        $this->enableFederation();
        $partner = $this->partner('suspended', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->consent($member, optin: 1, transactions: 1);
        DB::table('users')->where('id', (int) $member->id)->update(['status' => 'suspended']);
        $this->creditAgreement(100.0);

        $result = $this->credit($partner, $this->payload($member, 'f484-suspended-1', 6.0));

        $this->assertSame('rejected', $result['status'] ?? null, 'control: a suspended account is still refused');
        $this->assertStringContainsString(
            'not found in this tenant',
            (string) ($result['reason'] ?? ''),
            'control: the suspended refusal is the account-state one, not the consent one'
        );
        $this->assertSame(0.0, $this->balance($member), 'control: nothing was credited');
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
            'sender_name' => 'F484 remote sender',
            'reason' => 'F484 synthetic inbound credit',
            'description' => 'F484 synthetic inbound credit',
        ];
    }

    /**
     * Drive one inbound credit.
     *
     * The handler commits the money and THEN dispatches the notification email
     * (F-422, a separate finding). This container has no reachable SMTP host, so
     * the delivery half returns false and the handler throws AFTER the commit. A
     * refusal returns before delivery is reached and so is returned normally.
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

    private function ledgerRows(User $user, object $partner): int
    {
        return (int) DB::table('federation_transactions')
            ->where('receiver_user_id', (int) $user->id)
            ->where('external_partner_id', (int) $partner->id)
            ->count();
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function consent(User $user, int $optin, int $transactions): void
    {
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => $optin,
                'transactions_enabled_federated' => $transactions,
                'profile_visible_federated' => $optin,
                'appear_in_federated_search' => $optin,
                'updated_at' => now(),
            ]
        );
    }

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
            'name' => 'F484 partner ' . $tag,
            'base_url' => 'https://f484-' . $tag . '.example.org',
            'api_path' => '/api/v1',
            'protocol_type' => 'nexus',
            'auth_method' => 'api_key',
            'api_key' => 'f484-fixture-key-' . $tag,
            'signing_secret' => 'f484-fixture-secret-' . $tag,
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
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
            'balance' => 0,
            'email' => 'f484-' . bin2hex(random_bytes(6)) . '@f484-fixture.org',
        ]);
    }
}
