<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Core\TenantContext;
use App\Models\Listing;
use App\Models\User;
use App\Services\FederationFeatureService;
use App\Services\ListingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-414 (E-069 slice B, B-2) — un-sharing, closing or deleting a listing must
 * RETRACT it from the partners that already hold it.
 *
 * `PushListingToFederatedPartners` returned silently when a listing stopped
 * being shareable (`:62-73`), there was no `ListingDeleted` event at all, and
 * `PushFederationDataRetraction` retracts only the member's mirrored profile.
 * A member who un-shared or deleted a listing saw it disappear locally while
 * the partner installation carried on displaying it, with no signal to remove
 * it.
 *
 * The in-house design being copied here is the volunteering sibling,
 * `PushVolunteerOpportunityToFederatedPartners:80-104`, which converts
 * `listed -> none` and `active -> inactive/closed` into `action = 'deleted'`
 * "rather than returning and leaving it displayed on partner sites forever".
 * It is driven by `VolunteerOpportunityUpdated::$previousFederatedVisibility`;
 * `ListingUpdated` gains the same optional constructor argument.
 *
 * These tests assert the CORRECT behaviour and fail before the fix.
 *
 * OBSERVATION POINT, stated honestly. `Http::fake()` intercepts the request, so
 * no bytes leave the container and no real partner is contacted — the container
 * has no outbound DNS, which is why the partner fixture uses a public-IP
 * literal. What is proven is that the platform decided a retraction was owed
 * and assembled and dispatched it. Real wire transmission is not exercised.
 */
final class F414UnsharedListingIsRetractedFromPartnersTest extends TestCase
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

    /** Un-sharing a listing the partner already holds must retract it. */
    public function test_unsharing_a_shared_listing_retracts_it_from_the_partner(): void
    {
        $this->partner('f414-unshare');
        $listing = $this->sharedListing();

        ListingService::update((int) $listing->id, ['federated_visibility' => 'none']);

        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => ($request['action'] ?? null) === 'deleted'
            && (int) ($request['id'] ?? 0) === (int) $listing->id);
    }

    /** Deleting a listing the partner already holds must retract it. */
    public function test_deleting_a_shared_listing_retracts_it_from_the_partner(): void
    {
        $this->partner('f414-delete');
        $listing = $this->sharedListing();

        ListingService::delete((int) $listing->id);

        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => ($request['action'] ?? null) === 'deleted'
            && (int) ($request['id'] ?? 0) === (int) $listing->id);
    }

    /**
     * CONTROL — the rightful case. An ordinary edit of a still-shared listing
     * must still be pushed as an update, not turned into a retraction.
     */
    public function test_control_an_ordinary_edit_still_pushes_an_update(): void
    {
        $this->partner('f414-edit');
        $listing = $this->sharedListing();

        ListingService::update((int) $listing->id, ['title' => 'E076 F-414 edited title']);

        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => ($request['action'] ?? null) === 'updated'
            && (int) ($request['id'] ?? 0) === (int) $listing->id);
    }

    /**
     * NEGATIVE CONTROL — a listing that was never shared has nothing to retract,
     * so deleting it must still send nothing. Differs from the delete case above
     * only in the listing's prior `federated_visibility`.
     */
    public function test_control_deleting_a_never_shared_listing_sends_nothing(): void
    {
        $this->partner('f414-never-shared');
        $listing = $this->sharedListing('none');

        ListingService::delete((int) $listing->id);

        Http::assertNothingSent();
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
            'name' => 'E076 F-414 partner ' . $tag,
            // A public-IP LITERAL: OutboundUrlGuard short-circuits on IP
            // literals, so no DNS is needed. Nothing leaves the container —
            // Http::fake() intercepts every request.
            'base_url' => 'https://93.184.216.' . (1 + (self::$urlSeq++ % 254)),
            'api_path' => '/api/v1',
            'protocol_type' => 'nexus',
            'auth_method' => 'api_key',
            'api_key' => 'f414-fixture-key-' . $tag,
            'signing_secret' => 'f414-fixture-secret-' . $tag,
            'status' => 'active',
            'allow_listing_search' => 1,
            'created_at' => now(),
        ]);
    }

    /** An active, approved listing owned by a member who consented to federation. */
    private function sharedListing(string $federatedVisibility = 'listed'): Listing
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
        ]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $owner->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'appear_in_federated_search' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'updated_at' => now(),
            ]
        );

        $id = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $owner->id,
            'title' => 'E076 F-414 fixture listing',
            'description' => 'E076 F-414 fixture description for the retraction case',
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
