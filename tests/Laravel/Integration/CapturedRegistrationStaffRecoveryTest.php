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

    public function test_recovery_reports_failure_when_a_recipient_send_does_not_succeed(): void
    {
        [$tenant, $registrant, $recipient, $delivery] = $this->fixture();
        $sender = new RecoveryCaptureDispatchService();
        $sender->result = false;
        app()->instance(EmailDispatchService::class, $sender);

        $this->artisan('emails:recover-captured-registration-staff', ['--tenant' => $tenant, '--limit' => 20])
            ->expectsOutputToContain('failed=1 unresolved_recipients=1')
            ->assertExitCode(1);
        $this->assertSame(1, $sender->adminCalls);
        $this->assertNotSame('accepted', DB::table('registration_staff_email_deliveries')->where('id', $delivery)->value('status'));
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

    public function test_abandoned_claim_is_held_unknown_without_a_second_send(): void
    {
        [$tenant, $registrant, $recipient, $delivery] = $this->fixture();
        $claim = Ledger::claimCapturedForInline($tenant, $registrant, $recipient);
        $this->assertNotNull($claim);
        DB::table('registration_staff_email_deliveries')->where('id', $delivery)
            ->update(['claimed_at' => now()->subMinutes(21)]);
        [$otherTenant, $otherRegistrant, $otherRecipient, $freshDelivery] = $this->fixture();
        $this->assertNotNull(Ledger::claimCapturedForInline($otherTenant, $otherRegistrant, $otherRecipient));
        $sender = new RecoveryCaptureDispatchService();
        app()->instance(EmailDispatchService::class, $sender);

        $this->artisan('emails:recover-captured-registration-staff', ['--tenant' => $tenant])
            ->assertExitCode(0);

        $held = DB::table('registration_staff_email_deliveries')->where('id', $delivery)->first();
        $this->assertSame('unknown', $held->status);
        $this->assertSame('CLAIM_EXPIRED_UNCONFIRMED', $held->last_error_code);
        $this->assertSame('claimed', DB::table('registration_staff_email_deliveries')->where('id', $freshDelivery)->value('status'));
        $this->assertSame(0, $sender->adminCalls);
    }

    public function test_one_exact_sent_receipt_reconciles_unknown_to_accepted_without_resend(): void
    {
        [$tenant, $registrant, $recipient, $delivery] = $this->fixture();
        $claim = Ledger::claimCapturedForInline($tenant, $registrant, $recipient);
        $this->assertNotNull($claim);
        $this->assertTrue(Ledger::resolveClaim($tenant, $delivery, $claim['token'], 'unknown', null, 'INLINE_SEND_UNCONFIRMED'));
        $logId = $this->mailLog($tenant, $registrant, $recipient, $claim['dispatch_id'], 'sent');
        $sender = new RecoveryCaptureDispatchService();
        app()->instance(EmailDispatchService::class, $sender);

        $this->artisan('emails:recover-captured-registration-staff', ['--tenant' => $tenant])
            ->assertExitCode(0);

        $row = DB::table('registration_staff_email_deliveries')->where('id', $delivery)->first();
        $this->assertSame('accepted', $row->status);
        $this->assertSame($logId, (int) $row->reconciled_from_email_log_id);
        $this->assertNotNull($row->reconciled_at);
        $this->assertSame(0, $sender->adminCalls);
    }

    public function test_failed_or_conflicting_mail_logs_leave_unknown_for_manual_review(): void
    {
        [$tenant, $registrant, $recipient, $delivery] = $this->fixture();
        $claim = Ledger::claimCapturedForInline($tenant, $registrant, $recipient);
        $this->assertTrue(Ledger::resolveClaim($tenant, $delivery, $claim['token'], 'unknown', null, 'INLINE_SEND_UNCONFIRMED'));
        $this->mailLog($tenant, $registrant, $recipient, $claim['dispatch_id'], 'failed');
        $this->artisan('emails:recover-captured-registration-staff', ['--tenant' => $tenant])
            ->assertExitCode(0);
        $this->assertSame('unknown', DB::table('registration_staff_email_deliveries')->where('id', $delivery)->value('status'));

        $this->mailLog($tenant, $registrant, $recipient, $claim['dispatch_id'], 'sent');
        $this->artisan('emails:recover-captured-registration-staff', ['--tenant' => $tenant])
            ->assertExitCode(0);
        $this->assertSame('unknown', DB::table('registration_staff_email_deliveries')->where('id', $delivery)->value('status'));
    }

    private function mailLog(int $tenant, int $registrant, int $recipient, string $dispatchId, string $status): int
    {
        return (int) DB::table('email_log')->insertGetId([
            'tenant_id' => $tenant,
            'recipient_email' => (string) DB::table('users')->where('id', $recipient)->value('email'),
            'category' => 'admin_new_registration',
            'source' => self::class,
            'idempotency_key' => "admin_new_registration:{$tenant}:{$registrant}:{$recipient}",
            'dispatch_id' => $dispatchId,
            'status' => $status,
            'provider' => 'postmark',
            'provider_message_id' => $status === 'sent' ? 'synthetic-provider-confirmation' : null,
            'created_at' => now(), 'updated_at' => now(),
        ]);
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
    public bool $result = true;

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        if (($options['category'] ?? null) === 'admin_new_registration') {
            $this->adminCalls++;
            return $this->result;
        }
        return true;
    }
}
