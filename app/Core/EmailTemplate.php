<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Core;

/**
 * Email template renderer.
 */
class EmailTemplate
{
    /**
     * Render a themed HTML email.
     *
     * @param string      $title      Main heading
     * @param string      $subtitle   Subheading
     * @param string      $body       Main content (supports HTML)
     * @param string|null $btnText    CTA button text (optional)
     * @param string|null $btnUrl     CTA button URL (optional)
     * @param string      $tenantName Name of the Timebank
     * @return string Valid HTML
     */
    public static function render(
        $title,
        $subtitle,
        $body,
        $btnText = null,
        $btnUrl = null,
        $tenantName = 'Project NEXUS'
    ): string {
        // Escape title/subtitle to prevent HTML injection from user-controlled values
        // (e.g., user names interpolated into subtitle). $body is intentionally HTML.
        $title = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
        $subtitle = htmlspecialchars($subtitle, ENT_QUOTES, 'UTF-8');
        $tenantName = htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8');

        // Theme colors
        $brandColor = '#6366f1';
        $brandColorDark = '#4f46e5';
        $textColor = '#374151';
        $mutedColor = '#6b7280';
        $bgColor = '#f3f4f6';

        // Year
        $year = date('Y');

        // Settings URL (frontend domain for user-facing links)
        $frontendUrl = TenantContext::getFrontendUrl();
        $basePath = TenantContext::getSlugPrefix();
        $settingsUrl = $frontendUrl . $basePath . '/notifications';

        // Translated footer/common strings
        $buttonFallbackText = __('emails.common.button_fallback');
        $allRightsReserved = __('emails.footer.all_rights_reserved');
        $memberNotice = __('emails.footer.member_notice', ['community' => $tenantName]);
        $managePreferences = __('emails.footer.manage_preferences');

        // Button HTML — sanitise caller-provided URL/text. Reject any URL
        // that isn't http(s) or mailto: so a caller cannot smuggle
        // javascript:/data:/vbscript: and turn the CTA into an XSS sink.
        $btnUrl  = self::sanitizeButtonUrl((string) $btnUrl);
        $btnText = htmlspecialchars((string) $btnText, ENT_QUOTES, 'UTF-8');
        $buttonHtml = '';
        if ($btnText && $btnUrl) {
            $buttonHtml = <<<HTML
                            <!-- CTA Button -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 30px 40px; text-align: center;" class="mobile-padding">
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
                                            <tr>
                                                <td style="border-radius: 10px; background-color: {$brandColor}; background-image: linear-gradient(135deg, {$brandColor} 0%, {$brandColorDark} 100%);" class="button-primary">
                                                    <a href="{$btnUrl}" style="display: inline-block; padding: 16px 32px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 10px;">{$btnText}</a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>

                            <!-- Fallback URL -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 0 40px 30px;" class="mobile-padding">
                                        <p style="margin: 0; font-size: 13px; color: {$mutedColor}; line-height: 1.6;" class="text-muted">
                                            {$buttonFallbackText}<br>
                                            <a href="{$btnUrl}" style="color: {$brandColor}; word-break: break-all;">{$btnUrl}</a>
                                        </p>
                                    </td>
                                </tr>
                            </table>
HTML;
        }

        return <<<HTML
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
    <title>{$title}</title>
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
        /* Reset styles */
        body, table, td, p, a, li, blockquote { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
        body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: {$bgColor}; }

        /* Typography */
        body, table, td, a { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }

        /* Link styles */
        a { color: {$brandColor}; text-decoration: underline; }
        a:hover { color: {$brandColorDark}; }

        /* Button hover */
        .button-primary:hover { background-color: {$brandColorDark} !important; }

        /* Responsive */
        @media screen and (max-width: 600px) {
            .email-container { width: 100% !important; max-width: 100% !important; }
            .fluid { width: 100% !important; max-width: 100% !important; height: auto !important; }
            .stack-column { display: block !important; width: 100% !important; max-width: 100% !important; }
            .center-on-narrow { text-align: center !important; display: block !important; margin-left: auto !important; margin-right: auto !important; float: none !important; }
            table.center-on-narrow { display: inline-block !important; }
            .hide-mobile { display: none !important; }
            .mobile-padding { padding-left: 20px !important; padding-right: 20px !important; }
        }

        /* Dark mode support */
        @media (prefers-color-scheme: dark) {
            .email-bg { background-color: #1f2937 !important; }
            .email-container-inner { background-color: #374151 !important; }
            .text-dark { color: #f3f4f6 !important; }
            .text-muted { color: #9ca3af !important; }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: {$bgColor};">

    <!-- Preview text -->
    <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
        {$subtitle}
        &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
    </div>

    <!-- Email wrapper -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: {$bgColor};" class="email-bg">
        <tr>
            <td style="padding: 40px 10px;">

                <!-- Email container -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center" class="email-container" style="margin: auto;">

                    <!-- Header with gradient -->
                    <tr>
                        <td style="padding: 30px 40px; text-align: center; background-color: {$brandColor}; background-image: linear-gradient(135deg, {$brandColor} 0%, {$brandColorDark} 100%); border-radius: 16px 16px 0 0;">
                            <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">{$tenantName}</h1>
                        </td>
                    </tr>

                    <!-- Main content -->
                    <tr>
                        <td style="background-color: #ffffff; padding: 0;" class="email-container-inner">

                            <!-- Title -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 40px 40px 15px;" class="mobile-padding">
                                        <h2 style="margin: 0; font-size: 22px; font-weight: 700; color: {$textColor}; line-height: 1.3;" class="text-dark">{$title}</h2>
                                    </td>
                                </tr>
                            </table>

                            <!-- Subtitle -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 0 40px 20px;" class="mobile-padding">
                                        <p style="margin: 0; font-size: 16px; font-weight: 600; color: {$textColor}; line-height: 1.6;" class="text-dark">{$subtitle}</p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Body content -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 0 40px 20px;" class="mobile-padding">
                                        <div style="background-color: #f5f3ff; background-image: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); padding: 20px; border-radius: 12px; border-left: 4px solid {$brandColor};">
                                            <div style="margin: 0; font-size: 16px; line-height: 1.8; color: {$textColor};" class="text-dark">{$body}</div>
                                        </div>
                                    </td>
                                </tr>
                            </table>

{$buttonHtml}

                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 30px 40px; border-radius: 0 0 16px 16px; border-top: 1px solid #e5e7eb;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="text-align: center; padding-bottom: 15px;">
                                        <p style="margin: 0; font-size: 14px; color: #6b7280;">
                                            &copy; {$year} {$tenantName}. {$allRightsReserved}
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="text-align: center; padding-bottom: 15px;">
                                        <p style="margin: 0; font-size: 13px; color: #9ca3af; line-height: 1.6;">
                                            {$memberNotice}
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="text-align: center;">
                                        <a href="{$settingsUrl}" style="color: #6b7280; text-decoration: underline; font-size: 13px;">{$managePreferences}</a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                </table>

            </td>
        </tr>
    </table>

</body>
</html>
HTML;
    }

    /**
     * Return a URL safe to interpolate into an href attribute in an email,
     * or an empty string if the scheme is disallowed. Prevents a caller from
     * injecting javascript:/data:/vbscript: payloads.
     */
    private static function sanitizeButtonUrl(string $url): string
    {
        $url = trim($url);
        if ($url === '') {
            return '';
        }
        // Relative URLs (starting with / or #) are fine; absolute URLs must
        // have an allowed scheme.
        if ($url[0] === '/' || $url[0] === '#') {
            return htmlspecialchars($url, ENT_QUOTES, 'UTF-8');
        }
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        if (!in_array($scheme, ['http', 'https', 'mailto'], true)) {
            return '';
        }
        return htmlspecialchars($url, ENT_QUOTES, 'UTF-8');
    }
}
