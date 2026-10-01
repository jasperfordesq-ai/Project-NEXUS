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
use App\Services\ReviewService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-406 — an inbound federated review must describe a real exchange with the
 * member being reviewed, and one exchange earns one review.
 *
 * The LOCAL review path (`ReviewService::create`) carries an explicit,
 * commented anti-review-bombing control set: a review attached to a transaction
 * must be BETWEEN the two parties of that transaction ("fabricating reviews for
 * exchanges they never took part in, and bypassing the 24h no-transaction
 * throttle below by cycling through transaction ids (review-bombing)"), one
 * review per exchange, and one review per (reviewer, receiver) per 24 hours
 * when there is no exchange at all.
 *
 * The INBOUND path (`FederationExternalWebhookController::handleInboundReview`)
 * had none of that. `external_transaction_id` was optional and nothing was
 * refused when it was absent or when it pointed at somebody else's exchange,
 * and the only duplicate check was on `external_id` — a string the sending
 * partner chooses, so varying it defeated it. Every row is written
 * `status = 'approved'`, `review_type = 'federated'`, `show_cross_tenant = 1`,
 * and `ReviewService::getForUser()` counts federated rows in `average_rating`
 * and `total` and renders the partner's `comment`.
 *
 * The inbound path cannot key a throttle on the reviewer: the remote reviewer
 * is not a local `users` row and every reviewer field in the payload is chosen
 * by the sender. The authenticated partner is the only identity it cannot
 * forge, so the exchange requirement and the daily cap are both keyed on that.
 *
 * Observation point, stated honestly: these tests drive the handler through the
 * public entry point `processTrustedEvent()`, which runs the same
 * `handleEvent()` the HTTP route runs, so the platform kill switch, the tenant
 * federation switch, the tenant `federation` feature and the partner's
 * `allow_member_sync` flag all apply. They do NOT exercise the HMAC / Bearer
 * authentication or the nonce replay store in `receive()`; the finding is about
 * what an authenticated, active partner can do once through.
 */
final class F406InboundFederatedReviewRequiresExchangeTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * CORRECT BEHAVIOUR — a partner with no recorded exchange with a member
     * cannot review that member at all, however many times it tries with fresh
     * identifiers.
     */
    public function test_partner_cannot_review_a_member_it_has_no_recorded_exchange_with(): void
    {
        $this->enableFederation();
        $partner = $this->partner('no-exchange', ['allow_member_sync' => 1]);
        $victim = $this->member();

        $this->assertSame(
            0,
            (int) DB::table('federation_transactions')
                ->where('receiver_user_id', (int) $victim->id)
                ->where('external_partner_id', (int) $partner->id)
                ->count(),
            'precondition: no exchange of any kind between this member and this partner'
        );

        for ($i = 1; $i <= 5; $i++) {
            $result = $this->review($partner, [
                'external_id' => 'f406-bomb-' . $i,
                'rating' => 1,
                'receiver_id' => (int) $victim->id,
                'comment' => 'F406 attacker-supplied review text #' . $i,
            ]);

            $this->assertSame('rejected', $result['status'] ?? null, "review #{$i} is refused");
        }

        $this->assertSame(0, $this->reviewCount((int) $victim->id), 'no review row was written');

        $stats = app(ReviewService::class)->getForUser((int) $victim->id);
        $this->assertSame(0, (int) $stats['total'], 'the member\'s public review count is untouched');
    }

    /**
     * CORRECT BEHAVIOUR — a review that names a real exchange with this member,
     * recorded by this partner, is accepted. The fix is not "stop accepting
     * federated reviews".
     */
    public function test_a_review_for_a_real_exchange_with_this_member_is_accepted(): void
    {
        $this->enableFederation();
        $partner = $this->partner('lawful', ['allow_member_sync' => 1]);
        $member = $this->member();
        $txId = $this->exchange($partner, $member, 'f406-lawful-tx-1');

        $result = $this->review($partner, [
            'external_id' => 'f406-lawful-1',
            'external_transaction_id' => 'f406-lawful-tx-1',
            'rating' => 5,
            'receiver_id' => (int) $member->id,
            'comment' => 'F406 genuine federated review',
        ]);

        $this->assertSame('handled', $result['status'] ?? null, 'a review for a real exchange is accepted');
        $this->assertSame(1, $this->reviewCount((int) $member->id), 'exactly one review exists');
        $this->assertSame(
            $txId,
            (int) DB::table('reviews')
                ->where('id', (int) $result['local_id'])
                ->value('federation_transaction_id'),
            'the review is bound to the exchange it describes, so one exchange can only earn one review'
        );
    }

    /**
     * CORRECT BEHAVIOUR — one exchange earns one review. A second review for the
     * same exchange under a fresh partner-chosen `external_id` is refused, which
     * is the inbound analogue of the local `uq_reviews_reviewer_transaction`
     * rule.
     */
    public function test_one_exchange_earns_only_one_review(): void
    {
        $this->enableFederation();
        $partner = $this->partner('one-per-exchange', ['allow_member_sync' => 1]);
        $member = $this->member();
        $this->exchange($partner, $member, 'f406-single-tx-1');

        $first = $this->review($partner, [
            'external_id' => 'f406-single-1',
            'external_transaction_id' => 'f406-single-tx-1',
            'rating' => 5,
            'receiver_id' => (int) $member->id,
            'comment' => 'F406 first review of this exchange',
        ]);
        $this->assertSame('handled', $first['status'] ?? null, 'the first review of the exchange is accepted');

        $second = $this->review($partner, [
            'external_id' => 'f406-single-2-fresh-id',
            'external_transaction_id' => 'f406-single-tx-1',
            'rating' => 1,
            'receiver_id' => (int) $member->id,
            'comment' => 'F406 second review of the same exchange',
        ]);

        $this->assertContains(
            $second['status'] ?? null,
            ['duplicate', 'rejected'],
            'a second review of the same exchange is refused even under a fresh external_id'
        );
        $this->assertSame(1, $this->reviewCount((int) $member->id), 'exactly one review exists');
    }

    /**
     * CORRECT BEHAVIOUR — a review may not be attached to somebody else's
     * exchange. This is the inbound analogue of the local "between the two
     * parties" rule, whose own comment names review-bombing by cycling
     * transaction ids.
     */
    public function test_a_review_cannot_borrow_another_members_exchange(): void
    {
        $this->enableFederation();
        $partner = $this->partner('borrowed', ['allow_member_sync' => 1]);
        $victim = $this->member();
        $other = $this->member();
        $this->exchange($partner, $other, 'f406-borrowed-tx-1');

        $result = $this->review($partner, [
            'external_id' => 'f406-borrowed-1',
            'external_transaction_id' => 'f406-borrowed-tx-1',
            'rating' => 1,
            'receiver_id' => (int) $victim->id,
            'comment' => 'F406 review attached to an exchange the victim was not part of',
        ]);

        $this->assertSame('rejected', $result['status'] ?? null, 'an exchange belonging to another member is refused');
        $this->assertSame(0, $this->reviewCount((int) $victim->id), 'nothing was written for the victim');
    }

    /**
     * CORRECT BEHAVIOUR — a partner cannot borrow another partner's exchange
     * with the same member.
     */
    public function test_a_review_cannot_borrow_another_partners_exchange(): void
    {
        $this->enableFederation();
        $recorder = $this->partner('recorder', ['allow_member_sync' => 1, 'allow_transactions' => 1]);
        $attacker = $this->partner('attacker', ['allow_member_sync' => 1]);
        $member = $this->member();
        $this->exchange($recorder, $member, 'f406-cross-partner-tx-1');

        $result = $this->review($attacker, [
            'external_id' => 'f406-cross-partner-1',
            'external_transaction_id' => 'f406-cross-partner-tx-1',
            'rating' => 1,
            'receiver_id' => (int) $member->id,
            'comment' => 'F406 review naming another partner\'s exchange',
        ]);

        $this->assertSame('rejected', $result['status'] ?? null, 'another partner\'s exchange is refused');
        $this->assertSame(0, $this->reviewCount((int) $member->id), 'nothing was written');
    }

    /**
     * CORRECT BEHAVIOUR — a daily cap per (partner, member) bounds the rate even
     * when the partner does record real exchanges. Inbound credit is cheap in
     * count terms (0.01 hours is a valid transfer), so the exchange requirement
     * alone would still allow thousands of reviews inside the credit ceiling.
     */
    public function test_a_partner_is_capped_per_member_per_day(): void
    {
        $this->enableFederation();
        $partner = $this->partner('daily-cap', ['allow_member_sync' => 1]);
        $member = $this->member();

        $accepted = 0;
        for ($i = 1; $i <= 8; $i++) {
            $this->exchange($partner, $member, 'f406-cap-tx-' . $i);
            $result = $this->review($partner, [
                'external_id' => 'f406-cap-' . $i,
                'external_transaction_id' => 'f406-cap-tx-' . $i,
                'rating' => 1,
                'receiver_id' => (int) $member->id,
                'comment' => 'F406 review #' . $i,
            ]);
            if (($result['status'] ?? null) === 'handled') {
                $accepted++;
            }
        }

        $this->assertLessThan(
            8,
            $accepted,
            'the daily cap refuses a partner that reviews one member over and over in a day'
        );
        $this->assertSame(
            $accepted,
            $this->reviewCount((int) $member->id),
            'only the accepted reviews were written'
        );
    }

    /**
     * CONTROL — the rightful local path is unchanged: a genuine local review is
     * still accepted and the platform's own 24-hour throttle still refuses the
     * second.
     */
    public function test_control_the_local_review_path_is_unchanged(): void
    {
        $this->enableFederation();
        $victim = $this->member();
        $reviewer = $this->member();
        $service = app(ReviewService::class);

        $first = $service->create((int) $reviewer->id, [
            'receiver_id' => (int) $victim->id,
            'rating' => 5,
            'comment' => 'F406 legitimate local review',
        ]);
        $this->assertNotEmpty($first['id'] ?? null, 'control: a genuine local review is still accepted');
        $this->assertSame(1, $this->reviewCount((int) $victim->id));

        $refused = false;
        try {
            $service->create((int) $reviewer->id, [
                'receiver_id' => (int) $victim->id,
                'rating' => 1,
                'comment' => 'F406 second local review same day',
            ]);
        } catch (\RuntimeException) {
            $refused = true;
        }

        $this->assertTrue($refused, 'control: the local path still refuses a second review within 24 hours');
        $this->assertSame(1, $this->reviewCount((int) $victim->id), 'control: exactly one review exists');
    }

    /**
     * NEGATIVE CONTROL — the observable can distinguish. With the partner's
     * `allow_member_sync` permission off, the permission gate refuses first and
     * nothing is written.
     */
    public function test_negative_control_partner_without_member_sync_writes_nothing(): void
    {
        $this->enableFederation();
        $partner = $this->partner('no-permission', ['allow_member_sync' => 0]);
        $member = $this->member();
        $this->exchange($partner, $member, 'f406-nopermission-tx-1');

        $result = $this->review($partner, [
            'external_id' => 'f406-nopermission-1',
            'external_transaction_id' => 'f406-nopermission-tx-1',
            'rating' => 1,
            'receiver_id' => (int) $member->id,
            'comment' => 'F406 should never be stored',
        ]);

        $this->assertSame('rejected', $result['status'] ?? null, 'negative control: the permission gate refuses');
        $this->assertSame(0, $this->reviewCount((int) $member->id), 'negative control: nothing written');
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private function controller(): \App\Http\Controllers\Api\FederationExternalWebhookController
    {
        return app(\App\Http\Controllers\Api\FederationExternalWebhookController::class);
    }

    /**
     * @param array<string,mixed> $payload
     * @return array<string,mixed>
     */
    private function review(object $partner, array $payload): array
    {
        return $this->controller()->processTrustedEvent('review.created', $payload, $partner);
    }

    private function reviewCount(int $receiverId): int
    {
        return (int) DB::table('reviews')
            ->where('receiver_id', $receiverId)
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('status', ['approved', 'active'])
            ->count();
    }

    /**
     * Record a completed federated exchange between this partner and this
     * member, the way handleTransactionCompleted() writes one.
     */
    private function exchange(object $partner, User $member, string $externalTxId): int
    {
        return (int) DB::table('federation_transactions')->insertGetId([
            'sender_tenant_id' => 0,
            'sender_user_id' => 0,
            'receiver_tenant_id' => $this->testTenantId,
            'receiver_user_id' => (int) $member->id,
            'amount' => 1.0,
            'description' => 'F406 fixture exchange',
            'status' => 'completed',
            'completed_at' => now(),
            'external_partner_id' => (int) $partner->id,
            'external_receiver_name' => 'F406 remote sender',
            'external_transaction_id' => $externalTxId,
            'created_at' => now(),
        ]);
    }

    // ── fixtures ────────────────────────────────────────────────────────────

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
            'name' => 'F406 partner ' . $tag,
            'base_url' => 'https://f406-' . $tag . '.example.org',
            'api_path' => '/api/v1',
            'protocol_type' => 'nexus',
            'auth_method' => 'api_key',
            'api_key' => 'f406-fixture-key-' . $tag,
            'signing_secret' => 'f406-fixture-secret-' . $tag,
            'status' => 'active',
            'created_at' => now(),
        ], $flags));

        return DB::table('federation_external_partners')->where('id', $id)->first();
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
        ]);

        // F-406 (second half) — an inbound federated review now requires the
        // member's own recorded consent, the pair the v1 partner API already
        // required. This file is about the exchange requirement, not consent, so
        // the fixture records the consenting case.
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1,
                'show_reviews_federated' => 1,
                'updated_at' => now(),
            ]
        );

        return $user;
    }
}
