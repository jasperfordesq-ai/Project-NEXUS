<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Core;

/**
 * EmailTemplateBuilder — Fluent builder for beautiful, themed HTML emails.
 *
 * Produces responsive, dark-mode-aware, cross-client HTML emails with
 * structured content blocks: greetings, paragraphs, info cards, stat boxes,
 * lists, blockquotes, highlights, badges, dividers, and CTA buttons.
 *
 * Usage:
 *   $html = EmailTemplateBuilder::make()
 *       ->theme('success')
 *       ->title('You received time credits!')
 *       ->greeting('Hi John,')
 *       ->infoCard(['From' => 'Jane Doe', 'Amount' => '2 hours'])
 *       ->button('View Wallet', $url)
 *       ->render();
 */
class EmailTemplateBuilder
{
    // =========================================================================
    // THEME DEFINITIONS
    // =========================================================================

    private const THEMES = [
        'brand' => [
            'gradient'    => 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
            'primary'     => '#6366f1',
            'primaryDark' => '#4f46e5',
            'accent'      => '#818cf8',
            'accentBg'    => '#f5f3ff',
            'accentBorder'=> '#ede9fe',
        ],
        'success' => [
            'gradient'    => 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            'primary'     => '#10b981',
            'primaryDark' => '#059669',
            'accent'      => '#34d399',
            'accentBg'    => '#ecfdf5',
            'accentBorder'=> '#d1fae5',
        ],
        'warning' => [
            'gradient'    => 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
            'primary'     => '#f59e0b',
            'primaryDark' => '#d97706',
            'accent'      => '#fbbf24',
            'accentBg'    => '#fffbeb',
            'accentBorder'=> '#fde68a',
        ],
        'danger' => [
            'gradient'    => 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
            'primary'     => '#dc2626',
            'primaryDark' => '#b91c1c',
            'accent'      => '#f87171',
            'accentBg'    => '#fef2f2',
            'accentBorder'=> '#fecaca',
        ],
        'federation' => [
            'gradient'    => 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            'primary'     => '#3b82f6',
            'primaryDark' => '#2563eb',
            'accent'      => '#60a5fa',
            'accentBg'    => '#eff6ff',
            'accentBorder'=> '#dbeafe',
        ],
        'achievement' => [
            'gradient'    => 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
            'primary'     => '#8b5cf6',
            'primaryDark' => '#7c3aed',
            'accent'      => '#a78bfa',
            'accentBg'    => '#f5f3ff',
            'accentBorder'=> '#ede9fe',
        ],
    ];

    // =========================================================================
    // STATE
    // =========================================================================

    private string $themeName = 'brand';
    private string $titleText = '';
    private string $previewText = '';
    private ?string $tenantName = null;
    private array $blocks = [];

    // =========================================================================
    // FACTORY
    // =========================================================================

    public static function make(): self
    {
        return new self();
    }

    // =========================================================================
    // CONFIGURATION
    // =========================================================================

    /** Set the color theme: brand, success, warning, danger, federation, achievement */
    public function theme(string $name): self
    {
        $this->themeName = $name;
        return $this;
    }

    /** Set the header title (displayed in gradient banner) */
    public function title(string $title): self
    {
        $this->titleText = $title;
        return $this;
    }

    /** Set the hidden preview text (shown in inbox list before opening) */
    public function previewText(string $text): self
    {
        $this->previewText = $text;
        return $this;
    }

    /** Override the tenant name (auto-detected from TenantContext if not set) */
    public function tenantName(string $name): self
    {
        $this->tenantName = $name;
        return $this;
    }

    // =========================================================================
    // CONTENT BLOCKS (order matters — rendered top to bottom)
    // =========================================================================

    /** Add a greeting line: "Hi John," */
    public function greeting(string $name): self
    {
        $this->blocks[] = ['type' => 'greeting', 'name' => $name];
        return $this;
    }

    /** Add a paragraph of text (HTML allowed in $text) */
    public function paragraph(string $text): self
    {
        $this->blocks[] = ['type' => 'paragraph', 'text' => $text];
        return $this;
    }

    /**
     * Add an info card with key-value rows.
     * @param array<string,string> $rows  e.g. ['From' => 'Jane Doe', 'Amount' => '2 hours']
     * @param string|null $heading  Optional card heading
     */
    public function infoCard(array $rows, ?string $heading = null): self
    {
        $this->blocks[] = ['type' => 'infoCard', 'rows' => $rows, 'heading' => $heading];
        return $this;
    }

    /**
     * Add side-by-side stat boxes.
     * @param array<array{value:string,label:string}> $stats  e.g. [['value'=>'42','label'=>'XP Earned'],...]
     */
    public function statCards(array $stats): self
    {
        $this->blocks[] = ['type' => 'statCards', 'stats' => $stats];
        return $this;
    }

    /**
     * Add a bulleted list.
     * @param string[] $items  List items (HTML allowed per item)
     * @param string|null $heading  Optional heading above the list
     */
    public function bulletList(array $items, ?string $heading = null): self
    {
        $this->blocks[] = ['type' => 'bulletList', 'items' => $items, 'heading' => $heading];
        return $this;
    }

    /** Add a blockquote (e.g. message preview, review comment) */
    public function blockquote(string $text, ?string $attribution = null): self
    {
        $this->blocks[] = ['type' => 'blockquote', 'text' => $text, 'attribution' => $attribution];
        return $this;
    }

    /** Add a highlighted callout box (info/warning/tip) */
    public function highlight(string $text, string $icon = ''): self
    {
        $this->blocks[] = ['type' => 'highlight', 'text' => $text, 'icon' => $icon];
        return $this;
    }

    /** Add a CTA button */
    public function button(string $text, string $url): self
    {
        $this->blocks[] = ['type' => 'button', 'text' => $text, 'url' => $url];
        return $this;
    }

    /** Add a horizontal divider */
    public function divider(): self
    {
        $this->blocks[] = ['type' => 'divider'];
        return $this;
    }

    /**
     * Add a badge row (inline colored labels).
     * @param array<array{text:string,color:string}> $badges
     */
    public function badges(array $badges): self
    {
        $this->blocks[] = ['type' => 'badges', 'badges' => $badges];
        return $this;
    }

    // =========================================================================
    // RENDER
    // =========================================================================

    /** Render the complete HTML email */
    public function render(): string
    {
        $theme = self::THEMES[$this->themeName] ?? self::THEMES['brand'];

        // Resolve tenant name
        $tenantName = $this->tenantName;
        if ($tenantName === null) {
            try {
                $tenant = TenantContext::get();
                $tenantName = $tenant['name'] ?? 'Project NEXUS';
            } catch (\Throwable $e) {
                $tenantName = 'Project NEXUS';
            }
        }
        $safeTenantName = self::esc($tenantName);

        // Resolve settings URL
        $settingsUrl = '#';
        try {
            $frontendUrl = TenantContext::getFrontendUrl();
            $basePath = TenantContext::getSlugPrefix();
            $settingsUrl = $frontendUrl . $basePath . '/notifications';
        } catch (\Throwable $e) {
            // Fallback — link won't work but email still sends
        }

        $safeTitle = self::esc($this->titleText);
        $previewText = self::esc($this->previewText ?: $this->titleText);
        $year = date('Y');

        // Build content blocks
        $contentHtml = '';
        foreach ($this->blocks as $block) {
            $contentHtml .= $this->renderBlock($block, $theme);
        }

        // Assemble the full email
        return $this->renderWrapper($safeTitle, $previewText, $safeTenantName, $theme, $contentHtml, $settingsUrl, $year);
    }

    // =========================================================================
    // BLOCK RENDERERS
    // =========================================================================

    private function renderBlock(array $block, array $theme): string
    {
        return match ($block['type']) {
            'greeting'   => $this->renderGreeting($block),
            'paragraph'  => $this->renderParagraph($block),
            'infoCard'   => $this->renderInfoCard($block, $theme),
            'statCards'  => $this->renderStatCards($block, $theme),
            'bulletList' => $this->renderBulletList($block, $theme),
            'blockquote' => $this->renderBlockquote($block, $theme),
            'highlight'  => $this->renderHighlight($block, $theme),
            'button'     => $this->renderButton($block, $theme),
            'divider'    => $this->renderDivider(),
            'badges'     => $this->renderBadges($block),
            default      => '',
        };
    }

    private function renderGreeting(array $block): string
    {
        $name = self::esc($block['name']);
        $greeting = __('emails.common.greeting', ['name' => $name]);
        return <<<HTML
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 32px 40px 8px;" class="mobile-padding">
                                        <p style="margin: 0; font-size: 18px; font-weight: 600; color: #111827; line-height: 1.5;" class="text-dark">{$greeting}</p>
                                    </td>
                                </tr>
                            </table>
HTML;
    }

    private function renderParagraph(array $block): string
    {
        $text = $block['text']; // HTML allowed — caller is responsible for escaping user data
        return <<<HTML
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 8px 40px;" class="mobile-padding">
                                        <p style="margin: 0; font-size: 16px; color: #374151; line-height: 1.7;" class="text-dark">{$text}</p>
                                    </td>
                                </tr>
                            </table>
HTML;
    }

    private function renderInfoCard(array $block, array $theme): string
    {
        $rows = $block['rows'];
        $heading = $block['heading'] ?? null;

        $headingHtml = '';
        if ($heading) {
            $safeHeading = self::esc($heading);
            $headingHtml = '<p style="margin: 0 0 12px; font-size: 13px; font-weight: 700; color: ' . $theme['primaryDark'] . '; text-transform: uppercase; letter-spacing: 0.8px;">' . $safeHeading . '</p>';
        }

        $rowsHtml = '';
        $isFirst = true;
        foreach ($rows as $label => $value) {
            $safeLabel = self::esc($label);
            $safeValue = self::esc($value);
            $borderTop = $isFirst ? '' : 'border-top: 1px solid ' . $theme['accentBorder'] . ';';
            $rowsHtml .= <<<ROW
                                                    <tr>
                                                        <td style="padding: 10px 16px; {$borderTop} font-size: 13px; font-weight: 600; color: #6b7280; white-space: nowrap; vertical-align: top;" class="text-muted">{$safeLabel}</td>
                                                        <td style="padding: 10px 16px; {$borderTop} font-size: 15px; font-weight: 600; color: #111827;" class="text-dark">{$safeValue}</td>
                                                    </tr>
ROW;
            $isFirst = false;
        }

        return <<<HTML
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 12px 40px;" class="mobile-padding">
                                        <div style="background: {$theme['accentBg']}; border: 1px solid {$theme['accentBorder']}; border-radius: 12px; padding: 20px; border-left: 4px solid {$theme['primary']};">
                                            {$headingHtml}
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                                                {$rowsHtml}
                                            </table>
                                        </div>
                                    </td>
                                </tr>
                            </table>
HTML;
    }

    private function renderStatCards(array $block, array $theme): string
    {
        $stats = $block['stats'];
        $count = count($stats);
        if ($count === 0) {
            return '';
        }

        // Calculate widths — up to 4 columns side by side
        $colCount = min($count, 4);
        $widthPct = intval(100 / $colCount);

        $cardsHtml = '';
        foreach ($stats as $stat) {
            $value = self::esc($stat['value'] ?? '0');
            $label = self::esc($stat['label'] ?? '');
            $icon = $stat['icon'] ?? '';
            $iconHtml = $icon ? '<div style="font-size: 24px; margin-bottom: 4px;">' . $icon . '</div>' : '';

            $cardsHtml .= <<<CARD
                                            <td width="{$widthPct}%" style="padding: 4px; vertical-align: top;" class="stack-column">
                                                <div style="background: {$theme['accentBg']}; border: 1px solid {$theme['accentBorder']}; border-radius: 12px; padding: 16px; text-align: center;">
                                                    {$iconHtml}
                                                    <div style="font-size: 28px; font-weight: 800; color: {$theme['primary']}; line-height: 1.2;">{$value}</div>
                                                    <div style="font-size: 12px; font-weight: 600; color: #6b7280; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px;">{$label}</div>
                                                </div>
                                            </td>
CARD;
        }

        return <<<HTML
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 12px 36px;" class="mobile-padding">
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                            <tr>
                                                {$cardsHtml}
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
HTML;
    }

    private function renderBulletList(array $block, array $theme): string
    {
        $items = $block['items'];
        $heading = $block['heading'] ?? null;

        $headingHtml = '';
        if ($heading) {
            $safeHeading = self::esc($heading);
            $headingHtml = '<p style="margin: 0 0 10px; font-size: 15px; font-weight: 700; color: #111827;" class="text-dark">' . $safeHeading . '</p>';
        }

        $listHtml = '';
        foreach ($items as $item) {
            $safeItem = $item; // HTML allowed — caller escapes user data
            $listHtml .= <<<LI
                                                <tr>
                                                    <td style="padding: 4px 0; vertical-align: top; width: 24px;">
                                                        <div style="width: 8px; height: 8px; background: {$theme['primary']}; border-radius: 50%; margin-top: 7px;"></div>
                                                    </td>
                                                    <td style="padding: 4px 0; font-size: 15px; color: #374151; line-height: 1.6;" class="text-dark">{$safeItem}</td>
                                                </tr>
LI;
        }

        return <<<HTML
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 8px 40px;" class="mobile-padding">
                                        {$headingHtml}
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                            {$listHtml}
                                        </table>
                                    </td>
                                </tr>
                            </table>
HTML;
    }

    private function renderBlockquote(array $block, array $theme): string
    {
        $text = self::esc($block['text']);
        $attribution = $block['attribution'] ?? null;

        $attrHtml = '';
        if ($attribution) {
            $safeAttr = self::esc($attribution);
            $attrHtml = '<p style="margin: 8px 0 0; font-size: 13px; color: #6b7280; text-align: right;">— ' . $safeAttr . '</p>';
        }

        return <<<HTML
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 8px 40px;" class="mobile-padding">
                                        <div style="background: #f9fafb; border-left: 4px solid {$theme['primary']}; border-radius: 0 8px 8px 0; padding: 16px 20px;">
                                            <p style="margin: 0; font-size: 15px; color: #374151; font-style: italic; line-height: 1.7;" class="text-dark">&ldquo;{$text}&rdquo;</p>
                                            {$attrHtml}
                                        </div>
                                    </td>
                                </tr>
                            </table>
HTML;
    }

    private function renderHighlight(array $block, array $theme): string
    {
        $text = $block['text']; // HTML allowed
        $icon = $block['icon'] ?? '';
        $iconHtml = $icon ? '<span style="font-size: 20px; margin-right: 8px; vertical-align: middle;">' . $icon . '</span>' : '';

        return <<<HTML
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 12px 40px;" class="mobile-padding">
                                        <div style="background: {$theme['accentBg']}; border: 1px solid {$theme['accentBorder']}; border-radius: 12px; padding: 16px 20px;">
                                            <p style="margin: 0; font-size: 15px; color: {$theme['primaryDark']}; font-weight: 600; line-height: 1.6;">{$iconHtml}{$text}</p>
                                        </div>
                                    </td>
                                </tr>
                            </table>
HTML;
    }

    private function renderButton(array $block, array $theme): string
    {
        $text = self::esc($block['text']);
        $url = self::sanitizeButtonUrl((string) ($block['url'] ?? ''));
        $fallbackText = __('emails.common.button_fallback_short');
        // Solid colour first: clients that strip the gradient must still paint a
        // background behind the white label. See App\Core\EmailBackground.
        $buttonBg = EmailBackground::gradient((string) $theme['gradient']);
        $buttonBgColor = EmailBackground::firstColor((string) $theme['gradient']) ?? $theme['primary'];

        return <<<HTML
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 24px 40px 8px; text-align: center;" class="mobile-padding">
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
                                            <tr>
                                                <td bgcolor="{$buttonBgColor}" style="border-radius: 10px; {$buttonBg}" class="button-primary">
                                                    <a href="{$url}" style="display: inline-block; padding: 16px 36px; font-size: 16px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 10px; letter-spacing: 0.3px;">{$text}</a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 4px 40px 16px; text-align: center;" class="mobile-padding">
                                        <p style="margin: 0; font-size: 12px; color: #9ca3af; line-height: 1.5;">
                                            {$fallbackText}<br>
                                            <a href="{$url}" style="color: {$theme['primary']}; word-break: break-all; font-size: 11px;">{$url}</a>
                                        </p>
                                    </td>
                                </tr>
                            </table>
HTML;
    }

    private function renderDivider(): string
    {
        return <<<HTML
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 8px 40px;" class="mobile-padding">
                                        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0;">
                                    </td>
                                </tr>
                            </table>
HTML;
    }

    private function renderBadges(array $block): string
    {
        $badgesHtml = '';
        foreach ($block['badges'] as $badge) {
            $text = self::esc($badge['text']);
            $color = $badge['color'] ?? '#6366f1';
            // Compute a soft background from the color by adding alpha
            $badgesHtml .= '<span style="display: inline-block; padding: 5px 14px; margin: 3px 4px; background: ' . $color . '1a; color: ' . $color . '; font-size: 13px; font-weight: 700; border-radius: 20px; border: 1px solid ' . $color . '33;">' . $text . '</span>';
        }

        return <<<HTML
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="padding: 8px 40px; text-align: center;" class="mobile-padding">
                                        {$badgesHtml}
                                    </td>
                                </tr>
                            </table>
HTML;
    }

    // =========================================================================
    // FULL EMAIL WRAPPER
    // =========================================================================

    private function renderWrapper(string $title, string $previewText, string $tenantName, array $theme, string $contentHtml, string $settingsUrl, string $year): string
    {
        $bgColor = '#f3f4f6';
        $mutedColor = '#6b7280';

        // Solid colour first: the header title is white, so a client that strips
        // the gradient must still get a background. See App\Core\EmailBackground.
        $headerBg = EmailBackground::gradient((string) $theme['gradient']);
        $headerBgColor = EmailBackground::firstColor((string) $theme['gradient']) ?? $theme['primary'];

        // Translated footer strings
        $allRightsReserved = __('emails.footer.all_rights_reserved');
        $memberNotice = __('emails.footer.member_notice', ['community' => $tenantName]);
        $managePreferences = __('emails.footer.manage_preferences');

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
        /* Reset */
        body, table, td, p, a, li, blockquote { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
        body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: {$bgColor}; }

        /* Typography */
        body, table, td, a { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }

        /* Links */
        a { color: {$theme['primary']}; text-decoration: underline; }
        a:hover { color: {$theme['primaryDark']}; }

        /* Button hover */
        .button-primary:hover { opacity: 0.9 !important; }

        /* Responsive */
        @media screen and (max-width: 620px) {
            .email-container { width: 100% !important; max-width: 100% !important; }
            .fluid { width: 100% !important; max-width: 100% !important; height: auto !important; }
            .stack-column { display: block !important; width: 100% !important; max-width: 100% !important; }
            .center-on-narrow { text-align: center !important; display: block !important; margin-left: auto !important; margin-right: auto !important; float: none !important; }
            table.center-on-narrow { display: inline-block !important; }
            .hide-mobile { display: none !important; }
            .mobile-padding { padding-left: 20px !important; padding-right: 20px !important; }
        }

        /* Dark mode */
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
        {$previewText}
        &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
    </div>

    <!-- Wrapper -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: {$bgColor};" class="email-bg">
        <tr>
            <td style="padding: 40px 10px;">

                <!-- Container -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center" class="email-container" style="margin: auto; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);">

                    <!-- Header -->
                    <tr>
                        <td bgcolor="{$headerBgColor}" style="padding: 32px 40px; text-align: center; {$headerBg}">
                            <h1 style="margin: 0; font-size: 26px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; line-height: 1.3;">{$title}</h1>
                            <p style="margin: 8px 0 0; font-size: 14px; font-weight: 500; color: rgba(255, 255, 255, 0.85);">{$tenantName}</p>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="background-color: #ffffff; padding: 0;" class="email-container-inner">
{$contentHtml}
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 28px 40px; border-top: 1px solid #e5e7eb;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="text-align: center; padding-bottom: 12px;">
                                        <p style="margin: 0; font-size: 14px; color: {$mutedColor};">
                                            &copy; {$year} {$tenantName}. {$allRightsReserved}
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="text-align: center; padding-bottom: 12px;">
                                        <p style="margin: 0; font-size: 13px; color: #9ca3af; line-height: 1.6;">
                                            {$memberNotice}
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="text-align: center;">
                                        <a href="{$settingsUrl}" style="color: {$mutedColor}; text-decoration: underline; font-size: 13px;">{$managePreferences}</a>
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

    // =========================================================================
    // HELPERS
    // =========================================================================

    /** HTML-escape a string for safe output */
    private static function esc(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
    }

    /**
     * Sanitize a button URL — allows http/https/mailto and relative paths only.
     * Prevents javascript:/data:/vbscript: injection via href attributes.
     */
    private static function sanitizeButtonUrl(string $url): string
    {
        $url = trim($url);
        if ($url === '') {
            return '';
        }
        if ($url[0] === '/' || $url[0] === '#') {
            return htmlspecialchars($url, ENT_QUOTES, 'UTF-8');
        }
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        if (!in_array($scheme, ['http', 'https', 'mailto'], true)) {
            return '';
        }
        return htmlspecialchars($url, ENT_QUOTES, 'UTF-8');
    }

    /**
     * Build a full tenant-scoped frontend URL.
     *
     * @param string $path  Relative path, e.g. '/wallet' or '/events/42'
     * @return string       Full URL, e.g. 'https://app.project-nexus.ie/hour-timebank/wallet'
     */
    public static function tenantUrl(string $path): string
    {
        try {
            $frontendUrl = TenantContext::getFrontendUrl();
            $basePath = TenantContext::getSlugPrefix();
            return $frontendUrl . $basePath . $path;
        } catch (\Throwable $e) {
            return '#';
        }
    }
}
