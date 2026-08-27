<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Mail;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Throwable;
use App\Support\UserDisplayName;

/**
 * AG90 — Personalised Civic Digest email.
 *
 * Renders the digest as a themed HTML email grouped by source type (safety
 * alerts first, then announcements, projects, events, etc.) and dispatches
 * via the tenant-aware Mailer.
 *
 * Always wrapped in LocaleContext::withLocale() so it renders in the
 * recipient's preferred_language, regardless of caller / queue worker locale.
 */
class CivicDigestMail
{
    /**
     * Order in which sources are rendered in the email body.
     * Safety alerts appear first because they're time-sensitive.
     */
    private const SOURCE_RENDER_ORDER = [
        'safety_alert',
        'announcement',
        'project',
        'event',
        'help_request',
        'vol_org',
        'care_provider',
        'marketplace',
        'feed_post',
    ];

    /**
     * Send the digest email to a recipient.
     *
     * @param object               $recipient  User-like object with email/first_name/last_name/preferred_language
     * @param string               $cadence    'daily' | 'monthly'
     * @param list<array<string,mixed>> $items   Digest items as returned by CivicDigestService::digestForMember()
     * @return bool                            true if EmailDispatchService returned true; false otherwise
     */
    public static function dispatchDigest(object $recipient, string $cadence, array $items): bool
    {
        if (empty($recipient->email)) {
            return false;
        }
        if ($items === []) {
            // Service already filters empty digests upstream; defensive guard.
            return false;
        }
        $cadence = $cadence === 'monthly' || $cadence === 'weekly' ? 'monthly' : 'daily';
        $tenantId = (int) ($recipient->tenant_id ?? 0);
        if ($tenantId <= 0) {
            \Illuminate\Support\Facades\Log::warning('CivicDigestMail::dispatchDigest missing recipient tenant', [
                'user_id' => $recipient->id ?? null,
            ]);
            return false;
        }

        return (bool) LocaleContext::withLocale($recipient->preferred_language ?? null, function () use ($recipient, $cadence, $items, $tenantId): bool {
            try {
                return TenantContext::runForTenant($tenantId, function () use ($recipient, $cadence, $items, $tenantId): bool {
                $tenantData = TenantContext::get();
                $community = (string) ($tenantData['name'] ?? 'Project NEXUS');

                $base = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix();
                $digestUrl = $base . '/caring-community/civic-digest';
                $prefsUrl = $digestUrl;

                $name = UserDisplayName::resolve($recipient, __('emails.common.fallback_name'));

                $count = count($items);
                $subjectKey = $cadence === 'monthly' ? 'civic_digest.email.subject_monthly' : 'civic_digest.email.subject_daily';
                $introKey   = $cadence === 'monthly' ? 'civic_digest.email.intro_monthly'   : 'civic_digest.email.intro_daily';

                $subject = __($subjectKey, ['community' => $community]);

                $builder = EmailTemplateBuilder::make()
                    ->theme('brand')
                    ->title($subject)
                    ->previewText(__($introKey, ['count' => $count, 'community' => $community]))
                    ->tenantName($community)
                    ->greeting(__('civic_digest.email.greeting', ['name' => $name]))
                    ->paragraph(__($introKey, ['count' => $count, 'community' => $community]));

                // Group items by source so we can render them in priority order
                $bySource = [];
                foreach ($items as $item) {
                    $src = (string) ($item['source'] ?? '');
                    if ($src === '') {
                        continue;
                    }
                    $bySource[$src] = $bySource[$src] ?? [];
                    $bySource[$src][] = $item;
                }

                $rendered = false;
                foreach (self::SOURCE_RENDER_ORDER as $sourceKey) {
                    if (empty($bySource[$sourceKey])) {
                        continue;
                    }

                    $sourceLabel = __('civic_digest.source_' . $sourceKey);
                    $builder->divider();
                    $builder->paragraph('<strong>' . $sourceLabel . '</strong>');

                    foreach ($bySource[$sourceKey] as $item) {
                        $title = (string) ($item['title'] ?? '');
                        $summary = self::shorten((string) ($item['summary'] ?? ''), 200);
                        $score = (int) ($item['audience_match_score'] ?? 0);
                        $linkPath = isset($item['link_path']) && is_string($item['link_path']) && $item['link_path'] !== ''
                            ? $item['link_path']
                            : null;

                        $rows = [];
                        if ($title !== '') {
                            $rows[$sourceLabel] = $title;
                        }
                        if ($summary !== '') {
                            $rows[__('civic_digest.email.match_score', ['score' => $score])] = $summary;
                        } elseif ($score > 0) {
                            // No summary but we still want the score badge visible
                            $rows[__('civic_digest.email.match_score', ['score' => $score])] = '—';
                        }

                        if ($rows !== []) {
                            $builder->infoCard($rows);
                            $rendered = true;
                        }

                        if ($linkPath !== null) {
                            $builder->button(__('civic_digest.email.cta_open'), $base . $linkPath);
                        }
                    }
                }

                if (! $rendered) {
                    // Defensive fallback — items existed but nothing was rendered (unexpected).
                    $builder->paragraph(__('civic_digest.email.empty'));
                }

                $builder->divider();
                $builder->button(__('civic_digest.email.view_all'), $digestUrl);
                $builder->paragraph(__('civic_digest.email.footer', ['community' => $community]));

                $sent = \App\Services\EmailDispatchService::sendRaw(
                    (string) $recipient->email,
                    $subject,
                    $builder->render(),
                    null,
                    null,
                    $prefsUrl,
                    'civic_digest',
                    ['tenant_id' => $tenantId]
                );
                return $sent === true;
                });
            } catch (Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('CivicDigestMail::dispatchDigest failed', [
                    'user_id' => $recipient->id ?? null,
                    'error' => $e->getMessage(),
                ]);
                return false;
            }
        });
    }

    private static function shorten(string $text, int $max): string
    {
        $text = trim(strip_tags($text));
        if ($text === '') {
            return '';
        }
        if (mb_strlen($text) <= $max) {
            return $text;
        }
        return mb_substr($text, 0, $max - 1) . '…';
    }
}
