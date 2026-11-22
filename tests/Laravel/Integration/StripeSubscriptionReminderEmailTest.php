<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\StripeSubscriptionService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class StripeSubscriptionReminderEmailTest extends TestCase
{
    use DatabaseTransactions;

    public function test_renewal_reminder_does_not_count_or_cache_when_email_fails(): void
    {
        $tenantId = $this->createBillingTenant('renewal-fail');
        $periodEnd = now()->addDays(3)->setSecond(0);
        $this->createBillingAdmin($tenantId);
        $this->createPlanAssignment($tenantId, 'active', $periodEnd);

        $cacheKey = 'subscription_renewal_reminder:' . $tenantId . ':' . $periodEnd->format('Y-m-d');
        Cache::forget($cacheKey);

        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return false;
            }
        });

        $result = StripeSubscriptionService::sendRenewalReminders();

        $this->assertSame(['sent' => 0, 'errors' => 1], $result);
        $this->assertFalse(Cache::has($cacheKey));
    }

    public function test_renewal_reminder_counts_and_caches_only_after_email_success(): void
    {
        $tenantId = $this->createBillingTenant('renewal-success');
        $periodEnd = now()->addDays(4)->setSecond(0);
        $admin = $this->createBillingAdmin($tenantId);
        $this->createPlanAssignment($tenantId, 'active', $periodEnd);

        $cacheKey = 'subscription_renewal_reminder:' . $tenantId . ':' . $periodEnd->format('Y-m-d');
        Cache::forget($cacheKey);

        $mailer = new class extends EmailDispatchService {
            public array $calls = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body', 'options');

                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $mailer);

        $result = StripeSubscriptionService::sendRenewalReminders();

        $this->assertSame(['sent' => 1, 'errors' => 0], $result);
        $this->assertTrue(Cache::has($cacheKey));
        $this->assertCount(1, $mailer->calls);
        $this->assertSame($admin->email, $mailer->calls[0]['to']);
        $this->assertSame('billing', $mailer->calls[0]['options']['category']);
        $this->assertSame($tenantId, $mailer->calls[0]['options']['tenant_id']);
    }

    /**
     * The date in a reminder was written out before the reader's language was
     * switched to, so every admin read it in the language of whatever ran the
     * job (English, for the scheduler), inside a sentence in their own.
     */
    public function test_each_admin_reads_the_renewal_date_in_their_own_language(): void
    {
        $tenantId = $this->createBillingTenant('renewal-languages');
        $periodEnd = now()->addDays(4)->setSecond(0);
        $english = $this->createBillingAdmin($tenantId);
        $japanese = $this->createBillingAdmin($tenantId);
        DB::table('users')->where('id', $japanese->id)->update(['preferred_language' => 'ja']);
        $this->createPlanAssignment($tenantId, 'active', $periodEnd);
        Cache::forget('subscription_renewal_reminder:' . $tenantId . ':' . $periodEnd->format('Y-m-d'));

        $mailer = $this->fakeBillingMailer(true);
        app()->instance(EmailDispatchService::class, $mailer);

        $this->assertSame(['sent' => 1, 'errors' => 0], StripeSubscriptionService::sendRenewalReminders());

        $bodies = array_column($mailer->calls, 'body', 'to');
        $inEnglish = $this->dateAsReadIn('en', $periodEnd);
        $inJapanese = $this->dateAsReadIn('ja', $periodEnd);
        $this->assertNotSame($inEnglish, $inJapanese);

        $this->assertStringContainsString($inEnglish, $bodies[$english->email]);
        $this->assertStringContainsString($inJapanese, $bodies[$japanese->email]);
        $this->assertStringNotContainsString($inEnglish, $bodies[$japanese->email], 'not the scheduler\'s language');
    }

    public function test_each_admin_reads_the_trial_end_date_in_their_own_language(): void
    {
        $tenantId = $this->createBillingTenant('trial-languages');
        $periodEnd = now()->addDays(7)->setSecond(0);
        $english = $this->createBillingAdmin($tenantId);
        $japanese = $this->createBillingAdmin($tenantId);
        DB::table('users')->where('id', $japanese->id)->update(['preferred_language' => 'ja']);
        $this->createPlanAssignment($tenantId, 'trial', $periodEnd);
        Cache::forget('trial_ending_reminder:' . $tenantId . ':7d');

        $mailer = $this->fakeBillingMailer(true);
        app()->instance(EmailDispatchService::class, $mailer);

        $this->assertSame(['sent' => 1, 'errors' => 0], StripeSubscriptionService::sendTrialEndingReminders());

        $bodies = array_column($mailer->calls, 'body', 'to');
        $this->assertStringContainsString($this->dateAsReadIn('en', $periodEnd), $bodies[$english->email]);
        $this->assertStringContainsString($this->dateAsReadIn('ja', $periodEnd), $bodies[$japanese->email]);
        $this->assertStringNotContainsString($this->dateAsReadIn('en', $periodEnd), $bodies[$japanese->email]);
    }

    /** A date written the way a reader of that language is shown dates in emails. */
    private function dateAsReadIn(string $locale, \DateTimeInterface $date): string
    {
        return (string) \App\I18n\LocaleContext::withLocale($locale, static fn (): string => Carbon::parse($date)
            ->locale(\App\I18n\FormattingLocale::carbon())
            ->isoFormat('LL'));
    }

    public function test_renewal_reminder_stays_deduped_past_twenty_four_hours(): void
    {
        $tenantId = $this->createBillingTenant('renewal-window');
        $periodEnd = now()->addDays(4)->setSecond(0);
        $this->createBillingAdmin($tenantId);
        $this->createPlanAssignment($tenantId, 'active', $periodEnd);

        $cacheKey = 'subscription_renewal_reminder:' . $tenantId . ':' . $periodEnd->format('Y-m-d');
        Cache::forget($cacheKey);

        $mailer = new class extends EmailDispatchService {
            public array $calls = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body', 'options');

                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $mailer);

        $this->assertSame(['sent' => 1, 'errors' => 0], StripeSubscriptionService::sendRenewalReminders());

        try {
            Carbon::setTestNow(now()->addHours(25));

            $this->assertTrue(Cache::has($cacheKey));
            $this->assertSame(['sent' => 0, 'errors' => 0], StripeSubscriptionService::sendRenewalReminders());
            $this->assertCount(1, $mailer->calls);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_trial_reminder_does_not_count_or_cache_when_email_fails(): void
    {
        $tenantId = $this->createBillingTenant('trial-fail');
        $this->createBillingAdmin($tenantId);
        $this->createPlanAssignment($tenantId, 'trial', now()->addDays(7)->setSecond(0));

        $cacheKey = 'trial_ending_reminder:' . $tenantId . ':7d';
        Cache::forget($cacheKey);

        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return false;
            }
        });

        $result = StripeSubscriptionService::sendTrialEndingReminders();

        $this->assertSame(['sent' => 0, 'errors' => 1], $result);
        $this->assertFalse(Cache::has($cacheKey));
    }

    public function test_trial_reminder_stays_deduped_past_twenty_four_hours(): void
    {
        $tenantId = $this->createBillingTenant('trial-window');
        $this->createBillingAdmin($tenantId);
        $this->createPlanAssignment($tenantId, 'trial', now()->addDays(7)->setSecond(0));

        $cacheKey = 'trial_ending_reminder:' . $tenantId . ':7d';
        Cache::forget($cacheKey);

        $mailer = new class extends EmailDispatchService {
            public array $calls = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body', 'options');

                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $mailer);

        $this->assertSame(['sent' => 1, 'errors' => 0], StripeSubscriptionService::sendTrialEndingReminders());

        try {
            Carbon::setTestNow(now()->addHours(25));

            $this->assertTrue(Cache::has($cacheKey));
            $this->assertSame(['sent' => 0, 'errors' => 0], StripeSubscriptionService::sendTrialEndingReminders());
            $this->assertCount(1, $mailer->calls);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_payment_failed_webhook_email_failure_throws_for_retry(): void
    {
        $tenantId = $this->createBillingTenant('webhook-payment-fail');
        $admin = $this->createBillingAdmin($tenantId);
        $stripeSubId = $this->createPlanAssignment($tenantId, 'active', now()->addMonth());
        $mailer = $this->fakeBillingMailer(false);
        app()->instance(EmailDispatchService::class, $mailer);

        TenantContext::setById(2);

        try {
            StripeSubscriptionService::handleInvoicePaymentFailed((object) [
                'id' => 'in_payment_failed_' . uniqid(),
                'subscription' => $stripeSubId,
                'customer' => 'cus_' . uniqid(),
                'amount_due' => 1000,
            ]);
            $this->fail('Expected tenant billing webhook email failure to throw for Stripe retry.');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('Stripe subscription admin email failed for invoice payment failed', $e->getMessage());
        }

        $this->assertSame(2, TenantContext::currentId());
        $this->assertCount(1, $mailer->calls);
        $this->assertSame($admin->email, $mailer->calls[0]['to']);
        $this->assertSame('billing', $mailer->calls[0]['options']['category']);
        $this->assertSame($tenantId, $mailer->calls[0]['options']['tenant_id']);
    }

    public function test_subscription_deleted_email_failure_throws_after_idempotent_state_update(): void
    {
        $tenantId = $this->createBillingTenant('webhook-delete-fail');
        $this->createBillingAdmin($tenantId);
        $stripeSubId = $this->createPlanAssignment($tenantId, 'active', now()->addMonth());
        $mailer = $this->fakeBillingMailer(false);
        app()->instance(EmailDispatchService::class, $mailer);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Stripe subscription admin email failed for subscription deleted');

        try {
            StripeSubscriptionService::handleSubscriptionDeleted((object) [
                'id' => $stripeSubId,
            ]);
        } finally {
            $assignment = DB::table('tenant_plan_assignments')->where('stripe_subscription_id', $stripeSubId)->first();
            $this->assertNotNull($assignment);
            $this->assertSame('cancelled', $assignment->status);
            $this->assertCount(1, $mailer->calls);
        }
    }

    private function createBillingTenant(string $slugSuffix): int
    {
        $slug = 'billing-reminder-' . $slugSuffix . '-' . uniqid();

        return (int) DB::table('tenants')->insertGetId([
            'name' => 'Billing Reminder Tenant',
            'slug' => $slug,
            'domain' => $slug . '.example.test',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createBillingAdmin(int $tenantId): User
    {
        return User::factory()->forTenant($tenantId)->create([
            'role' => 'admin',
            'status' => 'active',
            'is_approved' => true,
            'email' => 'billing-admin-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);
    }

    private function createPlanAssignment(int $tenantId, string $status, \DateTimeInterface $periodEnd): string
    {
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Billing Reminder Plan',
            'slug' => 'billing-reminder-plan-' . uniqid(),
            'tier_level' => 1,
            'price_monthly' => 10,
            'price_yearly' => 100,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $stripeSubId = 'sub_billing_reminder_' . uniqid();

        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $tenantId,
            'pay_plan_id' => $planId,
            'status' => $status,
            'starts_at' => now(),
            'stripe_current_period_end' => $periodEnd,
            'stripe_subscription_id' => $stripeSubId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $stripeSubId;
    }

    private function fakeBillingMailer(bool $sendResult): EmailDispatchService
    {
        return new class($sendResult) extends EmailDispatchService {
            public array $calls = [];

            public function __construct(private bool $sendResult)
            {
            }

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body', 'options');

                return $this->sendResult;
            }
        };
    }
}
