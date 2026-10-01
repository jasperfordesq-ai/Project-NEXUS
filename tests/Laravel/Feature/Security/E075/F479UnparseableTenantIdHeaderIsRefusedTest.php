<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\TestCase;

/**
 * E-075 F-479 — an `X-Tenant-ID` header that is present but is not a number
 * must be REFUSED, not silently ignored and served the master community.
 *
 * The defect: `TenantContext::resolve()` step 2 opens with
 * `if ($headerTenantId !== null && is_numeric($headerTenantId))`. A value that
 * is present but unparseable skips the whole branch — including all four of its
 * refusals — and execution reaches step 5's master-community fallback. A
 * sign-up addressed to a community the header cannot name was therefore created
 * in the MASTER community and answered `201 Registration successful`: exactly
 * F-443's harm, reached through the sibling header that F-443's own fix comment
 * cited as already failing closed.
 *
 * Realistic trigger beyond an attacker: `web-uk/src/lib/api.js:133-134` sets
 * this header from an unvalidated environment variable (`TENANT_ID`) whose
 * adjacent sibling on the previous line is a **slug**
 * (`ACCESSIBLE_TENANT_SLUG`). A one-character configuration mistake between two
 * adjacent variables would send a slug in the numeric header.
 *
 * These tests assert the CORRECT behaviour and therefore fail before the fix.
 * The legitimate-access controls live in the same file and differ from the harm
 * case only in the property under test:
 *   - a real numeric id in the same header still resolves to that community;
 *   - an unknown but NUMERIC id is still refused `400 INVALID_TENANT` (the
 *     comparator — the numeric branch already fails closed);
 *   - a real slug in `X-Tenant-Slug` still resolves;
 *   - a community's custom domain still resolves;
 *   - a request naming NO community at all still reaches the master community,
 *     so a fix that simply deleted step 5's fallback would fail too.
 */
final class F479UnparseableTenantIdHeaderIsRefusedTest extends TestCase
{
    use DatabaseTransactions;

    private const MASTER_TENANT_ID = 1;

    /** @return array{0:int,1:string} */
    private function createCommunity(string $prefix, ?string $domain = null): array
    {
        $slug = $prefix . '-' . bin2hex(random_bytes(4));
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'E075 F479 ' . $slug,
            'slug' => $slug,
            'domain' => $domain,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$id, $slug];
    }

    /**
     * @param array<string,string> $headers
     */
    private function probe(array $headers, string $uri, string $host = 'localhost'): TestResponse
    {
        TenantContext::reset();

        return $this->getJson('http://' . $host . $uri, array_merge(
            ['Accept' => 'application/json'],
            $headers
        ));
    }

    /**
     * @param array<string,string> $headers
     * @param array<string,mixed> $body
     */
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
     * THE HARM (read shape), with the comparator beside it: a community
     * identifier the numeric header cannot parse must be refused in exactly the
     * way an unknown but numeric one already is.
     */
    public function test_a_community_id_that_is_not_a_number_is_refused(): void
    {
        [$realId, $realSlug] = $this->createCommunity('e075f479-real');

        // CONTROL 1: the numeric header genuinely works for a real community.
        $control = $this->probe(['X-Tenant-ID' => (string) $realId], '/api/v2/tenant/bootstrap');
        $controlBody = json_decode((string) $control->getContent(), true);
        $this->assertSame(
            200,
            $control->getStatusCode(),
            'INCONCLUSIVE: a real community id in X-Tenant-ID was not served.'
        );
        $this->assertSame(
            $realId,
            $controlBody['data']['id'] ?? null,
            'INCONCLUSIVE: X-Tenant-ID did not resolve the real community it named.'
        );

        // CONTROL 2 — THE COMPARATOR: an unknown but NUMERIC id already fails closed.
        $unknownNumeric = $this->probe(['X-Tenant-ID' => '987654321'], '/api/v2/tenant/bootstrap');
        $unknownNumericBody = json_decode((string) $unknownNumeric->getContent(), true);
        $this->assertSame(
            400,
            $unknownNumeric->getStatusCode(),
            'INCONCLUSIVE: the numeric branch no longer refuses an unknown community id.'
        );
        $this->assertSame(
            'INVALID_TENANT',
            $unknownNumericBody['errors'][0]['code'] ?? null,
            'INCONCLUSIVE: the numeric refusal no longer carries INVALID_TENANT.'
        );

        // THE HARM: the SAME header carrying a value it cannot parse — here the
        // real community's own slug, which is the web-uk misconfiguration shape.
        $refused = $this->probe(['X-Tenant-ID' => $realSlug], '/api/v2/tenant/bootstrap');
        $refusedBody = json_decode((string) $refused->getContent(), true);

        $this->assertNotSame(
            self::MASTER_TENANT_ID,
            $refusedBody['data']['id'] ?? null,
            'An X-Tenant-ID that names no community was served the MASTER community '
            . '(tenant 1) instead of being refused — sibling gap in the F-443 fix (F-479).'
        );
        $this->assertSame(
            400,
            $refused->getStatusCode(),
            'An X-Tenant-ID that is present but unparseable must be refused, as an '
            . 'unknown but numeric one already is.'
        );
        $this->assertSame(
            'INVALID_TENANT',
            $refusedBody['errors'][0]['code'] ?? null,
            'The refusal must carry the resolver\'s own invalid-community code.'
        );

        // And the same for a value that resembles nothing at all.
        $garbage = $this->probe(['X-Tenant-ID' => 'not-a-community-id'], '/api/v2/tenant/bootstrap');
        $this->assertSame(
            400,
            $garbage->getStatusCode(),
            'Any present-but-unparseable X-Tenant-ID must be refused, not ignored.'
        );
    }

    /**
     * THE HARM (write shape): a sign-up addressed to a community the header
     * cannot name must create no account at all.
     *
     * Control: the same payload naming a REAL community by numeric id still
     * creates the account, in that community.
     */
    public function test_a_signup_with_an_unparseable_community_id_creates_no_account(): void
    {
        [$realId, $realSlug] = $this->createCommunity('e075f479-signup');

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
            'name' => 'E075 F479 Probe',
            'first_name' => 'E075',
            'last_name' => 'Probe',
            'email' => $email,
            'password' => $password,
            'password_confirmation' => $password,
            'terms_accepted' => true,
            'accept_terms' => true,
            'location' => 'Testville',
            'phone' => '+1 555 123 4567',
        ];

        $controlEmail = 'e075f479-control-' . bin2hex(random_bytes(5)) . '@example.test';
        $attackEmail = 'e075f479-attack-' . bin2hex(random_bytes(5)) . '@example.test';

        // CONTROL FIRST.
        $control = $this->submit(
            ['X-Tenant-ID' => (string) $realId],
            '/api/v2/auth/register',
            $payload($controlEmail)
        );
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

        // THE HARM: the same community named in a way the header cannot parse.
        $attack = $this->submit(
            ['X-Tenant-ID' => $realSlug],
            '/api/v2/auth/register',
            $payload($attackEmail)
        );
        $attackRow = DB::table('users')->where('email', $attackEmail)->first(['id', 'tenant_id']);

        $this->assertNull(
            $attackRow,
            'A sign-up whose X-Tenant-ID names no community created an account in community '
            . (string) ($attackRow->tenant_id ?? '?') . ' (the master community is 1).'
        );
        $this->assertNotSame(
            201,
            $attack->getStatusCode(),
            'A sign-up whose X-Tenant-ID cannot be parsed must not be answered "registration successful".'
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL for the fallback itself.
     *
     * Step 5 exists to serve the root, the platform's own login/about pages and
     * master-domain usage. Closing this hole must NOT remove it: a request that
     * names no community at all — including one whose header is present but
     * EMPTY, which is how `web-uk` ships when `TENANT_ID` is unset — must still
     * be served the master community.
     */
    public function test_a_request_naming_no_community_still_reaches_the_master_community(): void
    {
        $none = $this->probe([], '/api/v2/tenant/bootstrap');
        $noneBody = json_decode((string) $none->getContent(), true);
        $this->assertSame(200, $none->getStatusCode(), 'The platform fallback must still serve the root.');
        $this->assertSame(
            self::MASTER_TENANT_ID,
            $noneBody['data']['id'] ?? null,
            'The master-community fallback (step 5) must survive the F-479 fix.'
        );

        $empty = $this->probe(['X-Tenant-ID' => ''], '/api/v2/tenant/bootstrap');
        $emptyBody = json_decode((string) $empty->getContent(), true);
        $this->assertSame(
            200,
            $empty->getStatusCode(),
            'An EMPTY X-Tenant-ID names no community and must keep behaving as absent.'
        );
        $this->assertSame(
            self::MASTER_TENANT_ID,
            $emptyBody['data']['id'] ?? null,
            'An empty X-Tenant-ID must not be treated as an unparseable community name.'
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL: the slug header is untouched by this fix.
     */
    public function test_a_real_community_slug_in_the_slug_header_still_resolves(): void
    {
        [$realId, $realSlug] = $this->createCommunity('e075f479-slug');

        $response = $this->probe(['X-Tenant-Slug' => $realSlug], '/api/v2/tenant/bootstrap');
        $body = json_decode((string) $response->getContent(), true);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame($realId, $body['data']['id'] ?? null);
    }

    /**
     * LEGITIMATE-ACCESS CONTROL: a community's own custom domain still resolves,
     * which is step 1 and must not be disturbed by a change to step 2.
     */
    public function test_a_community_custom_domain_still_resolves(): void
    {
        $domain = 'e075f479-' . bin2hex(random_bytes(4)) . '.example.org';
        [$realId] = $this->createCommunity('e075f479-domain', $domain);

        $response = $this->probe([], '/api/v2/tenant/bootstrap', $domain);
        $body = json_decode((string) $response->getContent(), true);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame($realId, $body['data']['id'] ?? null);
    }
}
