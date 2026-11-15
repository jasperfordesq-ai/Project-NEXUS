<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * Pilot inquiries: organisations asking to pilot the platform. The page was
 * shown to global super admins only, but its endpoints answered ANY community
 * admin (F-623). It moved to the Platform team panel in phase 2.
 *
 * The public enquiry form (`POST /v2/pilot-inquiry`) is in the same
 * controller and stays open to a signed-out visitor; it is pinned below.
 */
final class PilotInquiryControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'the list' => ['GET', '/v2/admin/pilot-inquiries'],
            'pipeline figures' => ['GET', '/v2/admin/pilot-inquiries/stats'],
            'export' => ['GET', '/v2/admin/pilot-inquiries/export'],
            'one inquiry' => ['GET', '/v2/admin/pilot-inquiries/999999999'],
            'change the stage' => ['POST', '/v2/admin/pilot-inquiries/999999999/stage', 'refusal-only'],
            'assign' => ['POST', '/v2/admin/pilot-inquiries/999999999/assign', 'refusal-only'],
            'notes' => ['POST', '/v2/admin/pilot-inquiries/999999999/notes', 'refusal-only'],
        ];
    }

    public function test_the_public_enquiry_form_stays_open_to_a_signed_out_visitor(): void
    {
        // An empty form is refused for what it lacks, not for who sent it.
        $status = $this->apiPost('/v2/pilot-inquiry', [])->getStatusCode();

        $this->assertNotContains($status, [401, 403], "the public enquiry form must stay open, got {$status}");
    }
}
