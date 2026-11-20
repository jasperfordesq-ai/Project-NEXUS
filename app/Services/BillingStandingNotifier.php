<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Tells a community's own admins that it has been paused for non-payment, and
 * that it has been restored.
 *
 * Every admin of the community, not the first one found: the person who can
 * sort out the payment may not be whoever happens to come first. Each is
 * mailed in their own language, with the subject rendered inside the loop.
 * "Admin" includes accounts whose admin level is a flag and not a role.
 *
 * Members are never mailed about this, and the member-facing paused page does
 * not say why. Category `billing`, which is on the list of mail a paused
 * community may still receive.
 *
 * Callers decide WHEN (only when the state really changed); a failure to send
 * is theirs to swallow, so a pause never fails because mail did.
 */
final class BillingStandingNotifier
{
    /** @return int how many admins were mailed */
    public static function paused(int $tenantId): int
    {
        $community = DB::table('tenants')->where('id', $tenantId)->first(['id', 'name', 'parent_id']);
        if (!$community) {
            return 0;
        }

        $payee = null;
        if (BillingStandingService::get($tenantId)['payer'] === 'parent' && $community->parent_id !== null) {
            $payee = DB::table('tenants')->where('id', (int) $community->parent_id)->value('name');
        }

        return self::send(
            $tenantId,
            (string) $community->name,
            'emails_misc.billing_standing.paused_subject',
            'emails_misc.billing_standing.paused_title',
            $payee !== null ? 'emails_misc.billing_standing.paused_body_parent' : 'emails_misc.billing_standing.paused_body_platform',
            ['payee' => (string) $payee],
            'warning'
        );
    }

    /** @return int how many admins were mailed */
    public static function restored(int $tenantId): int
    {
        $community = DB::table('tenants')->where('id', $tenantId)->first(['id', 'name']);
        if (!$community) {
            return 0;
        }

        return self::send(
            $tenantId,
            (string) $community->name,
            'emails_misc.billing_standing.restored_subject',
            'emails_misc.billing_standing.restored_title',
            'emails_misc.billing_standing.restored_body',
            [],
            'default'
        );
    }

    /**
     * @param array<string, string> $bodyParams
     */
    private static function send(
        int $tenantId,
        string $communityName,
        string $subjectKey,
        string $titleKey,
        string $bodyKey,
        array $bodyParams,
        string $theme
    ): int {
        $admins = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereNotNull('email')
            ->where(static function ($query): void {
                $query->whereIn('role', ['admin', 'tenant_admin'])
                    ->orWhere('is_admin', 1)
                    ->orWhere('is_tenant_super_admin', 1)
                    ->orWhere('is_super_admin', 1);
            })
            ->get(['id', 'email', 'first_name', 'name', 'preferred_language']);

        if ($admins->isEmpty()) {
            return 0;
        }

        $safeName = htmlspecialchars($communityName, ENT_QUOTES, 'UTF-8');
        $params = ['community' => $safeName];
        foreach ($bodyParams as $key => $value) {
            $params[$key] = htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
        }

        return (int) TenantContext::runForTenant($tenantId, static function () use ($admins, $tenantId, $communityName, $subjectKey, $titleKey, $bodyKey, $params, $theme): int {
            $adminUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/admin';
            $sent = 0;

            foreach ($admins as $admin) {
                $ok = LocaleContext::withLocale($admin, static function () use ($admin, $tenantId, $communityName, $subjectKey, $titleKey, $bodyKey, $params, $theme, $adminUrl): bool {
                    $builder = EmailTemplateBuilder::make();
                    if ($theme !== 'default') {
                        $builder->theme($theme);
                    }

                    $html = $builder
                        ->title(__($titleKey))
                        ->greeting($admin->first_name ?? $admin->name ?? __('emails.common.fallback_name'))
                        ->paragraph(__($bodyKey, $params))
                        ->button(__('emails_misc.billing_standing.cta'), $adminUrl)
                        ->render();

                    // The subject is plain text: the community's name as it is.
                    return EmailDispatchService::sendRaw(
                        (string) $admin->email,
                        __($subjectKey, ['community' => $communityName]),
                        $html,
                        null,
                        null,
                        null,
                        'billing',
                        ['tenant_id' => $tenantId]
                    );
                });

                // Counted when it reached the mailer, whatever the provider said.
                $sent++;

                if (!$ok) {
                    Log::warning('[BillingStandingNotifier] mail to a community admin was not accepted', [
                        'tenant_id' => $tenantId,
                        'user_id' => (int) $admin->id,
                    ]);
                }
            }

            return $sent;
        });
    }
}
