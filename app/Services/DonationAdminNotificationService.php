<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Facades\Log;

/**
 * DonationAdminNotificationService — notifies tenant admins that a monetary
 * donation was received.
 *
 * Called from the Stripe webhook success path (StripeDonationService::
 * handlePaymentSucceeded) AFTER the donation is marked completed, so it fires
 * once per actually-paid donation. Every step is failure-isolated: a bounced
 * admin email must never fail the webhook, or Stripe would retry the event for
 * days. Each admin's bell + email render in their own preferred_language.
 */
class DonationAdminNotificationService
{
    /**
     * Notify all active tenant admins of a completed donation.
     *
     * @param object $donation A completed vol_donations row (stdClass / DB row)
     */
    public static function notifyDonationReceived(object $donation): void
    {
        $tenantId = (int) ($donation->tenant_id ?? 0);
        if ($tenantId <= 0) {
            return;
        }

        try {
            TenantContext::runForTenant($tenantId, function () use ($donation, $tenantId): void {
                $admins = self::adminRecipients($tenantId);
                if ($admins->isEmpty()) {
                    return;
                }

                $adminPath = '/admin/volunteering/donations';
                $adminUrl = EmailTemplateBuilder::tenantUrl($adminPath);
                $community = (string) TenantContext::getSetting('site_name', 'Project NEXUS');
                $amountDisplay = self::formatAmount($donation);
                $donorDisplay = self::donorDisplay($donation);

                foreach ($admins as $admin) {
                    self::notifyAdmin($admin, $donation, $adminPath, $adminUrl, $community, $amountDisplay, $donorDisplay);
                }
            });
        } catch (\Throwable $e) {
            Log::warning('[DonationAdminNotificationService] notifyDonationReceived failed', [
                'donation_id' => $donation->id ?? null,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * @return \Illuminate\Support\Collection<int, User>
     */
    private static function adminRecipients(int $tenantId)
    {
        return User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where(function ($query): void {
                $query->whereIn('role', ['admin', 'tenant_admin', 'super_admin', 'god'])
                    ->orWhere('is_admin', 1)
                    ->orWhere('is_super_admin', 1)
                    ->orWhere('is_tenant_super_admin', 1)
                    ->orWhere('is_god', 1);
            })
            ->get(['id', 'tenant_id', 'email', 'first_name', 'last_name', 'profile_type', 'organization_name', 'name', 'preferred_language']);
    }

    private static function notifyAdmin(
        User $admin,
        object $donation,
        string $adminPath,
        string $adminUrl,
        string $community,
        string $amountDisplay,
        string $donorDisplay
    ): void {
        try {
            LocaleContext::withLocale($admin, function () use ($admin, $donation, $adminPath, $adminUrl, $community, $amountDisplay, $donorDisplay): void {
                self::createBellNotification($admin, $donation, $adminPath, $amountDisplay, $donorDisplay);

                if (empty($admin->email)) {
                    return;
                }

                $adminName = $admin->first_name ?: ($admin->name ?: __('emails.common.fallback_name'));

                $infoCard = [
                    __('emails.donation_admin.amount_label') => $amountDisplay,
                    __('emails.donation_admin.donor_label') => $donorDisplay,
                    __('emails.donation_admin.date_label') => \Carbon\Carbon::now()->locale(\App\I18n\FormattingLocale::carbon())->isoFormat('LL'),
                ];

                $fund = self::fundLabel($donation);
                if ($fund !== null) {
                    $infoCard[__('emails.donation_admin.fund_label')] = $fund;
                }

                $message = trim((string) ($donation->message ?? ''));
                if ($message !== '') {
                    $infoCard[__('emails.donation_admin.message_label')] = $message;
                }

                $html = EmailTemplateBuilder::make()
                    ->theme('success')
                    ->title(__('emails.donation_admin.created_title'))
                    ->previewText(__('emails.donation_admin.created_preview', [
                        'donor' => $donorDisplay,
                        'amount' => $amountDisplay,
                        'community' => $community,
                    ]))
                    ->greeting($adminName)
                    ->paragraph(__('emails.donation_admin.created_body'))
                    ->infoCard($infoCard)
                    ->button(__('emails.donation_admin.review_cta'), $adminUrl)
                    ->render();

                $sent = EmailDispatchService::sendRaw(
                    (string) $admin->email,
                    __('emails.donation_admin.created_subject', ['amount' => $amountDisplay, 'community' => $community]),
                    $html,
                    null,
                    null,
                    null,
                    'donation_admin',
                    [
                        'tenant_id' => (int) $donation->tenant_id,
                        'source' => 'DonationAdminNotificationService',
                        'idempotency_key' => 'donation-received:' . (int) ($donation->id ?? 0) . ':' . (int) $admin->id,
                    ],
                );

                if (!$sent) {
                    Log::warning('[DonationAdminNotificationService] admin donation email returned false', [
                        'donation_id' => $donation->id ?? null,
                        'admin_id' => $admin->id,
                    ]);
                }
            });
        } catch (\Throwable $e) {
            Log::warning('[DonationAdminNotificationService] admin notification failed', [
                'donation_id' => $donation->id ?? null,
                'admin_id' => $admin->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private static function createBellNotification(
        User $admin,
        object $donation,
        string $adminPath,
        string $amountDisplay,
        string $donorDisplay
    ): void {
        try {
            $message = __('emails.donation_admin.created_bell', [
                'amount' => $amountDisplay,
                'donor' => $donorDisplay,
            ]);

            Notification::createNotification(
                (int) $admin->id,
                $message,
                $adminPath,
                'donation',
                false,
                (int) $donation->tenant_id,
            );

            NotificationDispatcher::fanOutPush((int) $admin->id, 'donation', $message, $adminPath);
        } catch (\Throwable $e) {
            Log::warning('[DonationAdminNotificationService] bell notification failed', [
                'donation_id' => $donation->id ?? null,
                'admin_id' => $admin->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private static function formatAmount(object $donation): string
    {
        return number_format((float) ($donation->amount ?? 0), 2)
            . ' ' . strtoupper((string) ($donation->currency ?? 'EUR'));
    }

    /**
     * Admins see the donor's name even when the donation is marked anonymous —
     * they need it for reconciliation / Gift Aid — but the "anonymous" intent
     * is surfaced so they don't reveal it publicly. Falls back to a generic
     * label only when no name was captured (e.g. a guest anonymous donation).
     */
    private static function donorDisplay(object $donation): string
    {
        $donorName = trim((string) ($donation->donor_name ?? ''));

        if ($donorName === '') {
            return __('emails.donation_admin.anonymous_donor');
        }

        if (!empty($donation->is_anonymous)) {
            return $donorName . ' ' . __('emails.donation_admin.anonymous_note');
        }

        return $donorName;
    }

    /**
     * Returns a human label for the fund, or null for the default "general"
     * fund (not worth a row in the info card).
     */
    private static function fundLabel(object $donation): ?string
    {
        $fund = trim((string) ($donation->fund_code ?? ''));

        if ($fund === '' || $fund === 'general') {
            return null;
        }

        return ucfirst($fund);
    }
}
