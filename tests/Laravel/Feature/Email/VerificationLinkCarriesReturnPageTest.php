<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Email;

use App\Events\UserRegistered;
use App\Listeners\SendWelcomeNotification;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\Support\CapturedEmailLinks;
use Tests\Laravel\TestCase;

/**
 * A new member who signs up on the way to an emailed page usually opens the
 * verification email in a new tab, where nothing else remembers that page.
 * The verification link itself carries it as ?next= — and only ever a page on
 * this site.
 */
class VerificationLinkCarriesReturnPageTest extends TestCase
{
    use DatabaseTransactions;

    private function pendingMember(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'verify-next-' . bin2hex(random_bytes(5)) . '@example.test',
            'first_name' => 'Nia',
            'status' => 'pending',
            'email_verified_at' => null,
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
        $this->fail('no verification link in the welcome email');
    }

    public function test_verification_link_carries_the_page_the_member_was_going_to(): void
    {
        $captured = CapturedEmailLinks::install();

        (new SendWelcomeNotification())->handle(
            new UserRegistered($this->pendingMember(), $this->testTenantId, '/hour-timebank/exchanges/42?tab=chat'),
        );

        $this->assertStringEndsWith(
            '&next=' . rawurlencode('/hour-timebank/exchanges/42?tab=chat'),
            $this->verificationLink($captured),
        );
    }

    public function test_verification_link_has_no_next_without_a_page(): void
    {
        $captured = CapturedEmailLinks::install();

        (new SendWelcomeNotification())->handle(new UserRegistered($this->pendingMember(), $this->testTenantId));

        $this->assertStringNotContainsString('next=', $this->verificationLink($captured));
    }

    public function test_verification_link_never_carries_another_site(): void
    {
        $captured = CapturedEmailLinks::install();

        (new SendWelcomeNotification())->handle(
            new UserRegistered($this->pendingMember(), $this->testTenantId, 'https://evil.test/phish'),
        );

        $this->assertStringNotContainsString('evil', $this->verificationLink($captured));
    }
}
