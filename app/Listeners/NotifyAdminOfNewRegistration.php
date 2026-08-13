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
            ->select(['id', 'email', 'first_name', 'name', 'preferred_language'])
            ->get();
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
            // Recipients include broker/coordinator roles (line 43) who can't
            // hit /admin/* routes — they're redirected to /dashboard. Use the
            // user-facing /profile/{id} route which works for everyone.
            $profileUrl = $baseUrl . $basePath . '/profile/' . $user->id;

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
                    LocaleContext::withLocale($admin, function () use ($admin, $user, $profileUrl, $tenantName, $adminEmail, $event) {
                        $adminName = $admin->first_name ?? $admin->name ?? 'Admin';

                        $bellContent = __('emails_misc.admin_notify.new_user_bell');
                        // Bell goes to broker/coordinator recipients too (line 43).
                        // Use the broker panel members list which all admin-tier
                        // and broker-tier roles can access.
                        Notification::createNotification((int) $admin->id, $bellContent, '/broker/members', 'new_user_registered');
                        \App\Services\NotificationDispatcher::fanOutPush((int) $admin->id, 'new_user_registered', $bellContent, '/broker/members');

                        $subject = __('emails_misc.admin_notify.new_user_subject', ['community' => $tenantName]);

                        $html = EmailTemplateBuilder::make()
                            ->theme('info')
                            ->title(__('emails_misc.admin_notify.new_user_title'))
                            ->previewText(__('emails_misc.admin_notify.new_user_preview', ['community' => $tenantName]))
                            ->greeting($adminName)
                            ->paragraph(__('emails_misc.admin_notify.new_user_body', ['community' => htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8')]))
                            ->button(__('emails_misc.admin_notify.new_user_cta'), $profileUrl)
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
