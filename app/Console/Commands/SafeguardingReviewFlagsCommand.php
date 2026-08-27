<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\UserSafeguardingPreference;
use App\Services\EmailDispatchService;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * Annual review of member safeguarding preferences (Tier 2b governance).
 *
 * The Safeguarding Ireland "adult autonomy" principle requires that members
 * who self-identify as requiring protections retain full control over those
 * flags. We never auto-strip their preferences — but we do prompt them once
 * a year to review and, if they don't respond in 30 days, notify admins so
 * a coordinator can reach out directly.
 *
 * Flow:
 *   - Find preferences where consent_given_at (or created_at as fallback)
 *     is older than 365 days, reminder_sent_at is null, and revoked_at is null.
 *     Send a reminder email + bell. Stamp review_reminder_sent_at.
 *   - Find preferences where reminder_sent_at is older than 30 days,
 *     review_confirmed_at is null, and review_escalated_at is null.
 *     Notify admins/brokers via bell. Stamp review_escalated_at.
 *
 * The member can respond in one of three ways:
 *   1. Confirm — POST /v2/safeguarding/my-preferences (saves review_confirmed_at)
 *   2. Revoke — POST /v2/safeguarding/revoke (sets revoked_at on the pref)
 *   3. Ignore — nothing changes, admin escalation fires at day 30.
 */
class SafeguardingReviewFlagsCommand extends Command
{
    protected $signature = 'safeguarding:review-flags {--dry-run : Report counts without sending emails or writing timestamps}';
    protected $description = 'Send annual-review reminders for safeguarding preferences >365 days old; escalate to admins if no response in 30 days.';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $now = now();
        $reminderThreshold = $now->copy()->subDays(365);
        $escalationThreshold = $now->copy()->subDays(30);

        $remindersSent = $this->processReminders($reminderThreshold, $now, $dryRun);
        $escalationsSent = $this->processEscalations($escalationThreshold, $now, $dryRun);

        $this->info(sprintf(
            '%s: %d reminders %s, %d escalations %s.',
            $dryRun ? 'DRY RUN' : 'Done',
            $remindersSent,
            $dryRun ? 'would send' : 'sent',
            $escalationsSent,
            $dryRun ? 'would send' : 'sent',
        ));

        return self::SUCCESS;
    }

    /**
     * Send annual review reminders to members whose preferences are >365 days old.
     */
    private function processReminders(Carbon $olderThan, Carbon $now, bool $dryRun): int
    {
        $dueRows = DB::table('user_safeguarding_preferences as p')
            ->join('users as u', 'u.id', '=', 'p.user_id')
            ->join('tenants as t', 't.id', '=', 'p.tenant_id')
            ->join('tenant_safeguarding_options as o', 'o.id', '=', 'p.option_id')
            ->whereNull('p.revoked_at')
            ->whereNull('p.review_reminder_sent_at')
            ->where('o.option_key', '!=', 'none_apply') // declination rows need no annual re-confirmation
            ->where(function ($q) use ($olderThan) {
                $q->where('p.consent_given_at', '<', $olderThan)
                  ->orWhere(function ($q2) use ($olderThan) {
                      $q2->whereNull('p.consent_given_at')
                         ->where('p.created_at', '<', $olderThan);
                  });
            })
            ->where('u.status', 'active')
            ->select([
                'p.id as preference_id',
                'p.tenant_id',
                'p.user_id',
                'p.selected_value',
                'o.option_type',
                'u.email',
                'u.first_name',
                'u.last_name', 'u.profile_type', 'u.organization_name',
                'u.name as display_name',
                'u.preferred_language',
                't.name as community_name',
            ])
            ->get();
        $dueRows = $dueRows
            ->filter(static fn ($row): bool => UserSafeguardingPreference::isEffectivelySelected(
                $row->option_type ?? null,
                $row->selected_value ?? null,
            ))
            ->values();

        $byUser = [];
        foreach ($dueRows as $row) {
            $key = "{$row->tenant_id}:{$row->user_id}";
            if (!isset($byUser[$key])) {
                $byUser[$key] = [
                    'tenant_id' => (int) $row->tenant_id,
                    'user_id' => (int) $row->user_id,
                    'email' => $row->email,
                    'name' => UserDisplayName::resolve($row)
                        ?: ($row->display_name ?? ''),
                    'community' => $row->community_name ?? '',
                    'preferred_language' => $row->preferred_language ?? null,
                    'preference_ids' => [],
                ];
            }
            $byUser[$key]['preference_ids'][] = (int) $row->preference_id;
        }

        $sent = 0;
        foreach ($byUser as $userBatch) {
            if ($dryRun) {
                $sent++;
                continue;
            }
            try {
                if (!$this->sendReminderEmail($userBatch)) {
                    continue;
                }
                $this->bellReminder($userBatch);

                DB::table('user_safeguarding_preferences')
                    ->whereIn('id', $userBatch['preference_ids'])
                    ->update(['review_reminder_sent_at' => $now]);

                $sent++;
            } catch (\Throwable $e) {
                Log::error('SafeguardingReviewFlagsCommand: reminder send failed', [
                    'user_id' => $userBatch['user_id'],
                    'tenant_id' => $userBatch['tenant_id'],
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $sent;
    }

    /**
     * Escalate to admins/brokers for members who did not respond in 30 days.
     */
    private function processEscalations(Carbon $olderThan, Carbon $now, bool $dryRun): int
    {
        $dueRows = DB::table('user_safeguarding_preferences as p')
            ->join('users as u', 'u.id', '=', 'p.user_id')
            ->join('tenant_safeguarding_options as o', 'o.id', '=', 'p.option_id')
            ->whereNull('p.revoked_at')
            ->whereNull('p.review_confirmed_at')
            ->whereNull('p.review_escalated_at')
            ->whereNotNull('p.review_reminder_sent_at')
            ->where('p.review_reminder_sent_at', '<', $olderThan)
            ->where('o.option_key', '!=', 'none_apply') // declination rows need no annual re-confirmation
            ->where('u.status', 'active')
            ->select([
                'p.id as preference_id',
                'p.tenant_id',
                'p.user_id',
                'p.selected_value',
                'o.option_type',
                'u.first_name',
                'u.last_name', 'u.profile_type', 'u.organization_name',
                'u.name as display_name',
            ])
            ->get();
        $dueRows = $dueRows
            ->filter(static fn ($row): bool => UserSafeguardingPreference::isEffectivelySelected(
                $row->option_type ?? null,
                $row->selected_value ?? null,
            ))
            ->values();

        $byUser = [];
        foreach ($dueRows as $row) {
            $key = "{$row->tenant_id}:{$row->user_id}";
            if (!isset($byUser[$key])) {
                $byUser[$key] = [
                    'tenant_id' => (int) $row->tenant_id,
                    'user_id' => (int) $row->user_id,
                    'name' => UserDisplayName::resolve($row)
                        ?: ($row->display_name ?? __('emails.common.fallback_member_name')),
                    'preference_ids' => [],
                ];
            }
            $byUser[$key]['preference_ids'][] = (int) $row->preference_id;
        }

        $sent = 0;
        foreach ($byUser as $userBatch) {
            if ($dryRun) {
                $sent++;
                continue;
            }
            try {
                if (!$this->notifyAdminsOfEscalation($userBatch)) {
                    continue;
                }

                DB::table('user_safeguarding_preferences')
                    ->whereIn('id', $userBatch['preference_ids'])
                    ->update(['review_escalated_at' => $now]);

                $sent++;
            } catch (\Throwable $e) {
                Log::error('SafeguardingReviewFlagsCommand: escalation failed', [
                    'user_id' => $userBatch['user_id'],
                    'tenant_id' => $userBatch['tenant_id'],
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $sent;
    }

    private function sendReminderEmail(array $userBatch): bool
    {
        if (empty($userBatch['email'])) {
            return true;
        }

        $previousTenantId = TenantContext::currentId();
        try {
            TenantContext::setById($userBatch['tenant_id']);

            // Safeguarding reminder rendered in the recipient member's language.
            return (bool) LocaleContext::withLocale($userBatch['preferred_language'] ?? null, function () use ($userBatch): bool {
                $safeName = htmlspecialchars($userBatch['name'] ?: __('emails.common.fallback_member_name'), ENT_QUOTES, 'UTF-8');
                $safeCommunity = htmlspecialchars($userBatch['community'] ?: __('emails.common.fallback_tenant_name'), ENT_QUOTES, 'UTF-8');

                $html = EmailTemplateBuilder::make()
                    ->theme('info')
                    ->title(__('safeguarding.review.reminder_title'))
                    ->greeting($safeName)
                    ->paragraph(__('safeguarding.review.reminder_body', ['community' => $safeCommunity]))
                    ->button(
                        __('safeguarding.review.reminder_cta'),
                        EmailTemplateBuilder::tenantUrl('/settings/safeguarding')
                    )
                    ->render();

                return EmailDispatchService::sendWithOptions(
                    $userBatch['email'],
                    __('safeguarding.review.reminder_subject'),
                    $html,
                    ['category' => 'safeguarding_review', 'tenant_id' => $userBatch['tenant_id']]
                );
            });
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }

    private function bellReminder(array $userBatch): void
    {
        try {
            // Cron worker boots with the system default locale; without
            // wrapping per-recipient, the bell text would render in the
            // worker's locale rather than the user's preferred_language.
            LocaleContext::withLocale($userBatch['preferred_language'] ?? null, function () use ($userBatch) {
                Notification::create([
                    'tenant_id' => $userBatch['tenant_id'],
                    'user_id' => $userBatch['user_id'],
                    'type' => 'safeguarding_review_reminder',
                    'message' => __('safeguarding.review.reminder_title'),
                    'link' => '/settings?tab=safeguarding',
                    'is_read' => false,
                ]);
            });
        } catch (\Throwable $e) {
            Log::warning('SafeguardingReviewFlagsCommand: reminder bell failed', [
                'user_id' => $userBatch['user_id'],
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function notifyAdminsOfEscalation(array $userBatch): bool
    {
        // Includes preferred_language so each staff member's bell + email
        // renders in their own locale (not the cron worker's default).
        $staff = DB::table('users')
            ->where('tenant_id', $userBatch['tenant_id'])
            ->whereIn('role', ['admin', 'tenant_admin', 'broker', 'super_admin'])
            ->where('status', 'active')
            ->select(['id', 'email', 'first_name', 'last_name', 'profile_type', 'organization_name', 'name', 'preferred_language'])
            ->get();

        if ($staff->isEmpty()) {
            return false;
        }

        $previousTenantId = TenantContext::currentId();
        $emailFailures = 0;
        try {
            TenantContext::setById($userBatch['tenant_id']);

            $safeMemberName = htmlspecialchars($userBatch['name'], ENT_QUOTES, 'UTF-8');

            foreach ($staff as $admin) {
                // Wrap the per-admin bell + email in their preferred_language
                // so the email body, subject, AND bell text all render in
                // the recipient's locale. The HTML body must be built INSIDE
                // the wrap (was previously built once outside the loop in
                // the worker's locale).
                LocaleContext::withLocale($admin, function () use ($admin, $userBatch, $safeMemberName, &$emailFailures) {
                    $escalationHtml = EmailTemplateBuilder::make()
                        ->theme('warning')
                        ->title(__('safeguarding.review.escalation_title'))
                        ->paragraph(__('safeguarding.review.escalation_body', ['name' => $safeMemberName]))
                        ->button(
                            __('safeguarding.review.escalation_cta'),
                            EmailTemplateBuilder::tenantUrl('/broker/safeguarding')
                        )
                        ->render();

                    // Bell
                    try {
                        Notification::create([
                            'tenant_id' => $userBatch['tenant_id'],
                            'user_id' => $admin->id,
                            'type' => 'safeguarding_review_escalation',
                            'message' => __('safeguarding.review.escalation_title') . ': ' . $userBatch['name'],
                            'link' => '/broker/safeguarding',
                            'is_read' => false,
                        ]);
                    } catch (\Throwable $e) {
                        Log::warning('SafeguardingReviewFlagsCommand: escalation bell failed', [
                            'admin_id' => $admin->id,
                            'error' => $e->getMessage(),
                        ]);
                    }

                    // Email
                    if (!empty($admin->email)) {
                        try {
                            $sent = EmailDispatchService::sendWithOptions(
                                $admin->email,
                                __('safeguarding.review.escalation_subject'),
                                $escalationHtml,
                                ['category' => 'safeguarding_review', 'tenant_id' => $userBatch['tenant_id']]
                            );
                            if (!$sent) {
                                $emailFailures++;
                            }
                        } catch (\Throwable $e) {
                            $emailFailures++;
                            Log::warning('SafeguardingReviewFlagsCommand: escalation email failed', [
                                'admin_id' => $admin->id,
                                'error' => $e->getMessage(),
                            ]);
                        }
                    }
                });
            }
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }

        return $emailFailures === 0;
    }
}
