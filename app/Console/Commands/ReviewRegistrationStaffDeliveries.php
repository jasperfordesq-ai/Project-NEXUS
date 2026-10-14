<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Read-only, tenant-scoped evidence inventory for C1 review. */
final class ReviewRegistrationStaffDeliveries extends Command
{
    protected $signature = 'emails:review-registration-staff-deliveries
                            {--tenant= : required tenant id}
                            {--delivery= : optional single delivery id}
                            {--limit=50 : maximum rows, 1 to 100}';

    protected $description = 'Show redacted registration staff-email delivery and receipt evidence';

    public function handle(): int
    {
        $tenant = (string) $this->option('tenant');
        $delivery = $this->option('delivery');
        $limit = (string) $this->option('limit');
        if (!ctype_digit($tenant) || (int) $tenant < 1
            || ($delivery !== null && (!ctype_digit((string) $delivery) || (int) $delivery < 1))
            || !ctype_digit($limit) || (int) $limit < 1 || (int) $limit > 100) {
            $this->error('Provide a positive tenant id, optional positive delivery id, and a limit from 1 to 100.');
            return self::FAILURE;
        }

        $query = DB::table('registration_staff_email_deliveries')
            ->where('tenant_id', (int) $tenant)
            ->orderBy('id')
            ->limit((int) $limit);
        if ($delivery !== null) {
            $query->where('id', (int) $delivery);
        } else {
            $query->whereIn('status', ['captured', 'claimed', 'unknown', 'definite_failure']);
        }
        $rows = $query->get([
            'id', 'tenant_id', 'registrant_user_id', 'recipient_user_id',
            'status', 'attempts', 'dispatch_id', 'last_error_code',
            'claimed_at', 'resolved_at', 'reconciled_from_email_log_id',
        ]);
        foreach ($rows as $row) {
            $counts = ['receipt_count' => 0, 'positive_count' => 0];
            if ($row->dispatch_id !== null) {
                $key = 'admin_new_registration:' . $row->tenant_id . ':'
                    . $row->registrant_user_id . ':' . $row->recipient_user_id;
                $logs = DB::table('email_log')
                    ->where('tenant_id', $row->tenant_id)
                    ->where('dispatch_id', $row->dispatch_id)
                    ->where('category', 'admin_new_registration')
                    ->where('idempotency_key', $key)
                    ->get(['status']);
                $counts['receipt_count'] = $logs->count();
                $counts['positive_count'] = $logs->filter(
                    static fn ($log): bool => in_array($log->status, ['sent', 'delivered'], true)
                )->count();
            }
            $this->line(json_encode([
                'delivery_id' => (int) $row->id,
                'status' => $row->status,
                'attempts' => (int) $row->attempts,
                'dispatch_id' => $row->dispatch_id,
                'error_code' => $row->last_error_code,
                'claimed_at' => $row->claimed_at,
                'resolved_at' => $row->resolved_at,
                'reconciled_email_log_id' => $row->reconciled_from_email_log_id,
                ...$counts,
            ], JSON_THROW_ON_ERROR));
        }
        $this->info('Reviewed delivery rows: ' . $rows->count());
        return self::SUCCESS;
    }
}
