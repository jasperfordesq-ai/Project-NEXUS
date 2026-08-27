<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * DonationEmailService - Sends email notifications for credit donations.
 *
 * Sends a confirmation to the donor and a notification to the recipient
 * when a credit donation is made between members.
 */
class DonationEmailService
{
    /**
     * Send donation emails to both donor and recipient.
     *
     * Wraps each send in an individual try/catch so one failure doesn't block the other.
     *
     * @param int $tenantId Tenant ID
     * @param object $donor Donor User model instance
     * @param object $recipient Recipient User model instance
     * @param float $amount Amount donated
     * @param string|null $message Optional personal message from donor
     * @return array{donor_sent:bool,recipient_sent:bool}
     */
    public static function sendDonationEmails(
        int $tenantId,
        object $donor,
        object $recipient,
        float $amount,
        ?string $message
    ): array {
        $previousTenantId = TenantContext::currentId();
        TenantContext::setById($tenantId);
        $result = [
            'donor_sent' => false,
            'recipient_sent' => false,
        ];

        try {
            $walletUrl = EmailTemplateBuilder::tenantUrl('/wallet');
            $messageText = $message ?: __('emails.donation.no_message');

            try {
                if (!empty($donor->email)) {
                    $result['donor_sent'] = (bool) LocaleContext::withLocale($donor, function () use ($tenantId, $donor, $recipient, $amount, $messageText, $walletUrl): bool {
                        $donorName = $donor->first_name ?? $donor->name ?? __('emails.common.fallback_name');
                        $recipientFullName = UserDisplayName::resolve($recipient)
                            ?: ($recipient->name ?? __('emails.common.fallback_member_name'));

                        $html = EmailTemplateBuilder::make()
                            ->theme('success')
                            ->title(__('emails.donation.sent_title'))
                            ->previewText(__('emails.donation.sent_preview', ['amount' => $amount, 'recipient' => $recipientFullName]))
                            ->greeting($donorName)
                            ->paragraph(__('emails.donation.sent_greeting'))
                            ->paragraph(__('emails.donation.sent_body', ['amount' => $amount, 'recipient' => $recipientFullName]))
                            ->infoCard([
                                __('emails.donation.sent_message_label') => $messageText,
                            ])
                            ->button(__('emails.donation.sent_cta'), $walletUrl)
                            ->render();

                        if (!EmailDispatchService::sendRaw(
                            $donor->email,
                            __('emails.donation.sent_subject', ['amount' => $amount]),
                            $html,
                            null,
                            null,
                            null,
                            'donation',
                            ['tenant_id' => $tenantId]
                        )) {
                            Log::warning('DonationEmailService: donor confirmation send returned false', [
                                'donor_id' => $donor->id ?? null,
                            ]);
                            return false;
                        }

                        return true;
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('DonationEmailService: failed to send donor confirmation', [
                    'donor_id' => $donor->id ?? null,
                    'tenant_id' => $tenantId,
                    'error' => $e->getMessage(),
                ]);
            }

            try {
                if (!empty($recipient->email)) {
                    $result['recipient_sent'] = (bool) LocaleContext::withLocale($recipient, function () use ($tenantId, $donor, $recipient, $amount, $messageText, $walletUrl): bool {
                        $recipientName = $recipient->first_name ?? $recipient->name ?? __('emails.common.fallback_name');
                        $donorFullName = UserDisplayName::resolve($donor)
                            ?: ($donor->name ?? __('emails.common.fallback_member_name'));

                        $html = EmailTemplateBuilder::make()
                            ->theme('success')
                            ->title(__('emails.donation.received_title'))
                            ->previewText(__('emails.donation.received_preview', ['donor' => $donorFullName, 'amount' => $amount]))
                            ->greeting($recipientName)
                            ->paragraph(__('emails.donation.received_greeting'))
                            ->paragraph(__('emails.donation.received_body', ['donor' => $donorFullName, 'amount' => $amount]))
                            ->infoCard([
                                __('emails.donation.received_message_label') => $messageText,
                            ])
                            ->button(__('emails.donation.received_cta'), $walletUrl)
                            ->render();

                        if (!EmailDispatchService::sendRaw(
                            $recipient->email,
                            __('emails.donation.received_subject', ['amount' => $amount, 'donor' => $donorFullName]),
                            $html,
                            null,
                            null,
                            null,
                            'donation',
                            ['tenant_id' => $tenantId]
                        )) {
                            Log::warning('DonationEmailService: recipient notification send returned false', [
                                'recipient_id' => $recipient->id ?? null,
                            ]);
                            return false;
                        }

                        return true;
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('DonationEmailService: failed to send recipient notification', [
                    'recipient_id' => $recipient->id ?? null,
                    'tenant_id' => $tenantId,
                    'error' => $e->getMessage(),
                ]);
            }

            return $result;
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById((int) $previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }
}
