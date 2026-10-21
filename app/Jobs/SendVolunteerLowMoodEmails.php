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

    /** @var array<int, int> seconds before each retry */
    public array $backoff = [60, 600];
    /**
     * Below the Redis queue's retry_after (90 s), or a slow mail server gets the
     * job handed to a second worker while the first is still sending, and people
     * are emailed twice (deep audit O1, 21 Oct 2026). 55 s is the Horizon
     * supervisor's own value.
     */
    public int $timeout = 55;

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

            // The volunteer's own copy says how many OTHER people were told: counted
            // from the record, without the ones that failed (deep audit S11).
            $checkinId = (int) ($rows->first()->checkin_id ?? 0);
            $othersTold = VolunteerWellbeingService::peopleToldFor($this->tenantId, $checkinId);
            /** @var list<array{0: int, 1: string}> $transient */
            $transient = [];

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
                        $othersTold,
                        $row->organization_id !== null ? (int) $row->organization_id : null
                    ));
                    if ($sent) {
                        $this->mark((int) $row->id, 'sent', null);
                    } else {
                        $transient[] = [(int) $row->id, 'send_false'];
                    }
                } catch (\Throwable $e) {
                    Log::error('SendVolunteerLowMoodEmails: one recipient failed', [
                        'row_id' => $row->id,
                        'volunteer_id' => $this->volunteerId,
                        'error' => $e->getMessage(),
                    ]);
                    $transient[] = [(int) $row->id, 'exception'];
                }
            }

            if ($transient === []) {
                return;
            }

            // A send that did not work is retried, up to $tries, with backoff: a
            // mail server having a bad minute must not become "failed for ever"
            // (audit finding 2, 21 Oct 2026). On the last attempt the rows are
            // recorded as failed, and a check-in nobody was reached under stops
            // counting as told.
            $final = $this->attempts() >= $this->tries;
            foreach ($transient as [$rowId, $code]) {
                $this->mark($rowId, $final ? 'failed' : 'queued', $code);
            }
            if ($final) {
                $this->reconcileToldStamps();
                return;
            }
            throw new \RuntimeException(count($transient) . ' wellbeing email(s) not sent; retrying');
        });
    }

    /** Check-ins among these rows that reached nobody at all no longer count as told. */
    private function reconcileToldStamps(): void
    {
        $checkinIds = $this->rows()->whereNotNull('checkin_id')->distinct()->pluck('checkin_id');
        foreach ($checkinIds as $checkinId) {
            if (VolunteerWellbeingService::peopleToldFor($this->tenantId, (int) $checkinId) === 0) {
                VolunteerWellbeingService::clearToldStamp($this->tenantId, (int) $checkinId);
            }
        }
    }

    /** The job itself died (timeout, lost worker): every address not yet reached is recorded as failed. */
    public function failed(\Throwable $e): void
    {
        $this->reconcileAfterFailure($e);
    }

    private function reconcileAfterFailure(\Throwable $e): void
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

        // A check-in nobody was reached under no longer reads "told" (deep audit O6).
        try {
            $this->reconcileToldStamps();
        } catch (\Throwable $inner) {
            Log::error('SendVolunteerLowMoodEmails: told stamp reconcile failed', ['error' => $inner->getMessage()]);
        }
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
