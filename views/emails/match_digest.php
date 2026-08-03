<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Match Digest Email Template - Modern Theme Polish
 *
 * Sent as a periodic digest (daily/weekly) of new matches.
 * Follows full theme standards from EmailTemplateBuilder.
 *
 * Variables:
 * - $userName: Recipient's display name
 * - $matches: Array of match data (title, user_name, match_score, distance_km, listing_id, match_type)
 * - $period: 'daily' or 'weekly'
 * - $stats: Array with hotCount, mutualCount, totalCount
 * - $tenantName: Organization name
 */

use App\Core\TenantContext;
use App\Core\Env;

// Theme colors - Digest uses purple/indigo gradient
$primaryColor = '#6366f1';
$primaryDark = '#4f46e5';
$accentColor = '#8b5cf6';
$hotColor = '#f97316';
$mutualColor = '#10b981';
$textColor = '#374151';
$textMuted = '#6b7280';
$bgColor = '#f5f3ff';
$cardBg = '#ffffff';
$borderColor = '#c4b5fd';

$tenantName = $tenantName ?? __('emails.common.fallback_tenant_name');
$userName = $userName ?? __('emails.common.fallback_name');
$appUrl = TenantContext::getFrontendUrl();
$basePath = TenantContext::getSlugPrefix();
$year = date('Y');

$matchesUrl = $appUrl . $basePath . '/matches';
$settingsUrl = $appUrl . $basePath . '/settings?tab=notifications';

$period = $period ?? 'fortnightly';
$knownPeriods = ['daily' => 'day', 'weekly' => 'week', 'fortnightly' => 'fortnight', 'monthly' => 'month'];
$periodTitle = isset($knownPeriods[$period]) ? __('emails.match_digest.period_title_' . $period) : ucfirst($period);
$periodLabel = isset($knownPeriods[$period]) ? __('emails.match_digest.period_' . $knownPeriods[$period]) : $period;
$totalCount = count($matches);
$hotCount = $stats['hotCount'] ?? count(array_filter($matches, fn($m) => ($m['match_score'] ?? 0) >= 85));
$mutualCount = $stats['mutualCount'] ?? count(array_filter($matches, fn($m) => ($m['match_type'] ?? '') === 'mutual'));

// Limit displayed matches
$displayMatches = array_slice($matches, 0, 5);
$remainingCount = max(0, $totalCount - 5);
?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
    <title><?= __('emails.match_digest.title', ['period' => $periodTitle]) ?></title>
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

        /* Match card hover */
        .match-row:hover { background-color: #f1f5f9 !important; }

        /* Responsive */
        @media screen and (max-width: 600px) {
            .email-container { width: 100% !important; max-width: 100% !important; }
            .fluid { width: 100% !important; max-width: 100% !important; height: auto !important; }
            .stack-column { display: block !important; width: 100% !important; max-width: 100% !important; }
            .mobile-padding { padding-left: 20px !important; padding-right: 20px !important; }
            .mobile-center { text-align: center !important; }
            .hide-mobile { display: none !important; }
            .stat-box { display: block !important; width: 100% !important; margin-bottom: 12px !important; padding-right: 0 !important; padding-left: 0 !important; }
        }

        /* Dark mode */
        @media (prefers-color-scheme: dark) {
            .email-bg { background-color: #1e1b4b !important; }
            .card-bg { background-color: #312e81 !important; }
            .text-primary { color: #e0e7ff !important; }
            .text-secondary { color: #a5b4fc !important; }
            .border-light { border-color: #4f46e5 !important; }
            .match-card { background-color: #3730a3 !important; }
            .stat-card { background-color: #3730a3 !important; border-color: #4f46e5 !important; }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: <?= $bgColor ?>;">

    <!-- Preview text -->
    <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
        <?= __('emails.match_digest.preview_new_matches', ['count' => $totalCount, 'period' => $periodLabel]) ?><?= $hotCount > 0 ? ' ' . __('emails.match_digest.preview_hot', ['count' => $hotCount]) : '' ?><?= $mutualCount > 0 ? ' ' . __('emails.match_digest.preview_mutual', ['count' => $mutualCount]) : '' ?>
        &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
    </div>

    <!-- Email wrapper -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: <?= $bgColor ?>;" class="email-bg">
        <tr>
            <td style="padding: 40px 10px;">

                <!-- Email container -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center" class="email-container" style="margin: auto;">

                    <!-- Header with purple gradient -->
                    <tr>
                        <td style="background-color: <?= $primaryColor ?>; background-image: linear-gradient(135deg, <?= $primaryColor ?> 0%, <?= $accentColor ?> 100%); padding: 40px 40px 50px; text-align: center; border-radius: 16px 16px 0 0;">
                            <!-- Chart emoji with glow effect -->
                            <div style="width: 80px; height: 80px; margin: 0 auto 20px; background: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                                <span style="font-size: 42px; line-height: 1;">&#128202;</span>
                            </div>
                            <h1 style="margin: 0; font-size: 32px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;"><?= __('emails.match_digest.heading', ['period' => $periodTitle]) ?></h1>
                            <p style="margin: 12px 0 0; font-size: 18px; color: rgba(255,255,255,0.95); font-weight: 500;">
                                <?= __('emails.match_digest.new_matches_waiting', ['count' => $totalCount]) ?>
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
                                            <?= __('emails.match_digest.greeting', ['name' => htmlspecialchars($userName)]) ?>
                                        </p>
                                        <p style="margin: 15px 0 0; font-size: 16px; line-height: 1.7; color: <?= $textMuted ?>;" class="text-secondary">
                                            <?= __('emails.match_digest.intro', ['period' => $periodLabel]) ?>
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Stats Summary -->
                            <?php if ($hotCount > 0 || $mutualCount > 0): ?>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 5px 40px 30px;" class="mobile-padding">
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                            <tr>
                                                <?php if ($hotCount > 0): ?>
                                                <td class="stat-box" style="width: <?= $mutualCount > 0 ? '50%' : '100%' ?>; padding-right: <?= $mutualCount > 0 ? '8px' : '0' ?>; vertical-align: top;">
                                                    <div class="stat-card" style="background-color: #fff7ed; background-image: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%); border: 2px solid #fdba74; border-radius: 14px; padding: 20px; text-align: center;">
                                                        <div style="font-size: 36px; font-weight: 800; color: <?= $hotColor ?>; line-height: 1;">
                                                            &#128293; <?= $hotCount ?>
                                                        </div>
                                                        <div style="font-size: 14px; color: #c2410c; margin-top: 8px; font-weight: 600;"><?= __('emails.match_digest.hot_matches') ?></div>
                                                        <div style="font-size: 12px; color: <?= $textMuted ?>; margin-top: 4px;"><?= __('emails.match_digest.hot_compatibility') ?></div>
                                                    </div>
                                                </td>
                                                <?php endif; ?>
                                                <?php if ($mutualCount > 0): ?>
                                                <td class="stat-box" style="width: <?= $hotCount > 0 ? '50%' : '100%' ?>; padding-left: <?= $hotCount > 0 ? '8px' : '0' ?>; vertical-align: top;">
                                                    <div class="stat-card" style="background-color: #ecfdf5; background-image: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 2px solid #6ee7b7; border-radius: 14px; padding: 20px; text-align: center;">
                                                        <div style="font-size: 36px; font-weight: 800; color: <?= $mutualColor ?>; line-height: 1;">
                                                            &#129309; <?= $mutualCount ?>
                                                        </div>
                                                        <div style="font-size: 14px; color: #059669; margin-top: 8px; font-weight: 600;"><?= __('emails.match_digest.mutual_matches') ?></div>
                                                        <div style="font-size: 12px; color: <?= $textMuted ?>; margin-top: 4px;"><?= __('emails.match_digest.win_win') ?></div>
                                                    </div>
                                                </td>
                                                <?php endif; ?>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <?php endif; ?>

                            <!-- Top Matches Section -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 0 40px 30px;" class="mobile-padding">
                                        <h3 style="margin: 0 0 18px; font-size: 14px; font-weight: 700; color: <?= $textMuted ?>; text-transform: uppercase; letter-spacing: 1px;">
                                            &#11088; <?= __('emails.match_digest.top_matches') ?>
                                        </h3>

                                        <?php foreach ($displayMatches as $index => $match):
                                            $score = (int)($match['match_score'] ?? 0);
                                            $isHot = $score >= 85;
                                            $isMutual = ($match['match_type'] ?? '') === 'mutual';
                                            $scoreColor = $isHot ? $hotColor : ($isMutual ? $mutualColor : ($score >= 70 ? $primaryColor : $textMuted));
                                            $scoreBg = $isHot ? '#fff7ed' : ($isMutual ? '#ecfdf5' : ($score >= 70 ? '#eef2ff' : '#f8fafc'));
                                            $listingUrl = $appUrl . $basePath . '/listings/' . ($match['listing_id'] ?? $match['id'] ?? 0);
                                            $distance = $match['distance_km'] ?? null;
                                            $isLast = $index === count($displayMatches) - 1;
                                        ?>
                                        <div class="match-card" style="background: <?= $scoreBg ?>; border-radius: 12px; padding: 18px 20px; margin-bottom: <?= $isLast ? '0' : '12px' ?>; border-left: 4px solid <?= $scoreColor ?>; transition: background-color 0.2s ease;">
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                <tr>
                                                    <td style="vertical-align: top;">
                                                        <p style="margin: 0 0 6px; font-size: 17px; font-weight: 700; color: <?= $textColor ?>; line-height: 1.3;">
                                                            <a href="<?= $listingUrl ?>" style="color: <?= $textColor ?>; text-decoration: none;"><?= htmlspecialchars($match['title'] ?? __('emails.common.fallback_listing')) ?></a>
                                                        </p>
                                                        <p style="margin: 0; font-size: 14px; color: <?= $textMuted ?>; line-height: 1.4;">
                                                            <?= __('emails.match_digest.by_author', ['name' => '<span style="color: ' . $primaryColor . '; font-weight: 600;">' . htmlspecialchars(!empty($match['user_name']) ? $match['user_name'] : __('emails.match_digest.a_member')) . '</span>']) ?>
                                                            <?php if ($distance !== null): ?>
                                                                <span style="color: #d1d5db;">&bull;</span> <?= number_format($distance, 1) ?> km
                                                            <?php endif; ?>
                                                        </p>
                                                    </td>
                                                    <td width="85" style="text-align: right; vertical-align: middle;">
                                                        <div style="display: inline-block; background: <?= $scoreColor ?>; color: white; padding: 8px 14px; border-radius: 24px; font-weight: 800; font-size: 14px; white-space: nowrap; box-shadow: 0 2px 8px <?= $isHot ? 'rgba(249, 115, 22, 0.3)' : ($isMutual ? 'rgba(16, 185, 129, 0.3)' : 'rgba(99, 102, 241, 0.2)') ?>;">
                                                            <?php if ($isHot): ?>&#128293;<?php elseif ($isMutual): ?>&#129309;<?php endif; ?>
                                                            <?= $score ?>%
                                                        </div>
                                                    </td>
                                                </tr>
                                            </table>
                                        </div>
                                        <?php endforeach; ?>

                                        <?php if ($remainingCount > 0): ?>
                                        <div style="text-align: center; margin-top: 18px;">
                                            <span style="display: inline-block; background: #e0e7ff; color: <?= $primaryDark ?>; padding: 10px 20px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                                                <?= __('emails.match_digest.more_matches', ['count' => $remainingCount]) ?>
                                            </span>
                                        </div>
                                        <?php endif; ?>
                                    </td>
                                </tr>
                            </table>

                            <!-- CTA Button -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 10px 40px 20px; text-align: center;" class="mobile-padding">
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
                                            <tr>
                                                <td class="button-td" style="border-radius: 12px; background-color: <?= $primaryColor ?>; background-image: linear-gradient(135deg, <?= $primaryColor ?> 0%, <?= $accentColor ?> 100%); box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">
                                                    <a href="<?= $matchesUrl ?>" style="display: inline-block; padding: 18px 44px; font-size: 17px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 12px;"><?= __('emails.match_digest.view_all_matches') ?> &#8594;</a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>

                            <!-- Secondary links -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 0 40px 35px; text-align: center;" class="mobile-padding">
                                        <p style="margin: 0; font-size: 14px; color: <?= $textMuted ?>;" class="text-secondary">
                                            <?php if ($hotCount > 0): ?>
                                                <a href="<?= $matchesUrl ?>?type=hot" style="color: <?= $hotColor ?>; font-weight: 600;"><?= __('emails.match_digest.hot_matches_link') ?></a>
                                                <span style="color: #d1d5db; margin: 0 8px;">&bull;</span>
                                            <?php endif; ?>
                                            <?php if ($mutualCount > 0): ?>
                                                <a href="<?= $matchesUrl ?>?type=mutual" style="color: <?= $mutualColor ?>; font-weight: 600;"><?= __('emails.match_digest.mutual_matches_link') ?></a>
                                                <span style="color: #d1d5db; margin: 0 8px;">&bull;</span>
                                            <?php endif; ?>
                                            <a href="<?= $matchesUrl ?>" style="color: <?= $primaryColor ?>; font-weight: 600;"><?= __('emails.match_digest.all_matches_link') ?></a>
                                        </p>
                                    </td>
                                </tr>
                            </table>

                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #ede9fe; padding: 30px 40px; border-radius: 0 0 16px 16px; border-top: 1px solid <?= $borderColor ?>;" class="mobile-padding">
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
                                            <?= __('emails.match_digest.receiving_digest', ['period' => $periodTitle]) ?>
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="text-align: center;">
                                        <a href="<?= $settingsUrl ?>" style="color: <?= $textMuted ?>; text-decoration: underline; font-size: 13px;"><?= __('emails.match_digest.manage_frequency') ?></a>
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
