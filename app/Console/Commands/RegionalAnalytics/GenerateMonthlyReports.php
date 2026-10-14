<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands\RegionalAnalytics;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Services\EmailDispatchService;
use App\Services\RegionalAnalytics\RegionalAnalyticsService;
use App\Services\RegionalAnalytics\RegionalReportPdfGenerator;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * AG59 - Generate monthly regional analytics reports for active subscriptions.
 *
 * Runs on the 1st of each month at 06:00 (registered in bootstrap/app.php).
 * Per active subscription:
 *   - Resolves last calendar month
 *   - Builds the bucketed payload (privacy-preserving)
 *   - Renders PDF and stores it
 *   - Inserts a regional_analytics_reports row
 *   - Emails the PDF link to recipient_emails
 */
class GenerateMonthlyReports extends Command
{
    protected $signature = 'regional-analytics:generate-monthly {--subscription= : Limit to a single subscription id}';

    protected $description = 'Generate monthly regional analytics reports for active subscriptions';

    public function handle(
        RegionalAnalyticsService $analytics,
        RegionalReportPdfGenerator $pdf
    ): int {
        $now = Carbon::now();
        $periodStart = $now->copy()->subMonthNoOverflow()->startOfMonth();
        $periodEnd = $now->copy()->subMonthNoOverflow()->endOfMonth();
        $periodLabel = $periodStart->format('Y-m');

        $query = DB::table('regional_analytics_subscriptions')
            ->select([
                'id', 'tenant_id', 'contact_email', 'contact_language',
                'enabled_modules', 'status',
            ])
            ->whereIn('status', ['active', 'trialing']);

        if ($subId = $this->option('subscription')) {
            $query->where('id', (int) $subId);
        }

        $subs = $query->get();
        $this->info(sprintf('Generating reports for %d subscription(s) - period %s', $subs->count(), $periodLabel));

        foreach ($subs as $sub) {
            $reportId = null;
            try {
                TenantContext::setById((int) $sub->tenant_id);

                $existingSentReport = DB::table('regional_analytics_reports')
                    ->where('subscription_id', $sub->id)
                    ->where('tenant_id', $sub->tenant_id)
                    ->where('report_type', 'monthly_summary')
                    ->where('period_start', $periodStart->toDateString())
                    ->where('status', 'sent')
                    ->first(['id']);

                if ($existingSentReport) {
                    $this->info(sprintf(
                        '  - subscription %d: report %d already sent for %s, skipping',
                        $sub->id,
                        $existingSentReport->id,
                        $periodLabel
                    ));
                    continue;
                }

                $modules = is_string($sub->enabled_modules ?? null)
                    ? (json_decode($sub->enabled_modules, true) ?: [])
                    : [];

                $payload = $analytics->buildDashboardPayload(
                    (int) $sub->tenant_id,
                    'last_30d',
                    $modules
                );
                // Override the period to be the previous calendar month.
                $payload['period'] = $periodLabel;
                $payload['period_start'] = $periodStart->toDateString();
                $payload['period_end'] = $periodEnd->toDateString();

                $reportId = DB::table('regional_analytics_reports')->insertGetId([
                    'subscription_id' => $sub->id,
                    'tenant_id' => $sub->tenant_id,
                    'report_type' => 'monthly_summary',
                    'period_start' => $periodStart->toDateString(),
                    'period_end' => $periodEnd->toDateString(),
                    'status' => 'queued',
                    'recipient_emails' => json_encode([$sub->contact_email]),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                $fileUrl = $pdf->generateAndStore($payload, (int) $sub->id, $periodLabel);

                DB::table('regional_analytics_reports')->where('id', $reportId)->update([
                    'status' => 'generated',
                    'generated_at' => now(),
                    'file_url' => $fileUrl,
                    'payload_json' => json_encode($payload),
                    'updated_at' => now(),
                ]);

                $mailResult = $this->mailReport($sub, $fileUrl, $periodLabel);

                DB::table('regional_analytics_reports')->where('id', $reportId)->update([
                    'status' => $mailResult['sent'] ? 'sent' : 'failed',
                    'error_message' => $mailResult['sent'] ? null : $mailResult['error'],
                    'updated_at' => now(),
                ]);

                $this->info(sprintf(
                    '  - subscription %d: report %d generated%s',
                    $sub->id,
                    $reportId,
                    $mailResult['sent'] ? ' and emailed' : ' but email failed'
                ));
            } catch (\Throwable $e) {
                $this->error(sprintf('  - subscription %d failed: %s', $sub->id, $e->getMessage()));
                if ($reportId !== null) {
                    DB::table('regional_analytics_reports')->where('id', $reportId)->update([
                        'status' => 'failed',
                        'error_message' => $e->getMessage(),
                        'updated_at' => now(),
                    ]);
                }
            } finally {
                TenantContext::reset();
            }
        }

        return self::SUCCESS;
    }

    /**
     * @return array{sent:bool,error:string|null}
     */
    private function mailReport(object $sub, string $fileUrl, string $periodLabel): array
    {
        try {
            $email = (string) ($sub->contact_email ?? '');
            if ($email === '') {
                return ['sent' => false, 'error' => 'missing_recipient_email'];
            }
            $tenantId = (int) ($sub->tenant_id ?? 0);
            if ($tenantId <= 0) {
                return ['sent' => false, 'error' => 'missing_subscription_tenant'];
            }

            // Render subject + body in the recipient's preferred language.
            // Without this wrap the queue worker's default locale (en) leaks through.
            $language = (string) ($sub->contact_language ?? 'en') ?: 'en';

            return LocaleContext::withLocale($language, function () use ($email, $fileUrl, $periodLabel, $tenantId): array {
                // Route through the platform Mailer. The Laravel Mail facade uses
                // SMTP in production and does not create unified audit evidence.
                $body = '<p>' . e(__('emails.regional_analytics.report_ready', ['period' => $periodLabel])) . '</p>'
                    . '<p><a href="' . e($fileUrl) . '">' . e(__('emails.regional_analytics.download_report')) . '</a></p>'
                    . '<p>' . e(__('emails.regional_analytics.privacy_note')) . '</p>';

                if (!EmailDispatchService::sendRaw(
                    $email,
                    (string) __('emails.regional_analytics.subject', ['period' => $periodLabel]),
                    $body,
                    null,
                    null,
                    null,
                    'regional_analytics',
                    ['tenant_id' => $tenantId]
                )) {
                    Log::warning('Regional analytics report email send returned false', [
                        'tenant_id' => $tenantId,
                    ]);
                    return ['sent' => false, 'error' => 'email_dispatch_returned_false'];
                }

                return ['sent' => true, 'error' => null];
            });
        } catch (\Throwable $e) {
            Log::warning('Regional analytics report email exception', [
                'tenant_id' => $sub->tenant_id ?? null,
                'error' => $e->getMessage(),
            ]);
            return ['sent' => false, 'error' => $e->getMessage()];
        }
    }
}
