<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Privacy;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\Laravel\TestCase;

/**
 * Locks the anonymous boundary for read endpoints whose payloads contain
 * member-authored content or identity-linked relationships.
 */
class AnonymousMemberIdentityBoundaryTest extends TestCase
{
    use DatabaseTransactions;

    public function test_identity_bearing_get_endpoints_require_authentication(): void
    {
        // The auth boundary is the property under test, so enable the
        // separately controlled Caring module before checking its routes.
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $features = json_decode($tenant->features ?? '{}', true, 512, JSON_THROW_ON_ERROR);
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode($features, JSON_THROW_ON_ERROR)]);
        TenantContext::setById($this->testTenantId);

        foreach (self::identityBearingGetEndpoints() as $label => [$endpoint]) {
            $response = $this->apiGet($endpoint);

            $this->assertSame(
                401,
                $response->getStatusCode(),
                sprintf('%s (%s) must reject anonymous requests; response: %s', $label, $endpoint, $response->getContent())
            );
        }
    }

    /**
     * @return array<string, array{string}>
     */
    public static function identityBearingGetEndpoints(): array
    {
        return [
            'explore index' => ['/v2/explore'],
            'explore for you' => ['/v2/explore/for-you'],
            'explore trending' => ['/v2/explore/trending'],
            'explore popular listings' => ['/v2/explore/popular-listings'],
            'explore category' => ['/v2/explore/category/gardening'],

            'groups index' => ['/v2/groups'],
            'group detail' => ['/v2/groups/1'],
            'group members' => ['/v2/groups/1/members'],

            'events index' => ['/v2/events'],
            'events nearby' => ['/v2/events/nearby'],
            'event detail' => ['/v2/events/1'],
            'event attendees' => ['/v2/events/1/attendees'],

            'listings index' => ['/v2/listings'],
            'listings nearby' => ['/v2/listings/nearby'],
            'listings featured' => ['/v2/listings/featured'],
            'listing detail' => ['/v2/listings/1'],

            'jobs index' => ['/v2/jobs'],
            'job detail' => ['/v2/jobs/1'],
            'employer reviews' => ['/v2/jobs/employer-reviews/1'],

            'ideation challenges' => ['/v2/ideation-challenges'],
            'ideation challenge detail' => ['/v2/ideation-challenges/1'],

            'volunteering opportunities' => ['/v2/volunteering/opportunities'],
            'volunteering opportunity detail' => ['/v2/volunteering/opportunities/1'],
            'volunteering organisations' => ['/v2/volunteering/organisations'],
            'volunteering organisation detail' => ['/v2/volunteering/organisations/1'],
            'volunteering organisation reviews' => ['/v2/volunteering/reviews/organization/1'],

            'resources index' => ['/v2/resources'],
            'knowledge base index' => ['/v2/kb'],
            'knowledge base search' => ['/v2/kb/search?q=privacy'],
            'knowledge base slug' => ['/v2/kb/slug/example-article'],
            'knowledge base detail' => ['/v2/kb/1'],
            'knowledge base attachment' => ['/v2/kb/1/attachments/1/download'],

            'courses index' => ['/v2/courses'],
            'course categories' => ['/v2/courses/categories'],
            'course reviews' => ['/v2/courses/1/reviews'],
            'course detail' => ['/v2/courses/example-course'],

            'podcasts index' => ['/v2/podcasts'],
            'podcast show' => ['/v2/podcasts/example-show'],
            'podcast episode' => ['/v2/podcasts/example-show/example-episode'],
            'marketplace listings' => ['/v2/marketplace/listings'],
            'marketplace nearby' => ['/v2/marketplace/listings/nearby'],
            'marketplace featured' => ['/v2/marketplace/listings/featured'],
            'marketplace free' => ['/v2/marketplace/listings/free'],
            'marketplace listing detail' => ['/v2/marketplace/listings/1'],
            'marketplace categories' => ['/v2/marketplace/categories'],
            'marketplace category listings' => ['/v2/marketplace/categories/example/listings'],
            'marketplace category template' => ['/v2/marketplace/categories/1/template'],
            'marketplace seller' => ['/v2/marketplace/sellers/1'],
            'marketplace seller listings' => ['/v2/marketplace/sellers/1/listings'],
            'marketplace seller shipping' => ['/v2/marketplace/sellers/1/shipping-options'],
            'marketplace pickup slots' => ['/v2/marketplace/listings/1/pickup-slots'],

            'volunteer certificate verification' => ['/v2/volunteering/certificates/verify/example-code'],
            'volunteer certificate html' => ['/v2/volunteering/certificates/example-code/html'],

            'municipality surveys' => ['/v2/caring-community/surveys'],
            'municipality survey detail' => ['/v2/caring-community/surveys/1'],
        ];
    }

    public function test_identity_free_podcast_distribution_routes_reach_resource_authorization_anonymously(): void
    {
        $endpoints = [
            '/v2/podcasts/example-show/feed.xml',
            '/v2/podcasts/feed/2/example-show.xml',
            '/v2/podcasts/media/2/999999/audio',
            '/v2/podcasts/transcripts/2/999999.txt',
            '/v2/podcasts/chapters/2/999999.json',
        ];

        foreach ($endpoints as $endpoint) {
            $response = $this->apiGet($endpoint);

            $this->assertNotSame(401, $response->getStatusCode(), $endpoint . ' must use visibility/signature authorization rather than member authentication.');
            $this->assertStringNotContainsString('owner_user_id', $response->getContent());
            $this->assertStringNotContainsString('author_user_id', $response->getContent());
            $this->assertStringNotContainsString('owner_email', $response->getContent());
        }
    }

    public function test_public_club_directory_omits_contact_email(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $email = 'private-club-contact-' . uniqid() . '@example.test';

        DB::table('vol_organizations')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Privacy Boundary Club',
            'slug' => 'privacy-boundary-club-' . uniqid(),
            'description' => 'Public organization metadata without a personal contact address.',
            'contact_email' => $email,
            'status' => 'active',
            'org_type' => 'club',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiGet('/v2/clubs');

        $response->assertOk();
        $this->assertStringNotContainsString($email, $response->getContent());
        $this->assertStringNotContainsString('contact_email', $response->getContent());
    }

    public function test_authenticated_responses_cannot_be_stored_in_shared_caches(): void
    {
        Route::middleware(['api', 'auth:sanctum'])->get('/api/privacy-test/authenticated-response', function () {
            return response()->json([
                'member_name' => auth()->user()?->name,
            ]);
        });

        $member = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Private Cache Boundary Member',
        ]);

        $response = $this->actingAs($member, 'sanctum')
            ->getJson('/api/privacy-test/authenticated-response', $this->withTenantHeader());

        $response->assertOk();
        $response->assertHeader('Cache-Control', 'max-age=0, no-store, private');
        $response->assertHeader('Pragma', 'no-cache');
        $vary = (string) $response->headers->get('Vary');
        $this->assertStringContainsString('Authorization', $vary);
        $this->assertStringContainsString('Cookie', $vary);
    }
}
