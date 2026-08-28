<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * VolunteerReminderService — manages reminder settings and sends shift/credential
 * reminders to volunteers.
 *
 * Backed by `vol_reminder_settings` and `vol_reminders_sent` tables.
 * All queries are tenant-scoped via TenantContext.
 */
class VolunteerReminderService
{
    public function __construct()
    {
    }

    /**
     * Shift assignments currently use approved vol_applications.shift_id, while
     * older reminder code used vol_shift_signups. Read both sources so reminders
     * reach volunteers regardless of which flow assigned the shift.
     *
     * @return array<int>
     */
    private static function confirmedShiftUserIds(int $tenantId, int $shiftId): array
    {
        $signupUsers = DB::table('vol_shift_signups')
            ->where('shift_id', $shiftId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'confirmed')
            ->pluck('user_id')
            ->all();

        $applicationUsers = DB::table('vol_applications')
            ->where('shift_id', $shiftId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->pluck('user_id')
            ->all();

        return array_values(array_unique(array_map('intval', array_merge($signupUsers, $applicationUsers))));
    }

    /**
     * Render/send a reminder under an explicit tenant and restore the worker
     * context afterwards. Reminder jobs can run cross-tenant from cron.
     *
     * @template T
     * @param callable():T $callback
     * @return T
     */
    private static function withTenantContext(int $tenantId, callable $callback)
    {
        return TenantContext::runForTenant($tenantId, $callback);
    }

    /**
     * A recipient on the email suppression list (hard bounce / spam report)
     * will never accept delivery. Callers must treat this as a PERMANENT
     * failure — mark the reminder handled instead of releasing the claim,
     * otherwise the cron retries the same dead address on every run forever
     * (observed in production: 36 suppressed demo users × every 30 minutes).
     */
    private static function recipientSuppressed(string $email, int $tenantId, int $userId, int $referenceId): bool
    {
        if (!\App\Core\Mailer::isSuppressed($email)) {
            return false;
        }

        Log::info('[VolunteerReminderService] recipient suppressed — reminder marked handled, not retried', [
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'reference_id' => $referenceId,
        ]);

        return true;
    }

    private static function claimReminderDelivery(int $tenantId, int $userId, string $reminderType, int $referenceId, string $channel): bool
    {
        try {
            $inserted = DB::table('vol_reminder_delivery_claims')->insertOrIgnore([
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'reminder_type' => $reminderType,
                'reference_id' => $referenceId,
                'channel' => $channel,
                'status' => 'claimed',
                'claimed_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            return (int) $inserted > 0;
        } catch (\Throwable $e) {
            Log::warning('[VolunteerReminderService] reminder delivery claim failed', [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'reminder_type' => $reminderType,
                'reference_id' => $referenceId,
                'channel' => $channel,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    private static function releaseReminderDeliveryClaim(int $tenantId, int $userId, string $reminderType, int $referenceId, string $channel): void
    {
        DB::table('vol_reminder_delivery_claims')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('reminder_type', $reminderType)
            ->where('reference_id', $referenceId)
            ->where('channel', $channel)
            ->whereNull('delivered_at')
            ->delete();
    }

    private static function releaseReminderDeliveryClaims(int $tenantId, int $userId, string $reminderType, int $referenceId, array $channels): void
    {
        foreach ($channels as $channel) {
            self::releaseReminderDeliveryClaim($tenantId, $userId, $reminderType, $referenceId, (string) $channel);
        }
    }

    public static function releaseStaleReminderDeliveryClaims(int $olderThanMinutes = 30): int
    {
        return DB::table('vol_reminder_delivery_claims')
            ->whereNull('delivered_at')
            ->where('claimed_at', '<', now()->subMinutes(max(1, $olderThanMinutes)))
            ->delete();
    }

    private static function markReminderDeliverySent(int $tenantId, int $userId, string $reminderType, int $referenceId, string $channel): bool
    {
        $inserted = DB::table('vol_reminders_sent')->insertOrIgnore([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'reminder_type' => $reminderType,
            'reference_id' => $referenceId,
            'channel' => $channel,
            'sent_at' => now(),
        ]);

        DB::table('vol_reminder_delivery_claims')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('reminder_type', $reminderType)
            ->where('reference_id', $referenceId)
            ->where('channel', $channel)
            ->update([
                'status' => 'delivered',
                'delivered_at' => now(),
                'updated_at' => now(),
            ]);

        return (int) $inserted > 0;
    }

    /**
     * Send one email-backed reminder with the same idempotency and failure
     * semantics used by shift reminders.
     *
     * @param callable(object):array{subject:string,html:string} $messageFactory
     */
    private static function deliverEmailReminder(
        int $tenantId,
        int $userId,
        string $reminderType,
        int $referenceId,
        callable $messageFactory
    ): bool {
        $alreadySent = DB::table('vol_reminders_sent')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('reminder_type', $reminderType)
            ->where('reference_id', $referenceId)
            ->where('channel', 'email')
            ->exists();

        if ($alreadySent) {
            return false;
        }

        if (!self::claimReminderDelivery($tenantId, $userId, $reminderType, $referenceId, 'email')) {
            return false;
        }

        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['email', 'first_name', 'name', 'preferred_language']);

        if (!$user || empty($user->email) || !filter_var($user->email, FILTER_VALIDATE_EMAIL)) {
            Log::warning('[VolunteerReminderService] ' . $reminderType . ' email channel claimed without valid recipient email', [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'reference_id' => $referenceId,
            ]);
            self::releaseReminderDeliveryClaim($tenantId, $userId, $reminderType, $referenceId, 'email');
            return false;
        }

        if (self::recipientSuppressed((string) $user->email, $tenantId, $userId, $referenceId)) {
            return self::markReminderDeliverySent($tenantId, $userId, $reminderType, $referenceId, 'email');
        }

        $emailOk = self::withTenantContext($tenantId, function () use ($user, $tenantId, $messageFactory): bool {
            return LocaleContext::withLocale($user, function () use ($user, $tenantId, $messageFactory): bool {
                $message = $messageFactory($user);

                return \App\Services\EmailDispatchService::sendRaw(
                    (string) $user->email,
                    $message['subject'],
                    $message['html'],
                    null,
                    null,
                    null,
                    'volunteer_reminder',
                    ['tenant_id' => $tenantId]
                );
            });
        });

        if (!$emailOk) {
            self::releaseReminderDeliveryClaim($tenantId, $userId, $reminderType, $referenceId, 'email');
            return false;
        }

        return self::markReminderDeliverySent($tenantId, $userId, $reminderType, $referenceId, 'email');
    }

    /**
     * Send reminders for an opportunity's upcoming shifts.
     *
     * Finds confirmed volunteers for shifts belonging to the given opportunity
     * that are within the configured pre-shift reminder window, and records
     * the reminder as sent.
     *
     * @return int  Number of reminders sent
     */
    public static function sendReminders(int $tenantId, int $opportunityId): int
    {
        self::releaseStaleReminderDeliveryClaims();

        // Get the pre_shift reminder setting for this tenant
        $setting = DB::table('vol_reminder_settings')
            ->where('tenant_id', $tenantId)
            ->where('reminder_type', 'pre_shift')
            ->where('enabled', true)
            ->first();

        if (!$setting) {
            return 0;
        }

        $hoursBefore = (int) ($setting->hours_before ?? 24);

        // Find shifts for this opportunity that start within the reminder window
        $shifts = DB::table('vol_shifts')
            ->where('opportunity_id', $opportunityId)
            ->where('tenant_id', $tenantId)
            ->where('start_time', '>', now())
            ->where('start_time', '<=', now()->addHours($hoursBefore))
            ->get();

        if ($shifts->isEmpty()) {
            return 0;
        }

        $sentCount = 0;

        foreach ($shifts as $shift) {
            // Get confirmed volunteers for this shift
            $signups = self::confirmedShiftUserIds($tenantId, (int) $shift->id);

            // Fetch the opportunity title for this shift once per shift
            $opportunity = DB::table('vol_opportunities')
                ->where('id', $shift->opportunity_id)
                ->where('tenant_id', $tenantId)
                ->first(['title', 'location']);

            $opportunityTitle = htmlspecialchars($opportunity->title ?? '', ENT_QUOTES, 'UTF-8');
            $opportunityLocation = htmlspecialchars($opportunity->location ?? '', ENT_QUOTES, 'UTF-8');

            foreach ($signups as $userId) {
                // Check if reminder was already sent for this shift+user combination
                $alreadySent = DB::table('vol_reminders_sent')
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->where('reminder_type', 'pre_shift')
                    ->where('reference_id', $shift->id)
                    ->exists();

                if ($alreadySent) {
                    continue;
                }

                // Record the reminder as sent
                $claimedChannels = [];
                try {
                    // This service currently sends email only. Do not stamp
                    // push/SMS rows as sent without provider delivery evidence.
                    $channels = [];
                    if ($setting->email_enabled ?? true) {
                        $channels[] = 'email';
                    }

                    if (empty($channels)) {
                        continue;
                    }

                    foreach ($channels as $channel) {
                        if (self::claimReminderDelivery($tenantId, (int) $userId, 'pre_shift', (int) $shift->id, $channel)) {
                            $claimedChannels[] = $channel;
                        }
                    }
                    if (empty($claimedChannels)) {
                        continue;
                    }

                    // Send email if the email channel is enabled
                    $emailOk = true;
                    if (in_array('email', $claimedChannels, true)) {
                        $user = DB::table('users')
                            ->where('id', $userId)
                            ->where('tenant_id', $tenantId)
                            ->first(['email', 'first_name', 'name', 'preferred_language']);

                        if ($user && !empty($user->email) && filter_var($user->email, FILTER_VALIDATE_EMAIL)) {
                            if (self::recipientSuppressed((string) $user->email, (int) $tenantId, (int) $userId, (int) $shift->id)) {
                                // $emailOk stays true → claim marked handled, no retry storm.
                            } else {
                            try {
                                // Cron → render in recipient's language and tenant, not leaked worker defaults.
                                $emailOk = self::withTenantContext($tenantId, function () use ($user, $shift, $opportunityTitle, $opportunityLocation, $userId, $tenantId): bool {
                                    return LocaleContext::withLocale($user, function () use ($user, $shift, $opportunityTitle, $opportunityLocation, $userId, $tenantId): bool {
                                    $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                                    $shiftTime = $shift->start_time
                                        ? \Carbon\Carbon::parse($shift->start_time)->locale(\App\I18n\FormattingLocale::carbon())->isoFormat('ddd, D MMM YYYY HH:mm')
                                        : '';
                                    $shiftUrl = TenantContext::getFrontendUrl()
                                        . TenantContext::getSlugPrefix()
                                        . '/volunteering/opportunities/' . $shift->opportunity_id;
                                    $communityName = TenantContext::getName();

                                    $infoCard = [__('emails_volunteer.shift_reminder.label_opportunity') => $opportunityTitle];
                                    if ($shiftTime) {
                                        $infoCard[__('emails_volunteer.shift_reminder.label_when')] = $shiftTime;
                                    }
                                    if ($opportunityLocation) {
                                        $infoCard[__('emails_volunteer.shift_reminder.label_location')] = $opportunityLocation;
                                    }

                                    $html = EmailTemplateBuilder::make()
                                        ->theme('info')
                                        ->title(__('emails_volunteer.shift_reminder.title'))
                                        ->previewText(__('emails_volunteer.shift_reminder.preview', ['title' => $opportunityTitle]))
                                        ->greeting($firstName)
                                        ->paragraph(__('emails_volunteer.shift_reminder.body'))
                                        ->infoCard($infoCard)
                                        ->button(__('emails_volunteer.shift_reminder.cta'), $shiftUrl)
                                        ->render();

                                    $subject = __('emails_volunteer.shift_reminder.subject', [
                                        'title'     => $opportunityTitle,
                                        'community' => $communityName,
                                    ]);

                                    if (!\App\Services\EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'volunteer_reminder', ['tenant_id' => $tenantId])) {
                                        Log::warning('[VolunteerReminderService] sendReminders email failed', [
                                            'user_id' => $userId,
                                            'shift_id' => $shift->id,
                                        ]);
                                        return false;
                                    }

                                    return true;
                                    });
                                });
                            } catch (\Throwable $e) {
                                Log::warning('[VolunteerReminderService] sendReminders email exception: ' . $e->getMessage(), [
                                    'user_id' => $userId,
                                    'shift_id' => $shift->id,
                                ]);
                                $emailOk = false;
                            }
                            }
                        } else {
                            Log::warning('[VolunteerReminderService] sendReminders email channel claimed without valid recipient email', [
                                'tenant_id' => $tenantId,
                                'user_id' => $userId,
                                'shift_id' => $shift->id,
                            ]);
                            $emailOk = false;
                        }
                    }

                    if (!$emailOk) {
                        foreach ($claimedChannels as $channel) {
                            self::releaseReminderDeliveryClaim($tenantId, (int) $userId, 'pre_shift', (int) $shift->id, $channel);
                        }
                        continue;
                    }

                    $recorded = false;
                    foreach ($claimedChannels as $channel) {
                        $recorded = self::markReminderDeliverySent($tenantId, (int) $userId, 'pre_shift', (int) $shift->id, $channel) || $recorded;
                    }

                    if ($recorded) {
                        $sentCount++;
                    }
                } catch (\Throwable $e) {
                    self::releaseReminderDeliveryClaims($tenantId, (int) $userId, 'pre_shift', (int) $shift->id, $claimedChannels);
                    \Illuminate\Support\Facades\Log::warning("VolunteerReminderService::sendReminders error for user {$userId}: " . $e->getMessage());
                }
            }
        }

        return $sentCount;
    }

    /**
     * Get all reminder settings for the current tenant.
     *
     * Returns one row per reminder_type, or synthesises defaults for types
     * that have no row yet.
     *
     * @return array  Keyed list of reminder settings
     */
    public static function getSettings(): array
    {
        $tenantId = TenantContext::getId();

        $rows = DB::table('vol_reminder_settings')
            ->where('tenant_id', $tenantId)
            ->get()
            ->keyBy('reminder_type');

        $defaults = [
            'pre_shift' => [
                'hours_before' => 24,
                'hours_after' => null,
                'days_inactive' => null,
                'days_before_expiry' => null,
            ],
            'post_shift_feedback' => [
                'hours_before' => null,
                'hours_after' => 2,
                'days_inactive' => null,
                'days_before_expiry' => null,
            ],
            'lapsed_volunteer' => [
                'hours_before' => null,
                'hours_after' => null,
                'days_inactive' => 30,
                'days_before_expiry' => null,
            ],
            'credential_expiry' => [
                'hours_before' => null,
                'hours_after' => null,
                'days_inactive' => null,
                'days_before_expiry' => 14,
            ],
            'training_expiry' => [
                'hours_before' => null,
                'hours_after' => null,
                'days_inactive' => null,
                'days_before_expiry' => 14,
            ],
        ];

        $settings = [];

        foreach ($defaults as $type => $typeDefaults) {
            $row = $rows->get($type);

            if ($row) {
                $settings[] = [
                    'id' => (int) $row->id,
                    'reminder_type' => $row->reminder_type,
                    'enabled' => (bool) $row->enabled,
                    'hours_before' => $row->hours_before !== null ? (int) $row->hours_before : null,
                    'hours_after' => $row->hours_after !== null ? (int) $row->hours_after : null,
                    'days_inactive' => $row->days_inactive !== null ? (int) $row->days_inactive : null,
                    'days_before_expiry' => $row->days_before_expiry !== null ? (int) $row->days_before_expiry : null,
                    'email_template' => $row->email_template,
                    'push_enabled' => (bool) $row->push_enabled,
                    'email_enabled' => (bool) $row->email_enabled,
                    'sms_enabled' => (bool) $row->sms_enabled,
                    'updated_at' => $row->updated_at,
                ];
            } else {
                // Synthesise a default entry (not yet persisted)
                $settings[] = [
                    'id' => null,
                    'reminder_type' => $type,
                    'enabled' => true,
                    'hours_before' => $typeDefaults['hours_before'],
                    'hours_after' => $typeDefaults['hours_after'],
                    'days_inactive' => $typeDefaults['days_inactive'],
                    'days_before_expiry' => $typeDefaults['days_before_expiry'],
                    'email_template' => null,
                    'push_enabled' => true,
                    'email_enabled' => true,
                    'sms_enabled' => false,
                    'updated_at' => null,
                ];
            }
        }

        return $settings;
    }

    // ─── Cron-callable reminder jobs ───────────────────────────────────────────

    /**
     * Narrow a collected list of tenant IDs to a single tenant when requested.
     *
     * The sweep jobs below iterate every eligible tenant on their own. The
     * runAll scheduler used to call them once per tenant inside forEachTenant(),
     * which re-swept all tenants N times. Passing $onlyTenantId lets that caller
     * process just the current tenant while standalone callers (no argument)
     * keep the all-tenant behaviour. Preserves the "tenant must actually be
     * eligible" semantics: a tenant not in the collected set has no work to do.
     *
     * @param array<int, int|string> $tenantIds
     * @return list<int>
     */
    private static function restrictToTenant(array $tenantIds, ?int $onlyTenantId): array
    {
        $ints = array_map('intval', $tenantIds);

        if ($onlyTenantId === null) {
            return array_values($ints);
        }

        return array_values(array_intersect($ints, [$onlyTenantId]));
    }

    /**
     * Send pre-shift reminders to volunteers with upcoming shifts.
     *
     * Iterates all active tenants, reads their pre_shift reminder setting to
     * determine the reminder window, then emails each confirmed volunteer whose
     * shift falls within that window and hasn't been reminded yet.
     *
     * @return int Total number of reminders sent across all tenants
     */
    public static function sendPreShiftReminders(?int $onlyTenantId = null): int
    {
        self::releaseStaleReminderDeliveryClaims();

        $totalSent = 0;

        // Collect all distinct tenant IDs that have reminder settings enabled,
        // plus any tenants that have upcoming shifts (fallback 24h window).
        $tenantIds = DB::table('vol_reminder_settings')
            ->where('reminder_type', 'pre_shift')
            ->where('enabled', true)
            ->when($onlyTenantId !== null, fn ($q) => $q->where('tenant_id', $onlyTenantId))
            ->pluck('tenant_id')
            ->unique()
            ->all();

        // Also include tenants that have shifts but no explicit setting (use 24h default).
        $tenantsWithShifts = DB::table('vol_shifts')
            ->where('start_time', '>', now())
            ->where('start_time', '<=', now()->addHours(24))
            ->when($onlyTenantId !== null, fn ($q) => $q->where('tenant_id', $onlyTenantId))
            ->pluck('tenant_id')
            ->unique()
            ->all();

        $allTenantIds = array_unique(array_merge($tenantIds, $tenantsWithShifts));
        $allTenantIds = self::restrictToTenant($allTenantIds, $onlyTenantId);

        foreach ($allTenantIds as $tenantId) {
            try {
                // Get pre_shift reminder setting for this tenant (or use 24h default).
                // Must NOT filter enabled=true here: a disabled setting would come
                // back null and fall into the "no setting → send defaults" path.
                $setting = DB::table('vol_reminder_settings')
                    ->where('tenant_id', $tenantId)
                    ->where('reminder_type', 'pre_shift')
                    ->first();

                // Skip tenant if setting explicitly disabled
                if ($setting !== null && !(bool) $setting->enabled) {
                    continue;
                }

                $hoursBefore  = (int) ($setting->hours_before ?? 24);
                $emailEnabled = (bool) ($setting->email_enabled ?? true);

                // Find shifts within the reminder window for this tenant. Join
                // the opportunity and require it to still be active — a cancelled
                // (soft-deleted) opportunity keeps its shifts, and without this
                // volunteers got "shift starting soon" emails for opportunities
                // that were cancelled.
                $shifts = DB::table('vol_shifts as s')
                    ->join('vol_opportunities as o', function ($join) {
                        $join->on('s.opportunity_id', '=', 'o.id')
                            ->on('s.tenant_id', '=', 'o.tenant_id');
                    })
                    ->where('s.tenant_id', $tenantId)
                    ->where('s.start_time', '>', now())
                    ->where('s.start_time', '<=', now()->addHours($hoursBefore))
                    ->where('o.is_active', 1)
                    // Select the opportunity title/location from the join so we do
                    // not re-fetch the opportunity once per shift below.
                    ->select('s.*', 'o.title as opportunity_title', 'o.location as opportunity_location')
                    ->get();

                foreach ($shifts as $shift) {
                    $opportunityTitle    = htmlspecialchars($shift->opportunity_title ?? '', ENT_QUOTES, 'UTF-8');
                    $opportunityLocation = htmlspecialchars($shift->opportunity_location ?? '', ENT_QUOTES, 'UTF-8');

                    // Get confirmed volunteers for this shift, plus the set of users
                    // already reminded — loaded once per shift instead of once per
                    // recipient.
                    $signups = self::confirmedShiftUserIds($tenantId, (int) $shift->id);
                    $alreadySentUserIds = DB::table('vol_reminders_sent')
                        ->where('tenant_id', $tenantId)
                        ->where('reminder_type', 'pre_shift')
                        ->where('reference_id', $shift->id)
                        ->pluck('user_id')
                        ->map(fn ($id) => (int) $id)
                        ->all();

                    foreach ($signups as $userId) {
                        // Skip if already reminded (checked against the per-shift set).
                        if (in_array((int) $userId, $alreadySentUserIds, true)) {
                            continue;
                        }

                        $claimedChannels = [];
                        try {
                            // This service currently sends email only. Do not stamp
                            // push/SMS rows as sent without provider delivery evidence.
                            $channels = [];
                            if ($emailEnabled) {
                                $channels[] = 'email';
                            }
                            if (empty($channels)) {
                                continue;
                            }

                            foreach ($channels as $channel) {
                                if (self::claimReminderDelivery((int) $tenantId, (int) $userId, 'pre_shift', (int) $shift->id, $channel)) {
                                    $claimedChannels[] = $channel;
                                }
                            }
                            if (empty($claimedChannels)) {
                                continue;
                            }

                            // Send email
                            $emailOk = true;
                            if ($emailEnabled && in_array('email', $claimedChannels, true)) {
                                $user = DB::table('users')
                                    ->where('id', $userId)
                                    ->where('tenant_id', $tenantId)
                                    ->first(['email', 'first_name', 'name', 'preferred_language']);

                                if ($user && !empty($user->email) && filter_var($user->email, FILTER_VALIDATE_EMAIL)) {
                                    if (self::recipientSuppressed((string) $user->email, (int) $tenantId, (int) $userId, (int) $shift->id)) {
                                        // $emailOk stays true → claim marked handled, no retry storm.
                                    } else {
                                    $emailOk = self::withTenantContext((int) $tenantId, function () use ($user, $shift, $opportunityTitle, $opportunityLocation, $tenantId, $userId): bool {
                                        return LocaleContext::withLocale($user, function () use ($user, $shift, $opportunityTitle, $opportunityLocation, $tenantId, $userId): bool {
                                        $firstName    = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                                        $shiftTime    = $shift->start_time
                                            ? \Carbon\Carbon::parse($shift->start_time)->locale(\App\I18n\FormattingLocale::carbon())->isoFormat('ddd, D MMM YYYY HH:mm')
                                            : '';
                                        $shiftUrl     = TenantContext::getFrontendUrl()
                                            . TenantContext::getSlugPrefix()
                                            . '/volunteering/opportunities/' . $shift->opportunity_id;

                                        $infoCard = [__('emails_volunteer.shift_starting_soon.title') => $opportunityTitle];
                                        if ($shiftTime) {
                                            $infoCard[__('emails_volunteer.shift_reminder.label_when')] = $shiftTime;
                                        }
                                        if ($opportunityLocation) {
                                            $infoCard[__('emails_volunteer.shift_reminder.label_location')] = $opportunityLocation;
                                        }

                                        $html = EmailTemplateBuilder::make()
                                            ->theme('info')
                                            ->title(__('emails_volunteer.shift_starting_soon.title'))
                                            ->previewText(__('emails_volunteer.shift_starting_soon.preview', ['title' => $opportunityTitle]))
                                            ->greeting($firstName)
                                            ->paragraph(__('emails_volunteer.shift_starting_soon.body'))
                                            ->infoCard($infoCard)
                                            ->button(__('emails_volunteer.shift_starting_soon.cta'), $shiftUrl)
                                            ->render();

                                        $subject = __('emails_volunteer.shift_starting_soon.subject', ['title' => $opportunityTitle]);

                                        if (!\App\Services\EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'volunteer_reminder', ['tenant_id' => $tenantId])) {
                                            Log::warning('[VolunteerReminderService] sendPreShiftReminders email failed', [
                                                'tenant_id' => $tenantId,
                                                'user_id'   => $userId,
                                                'shift_id'  => $shift->id,
                                            ]);
                                            return false;
                                        }

                                        return true;
                                        });
                                    });
                                    }
                                } else {
                                    Log::warning('[VolunteerReminderService] sendPreShiftReminders email channel claimed without valid recipient email', [
                                        'tenant_id' => $tenantId,
                                        'user_id'   => $userId,
                                        'shift_id'  => $shift->id,
                                    ]);
                                    $emailOk = false;
                                }
                            }

                            if (!$emailOk) {
                                foreach ($claimedChannels as $channel) {
                                    self::releaseReminderDeliveryClaim((int) $tenantId, (int) $userId, 'pre_shift', (int) $shift->id, $channel);
                                }
                                continue;
                            }

                            // Record reminder attempt for each successfully handled channel.
                            $recorded = false;
                            foreach ($claimedChannels as $channel) {
                                $recorded = self::markReminderDeliverySent((int) $tenantId, (int) $userId, 'pre_shift', (int) $shift->id, $channel) || $recorded;
                            }

                            if ($recorded) {
                                $totalSent++;
                            }
                        } catch (\Throwable $e) {
                            self::releaseReminderDeliveryClaims((int) $tenantId, (int) $userId, 'pre_shift', (int) $shift->id, $claimedChannels);
                            Log::warning('[VolunteerReminderService] sendPreShiftReminders error for user ' . $userId . ': ' . $e->getMessage());
                        }
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('[VolunteerReminderService] sendPreShiftReminders tenant error for tenant ' . $tenantId . ': ' . $e->getMessage());
            }
        }

        return $totalSent;
    }

    /**
     * Send post-shift feedback requests to volunteers after their shift ends.
     *
     * For each tenant with a post_shift_feedback setting enabled, finds completed
     * shifts (end_time in the past, within the hours_after window) and emails each
     * confirmed volunteer asking them to log their hours — unless already sent.
     *
     * @return int Total number of feedback requests sent across all tenants
     */
    public static function sendPostShiftFeedback(?int $onlyTenantId = null): int
    {
        self::releaseStaleReminderDeliveryClaims();

        $totalSent = 0;

        // Collect post_shift_feedback settings for all tenants — including
        // disabled ones, so the explicit-disable guard below can fire instead
        // of disabled tenants falling into the "no setting → defaults" path.
        $settingsByTenant = DB::table('vol_reminder_settings')
            ->where('reminder_type', 'post_shift_feedback')
            ->when($onlyTenantId !== null, fn ($q) => $q->where('tenant_id', $onlyTenantId))
            ->get()
            ->keyBy('tenant_id');

        // Also cover tenants with recently-ended shifts but no explicit setting (default 2h window)
        $tenantsWithEndedShifts = DB::table('vol_shifts')
            ->where('end_time', '<', now())
            ->where('end_time', '>=', now()->subHours(2))
            ->when($onlyTenantId !== null, fn ($q) => $q->where('tenant_id', $onlyTenantId))
            ->pluck('tenant_id')
            ->unique()
            ->all();

        $allTenantIds = array_unique(array_merge(
            $settingsByTenant->keys()->all(),
            $tenantsWithEndedShifts
        ));
        $allTenantIds = self::restrictToTenant($allTenantIds, $onlyTenantId);

        foreach ($allTenantIds as $tenantId) {
            try {
                $setting = $settingsByTenant->get($tenantId);

                // Tenant explicitly disabled post-shift feedback — respect it.
                if ($setting !== null && !(bool) $setting->enabled) {
                    continue;
                }

                $hoursAfter   = (int) ($setting->hours_after ?? 2);
                $emailEnabled = (bool) ($setting->email_enabled ?? true);

                // Find shifts that ended within the feedback window
                $shifts = DB::table('vol_shifts')
                    ->where('tenant_id', $tenantId)
                    ->where('end_time', '<', now())
                    ->where('end_time', '>=', now()->subHours($hoursAfter))
                    ->get();

                foreach ($shifts as $shift) {
                    $opportunity = DB::table('vol_opportunities')
                        ->where('id', $shift->opportunity_id)
                        ->where('tenant_id', $tenantId)
                        ->first(['title']);

                    $opportunityTitle = htmlspecialchars($opportunity->title ?? '', ENT_QUOTES, 'UTF-8');

                    // Get confirmed volunteers
                    $signups = self::confirmedShiftUserIds($tenantId, (int) $shift->id);

                    foreach ($signups as $userId) {
                        // Skip if post-shift feedback already sent for this shift+user
                        $alreadySent = DB::table('vol_reminders_sent')
                            ->where('tenant_id', $tenantId)
                            ->where('user_id', $userId)
                            ->where('reminder_type', 'post_shift_feedback')
                            ->where('reference_id', $shift->id)
                            ->exists();

                        if ($alreadySent) {
                            continue;
                        }

                        $claimedChannels = [];
                        try {
                            // This service currently sends email only. Do not stamp
                            // push/SMS rows as sent without provider delivery evidence.
                            $channels = [];
                            if ($emailEnabled) {
                                $channels[] = 'email';
                            }
                            if (empty($channels)) {
                                continue;
                            }

                            foreach ($channels as $channel) {
                                if (self::claimReminderDelivery((int) $tenantId, (int) $userId, 'post_shift_feedback', (int) $shift->id, $channel)) {
                                    $claimedChannels[] = $channel;
                                }
                            }
                            if (empty($claimedChannels)) {
                                continue;
                            }

                            // Send email
                            $emailOk = true;
                            if ($emailEnabled && in_array('email', $claimedChannels, true)) {
                                $user = DB::table('users')
                                    ->where('id', $userId)
                                    ->where('tenant_id', $tenantId)
                                    ->first(['email', 'first_name', 'name', 'preferred_language']);

                                if ($user && !empty($user->email) && filter_var($user->email, FILTER_VALIDATE_EMAIL)) {
                                    if (self::recipientSuppressed((string) $user->email, (int) $tenantId, (int) $userId, (int) $shift->id)) {
                                        // $emailOk stays true → claim marked handled, no retry storm.
                                    } else {
                                    $emailOk = self::withTenantContext((int) $tenantId, function () use ($user, $shift, $opportunityTitle, $tenantId, $userId): bool {
                                        return LocaleContext::withLocale($user, function () use ($user, $shift, $opportunityTitle, $tenantId, $userId): bool {
                                        $firstName  = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                                        $logHoursUrl = TenantContext::getFrontendUrl()
                                            . TenantContext::getSlugPrefix()
                                            . '/volunteering/opportunities/' . $shift->opportunity_id;

                                        $html = EmailTemplateBuilder::make()
                                            ->theme('success')
                                            ->title(__('emails_volunteer.post_shift_feedback.title'))
                                            ->previewText(__('emails_volunteer.post_shift_feedback.preview', ['title' => $opportunityTitle]))
                                            ->greeting($firstName)
                                            ->paragraph(__('emails_volunteer.post_shift_feedback.body', ['title' => $opportunityTitle]))
                                            ->paragraph(__('emails_volunteer.post_shift_feedback.log_hours_prompt'))
                                            ->button(__('emails_volunteer.post_shift_feedback.cta'), $logHoursUrl)
                                            ->render();

                                        $subject = __('emails_volunteer.post_shift_feedback.subject', ['title' => $opportunityTitle]);

                                        if (!\App\Services\EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'volunteer_reminder', ['tenant_id' => $tenantId])) {
                                            Log::warning('[VolunteerReminderService] sendPostShiftFeedback email failed', [
                                                'tenant_id' => $tenantId,
                                                'user_id'   => $userId,
                                                'shift_id'  => $shift->id,
                                            ]);
                                            return false;
                                        }

                                        return true;
                                        });
                                    });
                                    }
                                } else {
                                    Log::warning('[VolunteerReminderService] sendPostShiftFeedback email channel claimed without valid recipient email', [
                                        'tenant_id' => $tenantId,
                                        'user_id'   => $userId,
                                        'shift_id'  => $shift->id,
                                    ]);
                                    $emailOk = false;
                                }
                            }

                            if (!$emailOk) {
                                foreach ($claimedChannels as $channel) {
                                    self::releaseReminderDeliveryClaim((int) $tenantId, (int) $userId, 'post_shift_feedback', (int) $shift->id, $channel);
                                }
                                continue;
                            }

                            // Record feedback request for each successfully handled channel.
                            $recorded = false;
                            foreach ($claimedChannels as $channel) {
                                $recorded = self::markReminderDeliverySent((int) $tenantId, (int) $userId, 'post_shift_feedback', (int) $shift->id, $channel) || $recorded;
                            }

                            if ($recorded) {
                                $totalSent++;
                            }
                        } catch (\Throwable $e) {
                            self::releaseReminderDeliveryClaims((int) $tenantId, (int) $userId, 'post_shift_feedback', (int) $shift->id, $claimedChannels);
                            Log::warning('[VolunteerReminderService] sendPostShiftFeedback error for user ' . $userId . ': ' . $e->getMessage());
                        }
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('[VolunteerReminderService] sendPostShiftFeedback tenant error for tenant ' . $tenantId . ': ' . $e->getMessage());
            }
        }

        return $totalSent;
    }

    /**
     * Nudge volunteers who have been inactive/lapsed.
     *
     * @return int Number of nudges sent
     */
    public static function nudgeLapsedVolunteers(?int $onlyTenantId = null): int
    {
        self::releaseStaleReminderDeliveryClaims();

        $totalSent = 0;
        $settingsByTenant = DB::table('vol_reminder_settings')
            ->where('reminder_type', 'lapsed_volunteer')
            ->when($onlyTenantId !== null, fn ($q) => $q->where('tenant_id', $onlyTenantId))
            ->get()
            ->keyBy('tenant_id');

        // Dedup in SQL (DISTINCT), not in PHP: the predicate matches essentially
        // every historical application forever, so ->pluck()->unique() pulled one
        // row per matching application into memory before deduping — an unbounded,
        // monotonically growing transfer on every nightly run.
        $tenantsWithInactiveVolunteers = DB::table('vol_applications as va')
            ->join('vol_shifts as vs', function ($join): void {
                $join->on('vs.id', '=', 'va.shift_id')
                    ->on('vs.tenant_id', '=', 'va.tenant_id');
            })
            ->where('va.status', 'approved')
            ->where('vs.end_time', '<=', now()->subDays(30))
            ->when($onlyTenantId !== null, fn ($q) => $q->where('va.tenant_id', $onlyTenantId))
            ->distinct()
            ->pluck('va.tenant_id')
            ->all();

        $allTenantIds = array_unique(array_merge(
            $settingsByTenant->keys()->all(),
            $tenantsWithInactiveVolunteers
        ));
        $allTenantIds = self::restrictToTenant($allTenantIds, $onlyTenantId);

        foreach ($allTenantIds as $tenantId) {
            try {
                $tenantId = (int) $tenantId;
                $setting = $settingsByTenant->get($tenantId);

                if ($setting !== null && !(bool) $setting->enabled) {
                    continue;
                }

                $daysInactive = max(1, (int) ($setting->days_inactive ?? 30));
                $emailEnabled = (bool) ($setting->email_enabled ?? true);
                if (!$emailEnabled) {
                    continue;
                }

                $cutoff = now()->subDays($daysInactive)->toDateTimeString();
                $volunteers = DB::table('vol_applications as va')
                    ->join('vol_shifts as vs', function ($join): void {
                        $join->on('vs.id', '=', 'va.shift_id')
                            ->on('vs.tenant_id', '=', 'va.tenant_id');
                    })
                    ->where('va.tenant_id', $tenantId)
                    ->where('va.status', 'approved')
                    ->select('va.user_id', DB::raw('MAX(vs.end_time) as last_shift_at'))
                    ->groupBy('va.user_id')
                    ->havingRaw('MAX(vs.end_time) <= ?', [$cutoff])
                    ->get();

                foreach ($volunteers as $volunteer) {
                    $userId = (int) $volunteer->user_id;
                    if ($userId <= 0) {
                        continue;
                    }

                    // The lapsed-volunteer nudge keys its dedup on the stable
                    // user id, so the unique (tenant,user,type,reference,channel)
                    // row written on the first send would block it forever. This
                    // is a *recurring* re-engagement reminder: re-send only when
                    // the last nudge was more than 90 days ago, clearing the
                    // stale dedup/claim rows so a fresh send can be recorded.
                    $lastNudgeAt = DB::table('vol_reminders_sent')
                        ->where('tenant_id', $tenantId)
                        ->where('user_id', $userId)
                        ->where('reminder_type', 'lapsed_volunteer')
                        ->where('channel', 'email')
                        ->max('sent_at');
                    if ($lastNudgeAt !== null) {
                        if (strtotime((string) $lastNudgeAt) > strtotime('-90 days')) {
                            continue; // nudged within the window — don't re-send
                        }
                        DB::table('vol_reminders_sent')
                            ->where('tenant_id', $tenantId)
                            ->where('user_id', $userId)
                            ->where('reminder_type', 'lapsed_volunteer')
                            ->where('channel', 'email')
                            ->delete();
                        DB::table('vol_reminder_delivery_claims')
                            ->where('tenant_id', $tenantId)
                            ->where('user_id', $userId)
                            ->where('reminder_type', 'lapsed_volunteer')
                            ->where('channel', 'email')
                            ->delete();
                    }

                    $sent = self::deliverEmailReminder(
                        $tenantId,
                        $userId,
                        'lapsed_volunteer',
                        $userId,
                        function (object $user): array {
                            $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                            $url = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/volunteering';
                            $html = EmailTemplateBuilder::make()
                                ->theme('brand')
                                ->title(__('emails_volunteer.lapsed_volunteer.title'))
                                ->previewText(__('emails_volunteer.lapsed_volunteer.preview'))
                                ->greeting($firstName)
                                ->paragraph(__('emails_volunteer.lapsed_volunteer.body'))
                                ->button(__('emails_volunteer.lapsed_volunteer.cta'), $url)
                                ->render();

                            return [
                                'subject' => __('emails_volunteer.lapsed_volunteer.subject'),
                                'html' => $html,
                            ];
                        }
                    );

                    if ($sent) {
                        $totalSent++;
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('[VolunteerReminderService] nudgeLapsedVolunteers tenant error for tenant ' . $tenantId . ': ' . $e->getMessage());
            }
        }

        return $totalSent;
    }

    /**
     * Send warnings to volunteers whose credentials are about to expire.
     *
     * @return int Number of warnings sent
     */
    public static function sendCredentialExpiryWarnings(?int $onlyTenantId = null): int
    {
        return self::sendExpiryWarnings(
            'credential_expiry',
            'vol_credentials',
            'credential_type',
            null,
            '/volunteering?tab=credentials',
            $onlyTenantId
        );
    }

    /**
     * Send warnings to volunteers whose training certifications are about to expire.
     *
     * @return int Number of warnings sent
     */
    public static function sendTrainingExpiryWarnings(?int $onlyTenantId = null): int
    {
        return self::sendExpiryWarnings(
            'training_expiry',
            'vol_safeguarding_training',
            'training_type',
            'training_name',
            '/volunteering?tab=training',
            $onlyTenantId
        );
    }

    private static function sendExpiryWarnings(
        string $reminderType,
        string $table,
        string $typeColumn,
        ?string $nameColumn,
        string $frontendPath,
        ?int $onlyTenantId = null
    ): int {
        self::releaseStaleReminderDeliveryClaims();

        $totalSent = 0;
        $settingsByTenant = DB::table('vol_reminder_settings')
            ->where('reminder_type', $reminderType)
            ->when($onlyTenantId !== null, fn ($q) => $q->where('tenant_id', $onlyTenantId))
            ->get()
            ->keyBy('tenant_id');

        $tenantsWithExpiringRecords = DB::table($table)
            ->where('status', 'verified')
            ->whereNotNull('expires_at')
            ->whereDate('expires_at', '>=', now()->toDateString())
            ->whereDate('expires_at', '<=', now()->addDays(14)->toDateString())
            ->when($onlyTenantId !== null, fn ($q) => $q->where('tenant_id', $onlyTenantId))
            ->pluck('tenant_id')
            ->unique()
            ->all();

        $allTenantIds = array_unique(array_merge(
            $settingsByTenant->keys()->all(),
            $tenantsWithExpiringRecords
        ));
        $allTenantIds = self::restrictToTenant($allTenantIds, $onlyTenantId);

        foreach ($allTenantIds as $tenantId) {
            try {
                $tenantId = (int) $tenantId;
                $setting = $settingsByTenant->get($tenantId);

                if ($setting !== null && !(bool) $setting->enabled) {
                    continue;
                }

                $daysBeforeExpiry = max(1, (int) ($setting->days_before_expiry ?? 14));
                $emailEnabled = (bool) ($setting->email_enabled ?? true);
                if (!$emailEnabled) {
                    continue;
                }

                $records = DB::table($table)
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'verified')
                    ->whereNotNull('expires_at')
                    ->whereDate('expires_at', '>=', now()->toDateString())
                    ->whereDate('expires_at', '<=', now()->addDays($daysBeforeExpiry)->toDateString())
                    ->get();

                foreach ($records as $record) {
                    $recordId = (int) $record->id;
                    $userId = (int) $record->user_id;
                    if ($recordId <= 0 || $userId <= 0) {
                        continue;
                    }

                    $label = trim((string) ($nameColumn !== null && !empty($record->{$nameColumn})
                        ? $record->{$nameColumn}
                        : $record->{$typeColumn}));
                    if ($label === '') {
                        $label = (string) $record->{$typeColumn};
                    }

                    $expiresAt = (string) $record->expires_at;
                    $sent = self::deliverEmailReminder(
                        $tenantId,
                        $userId,
                        $reminderType,
                        $recordId,
                        function (object $user) use ($reminderType, $label, $expiresAt, $frontendPath): array {
                            $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                            $url = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $frontendPath;
                            $formattedExpiry = \Carbon\Carbon::parse($expiresAt)
                                ->locale(\App\I18n\FormattingLocale::carbon())
                                ->isoFormat('LL');

                            $html = EmailTemplateBuilder::make()
                                ->theme('warning')
                                ->title(__('emails_volunteer.' . $reminderType . '.title'))
                                ->previewText(__('emails_volunteer.' . $reminderType . '.preview'))
                                ->greeting($firstName)
                                ->paragraph(__('emails_volunteer.' . $reminderType . '.body'))
                                ->infoCard([
                                    __('emails_volunteer.' . $reminderType . '.label_type') => $label,
                                    __('emails_volunteer.' . $reminderType . '.label_expires') => $formattedExpiry,
                                ])
                                ->button(__('emails_volunteer.' . $reminderType . '.cta'), $url)
                                ->render();

                            return [
                                'subject' => __('emails_volunteer.' . $reminderType . '.subject'),
                                'html' => $html,
                            ];
                        }
                    );

                    if ($sent) {
                        $totalSent++;
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('[VolunteerReminderService] ' . $reminderType . ' tenant error for tenant ' . $tenantId . ': ' . $e->getMessage());
            }
        }

        return $totalSent;
    }

    /**
     * Create or update a reminder setting for the current tenant.
     *
     * Uses UPSERT on (tenant_id, reminder_type).
     *
     * @param string $type  One of: pre_shift, post_shift_feedback, lapsed_volunteer, credential_expiry, training_expiry
     * @param array  $data  Setting fields to update
     * @return bool  True on success
     */
    public static function updateSetting(string $type, array $data): bool
    {
        $tenantId = TenantContext::getId();

        $allowedTypes = ['pre_shift', 'post_shift_feedback', 'lapsed_volunteer', 'credential_expiry', 'training_expiry'];
        if (!in_array($type, $allowedTypes, true)) {
            return false;
        }

        $values = [
            'tenant_id' => $tenantId,
            'reminder_type' => $type,
            'enabled' => isset($data['enabled']) ? (bool) $data['enabled'] : true,
            'hours_before' => isset($data['hours_before']) ? (int) $data['hours_before'] : null,
            'hours_after' => isset($data['hours_after']) ? (int) $data['hours_after'] : null,
            'days_inactive' => isset($data['days_inactive']) ? (int) $data['days_inactive'] : null,
            'days_before_expiry' => isset($data['days_before_expiry']) ? (int) $data['days_before_expiry'] : null,
            'email_template' => isset($data['email_template']) ? trim((string) $data['email_template']) : null,
            'push_enabled' => isset($data['push_enabled']) ? (bool) $data['push_enabled'] : true,
            'email_enabled' => isset($data['email_enabled']) ? (bool) $data['email_enabled'] : true,
            'sms_enabled' => isset($data['sms_enabled']) ? (bool) $data['sms_enabled'] : false,
            'updated_at' => now(),
        ];

        try {
            $existing = DB::table('vol_reminder_settings')
                ->where('tenant_id', $tenantId)
                ->where('reminder_type', $type)
                ->first();

            if ($existing) {
                DB::table('vol_reminder_settings')
                    ->where('id', $existing->id)
                    ->update($values);
            } else {
                $values['created_at'] = now();
                DB::table('vol_reminder_settings')->insert($values);
            }

            return true;
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("VolunteerReminderService::updateSetting error: " . $e->getMessage());
            return false;
        }
    }
}
