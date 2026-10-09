<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Listeners;

use App\Listeners\SendWelcomeNotification;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use ReflectionMethod;
use Tests\Laravel\TestCase;

/**
 * Regression test: storing a registration's verification token must not end
 * the caller's transaction.
 *
 * SendWelcomeNotification ran `CREATE TABLE IF NOT EXISTS email_verification_tokens`
 * on every UserRegistered event. MariaDB commits any open transaction before
 * DDL, even when IF NOT EXISTS finds the table already there. In production
 * that split the transaction around a registration; in tests it ended
 * DatabaseTransactions' wrapper, so RegistrationVerificationEnforcementTest's
 * tenant 2 registration policy became permanent in nexus_test and made
 * RegistrationActivationLoginTest see 'pending' instead of 'active'.
 */
class SendWelcomeNotificationTransactionTest extends TestCase
{
    use DatabaseTransactions;

    public function test_verification_token_table_check_keeps_the_transaction_open(): void
    {
        $this->assertSame(1, $this->inTransaction(), 'precondition: the test transaction is open');

        $method = new ReflectionMethod(SendWelcomeNotification::class, 'ensureVerificationTokenTableExists');
        $method->setAccessible(true);
        $method->invoke(new SendWelcomeNotification());

        $this->assertSame(
            1,
            $this->inTransaction(),
            'ensureVerificationTokenTableExists() must not commit the open transaction'
        );
    }

    private function inTransaction(): int
    {
        return (int) DB::selectOne('SELECT @@in_transaction AS t')->t;
    }
}
