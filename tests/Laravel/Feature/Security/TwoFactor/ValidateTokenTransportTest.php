<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use App\Services\TokenService;

/** F-010 — a session token must never travel in the URL, where proxies and CDNs log it. */
class ValidateTokenTransportTest extends TwoFactorAuditTestCase
{
    public function test_validate_token_ignores_the_query_string(): void
    {
        $member = $this->member();
        $token = app(TokenService::class)->generateToken($member->id, $member->tenant_id, []);

        // A token in the URL is ignored entirely: the server sees "no token", never "valid".
        $viaQuery = $this->apiGet('/auth/validate-token?token=' . $token);
        $this->assertContains($viaQuery->status(), [400, 401]);
        $this->assertNotSame(true, $viaQuery->json('valid'));

        $viaPostQuery = $this->apiPost('/auth/validate-token?token=' . $token, []);
        $this->assertContains($viaPostQuery->status(), [400, 401]);

        // The supported transports still work.
        $this->apiPost('/auth/validate-token', ['token' => $token])->assertOk();
        $this->apiGet('/auth/validate-token', ['Authorization' => 'Bearer ' . $token])->assertOk();
    }
}
