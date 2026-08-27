<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Events\GdprActionOccurred;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\EmailDispatchService;
use App\Services\NotificationDispatcher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * Notifies tenant admins (bell + push + email) when a member initiates a GDPR
 * data-rights action on themselves — a data-subject request, an immediate
 * account deletion, a personal-data export, or a consent change.
 *
 * Before this listener, member-initiated GDPR actions were silent to admins:
 * a request became a `pending` gdpr_requests row that surfaced only via a
 * dashboard count nobody had to look at, or the overdue-request cron once it was
 * already ~25 days old. This closes that gap at the moment the action happens.
 *
 * Recipients are admin-tier roles only (super_admin/admin/tenant_admin) — the
 * data controllers who can reach the /admin/enterprise/gdpr queue.
 */
class NotifyAdminOfGdprAction implements ShouldQueue
{
    /**
     * Fail fast rather than let redis re-deliver mid-flight (retry_after=90s):
     * a re-delivered fanout would re-notify every admin. timeout<retry_after
     * plus the Cache idempotency guard keep one event → one fanout.
     */
    public int $tries = 1;
    public int $timeout = 60;

    /** GDPR admin/DPO recipients — roles that can access the admin GDPR queue. */
    private const RECIPIENT_ROLES = ['super_admin', 'admin', 'tenant_admin'];

    /** Where the bell / email CTA points. */
    private const GDPR_QUEUE_PATH = '/admin/enterprise/gdpr';

    public function handle(GdprActionOccurred $event): void
    {
        $tenantId = (int) $event->tenantId;

        // Idempotency guard: one fanout per event even under a redis re-delivery.
        $handledKey = 'notify_admin_gdpr:done:' . $tenantId . ':' . $event->dedupeKey;
        $claimKey   = 'notify_admin_gdpr:claim:' . $tenantId . ':' . $event->dedupeKey;
        if (Cache::has($handledKey)) {
            Log::info('NotifyAdminOfGdprAction: duplicate fanout suppressed', ['tenant_id' => $tenantId, 'key' => $event->dedupeKey]);
            return;
        }
        $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
        if (!$claimAcquired) {
            Log::info('NotifyAdminOfGdprAction: concurrent fanout suppressed', ['tenant_id' => $tenantId, 'key' => $event->dedupeKey]);
            return;
        }

        $previousTenantId = TenantContext::currentId();

        try {
            if (!TenantContext::setById($tenantId)) {
                throw new \RuntimeException("Tenant {$tenantId} not found — cannot send GDPR admin notification.");
            }

            $tenantName = TenantContext::get()['name'] ?? __('emails.common.platform_name');
            $ctaUrl     = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . self::GDPR_QUEUE_PATH;

            // Member display name. For an erasure the users row is already
            // anonymised, so we rely on the name captured at dispatch time.
            $memberName = $this->resolveMemberName($event, $tenantId);

            $admins = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->whereIn('role', self::RECIPIENT_ROLES)
                ->where('status', 'active')
                ->select(['id', 'email', 'first_name', 'name', 'preferred_language'])
                ->get();

            if ($admins->isEmpty()) {
                Log::info('NotifyAdminOfGdprAction: no active admins found for tenant', ['tenant_id' => $tenantId]);
                return;
            }

            foreach ($admins as $admin) {
                try {
                    // Each admin sees bell + email in THEIR language.
                    LocaleContext::withLocale($admin, function () use ($admin, $event, $memberName, $tenantName, $ctaUrl, $tenantId) {
                        $copy      = $this->buildCopy($event, $memberName, $tenantName);
                        $adminName = $admin->first_name ?? $admin->name ?? __('emails.common.fallback_name');
                        $bellType  = 'gdpr_' . $event->action;

                        Notification::createNotification((int) $admin->id, $copy['bell'], self::GDPR_QUEUE_PATH, $bellType);
                        NotificationDispatcher::fanOutPush((int) $admin->id, $bellType, $copy['bell'], self::GDPR_QUEUE_PATH);

                        if (empty($admin->email)) {
                            return;
                        }

                        $html = EmailTemplateBuilder::make()
                            ->theme($copy['theme'])
                            ->title($copy['title'])
                            ->previewText($copy['preview'])
                            ->greeting($adminName)
                            ->paragraph($copy['body'])
                            ->button($copy['cta'], $ctaUrl)
                            ->render();

                        if (!EmailDispatchService::sendRaw(
                            $admin->email,
                            $copy['subject'],
                            $html,
                            null,
                            null,
                            null,
                            'admin_gdpr_action',
                            [
                                'tenant_id'       => $tenantId,
                                'idempotency_key' => 'admin_gdpr:' . $tenantId . ':' . $event->dedupeKey . ':' . $admin->id,
                            ]
                        )) {
                            Log::warning('NotifyAdminOfGdprAction: email send failed', ['admin_id' => $admin->id]);
                        }
                    });
                } catch (\Throwable $e) {
                    Log::error('NotifyAdminOfGdprAction: failed for admin', [
                        'admin_id'  => $admin->id,
                        'tenant_id' => $tenantId,
                        'action'    => $event->action,
                        'error'     => $e->getMessage(),
                    ]);
                }
            }

            // Mark handled only after the full fanout ran, so a re-delivery can't re-notify admins.
            Cache::put($handledKey, 1, now()->addHours(24));
        } catch (\Throwable $e) {
            Log::error('NotifyAdminOfGdprAction listener failed', [
                'tenant_id' => $tenantId,
                'action'    => $event->action ?? null,
                'error'     => $e->getMessage(),
            ]);
        } finally {
            if ($claimAcquired) {
                Cache::forget($claimKey);
            }
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }

    /**
     * Resolve the member's display name. Erasure anonymises the row before a
     * queued listener runs, so the pre-anonymisation name is carried on the event.
     */
    private function resolveMemberName(GdprActionOccurred $event, int $tenantId): string
    {
        if (!empty($event->subjectName)) {
            return $event->subjectName;
        }

        $row = DB::table('users')
            ->where('id', $event->userId)
            ->where('tenant_id', $tenantId)
            ->select(['first_name', 'last_name', 'profile_type', 'organization_name', 'name'])
            ->first();

        if ($row) {
            $full = UserDisplayName::resolve($row);
            if ($full !== '') {
                return $full;
            }
            if (!empty($row->name)) {
                return $row->name;
            }
        }

        return __('emails_misc.admin_notify.gdpr_fallback_member');
    }

    /**
     * Localised, per-action email + bell copy. Runs inside the recipient's
     * LocaleContext so every string resolves in their language.
     *
     * @return array{subject:string,title:string,preview:string,bell:string,body:string,cta:string,theme:string}
     */
    private function buildCopy(GdprActionOccurred $event, string $memberName, string $tenantName): array
    {
        $safeName    = htmlspecialchars($memberName, ENT_QUOTES, 'UTF-8');
        $safeCommunity = htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8');

        switch ($event->action) {
            case GdprActionOccurred::ACTION_ACCOUNT_DELETION:
                return [
                    'subject' => __('emails_misc.admin_notify.gdpr_deletion_subject', ['community' => $tenantName]),
                    'title'   => __('emails_misc.admin_notify.gdpr_deletion_title'),
                    'preview' => __('emails_misc.admin_notify.gdpr_deletion_preview', ['community' => $tenantName]),
                    'bell'    => __('emails_misc.admin_notify.gdpr_deletion_bell', ['name' => $memberName]),
                    'body'    => __('emails_misc.admin_notify.gdpr_deletion_body', ['name' => $safeName, 'community' => $safeCommunity]),
                    'cta'     => __('emails_misc.admin_notify.gdpr_deletion_cta'),
                    'theme'   => 'info',
                ];

            case GdprActionOccurred::ACTION_DATA_EXPORT:
                $format = strtoupper((string) ($event->detail ?? 'JSON'));
                return [
                    'subject' => __('emails_misc.admin_notify.gdpr_export_subject', ['community' => $tenantName]),
                    'title'   => __('emails_misc.admin_notify.gdpr_export_title'),
                    'preview' => __('emails_misc.admin_notify.gdpr_export_preview', ['community' => $tenantName]),
                    'bell'    => __('emails_misc.admin_notify.gdpr_export_bell', ['name' => $memberName, 'format' => $format]),
                    'body'    => __('emails_misc.admin_notify.gdpr_export_body', ['name' => $safeName, 'format' => $format, 'community' => $safeCommunity]),
                    'cta'     => __('emails_misc.admin_notify.gdpr_export_cta'),
                    'theme'   => 'info',
                ];

            case GdprActionOccurred::ACTION_CONSENT:
                $state = $event->granted
                    ? __('emails_misc.admin_notify.gdpr_consent_granted')
                    : __('emails_misc.admin_notify.gdpr_consent_withdrawn');
                $type = (string) ($event->detail ?? '');
                return [
                    'subject' => __('emails_misc.admin_notify.gdpr_consent_subject', ['community' => $tenantName]),
                    'title'   => __('emails_misc.admin_notify.gdpr_consent_title'),
                    'preview' => __('emails_misc.admin_notify.gdpr_consent_preview', ['community' => $tenantName]),
                    'bell'    => __('emails_misc.admin_notify.gdpr_consent_bell', ['name' => $memberName, 'state' => $state, 'type' => $type]),
                    'body'    => __('emails_misc.admin_notify.gdpr_consent_body', ['name' => $safeName, 'state' => $state, 'type' => htmlspecialchars($type, ENT_QUOTES, 'UTF-8'), 'community' => $safeCommunity]),
                    'cta'     => __('emails_misc.admin_notify.gdpr_consent_cta'),
                    'theme'   => 'info',
                ];

            case GdprActionOccurred::ACTION_REQUEST:
            default:
                $typeLabel = $this->requestTypeLabel((string) ($event->detail ?? ''));
                return [
                    'subject' => __('emails_misc.admin_notify.gdpr_request_subject', ['community' => $tenantName]),
                    'title'   => __('emails_misc.admin_notify.gdpr_request_title'),
                    'preview' => __('emails_misc.admin_notify.gdpr_request_preview', ['type' => $typeLabel, 'community' => $tenantName]),
                    'bell'    => __('emails_misc.admin_notify.gdpr_request_bell', ['name' => $memberName, 'type' => $typeLabel]),
                    'body'    => __('emails_misc.admin_notify.gdpr_request_body', ['name' => $safeName, 'type' => htmlspecialchars($typeLabel, ENT_QUOTES, 'UTF-8'), 'community' => $safeCommunity]),
                    'cta'     => __('emails_misc.admin_notify.gdpr_request_cta'),
                    'theme'   => 'warning',
                ];
        }
    }

    /** Localised label for a GDPR request type; falls back to the raw type slug. */
    private function requestTypeLabel(string $type): string
    {
        $validTypes = ['access', 'erasure', 'rectification', 'restriction', 'objection', 'portability'];
        if (in_array($type, $validTypes, true)) {
            return __('emails_misc.admin_notify.gdpr_type_' . $type);
        }
        return $type;
    }
}
