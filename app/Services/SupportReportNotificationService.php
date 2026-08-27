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
use App\Models\SupportReport;
use App\Models\User;
use Illuminate\Support\Facades\Log;

class SupportReportNotificationService
{
    public static function notifyCreated(SupportReport $report): void
    {
        try {
            TenantContext::runForTenant((int) $report->tenant_id, function () use ($report): void {
                $admins = self::adminRecipients((int) $report->tenant_id);
                $adminPath = '/admin/support-reports?report=' . (int) $report->id;
                $adminUrl = EmailTemplateBuilder::tenantUrl($adminPath);

                foreach ($admins as $admin) {
                    self::notifyAdmin($admin, $report, $adminPath, $adminUrl);
                }
            });
        } catch (\Throwable $e) {
            Log::warning('[SupportReportNotificationService] notifyCreated failed', [
                'report_id' => $report->id,
                'tenant_id' => $report->tenant_id,
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

    private static function notifyAdmin(User $admin, SupportReport $report, string $adminPath, string $adminUrl): void
    {
        try {
            LocaleContext::withLocale($admin, function () use ($admin, $report, $adminPath, $adminUrl): void {
                self::createBellNotification($admin, $report, $adminPath);

                if (empty($admin->email) || !self::shouldSendImmediateEmail((string) $report->impact)) {
                    return;
                }

                $adminName = $admin->first_name ?: ($admin->name ?: __('emails.common.fallback_name'));
                $html = EmailTemplateBuilder::make()
                    ->theme(in_array($report->impact, ['blocked', 'major'], true) ? 'danger' : 'warning')
                    ->title(__('emails.support_report.created_title'))
                    ->previewText(__('emails.support_report.created_preview', [
                        'reference' => $report->reference,
                        'impact' => self::translatedImpact((string) $report->impact),
                    ]))
                    ->greeting($adminName)
                    ->paragraph(__('emails.support_report.created_body'))
                    ->infoCard([
                        __('emails.support_report.reference_label') => (string) $report->reference,
                        __('emails.support_report.impact_label') => self::translatedImpact((string) $report->impact),
                        __('emails.support_report.summary_label') => (string) $report->summary,
                        __('emails.support_report.route_label') => $report->route ?: __('emails.support_report.not_provided'),
                    ])
                    ->button(__('emails.support_report.review_cta'), $adminUrl)
                    ->render();

                $sent = EmailDispatchService::sendRaw(
                    (string) $admin->email,
                    __('emails.support_report.created_subject', ['reference' => $report->reference]),
                    $html,
                    null,
                    null,
                    null,
                    'support_report',
                    [
                        'tenant_id' => (int) $report->tenant_id,
                        'source' => 'SupportReportNotificationService',
                        'idempotency_key' => 'support-report-created:' . (int) $report->id . ':' . (int) $admin->id,
                    ],
                );

                if (!$sent) {
                    Log::warning('[SupportReportNotificationService] support report email returned false', [
                        'report_id' => $report->id,
                        'admin_id' => $admin->id,
                    ]);
                }
            });
        } catch (\Throwable $e) {
            Log::warning('[SupportReportNotificationService] admin notification failed', [
                'report_id' => $report->id,
                'admin_id' => $admin->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private static function shouldSendImmediateEmail(string $impact): bool
    {
        return in_array($impact, ['blocked', 'major'], true);
    }

    private static function createBellNotification(User $admin, SupportReport $report, string $adminPath): void
    {
        try {
            Notification::createNotification(
                (int) $admin->id,
                __('emails.support_report.created_bell', [
                    'reference' => $report->reference,
                    'summary' => $report->summary,
                ]),
                $adminPath,
                'support_report',
                true,
                (int) $report->tenant_id,
            );
            \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $admin->id), 'support_report', __('emails.support_report.created_bell', [
                'reference' => $report->reference,
                'summary' => $report->summary,
            ]), $adminPath);
        } catch (\Throwable $e) {
            Log::warning('[SupportReportNotificationService] bell notification failed', [
                'report_id' => $report->id,
                'admin_id' => $admin->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private static function translatedImpact(string $impact): string
    {
        return match ($impact) {
            'blocked' => __('emails.support_report.impact_blocked'),
            'major' => __('emails.support_report.impact_major'),
            'cosmetic' => __('emails.support_report.impact_cosmetic'),
            default => __('emails.support_report.impact_minor'),
        };
    }
}
