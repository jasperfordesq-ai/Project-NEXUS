<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Core;

use PHPUnit\Framework\TestCase;

/**
 * Email and notification links must open a page that exists.
 *
 * An audit of every link the platform emails (27 October 2026) walked each one
 * in the React app and found these shapes opening "Page not found" or an admin
 * page that was retired. Each one is pinned here so it cannot come back: the
 * React app has no route for them (react-frontend/src/routes/AppRoutes.tsx,
 * admin/routes.tsx), and links already sent are caught by
 * react-frontend/src/components/routing/EmailLinkRedirects.tsx where possible.
 */
class EmailLinkTargetsExistTest extends TestCase
{
    /** @return array<string, array{0: string, 1: string, 2: string}> */
    public static function fixedLinks(): array
    {
        return [
            'safeguarding review reminder' => [
                'app/Console/Commands/SafeguardingReviewFlagsCommand.php',
                "tenantUrl('/settings/safeguarding')",
                "tenantUrl('/settings?tab=safeguarding')",
            ],
            'identity check failed: try again' => [
                'app/Services/Identity/IdentityVerificationSessionService.php',
                "\$basePath . '/settings/security'",
                "\$basePath . '/verify-identity'",
            ],
            'organisation wallet low balance' => [
                'app/Services/BalanceAlertService.php',
                "'/volunteer-org/wallet'",
                "'/volunteering/org/' . \$organizationId . '/dashboard?tab=wallet'",
            ],
            'marketplace offer received / declined' => [
                'app/Services/MarketplaceOfferService.php',
                "'/marketplace/listings/'",
                "'/marketplace/' . \$listingId,",
            ],
            'marketplace counter-offer' => [
                'app/Services/MarketplaceOfferService.php',
                "'/marketplace/offers',",
                "'/marketplace/my-offers',",
            ],
            'marketplace report filed (staff)' => [
                'app/Services/MarketplaceReportService.php',
                "'/admin/marketplace/reports/'",
                "'/admin/marketplace/cases'",
            ],
            'feed report filed (staff)' => [
                'app/Http/Controllers/Api/FeedController.php',
                "'/admin/reports',",
                "'/broker/moderation/reports',",
            ],
            'listing report filed (staff)' => [
                'app/Http/Controllers/Api/ListingsController.php',
                "'/admin/reports',",
                "'/broker/moderation/reports',",
            ],
            'social content report filed (staff)' => [
                'app/Http/Controllers/Api/SocialController.php',
                "'/admin/reports',",
                "'/broker/moderation/reports',",
            ],
            'member concern reported (staff)' => [
                'app/Services/MemberConcernReportService.php',
                "'/admin/reports',",
                "'/broker/moderation/reports', // admin",
            ],
            'identity result for admins' => [
                'app/Services/NotificationDispatcher.php',
                '"/admin/members"',
                '"/admin/users"',
            ],
            'safeguarding assignment' => [
                'app/Services/GuardianArrangementService.php',
                "'/admin/safeguarding'",
                "'/broker/safeguarding'",
            ],
            'federation connection request' => [
                'app/Services/FederationEmailService.php',
                "tenantUrl('/network')",
                "tenantUrl('/federation/connections')",
            ],
            'federation partnership request (staff)' => [
                'app/Services/FederationEmailService.php',
                "tenantUrl('/admin/federation')",
                "tenantUrl('/partner-timebanks/partnerships')",
            ],
            'volunteering card in messages' => [
                'app/Services/ContextualMessageService.php',
                "'/volunteering/' . \$row->id",
                "'/volunteering/opportunities/' . \$row->id",
            ],
        ];
    }

    /** @dataProvider fixedLinks */
    public function test_email_link_opens_a_real_page(string $file, string $deadShape, string $liveShape): void
    {
        $source = file_get_contents(dirname(__DIR__, 4) . '/' . $file);
        $this->assertIsString($source);

        $this->assertStringNotContainsString($deadShape, $source, "{$file} links to a page that does not exist");
        $this->assertStringContainsString($liveShape, $source, "{$file} no longer links where the audit pointed it");
    }
}
