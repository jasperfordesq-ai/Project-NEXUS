<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Auth;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\Auth\WelcomeInvitationMailer;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The welcome invitation is ONE email, sent the same way by every sender:
 * the admin "Resend welcome email" action and the member-import background
 * sender both go through WelcomeInvitationMailer.
 *
 * The endpoint tests below are characterisation tests: they were written and
 * run green against AdminUsersController::sendWelcomeEmail BEFORE the email was
 * extracted, and must stay green unchanged after it. The mailer tests pin the
 * shared service's own contract (no permission checks, no activity log, throws
 * on failure after revoking the link it issued).
 */
class WelcomeInvitationMailerTest extends TestCase
{
    use DatabaseTransactions;

    private const DOMAIN = 'welcome-invite.example';

    private const SEVEN_DAYS = 7 * 86400;

    private WelcomeCapturingEmailDispatch $mailer;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Cache::flush();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->mailer = new WelcomeCapturingEmailDispatch();
        app()->instance(EmailDispatchService::class, $this->mailer);
        TenantContext::setById($this->testTenantId);

        // A known custom domain, so every link in the email is predictable:
        // a tenant on its own domain has no slug prefix.
        DB::table('tenants')->where('id', $this->testTenantId)->update(['domain' => self::DOMAIN]);
    }

    // ------------------------------------------------------------ fixtures

    private function email(string $tag): string
    {
        return 'welcome-' . $tag . '-' . bin2hex(random_bytes(5)) . '@example.test';
    }

    private function member(string $email, array $extra = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'email' => $email, 'first_name' => 'Greta', 'role' => 'member', 'status' => 'active',
            'is_approved' => 1, 'password_hash' => Hash::make('welcome-old-password-123'),
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

    private function setWelcomeTemplate(array $welcomeEmail): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['configuration']);
        $config = json_decode($row->configuration ?? '{}', true) ?: [];
        $config['welcome_email'] = $welcomeEmail;
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['configuration' => json_encode($config)]);
    }

    private function tokenRows(string $email): int
    {
        return DB::table('password_resets')->where('email', $email)->where('tenant_id', $this->testTenantId)->count();
    }

    private function secondsUntilExpiry(string $email): ?int
    {
        $row = DB::selectOne(
            'SELECT TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS left_s FROM password_resets
             WHERE email = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 1',
            [$email, $this->testTenantId]
        );

        return $row && $row->left_s !== null ? (int) $row->left_s : null;
    }

    /** The link in the body must carry the token whose hash is stored. */
    private function assertBodyCarriesLiveInvitation(string $email, string $body): void
    {
        $prefix = 'https://' . self::DOMAIN . '/password/reset?token=';
        $this->assertStringContainsString($prefix, $body, 'set-password URL on the tenant domain');
        $this->assertSame(1, preg_match('#' . preg_quote($prefix, '#') . '([0-9a-f]{64})#', $body, $m));
        $this->assertSame(1, DB::table('password_resets')->where('email', $email)
            ->where('tenant_id', $this->testTenantId)->where('token', hash('sha256', $m[1]))->count());

        $left = $this->secondsUntilExpiry($email);
        $this->assertNotNull($left, 'the invitation carries its own expiry');
        $this->assertGreaterThan(self::SEVEN_DAYS - 120, $left);
        $this->assertLessThanOrEqual(self::SEVEN_DAYS, $left);
    }

    // ------------------------------------- characterisation: the endpoint

    public function test_resend_to_a_member_who_never_signed_in_sends_a_seven_day_link_in_their_language(): void
    {
        $admin = $this->admin();
        $email = $this->email('de-link');
        $member = $this->member($email, ['last_login_at' => null, 'preferred_language' => 'de']);

        $this->apiPost("/v2/admin/users/{$member->id}/send-welcome-email")
            ->assertStatus(200)
            ->assertJsonPath('data.sent', true)
            ->assertJsonPath('data.id', $member->id);

        $sent = $this->mailer->lastFor($email);
        $this->assertBodyCarriesLiveInvitation($email, $sent['body']);
        $this->assertStringContainsString('Passwort festlegen', $sent['body']);
        $this->assertStringContainsString('Hallo Greta,', $sent['body']);
        $this->assertStringNotContainsString('Set your password', $sent['body']);
        $this->assertStringStartsWith('Willkommen bei ', $sent['subject']);
        $this->assertSame('welcome', $sent['options']['category'] ?? null);
        $this->assertSame($this->testTenantId, $sent['options']['tenant_id'] ?? null);

        $this->assertSame(1, DB::table('activity_log')->where('user_id', $admin->id)
            ->where('action', 'admin_resend_welcome')
            ->where('details', "Resent welcome email to user #{$member->id} ({$email}) with a set-password link")
            ->count());
    }

    public function test_resend_to_a_member_who_has_signed_in_sends_a_login_button_and_no_link(): void
    {
        $admin = $this->admin();
        $email = $this->email('login');
        $member = $this->member($email, ['last_login_at' => now()->subDay()]);

        $this->apiPost("/v2/admin/users/{$member->id}/send-welcome-email")->assertStatus(200);

        $body = $this->mailer->lastFor($email)['body'];
        $this->assertSame(0, $this->tokenRows($email));
        $this->assertStringContainsString('https://' . self::DOMAIN . '/login', $body);
        $this->assertStringContainsString('Get Started', $body);
        $this->assertStringNotContainsString('/password/reset', $body);
        $this->assertSame(1, DB::table('activity_log')->where('user_id', $admin->id)
            ->where('action', 'admin_resend_welcome')
            ->where('details', "Resent welcome email to user #{$member->id} ({$email})")
            ->count());
    }

    public function test_a_full_html_community_template_is_sent_verbatim_when_no_link_is_needed(): void
    {
        $this->admin();
        $html = '<!DOCTYPE html><html><body><p>CUSTOM-WELCOME-MARKER</p></body></html>';
        $this->setWelcomeTemplate(['subject' => 'Custom welcome subject', 'body' => $html]);
        $email = $this->email('full-html');
        $member = $this->member($email, ['last_login_at' => now()->subDay()]);

        $this->apiPost("/v2/admin/users/{$member->id}/send-welcome-email")->assertStatus(200);

        $sent = $this->mailer->lastFor($email);
        $this->assertSame($html, $sent['body']);
        $this->assertSame('Custom welcome subject', $sent['subject']);
    }

    public function test_a_full_html_community_template_gives_way_to_standard_wording_when_a_link_is_needed(): void
    {
        $this->admin();
        $html = '<!DOCTYPE html><html><body><p>CUSTOM-WELCOME-MARKER</p></body></html>';
        $this->setWelcomeTemplate(['subject' => 'Custom welcome subject', 'body' => $html]);
        $email = $this->email('full-html-link');
        $member = $this->member($email, ['last_login_at' => null]);

        $this->apiPost("/v2/admin/users/{$member->id}/send-welcome-email")->assertStatus(200);

        $sent = $this->mailer->lastFor($email);
        $this->assertStringNotContainsString('CUSTOM-WELCOME-MARKER', $sent['body']);
        $this->assertStringContainsString('Hello Greta,', $sent['body']);
        $this->assertStringContainsString('Set your password', $sent['body']);
        $this->assertBodyCarriesLiveInvitation($email, $sent['body']);
        $this->assertSame('Custom welcome subject', $sent['subject']);
    }

    public function test_a_failed_send_revokes_the_link_and_reports_an_error(): void
    {
        $this->admin();
        $this->mailer->succeed = false;
        $email = $this->email('fail');
        $member = $this->member($email, ['last_login_at' => null]);

        $this->apiPost("/v2/admin/users/{$member->id}/send-welcome-email")->assertStatus(500);

        $this->assertCount(1, $this->mailer->sent, 'the send was attempted');
        $this->assertSame(0, $this->tokenRows($email), 'a link nobody received must not stay live');
        $this->assertSame(0, DB::table('activity_log')->where('action', 'admin_resend_welcome')
            ->where('details', 'like', "%#{$member->id} %")->count());
    }

    // ------------------------------------------------- the shared mailer

    public function test_mailer_with_link_issues_a_live_invitation_in_the_members_language(): void
    {
        $email = $this->email('svc-link');
        $member = $this->member($email, ['last_login_at' => null, 'preferred_language' => 'de']);

        app(WelcomeInvitationMailer::class)->send(User::findById($member->id, true), true);

        $sent = $this->mailer->lastFor($email);
        $this->assertBodyCarriesLiveInvitation($email, $sent['body']);
        $this->assertStringContainsString('Passwort festlegen', $sent['body']);
        $this->assertSame('welcome', $sent['options']['category'] ?? null);
        $this->assertSame(0, DB::table('activity_log')->where('action', 'admin_resend_welcome')
            ->where('details', 'like', "%#{$member->id} %")->count(), 'callers log, not the mailer');
    }

    public function test_mailer_without_link_sends_the_login_button_and_issues_nothing(): void
    {
        $email = $this->email('svc-login');
        // Never signed in: the CALLER decides whether a link is sent, not the mailer.
        $member = $this->member($email, ['last_login_at' => null]);

        app(WelcomeInvitationMailer::class)->send(User::findById($member->id, true), false);

        $body = $this->mailer->lastFor($email)['body'];
        $this->assertSame(0, $this->tokenRows($email));
        $this->assertStringContainsString('https://' . self::DOMAIN . '/login', $body);
    }

    public function test_mailer_uses_a_community_body_that_is_not_full_html_as_the_message(): void
    {
        $this->setWelcomeTemplate(['body' => '<p>COMMUNITY-PARAGRAPH-MARKER</p>']);
        $email = $this->email('svc-custom');
        $member = $this->member($email);

        app(WelcomeInvitationMailer::class)->send(User::findById($member->id, true), true);

        $body = $this->mailer->lastFor($email)['body'];
        $this->assertStringContainsString('COMMUNITY-PARAGRAPH-MARKER', $body);
        $this->assertBodyCarriesLiveInvitation($email, $body);
    }

    public function test_mailer_send_failure_revokes_the_link_and_throws(): void
    {
        $this->mailer->succeed = false;
        $email = $this->email('svc-fail');
        $member = $this->member($email, ['last_login_at' => null]);

        try {
            app(WelcomeInvitationMailer::class)->send(User::findById($member->id, true), true);
            $this->fail('a failed send must throw');
        } catch (\RuntimeException $e) {
            $this->assertSame('Welcome email send returned false', $e->getMessage());
        }

        $this->assertCount(1, $this->mailer->sent);
        $this->assertSame(0, $this->tokenRows($email), 'the issued link is revoked');
    }

    public function test_mailer_restores_the_callers_locale(): void
    {
        app()->setLocale('en');
        $email = $this->email('svc-locale');
        $member = $this->member($email, ['preferred_language' => 'de']);

        app(WelcomeInvitationMailer::class)->send(User::findById($member->id, true), false);

        $this->assertSame('en', app()->getLocale());
    }
}

/** Records every email instead of sending it; can be told to fail. */
class WelcomeCapturingEmailDispatch extends EmailDispatchService
{
    /** @var array<int, array{to:string, subject:string, body:string, options:array<string,mixed>}> */
    public array $sent = [];

    public bool $succeed = true;

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body, 'options' => $options];

        return $this->succeed;
    }

    /** @return array{to:string, subject:string, body:string, options:array<string,mixed>} */
    public function lastFor(string $to): array
    {
        $mine = array_values(array_filter($this->sent, fn ($m) => $m['to'] === $to));
        \PHPUnit\Framework\Assert::assertNotEmpty($mine, "no email was sent to {$to}");

        return end($mine);
    }
}
