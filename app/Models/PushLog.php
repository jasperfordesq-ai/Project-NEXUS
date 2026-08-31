<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * PushLog — provider-acceptance observability for device push (web + FCM).
 *
 * One row per fanOutPush() that reached the send, whatever the outcome. All writes are
 * best-effort and guarded so push and the HTTP request are never affected by a logging
 * failure.
 *
 * 🔴 "Nobody had a device" used to write NO ROW, and that made the log unable to answer
 * the only question anyone asks of it. `NotificationDispatcher` says so itself, about
 * production: *"a `new_message` bell with no push_log line beside it. It reads as 'the send
 * never happened' when it was 'the send found no devices'."* A tenant-context bug was fixed
 * on 2026-08-21 while that ambiguity was left in place, so the same silence still meant two
 * completely different things: no push was attempted, or a push was attempted and had
 * nowhere to go.
 *
 * Measured on 2026-08-24: a real message to a member produced a correct bell,
 * `fcm_device_tokens` held **zero** rows, and `push_log` held zero rows — with no way to
 * tell those two facts apart from the log. It now records a `no_targets` row, which is what
 * distinguishes "no one has installed the app" from "delivery is broken".
 */
class PushLog extends Model
{
    protected $table = 'push_log';

    // Only created_at is tracked.
    public const UPDATED_AT = null;

    protected $fillable = [
        'tenant_id', 'user_id', 'activity_type', 'title',
        'web_ok', 'fcm_sent', 'fcm_failed', 'status', 'error', 'created_at',
    ];

    protected $casts = [
        'web_ok' => 'boolean',
        'fcm_sent' => 'integer',
        'fcm_failed' => 'integer',
        'created_at' => 'datetime',
    ];

    /**
     * Record a push provider outcome. Computes a coarse status from the per-channel
     * results and inserts a row — including when there was nothing to send to, which is
     * recorded as `no_targets` rather than dropped. See the class note: a missing row was
     * indistinguishable from a push that never ran.
     *
     * WebPush returns only a bool, and `false` usually means "no browser
     * subscription" rather than a real failure, so a bare `false` is NOT
     * treated as a failure here; only exceptions/errors collected in $errors
     * (and FCM's failed count) count as failures.
     *
     * @param string[] $errors
     */
    public static function record(?int $tenantId, int $userId, string $activityType, ?string $title, ?bool $webOk, int $fcmSent, int $fcmFailed, array $errors = []): void
    {
        try {
            if (!Schema::hasTable('push_log')) {
                return;
            }

            $anySent = ($webOk === true) || $fcmSent > 0;
            $anyFail = $fcmFailed > 0 || count($errors) > 0;

            /*
              🔴 No longer a no-op. `no_targets` means the send ran and found no device or
              browser subscription for this member — the commonest real answer to "why did
              my phone not buzz", and the one the log could not previously give.
            */
            // `delivered` is the historical stored value and means provider
            // accepted, not that a handset displayed the notification.
            $status = match (true) {
                $anySent && $anyFail => 'partial',
                $anySent => 'delivered',
                $anyFail => 'failed',
                default => 'no_targets',
            };

            $errorText = empty($errors) ? null : mb_substr(implode(' | ', $errors), 0, 2000);

            DB::table('push_log')->insert([
                'tenant_id'     => $tenantId,
                'user_id'       => $userId > 0 ? $userId : null,
                'activity_type' => mb_substr($activityType, 0, 64),
                'title'         => $title !== null ? mb_substr($title, 0, 255) : null,
                'web_ok'        => $webOk === null ? null : ($webOk ? 1 : 0),
                'fcm_sent'      => max(0, $fcmSent),
                'fcm_failed'    => max(0, $fcmFailed),
                'status'        => $status,
                'error'         => $errorText,
                'created_at'    => now(),
            ]);
        } catch (\Throwable $e) {
            // Observability must never break delivery.
            Log::debug('[PushLog] record failed: ' . $e->getMessage());
        }
    }

    /**
     * Aggregate push delivery stats for a tenant over the last $days.
     * Safe to call before the table exists (returns zeros).
     *
     * @return array<string,mixed>
     */
    public static function stats(int $tenantId, int $days = 7): array
    {
        $empty = [
            'window_days'   => $days,
            'total'         => 0,
            'delivered'     => 0,
            'partial'       => 0,
            'failed'        => 0,
            'fcm_sent'      => 0,
            'fcm_failed'    => 0,
            'web_delivered' => 0,
        ];

        try {
            if (!Schema::hasTable('push_log')) {
                return $empty;
            }

            $since = now()->subDays(max(1, $days));
            $base = DB::table('push_log')
                ->where('tenant_id', $tenantId)
                ->where('created_at', '>=', $since);

            $byStatus = (clone $base)
                ->select('status', DB::raw('COUNT(*) as c'))
                ->groupBy('status')
                ->pluck('c', 'status');

            $sums = (clone $base)
                ->selectRaw('COALESCE(SUM(fcm_sent),0) as s, COALESCE(SUM(fcm_failed),0) as f, COALESCE(SUM(web_ok),0) as w')
                ->first();

            return [
                'window_days'   => $days,
                'total'         => (int) $byStatus->sum(),
                'delivered'     => (int) ($byStatus['delivered'] ?? 0),
                'partial'       => (int) ($byStatus['partial'] ?? 0),
                'failed'        => (int) ($byStatus['failed'] ?? 0),
                'fcm_sent'      => (int) ($sums->s ?? 0),
                'fcm_failed'    => (int) ($sums->f ?? 0),
                'web_delivered' => (int) ($sums->w ?? 0),
            ];
        } catch (\Throwable $e) {
            Log::debug('[PushLog] stats failed: ' . $e->getMessage());
            return $empty;
        }
    }
}
