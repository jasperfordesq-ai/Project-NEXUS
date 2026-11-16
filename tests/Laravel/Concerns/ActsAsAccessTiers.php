<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Concerns;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

/**
 * The four accounts every platform-team lock is tested against (E-128).
 *
 * An endpoint that belongs to the platform team must refuse the first three
 * and admit the fourth. Testing only "an admin is refused" is how a lock that
 * admits a global super admin, or an account with `is_god` alone, looks
 * finished: each of those is a different check failing in a different way.
 *
 * For a test class extending Tests\Laravel\TestCase with DatabaseTransactions.
 */
trait ActsAsAccessTiers
{
    /** @param array<string, mixed> $attributes */
    protected function actAsTier(array $attributes): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    protected function actAsCommunityAdmin(): User
    {
        return $this->actAsTier(['role' => 'admin']);
    }

    protected function actAsGlobalSuperAdminNotOnTeam(): User
    {
        return $this->actAsTier(['is_super_admin' => true, 'role' => 'super_admin']);
    }

    protected function actAsGodWithoutSuperAdmin(): User
    {
        return $this->actAsTier(['is_god' => true]);
    }

    protected function actAsPlatformTeam(): User
    {
        return $this->actAsTier(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
    }

    /** @param array<string, mixed> $payload */
    protected function requestAs(string $method, string $uri, array $payload = []): TestResponse
    {
        return match (strtoupper($method)) {
            'GET' => $this->apiGet($uri),
            'POST' => $this->apiPost($uri, $payload),
            'PUT' => $this->apiPut($uri, $payload),
            'DELETE' => $this->apiDelete($uri, $payload),
            default => throw new \InvalidArgumentException("Unsupported method {$method}"),
        };
    }

    /**
     * The endpoint refuses, with 403, every tier below the platform team.
     *
     * On its own for an endpoint whose success path must not run in a test (it
     * starts a job, sends mail, touches files) or sits behind a second gate the
     * test actor cannot pass; otherwise use assertPlatformTeamOnly().
     *
     * @param array<string, mixed> $payload
     */
    protected function assertRefusedBelowPlatformTeam(string $method, string $uri, array $payload = []): void
    {
        $refused = [
            'a community admin' => fn () => $this->actAsCommunityAdmin(),
            'a global super admin who is not on the platform team' => fn () => $this->actAsGlobalSuperAdminNotOnTeam(),
            'an account with is_god but not super admin' => fn () => $this->actAsGodWithoutSuperAdmin(),
            // Added 16 Nov 2026 (review): the logic refused these, but no test said so.
            'a tenant super admin' => fn () => $this->actAsTier(['role' => 'admin', 'is_tenant_super_admin' => true]),
            'a broker' => fn () => $this->actAsTier(['role' => 'broker']),
            'a member' => fn () => $this->actAsTier(['role' => 'member']),
        ];

        foreach ($refused as $who => $become) {
            $become();
            $response = $this->requestAs($method, $uri, $payload);
            $status = $response->getStatusCode();
            $this->assertSame(403, $status, "{$method} {$uri} must refuse {$who} with 403, got {$status}");
            // A 403 from the second-factor step would pass the line above
            // without the endpoint's own lock ever being asked.
            $this->assertStringNotContainsString(
                \App\Http\Middleware\RequireRecentSecondFactor::ERROR_CODE,
                (string) $response->getContent(),
                "{$method} {$uri} refused {$who} at the second-factor step, not at the platform-team lock"
            );
        }
    }

    /**
     * The endpoint refuses everyone but the platform team with 403, and does
     * not refuse the platform team (it may still answer 404 or 422 for the
     * made-up input a lock test sends: only 401 and 403 mean "refused").
     *
     * @param array<string, mixed> $payload
     */
    protected function assertPlatformTeamOnly(string $method, string $uri, array $payload = []): void
    {
        $this->assertRefusedBelowPlatformTeam($method, $uri, $payload);

        $this->actAsPlatformTeam();
        $status = $this->requestAs($method, $uri, $payload)->getStatusCode();
        $this->assertNotContains(
            $status,
            [401, 403],
            "{$method} {$uri} must admit the platform team, got {$status}"
        );
        $this->assertLessThan(500, $status, "{$method} {$uri} failed for the platform team with {$status}");
    }
}
