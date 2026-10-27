<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Email;

use App\Core\TenantContext;
use App\Jobs\SendEmailVerificationResend;
use App\Models\User;
use App\Services\EmailVerificationSender;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Support\CapturedEmailLinks;
use Tests\Laravel\TestCase;

/**
 * A replacement verification email keeps the page the new member was on their
 * way to, exactly like the first one does (VerificationLinkCarriesReturnPageTest).
 */
class ResendVerificationCarriesReturnPageTest extends TestCase
{
    use DatabaseTransactions;

    private const PAGE = '/hour-timebank/groups/7?tab=members';

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        unset($_SESSION['user_id']);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        Cache::flush();
        foreach (glob(sys_get_temp_dir() . '/nexus_ratelimit/*.json') ?: [] as $file) {
            @unlink($file);
        }
    }

    private function unverifiedMember(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'resend-next-' . bin2hex(random_bytes(5)) . '@gmail.com',
            'email_verified_at' => null,
            'is_verified' => false,
            'preferred_language' => 'en',
        ]);
    }

    private function verificationLink(CapturedEmailLinks $captured): string
    {
        foreach ($captured->links() as $link) {
            if (str_contains($link, '/verify-email?token=')) {
                return $link;
            }
        }
        $this->fail('no verification link was sent');
    }

    /** @return array<string, mixed> */
    private function row(User $user): array
    {
        return [
            'id' => (int) $user->id,
            'email' => (string) $user->email,
            'first_name' => 'Nia',
            'tenant_id' => $this->testTenantId,
            'preferred_language' => 'en',
        ];
    }

    public function test_sender_puts_the_page_in_the_link(): void
    {
        $captured = CapturedEmailLinks::install();

        app(EmailVerificationSender::class)->send($this->row($this->unverifiedMember()), self::PAGE);

        $this->assertStringEndsWith('&next=' . rawurlencode(self::PAGE), $this->verificationLink($captured));
    }

    public function test_sender_drops_another_site(): void
    {
        $captured = CapturedEmailLinks::install();

        app(EmailVerificationSender::class)->send($this->row($this->unverifiedMember()), 'https://evil.test/x');

        $this->assertStringNotContainsString('next=', $this->verificationLink($captured));
    }

    public function test_signed_in_resend_keeps_the_page(): void
    {
        $captured = CapturedEmailLinks::install();
        Sanctum::actingAs($this->unverifiedMember(), ['*']);

        $this->apiPost('/auth/resend-verification', ['return_to' => self::PAGE])->assertOk();

        $this->assertStringEndsWith('&next=' . rawurlencode(self::PAGE), $this->verificationLink($captured));
    }

    public function test_resend_by_email_keeps_only_a_same_site_page(): void
    {
        Bus::fake([SendEmailVerificationResend::class]);
        $kept = $this->unverifiedMember();
        $dropped = $this->unverifiedMember();

        $this->apiPost('/auth/resend-verification-by-email', ['email' => $kept->email, 'return_to' => self::PAGE])->assertOk();
        $this->apiPost('/auth/resend-verification-by-email', ['email' => $dropped->email, 'return_to' => '//evil.test'])->assertOk();

        Bus::assertDispatched(SendEmailVerificationResend::class, fn (SendEmailVerificationResend $job) =>
            $job->email === $kept->email && $job->returnTo === self::PAGE);
        Bus::assertDispatched(SendEmailVerificationResend::class, fn (SendEmailVerificationResend $job) =>
            $job->email === $dropped->email && $job->returnTo === null);
    }
}
