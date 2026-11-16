<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * Enterprise dashboard, Roles and permissions, Permissions list and Monitoring
 * are Platform team pages. Monitoring, health and requirements describe the
 * server the whole platform runs on (F-624, O-155).
 */
final class AdminEnterpriseControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'dashboard' => ['GET', '/v2/admin/enterprise/dashboard'],
            'roles' => ['GET', '/v2/admin/enterprise/roles'],
            'create a role' => ['POST', '/v2/admin/enterprise/roles', 'refusal-only'],
            'read a role' => ['GET', '/v2/admin/enterprise/roles/999999'],
            'update a role' => ['PUT', '/v2/admin/enterprise/roles/999999', 'refusal-only'],
            'delete a role' => ['DELETE', '/v2/admin/enterprise/roles/999999', 'refusal-only'],
            'permissions' => ['GET', '/v2/admin/enterprise/permissions'],
            'monitoring' => ['GET', '/v2/admin/enterprise/monitoring'],
            'health check' => ['GET', '/v2/admin/enterprise/monitoring/health'],
            'health history' => ['GET', '/v2/admin/enterprise/monitoring/health-history'],
            'activity errors' => ['GET', '/v2/admin/enterprise/monitoring/logs'],
            'log files' => ['GET', '/v2/admin/enterprise/monitoring/log-files'],
            'read a log file' => ['GET', '/v2/admin/enterprise/monitoring/log-files/no-such-file.log'],
            'download a log file' => ['GET', '/v2/admin/enterprise/monitoring/log-files/no-such-file.log/download'],
            'clear a log file' => ['DELETE', '/v2/admin/enterprise/monitoring/log-files/no-such-file.log', 'refusal-only'],
            'requirements' => ['GET', '/v2/admin/enterprise/monitoring/requirements'],
            // F-626: no screen calls it; it admitted any global super admin.
            'secrets list' => ['GET', '/v2/admin/enterprise/config/secrets'],
            // F-627: no screen calls it; it told any community admin whether
            // DB_HOST, REDIS_HOST and PUSHER_KEY are set on the server.
            'secrets vault check' => ['POST', '/v2/admin/enterprise/config/secrets/test-vault'],
        ];
    }

    /**
     * F-627: rotate and delete change nothing, but answered any community
     * admin. They sit behind the second-factor step, which refuses first in a
     * test, so the step is switched off here to reach the controller's own lock.
     *
     * @return array<string, array{0: string, 1: string}>
     */
    public static function lockedBehindStepUp(): array
    {
        return [
            'rotate a secret' => ['POST', '/v2/admin/enterprise/config/secrets/FCM_SERVER_KEY/rotate'],
            'delete a secret' => ['DELETE', '/v2/admin/enterprise/config/secrets/FCM_SERVER_KEY'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('lockedBehindStepUp')]
    public function test_the_secret_routes_behind_the_second_factor_step_answer_the_platform_team_only(string $method, string $uri): void
    {
        $this->withoutMiddleware(\App\Http\Middleware\RequireRecentSecondFactor::class);

        $this->assertPlatformTeamOnly($method, $uri);
    }

    /**
     * F-626: the list said whether each server key is set, and also sent the
     * first and last two characters of the real value. Now it says only
     * whether it is set.
     */
    public function test_the_secrets_list_never_sends_any_part_of_a_value(): void
    {
        $name = 'FCM_SERVER_KEY';
        $before = getenv($name);
        $planted = 'ZQXJ4489PLMNwvut7731';
        putenv("{$name}={$planted}");

        try {
            $this->actAsPlatformTeam();
            $response = $this->apiGet('/v2/admin/enterprise/config/secrets')->assertStatus(200);
        } finally {
            putenv($before === false ? $name : "{$name}={$before}");
        }

        $rows = $response->json('data');
        $this->assertIsArray($rows);
        $this->assertNotEmpty($rows);
        $found = false;
        foreach ($rows as $row) {
            $keys = array_keys($row);
            sort($keys);
            $this->assertSame(['category', 'is_set', 'key'], $keys);
            $this->assertArrayNotHasKey('masked_value', $row);
            if ($row['key'] === $name) {
                $found = true;
                $this->assertTrue($row['is_set']);
            }
        }
        $this->assertTrue($found, "{$name} is not in the list");

        $body = (string) $response->getContent();
        for ($i = 0; $i + 4 <= strlen($planted); $i++) {
            $this->assertStringNotContainsString(substr($planted, $i, 4), $body);
        }
    }
}
