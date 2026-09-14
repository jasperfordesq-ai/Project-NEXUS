<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Jobs;

use App\Core\TenantContext;
use App\Services\EmailVerificationSender;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;

/**
 * Sends the public "resend my verification email" out of the request.
 *
 * 🔴 SECURITY (E-013 F-024). `resend-verification-by-email` returns an identical
 * generic message whether or not the address has an account, but sending the
 * verification email inline — and only for an account that exists AND is
 * unverified — made that address answer measurably slower than an unknown one,
 * a response-time oracle for enumerating unverified accounts. The platform runs
 * PHP under mod_php (no early response flush), so this work is dispatched to the
 * queue. The controller dispatches it UNCONDITIONALLY — the account lookup lives
 * here, not in the request — so the request path does identical, constant work
 * for every address. Same pattern and reasoning as F-023's SendPasswordResetEmail.
 */
final class SendEmailVerificationResend implements ShouldQueue
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

    public function handle(EmailVerificationSender $sender): void
    {
        try {
            if ($this->requestTenantId !== null) {
                TenantContext::setById($this->requestTenantId);
            }

            $tenantId = TenantContext::getId();
            $userRow = DB::selectOne(
                'SELECT id, email, first_name, email_verified_at, tenant_id, preferred_language FROM users WHERE email = ? AND tenant_id = ?',
                [$this->email, $tenantId]
            );
            $user = $userRow ? (array) $userRow : null;

            // Only send when the account exists AND is not yet verified — the
            // same condition the controller applied inline. Everything before
            // this point is identical for every address, so nothing here reaches
            // the request's response time.
            if ($user && empty($user['email_verified_at'])) {
                $sender->send($user);
            }
        } finally {
            TenantContext::reset();
        }
    }
}
