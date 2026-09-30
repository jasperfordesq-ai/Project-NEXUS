<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\FederationApiMiddleware;
use App\Models\User;
use App\Services\FederationSearchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-447 (E-073, slice F finding F-2) — the v1 partner API disclosed a member's
 * `location` and `skills` after they switched both off.
 *
 * `show_location_federated` and `show_skills_federated` both default to FALSE
 * (`FederationUserService::DEFAULT_SETTINGS`), and every other federated read
 * surface honours them — `FederationV2Controller::members()`/`member()` and
 * `FederationSearchService::searchMembers()`, the last as an explicit
 * `CASE WHEN … THEN … ELSE NULL`. Three v1 reads did not:
 * `members()`, `member()` and `listing()` (the listing owner's location).
 *
 * The fix copies the `CASE WHEN` shape from `FederationSearchService` into the
 * three v1 selects, so all federated surfaces now agree.
 *
 * Each harm case below has a control on an identical member that differs only
 * in the two switches, so the fix cannot be mistaken for "the field was
 * dropped".
 */
final class F447V1PartnerHonoursFederationPrivacyTogglesTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    private const HOME = 'F447 17 Sycamore Lane, Ballybrit';
    private const SKILLS = 'f447gardening,f447childminding';

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    //  The switched-off member must be withheld
    // ------------------------------------------------------------------

    public function test_member_list_withholds_the_location_and_skills_a_member_switched_off(): void
    {
        $hidden = $this->federatedMember(showLocation: false, showSkills: false);
        $key = $this->partnerApiKey('f447-a');

        $this->useKey($key, 'GET', '/api/v1/federation/members');
        $response = $this->apiGet('/v1/federation/members?per_page=100', ['X-API-Key' => $key]);
        $this->assertSame(200, $response->status(), (string) $response->getContent());

        $row = $this->rowFor($response->json('data') ?? [], (int) $hidden->id);
        $this->assertNotNull($row, 'the member is still listed — only the two fields are withheld');

        $this->assertNull($row['location'], 'show_location_federated = 0 must withhold the home address');
        $this->assertSame([], $row['skills'], 'show_skills_federated = 0 must withhold the skills list');
        $this->assertStringNotContainsString(self::HOME, (string) $response->getContent());
    }

    public function test_member_profile_withholds_the_same_two_fields(): void
    {
        $hidden = $this->federatedMember(showLocation: false, showSkills: false);
        $key = $this->partnerApiKey('f447-b');

        $this->useKey($key, 'GET', '/api/v1/federation/members/' . $hidden->id);
        $response = $this->apiGet('/v1/federation/members/' . $hidden->id, ['X-API-Key' => $key]);

        $this->assertSame(200, $response->status(), (string) $response->getContent());
        $this->assertNull($response->json('data.location'));
        $this->assertSame([], $response->json('data.skills'));
        $this->assertStringNotContainsString(self::HOME, (string) $response->getContent());
    }

    public function test_listing_detail_withholds_the_owners_switched_off_location(): void
    {
        $hidden = $this->federatedMember(showLocation: false, showSkills: false);
        $listingId = $this->federatedListing($hidden);
        $key = $this->partnerApiKey('f447-c');

        $this->useKey($key, 'GET', '/api/v1/federation/listings/' . $listingId);
        $response = $this->apiGet('/v1/federation/listings/' . $listingId, ['X-API-Key' => $key]);

        $this->assertSame(200, $response->status(), (string) $response->getContent());
        $this->assertNull(
            $response->json('data.owner.location'),
            'the listing detail must not leak the owner location the member switched off',
        );
        $this->assertStringNotContainsString(self::HOME, (string) $response->getContent());
    }

    // ------------------------------------------------------------------
    //  LEGITIMATE ACCESS — a member who allows it is unaffected
    // ------------------------------------------------------------------

    public function test_control_a_member_who_allows_both_still_has_both_returned(): void
    {
        $shown = $this->federatedMember(showLocation: true, showSkills: true);
        $key = $this->partnerApiKey('f447-d');

        $this->useKey($key, 'GET', '/api/v1/federation/members');
        $list = $this->apiGet('/v1/federation/members?per_page=100', ['X-API-Key' => $key]);
        $this->assertSame(200, $list->status(), (string) $list->getContent());

        $row = $this->rowFor($list->json('data') ?? [], (int) $shown->id);
        $this->assertNotNull($row);
        $this->assertSame(self::HOME, $row['location'], 'the member said yes — the field is still shared');
        $this->assertNotEmpty($row['skills']);

        $this->useKey($key, 'GET', '/api/v1/federation/members/' . $shown->id);
        $profile = $this->apiGet('/v1/federation/members/' . $shown->id, ['X-API-Key' => $key]);
        $this->assertSame(200, $profile->status());
        $this->assertSame(self::HOME, $profile->json('data.location'));
        $this->assertNotEmpty($profile->json('data.skills'));

        $listingId = $this->federatedListing($shown);
        $this->useKey($key, 'GET', '/api/v1/federation/listings/' . $listingId);
        $listing = $this->apiGet('/v1/federation/listings/' . $listingId, ['X-API-Key' => $key]);
        $this->assertSame(200, $listing->status());
        $this->assertSame(self::HOME, $listing->json('data.owner.location'));
    }

    public function test_control_the_v1_reads_now_agree_with_the_platforms_own_federated_search(): void
    {
        $hidden = $this->federatedMember(showLocation: false, showSkills: false);
        $shown = $this->federatedMember(showLocation: true, showSkills: true);

        $search = app(FederationSearchService::class)
            ->searchMembers([$this->testTenantId], ['limit' => 200]);

        $searchHidden = $this->rowFor($search['members'] ?? [], (int) $hidden->id);
        $searchShown = $this->rowFor($search['members'] ?? [], (int) $shown->id);
        $this->assertNotNull($searchHidden);
        $this->assertNotNull($searchShown);
        $this->assertNull($searchHidden['location']);
        $this->assertSame(self::HOME, $searchShown['location']);

        $key = $this->partnerApiKey('f447-e');
        $this->useKey($key, 'GET', '/api/v1/federation/members');
        $v1 = $this->apiGet('/v1/federation/members?per_page=200', ['X-API-Key' => $key]);
        $this->assertSame(200, $v1->status());

        $v1Hidden = $this->rowFor($v1->json('data') ?? [], (int) $hidden->id);
        $v1Shown = $this->rowFor($v1->json('data') ?? [], (int) $shown->id);
        $this->assertNotNull($v1Hidden);
        $this->assertNotNull($v1Shown);

        $this->assertNull($v1Hidden['location'], 'the v1 read now answers as the search service does');
        $this->assertSame($searchShown['location'], $v1Shown['location']);
    }

    // ------------------------------------------------------------------
    //  Fixtures
    // ------------------------------------------------------------------

    /**
     * @param array<int,array<string,mixed>> $rows
     * @return array<string,mixed>|null
     */
    private function rowFor(array $rows, int $id): ?array
    {
        foreach ($rows as $row) {
            if ((int) ($row['id'] ?? 0) === $id) {
                return $row;
            }
        }

        return null;
    }

    private function federatedMember(bool $showLocation, bool $showSkills): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'location' => self::HOME,
            'skills' => self::SKILLS,
        ]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'appear_in_federated_search' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'show_location_federated' => $showLocation ? 1 : 0,
                'show_skills_federated' => $showSkills ? 1 : 0,
                'show_reviews_federated' => 1,
                'updated_at' => now(),
            ],
        );

        return $user;
    }

    private function federatedListing(User $owner): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $owner->id,
            'title' => 'F447 listing ' . bin2hex(random_bytes(4)),
            'description' => 'F447 fixture listing',
            'type' => 'offer',
            'status' => 'active',
            'federated_visibility' => 'listed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function partnerApiKey(string $platformId): string
    {
        $apiKey = $platformId . '-' . bin2hex(random_bytes(10));
        DB::table('federation_api_keys')->insert([
            'tenant_id' => $this->testTenantId,
            'name' => 'F-447 ' . $platformId,
            'key_hash' => hash('sha256', $apiKey),
            'key_prefix' => substr($apiKey, 0, 8),
            'signing_enabled' => 0,
            'platform_id' => $platformId,
            'permissions' => json_encode(['members:read', 'listings:read']),
            'rate_limit' => 100000,
            'status' => 'active',
            'created_by' => 1,
            'created_at' => now(),
            'updated_at' => now(),
            'hourly_request_count' => 0,
        ]);

        return $apiKey;
    }

    private function useKey(string $apiKey, string $method, string $uri): void
    {
        FederationApiMiddleware::reset();
        $_SERVER['HTTP_X_API_KEY'] = $apiKey;
        $_SERVER['REQUEST_METHOD'] = $method;
        $_SERVER['REQUEST_URI'] = $uri;
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    }
}
