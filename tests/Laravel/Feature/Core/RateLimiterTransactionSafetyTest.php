<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Core;

use App\Core\RateLimiter;
use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The login rate limiter must never commit the caller's open transaction.
 *
 * RateLimiter used to run `CREATE TABLE IF NOT EXISTS login_attempts` on the
 * first login check of every PHP process. MariaDB implicitly COMMITs the open
 * transaction before any DDL — even when the table already exists — so the
 * first test per PHPUnit process that signed in had its whole fixture written
 * permanently to nexus_test. F240IdentityVerificationMinimumAgeTest left a
 * `verified_identity` registration policy on tenant 2 that way, after which
 * AuthControllerTest's unapproved-member login was refused as
 * AUTH_PENDING_VERIFICATION instead of AUTH_ACCOUNT_PENDING_APPROVAL. In
 * production the same statement would split any enclosing DB transaction.
 */
class RateLimiterTransactionSafetyTest extends TestCase
{
    use DatabaseTransactions;

    private const PROBE = 'rate_limiter_txn_probe';

    protected function tearDown(): void
    {
        DB::purge(self::PROBE);
        parent::tearDown();
    }

    public function test_login_checks_do_not_commit_the_open_transaction(): void
    {
        // A fresh process: the one-time table check has not run yet.
        if (property_exists(RateLimiter::class, 'tableChecked')) {
            $flag = new \ReflectionProperty(RateLimiter::class, 'tableChecked');
            $flag->setValue(null, false);
        }

        TenantContext::setById($this->testTenantId);
        $marker = 'txn-probe-' . bin2hex(random_bytes(6));
        DB::table('login_attempts')->insert([
            'identifier' => $marker,
            'type' => 'ip',
            'ip_address' => '192.0.2.10',
            'success' => 0,
            'attempted_at' => now(),
        ]);

        // The calls AuthController::login makes, in the same order.
        RateLimiter::check('rate-limit-txn@example.test', 'email');
        RateLimiter::check('192.0.2.10', 'ip');
        RateLimiter::recordAttempt('rate-limit-txn@example.test', 'email', false);
        RateLimiter::recordAttempt('192.0.2.10', 'ip', false);

        $this->assertTrue(
            DB::connection()->getPdo()->inTransaction(),
            'the rate limiter ended the caller\'s transaction'
        );

        // A second connection must not see the uncommitted marker row.
        $default = config('database.default');
        config(['database.connections.' . self::PROBE => config("database.connections.{$default}")]);
        $visibleElsewhere = DB::connection(self::PROBE)
            ->table('login_attempts')
            ->where('identifier', $marker)
            ->exists();

        $this->assertFalse($visibleElsewhere, 'the rate limiter committed the caller\'s uncommitted writes');
    }
}
