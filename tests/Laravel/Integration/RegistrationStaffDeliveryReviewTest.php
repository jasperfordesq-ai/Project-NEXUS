<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Services\RegistrationStaffEmailDeliveryLedger as Ledger;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class RegistrationStaffDeliveryReviewTest extends TestCase
{
    use DatabaseTransactions;

    public function test_review_is_tenant_scoped_and_omits_email_and_claim_token(): void
    {
        [$tenant, $registrant, $recipient, $delivery, $email] = $this->fixture();
        [$otherTenant, , , $otherDelivery] = $this->fixture();
        $claim = Ledger::claimCapturedForInline($tenant, $registrant, $recipient);
        $this->assertTrue(Ledger::resolveClaim($tenant, $delivery, $claim['token'], 'unknown', null, 'INLINE_SEND_UNCONFIRMED'));
        DB::table('email_log')->insert([
            'tenant_id' => $tenant,
            'recipient_email' => $email,
            'category' => 'admin_new_registration',
            'idempotency_key' => "admin_new_registration:{$tenant}:{$registrant}:{$recipient}",
            'dispatch_id' => $claim['dispatch_id'],
            'status' => 'failed', 'provider' => 'postmark',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->assertSame(0, Artisan::call('emails:review-registration-staff-deliveries', ['--tenant' => $tenant]));
        $output = Artisan::output();
        $this->assertStringContainsString('"delivery_id":' . $delivery, $output);
        $this->assertStringContainsString('"receipt_count":1', $output);
        $this->assertStringContainsString('"positive_count":0', $output);
        $this->assertStringNotContainsString($email, $output);
        $this->assertStringNotContainsString($claim['token'], $output);
        $this->assertStringNotContainsString('"delivery_id":' . $otherDelivery, $output);
        $this->assertSame('unknown', DB::table('registration_staff_email_deliveries')->where('id', $delivery)->value('status'));
    }

    public function test_review_refuses_missing_tenant_scope(): void
    {
        $this->assertSame(1, Artisan::call('emails:review-registration-staff-deliveries'));
    }

    /** @return array{int,int,int,int,string} */
    private function fixture(): array
    {
        $tenant = (int) DB::table('tenants')->insertGetId([
            'name' => 'Synthetic delivery review', 'slug' => 'review-' . uniqid(),
            'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $registrant = $this->user($tenant, 'member');
        $email = 'review-admin-' . uniqid() . '@project-nexus.testmail';
        $recipient = $this->user($tenant, 'admin', $email);
        $delivery = DB::transaction(static fn (): int => Ledger::captureInTransaction($tenant, $registrant, $recipient));
        return [$tenant, $registrant, $recipient, $delivery, $email];
    }

    private function user(int $tenant, string $role, ?string $email = null): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenant,
            'name' => 'Synthetic review user',
            'first_name' => 'Synthetic', 'last_name' => 'User',
            'email' => $email ?? 'review-user-' . uniqid() . '@project-nexus.testmail',
            'role' => $role, 'status' => 'active',
            'preferred_language' => 'en', 'is_approved' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }
}
