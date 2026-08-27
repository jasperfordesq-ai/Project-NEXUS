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
 * AG55 — Verein cross-invitation accepted email (sent to inviter).
 */
class VereinCrossInvitationAccepted
{
    public static function send(object $recipient, string $accepterName, string $targetName): void
    {
        if (empty($recipient->email)) {
            return;
        }

        $tenantId = (int) ($recipient->tenant_id ?? 0);
        if ($tenantId <= 0) {
            Log::warning('[VereinCrossInvitationAccepted] missing recipient tenant', [
                'recipient_id' => $recipient->id ?? null,
            ]);
            return;
        }

        LocaleContext::withLocale($recipient->preferred_language ?? null, function () use ($recipient, $accepterName, $targetName, $tenantId): void {
            try {
                TenantContext::runForTenant($tenantId, function () use ($recipient, $accepterName, $targetName, $tenantId): void {
                    $name = UserDisplayName::resolve($recipient);
                    $builder = EmailTemplateBuilder::make()
                        ->theme('success')
                        ->title(__('emails.verein_federation.invitation_accepted_title'))
                        ->previewText(__('emails.verein_federation.invitation_accepted_preview'))
                        ->greeting($name !== '' ? $name : __('emails.common.fallback_name'))
                        ->paragraph(__('emails.verein_federation.invitation_accepted_body', [
                            'name' => $accepterName,
                            'target' => $targetName,
                        ]));

                    $subject = __('emails.verein_federation.invitation_accepted_subject');

                    if (!EmailDispatchService::sendRaw($recipient->email, $subject, $builder->render(), null, null, null, 'verein_federation', ['tenant_id' => $tenantId])) {
                        Log::warning('[VereinCrossInvitationAccepted] email returned false', [
                            'recipient_id' => $recipient->id ?? null,
                        ]);
                    }
                });
            } catch (Throwable $e) {
                Log::warning('[VereinCrossInvitationAccepted] email failed', [
                    'recipient_id' => $recipient->id ?? null,
                    'error' => $e->getMessage(),
                ]);
            }
        });
    }
}
