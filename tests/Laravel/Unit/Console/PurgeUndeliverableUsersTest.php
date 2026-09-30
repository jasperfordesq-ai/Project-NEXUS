<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Console;

use App\Core\TenantContext;
use App\Services\DisposableEmailService;
use App\Services\MxRecordValidator;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * Tests for users:purge-undeliverable (PurgeUndeliverableUsers).
 *
 * Uses unique tenant id 99705 to avoid cross-test contamination.
 * Uses DatabaseTransactions to roll back all inserts after each test.
 *
 * The command is injected with DisposableEmailService and MxRecordValidator.
 * We bind mocks through the container so the command's constructor DI
 * picks them up via $this->app->instance().
 *
 * Safety constraints under test:
 *   - Only unverified (email_verified_at IS NULL) users are candidates.
 *   - Verified users are never touched, even if their domain looks bad.
 *   - role in (god, super_admin) and is_super_admin=1 are excluded.
 *   - --soft sets deleted_at + anonymized_at; --hard issues a real DELETE.
 *   - Default mode (no --soft/--hard) is dry-run → no DB changes.
 *   - --since limits the cohort by created_at.
 *
 * Exit codes:
 *   0 (SUCCESS) = no failures (includes dry-run, no candidates, all acted on)
 *   1 (FAILURE) = --soft and --hard both specified (mutually exclusive)
 */
class PurgeUndeliverableUsersTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 99705;

    /** @var \Mockery\MockInterface&DisposableEmailService */
    private DisposableEmailService $disposable;

    /** @var \Mockery\MockInterface&MxRecordValidator */
    private MxRecordValidator $mx;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        DB::table('tenants')->updateOrInsert(
            ['id' => self::TENANT_ID],
            [
                'name'             => 'Purge Test Tenant 99705',
                'slug'             => 'purge-test-99705',
                'domain'           => null,
                'is_active'        => true,
                'depth'            => 0,
                'allows_subtenants'=> false,
                'created_at'       => now(),
                'updated_at'       => now(),
            ]
        );

        TenantContext::setById(self::TENANT_ID);

        // Default mocks: not disposable + resolvable (passes checks → not purged).
        $this->disposable = \Mockery::mock(DisposableEmailService::class);
        $this->disposable->shouldReceive('isDisposable')->andReturn(false)->byDefault();

        $this->mx = \Mockery::mock(MxRecordValidator::class);
        $this->mx->shouldReceive('isResolvable')->andReturn(true)->byDefault();
        // F-375: the command now asks for the three-way state so it can tell
        // "DNS says no" from "DNS did not answer".
        $this->mx->shouldReceive('resolveState')
            ->andReturn(MxRecordValidator::STATE_RESOLVABLE)
            ->byDefault();

        // Bind via container so the command's constructor receives the mocks.
        $this->app->instance(DisposableEmailService::class, $this->disposable);
        $this->app->instance(MxRecordValidator::class, $this->mx);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Seed an unverified user for this tenant.
     *
     * @param array<string, mixed> $overrides
     */
    private function seedUnverifiedUser(array $overrides = []): int
    {
        $defaults = [
            'name'              => 'Purge Test User',
            'email'             => 'purge-' . uniqid() . '@real-domain.com',
            'tenant_id'         => self::TENANT_ID,
            'role'              => 'member',
            'is_super_admin'    => 0,
            'email_verified_at' => null,        // unverified
            'deleted_at'        => null,        // not already deleted
            'created_at'        => now()->subDays(5)->toDateTimeString(),
            'status'            => 'active',
        ];

        return DB::table('users')->insertGetId(array_merge($defaults, $overrides));
    }

    /** Seed a verified user (email_verified_at IS NOT NULL). */
    private function seedVerifiedUser(array $overrides = []): int
    {
        return $this->seedUnverifiedUser(array_merge([
            'email_verified_at' => now()->subDays(3)->toDateTimeString(),
        ], $overrides));
    }

    // -------------------------------------------------------------------------
    // Dry-run (default) — no DB mutations regardless of deliverability
    // -------------------------------------------------------------------------

    public function test_default_mode_is_dry_run_no_db_changes(): void
    {
        // Email with reserved domain — would be flagged but NOT acted on in dry-run.
        $id = $this->seedUnverifiedUser(['email' => 'test@example.com']);

        $this->artisan('users:purge-undeliverable', ['--tenant' => self::TENANT_ID])
            ->assertExitCode(0);

        // Row must still exist.
        $this->assertNotNull(
            DB::table('users')->where('id', $id)->whereNull('deleted_at')->first(),
            'Dry-run must not modify any user rows'
        );
    }

    // -------------------------------------------------------------------------
    // No candidates: empty cohort
    // -------------------------------------------------------------------------

    public function test_succeeds_with_no_unverified_users_in_scope(): void
    {
        // Only a verified user exists.
        $this->seedVerifiedUser();

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--hard'   => true,
        ])->assertExitCode(0);
    }

    // -------------------------------------------------------------------------
    // Reserved domain detection (example.com / example.net / etc.)
    // These are caught before the disposable/MX checks.
    // -------------------------------------------------------------------------

    public function test_hard_deletes_user_with_reserved_domain_email(): void
    {
        $id = $this->seedUnverifiedUser(['email' => 'user@example.com']);

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--hard'   => true,
        ])->assertExitCode(0);

        $this->assertNull(
            DB::table('users')->where('id', $id)->first(),
            'User with reserved domain email must be hard-deleted'
        );
    }

    public function test_hard_deletes_user_with_reserved_tld_email(): void
    {
        $id = $this->seedUnverifiedUser(['email' => 'user@somehost.test']);

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--hard'   => true,
        ])->assertExitCode(0);

        $this->assertNull(
            DB::table('users')->where('id', $id)->first(),
            'User with .test TLD email must be hard-deleted'
        );
    }

    public function test_hard_deletes_user_with_invalid_tld_email(): void
    {
        $id = $this->seedUnverifiedUser(['email' => 'attack@spam.invalid']);

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--hard'   => true,
        ])->assertExitCode(0);

        $this->assertNull(
            DB::table('users')->where('id', $id)->first(),
            'User with .invalid TLD email must be hard-deleted'
        );
    }

    // -------------------------------------------------------------------------
    // Disposable provider detection
    // -------------------------------------------------------------------------

    public function test_hard_deletes_user_with_disposable_email(): void
    {
        $this->disposable->shouldReceive('isDisposable')
            ->with(\Mockery::pattern('/mailinator/'))
            ->andReturn(true);

        $id = $this->seedUnverifiedUser(['email' => 'trash@mailinator.com']);

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--hard'   => true,
        ])->assertExitCode(0);

        $this->assertNull(
            DB::table('users')->where('id', $id)->first(),
            'User with disposable email must be hard-deleted'
        );
    }

    // -------------------------------------------------------------------------
    // MX/A check failure
    // -------------------------------------------------------------------------

    public function test_hard_deletes_user_when_mx_check_fails(): void
    {
        $email = 'user@no-mx-domain.com';

        $this->mx->shouldReceive('resolveState')
            ->with($email)
            ->andReturn(MxRecordValidator::STATE_UNDELIVERABLE);

        $id = $this->seedUnverifiedUser(['email' => $email]);

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--hard'   => true,
        ])->assertExitCode(0);

        $this->assertNull(
            DB::table('users')->where('id', $id)->first(),
            'User whose email domain has no MX/A record must be hard-deleted'
        );
    }

    // -------------------------------------------------------------------------
    // Soft-delete mode: sets deleted_at and anonymized_at, does NOT hard-delete
    // -------------------------------------------------------------------------

    public function test_soft_delete_sets_deleted_at_not_removes_row(): void
    {
        $id = $this->seedUnverifiedUser(['email' => 'user@example.com']);

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--soft'   => true,
        ])->assertExitCode(0);

        $row = DB::table('users')->where('id', $id)->first();

        $this->assertNotNull($row, 'Soft-deleted row must still exist in the table');
        $this->assertNotNull($row->deleted_at, 'deleted_at must be set after soft-delete');
        $this->assertNotNull($row->anonymized_at, 'anonymized_at must be set after soft-delete');
    }

    // -------------------------------------------------------------------------
    // Safety: verified users are never touched
    // -------------------------------------------------------------------------

    public function test_verified_users_are_never_purged(): void
    {
        // Verified user with a reserved domain — must be untouched.
        $id = $this->seedVerifiedUser(['email' => 'verified@example.com']);

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--hard'   => true,
        ])->assertExitCode(0);

        $this->assertNotNull(
            DB::table('users')->where('id', $id)->first(),
            'Verified users must NEVER be purged regardless of email domain'
        );
    }

    // -------------------------------------------------------------------------
    // Safety: god / super_admin roles are excluded
    // -------------------------------------------------------------------------

    public function test_god_role_users_are_excluded(): void
    {
        $id = $this->seedUnverifiedUser([
            'email' => 'god@example.com',
            'role'  => 'god',
        ]);

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--hard'   => true,
        ])->assertExitCode(0);

        $this->assertNotNull(
            DB::table('users')->where('id', $id)->first(),
            'god-role user must never be purged'
        );
    }

    public function test_super_admin_role_users_are_excluded(): void
    {
        $id = $this->seedUnverifiedUser([
            'email' => 'admin@example.com',
            'role'  => 'super_admin',
        ]);

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--hard'   => true,
        ])->assertExitCode(0);

        $this->assertNotNull(
            DB::table('users')->where('id', $id)->first(),
            'super_admin role user must never be purged'
        );
    }

    public function test_is_super_admin_flag_users_are_excluded(): void
    {
        $id = $this->seedUnverifiedUser([
            'email'          => 'superadmin@example.com',
            'role'           => 'member',
            'is_super_admin' => 1,
        ]);

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--hard'   => true,
        ])->assertExitCode(0);

        $this->assertNotNull(
            DB::table('users')->where('id', $id)->first(),
            'is_super_admin=1 user must never be purged'
        );
    }

    // -------------------------------------------------------------------------
    // Deliverable email: must be kept
    // -------------------------------------------------------------------------

    public function test_keeps_unverified_user_with_deliverable_email(): void
    {
        // Mocks already configured to return not-disposable + resolvable by default.
        $id = $this->seedUnverifiedUser(['email' => 'legit@real-domain.com']);

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--hard'   => true,
        ])->assertExitCode(0);

        $this->assertNotNull(
            DB::table('users')->where('id', $id)->first(),
            'Unverified user with deliverable email must be kept'
        );
    }

    // -------------------------------------------------------------------------
    // --soft and --hard are mutually exclusive → FAILURE exit
    // -------------------------------------------------------------------------

    public function test_fails_when_both_soft_and_hard_flags_given(): void
    {
        $this->artisan('users:purge-undeliverable', [
            '--soft' => true,
            '--hard' => true,
        ])->assertExitCode(1);
    }

    // -------------------------------------------------------------------------
    // --since option: users created before the cutoff are not in scope
    // -------------------------------------------------------------------------

    public function test_since_option_excludes_old_users_from_cohort(): void
    {
        // User created 200 days ago — before the --since=90days window.
        $id = $this->seedUnverifiedUser([
            'email'      => 'old@example.com',
            'created_at' => now()->subDays(200)->toDateTimeString(),
        ]);

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--hard'   => true,
            '--since'  => '90days',
        ])->assertExitCode(0);

        $this->assertNotNull(
            DB::table('users')->where('id', $id)->first(),
            'User created before --since cutoff must not be touched'
        );
    }

    public function test_since_option_includes_users_within_window(): void
    {
        // User created 30 days ago — within the 90-day window.
        $id = $this->seedUnverifiedUser([
            'email'      => 'recent@example.com',
            'created_at' => now()->subDays(30)->toDateTimeString(),
        ]);

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--hard'   => true,
            '--since'  => '90days',
        ])->assertExitCode(0);

        $this->assertNull(
            DB::table('users')->where('id', $id)->first(),
            'User within --since window with undeliverable email must be hard-deleted'
        );
    }

    // -------------------------------------------------------------------------
    // Tenant isolation: only target the specified tenant
    // -------------------------------------------------------------------------

    public function test_does_not_purge_users_from_other_tenants(): void
    {
        $otherTenantId = 2; // hour-timebank always exists in test env

        // Unverified user on OTHER tenant with reserved domain.
        $otherId = DB::table('users')->insertGetId([
            'name'              => 'Other Tenant User',
            'email'             => 'other@example.com',
            'tenant_id'         => $otherTenantId,
            'role'              => 'member',
            'is_super_admin'    => 0,
            'email_verified_at' => null,
            'deleted_at'        => null,
            'created_at'        => now()->subDays(5)->toDateTimeString(),
            'status'            => 'active',
        ]);

        $this->artisan('users:purge-undeliverable', [
            '--tenant' => self::TENANT_ID,
            '--hard'   => true,
        ])->assertExitCode(0);

        $this->assertNotNull(
            DB::table('users')->where('id', $otherId)->first(),
            'Users from other tenants must not be touched'
        );
    }
}
