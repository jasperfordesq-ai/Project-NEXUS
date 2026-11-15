<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * One file per controller (E-128): the endpoints behind a page in the Platform
 * team panel refuse everyone below the platform team.
 *
 * Until E-128 most of these were hidden in the admin menu and nothing more:
 * the API answered any community admin (F-623, F-624). Each subclass lists
 * the endpoints that are locked, and — where an endpoint in the same
 * controller is deliberately left open because a screen that stays in the
 * admin panel calls it — pins that too, so a later change cannot lock it by
 * accident.
 *
 * `locked()` rows are [method, uri] or [method, uri, 'refusal-only']. Use
 * 'refusal-only' when the success path must not run in a test: it starts a
 * job, sends mail, touches files, or sits behind the second-factor step.
 */
abstract class PlatformTeamLockTestCase extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    /** @return array<string, array{0: string, 1: string, 2?: string}> */
    abstract public static function locked(): array;

    #[DataProvider('locked')]
    public function test_only_the_platform_team_may_call(string $method, string $uri, string $mode = 'full'): void
    {
        if ($mode === 'refusal-only') {
            $this->assertRefusedBelowPlatformTeam($method, $uri);

            return;
        }

        $this->assertPlatformTeamOnly($method, $uri);
    }

    /** A community admin is not refused: for endpoints deliberately left open. */
    protected function assertCommunityAdminReaches(string $method, string $uri): void
    {
        $this->actAsCommunityAdmin();
        $status = $this->requestAs($method, $uri)->getStatusCode();

        $this->assertNotContains($status, [401, 403], "{$method} {$uri} must stay open to a community admin, got {$status}");
    }
}
