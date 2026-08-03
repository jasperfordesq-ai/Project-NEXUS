<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Mutual Match Email Template - Modern Theme Polish
 *
 * Sent when a reciprocal exchange opportunity is detected.
 * Follows full theme standards from EmailTemplateBuilder.
 *
 * Variables:
 * - $userName: Recipient's display name
 * - $match: Array with match data (title, user_name, listing_id, match_score)
 * - $reciprocalInfo: Array with they_offer and you_offer descriptions
 * - $tenantName: Organization name
 */

use App\Core\TenantContext;
use App\Core\Env;

// Theme colors - Mutual match uses green/teal gradient
$primaryColor = '#10b981';
$primaryDark = '#059669';
$accentColor = '#06b6d4';
$blueColor = '#3b82f6';
$textColor = '#374151';
$textMuted = '#6b7280';
$bgColor = '#f0fdf9';
$cardBg = '#ffffff';
$borderColor = '#a7f3d0';

$tenantName = $tenantName ?? __('emails.common.fallback_tenant_name');
$userName = $userName ?? __('emails.common.fallback_name');
$appUrl = TenantContext::getFrontendUrl();
$basePath = TenantContext::getSlugPrefix();
$year = date('Y');

$listingUrl = $appUrl . $basePath . '/listings/' . ($match['listing_id'] ?? $match['id'] ?? 0);
$matchesUrl = $appUrl . $basePath . '/matches?type=mutual';
$settingsUrl = $appUrl . $basePath . '/matches/preferences';

$posterName = $match['user_name'] ?? $match['first_name'] ?? __('emails.common.fallback_someone');
$listingTitle = $match['title'] ?? __('emails.common.fallback_their_listing');
$theyOffer = $reciprocalInfo['they_offer'] ?? __('emails.common.fallback_they_offer');
$youOffer = $reciprocalInfo['you_offer'] ?? __('emails.common.fallback_you_offer');
// Only show a compatibility score when one was actually computed —
// never fabricate a default percentage.
$matchScore = isset($match['match_score']) ? (int) $match['match_score'] : null;
?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
    <title><?= __('emails.match_mutual.title') ?></title>
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
            .exchange-box { display: block !important; width: 100% !important; }
        }

        /* Dark mode */
        @media (prefers-color-scheme: dark) {
            .email-bg { background-color: #0a1f1a !important; }
            .card-bg { background-color: #134e4a !important; }
            .text-primary { color: #f0fdfa !important; }
            .text-secondary { color: #99f6e4 !important; }
            .border-light { border-color: #2dd4bf !important; }
            .exchange-card { background-color: #1e3a3a !important; border-color: #2dd4bf !important; }
            .info-box { background-color: #1e3a3a !important; }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: <?= $bgColor ?>;">

    <!-- Preview text -->
    <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
        <?= $matchScore !== null
            ? __('emails.match_mutual.preview', ['name' => htmlspecialchars($posterName), 'score' => $matchScore])
            : __('emails.match_mutual.title') ?>
        &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
    </div>

    <!-- Email wrapper -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: <?= $bgColor ?>;" class="email-bg">
        <tr>
            <td style="padding: 40px 10px;">

                <!-- Email container -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center" class="email-container" style="margin: auto;">

                    <!-- Header with mutual gradient -->
                    <tr>
                        <td style="background-color: <?= $primaryColor ?>; background-image: linear-gradient(135deg, <?= $primaryColor ?> 0%, <?= $accentColor ?> 100%); padding: 40px 40px 50px; text-align: center; border-radius: 16px 16px 0 0;">
                            <!-- Handshake emoji with glow effect -->
                            <div style="width: 80px; height: 80px; margin: 0 auto 20px; background: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                                <span style="font-size: 42px; line-height: 1;">&#129309;</span>
                            </div>
                            <h1 style="margin: 0; font-size: 32px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;"><?= __('emails.match_mutual.heading') ?></h1>
                            <p style="margin: 12px 0 0; font-size: 18px; color: rgba(255,255,255,0.95); font-weight: 500;">
                                <?= __('emails.match_mutual.subheading') ?>
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
                                            <?= __('emails.match_mutual.greeting', ['name' => htmlspecialchars($userName)]) ?>
                                        </p>
                                        <p style="margin: 15px 0 0; font-size: 16px; line-height: 1.7; color: <?= $textMuted ?>;" class="text-secondary">
                                            <?= __('emails.match_mutual.intro', ['color' => $primaryColor, 'partner' => htmlspecialchars($posterName)]) ?>
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <?php if ($matchScore !== null): ?>
                            <!-- Match Score Badge -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 0 40px 25px; text-align: center;" class="mobile-padding">
                                        <div style="display: inline-block; background-color: <?= $primaryColor ?>; background-image: linear-gradient(135deg, <?= $primaryColor ?>, <?= $accentColor ?>); color: white; padding: 12px 28px; border-radius: 30px; font-weight: 800; font-size: 18px; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
                                            &#129309; <?= $matchScore ?>% <?= __('emails.match_mutual.match_label') ?>
                                        </div>
                                    </td>
                                </tr>
                            </table>
                            <?php endif; ?>

                            <!-- Exchange Visualization -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 0 40px 30px;" class="mobile-padding">

                                        <!-- They can help you -->
                                        <div class="exchange-card" style="background-color: #ecfdf5; background-image: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 2px solid <?= $primaryColor ?>; border-radius: 16px; padding: 24px; margin-bottom: 12px; position: relative;">
                                            <!-- Arrow badge -->
                                            <div style="position: absolute; top: -12px; left: 24px; background: <?= $primaryColor ?>; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 700;">
                                                <?= __('emails.match_mutual.they_offer') ?>
                                            </div>
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                <tr>
                                                    <td width="50" style="vertical-align: top;">
                                                        <div style="width: 44px; height: 44px; background: <?= $primaryColor ?>; border-radius: 50%; text-align: center; line-height: 44px; font-size: 20px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                                                            <span style="color: white;">&#11015;</span>
                                                        </div>
                                                    </td>
                                                    <td style="padding-left: 16px; vertical-align: middle;">
                                                        <p style="margin: 0 0 6px; font-size: 13px; color: <?= $textMuted ?>; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                                                            <?= __('emails.match_mutual.can_help_you', ['name' => htmlspecialchars($posterName)]) ?>
                                                        </p>
                                                        <p style="margin: 0; font-size: 20px; color: <?= $primaryDark ?>; font-weight: 700; line-height: 1.3;">
                                                            <?= htmlspecialchars($theyOffer) ?>
                                                        </p>
                                                    </td>
                                                </tr>
                                            </table>
                                        </div>

                                        <!-- Exchange Arrow -->
                                        <div style="text-align: center; margin: 8px 0;">
                                            <div style="display: inline-block; background: #f1f5f9; border-radius: 20px; padding: 8px 16px;">
                                                <span style="font-size: 24px; color: <?= $textMuted ?>;">&#8693;</span>
                                            </div>
                                        </div>

                                        <!-- You can help them -->
                                        <div class="exchange-card" style="background-color: #eff6ff; background-image: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 2px solid <?= $blueColor ?>; border-radius: 16px; padding: 24px; position: relative;">
                                            <!-- Arrow badge -->
                                            <div style="position: absolute; top: -12px; left: 24px; background: <?= $blueColor ?>; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 700;">
                                                <?= __('emails.match_mutual.you_offer') ?>
                                            </div>
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                <tr>
                                                    <td width="50" style="vertical-align: top;">
                                                        <div style="width: 44px; height: 44px; background: <?= $blueColor ?>; border-radius: 50%; text-align: center; line-height: 44px; font-size: 20px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);">
                                                            <span style="color: white;">&#11014;</span>
                                                        </div>
                                                    </td>
                                                    <td style="padding-left: 16px; vertical-align: middle;">
                                                        <p style="margin: 0 0 6px; font-size: 13px; color: <?= $textMuted ?>; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                                                            <?= __('emails.match_mutual.you_can_help', ['name' => htmlspecialchars($posterName)]) ?>
                                                        </p>
                                                        <p style="margin: 0; font-size: 20px; color: #1d4ed8; font-weight: 700; line-height: 1.3;">
                                                            <?= htmlspecialchars($youOffer) ?>
                                                        </p>
                                                    </td>
                                                </tr>
                                            </table>
                                        </div>

                                    </td>
                                </tr>
                            </table>

                            <!-- Why Mutual Matches Matter -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 0 40px 30px;" class="mobile-padding">
                                        <div class="info-box" style="background-color: #fefce8; background-image: linear-gradient(135deg, #fefce8 0%, #fef9c3 100%); border: 1px solid #fde047; border-radius: 12px; padding: 18px 20px; text-align: center;">
                                            <p style="margin: 0; font-size: 15px; color: <?= $textColor ?>; line-height: 1.6;">
                                                &#128161; <strong style="color: #ca8a04;"><?= __('emails.match_mutual.rare_notice') ?></strong>
                                            </p>
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
                                                <td class="button-td" style="border-radius: 12px; background-color: <?= $primaryColor ?>; background-image: linear-gradient(135deg, <?= $primaryColor ?> 0%, <?= $accentColor ?> 100%); box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
                                                    <a href="<?= $listingUrl ?>" style="display: inline-block; padding: 18px 44px; font-size: 17px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 12px;"><?= __('emails.match_mutual.connect_with', ['name' => htmlspecialchars($posterName)]) ?> &#8594;</a>
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
                                            <?= __('emails.common.or_separator') ?> <a href="<?= $matchesUrl ?>" style="color: <?= $primaryColor ?>; font-weight: 600;"><?= __('emails.match_mutual.view_all_mutual') ?></a>
                                        </p>
                                    </td>
                                </tr>
                            </table>

                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #ecfdf5; padding: 30px 40px; border-radius: 0 0 16px 16px; border-top: 1px solid <?= $borderColor ?>;" class="mobile-padding">
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
                                            <?= __('emails.match_mutual.receiving_notice') ?>
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="text-align: center;">
                                        <a href="<?= $settingsUrl ?>" style="color: <?= $textMuted ?>; text-decoration: underline; font-size: 13px;"><?= __('emails.match_mutual.manage_preferences') ?></a>
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
