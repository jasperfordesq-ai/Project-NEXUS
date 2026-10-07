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

/**
 * Emails the people told that a volunteer said they are Low or Struggling.
 *
 * Queued, not sent in the request: one email per staff member and organisation
 * contact took seconds, and the platform runs PHP under mod_php, so the
 * response cannot be flushed before deferred work (see SendPasswordResetEmail).
 * The volunteer who has just asked for support is not kept waiting for it.
 * Bells are created in the request; only the emails come here.
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
     * @param array<int, string|null> $recipients user id => organisation name they are
     *                                            told about, or null for community staff
     */
    public function __construct(
        public readonly int $tenantId,
        public readonly int $volunteerId,
        public readonly string $volunteerName,
        public readonly int $mood,
        public readonly array $recipients,
    ) {
        $this->onQueue('emails');
    }

    public function handle(): void
    {
        TenantContext::runForTenant($this->tenantId, function (): void {
            $users = User::where('tenant_id', $this->tenantId)
                ->where('status', 'active')
                ->whereIn('id', array_keys($this->recipients))
                ->get(['id', 'email', 'first_name', 'last_name', 'profile_type', 'organization_name', 'preferred_language']);

            foreach ($users as $user) {
                $orgName = $this->recipients[(int) $user->id] ?? null;
                LocaleContext::withLocale($user, function () use ($user, $orgName): void {
                    VolunteerWellbeingService::sendLowMoodEmail(
                        $user,
                        $this->tenantId,
                        $this->volunteerId,
                        $this->volunteerName,
                        $this->mood,
                        $orgName
                    );
                });
            }
        });
    }
}
