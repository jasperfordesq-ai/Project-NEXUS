<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\TenantProvisioning;

use App\Core\Env;
use App\Core\TenantContext;
use App\Core\EmailTemplateBuilder;
use App\I18n\LocaleContext;
use App\Services\EmailDispatchService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * AG44 — Welcome / rejection emails for tenant provisioning.
 *
 * Uses the platform's EmailTemplateBuilder so styling matches the rest of
 * the system. Strings are translated against `emails_provisioning.*`.
 *
 * Locale: rendered in the applicant's `default_language` so they receive
 * the correct language even when the queue worker boots in English.
 */
class TenantProvisioningMailer
{
    /**
     * Send the "your community is ready" welcome email.
     */
    public static function sendWelcome(array $request, int $tenantId, ?int $newAdminUserId = null): bool
    {
        $tenant = DB::table('tenants')->where('id', $tenantId)->first();
        if (! $tenant) {
            return false;
        }

        $applicantEmail = $request['applicant_email'] ?? null;
        if (empty($applicantEmail)) {
            return false;
        }

        $locale = $request['default_language'] ?? 'en';
        $invitationToken = null;
        try {
            TenantContext::setById($tenantId);
            if ($newAdminUserId !== null) {
                $ownsAccount = DB::table('users')->where('id', $newAdminUserId)
                    ->where('tenant_id', $tenantId)->where('email', $applicantEmail)->exists();
                if (!$ownsAccount) {
                    throw new \RuntimeException('Provisioned administrator does not match the applicant.');
                }
                $invitationToken = bin2hex(random_bytes(32));
                DB::table('password_resets')->insert([
                    'email' => $applicantEmail,
                    'tenant_id' => $tenantId,
                    'token' => hash('sha256', $invitationToken),
                    'created_at' => now(),
                ]);
            }
            $sent = LocaleContext::withLocale($locale, function () use ($request, $tenant, $tenantId, $applicantEmail, $invitationToken): bool {
                    $name      = $request['applicant_name'] ?? '';
                    $tenantUrl = self::tenantUrl($tenant);
                    $loginUrl  = $tenantUrl . '/login';

                    $builder = EmailTemplateBuilder::make()
                        ->theme('success')
                        ->title(__('emails_provisioning.welcome.title'))
                        ->previewText(__('emails_provisioning.welcome.preview', ['name' => $tenant->name]))
                        ->greeting($name ?: __('emails.common.fallback_name'))
                        ->paragraph(__('emails_provisioning.welcome.preview', ['name' => $tenant->name]));

                    $info = [
                        __('emails_provisioning.welcome.tenant_url_label')  => $tenantUrl,
                        __('emails_provisioning.welcome.login_url_label')   => $loginUrl,
                        __('emails_provisioning.welcome.admin_email_label') => $applicantEmail,
                    ];
                    $builder->infoCard($info);

                    if ($invitationToken !== null) {
                        $builder->paragraph(__('emails.password_reset.expiry'));
                        $builder->button(__('emails.password_reset.cta'), $tenantUrl . '/password/reset?token=' . $invitationToken);
                    } else {
                        $builder->button(__('emails_provisioning.welcome.cta'), $loginUrl);
                    }

                    $subject = __('emails_provisioning.welcome.subject', ['name' => $tenant->name]);
                    $html    = $builder->render();

                    return EmailDispatchService::sendRaw($applicantEmail, $subject, $html, null, null, null, 'tenant_provisioning', ['tenant_id' => $tenantId]);
            });
            if (!$sent) {
                throw new \RuntimeException('Provisioning welcome email dispatch failed.');
            }
            return true;
        } catch (Throwable $e) {
            if ($invitationToken !== null) {
                DB::table('password_resets')->where('email', $applicantEmail)->where('tenant_id', $tenantId)
                    ->where('token', hash('sha256', $invitationToken))->delete();
            }
            Log::warning('TenantProvisioningMailer welcome failed', ['error' => $e->getMessage()]);
            return false;
        } finally {
            TenantContext::reset();
        }
    }

    /**
     * Send the rejection email.
     */
    public static function sendRejection(array $request, string $reason): bool
    {
        $applicantEmail = $request['applicant_email'] ?? null;
        if (empty($applicantEmail)) {
            return false;
        }

        $locale = $request['default_language'] ?? 'en';
        return self::withoutTenantContext(function () use ($request, $reason, $applicantEmail, $locale): bool {
            return (bool) LocaleContext::withLocale($locale, function () use ($request, $reason, $applicantEmail): bool {
                try {
                    $name = $request['applicant_name'] ?? '';
                    $org  = $request['org_name'] ?? '';

                    $builder = EmailTemplateBuilder::make()
                        ->theme('warning')
                        ->title(__('emails_provisioning.rejection.title'))
                        ->previewText(__('emails_provisioning.rejection.preview'))
                        ->greeting($name ?: __('emails.common.fallback_name'))
                        ->paragraph(__('emails_provisioning.rejection.body', ['org' => $org]));

                    if (! empty($reason)) {
                        $builder->infoCard([
                            __('emails_provisioning.rejection.reason_label') => $reason,
                        ]);
                    }

                    $builder->paragraph(__('emails_provisioning.rejection.followup'));

                    $subject = __('emails_provisioning.rejection.subject');
                    $html    = $builder->render();

                    // Rejected provisioning requests do not have a tenant yet. Tell
                    // the dispatcher this is an intentional platform/pre-tenant
                    // send so a stale request or worker tenant is not inherited.
                    if (!EmailDispatchService::sendRaw($applicantEmail, $subject, $html, null, null, null, 'tenant_provisioning', ['tenant_id' => null, 'allow_missing_tenant' => true])) {
                        Log::warning('TenantProvisioningMailer rejection send returned false');
                        return false;
                    }

                    return true;
                } catch (Throwable $e) {
                    Log::warning('TenantProvisioningMailer rejection failed', ['error' => $e->getMessage()]);
                    return false;
                }
            });
        });
    }

    /**
     * Render pre-tenant provisioning emails without inheriting request/worker
     * tenant state, then restore the caller's original context.
     *
     * @template T
     * @param callable():T $callback
     * @return T
     */
    private static function withoutTenantContext(callable $callback)
    {
        $previousTenantId = TenantContext::currentId();
        TenantContext::reset();

        try {
            return $callback();
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }

    private static function tenantUrl(object $tenant): string
    {
        // Custom-domain tenant
        if (! empty($tenant->domain)) {
            return 'https://' . rtrim((string) $tenant->domain, '/');
        }

        // Sub-tenant sharing a parent's custom domain (e.g. timebanking.uk/cardiff)
        if (! empty($tenant->parent_id)) {
            $parentDomain = DB::table('tenants')
                ->where('id', (int) $tenant->parent_id)
                ->where('is_active', 1)
                ->value('domain');
            if ($parentDomain) {
                return 'https://' . rtrim((string) $parentDomain, '/') . '/' . $tenant->slug;
            }
        }

        // Shared platform host
        $base = rtrim((string) (Env::get('FRONTEND_URL') ?: 'https://app.project-nexus.ie'), '/');
        return $base . '/' . $tenant->slug;
    }
}
