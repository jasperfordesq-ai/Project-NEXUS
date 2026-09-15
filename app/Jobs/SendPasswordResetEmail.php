<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Jobs;

use App\Core\EmailTemplateBuilder;
use App\Core\Env;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Services\EmailDispatchService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Sends a "forgot password" reset email out-of-process.
 *
 * 🔴 SECURITY (E-013 F-023). This work is queued rather than run inside the
 * request ON PURPOSE. `forgot-password` deliberately returns an identical
 * generic message whether or not the email belongs to an account, but the
 * reset email is a multi-second SMTP/API call and was previously sent inline —
 * and ONLY for an account that exists. That made an existing address answer
 * measurably slower than an unknown one, a response-time oracle that let an
 * attacker enumerate which emails are registered. The platform runs PHP under
 * mod_php (no `fastcgi_finish_request`), so the response cannot be flushed
 * before deferred/terminate work; the reliable fix is to move the whole
 * lookup-and-send off the request onto the queue worker, so the controller
 * does identical, constant work for every address.
 *
 * The controller therefore dispatches this job UNCONDITIONALLY — the
 * account-existence lookup lives here, not in the request — so no branch in the
 * request path depends on whether the address exists.
 */
final class SendPasswordResetEmail implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 3;
    public int $timeout = 30;

    public function __construct(
        public readonly string $email,
        public readonly ?int $requestTenantId,
    ) {
        $this->onQueue('emails');
    }

    public function handle(): void
    {
        try {
            // Re-establish the community context the request resolved from, so
            // the tenant-scoped lookup below matches what the member saw.
            if ($this->requestTenantId !== null) {
                TenantContext::setById($this->requestTenantId);
            }
            $this->processPasswordResetRequest($this->email);
        } finally {
            TenantContext::reset();
        }
    }

    private function processPasswordResetRequest(string $email): void
    {
        $masked = substr($email, 0, 2) . '***@' . (explode('@', $email)[1] ?? '***');
        $user = $this->resolvePasswordResetUser($email);

        if (!$user) {
            // User doesn't exist in this tenant or any community beneath it. The
            // RESPONSE stays deliberately identical to the success case — telling
            // the caller "no such account" would turn this endpoint into an
            // email-enumeration oracle. Only the LOG distinguishes them.
            //
            // 🔴 This is a `warning`, not an `info`, on purpose: production's
            // daily log level is `warning`, so the old `info` was written
            // nowhere. That is what made a silently-dropped reset request
            // undiagnosable — the member was told to check their inbox for an
            // email that had never been created, and nothing recorded it.
            Log::warning('[PasswordReset] reset requested for unknown email', [
                'email_masked' => $masked,
                'tenant_id' => TenantContext::getId(),
                'ip' => \App\Core\ClientIp::get(),
            ]);
            return;
        }

        // Generate a secure random token (256-bit entropy, hex-encoded)
        $token = bin2hex(random_bytes(32));

        // Hash the token with SHA-256 for storage. SHA-256 is appropriate here
        // (NOT for passwords) because the token is high-entropy random data.
        // This enables an indexed exact-match lookup instead of scanning
        // every non-expired record with bcrypt's password_verify().
        $hashedToken = hash('sha256', $token);

        $userTenantId = isset($user['tenant_id']) ? (int) $user['tenant_id'] : null;

        // Build reset URL — include tenant base path for correct routing
        $resetUrl = null;
        $tenantName = 'Project NEXUS';
        try {
            TenantContext::setById($userTenantId);
        $appUrl = TenantContext::getFrontendUrl();
        $basePath = TenantContext::getSlugPrefix();

        // Defensive: ensure frontend URL is never the API URL
        if (!$appUrl || str_contains($appUrl, 'api.')) {
            $appUrl = Env::get('APP_URL', 'https://app.project-nexus.ie');
            if (str_contains($appUrl, 'api.')) {
                $appUrl = str_replace('api.', 'app.', $appUrl);
            }
        }

        $resetUrl = $appUrl . $basePath . "/password/reset?token=" . $token;
            $tenantName = TenantContext::get()['name'] ?? 'Project NEXUS';
        } finally {
            TenantContext::reset();
        }

        // Send reset email under the user's preferred locale
        try {
            TenantContext::setById($userTenantId);
            $resetEmailSent = (bool) LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($user, $email, $resetUrl, $tenantName, $userTenantId) {
                // greeting() expects the bare NAME — it wraps it in
                // emails.common.greeting and escapes at render. Passing a full
                // translated greeting rendered "Hi Hi John,," with a
                // double-escaped name.
                $firstName = $user['first_name'] ?? ($user['name'] ?? null);

                $html = EmailTemplateBuilder::make()
                    ->theme('warning')
                    ->title(__('emails.password_reset.title'))
                    ->previewText(__('emails.password_reset.preview'))
                    ->greeting($firstName ?? __('emails.common.fallback_name'))
                    ->paragraph(__('emails.password_reset.body'))
                    ->paragraph(__('emails.password_reset.expiry'))
                    ->button(__('emails.password_reset.cta'), $resetUrl)
                    ->paragraph(__('emails.password_reset.ignore'))
                    ->render();

                $subject = __('emails.password_reset.subject', ['community' => $tenantName]);
                return EmailDispatchService::sendRaw($email, $subject, $html, null, null, null, 'password_reset', ['tenant_id' => $userTenantId]);
            });
            if (!$resetEmailSent) {
                // A normal return marks a queued job successful. Throw so
                // Horizon applies this job's three-attempt policy instead of
                // silently discarding a transient provider refusal.
                throw new \RuntimeException('Password reset email dispatch failed.');
            }

            // Rotate reset tokens only after the dispatcher accepts the new
            // email. If SMTP/Gmail fails, any previous valid link remains
            // usable instead of being silently invalidated.
            if ($userTenantId !== null) {
                DB::delete(
                    "DELETE FROM password_resets WHERE email = ? AND tenant_id <=> ?",
                    [$email, $userTenantId]
                );
            } else {
                DB::delete(
                    "DELETE FROM password_resets WHERE email = ? AND tenant_id IS NULL",
                    [$email]
                );
            }

            DB::insert(
                "INSERT INTO password_resets (email, tenant_id, token, created_at) VALUES (?, ?, ?, NOW())",
                [$email, $userTenantId, $hashedToken]
            );

            Log::info('[PasswordReset] reset email dispatched', [
                'email_masked' => $masked,
                'user_id' => $user['id'] ?? null,
                'tenant_id' => $userTenantId,
            ]);
        } catch (\Throwable $e) {
            Log::warning('[PasswordReset] Password reset email failed for ' . $masked . ': ' . $e->getMessage(), [
                'user_id' => $user['id'] ?? null,
                'tenant_id' => $userTenantId,
            ]);
            throw $e;
        } finally {
            TenantContext::reset();
        }
    }

    private function resolvePasswordResetUser(string $email): ?array
    {
        $tenantId = TenantContext::getId();
        $normalizedEmail = strtolower(trim($email));

        if ($tenantId && $tenantId !== 1) {
            $row = DB::table('users')
                ->where('email', $normalizedEmail)
                ->where('tenant_id', $tenantId)
                ->whereNull('deleted_at')
                ->first();

            if ($row) {
                return (array) $row;
            }

            // Not in this tenant — try the sub-communities BENEATH it before
            // giving up. A sub-tenant with no domain of its own is only
            // reachable at `<parent-domain>/<slug>`, so a member who starts from
            // the parent domain root resolves to the PARENT and would otherwise
            // get no email at all while being told to check their inbox. The
            // boundary is this tenant's own subtree, never "any tenant".
            $subtreeIds = \App\Support\Tenancy\TenantSubtree::descendantIds((int) $tenantId);

            if ($subtreeIds === []) {
                return null;
            }

            $matches = DB::table('users')
                ->where('email', $normalizedEmail)
                ->whereIn('tenant_id', $subtreeIds)
                ->whereNull('deleted_at')
                ->orderBy('tenant_id')
                ->limit(2)
                ->get();

            if ($matches->count() === 1) {
                return (array) $matches->first();
            }

            if ($matches->count() > 1) {
                // Cannot tell which community they meant. Sending to both would
                // be confusing and doubles the reset tokens in flight; ask them
                // to use their community's own link instead. Logged at warning
                // because production runs at `warning` — an `info` here is
                // written nowhere and made this class of failure invisible.
                Log::warning('[PasswordReset] ambiguous sub-community reset request', [
                    'email_masked' => substr($email, 0, 2) . '***@' . (explode('@', $email)[1] ?? '***'),
                    'resolved_tenant_id' => (int) $tenantId,
                    'candidate_tenant_ids' => $matches->pluck('tenant_id')->all(),
                ]);
            }

            return null;
        }

        $rows = DB::table('users')
            ->where('email', $normalizedEmail)
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->limit(2)
            ->get();

        if ($rows->count() === 1) {
            return (array) $rows->first();
        }

        if ($rows->count() > 1) {
            Log::warning('[PasswordReset] ambiguous global reset request for email present in multiple tenants', [
                'email_masked' => substr($email, 0, 2) . '***@' . (explode('@', $email)[1] ?? '***'),
            ]);
        }

        return null;
    }

}
