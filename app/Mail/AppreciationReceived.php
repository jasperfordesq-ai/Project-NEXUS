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
use App\Services\EmailDispatchService;
use Illuminate\Support\Facades\Log;
use Throwable;
use App\Support\UserDisplayName;

/**
 * SOC14 — Appreciation received email (sent to receiver).
 *
 * Always wrapped in LocaleContext::withLocale() so it renders in the
 * recipient's preferred_language, regardless of caller / queue worker locale.
 */
class AppreciationReceived
{
    /**
     * @param object $recipient User-like object with email/first_name/last_name/preferred_language
     */
    public static function send(object $recipient, string $senderName, string $message, bool $isPublic): void
    {
        if (empty($recipient->email)) {
            return;
        }

        $tenantId = (int) ($recipient->tenant_id ?? 0);
        if ($tenantId <= 0) {
            Log::warning('[AppreciationReceived] missing recipient tenant', [
                'recipient_id' => $recipient->id ?? null,
            ]);
            return;
        }

        LocaleContext::withLocale($recipient->preferred_language ?? null, function () use ($recipient, $senderName, $message, $isPublic, $tenantId): void {
            try {
                TenantContext::runForTenant($tenantId, function () use ($recipient, $senderName, $message, $isPublic, $tenantId): void {
                    $url = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/users/' . ($recipient->id ?? 'me') . '/appreciations';

                    $name = UserDisplayName::resolve($recipient);
                    if ($name === '') {
                        $name = (string) ($recipient->name ?? __('emails.common.fallback_name'));
                    }

                    $builder = EmailTemplateBuilder::make()
                        ->theme('success')
                        ->title(__('emails.appreciation.title'))
                        ->previewText(__('emails.appreciation.preview', ['sender' => $senderName]))
                        ->greeting($name !== '' ? $name : __('emails.common.fallback_name'))
                        ->paragraph(__('emails.appreciation.body', ['sender' => $senderName]))
                        ->infoCard([
                            __('emails.appreciation.message_label') => $message,
                        ])
                        ->paragraph($isPublic
                            ? __('emails.appreciation.public_note')
                            : __('emails.appreciation.private_note'))
                        ->button(__('emails.appreciation.cta_view'), $url);

                    $subject = __('emails.appreciation.subject', ['sender' => $senderName]);

                    if (!EmailDispatchService::sendRaw($recipient->email, $subject, $builder->render(), null, null, null, 'appreciation', ['tenant_id' => $tenantId])) {
                        Log::warning('[AppreciationReceived] email returned false', [
                            'recipient_id' => $recipient->id ?? null,
                        ]);
                    }
                });
            } catch (Throwable $e) {
                Log::warning('[AppreciationReceived] email failed', [
                    'recipient_id' => $recipient->id ?? null,
                    'error' => $e->getMessage(),
                ]);
            }
        });
    }
}
