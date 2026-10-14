<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Events\UserRegistered;
use App\Listeners\NotifyAdminOfNewRegistration;
use App\Models\User;
use App\Services\RegistrationStaffEmailDeliveryLedger;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** Recover only never-attempted transactionally captured staff alerts. */
final class RecoverCapturedRegistrationStaffAlerts extends Command
{
    protected $signature = 'emails:recover-captured-registration-staff
                            {--dry-run : report counts without sending}
                            {--tenant= : restrict to one tenant id}
                            {--limit=20 : maximum registrations in one run}';

    protected $description = 'Recover unsent captured registration staff alerts without retrying ambiguous sends';

    public function handle(): int
    {
        $tenantOption = $this->option('tenant');
        if ($tenantOption !== null && (!ctype_digit((string) $tenantOption) || (int) $tenantOption < 1)) {
            $this->error('The tenant option must be a positive integer.');
            return self::FAILURE;
        }
        $limitOption = (string) $this->option('limit');
        if (!ctype_digit($limitOption) || (int) $limitOption < 1 || (int) $limitOption > 50) {
            $this->error('The limit must be between 1 and 50.');
            return self::FAILURE;
        }

        // The two-minute gap lets normal inline delivery finish. Rows older
        // than seven days require operator review before any delayed notice.
        $query = DB::table('registration_staff_email_deliveries')
            ->where('status', 'captured')
            ->where('created_at', '<=', now()->subMinutes(2))
            ->where('created_at', '>=', now()->subDays(7))
            ->selectRaw('tenant_id, registrant_user_id, MIN(created_at) AS oldest_at')
            ->groupBy('tenant_id', 'registrant_user_id')
            ->orderBy('oldest_at')
            ->limit((int) $limitOption);
        if ($tenantOption !== null) {
            $query->where('tenant_id', (int) $tenantOption);
        }
        $registrations = $query->get();
        if ($this->option('dry-run')) {
            $this->info('Captured registration groups eligible for recovery: ' . $registrations->count());
            $staleQuery = DB::table('registration_staff_email_deliveries')
                ->where('status', 'claimed')
                ->where('claimed_at', '<=', now()->subMinutes(20));
            if ($tenantOption !== null) {
                $staleQuery->where('tenant_id', (int) $tenantOption);
            }
            $this->info('Stale claims requiring UNKNOWN hold: ' . $staleQuery->count());
            $unknownQuery = DB::table('registration_staff_email_deliveries')->where('status', 'unknown');
            if ($tenantOption !== null) {
                $unknownQuery->where('tenant_id', (int) $tenantOption);
            }
            $this->info('Unknown deliveries awaiting reconciliation: ' . $unknownQuery->count());
            return self::SUCCESS;
        }

        $heldUnknown = RegistrationStaffEmailDeliveryLedger::holdStaleClaimsUnknown(
            $tenantOption !== null ? (int) $tenantOption : null,
            100,
        );
        $reconciledAccepted = RegistrationStaffEmailDeliveryLedger::reconcileConfirmedMailLog(
            $tenantOption !== null ? (int) $tenantOption : null,
            100,
        );
        $attempted = 0;
        $cancelled = 0;
        $failed = 0;
        $unresolvedRecipients = 0;
        $deadline = microtime(true) + 45.0;
        $listener = app(NotifyAdminOfNewRegistration::class);
        foreach ($registrations as $row) {
            if (microtime(true) >= $deadline) {
                break;
            }
            $tenantId = (int) $row->tenant_id;
            $registrantId = (int) $row->registrant_user_id;
            try {
                $exists = DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $registrantId)
                    ->whereNull('deleted_at')
                    ->whereIn('status', ['pending', 'active'])
                    ->exists();
                if (!$exists) {
                    $cancelled += RegistrationStaffEmailDeliveryLedger::cancelCapturedForRegistrant($tenantId, $registrantId);
                    continue;
                }
                // The listener absorbs per-recipient failures, so a normal
                // return is not success. Judge each captured row by where the
                // ledger says it ended up.
                $capturedIds = DB::table('registration_staff_email_deliveries')
                    ->where('tenant_id', $tenantId)
                    ->where('registrant_user_id', $registrantId)
                    ->where('status', 'captured')
                    ->pluck('id');
                // Call only the staff listener. Re-dispatching UserRegistered
                // would also re-run welcome/activation listeners.
                $user = new User();
                $user->id = $registrantId;
                $listener->handle(new UserRegistered($user, $tenantId));
                $attempted++;
                $unresolved = DB::table('registration_staff_email_deliveries')
                    ->whereIn('id', $capturedIds)
                    ->whereNotIn('status', ['accepted', 'cancelled'])
                    ->count();
                if ($unresolved > 0) {
                    $failed++;
                    $unresolvedRecipients += $unresolved;
                    Log::warning('Captured registration staff alert recovery left recipients unresolved', [
                        'tenant_id' => $tenantId,
                        'registrant_id' => $registrantId,
                        'unresolved_recipients' => $unresolved,
                    ]);
                }
            } catch (\Throwable $e) {
                $failed++;
                Log::error('Captured registration staff alert recovery failed', [
                    'tenant_id' => $tenantId,
                    'registrant_id' => $registrantId,
                    'exception_class' => get_class($e),
                ]);
            }
        }
        $this->info("Captured registration recovery: attempted={$attempted} cancelled={$cancelled} held_unknown={$heldUnknown} reconciled_accepted={$reconciledAccepted} failed={$failed} unresolved_recipients={$unresolvedRecipients}");
        return $failed === 0 ? self::SUCCESS : self::FAILURE;
    }
}
