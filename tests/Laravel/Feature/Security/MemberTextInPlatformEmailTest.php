<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\SocialNotificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-038 (E-024): a member's own display name must not be able to put a
 * working link into an email the platform sends to somebody else.
 *
 * Reproduced end to end in E-024: a member set their first name to an HTML
 * link through the ordinary profile API, then liked a post, sent a thank-you
 * and declined a connection. Each of the three emails the platform then sent
 * carried the link, live and clickable, from the platform's own address.
 */
class MemberTextInPlatformEmailTest extends TestCase
{
    use DatabaseTransactions;

    private const HOSTILE_FIRST_NAME = 'Anna<a href="https://evil.example/login">Verify your account</a>';

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
                MemberTextInPlatformEmailTest::$sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body];
                return true;
            }
        });
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
    }

    /** Give the member the hostile name through the real profile API. */
    private function hostileMember(): User
    {
        $user = $this->member();
        Sanctum::actingAs($user, ['*']);
        $this->apiPut('/v2/users/me', ['first_name' => self::HOSTILE_FIRST_NAME, 'last_name' => 'X'])->assertStatus(200);
        $this->assertStringContainsString('evil.example', (string) DB::table('users')->where('id', $user->id)->value('name'));

        return $user;
    }

    private function assertEmailTo(User $recipient): void
    {
        $mail = collect(self::$sent)->firstWhere('to', $recipient->email);
        $this->assertNotNull($mail, 'expected an email to the recipient; captured: ' . count(self::$sent));
        $this->assertStringContainsString('evil.example', $mail['body'], 'the name should still appear, as text');
        $this->assertStringNotContainsString('<a href="https://evil.example', $mail['body']);
        $this->assertDoesNotMatchRegularExpression('/<a\b[^>]*evil\.example/i', $mail['body']);
    }

    public function test_a_like_email_shows_the_name_as_text(): void
    {
        $owner = $this->member();
        $liker = $this->hostileMember();

        SocialNotificationService::notifyLike($owner->id, $liker->id, 'post', 999999, 'My post');

        $this->assertEmailTo($owner);
    }

    public function test_a_thank_you_email_shows_the_name_as_text(): void
    {
        $sender = $this->hostileMember();
        $receiver = $this->member();
        Sanctum::actingAs($sender, ['*']);

        $this->apiPost('/v2/appreciations', [
            'receiver_id' => $receiver->id,
            'message' => 'Thanks for your help',
            'is_public' => false,
        ])->assertStatus(201);

        $this->assertEmailTo($receiver);
    }

    public function test_a_declined_connection_email_shows_the_name_as_text(): void
    {
        $requester = $this->member();
        $decliner = $this->hostileMember();
        $connectionId = DB::table('connections')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'requester_id' => $requester->id,
            'receiver_id' => $decliner->id,
            'status' => 'pending',
            'created_at' => now(),
        ]);
        Sanctum::actingAs($decliner, ['*']);

        $this->apiPost("/v2/connections/{$connectionId}/decline", [])->assertStatus(204);

        $this->assertEmailTo($requester);
    }
}
