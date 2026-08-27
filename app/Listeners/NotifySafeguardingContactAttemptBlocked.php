<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Events\SafeguardingContactAttemptBlocked;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * Alerts tenant safeguarding staff when a direct message is blocked.
 */
class NotifySafeguardingContactAttemptBlocked implements ShouldQueue
{
    public int $tries = 1;
    public int $timeout = 60;

    public function handle(SafeguardingContactAttemptBlocked $event): void
    {
        $typesHash = md5(json_encode($event->requiredVettingTypes));
        $handledKey = 'notify_safeguarding_contact_blocked:done:'
            . $event->tenantId . ':' . $event->senderId . ':' . $event->recipientId . ':' . $event->reasonCode . ':' . $typesHash;
        $claimKey = 'notify_safeguarding_contact_blocked:claim:'
            . $event->tenantId . ':' . $event->senderId . ':' . $event->recipientId . ':' . $event->reasonCode . ':' . $typesHash;

        if (Cache::has($handledKey)) {
            Log::info('NotifySafeguardingContactAttemptBlocked: duplicate delivery suppressed', [
                'tenant_id' => $event->tenantId,
                'sender_id' => $event->senderId,
                'recipient_id' => $event->recipientId,
                'reason_code' => $event->reasonCode,
            ]);
            return;
        }

        $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
        if (!$claimAcquired) {
            Log::info('NotifySafeguardingContactAttemptBlocked: concurrent delivery suppressed', [
                'tenant_id' => $event->tenantId,
                'sender_id' => $event->senderId,
                'recipient_id' => $event->recipientId,
                'reason_code' => $event->reasonCode,
            ]);
            return;
        }

        $previousTenantId = TenantContext::currentId();

        try {
            TenantContext::setById($event->tenantId);

            $sender = User::withoutGlobalScopes()
                ->where('tenant_id', $event->tenantId)
                ->where('id', $event->senderId)
                ->first();
            $recipient = User::withoutGlobalScopes()
                ->where('tenant_id', $event->tenantId)
                ->where('id', $event->recipientId)
                ->first();

            $senderName = $this->displayName($sender, __('emails_misc.safeguarding.contact_attempt_sender_fallback'));
            $recipientName = $this->displayName($recipient, __('emails_misc.safeguarding.contact_attempt_recipient_fallback'));

            $staffUsers = DB::select(
                "SELECT id, email, first_name, name, role, preferred_language FROM users
                 WHERE tenant_id = ? AND role IN ('admin', 'tenant_admin', 'broker', 'super_admin') AND status = 'active'",
                [$event->tenantId]
            );

            if (empty($staffUsers)) {
                Log::warning('NotifySafeguardingContactAttemptBlocked: no admin/broker users found for tenant', [
                    'tenant_id' => $event->tenantId,
                    'sender_id' => $event->senderId,
                    'recipient_id' => $event->recipientId,
                    'reason_code' => $event->reasonCode,
                ]);
                return;
            }

            $adminLink = "/broker/safeguarding?user={$event->recipientId}";

            foreach ($staffUsers as $staff) {
                LocaleContext::withLocale($staff, function () use ($staff, $event, $senderName, $recipientName, $adminLink) {
                    $reason = $this->reasonLabel($event->reasonCode);
                    $requiredVetting = $this->requiredVettingLabel($event);

                    Notification::create([
                        'tenant_id' => $event->tenantId,
                        'user_id' => $staff->id,
                        'type' => 'safeguarding_contact_blocked',
                        'message' => __('emails_misc.safeguarding.contact_attempt_bell', [
                            'sender' => $senderName,
                            'recipient' => $recipientName,
                            'reason' => $reason,
                        ]),
                        'link' => $adminLink,
                        'is_read' => false,
                        'created_at' => now(),
                    ]);

                    if (!empty($staff->email)) {
                        $this->sendEmail($staff, $event, $senderName, $recipientName, $reason, $requiredVetting, $adminLink);
                    }
                });
            }

            Cache::put($handledKey, 1, now()->addMinutes(10));

            Log::info('NotifySafeguardingContactAttemptBlocked: notified staff', [
                'tenant_id' => $event->tenantId,
                'sender_id' => $event->senderId,
                'recipient_id' => $event->recipientId,
                'reason_code' => $event->reasonCode,
                'staff_notified' => count($staffUsers),
            ]);
        } catch (\Throwable $e) {
            Log::error('NotifySafeguardingContactAttemptBlocked: failed to notify staff', [
                'tenant_id' => $event->tenantId,
                'sender_id' => $event->senderId,
                'recipient_id' => $event->recipientId,
                'reason_code' => $event->reasonCode,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            throw $e;
        } finally {
            if ($claimAcquired) {
                Cache::forget($claimKey);
            }
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }

    public function failed(SafeguardingContactAttemptBlocked $event, \Throwable $exception): void
    {
        Log::critical('NotifySafeguardingContactAttemptBlocked: PERMANENTLY FAILED', [
            'tenant_id' => $event->tenantId,
            'sender_id' => $event->senderId,
            'recipient_id' => $event->recipientId,
            'reason_code' => $event->reasonCode,
            'error' => $exception->getMessage(),
        ]);
    }

    private function sendEmail(
        object $staff,
        SafeguardingContactAttemptBlocked $event,
        string $senderName,
        string $recipientName,
        string $reason,
        string $requiredVetting,
        string $adminLink
    ): void {
        $staffName = $staff->first_name ?? $staff->name ?? __('emails_misc.safeguarding.contact_attempt_staff_fallback');
        $adminUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $adminLink;

        $html = EmailTemplateBuilder::make()
            ->theme('warning')
            ->title(__('emails_misc.safeguarding.contact_attempt_title'))
            ->previewText(__('emails_misc.safeguarding.contact_attempt_preview', [
                'sender' => $senderName,
                'recipient' => $recipientName,
            ]))
            ->greeting($staffName)
            ->paragraph(__('emails_misc.safeguarding.contact_attempt_body'))
            ->infoCard([
                __('emails_misc.safeguarding.contact_attempt_sender_label') => $senderName,
                __('emails_misc.safeguarding.contact_attempt_recipient_label') => $recipientName,
                __('emails_misc.safeguarding.contact_attempt_reason_label') => $reason,
                __('emails_misc.safeguarding.contact_attempt_required_vetting_label') => $requiredVetting,
            ])
            ->paragraph(__('emails_misc.safeguarding.contact_attempt_review'))
            ->paragraph('<em>' . __('emails_misc.safeguarding.contact_attempt_audit_note') . '</em>')
            ->button(__('emails_misc.safeguarding.contact_attempt_cta'), $adminUrl)
            ->render();

        $subject = __('emails_misc.safeguarding.contact_attempt_subject', ['recipient' => $recipientName]);
        $sent = EmailDispatchService::sendRaw($staff->email, $subject, $html, null, null, null, 'safeguarding', [
            'tenant_id' => $event->tenantId,
        ]);

        if (!$sent) {
            Log::critical('NotifySafeguardingContactAttemptBlocked: email send returned false', [
                'staff_id' => $staff->id,
                'staff_email' => $staff->email,
                'tenant_id' => $event->tenantId,
                'sender_id' => $event->senderId,
                'recipient_id' => $event->recipientId,
                'reason_code' => $event->reasonCode,
            ]);
            throw new \RuntimeException("Safeguarding contact-attempt email failed to send to staff {$staff->id}");
        }
    }

    private function displayName(?User $user, string $fallback): string
    {
        if (!$user) {
            return $fallback;
        }

        $name = UserDisplayName::resolve($user);
        if ($name !== '') {
            return $name;
        }

        return trim((string) ($user->name ?? '')) ?: $fallback;
    }

    private function reasonLabel(string $reasonCode): string
    {
        return match ($reasonCode) {
            'VETTING_REQUIRED' => __('emails_misc.safeguarding.contact_reason_vetting_required'),
            'SAFEGUARDING_CONTACT_RESTRICTED' => __('emails_misc.safeguarding.contact_reason_contact_restricted'),
            default => __('emails_misc.safeguarding.contact_reason_unknown'),
        };
    }

    private function requiredVettingLabel(SafeguardingContactAttemptBlocked $event): string
    {
        if (empty($event->requiredVettingTypes)) {
            return __('emails_misc.safeguarding.contact_attempt_required_vetting_none');
        }

        $fallbackLabels = array_values($event->requiredVettingLabels);
        $labels = [];
        foreach (array_values($event->requiredVettingTypes) as $index => $type) {
            if (!is_string($type) || $type === '') {
                continue;
            }

            $key = 'safeguarding.vetting_types.' . $type;
            $label = __($key);
            if ($label === $key) {
                $label = $fallbackLabels[$index] ?? ucwords(str_replace('_', ' ', $type));
            }
            $labels[] = $label;
        }

        return !empty($labels)
            ? implode(', ', $labels)
            : __('emails_misc.safeguarding.contact_attempt_required_vetting_none');
    }
}
