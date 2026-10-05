<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Core\TenantContext;
use App\Services\VolunteerQualificationService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Nightly pass over the volunteer qualifications register (spec §5).
 *
 * Per tenant: mark records past their expiry date as expired; tell the
 * volunteer (bell + email) once when a record expires and once when it is
 * about to; send each organisation the volunteer is linked to one digest per
 * owner/admin. The window and the on/off switches come from the tenant's
 * `credential_expiry` reminder setting. Reminder stamps on the record are the
 * dedupe; a changed expiry date clears them.
 */
class QualificationExpiryCommand extends Command
{
    protected $signature = 'volunteering:qualification-expiry
        {--dry-run : Report what would change without writing or sending anything}
        {--tenant= : Only process this tenant id}';

    protected $description = 'Expire volunteer qualifications past their date and remind volunteers and their organisations once before and once after.';

    public function __construct(
        private readonly VolunteerQualificationService $qualifications,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $onlyTenant = $this->option('tenant');
        $tenantIds = $this->tenantIds(is_numeric($onlyTenant) ? (int) $onlyTenant : null);

        $totals = ['expired' => 0, 'expired_notices' => 0, 'reminders' => 0, 'org_digests' => 0];
        $disabledTenants = 0;

        foreach ($tenantIds as $tenantId) {
            try {
                $result = TenantContext::runForTenant($tenantId, fn (): array => $this->qualifications->runExpiry($tenantId, $dryRun));
            } catch (\Throwable $e) {
                Log::error('Qualification expiry pass failed for tenant', [
                    'tenant_id' => $tenantId,
                    'exception_class' => $e::class,
                    'message' => $e->getMessage(),
                ]);
                $this->warn(sprintf('Tenant %d: failed (%s).', $tenantId, $e::class));
                continue;
            }

            if (! $result['notifications_enabled']) {
                $disabledTenants++;
            }
            foreach ($totals as $key => $_) {
                $totals[$key] += $result[$key];
            }

            $this->line(sprintf(
                'Tenant %d: %d expired, %d expired notice%s, %d reminder%s, %d organisation digest%s%s.',
                $tenantId,
                $result['expired'],
                $result['expired_notices'],
                $result['expired_notices'] === 1 ? '' : 's',
                $result['reminders'],
                $result['reminders'] === 1 ? '' : 's',
                $result['org_digests'],
                $result['org_digests'] === 1 ? '' : 's',
                $result['notifications_enabled'] ? '' : ' (reminders switched off for this community)',
            ));
        }

        $this->info(sprintf(
            '%s: %d expired, %d expired notices, %d reminders, %d organisation digests across %d tenant%s%s.',
            $dryRun ? 'DRY RUN' : 'Done',
            $totals['expired'],
            $totals['expired_notices'],
            $totals['reminders'],
            $totals['org_digests'],
            count($tenantIds),
            count($tenantIds) === 1 ? '' : 's',
            $disabledTenants > 0 ? sprintf(' (%d with reminders switched off)', $disabledTenants) : '',
        ));

        return self::SUCCESS;
    }

    /**
     * Tenants with anything the pass could act on: a live record with an
     * expiry date, or an expired record nobody has been told about yet.
     *
     * @return list<int>
     */
    private function tenantIds(?int $onlyTenant): array
    {
        $query = DB::table('vol_qualifications')
            ->where(function ($inner): void {
                $inner->where(function ($live): void {
                    $live->whereIn('status', ['recorded', 'confirmed'])->whereNotNull('expires_at');
                })->orWhere(function ($expired): void {
                    $expired->where('status', 'expired')->whereNull('expired_notice_sent_at');
                });
            });

        if ($onlyTenant !== null) {
            $query->where('tenant_id', $onlyTenant);
        }

        return array_values(array_map('intval', $query->distinct()->orderBy('tenant_id')->pluck('tenant_id')->all()));
    }
}
