<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\TestCase;

/**
 * E-075 F-481 — a SIGNED-IN member whose client still holds a renamed or
 * removed community's name must be served their OWN community (the one their
 * signed token names), not hard-refused on every request.
 *
 * The defect: F-443's refusal (`TenantContext::resolve()` step 2.3) and F-479's
 * sibling refusal (step 2) both returned before step 2.5 — the Bearer-token
 * community fallback — so any client sending a community name the platform no
 * longer recognises was refused `400 INVALID_TENANT` on every request, even
 * when its token unambiguously named the member's own community. Before F-443
 * such a request fell through to the token. It matters because the mobile app
 * stores and sends this header and `web-uk` uses it as its only community
 * signal on the production path.
 *
 * 🔴 THIS IS NOT A REVERT OF F-443. Failing closed is right, and the
 * controls below pin it: an ANONYMOUS request naming an unknown community is
 * still refused, and an anonymous sign-up naming one still creates no account.
 * Only the ORDER relative to the token fallback changes — a decision that was
 * never made explicitly.
 *
 * Controls in this file, each differing from the harm case in exactly one
 * property:
 *   - anonymous + unknown slug  → still refused 400 INVALID_TENANT (F-443);
 *   - anonymous + unparseable id → still refused 400 INVALID_TENANT (F-479);
 *   - signed-in + a real OTHER community's slug → still 403 TENANT_MISMATCH;
 *   - signed-in + their own community's slug → still 200, their community.
 */
final class F481StaleCommunityNameFallsBackToTheTokenTest extends TestCase
{
    use DatabaseTransactions;

    private const MASTER_TENANT_ID = 1;

    /** @return array{0:int,1:string} */
    private function createCommunity(string $prefix): array
    {
        $slug = $prefix . '-' . bin2hex(random_bytes(4));
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'E075 F481 ' . $slug,
            'slug' => $slug,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$id, $slug];
    }

    private function tokenForMemberOf(int $tenantId): string
    {
        $member = User::factory()->forTenant($tenantId)->create();

        return app(TokenService::class)->generateToken(
            (int) $member->id,
            (int) $member->tenant_id
        );
    }

    /** @param array<string,string> $headers */
    private function probe(array $headers): TestResponse
    {
        TenantContext::reset();

        return $this->getJson('http://localhost/api/v2/tenant/bootstrap', array_merge(
            ['Accept' => 'application/json'],
            $headers
        ));
    }

    protected function tearDown(): void
    {
        unset(
            $_SERVER['HTTP_X_TENANT_SLUG'],
            $_SERVER['HTTP_X_TENANT_ID'],
            $_SERVER['HTTP_AUTHORIZATION']
        );
        TenantContext::reset();
        parent::tearDown();
    }

    /**
     * THE HARM: a signed-in member sending a community name that matches nothing
     * is refused outright instead of being served their own community.
     */
    public function test_a_signed_in_member_sending_a_stale_community_name_is_served_their_own_community(): void
    {
        [$memberTenantId, $memberSlug] = $this->createCommunity('e075f481-home');
        $token = $this->tokenForMemberOf($memberTenantId);

        // CONTROL FIRST: the token really is valid and really does name this
        // community, so a refusal below cannot be blamed on a broken fixture.
        $control = $this->probe([
            'Authorization' => 'Bearer ' . $token,
            'X-Tenant-Slug' => $memberSlug,
        ]);
        $controlBody = json_decode((string) $control->getContent(), true);
        $this->assertSame(
            200,
            $control->getStatusCode(),
            'INCONCLUSIVE: the signed-in member could not reach their own community by name.'
        );
        $this->assertSame(
            $memberTenantId,
            $controlBody['data']['id'] ?? null,
            'INCONCLUSIVE: the member\'s own community name did not resolve to it.'
        );

        // THE HARM: the same member, same token, but the client holds a name the
        // platform no longer recognises (the community was renamed).
        $stale = 'e075f481-renamed-' . bin2hex(random_bytes(4));
        $response = $this->probe([
            'Authorization' => 'Bearer ' . $token,
            'X-Tenant-Slug' => $stale,
        ]);
        $body = json_decode((string) $response->getContent(), true);

        $this->assertSame(
            200,
            $response->getStatusCode(),
            'A signed-in member whose client holds a stale community name was refused '
            . 'on every request instead of falling back to the community their own '
            . 'token names (F-481). Body: '
            . mb_substr((string) $response->getContent(), 0, 200)
        );
        $this->assertSame(
            $memberTenantId,
            $body['data']['id'] ?? null,
            'The signed-in fallback must serve the TOKEN\'s community, not the master community.'
        );
        $this->assertNotSame(
            self::MASTER_TENANT_ID,
            $body['data']['id'] ?? null,
            'The stale name must never be answered with the master community.'
        );
    }

    /**
     * THE HARM, sibling header: the same for an `X-Tenant-ID` the platform
     * cannot parse (F-479's refusal must not strip a signed-in reader either).
     */
    public function test_a_signed_in_member_sending_an_unparseable_community_id_is_served_their_own_community(): void
    {
        [$memberTenantId] = $this->createCommunity('e075f481-idhome');
        $token = $this->tokenForMemberOf($memberTenantId);

        $response = $this->probe([
            'Authorization' => 'Bearer ' . $token,
            'X-Tenant-ID' => 'a-slug-not-an-id',
        ]);
        $body = json_decode((string) $response->getContent(), true);

        $this->assertSame(
            200,
            $response->getStatusCode(),
            'A signed-in member sending an unparseable community id was refused instead '
            . 'of falling back to the community their own token names.'
        );
        $this->assertSame(
            $memberTenantId,
            $body['data']['id'] ?? null,
            'The signed-in fallback must serve the TOKEN\'s community.'
        );
    }

    /**
     * CONTROL — F-443 MUST STAY CLOSED: with no token, an unknown community
     * name is still refused.
     */
    public function test_an_anonymous_request_with_an_unknown_community_name_is_still_refused(): void
    {
        $response = $this->probe([
            'X-Tenant-Slug' => 'e075f481-nobody-' . bin2hex(random_bytes(4)),
        ]);
        $body = json_decode((string) $response->getContent(), true);

        $this->assertSame(400, $response->getStatusCode(), 'F-443 must stay closed for anonymous callers.');
        $this->assertSame('INVALID_TENANT', $body['errors'][0]['code'] ?? null);
        $this->assertNotSame(self::MASTER_TENANT_ID, $body['data']['id'] ?? null);
    }

    /**
     * CONTROL — F-479 MUST STAY CLOSED: with no token, an unparseable community
     * id is still refused.
     */
    public function test_an_anonymous_request_with_an_unparseable_community_id_is_still_refused(): void
    {
        $response = $this->probe(['X-Tenant-ID' => 'a-slug-not-an-id']);
        $body = json_decode((string) $response->getContent(), true);

        $this->assertSame(400, $response->getStatusCode(), 'F-479 must stay closed for anonymous callers.');
        $this->assertSame('INVALID_TENANT', $body['errors'][0]['code'] ?? null);
    }

    /**
     * CONTROL: a signed-in member naming a real but DIFFERENT community is still
     * refused with the community-mismatch error. The fallback must not become a
     * way to ignore a disagreement the platform can actually see.
     */
    public function test_a_signed_in_member_naming_another_real_community_is_still_refused(): void
    {
        [$memberTenantId] = $this->createCommunity('e075f481-mine');
        [, $otherSlug] = $this->createCommunity('e075f481-theirs');
        $token = $this->tokenForMemberOf($memberTenantId);

        $response = $this->probe([
            'Authorization' => 'Bearer ' . $token,
            'X-Tenant-Slug' => $otherSlug,
        ]);
        $body = json_decode((string) $response->getContent(), true);

        $this->assertSame(403, $response->getStatusCode(), 'A real community mismatch must still be refused.');
        $this->assertSame('TENANT_MISMATCH', $body['errors'][0]['code'] ?? null);
    }
}
