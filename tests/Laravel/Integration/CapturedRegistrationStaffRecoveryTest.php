<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\RegistrationStaffEmailDeliveryLedger as Ledger;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class CapturedRegistrationStaffRecoveryTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    protected function tearDown(): void
    {
        Cache::flush();
        parent::tearDown();
    }

    public function test_recovery_sends_a_captured_row_once_despite_a_stale_done_key(): void
    {
        [$tenant, $registrant, $recipient, $delivery] = $this->fixture();
        Cache::put('notify_admin_new_registration:done:' . $tenant . ':' . $registrant, 1, now()->addDay());
        $sender = new RecoveryCaptureDispatchService();
        app()->instance(EmailDispatchService::class, $sender);

        $this->artisan('emails:recover-captured-registration-staff', ['--tenant' => $tenant, '--limit' => 20])
            ->assertExitCode(0);
        $this->assertSame('accepted', DB::table('registration_staff_email_deliveries')->where('id', $delivery)->value('status'));
        $this->assertSame(1, $sender->adminCalls);
        $this->artisan('emails:recover-captured-registration-staff', ['--tenant' => $tenant, '--limit' => 20])
            ->assertExitCode(0);
        $this->assertSame(1, $sender->adminCalls);
    }

    public function test_recovery_cancels_never_attempted_rows_for_revoked_staff_or_unavailable_registrant(): void
    {
        [$tenant, $registrant, $recipient, $delivery] = $this->fixture();
        $sender = new RecoveryCaptureDispatchService();
        app()->instance(EmailDispatchService::class, $sender);
        DB::table('users')->where('id', $recipient)->where('tenant_id', $tenant)->update(['status' => 'suspended']);

        $this->artisan('emails:recover-captured-registration-staff', ['--tenant' => $tenant, '--limit' => 20])
            ->assertExitCode(0);
        $this->assertSame('cancelled', DB::table('registration_staff_email_deliveries')->where('id', $delivery)->value('status'));
        $this->assertSame(0, $sender->adminCalls);

        [$otherTenant, $otherRegistrant, , $otherDelivery] = $this->fixture();
        DB::table('users')->where('id', $otherRegistrant)->where('tenant_id', $otherTenant)->update(['status' => 'rejected']);
        $this->artisan('emails:recover-captured-registration-staff', ['--tenant' => $otherTenant, '--limit' => 20])
            ->assertExitCode(0);
        $this->assertSame('cancelled', DB::table('registration_staff_email_deliveries')->where('id', $otherDelivery)->value('status'));
        $this->assertSame(0, $sender->adminCalls);
    }

    public function test_dry_run_does_not_claim_or_send(): void
    {
        [$tenant, , , $delivery] = $this->fixture();
        $sender = new RecoveryCaptureDispatchService();
        app()->instance(EmailDispatchService::class, $sender);

        $this->artisan('emails:recover-captured-registration-staff', [
            '--tenant' => $tenant, '--limit' => 20, '--dry-run' => true,
        ])->expectsOutputToContain('eligible for recovery: 1')->assertExitCode(0);
        $this->assertSame('captured', DB::table('registration_staff_email_deliveries')->where('id', $delivery)->value('status'));
        $this->assertSame(0, $sender->adminCalls);
    }

    public function test_recovery_command_is_scheduled(): void
    {
        $this->artisan('schedule:list')
            ->expectsOutputToContain('emails:recover-captured-registration-staff')
            ->assertExitCode(0);
    }

    public function test_recovery_does_not_send_fresh_or_over_seven_day_intents(): void
    {
        [$tenant, , , $delivery] = $this->fixture();
        $sender = new RecoveryCaptureDispatchService();
        app()->instance(EmailDispatchService::class, $sender);

        DB::table('registration_staff_email_deliveries')->where('id', $delivery)
            ->update(['created_at' => now()->subMinute()]);
        $this->artisan('emails:recover-captured-registration-staff', ['--tenant' => $tenant])
            ->assertExitCode(0);
        DB::table('registration_staff_email_deliveries')->where('id', $delivery)
            ->update(['created_at' => now()->subDays(8)]);
        $this->artisan('emails:recover-captured-registration-staff', ['--tenant' => $tenant])
            ->assertExitCode(0);

        $this->assertSame('captured', DB::table('registration_staff_email_deliveries')->where('id', $delivery)->value('status'));
        $this->assertSame(0, $sender->adminCalls);
    }

    /** @return array{int,int,int,int} */
    private function fixture(): array
    {
        $tenant = (int) DB::table('tenants')->insertGetId([
            'name' => 'Synthetic staff recovery tenant',
            'slug' => 'staff-recovery-' . uniqid(),
            'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        TenantContext::setById($tenant);
        $recipient = User::factory()->forTenant($tenant)->create([
            'role' => 'admin', 'status' => 'active',
            'email' => 'recovery-admin-' . uniqid() . '@project-nexus.testmail',
            'preferred_language' => 'en',
        ]);
        $registrant = User::factory()->forTenant($tenant)->create([
            'role' => 'member', 'status' => 'pending',
            'email' => 'recovery-member-' . uniqid() . '@project-nexus.testmail',
        ]);
        $delivery = DB::transaction(static fn (): int => Ledger::captureInTransaction(
            $tenant, (int) $registrant->id, (int) $recipient->id,
        ));
        DB::table('registration_staff_email_deliveries')->where('id', $delivery)
            ->update(['created_at' => now()->subMinutes(3)]);
        return [$tenant, (int) $registrant->id, (int) $recipient->id, $delivery];
    }
}

final class RecoveryCaptureDispatchService extends EmailDispatchService
{
    public int $adminCalls = 0;

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        if (($options['category'] ?? null) === 'admin_new_registration') {
            $this->adminCalls++;
        }
        return true;
    }
}
