<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Http\Controllers\Api\AdminUsersController;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use ReflectionMethod;
use Tests\Laravel\Support\CapturedEmailLinks;
use Tests\Laravel\TestCase;

/**
 * The five member emails AdminUsersController sends (two-factor reset, password
 * changed, password-reset link, approval, reactivation) build their buttons from
 * the MEMBER's community (UserTenantResolver) but render the template, whose
 * footer "manage preferences" link reads TenantContext, in whatever community
 * the request resolved to. When a manager from a community above sends one for
 * a member below, every link must still be on the member's own address.
 *
 * The endpoints themselves refuse a member outside the request's community
 * (404), so the renders are driven directly with the parent community active —
 * the shape a manager working from above produces. Email-links audit, 2026-10-14
 * (F7b); same fix as WelcomeInvitationMailer.
 */
class AdminUsersMemberEmailCommunityTest extends TestCase
{
    use DatabaseTransactions;

    private const PLATFORM = 'https://app.example.test';
    private const HUB_DOMAIN = 'hub.example.test';

    /** First path segments that exist as pages in the React app. */
    private const ALLOWED = ['login', 'password', 'notifications', 'settings', 'dashboard'];

    /** @var array<string, array{0:mixed,1:mixed,2:string|false}> */
    private array $envBackup = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setEnv('FRONTEND_URL', self::PLATFORM);
        config()->set('app.frontend_url', self::PLATFORM);
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

    /**
     * A hub community that owns a domain, a child under it with no domain of its
     * own, and a member of the child. The member's address is the hub's domain
     * plus the child's slug.
     *
     * @return array{hub:int, child:int, host:string, prefix:string, member:array<string,mixed>}
     */
    private function managerAboveMemberBelow(): array
    {
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
        $member = User::factory()->forTenant((int) $child->id)->create([
            'email' => 'below-' . bin2hex(random_bytes(5)) . '@example.test',
            'first_name' => 'Greta',
            'status' => 'active',
            'is_approved' => 1,
            'preferred_language' => 'en',
        ]);
        $row = User::findById((int) $member->id, false);
        $this->assertNotNull($row);

        return [
            'hub' => (int) $hub->id,
            'child' => (int) $child->id,
            'host' => 'https://' . self::HUB_DOMAIN,
            'prefix' => '/' . $slug,
            'member' => $row,
        ];
    }

    /**
     * Runs one of the controller's private email senders with the HUB active,
     * as a request from a manager above would, and returns what it sent.
     *
     * @param list<mixed> $args
     */
    private function sendFromTheHub(array $fixture, string $method, array $args): CapturedEmailLinks
    {
        $captured = CapturedEmailLinks::install();
        $controller = app(AdminUsersController::class);
        $send = new ReflectionMethod($controller, $method);

        TenantContext::runForTenant($fixture['hub'], function () use ($send, $controller, $args): void {
            $send->invoke($controller, ...$args);
        });

        $this->assertCount(1, $captured->sent, "{$method} should have sent exactly one email");

        return $captured;
    }

    private function assertEveryLinkIsOnTheMembersCommunity(array $fixture, CapturedEmailLinks $captured): void
    {
        $captured->assertAllLinksBelongTo($fixture['host'], $fixture['prefix'], (string) config('app.url'), self::ALLOWED);
        $this->assertStringContainsString(
            $fixture['host'] . $fixture['prefix'] . '/notifications',
            $captured->sent[0]['body'],
            'the footer "manage preferences" link must be on the member\'s own community'
        );
    }

    // ---------------------------------------------------------------- tests

    public function test_two_factor_reset_email_links_stay_on_the_members_community(): void
    {
        $f = $this->managerAboveMemberBelow();

        $captured = $this->sendFromTheHub($f, 'sendTwoFactorResetEmail', [$f['member'], (int) $f['member']['id']]);

        $this->assertEveryLinkIsOnTheMembersCommunity($f, $captured);
        $this->assertStringContainsString($f['host'] . $f['prefix'] . '/login', $captured->sent[0]['body']);
    }

    public function test_password_changed_email_links_stay_on_the_members_community(): void
    {
        $f = $this->managerAboveMemberBelow();

        $captured = $this->sendFromTheHub($f, 'sendPasswordChangedEmail', [$f['member'], (int) $f['member']['id']]);

        $this->assertEveryLinkIsOnTheMembersCommunity($f, $captured);
        $this->assertStringContainsString($f['host'] . $f['prefix'] . '/login', $captured->sent[0]['body']);
    }

    public function test_password_reset_link_email_links_stay_on_the_members_community(): void
    {
        $f = $this->managerAboveMemberBelow();
        $token = bin2hex(random_bytes(32));

        $captured = $this->sendFromTheHub($f, 'sendPasswordResetLinkEmail', [$f['member'], $token]);

        $this->assertEveryLinkIsOnTheMembersCommunity($f, $captured);
        $this->assertStringContainsString($f['host'] . $f['prefix'] . '/password/reset?token=' . $token, $captured->sent[0]['body']);
    }

    public function test_approval_email_links_stay_on_the_members_community(): void
    {
        $f = $this->managerAboveMemberBelow();

        $captured = $this->sendFromTheHub($f, 'sendApprovalWelcomeEmail', [$f['member'], 5]);

        $this->assertEveryLinkIsOnTheMembersCommunity($f, $captured);
        $this->assertStringContainsString($f['host'] . $f['prefix'] . '/login', $captured->sent[0]['body']);
    }

    /**
     * Bridgwater, 2026-10-15: the approval email showed its "things you can do"
     * list as raw `<ul style=…><li …>` text, and its greeting as "Hi Great news,
     * Sarah!,". The list was hand-built HTML passed to paragraph(), which (F-038)
     * shows any non-formatting tag as text; the greeting was a whole sentence
     * passed to greeting(), which wraps its argument in "Hi …,".
     */
    public function test_approval_email_reads_as_written(): void
    {
        $f = $this->managerAboveMemberBelow();

        $captured = $this->sendFromTheHub($f, 'sendApprovalWelcomeEmail', [$f['member'], 5]);
        $body = $captured->sent[0]['body'];

        $this->assertStringNotContainsString('&lt;ul', $body, 'the list must render as a list, not as code');
        $this->assertStringNotContainsString('&lt;li', $body, 'the list must render as a list, not as code');
        $this->assertStringNotContainsString('&lt;/li', $body);
        $this->assertStringContainsString('Great news, Greta!', $body);
        $this->assertStringNotContainsString('Hi Great news', $body);
        $this->assertStringNotContainsString('Greta!,', $body);
        // Every list item still arrives, with its bold word.
        $this->assertStringContainsString('<strong>listings</strong>', $body);
        $this->assertStringContainsString('<strong>events</strong>', $body);
    }

    public function test_reactivation_email_links_stay_on_the_members_community(): void
    {
        $f = $this->managerAboveMemberBelow();

        $captured = $this->sendFromTheHub($f, 'sendReactivationNotificationEmail', [$f['member']]);

        $this->assertEveryLinkIsOnTheMembersCommunity($f, $captured);
        $this->assertStringContainsString($f['host'] . $f['prefix'] . '/login', $captured->sent[0]['body']);
    }
}
