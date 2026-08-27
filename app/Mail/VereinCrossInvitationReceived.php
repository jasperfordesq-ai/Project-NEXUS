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
 * AG55 — Verein cross-invitation email (sent to invitee).
 *
 * Always wrapped in LocaleContext::withLocale() so it renders in the
 * recipient's preferred_language, regardless of caller / queue worker locale.
 */
class VereinCrossInvitationReceived
{
    public static function send(object $recipient, int $invitationId, string $sourceName, string $targetName, ?string $message): void
    {
        if (empty($recipient->email)) {
            return;
        }

        $tenantId = (int) ($recipient->tenant_id ?? 0);
        if ($tenantId <= 0) {
            Log::warning('[VereinCrossInvitationReceived] missing recipient tenant', [
                'recipient_id' => $recipient->id ?? null,
                'invitation_id' => $invitationId,
            ]);
            return;
        }

        LocaleContext::withLocale($recipient->preferred_language ?? null, function () use ($recipient, $invitationId, $sourceName, $targetName, $message, $tenantId): void {
            try {
                TenantContext::runForTenant($tenantId, function () use ($recipient, $invitationId, $sourceName, $targetName, $message, $tenantId): void {
                    $url = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/me/verein-invitations';

                    $name = UserDisplayName::resolve($recipient);
                    $builder = EmailTemplateBuilder::make()
                        ->theme('info')
                        ->title(__('emails.verein_federation.invitation_received_title'))
                        ->previewText(__('emails.verein_federation.invitation_received_preview', ['target' => $targetName]))
                        ->greeting($name !== '' ? $name : __('emails.common.fallback_name'))
                        ->paragraph(__('emails.verein_federation.invitation_received_body', [
                            'source' => $sourceName,
                            'target' => $targetName,
                        ]));

                    if ($message !== null && $message !== '') {
                        $builder->infoCard([
                            __('emails.verein_federation.message_label') => $message,
                        ]);
                    }

                    $builder->button(__('emails.verein_federation.cta_respond'), $url);

                    $subject = __('emails.verein_federation.invitation_received_subject', ['target' => $targetName]);

                    if (!EmailDispatchService::sendRaw($recipient->email, $subject, $builder->render(), null, null, null, 'verein_federation', ['tenant_id' => $tenantId])) {
                        Log::warning('[VereinCrossInvitationReceived] email returned false', [
                            'recipient_id' => $recipient->id ?? null,
                            'invitation_id' => $invitationId,
                        ]);
                    }
                });
            } catch (Throwable $e) {
                Log::warning('[VereinCrossInvitationReceived] email failed', [
                    'recipient_id' => $recipient->id ?? null,
                    'invitation_id' => $invitationId,
                    'error' => $e->getMessage(),
                ]);
            }
        });
    }
}
