<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Core\TenantContext;
use App\Events\ListingUpdated;
use App\Listeners\PushListingToFederatedPartners;
use App\Models\Listing;
use App\Models\User;
use App\Services\FederationFeatureService;
use App\Services\FederationUserService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-413 (E-069 slice B, B-1) — the OUTBOUND listing push must honour the
 * listing owner's account-level federation consent.
 *
 * Every PULL path the platform offers a partner requires the owner's consent as
 * well as the listing's own `federated_visibility`:
 *
 *   FederationController.php:501, :507  (partner listing search)
 *   FederationController.php:554, :563  (partner single-listing fetch)
 *   Jobs/FederationInitialSyncJob.php:177-190 (the platform's own count of
 *                                              "listings shared with partners")
 *
 * all require `fus.federation_optin = 1 AND fus.profile_visible_federated = 1
 * AND fus.appear_in_federated_search = 1`.
 *
 * `PushListingToFederatedPartners::handle()` did not: it gated on the tenant
 * feature, the tenant federation switch, listing status / moderation status and
 * `federated_visibility`, and never read `federation_user_settings`. Separately
 * `FederationUserService::optOut()` did not reset `listings.federated_visibility`,
 * so the stale per-listing flag survived the withdrawal and the next edit of an
 * old listing handed title, description, the local `user_id` and `tenant_id` to
 * every active partner.
 *
 * These tests assert the CORRECT behaviour and fail before the fix.
 *
 * OBSERVATION POINT, stated honestly. `Http::fake()` intercepts the request, so
 * no bytes leave the container and no real partner is contacted — the container
 * has no outbound DNS, which is why the partner fixture uses a public-IP
 * literal (OutboundUrlGuard short-circuits on IP literals). What these tests
 * prove is the AUTHORISATION DECISION and the hand-off to the transport: the
 * platform decided this listing was shareable with this partner and assembled
 * and dispatched the request. Real wire transmission is not exercised here.
 */
final class F413ListingPushHonoursOwnerFederationConsentTest extends TestCase
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
        Http::fake(['*' => Http::response(['success' => true], 200)]);
    }

    /** The owner withdrew federation consent — the push must NOT happen. */
    public function test_listing_of_an_opted_out_member_is_not_pushed_to_the_partner(): void
    {
        $this->partner('f413-opted-out');

        $owner = $this->member();
        $this->federationSettings((int) $owner->id, optedIn: false);
        $listing = $this->listing((int) $owner->id, 'listed');

        // The platform's own rule says this listing is NOT shared with partners.
        self::assertSame(
            0,
            $this->platformSharedListingCount((int) $listing->id),
            'precondition: every PULL path excludes this listing because the owner opted out'
        );

        $this->runListener($listing, $owner);

        Http::assertNothingSent();
    }

    /** CONTROL — the rightful case. Owner opted in: the push is correct and must still happen. */
    public function test_control_listing_of_an_opted_in_member_is_still_pushed(): void
    {
        $this->partner('f413-opted-in');

        $owner = $this->member();
        $this->federationSettings((int) $owner->id, optedIn: true);
        $listing = $this->listing((int) $owner->id, 'listed');

        self::assertSame(
            1,
            $this->platformSharedListingCount((int) $listing->id),
            'control: the PULL paths agree this listing IS shared'
        );

        $this->runListener($listing, $owner);

        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => ($request['action'] ?? null) === 'updated'
            && (int) ($request['id'] ?? 0) === (int) $listing->id);
    }

    /**
     * NEGATIVE CONTROL — proves the observable can distinguish. The gate the
     * listener always applied (`federated_visibility`) still stops the push.
     */
    public function test_negative_control_never_shared_listing_is_not_pushed(): void
    {
        $this->partner('f413-unshared');

        $owner = $this->member();
        $this->federationSettings((int) $owner->id, optedIn: true);
        $listing = $this->listing((int) $owner->id, 'none');

        $this->runListener($listing, $owner);

        Http::assertNothingSent();
    }

    /**
     * The second half of the finding: withdrawing consent must also stand the
     * member's listings down, so the stale per-listing flag cannot survive the
     * withdrawal and re-share the listing on a later edit.
     */
    public function test_opting_out_stands_down_the_members_shared_listings(): void
    {
        $owner = $this->member();
        $this->federationSettings((int) $owner->id, optedIn: true);
        $listing = $this->listing((int) $owner->id, 'listed');

        self::assertTrue(FederationUserService::optOut((int) $owner->id), 'opt-out should succeed');

        self::assertSame(
            'none',
            (string) DB::table('listings')->where('id', $listing->id)->value('federated_visibility'),
            'withdrawing federation consent must reset the member\'s per-listing share flag'
        );
    }

    /** CONTROL — opting out must not touch another member's listings. */
    public function test_control_opting_out_leaves_another_members_listing_shared(): void
    {
        $leaver = $this->member();
        $this->federationSettings((int) $leaver->id, optedIn: true);
        $this->listing((int) $leaver->id, 'listed');

        $other = $this->member();
        $this->federationSettings((int) $other->id, optedIn: true);
        $otherListing = $this->listing((int) $other->id, 'listed');

        self::assertTrue(FederationUserService::optOut((int) $leaver->id), 'opt-out should succeed');

        self::assertSame(
            'listed',
            (string) DB::table('listings')->where('id', $otherListing->id)->value('federated_visibility'),
            'control: another member\'s listing is untouched by this member\'s withdrawal'
        );
    }

    // ── harness ─────────────────────────────────────────────────────────────

    private function runListener(Listing $listing, User $owner): void
    {
        $previous = TenantContext::currentId();
        try {
            (new PushListingToFederatedPartners(app(FederationFeatureService::class)))
                ->handle(new ListingUpdated($listing, $owner, $this->testTenantId));
        } finally {
            TenantContext::restoreAfterScopedListener($previous);
        }
    }

    /**
     * The platform's own definition of "this listing is shared with partners",
     * copied in shape from FederationInitialSyncJob::countActiveListings().
     */
    private function platformSharedListingCount(int $listingId): int
    {
        return (int) DB::table('listings as l')
            ->join('users as u', function ($join): void {
                $join->on('u.id', '=', 'l.user_id')->on('u.tenant_id', '=', 'l.tenant_id');
            })
            ->join('federation_user_settings as fus', 'fus.user_id', '=', 'l.user_id')
            ->where('l.id', $listingId)
            ->where('l.tenant_id', $this->testTenantId)
            ->where('l.status', 'active')
            ->where('u.status', 'active')
            ->whereIn('l.federated_visibility', ['listed', 'bookable'])
            ->where('fus.federation_optin', 1)
            ->where('fus.profile_visible_federated', 1)
            ->where('fus.appear_in_federated_search', 1)
            ->count();
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /**
     * Establish the precondition explicitly rather than inheriting it from a
     * developer `.env`.
     */
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
            'name' => 'E076 F-413 partner ' . $tag,
            // A public-IP LITERAL: OutboundUrlGuard short-circuits on IP
            // literals, so no DNS is needed. Nothing leaves the container —
            // Http::fake() intercepts every request.
            'base_url' => 'https://93.184.216.' . (1 + (self::$urlSeq++ % 254)),
            'api_path' => '/api/v1',
            'protocol_type' => 'nexus',
            'auth_method' => 'api_key',
            'api_key' => 'f413-fixture-key-' . $tag,
            'signing_secret' => 'f413-fixture-secret-' . $tag,
            'status' => 'active',
            'allow_listing_search' => 1,
            'created_at' => now(),
        ]);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => 1]);
    }

    private function federationSettings(int $userId, bool $optedIn): void
    {
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $userId],
            [
                'federation_optin' => $optedIn ? 1 : 0,
                'profile_visible_federated' => $optedIn ? 1 : 0,
                'appear_in_federated_search' => $optedIn ? 1 : 0,
                'messaging_enabled_federated' => $optedIn ? 1 : 0,
                'transactions_enabled_federated' => $optedIn ? 1 : 0,
                'updated_at' => now(),
            ]
        );
    }

    private function listing(int $ownerId, string $federatedVisibility): Listing
    {
        $id = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'E076 F-413 fixture listing',
            'description' => 'E076 F-413 fixture description',
            'type' => 'offer',
            'status' => 'active',
            'moderation_status' => 'approved',
            'federated_visibility' => $federatedVisibility,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return Listing::withoutGlobalScopes()->findOrFail($id);
    }
}
