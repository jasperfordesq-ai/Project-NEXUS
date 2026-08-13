<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Events\UserRegistered;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\EmailDispatchService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Notifies all admins, brokers, and coordinators when a new user registers.
 */
class NotifyAdminOfNewRegistration
{
    /**
     * Everyone in a tenant who should hear that a member is waiting.
     *
     * 🔴 This used to select on the `role` string ALONE, inline in handle(),
     * which silently lost real admins. Per the authorisation rules,
     * `super_admin`, `god`, `tenant_admin` and `coordinator` are never written
     * to `users.role` by the API — that authority is carried by the boolean
     * flags below, with `role` often left as 'member'. A coordinator set up
     * that way received NO registration email and NO bell, and had to discover
     * pending members by opening the admin panel and looking. Reported from a
     * real community (Minehead & Coast, 2026-08-12) as the top-priority fault.
     *
     * The predicate deliberately mirrors AdminTier::allows() (role strings OR
     * any admin flag) and then ADDS broker/coordinator, which AdminTier
     * excludes on purpose. That difference is correct here: AdminTier answers
     * "may this account reach /v2/admin/*", whereas this answers "who should
     * hear that a member is waiting" — and brokers/coordinators are exactly
     * the people who action that queue. Keep both halves; dropping either one
     * reintroduces a silent gap.
     *
     * Extracted from handle() so it can be asserted directly against real rows
     * — the listener's own tests need alias mocks and are quarantined as
     * order-dependent, so they could not have caught this.
     *
     * @return \Illuminate\Support\Collection<int, object>
     */
    public static function recipientsFor(int $tenantId): \Illuminate\Support\Collection
    {
        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where(function ($query) {
                $query
                    ->whereIn('role', ['super_admin', 'admin', 'tenant_admin', 'broker', 'coordinator'])
                    ->orWhere('is_admin', 1)
                    ->orWhere('is_super_admin', 1)
                    ->orWhere('is_tenant_super_admin', 1)
                    ->orWhere('is_god', 1);
            })
            // role + the four flags are selected because handle() passes each
            // row to AdminTier::allows() to decide whether that recipient can
            // actually open /admin/users?filter=pending. Drop them and every
            // recipient silently falls back to the broker list.
            ->select([
                'id', 'email', 'first_name', 'name', 'preferred_language',
                'role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god',
            ])
            ->get();
    }

    /**
     * Decide what this recipient is told, and where they are sent.
     *
     * Extracted from handle() for the same reason recipientsFor() was: the
     * fan-out tests need Mockery alias mocks, became order-dependent and are
     * both markTestSkipped, so anything left inline here is untested in
     * practice. This is pure — no DB, no container — so it can be asserted
     * directly.
     *
     * Two independent decisions:
     *   1. WHICH COPY. One key prefix drives subject, title, preview, body,
     *      bell and button together, so they cannot disagree about whether an
     *      approval is outstanding.
     *   2. WHERE TO SEND THEM. Only admin-tier accounts may open /admin/*;
     *      AdminTier deliberately refuses broker and coordinator, who are
     *      redirected to /dashboard. Sending a broker to the approvals queue
     *      would hand them a dead link, so they keep the broker members list.
     *
     * @param object $recipient a row from recipientsFor()
     * @return array{key: string, bell_link: string, cta_url: string}
     */
    public static function alertPlanFor(
        object $recipient,
        bool $needsApproval,
        string $profileUrl,
        string $adminQueueUrl,
        string $brokerListUrl
    ): array {
        if (!$needsApproval) {
            return [
                'key'       => 'new_user_',
                'bell_link' => '/broker/members',
                'cta_url'   => $profileUrl,
            ];
        }

        $canReachAdminQueue = \App\Support\Authorization\AdminTier::allows($recipient);

        return [
            'key'       => 'new_user_pending_',
            'bell_link' => $canReachAdminQueue ? '/admin/users?filter=pending' : '/broker/members',
            'cta_url'   => $canReachAdminQueue ? $adminQueueUrl : $brokerListUrl,
        ];
    }

    public function handle(UserRegistered $event): void
    {
        // Idempotency guard: suppress duplicate/concurrent deliveries so the admin
        // fanout (email + bell to every admin) runs exactly once per event.
        $entityId = (int) ($event->user->id ?? 0);
        $tenantId = (int) ($event->tenantId ?? 0);
        $handledKey = null;
        $claimKey = null;
        $claimAcquired = false;
        if ($entityId > 0) {
            $handledKey = 'notify_admin_new_registration:done:' . $tenantId . ':' . $entityId;
            $claimKey = 'notify_admin_new_registration:claim:' . $tenantId . ':' . $entityId;
            if (Cache::has($handledKey)) {
                Log::info('NotifyAdminOfNewRegistration: duplicate fanout suppressed', ['entity_id' => $entityId, 'tenant_id' => $tenantId]);
                return;
            }
            $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
            if (!$claimAcquired) {
                Log::info('NotifyAdminOfNewRegistration: concurrent fanout suppressed', ['entity_id' => $entityId, 'tenant_id' => $tenantId]);
                return;
            }
        }

        $previousTenantId = TenantContext::currentId();

        try {
            if (!TenantContext::setById($event->tenantId)) {
                throw new \RuntimeException("Tenant {$event->tenantId} not found — cannot send admin registration notification.");
            }

            $user = $event->user;
            $tenantName = TenantContext::get()['name'] ?? 'Project NEXUS';
            $baseUrl    = TenantContext::getFrontendUrl();
            $basePath   = TenantContext::getSlugPrefix();
            // Recipients include broker/coordinator roles who can't hit
            // /admin/* routes — they're redirected to /dashboard. Use the
            // user-facing /profile/{id} route which works for everyone.
            $profileUrl = $baseUrl . $basePath . '/profile/' . $user->id;

            // 🔴 Does this registration actually need somebody to act?
            //
            // The alert used to be the same either way: subject "New member
            // registered", body "log in to view their profile", button to that
            // profile. On a community that requires approval, that is the wrong
            // message — the member is sitting locked out until a coordinator
            // acts, and nothing in the alert says so. A real coordinator
            // (Minehead & Coast) reported receiving "no alert" at all; the
            // records showed the email WAS delivered and the bell WAS opened.
            // It simply never told her there was a job to do, so it read as
            // routine noise and she went hunting in the admin panel instead.
            //
            // Keyed off the tenant setting rather than the user row on purpose:
            // this listener runs during registration while the row's status and
            // is_approved are still being settled, so reading them here races
            // that. If the community requires approval, a member who just
            // registered is by definition awaiting it.
            $needsApproval = false;
            try {
                $needsApproval = app(\App\Services\TenantSettingsService::class)
                    ->requiresAdminApproval((int) $event->tenantId);
            } catch (\Throwable $e) {
                // Fall back to the neutral "registered" wording rather than
                // claiming an approval is needed when we could not find out.
                Log::warning('NotifyAdminOfNewRegistration: could not read approval setting', [
                    'tenant_id' => $event->tenantId,
                    'error'     => $e->getMessage(),
                ]);
            }

            // Where "go and deal with it" should point. Admin-tier recipients
            // get the actual pending-approvals queue; brokers and coordinators
            // are deliberately refused /admin/* (see AdminTier), so they keep
            // the broker members list they can actually open.
            $adminQueueUrl  = $baseUrl . $basePath . '/admin/users?filter=pending';
            $brokerListUrl  = $baseUrl . $basePath . '/broker/members';

            $admins = self::recipientsFor((int) $event->tenantId);

            if ($admins->isEmpty()) {
                Log::info('NotifyAdminOfNewRegistration: no active admins found for tenant', ['tenant_id' => $event->tenantId]);
                return;
            }

            foreach ($admins as $admin) {
                $adminEmail = $admin->email ?? null;
                if (!$adminEmail) {
                    continue;
                }

                try {
                    LocaleContext::withLocale($admin, function () use ($admin, $user, $profileUrl, $tenantName, $adminEmail, $event, $needsApproval, $adminQueueUrl, $brokerListUrl) {
                        $adminName = $admin->first_name ?? $admin->name ?? 'Admin';

                        $plan = self::alertPlanFor($admin, $needsApproval, $profileUrl, $adminQueueUrl, $brokerListUrl);
                        $key      = $plan['key'];
                        $bellLink = $plan['bell_link'];
                        $ctaUrl   = $plan['cta_url'];

                        $bellContent = __('emails_misc.admin_notify.' . $key . 'bell');
                        Notification::createNotification((int) $admin->id, $bellContent, $bellLink, 'new_user_registered');
                        \App\Services\NotificationDispatcher::fanOutPush((int) $admin->id, 'new_user_registered', $bellContent, $bellLink);

                        $subject = __('emails_misc.admin_notify.' . $key . 'subject', ['community' => $tenantName]);

                        $html = EmailTemplateBuilder::make()
                            ->theme($needsApproval ? 'warning' : 'info')
                            ->title(__('emails_misc.admin_notify.' . $key . 'title'))
                            ->previewText(__('emails_misc.admin_notify.' . $key . 'preview', ['community' => $tenantName]))
                            ->greeting($adminName)
                            ->paragraph(__('emails_misc.admin_notify.' . $key . 'body', ['community' => htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8')]))
                            ->button(__('emails_misc.admin_notify.' . $key . 'cta'), $ctaUrl)
                            ->render();

                        if (!EmailDispatchService::sendRaw($adminEmail, $subject, $html, null, null, null, 'admin_new_registration', [
                            'tenant_id' => $event->tenantId,
                            'idempotency_key' => 'admin_new_registration:' . $event->tenantId . ':' . $user->id . ':' . $admin->id,
                        ])) {
                            Log::warning('NotifyAdminOfNewRegistration: email send failed', ['admin_id' => $admin->id, 'email' => $adminEmail]);
                        }
                    });
                } catch (\Throwable $e) {
                    Log::error('NotifyAdminOfNewRegistration: failed for admin', [
                        'admin_id'  => $admin->id,
                        'user_id'   => $user->id,
                        'tenant_id' => $event->tenantId,
                        'error'     => $e->getMessage(),
                    ]);
                }
            }

            // Mark handled only after the full fanout ran, so a duplicate delivery can't re-email admins.
            if ($handledKey !== null) {
                Cache::put($handledKey, 1, now()->addHours(24));
            }
        } finally {
            if ($claimAcquired && $claimKey !== null) {
                Cache::forget($claimKey);
            }
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }
}
