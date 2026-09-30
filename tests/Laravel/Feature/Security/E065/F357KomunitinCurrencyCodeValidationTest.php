<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\Feature\Security\E065\Concerns\DrivesFederationPartnerApi;
use Tests\Laravel\TestCase;

/**
 * F-357 (E-065) — the Komunitin `{code}` currency parameter was never validated.
 *
 * On every `/{code}/…` route the parameter reached only 404 message text and
 * `self` links; the tenant came from the partner key. A partner could address
 * any resource under any currency string, so the route's parent parameter
 * offered no protection anywhere in the controller — which is why F-329 to
 * F-331 could be reached through it and why any future fix assuming it did
 * offer protection would have been wrong.
 *
 * The code is now checked against the community's own currency on every route.
 * Two values are accepted, both case-insensitively: the community's published
 * code (the uppercased tenant slug, which is what `buildCurrencyResource()`
 * emits) and the literal `HOURS`, the platform's single fixed currency — the
 * name this installation has always used on the wire and the controller's own
 * fallback when a tenant has no slug.
 *
 * Adapted from the E-065 slice-A reproduction
 * `.local-docs-archive/security-log/E-065/repro/slice-a/KomunitinNestedOwnershipTest.php`
 * (`test_transfer_read_ignores_the_currency_code_route_parameter`), which
 * PASSED while the bug existed. The attack assertion is inverted and widened
 * from one route to every `{code}` route.
 */
class F357KomunitinCurrencyCodeValidationTest extends TestCase
{
    use DatabaseTransactions;
    use DrivesFederationPartnerApi;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootFederationPartner(['*'], 'f357');
    }

    protected function tearDown(): void
    {
        $this->tearDownFederationPartner();
        parent::tearDown();
    }

    /**
     * Every route that takes `{code}`.
     *
     * @return array<string, array{0: string, 1: string}>
     */
    public static function codeRouteProvider(): array
    {
        return [
            'GET currency'            => ['GET',    '/currency'],
            'PATCH currency'          => ['PATCH',  '/currency'],
            'DELETE currency'         => ['DELETE', '/currency'],
            'GET currency settings'   => ['GET',    '/currency/settings'],
            'PATCH currency settings' => ['PATCH',  '/currency/settings'],
            'GET accounts'            => ['GET',    '/accounts'],
            'POST accounts'           => ['POST',   '/accounts'],
            'GET account'             => ['GET',    '/accounts/1'],
            'PATCH account'           => ['PATCH',  '/accounts/1'],
            'DELETE account'          => ['DELETE', '/accounts/1'],
            'GET transfers'           => ['GET',    '/transfers'],
            'POST transfers'          => ['POST',   '/transfers'],
            'GET transfer'            => ['GET',    '/transfers/1'],
            'PATCH transfer'          => ['PATCH',  '/transfers/1'],
            'DELETE transfer'         => ['DELETE', '/transfers/1'],
        ];
    }

    /**
     * @dataProvider codeRouteProvider
     */
    public function test_a_currency_this_installation_never_issued_is_refused(string $method, string $suffix): void
    {
        $response = $this->json(
            $method,
            '/api/v2/federation/komunitin/NOTACURRENCY' . $suffix,
            [],
            $this->komunitinHeaders()
        );

        $this->assertSame(
            404,
            $response->status(),
            "{$method} {$suffix} accepted a currency code this installation has never issued."
        );
    }

    public function test_the_communitys_own_currency_code_is_accepted(): void
    {
        $code = $this->ownCurrencyCode();

        $this->json(
            'GET',
            "/api/v2/federation/komunitin/{$code}/currency",
            [],
            $this->komunitinHeaders()
        )->assertStatus(200);

        $this->json(
            'GET',
            "/api/v2/federation/komunitin/{$code}/accounts",
            [],
            $this->komunitinHeaders()
        )->assertStatus(200);
    }

    public function test_the_code_is_matched_case_insensitively(): void
    {
        $code = strtolower($this->ownCurrencyCode());

        $this->json(
            'GET',
            "/api/v2/federation/komunitin/{$code}/currency",
            [],
            $this->komunitinHeaders()
        )->assertStatus(200);
    }

    public function test_the_platform_fixed_hours_currency_is_still_accepted(): void
    {
        // The platform's single currency is Hours (symbol h, resource id
        // "hours-{tenant}"), and HOURS is the name every partner and the whole
        // existing contract has used on the wire. Accepting it is deliberate.
        $this->json(
            'GET',
            '/api/v2/federation/komunitin/HOURS/currency',
            [],
            $this->komunitinHeaders()
        )->assertStatus(200);
    }
}
