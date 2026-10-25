<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\Safeguarding\SafeguardingChoicesEmail;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Sends safeguarding emails to members who already hold choices.
 *
 *   --notice   the one-off explanation to members who chose "only vetted
 *              members may contact me" before its wording was corrected;
 *   (default)  the "your safety choices" summary, to every member with a live
 *              choice who has not had one describing their current choices.
 *
 * Deliberately NOT scheduled: these go to members because an operator decided
 * to send them. Run with --dry-run first; it sends nothing and reports what
 * would happen. Members holding the vetted-only choice are skipped by the
 * summary run until they have had the notice, so nobody gets two emails about
 * the same thing on the same day.
 */
class SendSafeguardingChoiceSummaries extends Command
{
    protected $signature = 'safeguarding:send-choice-summaries
        {--tenant= : Only this community (id)}
        {--notice : Send the one-off vetted-only explanation instead of the summary}
        {--dry-run : Report what would be sent; send nothing}';

    protected $description = "Email members about their own safeguarding choices (dry-run first)";

    public function handle(SafeguardingChoicesEmail $email): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $notice = (bool) $this->option('notice');

        $query = DB::table('user_safeguarding_preferences as p')
            ->join('tenant_safeguarding_options as o', 'o.id', '=', 'p.option_id')
            ->join('users as u', function ($join): void {
                $join->on('u.id', '=', 'p.user_id')->on('u.tenant_id', '=', 'p.tenant_id');
            })
            ->whereNull('p.revoked_at')
            ->where('o.is_active', 1)
            ->where('u.status', 'active')
            ->where('o.option_key', $notice ? '=' : '!=', $notice ? 'requires_vetted_partners' : 'none_apply')
            ->select(['p.tenant_id', 'p.user_id'])
            ->distinct()
            ->orderBy('p.tenant_id')
            ->orderBy('p.user_id');
        if ($this->option('tenant') !== null) {
            $query->where('p.tenant_id', (int) $this->option('tenant'));
        }

        $tally = [];
        foreach ($query->get() as $row) {
            $tenantId = (int) $row->tenant_id;
            $userId = (int) $row->user_id;

            if (! $notice && $this->owedNotice($tenantId, $userId)) {
                $status = 'waiting_for_notice';
            } else {
                $status = $notice
                    ? $email->sendVettedOptionNotice($tenantId, $userId, $dryRun)
                    : $email->sendSummary($tenantId, $userId, $dryRun);
            }
            $tally[$status] = ($tally[$status] ?? 0) + 1;
        }

        ksort($tally);
        $this->info(($dryRun ? '[dry run] ' : '') . ($notice ? 'Vetted-only notice' : 'Choices summary'));
        if ($tally === []) {
            $this->info('No members to email.');
        }
        foreach ($tally as $status => $count) {
            $this->line(sprintf('  %-20s %d', $status, $count));
        }

        return ($tally['failed'] ?? 0) > 0 ? self::FAILURE : self::SUCCESS;
    }

    private function owedNotice(int $tenantId, int $userId): bool
    {
        $holdsVettedOnly = DB::table('user_safeguarding_preferences as p')
            ->join('tenant_safeguarding_options as o', 'o.id', '=', 'p.option_id')
            ->where('p.tenant_id', $tenantId)
            ->where('p.user_id', $userId)
            ->whereNull('p.revoked_at')
            ->where('o.is_active', 1)
            ->where('o.option_key', 'requires_vetted_partners')
            ->exists();

        return $holdsVettedOnly && ! DB::table('safeguarding_member_emails')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('kind', SafeguardingChoicesEmail::KIND_VETTED_NOTICE)
            ->exists();
    }
}
