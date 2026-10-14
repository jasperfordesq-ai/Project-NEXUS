<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Email;

use App\Console\Commands\RegionalAnalytics\GenerateMonthlyReports;
use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Events\MessageSent;
use App\Jobs\SendPasswordResetEmail;
use App\Listeners\NotifyMessageReceived;
use App\Mail\SafeguardingCriticalMail;
use App\Models\Message;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Auth\WelcomeInvitationMailer;
use App\Services\CronJobRunner;
use App\Services\EmailVerificationSender;
use App\Services\EventNotificationPreferenceResolver;
use App\Services\EventNotificationService;
use App\Services\GroupInviteService;
use App\Services\NewsletterService;
use App\Services\NotificationDispatcher;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\Support\CapturedEmailLinks;
use Tests\Laravel\TestCase;

/**
 * Drives real email senders for a community that has no domain of its own and
 * checks every link they produce. Two shapes: a community reached only by its
 * slug on the platform host, and a child community under a hub that owns a
 * domain. For each, every link must be on the community's own address and
 * point at a page the React app has (or an API endpoint on the API host).
 *
 * Email-links audit, 2026-10-14.
 */
class SlugOnlyEmailLinksSweepTest extends TestCase
{
    use DatabaseTransactions;

    private const PLATFORM = 'https://app.example.test';
    private const ACCESSIBLE_PLATFORM = 'https://accessible.example.test';
    private const HUB_DOMAIN = 'hub.example.test';

    /** First path segments that exist as pages in the React app (routes/*.tsx, broker/routes.tsx, admin/routes.tsx). */
    private const ALLOWED = [
        'login', 'register', 'password', 'verify-email', 'newsletter', 'support-actions',
        'groups', 'volunteering', 'venues', 'messages', 'events', 'listings', 'exchanges',
        'organisations', 'wallet', 'matches', 'notifications', 'settings', 'admin', 'broker',
        'dashboard', 'feed', 'jobs', 'profile', 'goals', 'ideation', 'blog', 'resources',
        'help', 'about', 'contact', 'federation', 'group-exchanges', 'marketplace', 'onboarding',
    ];

    /** @var array<string, array{0:mixed,1:mixed,2:string|false}> */
    private array $envBackup = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setEnv('FRONTEND_URL', self::PLATFORM);
        config()->set('app.frontend_url', self::PLATFORM);
        config()->set('app.accessible_frontend_url', self::ACCESSIBLE_PLATFORM);
    }

    protected function tearDown(): void
    {
        foreach ($this->envBackup as $key => [$env, $server, $put]) {
            $env === null ? $this->unsetKey($_ENV, $key) : $_ENV[$key] = $env;
            $server === null ? $this->unsetKey($_SERVER, $key) : $_SERVER[$key] = $server;
            $put === false ? putenv($key) : putenv($key . '=' . $put);
        }
        TenantContext::reset();
        parent::tearDown();
    }

    /** @param array<string,mixed> $bag */
    private function unsetKey(array &$bag, string $key): void
    {
        unset($bag[$key]);
    }

    private function setEnv(string $key, string $value): void
    {
        $this->envBackup[$key] ??= [$_ENV[$key] ?? null, $_SERVER[$key] ?? null, getenv($key)];
        $_ENV[$key] = $value;
        $_SERVER[$key] = $value;
        putenv($key . '=' . $value);
    }

    // ------------------------------------------------------------- fixtures

    /** @return array<string, array{0:string}> */
    public static function shapes(): array
    {
        return [
            'slug-only on the platform host' => ['slug-only'],
            'child under a hub with a domain' => ['child'],
        ];
    }

    /** @return array{id:int, slug:string, host:string, prefix:string} */
    private function community(string $shape): array
    {
        if ($shape === 'slug-only') {
            return [
                'id' => $this->testTenantId,
                'slug' => $this->testTenantSlug,
                'host' => self::PLATFORM,
                'prefix' => '/' . $this->testTenantSlug,
            ];
        }

        $hub = Tenant::factory()->create([
            'slug' => 'hub-' . bin2hex(random_bytes(4)),
            'domain' => self::HUB_DOMAIN,
            'accessible_domain' => null,
            'parent_id' => null,
            'depth' => 0,
            'is_active' => true,
            'allows_subtenants' => true,
        ]);
        $slug = 'kid-' . bin2hex(random_bytes(4));
        $child = Tenant::factory()->create([
            'slug' => $slug,
            'domain' => null,
            'accessible_domain' => null,
            'parent_id' => $hub->id,
            'path' => '/' . $hub->slug . '/' . $slug,
            'depth' => 1,
            'is_active' => true,
        ]);

        return ['id' => (int) $child->id, 'slug' => $slug, 'host' => 'https://' . self::HUB_DOMAIN, 'prefix' => '/' . $slug];
    }

    private function member(int $tenantId): User
    {
        return User::factory()->forTenant($tenantId)->create([
            'email' => 'links-' . bin2hex(random_bytes(5)) . '@example.test',
            'first_name' => 'Greta',
            'status' => 'active',
            'is_approved' => 1,
            'preferred_language' => 'en',
        ]);
    }

    /** @return array<string,mixed> */
    private function row(User $user, int $tenantId): array
    {
        return [
            'id' => (int) $user->id,
            'email' => (string) $user->email,
            'first_name' => 'Greta',
            'name' => 'Greta Member',
            'tenant_id' => $tenantId,
            'preferred_language' => 'en',
        ];
    }

    /** @param array{id:int, slug:string, host:string, prefix:string} $t */
    private function audit(string $sender, CapturedEmailLinks $captured, array $t): void
    {
        $this->persist($sender . '-' . $t['slug'], $captured);
        $captured->assertAllLinksBelongTo($t['host'], $t['prefix'], (string) config('app.url'), self::ALLOWED);
    }

    /** Keep the rendered bodies as audit evidence when the gitignored evidence folder exists. */
    private function persist(string $name, CapturedEmailLinks $captured): void
    {
        $dir = base_path('.local-docs-archive/email-links-slug-audit-2026-10-14/captured');
        if (!is_dir($dir) || !is_writable($dir)) {
            return;
        }
        $html = '';
        foreach ($captured->sent as $i => $m) {
            $html .= "<!-- #{$i} to={$m['to']} subject=" . htmlspecialchars($m['subject']) . ' unsubscribe='
                . htmlspecialchars((string) ($m['options']['unsubscribeUrl'] ?? '')) . " -->\n" . $m['body'] . "\n\n";
        }
        @file_put_contents($dir . '/' . preg_replace('/[^a-z0-9-]+/i', '-', $name) . '.html', $html);
    }

    // ---------------------------------------------------- auth and account

    /** @dataProvider shapes */
    public function test_email_verification_link(string $shape): void
    {
        $t = $this->community($shape);
        $user = $this->member($t['id']);
        $captured = CapturedEmailLinks::install();

        TenantContext::runForTenant($t['id'], fn () => app(EmailVerificationSender::class)->send($this->row($user, $t['id'])));

        $this->audit('verification', $captured, $t);
        $this->assertStringContainsString($t['host'] . $t['prefix'] . '/verify-email?token=', $captured->sent[0]['body']);
    }

    /** @dataProvider shapes */
    public function test_password_reset_link(string $shape): void
    {
        $t = $this->community($shape);
        $user = $this->member($t['id']);
        $captured = CapturedEmailLinks::install();

        (new SendPasswordResetEmail((string) $user->email, $t['id'], false))->handle();

        $this->audit('password-reset', $captured, $t);
        $this->assertStringContainsString($t['host'] . $t['prefix'] . '/password/reset?token=', $captured->sent[0]['body']);
    }

    /** @dataProvider shapes */
    public function test_password_reset_link_requested_from_the_accessible_site(string $shape): void
    {
        $t = $this->community($shape);
        $user = $this->member($t['id']);
        $captured = CapturedEmailLinks::install();

        (new SendPasswordResetEmail((string) $user->email, $t['id'], true))->handle();

        // Neither community owns an accessible domain, so the platform accessible
        // host serves the reset page under the slug. The template footer
        // ("manage preferences") still points at the React site, by design.
        $accessibleBase = self::ACCESSIBLE_PLATFORM . '/' . $t['slug'] . '/accessible';
        $this->persist('password-reset-accessible-' . $t['slug'], $captured);
        $captured->assertAllLinksBelongTo($t['host'], $t['prefix'], (string) config('app.url'), self::ALLOWED, [$accessibleBase]);
        $this->assertStringContainsString($accessibleBase . '/password/reset?token=', $captured->sent[0]['body']);
    }

    /** @dataProvider shapes */
    public function test_welcome_invitation_links(string $shape): void
    {
        $t = $this->community($shape);
        $user = $this->member($t['id']);
        $captured = CapturedEmailLinks::install();

        app(WelcomeInvitationMailer::class)->send($this->row($user, $t['id']), true);

        $this->audit('welcome-invitation', $captured, $t);
        $this->assertStringContainsString($t['host'] . $t['prefix'] . '/password/reset?token=', $captured->sent[0]['body']);
    }

    // ------------------------------------------------------------ activity

    /** @dataProvider shapes */
    public function test_new_message_email_links(string $shape): void
    {
        $t = $this->community($shape);
        $recipient = $this->member($t['id']);
        $sender = $this->member($t['id']);
        $captured = CapturedEmailLinks::install();

        $message = (new Message())->forceFill(['id' => 1, 'body' => 'hello there', 'receiver_id' => $recipient->id, 'sender_id' => $sender->id, 'is_voice' => false]);
        $event = new MessageSent($message, $sender, 1, $t['id']);
        $build = new \ReflectionMethod(NotifyMessageReceived::class, 'buildMessageEmailHtml');
        $html = TenantContext::runForTenant($t['id'], fn () => $build->invoke(new NotifyMessageReceived(), $event, 'Sam', '/messages/1'));
        $captured->sent[] = ['to' => (string) $recipient->email, 'subject' => 'message', 'body' => $html, 'options' => []];

        $this->audit('new-message', $captured, $t);
        $this->assertStringContainsString($t['host'] . $t['prefix'] . '/messages/1', $html);
    }

    /** @dataProvider shapes */
    public function test_event_email_links_and_its_unsubscribe(string $shape): void
    {
        $t = $this->community($shape);
        $user = $this->member($t['id']);
        $captured = CapturedEmailLinks::install();

        $build = new \ReflectionMethod(EventNotificationService::class, 'buildDefaultEventEmailHtml');
        [$html, $unsubscribe] = TenantContext::runForTenant($t['id'], fn () => [
            $build->invoke(app(EventNotificationService::class), 'Reminder', 'Tomorrow at 10', '/events/5', (object) ['first_name' => 'Greta']),
            EventNotificationPreferenceResolver::unsubscribeUrl((int) $user->id, $t['id']),
        ]);
        $captured->sent[] = ['to' => (string) $user->email, 'subject' => 'Reminder', 'body' => $html, 'options' => ['unsubscribeUrl' => $unsubscribe]];

        $this->audit('event', $captured, $t);
        $this->assertStringContainsString($t['host'] . $t['prefix'] . '/events/5', $html);
        $this->assertStringStartsWith($t['host'] . '/api/v2/notifications/unsubscribe?token=', $unsubscribe);
    }

    /** @dataProvider shapes */
    public function test_activity_digest_links_including_the_visible_events_unsubscribe(string $shape): void
    {
        $t = $this->community($shape);
        $user = $this->member($t['id']);
        $captured = CapturedEmailLinks::install();

        $items = [
            ['created_at' => now()->toDateTimeString(), 'content_snippet' => 'An event', 'link' => '/events/5', 'activity_type' => 'event_reminder'],
            ['created_at' => now()->toDateTimeString(), 'content_snippet' => 'A message', 'link' => '/messages/3', 'activity_type' => 'message_received'],
        ];
        $build = new \ReflectionMethod(CronJobRunner::class, 'generateEmailHtml');
        $html = TenantContext::runForTenant($t['id'], fn () => $build->invoke(new CronJobRunner(), $this->row($user, $t['id']), $items, 'daily'));
        $captured->sent[] = ['to' => (string) $user->email, 'subject' => 'digest', 'body' => $html, 'options' => []];

        $this->audit('digest', $captured, $t);
        $this->assertStringContainsString($t['host'] . '/api/v2/notifications/unsubscribe?token=', $html, 'visible "unsubscribe from events" link');
        $this->assertStringNotContainsString($t['prefix'] . '/api/', $html);
    }

    /** @dataProvider shapes */
    public function test_match_digest_links(string $shape): void
    {
        $t = $this->community($shape);
        $user = $this->member($t['id']);
        $captured = CapturedEmailLinks::install();

        $matches = [[
            'id' => 1, 'listing_id' => 2, 'match_score' => 90, 'match_type' => 'hot',
            'distance_km' => 1.2, 'title' => 'Garden help', 'user_name' => 'Sam',
        ]];
        $build = new \ReflectionMethod(NotificationDispatcher::class, 'buildMatchDigestEmail');
        $html = TenantContext::runForTenant($t['id'], fn () => $build->invoke(null, $matches, 'daily', 1, 0, (int) $user->id));
        $captured->sent[] = ['to' => (string) $user->email, 'subject' => 'matches', 'body' => $html, 'options' => []];

        $this->audit('match-digest', $captured, $t);
    }

    /** @dataProvider shapes */
    public function test_group_invite_link(string $shape): void
    {
        $t = $this->community($shape);

        $build = new \ReflectionMethod(GroupInviteService::class, 'buildInviteUrl');
        $url = TenantContext::runForTenant($t['id'], fn () => $build->invoke(app(GroupInviteService::class), 'tok'));

        $this->assertSame($t['host'] . $t['prefix'] . '/groups/invite/tok', $url);
    }

    // -------------------------------------------------- the other senders

    /** @dataProvider shapes */
    public function test_newsletter_links(string $shape): void
    {
        $t = $this->community($shape);
        $user = $this->member($t['id']);
        $captured = CapturedEmailLinks::install();

        $newsletter = [
            'content_format' => 'richtext',
            'subject' => 'News',
            'preview_text' => '',
            'content' => '<p>Hello <a href="https://example.org/story">read more</a></p>',
        ];
        $html = TenantContext::runForTenant($t['id'], fn () => NewsletterService::renderEmail($newsletter, 'Our Community', 'unsub-token', ['email' => $user->email], 'track-token'));
        $captured->sent[] = ['to' => (string) $user->email, 'subject' => 'News', 'body' => $html, 'options' => []];

        $this->audit('newsletter', $captured, $t);
        $this->assertStringContainsString($t['host'] . $t['prefix'] . '/newsletter/unsubscribe?token=unsub-token', $html);
    }

    /** @dataProvider shapes */
    public function test_regional_report_email_link_is_absolute(string $shape): void
    {
        $t = $this->community($shape);
        $user = $this->member($t['id']);
        $captured = CapturedEmailLinks::install();

        $mail = new \ReflectionMethod(GenerateMonthlyReports::class, 'mailReport');
        $subscription = (object) ['contact_email' => $user->email, 'tenant_id' => $t['id'], 'contact_language' => 'en'];
        TenantContext::runForTenant($t['id'], fn () => $mail->invoke(app(GenerateMonthlyReports::class), $subscription, '/storage/regional-reports/report.pdf', 'September 2026'));

        $this->audit('regional-report', $captured, $t);
        $this->assertStringContainsString(rtrim((string) config('app.url'), '/') . '/storage/regional-reports/report.pdf', $captured->sent[0]['body']);
    }

    /** @dataProvider shapes */
    public function test_safeguarding_critical_alert_links(string $shape): void
    {
        $t = $this->community($shape);
        $captured = CapturedEmailLinks::install();

        $html = TenantContext::runForTenant($t['id'], fn () => (new SafeguardingCriticalMail([
            'id' => 1, 'category' => 'conduct', 'severity' => 'critical', 'sla_hours' => 4, 'review_due_at' => null,
            'admin_url' => EmailTemplateBuilder::tenantUrl('/admin/safeguarding/1'),
        ], 'Reporter'))->render());
        $captured->sent[] = ['to' => 'coordinator@example.test', 'subject' => 'critical', 'body' => $html, 'options' => []];

        $this->audit('safeguarding-critical', $captured, $t);
    }
}
