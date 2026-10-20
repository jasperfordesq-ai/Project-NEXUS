<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Jobs;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\User;
use App\Services\VolunteerWellbeingService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Emails the people told that a volunteer said they are Low or Struggling.
 *
 * Queued, not sent in the request: one email per staff member and organisation
 * contact took seconds, and the platform runs PHP under mod_php, so the
 * response cannot be flushed before deferred work (see SendPasswordResetEmail).
 * The volunteer who has just asked for support is not kept waiting for it.
 * Bells are created in the request; only the emails come here.
 *
 * Each recipient is a row of vol_wellbeing_alert_notifications (channel
 * 'email', status 'queued'). The row records the outcome, so a retry after one
 * failure sends only to the people not yet reached, and a job that dies leaves
 * an honest 'failed' on every address it never got to.
 *
 * Each email renders in its recipient's own language, and never carries the
 * volunteer's note.
 */
final class SendVolunteerLowMoodEmails implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 3;
    public int $timeout = 120;

    /**
     * @param list<int> $logRowIds vol_wellbeing_alert_notifications ids, channel 'email'
     */
    public function __construct(
        public readonly int $tenantId,
        public readonly int $volunteerId,
        public readonly string $volunteerName,
        public readonly int $mood,
        public readonly array $logRowIds,
    ) {
        $this->onQueue('emails');
    }

    public function handle(): void
    {
        TenantContext::runForTenant($this->tenantId, function (): void {
            $rows = $this->rows()->where('status', 'queued')->get();
            if ($rows->isEmpty()) {
                return;
            }

            $userIds = $rows->pluck('recipient_user_id')->filter()->map(fn ($id) => (int) $id)->unique()->all();
            // A recipient may belong to the community above; each row was scoped when written.
            $users = $userIds === [] ? collect() : User::withoutGlobalScopes()->whereIn('id', $userIds)
                ->where('status', 'active')
                ->get(['id', 'tenant_id', 'email', 'first_name', 'last_name', 'name', 'profile_type', 'organization_name',
                    'preferred_language', 'role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god'])
                ->keyBy('id');

            // The volunteer's own copy says how many OTHER people were told.
            $othersTold = (int) $rows->count() + (int) $this->rows()->where('status', '!=', 'queued')->count();

            foreach ($rows as $row) {
                $recipient = null;
                $locale = null;
                if ($row->recipient_user_id !== null) {
                    $recipient = $users->get((int) $row->recipient_user_id);
                    if ($recipient === null || trim((string) $recipient->email) === '') {
                        $this->mark((int) $row->id, 'failed', 'no_email');
                        continue;
                    }
                    $locale = $recipient;
                } else {
                    $recipient = (object) ['email' => (string) $row->recipient_email];
                    $locale = (string) config('app.locale', 'en');
                }

                try {
                    $sent = (bool) LocaleContext::withLocale($locale, fn () => VolunteerWellbeingService::sendLowMoodEmail(
                        $recipient,
                        $this->tenantId,
                        $this->volunteerId,
                        $this->volunteerName,
                        $this->mood,
                        (string) $row->tier,
                        $row->organization_name !== null ? (string) $row->organization_name : null,
                        $row->alert_id !== null ? (int) $row->alert_id : null,
                        max(0, $othersTold - 1),
                        $row->organization_id !== null ? (int) $row->organization_id : null
                    ));
                    $this->mark((int) $row->id, $sent ? 'sent' : 'failed', $sent ? null : 'send_false');
                } catch (\Throwable $e) {
                    Log::error('SendVolunteerLowMoodEmails: one recipient failed', [
                        'row_id' => $row->id,
                        'volunteer_id' => $this->volunteerId,
                        'error' => $e->getMessage(),
                    ]);
                    $this->mark((int) $row->id, 'failed', 'exception');
                }
            }
        });
    }

    /** The job itself died (timeout, lost worker): every address not yet reached is recorded as failed. */
    public function failed(\Throwable $e): void
    {
        try {
            $count = $this->rows()->where('status', 'queued')->update([
                'status' => 'failed',
                'error_code' => 'job_failed',
                'updated_at' => now(),
            ]);
        } catch (\Throwable $inner) {
            $count = 'unknown';
        }
        Log::error('SendVolunteerLowMoodEmails: job failed', [
            'tenant_id' => $this->tenantId,
            'volunteer_id' => $this->volunteerId,
            'rows' => $this->logRowIds,
            'marked_failed' => $count,
            'error' => $e->getMessage(),
        ]);
    }

    private function rows(): \Illuminate\Database\Query\Builder
    {
        return DB::table('vol_wellbeing_alert_notifications')
            ->where('tenant_id', $this->tenantId)
            ->where('channel', 'email')
            ->whereIn('id', $this->logRowIds);
    }

    private function mark(int $rowId, string $status, ?string $errorCode): void
    {
        DB::table('vol_wellbeing_alert_notifications')
            ->where('id', $rowId)
            ->where('tenant_id', $this->tenantId)
            ->update(['status' => $status, 'error_code' => $errorCode, 'updated_at' => now()]);
    }
}
