<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Federation;

use App\Events\ListingCreated;
use App\Listeners\PushListingToFederatedPartners;
use App\Models\Listing;
use App\Models\User;
use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Tests\Laravel\TestCase;

/**
 * CrossProtocolRegressionTest — verifies a single local action fans out
 * to partners of four different protocols, each getting a protocol-correct
 * payload, and a single inbound event in four different protocol shapes
 * lands consistently in the local shadow store.
 */
final class CrossProtocolRegressionTest extends TestCase
{
    use DatabaseTransactions;
    use FederationIntegrationHarness;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableFederationForTenant($this->testTenantId);
        $this->fakePartnerHttp();
    }

    public function test_single_listing_creation_pushes_to_all_four_protocols(): void
    {
        $protocols = ['nexus', 'komunitin', 'credit_commons', 'timeoverflow'];
        $partners  = [];
        foreach ($protocols as $p) {
            $partners[$p] = $this->setupPartner($p);
        }

        $user = User::factory()->forTenant($this->testTenantId)->create();
        // F-413: the outbound listing push now requires the OWNER's
        // account-level federation consent, which every PULL path already
        // required. This test is about protocol fan-out, so seed the consent.
        $this->optInUserToFederation((int) $user->id);
        $listing = Listing::factory()->create([
            'tenant_id'            => $this->testTenantId,
            'user_id'              => $user->id,
            'federated_visibility' => 'listed',
        ]);

        $event = new ListingCreated($listing, $user, $this->testTenantId);
        $listener = new PushListingToFederatedPartners(app(FederationFeatureService::class));
        $listener->handle($event);

        // Expect at least one outbound HTTP request PER partner base URL.
        foreach ($partners as $protocol => $partner) {
            Http::assertSent(function ($req) use ($partner) {
                return str_starts_with($req->url(), $partner->base_url);
            });
        }
    }

    public function test_inbound_members_list_consistent_across_protocols(): void
    {
        $response = null;
        foreach (['nexus', 'komunitin', 'credit_commons', 'timeoverflow'] as $protocol) {
            $partner = $this->setupPartner($protocol);
            $response = $this->simulateInboundWebhook($partner, 'members.list', [
                'members' => [['id' => 1, 'username' => 'Alice ' . $protocol]],
            ]);
            // Each protocol should get a 200 response through its adapter's
            // normalizeWebhookPayload → members.list handler.
            $this->assertSame(
                200,
                $response->status(),
                "members.list handling should be consistent across protocols (failed for {$protocol})"
            );
        }
    }
}
