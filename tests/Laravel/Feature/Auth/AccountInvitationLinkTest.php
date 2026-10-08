<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Auth;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\Auth\PasswordResetTokens;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Owner decision, 8 Oct 2026: an account invitation (the "set your password"
 * link an administrator's new member is emailed) lasts 7 days, because a
 * member who did not ask for the account rarely acts within the hour a
 * forgot-password link allows. Forgot-password links keep their hour.
 *
 *  - the invitation email's button says "Set your password" and states 7 days;
 *  - "Resend Welcome Email" gives a member who has never signed in a fresh
 *    set-password link (it used to send only a sign-in link, which led nowhere
 *    for someone with no password);
 *  - the nightly clean-up removes expired links but keeps live invitations.
 */
class AccountInvitationLinkTest extends TestCase
{
    use DatabaseTransactions;

    private InvitationCapturingEmailDispatch $mailer;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Cache::flush();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        foreach (['127.0.0.1', '::1', ''] as $ip) {
            RateLimiter::clear("api:reset_password:ip:{$ip}");
        }
        Http::fake(['api.pwnedpasswords.com/*' => Http::response('', 200)]);
        $this->mailer = new InvitationCapturingEmailDispatch();
        app()->instance(EmailDispatchService::class, $this->mailer);
        TenantContext::setById($this->testTenantId);
    }

    // ------------------------------------------------------------ fixtures

    private function email(string $tag): string
    {
        return 'invite-' . $tag . '-' . bin2hex(random_bytes(5)) . '@example.test';
    }

    private function member(string $email, array $extra = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'email' => $email, 'role' => 'member', 'status' => 'active', 'is_approved' => 1,
            'password_hash' => Hash::make('old-invite-password-123'),
        ], $extra));
    }

    private function admin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin', 'status' => 'active', 'is_approved' => 1,
        ]);
        Sanctum::actingAs($admin);

        return $admin;
    }

    private function resetWith(string $plainToken): \Illuminate\Testing\TestResponse
    {
        $pw = 'invite-new-password-' . bin2hex(random_bytes(6));

        return $this->apiPost('/auth/reset-password', [
            'token' => $plainToken, 'password' => $pw, 'password_confirmation' => $pw,
        ]);
    }

    /** Seconds from the database's NOW() until the token row for $email expires. */
    private function secondsUntilExpiry(string $email): ?int
    {
        $row = DB::selectOne(
            'SELECT TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS left_s FROM password_resets
             WHERE email = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 1',
            [$email, $this->testTenantId]
        );

        return $row && $row->left_s !== null ? (int) $row->left_s : null;
    }

    private const SEVEN_DAYS = 7 * 86400;

    // ------------------------------------------------- the 7-day lifetime

    public function test_an_invitation_link_still_works_two_days_later(): void
    {
        $email = $this->email('two-days');
        $this->member($email);
        $token = app(PasswordResetTokens::class)->issueInvitation($email, $this->testTenantId);
        DB::table('password_resets')->where('email', $email)
            ->update(['created_at' => DB::raw('DATE_SUB(NOW(), INTERVAL 2 DAY)')]);

        $this->resetWith($token)->assertStatus(200);
    }

    public function test_an_expired_invitation_link_is_refused(): void
    {
        $email = $this->email('expired');
        $this->member($email);
        $token = app(PasswordResetTokens::class)->issueInvitation($email, $this->testTenantId);
        DB::table('password_resets')->where('email', $email)
            ->update(['expires_at' => DB::raw('DATE_SUB(NOW(), INTERVAL 1 MINUTE)')]);

        $this->resetWith($token)->assertStatus(400);
    }

    public function test_a_forgot_password_link_still_expires_after_an_hour(): void
    {
        $email = $this->email('reset-hour');
        $this->member($email);
        $plain = bin2hex(random_bytes(32));
        DB::table('password_resets')->insert([
            'email' => $email, 'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', $plain), 'created_at' => DB::raw('DATE_SUB(NOW(), INTERVAL 2 HOUR)'),
        ]);

        $this->resetWith($plain)->assertStatus(400);
    }

    // ------------------------------------------------- admin create

    public function test_an_admin_created_members_invitation_lasts_seven_days_and_says_set_your_password(): void
    {
        $this->admin();
        $email = $this->email('store');

        $this->apiPost('/v2/admin/users', [
            'first_name' => 'Invite', 'last_name' => 'Created', 'email' => $email,
            'role' => 'member', 'send_welcome_email' => true,
        ])->assertStatus(201)->assertJsonPath('data.welcome_email_sent', true);

        $left = $this->secondsUntilExpiry($email);
        $this->assertNotNull($left, 'the invitation must carry its own expiry');
        $this->assertGreaterThan(self::SEVEN_DAYS - 120, $left);
        $this->assertLessThanOrEqual(self::SEVEN_DAYS, $left);

        $body = $this->mailer->bodyFor($email);
        $this->assertStringContainsString('Set your password', $body);
        $this->assertStringContainsString('7 days', $body);
        $this->assertStringNotContainsString('1 hour', $body);
    }

    // ------------------------------------------------- resend welcome

    public function test_resend_welcome_gives_a_member_who_never_signed_in_a_set_password_link(): void
    {
        $this->admin();
        $email = $this->email('resend-new');
        $member = $this->member($email, ['last_login_at' => null]);

        $this->apiPost("/v2/admin/users/{$member->id}/send-welcome-email")->assertStatus(200);

        $left = $this->secondsUntilExpiry($email);
        $this->assertNotNull($left, 'a fresh 7-day invitation must be issued');
        $this->assertGreaterThan(self::SEVEN_DAYS - 120, $left);
        $body = $this->mailer->bodyFor($email);
        $this->assertStringContainsString('/password/reset?token=', $body);
        $this->assertStringContainsString('Set your password', $body);
    }

    public function test_resend_welcome_to_a_member_who_has_signed_in_sends_no_password_link(): void
    {
        $this->admin();
        $email = $this->email('resend-active');
        $member = $this->member($email, ['last_login_at' => now()->subDay()]);

        $this->apiPost("/v2/admin/users/{$member->id}/send-welcome-email")->assertStatus(200);

        $this->assertSame(0, DB::table('password_resets')->where('email', $email)->count());
        $this->assertStringNotContainsString('/password/reset?token=', $this->mailer->bodyFor($email));
    }

    // ------------------------------------------------- clean-up

    public function test_clean_up_removes_expired_links_but_keeps_a_live_invitation(): void
    {
        $live = $this->email('live');
        $oldReset = $this->email('old-reset');
        $deadInvite = $this->email('dead-invite');
        app(PasswordResetTokens::class)->issueInvitation($live, $this->testTenantId);
        DB::table('password_resets')->where('email', $live)
            ->update(['created_at' => DB::raw('DATE_SUB(NOW(), INTERVAL 2 DAY)')]);
        DB::table('password_resets')->insert([
            'email' => $oldReset, 'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', 'x' . $oldReset), 'created_at' => DB::raw('DATE_SUB(NOW(), INTERVAL 2 HOUR)'),
        ]);
        app(PasswordResetTokens::class)->issueInvitation($deadInvite, $this->testTenantId);
        DB::table('password_resets')->where('email', $deadInvite)
            ->update(['expires_at' => DB::raw('DATE_SUB(NOW(), INTERVAL 1 MINUTE)')]);

        app(PasswordResetTokens::class)->deleteExpired();

        $this->assertSame(1, DB::table('password_resets')->where('email', $live)->count(), 'a live invitation survives');
        $this->assertSame(0, DB::table('password_resets')->where('email', $oldReset)->count());
        $this->assertSame(0, DB::table('password_resets')->where('email', $deadInvite)->count());
    }

    // ------------------------------------------------- email trigger audit

    private function resetsWithoutEmailCount(): int
    {
        $result = app(\App\Services\EmailTriggerAuditService::class)->run($this->testTenantId, 24);
        foreach ($result['issues'] ?? [] as $issue) {
            if (($issue['code'] ?? null) === 'password_resets_without_email_attempt') {
                return (int) ($issue['params']['count'] ?? 0);
            }
        }

        return 0;
    }

    public function test_an_invitation_is_not_reported_as_a_password_reset_that_was_never_emailed(): void
    {
        // The audit skips reserved test domains, so use an ordinary-looking one.
        $tag = bin2hex(random_bytes(5));
        $before = $this->resetsWithoutEmailCount();

        app(PasswordResetTokens::class)->issueInvitation("invite-audit-{$tag}@nexus-invite-audit.org", $this->testTenantId);
        $this->assertSame($before, $this->resetsWithoutEmailCount(), 'an invitation is sent as a welcome email, not a reset email');

        // Control: an ordinary reset link with no reset email IS still reported.
        DB::table('password_resets')->insert([
            'email' => "reset-audit-{$tag}@nexus-invite-audit.org", 'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', 'audit' . $tag), 'created_at' => DB::raw('NOW()'),
        ]);
        $this->assertSame($before + 1, $this->resetsWithoutEmailCount());
    }
}

/** Records every email instead of sending it. */
class InvitationCapturingEmailDispatch extends EmailDispatchService
{
    /** @var array<int, array{to:string, subject:string, body:string}> */
    public array $sent = [];

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body];

        return true;
    }

    public function bodyFor(string $to): string
    {
        $bodies = array_column(array_filter($this->sent, fn ($m) => $m['to'] === $to), 'body');

        return (string) end($bodies);
    }
}
