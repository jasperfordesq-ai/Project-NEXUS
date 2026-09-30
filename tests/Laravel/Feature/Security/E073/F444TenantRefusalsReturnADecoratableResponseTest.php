<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\TestCase;

/**
 * E-073 F-444 — a community-resolution refusal must be an ordinary HTTP
 * RESPONSE that the surrounding middleware can decorate, not something written
 * to the output buffer.
 *
 * The defect: `respondWithInvalidTenantError()`, `respondWithTenantMismatchError()`,
 * `showInactiveTenantError()` and step 3's 404 all did `echo … ; exit;`.
 * `SecurityHeaders` and `EnsureCorsHeaders` set their headers on the RESPONSE
 * phase and sit outside `ResolveTenant`, so the process ended before either
 * ran: a browser saw an opaque network failure instead of the refusal, and the
 * inactive-community page was HTML from the API origin with no CSP, no
 * `nosniff` and no frame-options.
 *
 * 🔴 WHAT THIS TEST CAN AND CANNOT PROVE — read before trusting it.
 *
 * It CANNOT observe the production `exit`. Every one of those functions took a
 * DIFFERENT branch under `APP_ENV=testing` (it threw an `HttpException`) from
 * the one production took, so PHPUnit could never reach the buffer-and-exit
 * code at all. That is why F-444 is recorded as *suspected* rather than
 * confirmed, and this file does not change that.
 *
 * What it DOES pin is the property the fix turns on: `TenantContext::resolve()`
 * now hands a real `Response` object back to `ResolveTenant`, which returns it
 * through the middleware stack. Two consequences are observable here:
 *
 *  1. the refusal keeps its OWN status and error code. Before the fix the
 *     thrown exception was swallowed by `ResolveTenant`'s `catch (\Throwable)`
 *     and every refusal — invalid community, community mismatch, switched-off
 *     community — came back as one indistinguishable `400
 *     tenant_resolution_failed`;
 *  2. the refusal carries the response-phase security headers, exactly as an
 *     ordinary served response does.
 *
 * Point 2 alone would NOT be red before the fix (under testing the exception
 * was caught INSIDE `ResolveTenant`, so its replacement response was already
 * decorated). It is asserted so a future change that reinstates writing
 * straight to the output buffer is caught by more than the status code.
 */
final class F444TenantRefusalsReturnADecoratableResponseTest extends TestCase
{
    use DatabaseTransactions;

    private function createCommunity(string $prefix, bool $active = true): array
    {
        $slug = $prefix . '-' . bin2hex(random_bytes(4));
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'E074A ' . $slug,
            'slug' => $slug,
            'is_active' => $active ? 1 : 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$id, $slug];
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

    private function assertResponsePhaseHeaders(TestResponse $response, string $what): void
    {
        $this->assertSame(
            'nosniff',
            $response->headers->get('X-Content-Type-Options'),
            $what . ' reached the client without the response-phase security headers, '
            . 'which is what an exit inside the resolver causes (F-444).'
        );
        $this->assertNotNull(
            $response->headers->get('X-Frame-Options'),
            $what . ' carried no X-Frame-Options.'
        );
    }

    protected function tearDown(): void
    {
        unset($_SERVER['HTTP_X_TENANT_ID'], $_SERVER['HTTP_X_TENANT_SLUG'], $_SERVER['HTTP_AUTHORIZATION']);
        TenantContext::reset();
        parent::tearDown();
    }

    /**
     * LEGITIMATE-ACCESS CONTROL: an ordinary served request. If this did not
     * carry the headers, the refusal assertions below would prove nothing.
     */
    public function test_a_served_request_carries_the_response_phase_headers(): void
    {
        [$id, $slug] = $this->createCommunity('e074a-f444-ok');

        $response = $this->probe(['X-Tenant-Slug' => $slug]);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame($id, json_decode((string) $response->getContent(), true)['data']['id'] ?? null);
        $this->assertResponsePhaseHeaders($response, 'A served request');
    }

    /**
     * An unknown community id must come back as the resolver's OWN refusal, not
     * as the generic "unable to resolve tenant" the swallowed exception produced.
     */
    public function test_an_unknown_community_id_is_refused_with_its_own_envelope(): void
    {
        $unknownId = 900000000 + random_int(1, 99999);
        $this->assertNull(
            DB::table('tenants')->where('id', $unknownId)->first(),
            'INCONCLUSIVE: the id chosen for this probe exists.'
        );

        $response = $this->probe(['X-Tenant-ID' => (string) $unknownId]);
        $body = json_decode((string) $response->getContent(), true);

        $this->assertSame(400, $response->getStatusCode());
        $this->assertSame(
            'INVALID_TENANT',
            $body['errors'][0]['code'] ?? null,
            'The refusal lost its own error code — the resolver signalled it out of band '
            . 'instead of returning a response (F-444).'
        );
        $this->assertResponsePhaseHeaders($response, 'An invalid-community refusal');
    }

    /**
     * A credential naming one community, used against another, must come back
     * as the mismatch refusal — 403 with the mismatch code.
     */
    public function test_a_community_mismatch_is_refused_with_its_own_status_and_code(): void
    {
        [$homeId] = $this->createCommunity('e074a-f444-home');
        [$otherId] = $this->createCommunity('e074a-f444-other');

        $member = User::factory()->forTenant($homeId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
            'is_super_admin' => false,
            'is_tenant_super_admin' => false,
        ]);
        $jwt = app(TokenService::class)->generateToken((int) $member->id, $homeId);

        // CONTROL FIRST: the same credential against its OWN community is served.
        $control = $this->probe([
            'X-Tenant-ID' => (string) $homeId,
            'Authorization' => 'Bearer ' . $jwt,
        ]);
        $this->assertSame(
            200,
            $control->getStatusCode(),
            'INCONCLUSIVE: the credential cannot use its own community, so the refusal below proves nothing.'
        );

        $response = $this->probe([
            'X-Tenant-ID' => (string) $otherId,
            'Authorization' => 'Bearer ' . $jwt,
        ]);
        $body = json_decode((string) $response->getContent(), true);

        $this->assertSame(
            403,
            $response->getStatusCode(),
            'A community mismatch must keep its own 403, not be flattened into the generic resolver failure.'
        );
        $this->assertSame(
            'TENANT_MISMATCH',
            $body['errors'][0]['code'] ?? null,
            'The mismatch refusal lost its own error code (F-444).'
        );
        $this->assertResponsePhaseHeaders($response, 'A community-mismatch refusal');
    }

    /**
     * A switched-off community keeps its own "unavailable" answer, and that
     * answer is a response the middleware decorates.
     */
    public function test_a_switched_off_community_is_refused_as_a_decorated_response(): void
    {
        [, $slug] = $this->createCommunity('e074a-f444-off', false);

        $response = $this->probe(['X-Tenant-Slug' => $slug]);

        $this->assertSame(
            503,
            $response->getStatusCode(),
            'A switched-off community must keep its own 503, not be flattened into the generic resolver failure.'
        );
        $this->assertResponsePhaseHeaders($response, 'A switched-off-community refusal');
    }
}
