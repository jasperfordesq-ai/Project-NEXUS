<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Services\EmailService;
use Tests\Laravel\TestCase;

/**
 * F-323 — the unauthenticated sales enquiry puts the visitor's name into the
 * Reply-To header. A comma or semicolon in that name must not be able to add
 * a second reply address.
 */
class SalesOrderReplyToTest extends TestCase
{
    /** @var array<int, array{to: string, options: array}> */
    private array $sent = [];

    protected function setUp(): void
    {
        parent::setUp();

        $test = $this;
        $this->app->instance(EmailService::class, new class($test) extends EmailService {
            public function __construct(private SalesOrderReplyToTest $test)
            {
            }

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->test->recordSend($to, $options);

                return true;
            }
        });
    }

    public function recordSend(string $to, array $options): void
    {
        $this->sent[] = ['to' => $to, 'options' => $options];
    }

    private function submit(string $name): string
    {
        $this->sent = [];
        $response = $this->apiPost('/v2/sales/orders', [
            'contact_name' => $name,
            'email' => 'visitor@example.org',
        ]);
        $response->assertStatus(201);
        $this->assertCount(1, $this->sent);

        return (string) $this->sent[0]['options']['replyTo'];
    }

    public function test_a_comma_in_the_name_cannot_add_a_second_reply_address(): void
    {
        $replyTo = $this->submit('attacker@evil.test, Bob');

        $this->assertStringNotContainsString(',', $replyTo);
        $this->assertStringNotContainsString('attacker@evil.test', $replyTo);
        $this->assertSame(1, substr_count($replyTo, '@'), "Reply-To must carry exactly one address: {$replyTo}");
        $this->assertStringEndsWith('<visitor@example.org>', $replyTo);
    }

    public function test_a_semicolon_or_group_syntax_in_the_name_cannot_add_an_address(): void
    {
        $replyTo = $this->submit('Team: attacker@evil.test; Bob');

        $this->assertStringNotContainsString(';', $replyTo);
        $this->assertStringNotContainsString(':', $replyTo);
        $this->assertSame(1, substr_count($replyTo, '@'), "Reply-To must carry exactly one address: {$replyTo}");
    }

    public function test_control_an_ordinary_name_is_kept(): void
    {
        $replyTo = $this->submit("Síle O'Brien-Nuñez");

        $this->assertSame("Síle O'Brien-Nuñez <visitor@example.org>", $replyTo);
    }
}
