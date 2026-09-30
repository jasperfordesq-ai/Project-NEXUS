<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\TestCase;

/**
 * E-073 F-443 — a request naming a community that does not exist through the
 * `X-Tenant-Slug` header must be REFUSED, not silently served (and written) as
 * the master community.
 *
 * The defect: `TenantContext::resolve()` step 2.3 ended its branch on an
 * unmatched slug with the comment "Unknown slug — fall through to other
 * resolution methods", so execution reached step 5's `fetchTenant('id', 1)`
 * fallback — the master community. A sign-up addressed to a removed or renamed
 * community was therefore created in the master community and answered
 * `201 Registration successful`.
 *
 * Both sibling paths already fail closed on exactly the same input: an
 * unrecognised Host is refused (the F-035 fix, `PlatformHostPolicy`), and an
 * unknown `?slug=` on the very same bootstrap endpoint is refused 404
 * ("TRS-001 fail-closed: unknown slug MUST 404, never fall back to master
 * tenant", `TenantBootstrapController:70-78`). An INACTIVE community's slug was
 * refused too — so the header failed closed for "exists but switched off" and
 * open for "does not exist".
 *
 * These tests assert the CORRECT behaviour and therefore fail before the fix.
 * The legitimate-access control is in each test: the same header carrying a
 * REAL community's slug must still resolve to that community, and the same
 * sign-up naming a real community must still land in it. The master-community
 * fallback for the root / the platform's own pages is asserted separately, so a
 * fix that simply deleted the fallback would fail too.
 */
final class F443UnknownTenantSlugHeaderIsRefusedTest extends TestCase
{
    use DatabaseTransactions;

    private const MASTER_TENANT_ID = 1;

    private function createCommunity(string $prefix): array
    {
        $slug = $prefix . '-' . bin2hex(random_bytes(4));
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'E074A ' . $slug,
            'slug' => $slug,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$id, $slug];
    }

    /** @param array<string,string> $headers */
    private function probe(array $headers, string $uri): TestResponse
    {
        TenantContext::reset();

        return $this->getJson('http://localhost' . $uri, array_merge(
            ['Accept' => 'application/json'],
            $headers
        ));
    }

    /** @param array<string,string> $headers @param array<string,mixed> $body */
    private function submit(array $headers, string $uri, array $body): TestResponse
    {
        TenantContext::reset();

        return $this->postJson('http://localhost' . $uri, $body, array_merge(
            ['Accept' => 'application/json'],
            $headers
        ));
    }

    protected function tearDown(): void
    {
        unset($_SERVER['HTTP_X_TENANT_SLUG'], $_SERVER['HTTP_X_TENANT_ID']);
        TenantContext::reset();
        parent::tearDown();
    }

    /**
     * THE HARM (read shape): naming a community that does not exist must not be
     * answered with the master community's configuration.
     */
    public function test_an_unknown_community_name_in_the_header_is_refused(): void
    {
        [$realId, $realSlug] = $this->createCommunity('e074a-real');

        // CONTROL FIRST: the header must genuinely work for a real community,
        // or the refusal below would prove nothing.
        $control = $this->probe(['X-Tenant-Slug' => $realSlug], '/api/v2/tenant/bootstrap');
        $controlBody = json_decode((string) $control->getContent(), true);
        $this->assertSame(
            200,
            $control->getStatusCode(),
            'INCONCLUSIVE: a real community name in X-Tenant-Slug was not served.'
        );
        $this->assertSame(
            $realId,
            $controlBody['data']['id'] ?? null,
            'INCONCLUSIVE: X-Tenant-Slug did not resolve the real community it named.'
        );

        // THE HARM: the same header naming a community that does not exist.
        $bogus = 'e074a-no-such-community-' . bin2hex(random_bytes(4));
        $refused = $this->probe(['X-Tenant-Slug' => $bogus], '/api/v2/tenant/bootstrap');
        $refusedBody = json_decode((string) $refused->getContent(), true);

        $this->assertNotSame(
            self::MASTER_TENANT_ID,
            $refusedBody['data']['id'] ?? null,
            'A community name that does not exist was served the MASTER community '
            . '(tenant 1) instead of being refused — F-443 / residual of F-035.'
        );
        $this->assertSame(
            400,
            $refused->getStatusCode(),
            'An unknown X-Tenant-Slug must be refused, as an unknown X-Tenant-ID already is.'
        );
        $this->assertSame(
            'INVALID_TENANT',
            $refusedBody['errors'][0]['code'] ?? null,
            'The refusal must carry the resolver\'s own invalid-community code.'
        );
    }

    /**
     * THE HARM (write shape): a sign-up addressed to a community that does not
     * exist must create no account at all.
     *
     * Control: the same payload naming a REAL community still creates the
     * account, in that community.
     */
    public function test_a_signup_naming_a_community_that_does_not_exist_creates_no_account(): void
    {
        [$realId, $realSlug] = $this->createCommunity('e074a-regreal');

        // No live DNS from a security test: bind a validator that always reports
        // the address deliverable. It does not touch the property under test
        // (which community, if any, the account lands in).
        $this->app->bind(\App\Services\MxRecordValidator::class, static function () {
            return new class extends \App\Services\MxRecordValidator {
                public function isResolvable(string $email): bool
                {
                    return true;
                }

                public function resolveState(string $email): string
                {
                    return self::STATE_RESOLVABLE;
                }
            };
        });

        $password = 'Qx7!vTn2#Lp9zR4w';
        $payload = static fn (string $email): array => [
            'name' => 'E074A Probe',
            'first_name' => 'E074A',
            'last_name' => 'Probe',
            'email' => $email,
            'password' => $password,
            'password_confirmation' => $password,
            'terms_accepted' => true,
            'accept_terms' => true,
            'location' => 'Testville',
            'phone' => '+1 555 123 4567',
        ];

        $controlEmail = 'e074a-control-' . bin2hex(random_bytes(5)) . '@example.test';
        $attackEmail = 'e074a-attack-' . bin2hex(random_bytes(5)) . '@example.test';

        // CONTROL FIRST.
        $control = $this->submit(['X-Tenant-Slug' => $realSlug], '/api/v2/auth/register', $payload($controlEmail));
        $controlRow = DB::table('users')->where('email', $controlEmail)->first(['id', 'tenant_id']);

        $this->assertNotNull(
            $controlRow,
            'INCONCLUSIVE: the control sign-up created no account, so nothing can be concluded. Body: '
            . mb_substr((string) $control->getContent(), 0, 300)
        );
        $this->assertSame(
            $realId,
            (int) $controlRow->tenant_id,
            'INCONCLUSIVE: the control sign-up did not land in the community it named.'
        );

        // THE HARM.
        $attack = $this->submit(['X-Tenant-Slug' => 'e074a-gone-' . bin2hex(random_bytes(4))], '/api/v2/auth/register', $payload($attackEmail));
        $attackRow = DB::table('users')->where('email', $attackEmail)->first(['id', 'tenant_id']);

        $this->assertNull(
            $attackRow,
            'A sign-up naming a community that does not exist created an account in community '
            . (string) ($attackRow->tenant_id ?? '?') . ' (the master community is 1).'
        );
        $this->assertNotSame(
            201,
            $attack->getStatusCode(),
            'A sign-up naming a community that does not exist must not be answered "registration successful".'
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL for the fallback itself.
     *
     * Step 5 exists to serve the root, the platform's own login/about pages and
     * master-domain usage. Closing the unknown-slug hole must NOT remove it, so
     * a request that names no community at all must still be served the master
     * community.
     */
    public function test_a_request_naming_no_community_still_reaches_the_master_community(): void
    {
        $response = $this->probe([], '/api/v2/tenant/bootstrap');
        $body = json_decode((string) $response->getContent(), true);

        $this->assertSame(200, $response->getStatusCode(), 'The platform fallback must still serve the root.');
        $this->assertSame(
            self::MASTER_TENANT_ID,
            $body['data']['id'] ?? null,
            'The master-community fallback (step 5) must survive the F-443 fix.'
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL: the numeric header is untouched by this fix.
     */
    public function test_a_real_community_id_in_the_numeric_header_still_resolves(): void
    {
        [$realId] = $this->createCommunity('e074a-numeric');

        $response = $this->probe(['X-Tenant-ID' => (string) $realId], '/api/v2/tenant/bootstrap');
        $body = json_decode((string) $response->getContent(), true);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame($realId, $body['data']['id'] ?? null);
    }
}
