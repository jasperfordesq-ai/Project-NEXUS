<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * Registration policy is a Platform team page: joining methods, identity
 * checks and the keys for identity check services. Invite codes and resuming
 * paused sign-ups share the controller and stay open: they are on Settings,
 * which every community admin has.
 */
final class RegistrationPolicyControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'read the policy' => ['GET', '/v2/admin/config/registration-policy'],
            'save the policy' => ['PUT', '/v2/admin/config/registration-policy', 'refusal-only'],
            'identity providers' => ['GET', '/v2/admin/identity/providers'],
            'provider keys' => ['GET', '/v2/admin/identity/provider-credentials'],
            'save provider keys' => ['PUT', '/v2/admin/identity/provider-credentials/no-such-provider', 'refusal-only'],
            'delete provider keys' => ['DELETE', '/v2/admin/identity/provider-credentials/no-such-provider', 'refusal-only'],
        ];
    }

    public function test_invite_codes_stay_open_to_a_community_admin(): void
    {
        $this->assertCommunityAdminReaches('GET', '/v2/admin/invite-codes');
    }

    public function test_the_sign_up_pause_status_stays_open_to_a_community_admin(): void
    {
        $this->assertCommunityAdminReaches('GET', '/v2/admin/registration/breaker');
    }
}
