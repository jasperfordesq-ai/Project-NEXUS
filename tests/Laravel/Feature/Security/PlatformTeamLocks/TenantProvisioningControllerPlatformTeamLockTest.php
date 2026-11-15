<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * The provisioning queue: requests for a new community. Approving one creates
 * a community anywhere in the tree. The page moved to the Platform team panel
 * in phase 2. The public side (submitting a request, checking a name, the
 * status page) is a different controller and stays open; it is pinned below.
 */
final class TenantProvisioningControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'the queue' => ['GET', '/v2/super-admin/provisioning-requests'],
            'one request' => ['GET', '/v2/super-admin/provisioning-requests/999999999'],
            'approve' => ['POST', '/v2/super-admin/provisioning-requests/999999999/approve', 'refusal-only'],
            'reject' => ['POST', '/v2/super-admin/provisioning-requests/999999999/reject', 'refusal-only'],
            'retry' => ['POST', '/v2/super-admin/provisioning-requests/999999999/retry', 'refusal-only'],
        ];
    }

    public function test_checking_a_community_name_stays_open_to_a_signed_out_visitor(): void
    {
        $status = $this->apiGet('/v2/provisioning-requests/check-slug/a-name-nobody-has-taken')->getStatusCode();

        $this->assertNotContains($status, [401, 403], "the public name check must stay open, got {$status}");
    }
}
