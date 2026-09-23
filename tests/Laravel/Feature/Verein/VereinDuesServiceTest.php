<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Verein;

use App\Core\TenantContext;
use App\Services\EmailDispatchService;
use App\Services\Verein\VereinDuesService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * AG54 — Tests for the four core Verein dues service flows:
 *   - generateAnnualDues (creates one row per active member; idempotent)
 *   - markOverdueDues (past-due-date pending → overdue)
 *   - waive (admin waive sets status, records reason, blocks paid)
 *   - markPaid (writes ledger + flips status to paid + idempotent)
 *
 * The webhook recipient-locale check is covered indirectly through the
 * sendDuesPaidEmail call in markPaid — LocaleContext::withLocale is
 * exercised via the EmailService mock-friendly flow.
 */
class VereinDuesServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    private VereinDuesService $service;
    private int $organizationId;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);
        $this->service = app(VereinDuesService::class);

        // Ensure the caring_community feature is on so the service guard passes.
        $tenant = DB::table('tenants')->where('id', self::TENANT_ID)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', self::TENANT_ID)->update(['features' => json_encode($features)]);

        $this->organizationId = $this->makeOrganization('Test Verein');
    }

    private function makeUser(): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'first_name' => 'Test',
            'last_name' => 'Member',
            'email' => 'm.' . uniqid('', true) . '@example.com',
            'username' => 'm_' . substr(md5((string) microtime(true)), 0, 8),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'preferred_language' => 'de',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function joinOrg(int $userId, ?int $organizationId = null): void
    {
        DB::table('org_members')->insert([
            'tenant_id' => self::TENANT_ID,
            'organization_id' => $organizationId ?? $this->organizationId,
            'org_type' => 'volunteer',
            'user_id' => $userId,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function configureFee(int $cents = 5000, ?int $organizationId = null): void
    {
        $this->service->setFeeConfig($organizationId ?? $this->organizationId, [
            'fee_amount_cents' => $cents,
            'currency' => 'CHF',
            'billing_cycle' => 'annual',
            'grace_period_days' => 30,
            'is_active' => true,
        ]);
    }

    public function test_generate_annual_dues_creates_one_row_per_member_and_is_idempotent(): void
    {
        $u1 = $this->makeUser(); $this->joinOrg($u1);
        $u2 = $this->makeUser(); $this->joinOrg($u2);
        $this->configureFee(7500);

        $year = (int) date('Y');
        $first = $this->service->generateAnnualDues($this->organizationId, $year);
        $this->assertSame(2, $first['generated']);
        $this->assertSame(0, $first['skipped']);

        // Idempotent — running twice yields zero new rows
        $second = $this->service->generateAnnualDues($this->organizationId, $year);
        $this->assertSame(0, $second['generated']);
        $this->assertSame(2, $second['skipped']);

        $rowCount = DB::table('verein_member_dues')
            ->where('organization_id', $this->organizationId)
            ->where('membership_year', $year)
            ->count();
        $this->assertSame(2, $rowCount);
    }

    public function test_mark_overdue_flips_pending_past_grace_to_overdue(): void
    {
        $u1 = $this->makeUser(); $this->joinOrg($u1);
        $this->configureFee();

        $year = (int) date('Y');
        $this->service->generateAnnualDues($this->organizationId, $year);

        // Force the dues row to look long-overdue
        DB::table('verein_member_dues')
            ->where('organization_id', $this->organizationId)
            ->update(['due_date' => now()->subDays(120)->toDateString()]);

        $count = $this->service->markOverdueDues();
        $this->assertGreaterThanOrEqual(1, $count);

        $row = DB::table('verein_member_dues')
            ->where('organization_id', $this->organizationId)
            ->first();
        $this->assertSame('overdue', $row->status);
    }

    public function test_waive_sets_status_and_records_reason(): void
    {
        $u1 = $this->makeUser(); $this->joinOrg($u1);
        $this->configureFee();
        $year = (int) date('Y');
        $this->service->generateAnnualDues($this->organizationId, $year);

        $duesId = (int) DB::table('verein_member_dues')
            ->where('organization_id', $this->organizationId)
            ->value('id');

        $admin = $this->makeUser();
        $result = $this->service->waive($this->organizationId, $duesId, $admin, 'Hardship case');
        $this->assertSame('waived', $result['status']);

        $row = DB::table('verein_member_dues')->where('id', $duesId)->first();
        $this->assertSame('waived', $row->status);
        $this->assertSame('Hardship case', $row->waived_reason);
        $this->assertSame($admin, (int) $row->waived_by_admin_id);
    }

    public function test_waive_throws_for_paid_dues(): void
    {
        $u1 = $this->makeUser(); $this->joinOrg($u1);
        $this->configureFee();
        $year = (int) date('Y');
        $this->service->generateAnnualDues($this->organizationId, $year);

        $duesId = (int) DB::table('verein_member_dues')->where('organization_id', $this->organizationId)->value('id');
        DB::table('verein_member_dues')->where('id', $duesId)->update(['status' => 'paid']);

        $this->expectException(\InvalidArgumentException::class);
        $this->service->waive($this->organizationId, $duesId, $this->makeUser(), 'Should fail');
    }

    public function test_send_reminder_does_not_mark_sent_when_email_fails(): void
    {
        $u1 = $this->makeUser();
        $this->joinOrg($u1);
        $this->configureFee();
        $year = (int) date('Y');
        $this->service->generateAnnualDues($this->organizationId, $year);

        $duesId = (int) DB::table('verein_member_dues')
            ->where('organization_id', $this->organizationId)
            ->value('id');
        DB::table('verein_member_dues')
            ->where('id', $duesId)
            ->update(['status' => 'overdue', 'reminder_count' => 0, 'last_reminder_at' => null]);

        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return false;
            }
        });

        $result = $this->service->sendReminder($this->organizationId, $duesId);

        $this->assertFalse($result['sent']);
        $row = DB::table('verein_member_dues')->where('id', $duesId)->first();
        $this->assertSame(0, (int) $row->reminder_count);
        $this->assertNull($row->last_reminder_at);
    }

    public function test_due_reminder_cron_uses_scoped_tenant_context_and_successful_send_marker(): void
    {
        $source = file_get_contents(app_path('Services/Verein/VereinDuesService.php'));

        $this->assertStringContainsString('TenantContext::runForTenant((int) $row->tenant_id', $source);
        $this->assertStringContainsString('if (!$emailSent)', $source);
        $this->assertStringContainsString('return $this->sendEmail(', $source);
    }

    public function test_mark_paid_writes_ledger_and_flips_status_idempotently(): void
    {
        $u1 = $this->makeUser(); $this->joinOrg($u1);
        $this->configureFee(6000);
        $year = (int) date('Y');
        $this->service->generateAnnualDues($this->organizationId, $year);
        $duesId = (int) DB::table('verein_member_dues')->where('organization_id', $this->organizationId)->value('id');

        $piId = 'pi_test_' . uniqid('', true);
        $first = $this->service->markPaid($duesId, $piId, 'card', 'https://stripe.com/receipt/abc');

        $this->assertFalse($first['idempotent']);

        $row = DB::table('verein_member_dues')->where('id', $duesId)->first();
        $this->assertSame('paid', $row->status);
        $this->assertNotNull($row->paid_at);
        $this->assertSame($piId, $row->stripe_payment_intent_id);

        $payment = DB::table('verein_dues_payments')->where('stripe_payment_intent_id', $piId)->first();
        $this->assertNotNull($payment);
        $this->assertSame(6000, (int) $payment->amount_cents);

        // Replaying the same PI is a no-op
        $second = $this->service->markPaid($duesId, $piId, 'card', null);
        $this->assertTrue($second['idempotent']);

        $payCount = DB::table('verein_dues_payments')->where('stripe_payment_intent_id', $piId)->count();
        $this->assertSame(1, $payCount);
    }

    public function test_mark_paid_records_failed_email_and_idempotent_replay_repairs_it(): void
    {
        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return false;
            }
        });

        $user = $this->makeUser();
        $this->joinOrg($user);
        $this->configureFee(6000);
        $year = (int) date('Y');
        $this->service->generateAnnualDues($this->organizationId, $year);
        $duesId = (int) DB::table('verein_member_dues')->where('organization_id', $this->organizationId)->value('id');

        $piId = 'pi_repair_' . uniqid('', true);
        $first = $this->service->markPaid($duesId, $piId, 'card', null);

        $this->assertFalse($first['idempotent']);
        $failed = DB::table('verein_member_dues')->where('id', $duesId)->first();
        $this->assertSame('paid', $failed->status);
        $this->assertNull($failed->paid_email_sent_at);
        $this->assertNotNull($failed->paid_email_failed_at);

        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return true;
            }
        });

        $second = $this->service->markPaid($duesId, $piId, 'card', null);

        $this->assertTrue($second['idempotent']);
        $repaired = DB::table('verein_member_dues')->where('id', $duesId)->first();
        $this->assertNotNull($repaired->paid_email_sent_at);
        $this->assertNull($repaired->paid_email_failed_at);
        $this->assertSame(1, DB::table('verein_dues_payments')->where('stripe_payment_intent_id', $piId)->count());
    }

    public function test_reminder_failure_is_persisted_for_admin_visibility(): void
    {
        app()->instance(EmailDispatchService::class, new class(true) extends EmailDispatchService {
            public function __construct(private bool $result)
            {
            }

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return $this->result;
            }
        });

        $user = $this->makeUser();
        $this->joinOrg($user);
        $this->configureFee(6000);
        $year = (int) date('Y');
        $this->service->generateAnnualDues($this->organizationId, $year);
        $duesId = (int) DB::table('verein_member_dues')->where('organization_id', $this->organizationId)->value('id');

        app()->instance(EmailDispatchService::class, new class(false) extends EmailDispatchService {
            public function __construct(private bool $result)
            {
            }

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return $this->result;
            }
        });

        $result = $this->service->sendReminder($this->organizationId, $duesId);

        $this->assertFalse($result['sent']);
        $failed = DB::table('verein_member_dues')->where('id', $duesId)->first();
        $this->assertSame(0, (int) $failed->reminder_count);
        $this->assertNull($failed->last_reminder_at);
        $this->assertNotNull($failed->reminder_email_failed_at);
        $this->assertSame('Verein dues reminder email returned false', $failed->reminder_email_last_error);
    }

    public function test_webhook_paid_email_failure_is_not_treated_as_processed(): void
    {
        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return false;
            }
        });

        $user = $this->makeUser();
        $this->joinOrg($user);
        $this->configureFee(6000);
        $year = (int) date('Y');
        $this->service->generateAnnualDues($this->organizationId, $year);
        $duesId = (int) DB::table('verein_member_dues')->where('organization_id', $this->organizationId)->value('id');
        $piId = 'pi_webhook_failure_' . uniqid('', true);

        try {
            VereinDuesService::handleWebhookEvent('payment_intent.succeeded', (object) [
                'id' => $piId,
                'metadata' => (object) [
                    'nexus_type' => 'verein_dues',
                    'nexus_dues_id' => (string) $duesId,
                ],
                'payment_method_types' => ['card'],
            ]);
            $this->fail('Expected failed Verein paid email to fail webhook processing for retry.');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('Verein dues paid email failed', $e->getMessage());
        }

        $failed = DB::table('verein_member_dues')->where('id', $duesId)->first();
        $this->assertSame('paid', $failed->status);
        $this->assertNull($failed->paid_email_sent_at);
        $this->assertNotNull($failed->paid_email_failed_at);
        $this->assertSame(1, DB::table('verein_dues_payments')->where('stripe_payment_intent_id', $piId)->count());
    }

    public function test_get_membership_status_returns_year_history(): void
    {
        $user = $this->makeUser(); $this->joinOrg($user);
        $this->configureFee();
        $year = (int) date('Y');
        $this->service->generateAnnualDues($this->organizationId, $year);

        $status = $this->service->getMembershipStatus($user, $this->organizationId);
        $this->assertArrayHasKey((string) $year, $status);
        $this->assertSame('pending', $status[(string) $year]['status']);
    }

    public function test_waive_rejects_dues_from_another_organization_without_mutation(): void
    {
        $member = $this->makeUser();
        $foreignOrganizationId = $this->makeOrganization('Foreign Verein');
        $this->joinOrg($member, $foreignOrganizationId);
        $this->configureFee(5000, $foreignOrganizationId);
        $year = (int) date('Y');
        $this->service->generateAnnualDues($foreignOrganizationId, $year);

        $foreignDuesId = (int) DB::table('verein_member_dues')
            ->where('organization_id', $foreignOrganizationId)
            ->value('id');

        try {
            $this->service->waive(
                $this->organizationId,
                $foreignDuesId,
                $this->makeUser(),
                'Must not cross the club boundary'
            );
            $this->fail('Expected foreign-organization dues to be rejected.');
        } catch (\RuntimeException $e) {
            $this->assertSame(__('verein_dues.errors.dues_not_found'), $e->getMessage());
        }

        $foreignDues = DB::table('verein_member_dues')->where('id', $foreignDuesId)->first();
        $this->assertSame('pending', $foreignDues->status);
        $this->assertNull($foreignDues->waived_by_admin_id);
        $this->assertNull($foreignDues->waived_reason);
    }

    public function test_reminder_rejects_dues_from_another_organization_without_delivery(): void
    {
        $member = $this->makeUser();
        $foreignOrganizationId = $this->makeOrganization('Foreign Reminder Verein');
        $this->joinOrg($member, $foreignOrganizationId);
        $this->configureFee(5000, $foreignOrganizationId);
        $year = (int) date('Y');
        $this->service->generateAnnualDues($foreignOrganizationId, $year);

        $foreignDuesId = (int) DB::table('verein_member_dues')
            ->where('organization_id', $foreignOrganizationId)
            ->value('id');

        $delivery = new class extends EmailDispatchService {
            public int $attempts = 0;

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->attempts++;
                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $delivery);

        try {
            $this->service->sendReminder($this->organizationId, $foreignDuesId);
            $this->fail('Expected foreign-organization dues to be rejected.');
        } catch (\RuntimeException $e) {
            $this->assertSame(__('verein_dues.errors.dues_not_found'), $e->getMessage());
        }

        $this->assertSame(0, $delivery->attempts);
        $foreignDues = DB::table('verein_member_dues')->where('id', $foreignDuesId)->first();
        $this->assertSame(0, (int) $foreignDues->reminder_count);
        $this->assertNull($foreignDues->last_reminder_at);
    }

    private function makeOrganization(string $name): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'name' => $name . ' ' . uniqid('', true),
            'org_type' => 'club',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

}
