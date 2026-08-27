<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Events\SafeguardingFlaggedEvent;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\TenantSafeguardingOption;
use App\Models\User;
use App\Models\UserSafeguardingPreference;
use App\Services\EmailDispatchService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * Notifies all admin and broker users when a member self-identifies
 * safeguarding needs during onboarding.
 *
 * Sends both in-app notifications and HTML emails so that safeguarding
 * flags are never missed. This is queued for performance but runs quickly.
 */
class NotifySafeguardingStaff implements ShouldQueue
{
    /**
     * Fail fast rather than letting redis re-deliver mid-flight. The queue's
     * retry_after is 90s; a slow staff fanout (bell + email per admin/broker)
     * released back to another worker would re-alert every staff member.
     * Killing at 60s and not retrying keeps one flag → one fanout.
     * Belt-and-braces with the Cache guard in handle(); the done marker is only
     * set after the FULL fanout succeeds, so a never-delivered alert is never
     * suppressed — a failed run still surfaces via failed() (logged critical).
     */
    public int $tries = 1;
    public int $timeout = 60;

    public function __construct()
    {
        //
    }

    public function handle(SafeguardingFlaggedEvent $event): void
    {
        // Idempotency guard: suppress duplicate/concurrent re-deliveries for the
        // same flag event. The key includes the triggers so a genuinely NEW flag
        // for the same member (e.g. settings updated again) is never suppressed;
        // the done marker is only written after every staff member was notified.
        $guardTenantId = (int) ($event->tenantId ?? 0);
        $triggersHash = md5(json_encode($event->triggers));
        $handledKey = 'notify_safeguarding_staff:done:' . $guardTenantId . ':' . (int) $event->userId . ':' . $triggersHash;
        $claimKey = 'notify_safeguarding_staff:claim:' . $guardTenantId . ':' . (int) $event->userId . ':' . $triggersHash;
        if (Cache::has($handledKey)) {
            Log::info('NotifySafeguardingStaff: duplicate delivery suppressed', ['user_id' => $event->userId, 'tenant_id' => $guardTenantId]);
            return;
        }
        $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
        if (!$claimAcquired) {
            Log::info('NotifySafeguardingStaff: concurrent delivery suppressed', ['user_id' => $event->userId, 'tenant_id' => $guardTenantId]);
            return;
        }

        $previousTenantId = TenantContext::currentId();

        try {
            $tenantId      = $event->tenantId;
            $flaggedUserId = $event->userId;

            // Set tenant context for queued job
            TenantContext::setById($tenantId);

            // Load the flagged member's name
            $flaggedUser = User::find($flaggedUserId);
            $memberName  = $flaggedUser
                ? UserDisplayName::resolve($flaggedUser) ?: ($flaggedUser->name ?? 'Unknown member')
                : 'Unknown member';

            // Build a summary of what was selected
            $selectedOptions = DB::select(
                "SELECT usp.selected_value, tso.option_key, tso.option_type, tso.preset_source, tso.label FROM user_safeguarding_preferences usp
                 JOIN tenant_safeguarding_options tso ON tso.id = usp.option_id
                 WHERE usp.user_id = ? AND usp.tenant_id = ? AND usp.revoked_at IS NULL AND tso.is_active = 1",
                [$flaggedUserId, $tenantId]
            );
            $selectedOptions = array_values(array_filter(
                $selectedOptions,
                static fn (object $option): bool => UserSafeguardingPreference::isEffectivelySelected(
                    $option->option_type ?? null,
                    $option->selected_value ?? null,
                ),
            ));
            // Find all admin, tenant_admin, broker, and super_admin users for this tenant
            $staffUsers = DB::select(
                "SELECT id, email, first_name, name, role, preferred_language FROM users
                 WHERE tenant_id = ? AND role IN ('admin', 'tenant_admin', 'broker', 'super_admin') AND status = 'active'",
                [$tenantId]
            );

            if (empty($staffUsers)) {
                Log::warning('NotifySafeguardingStaff: no admin/broker users found for tenant', [
                    'tenant_id'       => $tenantId,
                    'flagged_user_id' => $flaggedUserId,
                ]);
                return;
            }

            $adminLink = "/broker/safeguarding?user={$flaggedUserId}";

            foreach ($staffUsers as $staff) {
                // Each staff member sees bell copy + email in THEIR language.
                LocaleContext::withLocale($staff, function () use ($staff, $memberName, $selectedOptions, $flaggedUserId, $tenantId, $adminLink) {
                    $localizedOptionLabels = array_map(
                        static fn (object $option): string => TenantSafeguardingOption::localizeOptionText(
                            $option->preset_source,
                            $option->option_key,
                            'label',
                            $option->label,
                        ) ?? $option->label,
                        $selectedOptions,
                    );
                    $optionSummary = !empty($localizedOptionLabels)
                        ? implode(', ', $localizedOptionLabels)
                        : __('emails_misc.safeguarding.onboarding_flag_options_label');

                    $notificationMessage = __('emails_misc.safeguarding.onboarding_flag_bell', [
                        'name'    => $memberName,
                        'options' => $optionSummary,
                    ]);

                    Notification::create([
                        'tenant_id'  => $tenantId,
                        'user_id'    => $staff->id,
                        'type'       => 'safeguarding_flag',
                        'message'    => $notificationMessage,
                        'link'       => $adminLink,
                        'is_read'    => false,
                        'created_at' => now(),
                    ]);

                    if (!empty($staff->email)) {
                        $this->sendEmail($staff, $memberName, $localizedOptionLabels, $flaggedUserId, $tenantId, $adminLink);
                    }
                });
            }

            Log::info('NotifySafeguardingStaff: notified staff', [
                'tenant_id'        => $tenantId,
                'flagged_user_id'  => $flaggedUserId,
                'staff_notified'   => count($staffUsers),
                'options_selected_count' => count($selectedOptions),
            ]);

            // Mark handled only after EVERY staff member was notified so a redis
            // re-delivery cannot re-alert staff — and a partial/failed run is
            // never marked done (the alert is never silently suppressed).
            Cache::put($handledKey, 1, now()->addHour());
        } catch (\Throwable $e) {
            Log::error('NotifySafeguardingStaff: failed to notify staff', [
                'user_id'   => $event->userId ?? null,
                'tenant_id' => $event->tenantId ?? null,
                'error'     => $e->getMessage(),
                'trace'     => $e->getTraceAsString(),
            ]);
            // Re-throw so the job is marked failed and failed() fires
            // (safeguarding notifications are legally critical — must not be silently lost)
            throw $e;
        } finally {
            if ($claimAcquired) {
                Cache::forget($claimKey);
            }
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }

    /**
     * Handle a listener failure — log for monitoring.
     */
    public function failed(SafeguardingFlaggedEvent $event, \Throwable $exception): void
    {
        Log::critical('NotifySafeguardingStaff: PERMANENTLY FAILED', [
            'user_id'   => $event->userId,
            'tenant_id' => $event->tenantId,
            'error'     => $exception->getMessage(),
        ]);
    }

    private function sendEmail(
        object $staff,
        string $memberName,
        array  $optionLabels,
        int    $flaggedUserId,
        int    $tenantId,
        string $adminLink
    ): void {
        $staffName  = $staff->first_name ?? $staff->name ?? 'Team member';
        $adminUrl   = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $adminLink;

        $bulletItems = !empty($optionLabels)
            ? $optionLabels
            : [__('emails_misc.safeguarding.onboarding_flag_options_label')];

        $html = EmailTemplateBuilder::make()
            ->theme('warning')
            ->title(__('emails_misc.safeguarding.onboarding_flag_title'))
            ->previewText(__('emails_misc.safeguarding.onboarding_flag_preview', ['name' => $memberName]))
            ->greeting($staffName)
            ->paragraph(__('emails_misc.safeguarding.onboarding_flag_body'))
            ->highlight(htmlspecialchars($memberName, ENT_QUOTES, 'UTF-8'), '🚨')
            ->bulletList($bulletItems)
            ->paragraph(__('emails_misc.safeguarding.onboarding_flag_review'))
            ->paragraph('<em>' . __('emails_misc.safeguarding.onboarding_flag_audit_note') . '</em>')
            ->button(__('emails_misc.safeguarding.onboarding_flag_cta'), $adminUrl)
            ->render();

        $subject = __('emails_misc.safeguarding.onboarding_flag_subject', ['name' => $memberName]);
        $sent    = EmailDispatchService::sendRaw($staff->email, $subject, $html, null, null, null, 'safeguarding', ['tenant_id' => $tenantId]);

        if (!$sent) {
            Log::critical('NotifySafeguardingStaff: email send returned false — safeguarding notification not delivered', [
                'staff_id'        => $staff->id,
                'staff_email'     => $staff->email,
                'flagged_user_id' => $flaggedUserId,
                'tenant_id'       => $tenantId,
            ]);
            throw new \RuntimeException(
                "Safeguarding email failed to send to staff {$staff->id} ({$staff->email}) — job will be marked failed"
            );
        }
    }
}
