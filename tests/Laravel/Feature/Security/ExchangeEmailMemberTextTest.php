<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\ExchangeRequest;
use App\Models\Listing;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\NotificationDispatcher;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * F-273 (E-062): text a member types when declining, cancelling or (as a
 * broker) rejecting an exchange must not become live HTML in the email the
 * platform sends to the other member.
 *
 * The exchange emails are a hand-written template in NotificationDispatcher
 * that never passes through EmailTemplateBuilder, so F-038's builder-level
 * fix did not reach them. The reason and the two members' display names were
 * interpolated raw. These tests drive NotificationDispatcher::send() against a
 * real exchange row and capture the email body that would have been sent.
 */
class ExchangeEmailMemberTextTest extends TestCase
{
    use DatabaseTransactions;

    private const HOSTILE_REASON =
        '<a href="https://attacker.example/sign-in" style="color:#2563eb">Confirm your account</a>';

    private const HOSTILE_NAME = 'Pat<img src=x onerror=alert(1)><a href="https://attacker.example/n">x</a>';

    /** @var list<array{to: string, subject: string, body: string}> */
    public static array $sent = [];

    protected function setUp(): void
    {
        parent::setUp();
        self::$sent = [];
        $this->app->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function __construct()
            {
            }

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                ExchangeEmailMemberTextTest::$sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body];
                return true;
            }
        });
    }

    /** @return array{0: User, 1: User, 2: ExchangeRequest} requester, provider, exchange */
    private function exchange(string $requesterFirstName = 'Robin', string $providerFirstName = 'Sam'): array
    {
        $requester = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => $requesterFirstName,
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        $provider = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => $providerFirstName,
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $provider->id,
            'title' => 'Gardening help',
            'type' => 'offer',
        ]);
        $exchange = ExchangeRequest::factory()->forTenant($this->testTenantId)->create([
            'listing_id' => $listing->id,
            'requester_id' => $requester->id,
            'provider_id' => $provider->id,
            'proposed_hours' => 2,
            'status' => 'cancelled',
        ]);

        return [$requester, $provider, $exchange];
    }

    private function bodyTo(User $recipient): string
    {
        $mail = collect(self::$sent)->firstWhere('to', $recipient->email);
        $this->assertNotNull($mail, 'expected an exchange email to the recipient; captured: ' . count(self::$sent));

        return (string) $mail['body'];
    }

    private function assertNoLiveMarkupFromMember(string $body): void
    {
        $this->assertDoesNotMatchRegularExpression('/<a\b[^>]*attacker\.example/i', $body, 'member text must not become a live link');
        $this->assertStringNotContainsString('<img src=x', $body, 'member text must not become a live tag');
    }

    public function test_a_declined_reason_is_shown_as_text_not_as_a_link(): void
    {
        [$requester, , $exchange] = $this->exchange();

        NotificationDispatcher::send($requester->id, 'exchange_request_declined', [
            'exchange_id' => $exchange->id,
            'reason' => self::HOSTILE_REASON,
        ]);

        $body = $this->bodyTo($requester);
        $this->assertNoLiveMarkupFromMember($body);
        // The reason is still delivered — as visible, inert text.
        $this->assertStringContainsString('&lt;a href=&quot;https://attacker.example/sign-in&quot;', $body);
    }

    public function test_cancelled_and_broker_rejected_reasons_are_shown_as_text(): void
    {
        foreach (['exchange_cancelled', 'exchange_rejected'] as $type) {
            self::$sent = [];
            [$requester, , $exchange] = $this->exchange();

            NotificationDispatcher::send($requester->id, $type, [
                'exchange_id' => $exchange->id,
                'reason' => self::HOSTILE_REASON,
            ]);

            $body = $this->bodyTo($requester);
            $this->assertNoLiveMarkupFromMember($body);
            $this->assertStringContainsString('&lt;a href=', $body, "{$type}: the reason should still appear, as text");
        }
    }

    public function test_member_display_names_in_the_message_line_are_escaped(): void
    {
        // Provider name appears in the declined / accepted message lines; the
        // requester name in the request-received line.
        foreach (
            [
                ['exchange_request_declined', 'requester'],
                ['exchange_accepted', 'requester'],
                ['exchange_request_received', 'provider'],
            ] as [$type, $recipientRole]
        ) {
            self::$sent = [];
            [$requester, $provider, $exchange] = $this->exchange(self::HOSTILE_NAME, self::HOSTILE_NAME);
            $recipient = $recipientRole === 'requester' ? $requester : $provider;

            NotificationDispatcher::send($recipient->id, $type, ['exchange_id' => $exchange->id]);

            $body = $this->bodyTo($recipient);
            $this->assertNoLiveMarkupFromMember($body);
            $this->assertStringContainsString('Pat&lt;img', $body, "{$type}: the name should still appear, as text");
        }
    }

    /** CONTROL: an ordinary reason and ordinary names render normally, once, unmangled. */
    public function test_control_an_ordinary_reason_and_names_render_normally(): void
    {
        [$requester, , $exchange] = $this->exchange('Robin', "Sam O'Neill");

        NotificationDispatcher::send($requester->id, 'exchange_request_declined', [
            'exchange_id' => $exchange->id,
            'reason' => 'Sorry, I am away that week.',
        ]);

        $body = $this->bodyTo($requester);
        $this->assertStringContainsString('Sorry, I am away that week.', $body);
        $this->assertStringContainsString('Gardening help', $body);
        // Escaped exactly once: an apostrophe is &#039;, never &amp;#039;.
        $this->assertStringContainsString('Sam O&#039;Neill', $body);
        $this->assertStringNotContainsString('&amp;#039;', $body);
        $this->assertStringNotContainsString('attacker.example', $body);
    }
}
