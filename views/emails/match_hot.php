<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Hot Match Email Template - Modern Theme Polish
 *
 * Sent when a high-compatibility match (85%+) is found.
 * Follows full theme standards from EmailTemplateBuilder.
 *
 * Variables:
 * - $userName: Recipient's display name
 * - $match: Array with match data (title, user_name, match_score, distance_km, category_name, match_reasons, listing_id)
 * - $tenantName: Organization name
 */

use App\Core\TenantContext;
use App\Core\Env;

// Theme colors - Hot match uses orange/red gradient
$primaryColor = '#f97316';
$primaryDark = '#ea580c';
$accentColor = '#ef4444';
$successColor = '#10b981';
$textColor = '#374151';
$textMuted = '#6b7280';
$bgColor = '#fef7f0';
$cardBg = '#ffffff';
$borderColor = '#fed7aa';

$tenantName = $tenantName ?? __('emails.common.fallback_tenant_name');
$userName = $userName ?? __('emails.common.fallback_name');
$appUrl = TenantContext::getFrontendUrl();
$basePath = TenantContext::getSlugPrefix();
$year = date('Y');

$listingUrl = $appUrl . $basePath . '/listings/' . ($match['listing_id'] ?? $match['id'] ?? 0);
$matchesUrl = $appUrl . $basePath . '/matches';
$settingsUrl = $appUrl . $basePath . '/matches/preferences';

$matchScore = (int)($match['match_score'] ?? 85);
$distance = $match['distance_km'] ?? null;
$reasons = $match['match_reasons'] ?? [];
$categoryName = $match['category_name'] ?? '';
$listingTitle = $match['title'] ?? __('emails.common.fallback_listing');
$posterName = $match['user_name'] ?? $match['first_name'] ?? __('emails.common.fallback_someone');
$listingTypeKey = ($match['type'] ?? 'offer') === 'request' ? 'request' : 'offer';
$listingType = __('emails.common.listing_type_' . $listingTypeKey);

// Distance label
$distanceLabel = '';
if ($distance !== null) {
    if ($distance <= 2) {
        $distanceLabel = __('emails.match_hot.walking_distance');
    } elseif ($distance <= 10) {
        $distanceLabel = __('emails.match_hot.nearby');
    } elseif ($distance <= 25) {
        $distanceLabel = __('emails.match_hot.in_your_area');
    } else {
        $distanceLabel = __('emails.match_hot.regional');
    }
}
?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
    <title><?= __('emails.match_hot.title') ?></title>
    <!--[if mso]>
    <noscript>
        <xml>
            <o:OfficeDocumentSettings>
                <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
        </xml>
    </noscript>
    <![endif]-->
    <style type="text/css">
        /* Reset */
        body, table, td, p, a, li, blockquote { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
        body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: <?= $bgColor ?>; }

        /* Typography */
        body, table, td, a { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }

        /* Links */
        a { color: <?= $primaryColor ?>; text-decoration: underline; }
        a:hover { color: <?= $primaryDark ?>; }

        /* Button hover */
        .button-td:hover { background-color: <?= $primaryDark ?> !important; transform: translateY(-1px); }

        /* Responsive */
        @media screen and (max-width: 600px) {
            .email-container { width: 100% !important; max-width: 100% !important; }
            .fluid { width: 100% !important; max-width: 100% !important; height: auto !important; }
            .stack-column { display: block !important; width: 100% !important; max-width: 100% !important; }
            .mobile-padding { padding-left: 20px !important; padding-right: 20px !important; }
            .mobile-center { text-align: center !important; }
            .hide-mobile { display: none !important; }
        }

        /* Dark mode */
        @media (prefers-color-scheme: dark) {
            .email-bg { background-color: #1c1917 !important; }
            .card-bg { background-color: #292524 !important; }
            .text-primary { color: #f5f5f4 !important; }
            .text-secondary { color: #a8a29e !important; }
            .border-light { border-color: #44403c !important; }
            .match-card { background-color: #44403c !important; border-color: #57534e !important; }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: <?= $bgColor ?>;">

    <!-- Preview text -->
    <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
        <?= __('emails.match_hot.preview', ['score' => $matchScore, 'name' => htmlspecialchars($posterName), 'title' => htmlspecialchars($listingTitle)]) ?><?= $distance !== null ? ' - ' . $distanceLabel : '' ?>
        &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
    </div>

    <!-- Email wrapper -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: <?= $bgColor ?>;" class="email-bg">
        <tr>
            <td style="padding: 40px 10px;">

                <!-- Email container -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center" class="email-container" style="margin: auto;">

                    <!-- Header with hot gradient -->
                    <tr>
                        <td style="background-color: <?= $primaryColor ?>; background-image: linear-gradient(135deg, <?= $primaryColor ?> 0%, <?= $accentColor ?> 100%); padding: 40px 40px 50px; text-align: center; border-radius: 16px 16px 0 0;">
                            <!-- Fire emoji with glow effect -->
                            <div style="width: 80px; height: 80px; margin: 0 auto 20px; background: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                                <span style="font-size: 42px; line-height: 1;">&#128293;</span>
                            </div>
                            <h1 style="margin: 0; font-size: 32px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;"><?= __('emails.match_hot.heading') ?></h1>
                            <p style="margin: 12px 0 0; font-size: 18px; color: rgba(255,255,255,0.95); font-weight: 500;">
                                <strong style="font-size: 24px;"><?= $matchScore ?>%</strong> <?= __('emails.match_hot.compatibility_score') ?>
                            </p>
                        </td>
                    </tr>

                    <!-- Main content -->
                    <tr>
                        <td style="background-color: <?= $cardBg ?>; padding: 0;" class="card-bg">

                            <!-- Greeting -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 35px 40px 20px;" class="mobile-padding">
                                        <p style="margin: 0; font-size: 18px; line-height: 1.6; color: <?= $textColor ?>;" class="text-primary">
                                            <?= __('emails.match_hot.greeting', ['name' => htmlspecialchars($userName)]) ?>
                                        </p>
                                        <p style="margin: 15px 0 0; font-size: 16px; line-height: 1.7; color: <?= $textMuted ?>;" class="text-secondary">
                                            <?= __('emails.match_hot.intro', ['color' => $accentColor]) ?>
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Match Card -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 10px 40px 30px;" class="mobile-padding">
                                        <div class="match-card" style="background-color: #fffbeb; background-image: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border: 2px solid <?= $primaryColor ?>; border-radius: 16px; overflow: hidden; position: relative;">

                                            <!-- Score badge -->
                                            <div style="position: absolute; top: 16px; right: 16px; background-color: <?= $primaryColor ?>; background-image: linear-gradient(135deg, <?= $primaryColor ?>, <?= $accentColor ?>); color: white; padding: 8px 16px; border-radius: 24px; font-weight: 800; font-size: 15px; box-shadow: 0 4px 12px rgba(249, 115, 22, 0.4);">
                                                &#128293; <?= $matchScore ?>%
                                            </div>

                                            <!-- Card content -->
                                            <div style="padding: 28px;">
                                                <!-- Type badge -->
                                                <div style="margin-bottom: 12px;">
                                                    <span style="display: inline-block; background: <?= $listingTypeKey === 'offer' ? '#dcfce7' : '#dbeafe' ?>; color: <?= $listingTypeKey === 'offer' ? '#16a34a' : '#2563eb' ?>; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                                                        <?= $listingType ?>
                                                    </span>
                                                </div>

                                                <!-- Title -->
                                                <h2 style="margin: 0 0 10px; font-size: 22px; font-weight: 700; color: <?= $textColor ?>; line-height: 1.3; padding-right: 80px;">
                                                    <?= htmlspecialchars($listingTitle) ?>
                                                </h2>

                                                <!-- Posted by -->
                                                <p style="margin: 0 0 20px; font-size: 15px; color: <?= $primaryColor ?>; font-weight: 600;">
                                                    <?= __('emails.match_hot.posted_by', ['name' => htmlspecialchars($posterName)]) ?>
                                                </p>

                                                <!-- Meta info row -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <?php if ($distance !== null): ?>
                                                        <td style="padding-right: 20px; vertical-align: middle;">
                                                            <div style="display: inline-block; background: rgba(16, 185, 129, 0.15); color: <?= $successColor ?>; padding: 8px 14px; border-radius: 10px; font-size: 14px; font-weight: 600;">
                                                                &#128205; <?= number_format($distance, 1) ?> km &middot; <?= $distanceLabel ?>
                                                            </div>
                                                        </td>
                                                        <?php endif; ?>
                                                        <?php if ($categoryName): ?>
                                                        <td style="vertical-align: middle;">
                                                            <div style="display: inline-block; background: rgba(99, 102, 241, 0.1); color: #6366f1; padding: 8px 14px; border-radius: 10px; font-size: 14px; font-weight: 600;">
                                                                &#127991; <?= htmlspecialchars($categoryName) ?>
                                                            </div>
                                                        </td>
                                                        <?php endif; ?>
                                                    </tr>
                                                </table>

                                                <?php if (!empty($reasons)): ?>
                                                <!-- Match reasons -->
                                                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid <?= $borderColor ?>;">
                                                    <p style="margin: 0 0 10px; font-size: 13px; color: <?= $textMuted ?>; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;"><?= __('emails.match_hot.why_matches') ?></p>
                                                    <p style="margin: 0; font-size: 15px; color: <?= $textColor ?>; line-height: 1.6;">
                                                        <?= htmlspecialchars(implode(' &bull; ', array_slice($reasons, 0, 3))) ?>
                                                    </p>
                                                </div>
                                                <?php endif; ?>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            </table>

                            <!-- CTA Button -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 10px 40px 20px; text-align: center;" class="mobile-padding">
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
                                            <tr>
                                                <td class="button-td" style="border-radius: 12px; background-color: <?= $primaryColor ?>; background-image: linear-gradient(135deg, <?= $primaryColor ?> 0%, <?= $accentColor ?> 100%); box-shadow: 0 4px 14px rgba(249, 115, 22, 0.4);">
                                                    <a href="<?= $listingUrl ?>" style="display: inline-block; padding: 18px 44px; font-size: 17px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 12px;"><?= __('emails.match_hot.view_match') ?> &#8594;</a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>

                            <!-- Secondary link -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 0 40px 35px; text-align: center;" class="mobile-padding">
                                        <p style="margin: 0; font-size: 14px; color: <?= $textMuted ?>;" class="text-secondary">
                                            <?= __('emails.common.or_separator') ?> <a href="<?= $matchesUrl ?>" style="color: <?= $primaryColor ?>; font-weight: 600;"><?= __('emails.match_hot.view_all_matches') ?></a>
                                        </p>
                                    </td>
                                </tr>
                            </table>

                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #fef3e8; padding: 30px 40px; border-radius: 0 0 16px 16px; border-top: 1px solid <?= $borderColor ?>;" class="mobile-padding">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="text-align: center; padding-bottom: 15px;">
                                        <p style="margin: 0; font-size: 14px; font-weight: 600; color: <?= $textColor ?>;">
                                            <?= htmlspecialchars($tenantName) ?>
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="text-align: center; padding-bottom: 15px;">
                                        <p style="margin: 0; font-size: 13px; color: <?= $textMuted ?>; line-height: 1.6;">
                                            <?= __('emails.match_hot.receiving_notice') ?>
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="text-align: center;">
                                        <a href="<?= $settingsUrl ?>" style="color: <?= $textMuted ?>; text-decoration: underline; font-size: 13px;"><?= __('emails.match_hot.manage_preferences') ?></a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                </table>

                <!-- Copyright -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center" class="email-container" style="margin: auto;">
                    <tr>
                        <td style="padding: 20px; text-align: center;">
                            <p style="margin: 0; font-size: 12px; color: <?= $textMuted ?>;">
                                &copy; <?= $year ?> <?= htmlspecialchars($tenantName) ?>. <?= __('emails.footer.all_rights_reserved') ?>
                            </p>
                        </td>
                    </tr>
                </table>

            </td>
        </tr>
    </table>

</body>
</html>
