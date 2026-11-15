<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * The Prerender engine is a Platform team page. Every endpoint that changes
 * something is tested for refusal only: its success path queues renders or
 * deletes snapshots. The machine paths into `invalidate` (bearer token, HMAC
 * signature) are covered in AdminPrerenderControllerTest and must keep working.
 */
final class AdminPrerenderControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'summary' => ['GET', '/v2/admin/prerender/summary'],
            'inventory' => ['GET', '/v2/admin/prerender/inventory'],
            'inspect' => ['GET', '/v2/admin/prerender/inspect', 'refusal-only'],
            'coverage' => ['GET', '/v2/admin/prerender/coverage'],
            'tenant safety' => ['GET', '/v2/admin/prerender/tenant-safety', 'refusal-only'],
            'events' => ['GET', '/v2/admin/prerender/events'],
            'failures' => ['GET', '/v2/admin/prerender/failures'],
            'jobs' => ['GET', '/v2/admin/prerender/jobs'],
            'one job' => ['GET', '/v2/admin/prerender/jobs/999999'],
            'enqueue' => ['POST', '/v2/admin/prerender/jobs', 'refusal-only'],
            'cancel a job' => ['POST', '/v2/admin/prerender/jobs/999999/cancel', 'refusal-only'],
            'retry a job' => ['POST', '/v2/admin/prerender/jobs/999999/retry', 'refusal-only'],
            'purge' => ['POST', '/v2/admin/prerender/purge', 'refusal-only'],
            'purge unexpected' => ['POST', '/v2/admin/prerender/purge-unexpected', 'refusal-only'],
            'analytics' => ['GET', '/v2/admin/prerender/analytics'],
            'auto recache' => ['POST', '/v2/admin/prerender/auto-recache', 'refusal-only'],
            'detect drift' => ['POST', '/v2/admin/prerender/detect-drift', 'refusal-only'],
            'metrics' => ['GET', '/v2/admin/prerender/metrics'],
            'realtime channel' => ['GET', '/v2/admin/prerender/realtime-channel'],
            'health' => ['GET', '/v2/admin/prerender/health'],
            'audit' => ['GET', '/v2/admin/prerender/audit'],
            'reset breaker' => ['POST', '/v2/admin/prerender/reset-breaker', 'refusal-only'],
            'reset queue' => ['POST', '/v2/admin/prerender/reset-queue', 'refusal-only'],
            'reset all' => ['POST', '/v2/admin/prerender/reset-all', 'refusal-only'],
            'export' => ['GET', '/v2/admin/prerender/export/audit.csv', 'refusal-only'],
            'ttl inspector' => ['GET', '/v2/admin/prerender/ttl-inspector', 'refusal-only'],
            'sitemap explorer' => ['GET', '/v2/admin/prerender/sitemap-explorer', 'refusal-only'],
        ];
    }

    /**
     * `invalidate` has three ways in. Without the machine token or signature it
     * falls back to the signed-in caller, and answers 401 (not 403) when that
     * caller is not the platform team.
     */
    public function test_invalidate_without_a_token_admits_only_the_signed_in_platform_team(): void
    {
        config(['prerender.webhook_token' => 'a-token-nobody-sends']);
        $body = ['tenant_id' => $this->testTenantId, 'routes' => ['/about'], 'recache' => false];

        $this->actAsCommunityAdmin();
        $this->apiPost('/v2/admin/prerender/invalidate', $body)->assertStatus(401);

        $this->actAsGlobalSuperAdminNotOnTeam();
        $this->apiPost('/v2/admin/prerender/invalidate', $body)->assertStatus(401);

        $this->actAsGodWithoutSuperAdmin();
        $this->apiPost('/v2/admin/prerender/invalidate', $body)->assertStatus(401);

        $this->actAsPlatformTeam();
        $status = $this->apiPost('/v2/admin/prerender/invalidate', $body)->getStatusCode();
        $this->assertNotContains($status, [401, 403]);
    }
}
