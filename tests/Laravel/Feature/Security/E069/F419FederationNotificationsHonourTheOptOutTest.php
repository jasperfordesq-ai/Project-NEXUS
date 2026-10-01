<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Core\TenantContext;
use App\Events\FederatedConnectionReceived;
use App\Events\FederatedReviewReceived;
use App\Listeners\HandleFederatedConnectionReceived;
use App\Listeners\HandleFederatedReviewReceived;
use App\Models\User;
use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-419 (E-069 slice G, G-2) — a member who withdrew federation consent must
 * not be bell- or push-notified by an external partner.
 *
 * `FederationUserService::optOut()` writes
 * `federation_user_settings.email_notifications = 0` along with eight other
 * flags. It does NOT touch `users.federation_notifications_enabled`, which
 * defaults to 1.
 *
 * `FederationEmailService::getUserWithEmail()` (`:784-796`) — the EMAIL half —
 * reads BOTH flags and correctly refuses:
 *
 *     COALESCE(u.federation_notifications_enabled, 1) = 1
 *     AND COALESCE(fus.email_notifications, 1) = 1
 *
 * `HandleFederatedConnectionReceived` (`:71-78`), in the same flow, read only
 * `users.federation_notifications_enabled` and then wrote a `notifications` row
 * and fired a phone push. `HandleFederatedReviewReceived` (`:82-92`) had the
 * identical single-flag test. Third instance of the F-352 pattern.
 *
 * The fix reuses `getUserWithEmail()`'s own predicate in both listeners.
 *
 * These tests assert the CORRECT behaviour and fail before the fix.
 *
 * NOT COVERED HERE, reported instead: the upstream write
 * (`FederationExternalWebhookController::handleInboundConnection`) has no
 * consent gate either. That file was being edited by another agent during this
 * engagement and was deliberately not touched.
 */
final class F419FederationNotificationsHonourTheOptOutTest extends TestCase
{
    use DatabaseTransactions;

    /** federation_external_partners has UNIQUE (tenant_id, base_url). */
    private static int $urlSeq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableTenantFederation();
    }

    // ── inbound connection ──────────────────────────────────────────────────

    /** The member opted out — no bell, no push. */
    public function test_opted_out_member_is_not_notified_of_an_inbound_partner_connection(): void
    {
        $partnerId = $this->partner('f419-conn-opted-out');
        $member = $this->member();
        $this->optOutOfFederation((int) $member->id);

        // The platform's own federation-contact rule says: do not contact.
        self::assertSame(
            0,
            $this->platformFederationContactEligibility((int) $member->id),
            'precondition: the platform\'s own rule excludes this member from federation contact'
        );

        $this->runConnectionListener($partnerId, (int) $member->id);

        self::assertSame(
            0,
            $this->notificationCount((int) $member->id, 'federation_connection'),
            'a member who withdrew federation consent must not be bell- or push-notified'
        );
    }

    /** CONTROL — the rightful case. An opted-in member is still notified. */
    public function test_control_opted_in_member_is_still_notified_of_a_connection(): void
    {
        $partnerId = $this->partner('f419-conn-opted-in');
        $member = $this->member();
        $this->optInToFederation((int) $member->id);

        self::assertSame(
            1,
            $this->platformFederationContactEligibility((int) $member->id),
            'control: the platform\'s own rule allows federation contact for this member'
        );

        $this->runConnectionListener($partnerId, (int) $member->id);

        self::assertSame(
            1,
            $this->notificationCount((int) $member->id, 'federation_connection'),
            'control: legitimate federation notification still works — the fix must not be "stop notifying"'
        );
    }

    /** NEGATIVE CONTROL — the flag the listener always read still suppresses it. */
    public function test_negative_control_the_original_flag_still_suppresses_a_connection(): void
    {
        $partnerId = $this->partner('f419-conn-flag-off');
        $member = $this->member();
        $this->optInToFederation((int) $member->id);
        DB::table('users')->where('id', $member->id)->update(['federation_notifications_enabled' => 0]);

        $this->runConnectionListener($partnerId, (int) $member->id);

        self::assertSame(
            0,
            $this->notificationCount((int) $member->id, 'federation_connection'),
            'negative control: no notification when users.federation_notifications_enabled = 0'
        );
    }

    // ── inbound review (the sibling path, same defect) ───────────────────────

    /** The member opted out — an inbound partner review must not notify them. */
    public function test_opted_out_member_is_not_notified_of_an_inbound_partner_review(): void
    {
        $partnerId = $this->partner('f419-review-opted-out');
        $member = $this->member();
        $this->optOutOfFederation((int) $member->id);

        $this->runReviewListener($partnerId, (int) $member->id);

        self::assertSame(
            0,
            $this->notificationCount((int) $member->id, 'federation_review'),
            'a member who withdrew federation consent must not be notified of a partner review'
        );
    }

    /** CONTROL — the rightful case. An opted-in member is still notified. */
    public function test_control_opted_in_member_is_still_notified_of_a_review(): void
    {
        $partnerId = $this->partner('f419-review-opted-in');
        $member = $this->member();
        $this->optInToFederation((int) $member->id);

        $this->runReviewListener($partnerId, (int) $member->id);

        self::assertSame(
            1,
            $this->notificationCount((int) $member->id, 'federation_review'),
            'control: legitimate federated review notification still works'
        );
    }

    // ── harness ─────────────────────────────────────────────────────────────

    private function runConnectionListener(int $partnerId, int $localUserId): void
    {
        $rowId = (int) DB::table('federation_inbound_connections')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'external_partner_id' => $partnerId,
            'local_user_id' => $localUserId,
            'external_user_id' => 'f419-remote-' . $localUserId,
            'status' => 'pending',
            'message' => 'E076 F-419 fixture',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $shadowRow = [
            'id' => $rowId,
            'tenant_id' => $this->testTenantId,
            'external_partner_id' => $partnerId,
            'local_user_id' => $localUserId,
            'external_user_id' => 'f419-remote-' . $localUserId,
            'external_user_name' => 'E076 F-419 Remote Member',
            'status' => 'pending',
        ];

        $previous = TenantContext::currentId();
        try {
            (new HandleFederatedConnectionReceived())->handle(
                new FederatedConnectionReceived($this->testTenantId, $partnerId, $rowId, $shadowRow)
            );
        } finally {
            TenantContext::restoreAfterScopedListener($previous);
        }
    }

    private function runReviewListener(int $partnerId, int $receiverId): void
    {
        $reviewerStub = User::factory()->forTenant(999)->create();

        $reviewId = (int) DB::table('reviews')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'external_partner_id' => $partnerId,
            'external_id' => 'f419-ext-review-' . $receiverId,
            'reviewer_id' => $reviewerStub->id,
            'reviewer_tenant_id' => 999,
            'receiver_id' => $receiverId,
            'receiver_tenant_id' => $this->testTenantId,
            'rating' => 4,
            'comment' => 'E076 F-419 fixture review',
            'status' => 'approved',
            'review_type' => 'federated',
            'show_cross_tenant' => 1,
            'created_at' => now(),
        ]);

        $previous = TenantContext::currentId();
        try {
            (new HandleFederatedReviewReceived())->handle(
                new FederatedReviewReceived($this->testTenantId, $partnerId, $reviewId, [
                    'receiver_id' => $receiverId,
                    'rating' => 4,
                    'comment' => 'E076 F-419 fixture review',
                ])
            );
        } finally {
            TenantContext::restoreAfterScopedListener($previous);
        }
    }

    private function notificationCount(int $userId, string $type): int
    {
        return (int) DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $userId)
            ->where('type', $type)
            ->count();
    }

    /**
     * The platform's own definition of "this member may be contacted about
     * federation", copied in shape from FederationEmailService::getUserWithEmail().
     */
    private function platformFederationContactEligibility(int $userId): int
    {
        return (int) DB::table('users as u')
            ->leftJoin('federation_user_settings as fus', 'fus.user_id', '=', 'u.id')
            ->where('u.id', $userId)
            ->where('u.tenant_id', $this->testTenantId)
            ->whereRaw('COALESCE(u.federation_notifications_enabled, 1) = 1')
            ->whereRaw('COALESCE(fus.email_notifications, 1) = 1')
            ->count();
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

    private function partner(string $tag): int
    {
        return (int) DB::table('federation_external_partners')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'E076 F-419 partner ' . $tag,
            'base_url' => 'https://93.184.216.' . (1 + (self::$urlSeq++ % 254)),
            'api_path' => '/api/v1',
            'protocol_type' => 'nexus',
            'auth_method' => 'api_key',
            'api_key' => 'f419-fixture-key-' . $tag,
            'status' => 'active',
            'allow_connections' => 1,
            'created_at' => now(),
        ]);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
        ]);
    }

    /** Exactly the flag set FederationUserService::optOut() writes. */
    private function optOutOfFederation(int $userId): void
    {
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $userId],
            [
                'federation_optin' => 0,
                'profile_visible_federated' => 0,
                'messaging_enabled_federated' => 0,
                'transactions_enabled_federated' => 0,
                'appear_in_federated_search' => 0,
                'show_skills_federated' => 0,
                'show_location_federated' => 0,
                'show_reviews_federated' => 0,
                'email_notifications' => 0,
                'updated_at' => now(),
            ]
        );
    }

    private function optInToFederation(int $userId): void
    {
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $userId],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'appear_in_federated_search' => 1,
                'email_notifications' => 1,
                'updated_at' => now(),
            ]
        );
    }
}
