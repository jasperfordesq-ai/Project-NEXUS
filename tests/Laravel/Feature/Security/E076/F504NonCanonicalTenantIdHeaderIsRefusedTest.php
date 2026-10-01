<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E076;

use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\TestCase;

/**
 * E-076 F-504 — an `X-Tenant-ID` header that is "numeric" to PHP but is not a
 * whole community number must be REFUSED, not truncated to a different
 * community.
 *
 * The defect: `TenantContext::resolve()` step 2 gated on `is_numeric()` and then
 * cast with `(int)`. `is_numeric()` accepts decimals and exponent notation, and
 * the cast truncates, so `1.9` and `1e0` were served — and could sign up in —
 * community 1, the MASTER community. F-479 fixed the side of the same test that
 * refuses (a value that is not numeric at all); this is the side that accepts.
 *
 * These tests assert the CORRECT behaviour and therefore fail before the fix.
 * Legitimate-access controls in the same file:
 *   - a real whole-number id still resolves to that community (integer control);
 *   - an unknown whole number is still refused `400 INVALID_TENANT`;
 *   - a real slug in `X-Tenant-Slug` still resolves (slug control);
 *   - a request naming no community, or an EMPTY header, still reaches the
 *     master community.
 */
final class F504NonCanonicalTenantIdHeaderIsRefusedTest extends TestCase
{
    use DatabaseTransactions;

    private const MASTER_TENANT_ID = 1;

    /** @return array{0:int,1:string} */
    private function createCommunity(string $prefix): array
    {
        $slug = $prefix . '-' . bin2hex(random_bytes(4));
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'E076 F504 ' . $slug,
            'slug' => $slug,
            'is_active' => 1,
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

    protected function tearDown(): void
    {
        unset($_SERVER['HTTP_X_TENANT_SLUG'], $_SERVER['HTTP_X_TENANT_ID']);
        TenantContext::reset();
        parent::tearDown();
    }

    /**
     * THE HARM (read shape): values PHP calls numeric but which are not a
     * whole community number must be refused, never truncated.
     */
    public function test_a_numeric_but_non_integer_community_id_is_refused(): void
    {
        [$realId] = $this->createCommunity('e076f504-real');

        // INTEGER CONTROL: a real whole-number id resolves to that community.
        $control = $this->probe(['X-Tenant-ID' => (string) $realId]);
        $this->assertSame(200, $control->getStatusCode(), 'INCONCLUSIVE: a real community id was not served.');
        $this->assertSame($realId, $control->json('data.id'), 'INCONCLUSIVE: X-Tenant-ID did not resolve its community.');

        // COMPARATOR: an unknown whole number already fails closed.
        $unknown = $this->probe(['X-Tenant-ID' => '987654321']);
        $this->assertSame(400, $unknown->getStatusCode(), 'INCONCLUSIVE: unknown numeric ids are no longer refused.');
        $this->assertSame('INVALID_TENANT', $unknown->json('errors.0.code'));

        foreach (['1.9', '1e0', '1.0', '+1', (string) $realId . '.5'] as $value) {
            $response = $this->probe(['X-Tenant-ID' => $value]);

            $this->assertNotSame(
                self::MASTER_TENANT_ID,
                $response->json('data.id'),
                "X-Tenant-ID '{$value}' was truncated and served the MASTER community (F-504)."
            );
            $this->assertNotSame(
                $realId,
                $response->json('data.id'),
                "X-Tenant-ID '{$value}' was truncated and served community {$realId} (F-504)."
            );
            $this->assertSame(
                400,
                $response->getStatusCode(),
                "X-Tenant-ID '{$value}' is not a whole community number and must be refused."
            );
            $this->assertSame('INVALID_TENANT', $response->json('errors.0.code'));
        }
    }

    /**
     * THE HARM (write shape): a sign-up whose header is `1.9` creates no account.
     * Control: the same payload with a real whole-number id creates the account
     * in that community.
     */
    public function test_a_signup_with_a_truncatable_community_id_creates_no_account(): void
    {
        [$realId] = $this->createCommunity('e076f504-signup');

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
            'name' => 'E076 F504 Probe',
            'first_name' => 'E076',
            'last_name' => 'Probe',
            'email' => $email,
            'password' => $password,
            'password_confirmation' => $password,
            'terms_accepted' => true,
            'accept_terms' => true,
            'location' => 'Testville',
            'phone' => '+1 555 123 4567',
        ];

        $controlEmail = 'e076f504-control-' . bin2hex(random_bytes(5)) . '@example.test';
        $attackEmail = 'e076f504-attack-' . bin2hex(random_bytes(5)) . '@example.test';

        TenantContext::reset();
        $control = $this->postJson('http://localhost/api/v2/auth/register', $payload($controlEmail), [
            'Accept' => 'application/json',
            'X-Tenant-ID' => (string) $realId,
        ]);
        $controlRow = DB::table('users')->where('email', $controlEmail)->first(['tenant_id']);
        $this->assertNotNull(
            $controlRow,
            'INCONCLUSIVE: the control sign-up created no account. Body: ' . mb_substr((string) $control->getContent(), 0, 300)
        );
        $this->assertSame($realId, (int) $controlRow->tenant_id);

        TenantContext::reset();
        $attack = $this->postJson('http://localhost/api/v2/auth/register', $payload($attackEmail), [
            'Accept' => 'application/json',
            'X-Tenant-ID' => '1.9',
        ]);
        $attackRow = DB::table('users')->where('email', $attackEmail)->first(['tenant_id']);

        $this->assertNull(
            $attackRow,
            'A sign-up with X-Tenant-ID 1.9 created an account in community '
            . (string) ($attackRow->tenant_id ?? '?') . ' (the master community is 1).'
        );
        $this->assertNotSame(201, $attack->getStatusCode());
    }

    /**
     * LEGITIMATE-ACCESS CONTROLS: the slug header, an absent header and an empty
     * header are untouched by the fix.
     */
    public function test_slug_absent_and_empty_headers_still_resolve(): void
    {
        [$realId, $realSlug] = $this->createCommunity('e076f504-slug');

        $slug = $this->probe(['X-Tenant-Slug' => $realSlug]);
        $this->assertSame(200, $slug->getStatusCode());
        $this->assertSame($realId, $slug->json('data.id'));

        $none = $this->probe([]);
        $this->assertSame(200, $none->getStatusCode());
        $this->assertSame(self::MASTER_TENANT_ID, $none->json('data.id'));

        $empty = $this->probe(['X-Tenant-ID' => '']);
        $this->assertSame(200, $empty->getStatusCode());
        $this->assertSame(self::MASTER_TENANT_ID, $empty->json('data.id'));
    }
}
