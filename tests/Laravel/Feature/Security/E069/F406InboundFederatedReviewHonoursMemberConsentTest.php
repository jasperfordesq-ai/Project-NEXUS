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
 * F-406 (outstanding half) — an inbound federated review must honour the
 * member's own recorded decision about federated reviews.
 *
 * The local review path refuses a review between two members where either has
 * blocked the other (`BlockUserService::assertNoBlockBetween`). That control
 * cannot be carried across to this path: a block is between two local `users`
 * rows, the remote reviewer has none, and every reviewer field in the payload
 * is chosen by the sender — `reviews.reviewer_id` is written NULL. So "block
 * this reviewer" is not expressible here, and a check keyed on a sender-chosen
 * identifier would look like protection without being any.
 *
 * What the member CAN express, and what the platform already records, is
 * whether they accept federated reviews at all:
 * `federation_user_settings.federation_optin` and `show_reviews_federated`. The
 * v1 partner API has always enforced exactly that pair before writing an
 * inbound federated review — `FederationController::createReview()` answers
 * `REVIEWS_DISABLED`, "Reviewee does not accept federated reviews". The webhook
 * route never read either flag, so a member who had never opted into federation
 * still had partner-written, publicly counted reviews placed on their profile.
 *
 * 🔴 Still NOT expressible, and recorded as such rather than faked: a member
 * cannot refuse ONE remote reviewer while accepting others, because the
 * platform holds no trustworthy identity for a remote person. Today the levers
 * are all-or-nothing for the member, and partner-level suspension for the
 * operator.
 *
 * Observation point, stated honestly: these tests drive the handler through
 * `processTrustedEvent()`, as the sibling F-406 file does. They do NOT exercise
 * the HMAC / Bearer authentication or the nonce replay store in `receive()`.
 */
final class F406InboundFederatedReviewHonoursMemberConsentTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * CORRECT BEHAVIOUR — a member who never opted into federation does not
     * receive federated reviews, even for a genuine recorded exchange.
     */
    public function test_a_member_who_never_opted_into_federation_is_not_reviewed(): void
    {
        $this->enableFederation();
        $partner = $this->partner('no-optin', ['allow_member_sync' => 1]);
        $member = $this->member(optin: 0, showReviews: 1);
        $this->exchange($partner, $member, 'f406c-no-optin-tx');

        $result = $this->review($partner, [
            'external_id' => 'f406c-no-optin-1',
            'external_transaction_id' => 'f406c-no-optin-tx',
            'rating' => 1,
            'receiver_id' => (int) $member->id,
            'comment' => 'F406 partner-written review text',
        ]);

        $this->assertSame('rejected', $result['status'] ?? null, 'the review is refused');
        $this->assertSame(0, $this->reviewCount((int) $member->id), 'no review row was written');
        $this->assertSame(
            0,
            (int) app(ReviewService::class)->getForUser((int) $member->id)['total'],
            'the member\'s public review count is untouched'
        );
    }

    /**
     * CORRECT BEHAVIOUR — a member who is federated but switched federated
     * reviews off is not reviewed either. Both flags are consulted, exactly as
     * the v1 partner API consults them.
     */
    public function test_a_member_who_switched_federated_reviews_off_is_not_reviewed(): void
    {
        $this->enableFederation();
        $partner = $this->partner('reviews-off', ['allow_member_sync' => 1]);
        $member = $this->member(optin: 1, showReviews: 0);
        $this->exchange($partner, $member, 'f406c-reviews-off-tx');

        $result = $this->review($partner, [
            'external_id' => 'f406c-reviews-off-1',
            'external_transaction_id' => 'f406c-reviews-off-tx',
            'rating' => 1,
            'receiver_id' => (int) $member->id,
            'comment' => 'F406 partner-written review text',
        ]);

        $this->assertSame('rejected', $result['status'] ?? null, 'the review is refused');
        $this->assertSame(0, $this->reviewCount((int) $member->id), 'no review row was written');
    }

    /**
     * CORRECT BEHAVIOUR — a member with no `federation_user_settings` row at all
     * has recorded no consent, and the absence must not read as permission.
     */
    public function test_a_member_with_no_recorded_federation_settings_is_not_reviewed(): void
    {
        $this->enableFederation();
        $partner = $this->partner('no-row', ['allow_member_sync' => 1]);
        $member = $this->member(optin: 1, showReviews: 1);
        DB::table('federation_user_settings')->where('user_id', (int) $member->id)->delete();
        $this->exchange($partner, $member, 'f406c-no-row-tx');

        $result = $this->review($partner, [
            'external_id' => 'f406c-no-row-1',
            'external_transaction_id' => 'f406c-no-row-tx',
            'rating' => 1,
            'receiver_id' => (int) $member->id,
            'comment' => 'F406 partner-written review text',
        ]);

        $this->assertSame('rejected', $result['status'] ?? null, 'the review is refused');
        $this->assertSame(0, $this->reviewCount((int) $member->id), 'no review row was written');
    }

    /**
     * CONTROL — legitimate access. A member who opted into federation and left
     * federated reviews on is still reviewed for a genuine recorded exchange.
     * The refused cases differ from this one only in the member's own setting.
     */
    public function test_control_a_consenting_member_is_still_reviewed_for_a_real_exchange(): void
    {
        $this->enableFederation();
        $partner = $this->partner('consenting', ['allow_member_sync' => 1]);
        $member = $this->member(optin: 1, showReviews: 1);
        $this->exchange($partner, $member, 'f406c-consenting-tx');

        $result = $this->review($partner, [
            'external_id' => 'f406c-consenting-1',
            'external_transaction_id' => 'f406c-consenting-tx',
            'rating' => 5,
            'receiver_id' => (int) $member->id,
            'comment' => 'F406 genuine federated review',
        ]);

        $this->assertSame('handled', $result['status'] ?? null, 'control: a consenting member is reviewed');
        $this->assertSame(1, $this->reviewCount((int) $member->id), 'control: exactly one review exists');
    }

    /**
     * CONTROL — the exchange requirement already in place is unaffected. A
     * consenting member with no recorded exchange is still refused, so the new
     * check is an addition rather than a replacement.
     */
    public function test_control_a_consenting_member_with_no_exchange_is_still_refused(): void
    {
        $this->enableFederation();
        $partner = $this->partner('no-exchange', ['allow_member_sync' => 1]);
        $member = $this->member(optin: 1, showReviews: 1);

        $result = $this->review($partner, [
            'external_id' => 'f406c-no-exchange-1',
            'rating' => 1,
            'receiver_id' => (int) $member->id,
            'comment' => 'F406 partner-written review text',
        ]);

        $this->assertSame('rejected', $result['status'] ?? null, 'control: no exchange is still refused');
        $this->assertSame(0, $this->reviewCount((int) $member->id), 'control: no review row was written');
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

    private function exchange(object $partner, User $member, string $externalTxId): int
    {
        return (int) DB::table('federation_transactions')->insertGetId([
            'sender_tenant_id' => 0,
            'sender_user_id' => 0,
            'receiver_tenant_id' => $this->testTenantId,
            'receiver_user_id' => (int) $member->id,
            'amount' => 1.0,
            'description' => 'F406 consent fixture exchange',
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
            'name' => 'F406c partner ' . $tag,
            'base_url' => 'https://f406c-' . $tag . '.example.org',
            'api_path' => '/api/v1',
            'protocol_type' => 'nexus',
            'auth_method' => 'api_key',
            'api_key' => 'f406c-fixture-key-' . $tag,
            'signing_secret' => 'f406c-fixture-secret-' . $tag,
            'status' => 'active',
            'created_at' => now(),
        ], $flags));

        return DB::table('federation_external_partners')->where('id', $id)->first();
    }

    private function member(int $optin, int $showReviews): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
        ]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => $optin,
                'show_reviews_federated' => $showReviews,
                'updated_at' => now(),
            ]
        );

        return $user;
    }
}
