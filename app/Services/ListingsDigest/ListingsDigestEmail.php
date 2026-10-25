<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\ListingsDigest;

/**
 * Renders the offers & requests round-up email.
 *
 * Pure presentation: it receives an already-selected, already-scoped view model
 * from App\Services\ListingsDigestService and turns it into one self-contained,
 * inline-styled HTML document (table layout so Outlook and Gmail keep it,
 * stacked cards on phones, readable in dark mode). Every value that came from a
 * member is escaped here; every sentence is a translation key under
 * emails_listings.listings_digest, so the caller must already be inside
 * LocaleContext::withLocale() for the recipient.
 *
 * The same card markup is reused for the newsletter "{{recent_listings}}" block
 * (renderListingsBlock), so a newsletter and the round-up look alike.
 */
final class ListingsDigestEmail
{
    private const DEFAULT_BRAND = '#0f766e';
    private const REQUEST_ACCENT = '#f59e0b';
    private const REQUEST_INK = '#b45309';
    private const INK = '#1f2328';
    private const MUTED = '#5f646b';
    private const PAGE_BG = '#f4efe8';
    private const FOOTER_BG = '#efe8de';

    /**
     * @param array{
     *   mode: string,
     *   recipient_name: string,
     *   community: string,
     *   brand: ?string,
     *   logo_url: ?string,
     *   header_label: string,
     *   spotlight: ?array<string, mixed>,
     *   offers: list<array<string, mixed>>,
     *   requests: list<array<string, mixed>>,
     *   offer_total: int,
     *   request_total: int,
     *   events: list<array<string, string>>,
     *   urls: array<string, ?string>,
     *   frequency: ?string,
     *   rtl?: bool
     * } $vm
     */
    public static function render(array $vm): string
    {
        $c = self::palette($vm['brand'] ?? null);
        $rtl = (bool) ($vm['rtl'] ?? false);
        $start = $rtl ? 'right' : 'left';
        $dir = $rtl ? 'rtl' : 'ltr';
        $lang = self::e((string) (app()->getLocale() ?: 'en'));
        $community = self::e($vm['community']);
        $total = $vm['offer_total'] + $vm['request_total'];
        $isAll = $vm['mode'] === 'all';

        $headline = self::e(self::plural($isAll ? 'headline_all' : 'headline_new', $total));
        $intro = self::e(self::t($isAll ? 'intro_all' : 'intro_new'));
        $greeting = self::e(trim((string) $vm['recipient_name']) !== ''
            ? self::t('greeting', ['name' => $vm['recipient_name']])
            : self::t('greeting_anon'));
        $preview = self::e(self::t('preview', ['community' => $vm['community']]));
        $headerLabel = self::e($vm['header_label']);

        $pills = '';
        foreach ([
            ['🤲', self::plural('stat_offers', $vm['offer_total']), $vm['offer_total']],
            ['🙋', self::plural('stat_requests', $vm['request_total']), $vm['request_total']],
            ['📅', self::plural('stat_events', count($vm['events'])), count($vm['events'])],
        ] as [$icon, $label, $n]) {
            if ($n > 0) {
                $pills .= '<span style="display:inline-block;background:rgba(255,255,255,0.16);border-radius:999px;padding:8px 14px;margin:0 6px 8px 0;font-size:14px;font-weight:600;color:#ffffff;">'
                    . $icon . ' ' . self::e($label) . '</span>';
            }
        }

        $logo = self::logoHtml($vm['logo_url'] ?? null, $vm['community'], $c);

        $body = '';
        if (!empty($vm['spotlight'])) {
            $body .= self::spotlightHtml($vm['spotlight'], $c, $start);
        }
        if ($vm['offers'] !== []) {
            $body .= self::sectionHtml(
                '🤲 ' . self::t('offers_heading'),
                self::t('offers_sub'),
                $vm['offers'],
                $c['brand'],
                $start,
                self::t('see_all_offers'),
                (string) ($vm['urls']['offers'] ?? ''),
                $c['ink'],
            );
        }
        if ($vm['requests'] !== []) {
            $body .= self::sectionHtml(
                '🙋 ' . self::t('requests_heading'),
                self::t('requests_sub'),
                $vm['requests'],
                self::REQUEST_ACCENT,
                $start,
                self::t('see_all_requests'),
                (string) ($vm['urls']['requests'] ?? ''),
                self::REQUEST_INK,
            );
        }
        if ($vm['events'] !== []) {
            $body .= self::eventsHtml($vm['events'], $c);
        }

        $browseUrl = self::e((string) ($vm['urls']['browse'] ?? '#'));
        $browseLabel = self::e(self::t('browse_cta', ['community' => $vm['community']]));
        $body .= <<<HTML
    <table role="presentation" width="100%"><tr><td align="center" style="padding:38px 0 10px;">
      <a href="{$browseUrl}" style="display:inline-block;background:{$c['ink']};color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:16px 34px;border-radius:12px;">{$browseLabel}</a>
    </td></tr></table>
HTML;

        $nudgeTitle = self::e(self::t('nudge_title'));
        $nudgeBody = self::e(self::t('nudge_body'));
        $postOffer = self::e(self::t('post_offer'));
        $askHelp = self::e(self::t('ask_help'));
        $postOfferUrl = self::e((string) ($vm['urls']['post_offer'] ?? '#'));
        $askHelpUrl = self::e((string) ($vm['urls']['ask_help'] ?? '#'));
        $body .= <<<HTML
    <table role="presentation" width="100%" style="margin:20px 0 28px;"><tr>
      <td class="card" style="background:{$c['tint']};border:1px dashed {$c['tintBorder']};border-radius:14px;padding:20px 22px;">
        <p class="ink" style="margin:0 0 4px;font-size:16px;font-weight:800;color:{$c['deep']};">{$nudgeTitle}</p>
        <p class="muted" style="margin:0 0 12px;font-size:14px;line-height:21px;color:#3f4a48;">{$nudgeBody}</p>
        <a href="{$postOfferUrl}" style="font-size:14px;font-weight:700;color:{$c['ink']};text-decoration:none;">{$postOffer}</a>
        <span class="muted" style="color:#9aa3a2;padding:0 8px;">|</span>
        <a href="{$askHelpUrl}" style="font-size:14px;font-weight:700;color:#b45309;text-decoration:none;">{$askHelp}</a>
      </td>
    </tr></table>
HTML;

        $footer = self::footerHtml($vm);
        $year = date('Y');
        $rights = self::e(__('emails.footer.all_rights_reserved'));
        $title = $headline;

        return <<<HTML
<!DOCTYPE html>
<html lang="{$lang}" dir="{$dir}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{$title}</title>
<style type="text/css">
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; border-collapse:collapse; }
  img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
  body { margin:0 !important; padding:0 !important; width:100% !important; background:#f4efe8; }
  body, table, td, a, p, h1, h2, h3 { font-family:'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', Arial, sans-serif; }
  .card-link:hover { text-decoration:underline !important; }
  @media screen and (max-width:620px) {
    .container { width:100% !important; }
    .px { padding-left:20px !important; padding-right:20px !important; }
    .hero-pad { padding:32px 22px 28px !important; }
    .col { display:block !important; width:100% !important; max-width:100% !important; }
    .col-gap { padding:0 0 14px 0 !important; }
    .hero-title { font-size:30px !important; line-height:36px !important; }
    .spot-cta { text-align:{$start} !important; padding-top:14px !important; }
  }
  @media (prefers-color-scheme: dark) {
    body, .bg { background:#14171c !important; }
    .surface { background:#1d2229 !important; }
    .card { background:#252b33 !important; border-color:#323a44 !important; }
    .ink { color:#f2f2f0 !important; }
    .muted { color:#a7adb5 !important; }
    .footer { background:#14171c !important; }
    .datebox { background:#2b3540 !important; }
    .datebox div { color:#e6f2f0 !important; }
  }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:#f4efe8;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">{$preview}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" class="bg" style="background:#f4efe8;">
<tr><td align="center" style="padding:28px 12px 40px;">
<table role="presentation" width="600" class="container" style="width:600px;max-width:600px;">

  <tr><td class="px" style="padding:0 8px 18px;">
    <table role="presentation" width="100%"><tr>
      <td style="vertical-align:middle;">{$logo}</td>
      <td align="right" class="muted" style="font-size:13px;color:#6b6f76;vertical-align:middle;">{$headerLabel}</td>
    </tr></table>
  </td></tr>

  <tr><td bgcolor="{$c['ink']}" class="hero-pad" style="background:{$c['ink']};background-image:linear-gradient(135deg,{$c['ink']} 0%,{$c['dark']} 55%,{$c['deep']} 100%);border-radius:20px 20px 0 0;padding:44px 44px 40px;">
    <p style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:rgba(255,255,255,0.78);">{$greeting}</p>
    <h1 class="hero-title" style="margin:0;font-size:36px;line-height:42px;font-weight:800;color:#ffffff;letter-spacing:-0.8px;">{$headline}</h1>
    <p style="margin:16px 0 26px;font-size:16px;line-height:25px;color:rgba(255,255,255,0.88);">{$intro}</p>
    <div>{$pills}</div>
  </td></tr>

  <tr><td class="surface px" style="background:#ffffff;padding:32px 36px 8px;">
{$body}
  </td></tr>

  <tr><td class="footer px" style="background:#efe8de;border-radius:0 0 20px 20px;padding:24px 36px 26px;text-align:center;">
{$footer}
    <p class="muted" style="margin:0;font-size:12px;color:#7d828a;">&copy; {$year} {$community}. {$rights}</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>
HTML;
    }

    /**
     * The offers & requests cards on their own, for the newsletter
     * "{{recent_listings}}" block. Inline-styled so it survives inside any
     * newsletter layout.
     *
     * @param list<array<string, mixed>> $offers
     * @param list<array<string, mixed>> $requests
     */
    public static function renderListingsBlock(array $offers, array $requests, ?string $brand, array $urls): string
    {
        $c = self::palette($brand);
        $html = '<div style="font-family:\'Segoe UI\',-apple-system,BlinkMacSystemFont,Roboto,Arial,sans-serif;">';
        if ($offers !== []) {
            $html .= self::sectionHtml('🤲 ' . self::t('offers_heading'), self::t('offers_sub'), $offers, $c['brand'], 'left', self::t('see_all_offers'), (string) ($urls['offers'] ?? ''), $c['ink']);
        }
        if ($requests !== []) {
            $html .= self::sectionHtml('🙋 ' . self::t('requests_heading'), self::t('requests_sub'), $requests, self::REQUEST_ACCENT, 'left', self::t('see_all_requests'), (string) ($urls['requests'] ?? ''), self::REQUEST_INK);
        }
        if ($offers === [] && $requests === []) {
            $html .= '<p style="margin:0;font-size:15px;color:' . self::MUTED . ';">' . self::e(self::t('block_empty')) . '</p>';
        }

        return $html . '</div>';
    }

    // ------------------------------------------------------------------
    // Pieces
    // ------------------------------------------------------------------

    /** @param array<string, string> $c */
    private static function logoHtml(?string $logoUrl, string $community, array $c): string
    {
        $name = self::e($community);
        if ($logoUrl !== null && $logoUrl !== '' && preg_match('#^https://#i', $logoUrl) === 1) {
            $src = self::e($logoUrl);

            return '<table role="presentation"><tr><td style="vertical-align:middle;"><img src="' . $src . '" alt="' . $name . '" height="36" style="display:block;height:36px;width:auto;max-width:200px;border:0;"></td></tr></table>';
        }

        $initials = self::e(self::initials($community));

        return '<table role="presentation"><tr>'
            . '<td style="width:36px;height:36px;background:' . $c['ink'] . ';border-radius:10px;text-align:center;vertical-align:middle;color:#ffffff;font-weight:800;font-size:15px;">' . $initials . '</td>'
            . '<td class="ink" style="padding-left:10px;padding-right:10px;font-size:15px;font-weight:700;color:' . self::INK . ';">' . $name . '</td>'
            . '</tr></table>';
    }

    /**
     * @param array<string, mixed> $item
     * @param array<string, string> $c
     */
    private static function spotlightHtml(array $item, array $c, string $start): string
    {
        $label = self::e('✨ ' . self::t('spotlight'));
        $isOffer = ($item['type'] ?? 'offer') === 'offer';
        $badgeText = self::e(self::t($isOffer ? 'badge_offer' : 'badge_request'));
        $badgeBg = $isOffer ? $c['tint'] : '#fef3c7';
        $badgeInk = $isOffer ? $c['deep'] : '#92400e';
        $title = self::e((string) $item['title']);
        $category = !empty($item['category']) ? '<span class="muted" style="display:inline-block;margin-' . $start . ':6px;font-size:12px;color:#6b6f76;">' . self::e((string) $item['category']) . '</span>' : '';
        $excerpt = !empty($item['excerpt']) ? '<p class="muted" style="margin:0 0 18px;font-size:15px;line-height:23px;color:#4b5058;">' . self::e((string) $item['excerpt']) . '</p>' : '';
        $url = self::e((string) $item['url']);
        $cta = self::e(self::t('view'));
        $author = self::authorLine($item);

        if (!empty($item['image']) && preg_match('#^https://#i', (string) $item['image']) === 1) {
            $media = '<tr><td style="padding:0;"><a href="' . $url . '"><img src="' . self::e((string) $item['image']) . '" alt="" width="526" style="display:block;width:100%;max-width:526px;height:auto;max-height:260px;object-fit:cover;border-radius:16px 16px 0 0;"></a></td></tr>';
        } else {
            $emoji = $isOffer ? '🤲' : '🙋';
            $media = '<tr><td style="padding:0;"><div style="height:120px;line-height:120px;text-align:center;font-size:52px;border-radius:16px 16px 0 0;background:' . ($isOffer ? $c['tint'] : '#fdf0d5') . ';">' . $emoji . '</div></td></tr>';
        }

        return <<<HTML
    <p class="muted" style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#8a5a00;">{$label}</p>
    <table role="presentation" width="100%" class="card" style="background:#fffaf2;border:1px solid #f1e3c8;border-radius:16px;">
      {$media}
      <tr><td style="padding:22px 24px 24px;">
        <span style="display:inline-block;background:{$badgeBg};color:{$badgeInk};border-radius:999px;padding:4px 11px;font-size:12px;font-weight:700;text-transform:uppercase;">{$badgeText}</span>{$category}
        <h2 class="ink" style="margin:12px 0 8px;font-size:22px;line-height:28px;font-weight:800;color:#1f2328;"><a href="{$url}" class="ink" style="color:#1f2328;text-decoration:none;">{$title}</a></h2>
        {$excerpt}
        <table role="presentation" width="100%"><tr>
          <td class="col" style="vertical-align:middle;">{$author}</td>
          <td align="right" class="col spot-cta" style="vertical-align:middle;">
            <a href="{$url}" style="display:inline-block;background:{$c['ink']};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:10px;">{$cta}</a>
          </td>
        </tr></table>
      </td></tr>
    </table>
HTML;
    }

    /** @param array<string, mixed> $item */
    private static function authorLine(array $item): string
    {
        $author = (string) ($item['author'] ?? '');
        $initial = self::e(self::initials($author, 1));
        $name = self::e($author);
        $hours = !empty($item['hours']) ? ' <span class="muted" style="color:#6b6f76;">· ' . self::e((string) $item['hours']) . '</span>' : '';

        return '<table role="presentation"><tr>'
            . '<td style="width:32px;height:32px;border-radius:50%;background:#fde68a;text-align:center;vertical-align:middle;font-size:14px;font-weight:700;color:#7c4a03;">' . $initial . '</td>'
            . '<td class="ink" style="padding-left:9px;padding-right:9px;font-size:14px;color:#1f2328;"><strong>' . $name . '</strong>' . $hours . '</td>'
            . '</tr></table>';
    }

    /** @param list<array<string, mixed>> $items */
    private static function sectionHtml(
        string $heading,
        string $sub,
        array $items,
        string $accent,
        string $start,
        string $seeAllLabel,
        string $seeAllUrl,
        string $linkInk,
    ): string {
        $rows = '';
        foreach (array_chunk($items, 2) as $pair) {
            $rows .= '<tr>';
            foreach ([0, 1] as $i) {
                $pad = $i === 0 ? 'padding:0 7px 14px 0;' : 'padding:0 0 14px 7px;';
                if (!isset($pair[$i])) {
                    $rows .= '<td class="col col-gap" width="50%" style="width:50%;' . $pad . '"></td>';
                    continue;
                }
                $rows .= '<td class="col col-gap" width="50%" style="width:50%;' . $pad . 'vertical-align:top;">' . self::cardHtml($pair[$i], $accent, $start) . '</td>';
            }
            $rows .= '</tr>';
        }

        $h = self::e($heading);
        $s = self::e($sub);
        $seeAll = $seeAllUrl !== ''
            ? '<p style="margin:2px 0 0;font-size:14px;"><a href="' . self::e($seeAllUrl) . '" style="color:' . $linkInk . ';font-weight:700;text-decoration:none;">' . self::e($seeAllLabel) . '</a></p>'
            : '';

        return <<<HTML
    <h2 class="ink" style="margin:36px 0 4px;font-size:20px;font-weight:800;color:#1f2328;">{$h}</h2>
    <p class="muted" style="margin:0 0 16px;font-size:14px;color:#6b6f76;">{$s}</p>
    <table role="presentation" width="100%">{$rows}</table>
    {$seeAll}
HTML;
    }

    /** @param array<string, mixed> $item */
    private static function cardHtml(array $item, string $accent, string $start): string
    {
        $category = !empty($item['category'])
            ? '<p class="muted" style="margin:0 0 6px;font-size:12px;color:#6b6f76;">' . self::e((string) $item['category']) . '</p>'
            : '';
        $hours = !empty($item['hours']) ? ' · ' . self::e((string) $item['hours']) : '';

        return '<table role="presentation" width="100%" class="card" style="border:1px solid #e6e8eb;border-' . $start . ':4px solid ' . $accent . ';border-radius:12px;background:#ffffff;">'
            . '<tr><td style="padding:16px 16px 14px;">'
            . $category
            . '<a class="card-link ink" href="' . self::e((string) $item['url']) . '" style="font-size:16px;line-height:21px;font-weight:700;color:#1f2328;text-decoration:none;">' . self::e((string) $item['title']) . '</a>'
            . '<p class="muted" style="margin:10px 0 0;font-size:13px;color:#6b6f76;"><strong class="ink" style="color:#1f2328;">' . self::e((string) ($item['author'] ?? '')) . '</strong>' . $hours . '</p>'
            . '</td></tr></table>';
    }

    /**
     * @param list<array<string, string>> $events
     * @param array<string, string> $c
     */
    private static function eventsHtml(array $events, array $c): string
    {
        $rows = '';
        $last = count($events) - 1;
        foreach ($events as $i => $event) {
            $border = $i < $last ? 'border-bottom:1px solid #eef0f2;' : '';
            $rows .= '<tr><td style="padding:14px 16px;' . $border . '"><table role="presentation" width="100%"><tr>'
                . '<td width="54" style="width:54px;vertical-align:top;"><table role="presentation" class="datebox" style="width:46px;background:' . $c['tint'] . ';border-radius:10px;"><tr><td style="text-align:center;padding:6px 0;">'
                . '<div style="font-size:11px;font-weight:700;color:' . $c['ink'] . ';text-transform:uppercase;">' . self::e($event['month']) . '</div>'
                . '<div class="ink" style="font-size:19px;font-weight:800;color:#1f2328;line-height:22px;">' . self::e($event['day']) . '</div>'
                . '</td></tr></table></td>'
                . '<td style="vertical-align:middle;"><a class="card-link ink" href="' . self::e($event['url']) . '" style="font-size:15px;font-weight:700;color:#1f2328;text-decoration:none;">' . self::e($event['title']) . '</a><br>'
                . '<span class="muted" style="font-size:13px;color:#6b6f76;">' . self::e($event['when']) . '</span></td>'
                . '</tr></table></td></tr>';
        }
        $heading = self::e('📅 ' . self::t('events_heading'));

        return <<<HTML
    <h2 class="ink" style="margin:36px 0 14px;font-size:20px;font-weight:800;color:#1f2328;">{$heading}</h2>
    <table role="presentation" width="100%" class="card" style="border:1px solid #e6e8eb;border-radius:12px;background:#ffffff;">{$rows}</table>
HTML;
    }

    /** @param array<string, mixed> $vm */
    private static function footerHtml(array $vm): string
    {
        $community = (string) $vm['community'];
        $frequency = $vm['frequency'] ?? null;
        $why = match ($frequency) {
            'weekly' => self::t('footer_weekly', ['community' => $community]),
            'monthly' => self::t('footer_monthly', ['community' => $community]),
            default => self::t('footer_admin_send', ['community' => $community]),
        };

        $links = [];
        $settings = (string) ($vm['urls']['settings'] ?? '');
        if ($frequency === 'monthly' && $settings !== '') {
            $links[] = [self::t('switch_to_weekly'), $settings];
        } elseif ($frequency === 'weekly' && $settings !== '') {
            $links[] = [self::t('switch_to_monthly'), $settings];
        }
        if (!empty($vm['urls']['unsubscribe'])) {
            $links[] = [self::t('stop'), (string) $vm['urls']['unsubscribe']];
        }
        if ($settings !== '') {
            $links[] = [self::t('all_settings'), $settings];
        }

        $linkHtml = implode(' &nbsp;·&nbsp; ', array_map(
            static fn (array $l): string => '<a href="' . self::e($l[1]) . '" style="color:#4b5058;">' . self::e($l[0]) . '</a>',
            $links,
        ));

        return '    <p class="muted" style="margin:0 0 8px;font-size:13px;line-height:20px;color:#6b6f76;">' . self::e($why) . '</p>' . "\n"
            . '    <p style="margin:0 0 14px;font-size:13px;">' . $linkHtml . '</p>' . "\n";
    }

    // ------------------------------------------------------------------
    // Colour
    // ------------------------------------------------------------------

    /**
     * Derive every colour the email uses from the community's brand colour.
     * "ink" is the brand darkened just enough to carry white text and to read
     * as link text on white (WCAG AA 4.5:1), so a pale brand still works.
     *
     * @return array<string, string>
     */
    public static function palette(?string $brand): array
    {
        $brand = is_string($brand) && preg_match('/^#[0-9a-fA-F]{6}$/', $brand) === 1
            ? strtolower($brand)
            : self::DEFAULT_BRAND;

        $ink = $brand;
        for ($i = 0; $i < 20 && self::contrastWithWhite($ink) < 4.5; $i++) {
            $ink = self::mix($ink, '#000000', 0.1);
        }

        return [
            'brand' => $brand,
            'ink' => $ink,
            'dark' => self::mix($ink, '#000000', 0.18),
            'deep' => self::mix($ink, '#000000', 0.32),
            'tint' => self::mix($brand, '#ffffff', 0.88),
            'tintBorder' => self::mix($brand, '#ffffff', 0.6),
        ];
    }

    private static function mix(string $from, string $to, float $amount): string
    {
        $a = sscanf($from, '#%02x%02x%02x');
        $b = sscanf($to, '#%02x%02x%02x');
        $out = '#';
        for ($i = 0; $i < 3; $i++) {
            $out .= sprintf('%02x', (int) round($a[$i] + ($b[$i] - $a[$i]) * $amount));
        }

        return $out;
    }

    private static function contrastWithWhite(string $hex): float
    {
        $rgb = sscanf($hex, '#%02x%02x%02x');
        $lin = array_map(static function ($v): float {
            $s = $v / 255;

            return $s <= 0.03928 ? $s / 12.92 : (($s + 0.055) / 1.055) ** 2.4;
        }, $rgb);
        $l = 0.2126 * $lin[0] + 0.7152 * $lin[1] + 0.0722 * $lin[2];

        return 1.05 / ($l + 0.05);
    }

    // ------------------------------------------------------------------
    // Text helpers
    // ------------------------------------------------------------------

    /** @param array<string, mixed> $params */
    private static function t(string $key, array $params = []): string
    {
        return (string) __('emails_listings.listings_digest.' . $key, $params);
    }

    private static function plural(string $key, int $count): string
    {
        return self::t($key . ($count === 1 ? '_one' : '_other'), ['count' => $count]);
    }

    private static function initials(string $name, int $max = 2): string
    {
        $parts = preg_split('/\s+/u', trim($name)) ?: [];
        $out = '';
        foreach ($parts as $part) {
            if ($part === '') {
                continue;
            }
            $out .= mb_strtoupper(mb_substr($part, 0, 1));
            if (mb_strlen($out) >= $max) {
                break;
            }
        }

        return $out !== '' ? $out : '•';
    }

    private static function e(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
    }
}
