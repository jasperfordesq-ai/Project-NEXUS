<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\Mailer;
use App\Core\TenantContext;
use App\Http\Middleware\SeoRedirectMiddleware;
use App\Models\EmailSettings;
use App\Models\User;
use App\Services\AuthenticationConfigurationService as Settings;
use App\Services\CronJobRunner;
use App\Services\RedisCache;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Mockery;
use OTPHP\TOTP;
use Tests\Laravel\TestCase;

/**
 * E-027 Low findings on admin/platform surfaces:
 * F-057 (operational-role MFA), F-058 (broker profile edits), F-059 (cross-
 * community cache flush), F-061 (SEO open redirect), F-062 (tenant SMTP host
 * SSRF) and F-064 (platform cron output in community admin logs).
 * F-063 (SMTP dot-stuffing) lives in tests/Laravel/Unit/Core/MailerSmtpDataTest.php.
 */
final class AdminPlatformLowFindingsTest extends TestCase
{
    use DatabaseTransactions;

    /** @var resource|null */
    private $server = null;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, false, $this->testTenantId);
    }

    protected function tearDown(): void
    {
        if (is_resource($this->server)) {
            fclose($this->server);
        }
        parent::tearDown();
    }

    private function user(array $attributes = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active', 'is_approved' => true, 'email_verified_at' => now(),
            'password_hash' => Hash::make('test-password'),
        ], $attributes));
    }

    /** @return array<string,string> */
    private function bearer(User $user, bool $mfa = true): array
    {
        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $user->id,
            $user->tenant_id,
            $mfa ? TwoFactorPolicy::claims('totp') : []
        )];
    }

    // =====================================================================
    // F-057 — brokers and coordinators must use a second factor
    // =====================================================================

    public function test_f057_operational_roles_require_two_factor(): void
    {
        $policy = app(TwoFactorPolicy::class);
        foreach (['broker', 'coordinator'] as $role) {
            $this->assertTrue($policy->required(['role' => $role, 'tenant_id' => $this->testTenantId]), $role);

            $operator = $this->user(['role' => $role]);
            $this->apiGet('/v2/users/me', $this->bearer($operator, false))
                ->assertStatus(401)->assertJsonPath('code', 'AUTH_MFA_REQUIRED');
            // Control: the same operator with a verified second factor is admitted.
            $this->apiGet('/v2/users/me', $this->bearer($operator, true))->assertOk();
        }

        // Control: an ordinary member in a community that does not require MFA
        // keeps password-only access.
        $member = $this->user();
        $this->assertFalse($policy->required($member));
        $this->apiGet('/v2/users/me', $this->bearer($member, false))->assertOk();
    }

    public function test_f057_broker_without_two_factor_is_sent_to_enrolment_and_can_complete_it(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['two_factor_authentication' => false])]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $broker = $this->user(['role' => 'broker']);
        $login = $this->apiPost('/auth/login', ['email' => $broker->email, 'password' => 'test-password']);
        $login->assertOk()->assertJsonPath('requires_2fa_setup', true)->assertJsonMissingPath('access_token');

        $challenge = $login->json('two_factor_token');
        $setup = $this->apiPost('/v2/auth/2fa/setup', ['two_factor_token' => $challenge])->assertOk();
        $verified = $this->apiPost('/v2/auth/2fa/verify', [
            'two_factor_token' => $challenge,
            'code' => TOTP::createFromSecret($setup->json('data.secret'))->now(),
        ])->assertOk()->assertJsonPath('data.login_complete', true);

        $this->apiGet('/v2/users/me', ['Authorization' => 'Bearer ' . $verified->json('data.access_token')])
            ->assertOk();
    }

    // =====================================================================
    // F-058 — broker profile edits are tier-checked and respect the ID lock
    // =====================================================================

    private function grantIdVerified(User $user): void
    {
        DB::table('member_verification_badges')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'badge_type' => 'id_verified',
            'granted_at' => now(),
        ]);
    }

    public function test_f058_broker_cannot_edit_an_administrator_or_peer_broker(): void
    {
        $broker = $this->user(['role' => 'broker']);
        $admin = $this->user(['role' => 'admin', 'first_name' => 'Ada', 'phone' => '+353 1 000 0000']);
        $peer = $this->user(['role' => 'broker', 'bio' => 'Original bio']);
        Sanctum::actingAs($broker);

        $this->apiPut("/v2/admin/users/{$admin->id}", ['first_name' => 'Hijacked', 'phone' => '+353 1 999 9999'])
            ->assertStatus(403);
        $this->apiPut("/v2/admin/users/{$peer->id}", ['bio' => 'Defaced'])->assertStatus(403);

        $this->assertSame('Ada', DB::table('users')->where('id', $admin->id)->value('first_name'));
        $this->assertSame('+353 1 000 0000', DB::table('users')->where('id', $admin->id)->value('phone'));
        $this->assertSame('Original bio', DB::table('users')->where('id', $peer->id)->value('bio'));
    }

    public function test_f058_broker_cannot_rename_an_id_verified_member(): void
    {
        $broker = $this->user(['role' => 'broker']);
        $verified = $this->user(['first_name' => 'Maeve', 'last_name' => 'Byrne', 'phone' => '+353 1 111 1111']);
        $this->grantIdVerified($verified);
        Sanctum::actingAs($broker);

        $this->apiPut("/v2/admin/users/{$verified->id}", ['first_name' => 'Someone', 'last_name' => 'Else'])
            ->assertStatus(403);
        $row = DB::table('users')->where('id', $verified->id)->first(['first_name', 'last_name']);
        $this->assertSame(['Maeve', 'Byrne'], [$row->first_name, $row->last_name]);

        // Control: the broker may still edit other fields of that member, even
        // when a full-form save resubmits the unchanged name.
        $this->apiPut("/v2/admin/users/{$verified->id}", [
            'first_name' => 'Maeve', 'last_name' => 'Byrne', 'phone' => '+353 1 222 2222',
        ])->assertOk();
        $this->assertSame('+353 1 222 2222', DB::table('users')->where('id', $verified->id)->value('phone'));
    }

    public function test_f058_controls_broker_edits_ordinary_member_and_admin_renames_verified_member(): void
    {
        $broker = $this->user(['role' => 'broker']);
        $member = $this->user(['first_name' => 'Old', 'bio' => 'Old bio']);
        Sanctum::actingAs($broker);
        $this->apiPut("/v2/admin/users/{$member->id}", ['first_name' => 'New', 'bio' => 'New bio'])->assertOk();
        $this->assertSame('New', DB::table('users')->where('id', $member->id)->value('first_name'));

        $admin = $this->user(['role' => 'admin']);
        $verified = $this->user(['first_name' => 'Typo']);
        $this->grantIdVerified($verified);
        Sanctum::actingAs($admin);
        $this->apiPut("/v2/admin/users/{$verified->id}", ['first_name' => 'Corrected'])->assertOk();
        $this->assertSame('Corrected', DB::table('users')->where('id', $verified->id)->value('first_name'));
    }

    // =====================================================================
    // F-059 — only a platform super-admin may clear every community's cache
    // =====================================================================

    public function test_f059_community_super_admin_cannot_clear_all_communities_cache(): void
    {
        $cache = Mockery::mock(RedisCache::class)->shouldIgnoreMissing();
        $cache->shouldNotReceive('clearTenant');
        $this->app->instance(RedisCache::class, $cache);

        $tenantSuper = $this->user(['role' => 'admin', 'is_tenant_super_admin' => 1]);
        $this->apiPost('/v2/admin/cache/clear', ['type' => 'all'], $this->bearer($tenantSuper))
            ->assertStatus(403);
    }

    public function test_f059_control_community_super_admin_clears_own_community(): void
    {
        $cache = Mockery::mock(RedisCache::class)->shouldIgnoreMissing();
        $cache->shouldReceive('clearTenant')->once()->with($this->testTenantId)->andReturn(0);
        $this->app->instance(RedisCache::class, $cache);

        $tenantSuper = $this->user(['role' => 'admin', 'is_tenant_super_admin' => 1]);
        $this->apiPost('/v2/admin/cache/clear', ['type' => 'tenant'], $this->bearer($tenantSuper))->assertOk();
    }

    public function test_f059_control_platform_super_admin_clears_all(): void
    {
        $platformCache = Mockery::mock(RedisCache::class)->shouldIgnoreMissing();
        $platformCache->shouldReceive('clearTenant')->times(5)->andReturn(0);
        $this->app->instance(RedisCache::class, $platformCache);

        $platformSuper = $this->user(['role' => 'admin', 'is_super_admin' => 1]);
        $this->apiPost('/v2/admin/cache/clear', ['type' => 'all'], $this->bearer($platformSuper))
            ->assertOk()->assertJsonPath('data.type', 'all');
    }

    // =====================================================================
    // F-061 — SEO redirects are same-host only and never touch API routes
    // =====================================================================

    public function test_f061_redirect_destination_must_be_a_same_host_path(): void
    {
        Sanctum::actingAs($this->user(['role' => 'admin']));

        foreach (['https://evil.example/login', '//evil.example', '/\\evil.example', 'javascript:alert(1)', "/\t/evil.example"] as $i => $destination) {
            $this->apiPost('/v2/admin/tools/redirects', ['from_url' => "/f061-bad-{$i}", 'to_url' => $destination])
                ->assertStatus(422);
        }
        $this->assertSame(0, DB::table('seo_redirects')->where('tenant_id', $this->testTenantId)
            ->where('source_url', 'like', '/f061-bad-%')->count());

        // Control: an ordinary on-site path is accepted.
        $this->apiPost('/v2/admin/tools/redirects', ['from_url' => '/f061-old', 'to_url' => '/f061-new?x=1'])
            ->assertStatus(201);
    }

    private function storedRedirect(string $source, string $destination): void
    {
        DB::table('seo_redirects')->insert([
            'tenant_id' => $this->testTenantId,
            'source_url' => $source,
            'destination_url' => $destination,
            'hits' => 0,
            'created_at' => now(),
        ]);
    }

    private function throughRedirectMiddleware(string $path): \Symfony\Component\HttpFoundation\Response
    {
        TenantContext::setById($this->testTenantId);

        return (new SeoRedirectMiddleware())->handle(
            Request::create($path, 'GET'),
            fn () => response('passed through', 200)
        );
    }

    public function test_f061_middleware_skips_api_routes_and_off_site_destinations(): void
    {
        $this->storedRedirect('/v2/f061-listings', '/elsewhere');
        $this->storedRedirect('/api/v2/f061-listings', '/elsewhere');
        $this->storedRedirect('/f061-legacy-offsite', 'https://evil.example/phish');
        $this->storedRedirect('/f061-legacy-protocol-relative', '//evil.example');

        foreach (['/v2/f061-listings', '/api/v2/f061-listings', '/f061-legacy-offsite', '/f061-legacy-protocol-relative'] as $path) {
            $this->assertSame(200, $this->throughRedirectMiddleware($path)->getStatusCode(), $path);
        }

        // Control: an on-site page redirect still works.
        $this->storedRedirect('/f061-old-page', '/f061-new-page');
        $response = $this->throughRedirectMiddleware('/f061-old-page');
        $this->assertSame(301, $response->getStatusCode());
        $this->assertStringEndsWith('/f061-new-page', (string) $response->headers->get('Location'));
    }

    // =====================================================================
    // F-062 — a community SMTP host cannot point at a private address
    // =====================================================================

    public function test_f062_saving_a_private_smtp_host_is_refused(): void
    {
        $admin = $this->user(['role' => 'admin']);
        Sanctum::actingAs($admin);

        foreach (['127.0.0.1', 'localhost', '10.0.0.5', '192.168.1.10', '169.254.169.254', '::1', 'redis.internal'] as $host) {
            $this->apiPut('/v2/admin/email/config', ['email_provider' => 'smtp', 'smtp_host' => $host, 'smtp_port' => '6379'])
                ->assertStatus(422)->assertJsonPath('errors.0.field', 'smtp_host');
        }
        $this->assertNotContains(
            EmailSettings::get($this->testTenantId, 'smtp_host'),
            ['127.0.0.1', 'localhost', '10.0.0.5', '192.168.1.10', '169.254.169.254', '::1', 'redis.internal']
        );

        // Control: a public mail server address is saved.
        $this->apiPut('/v2/admin/email/config', ['email_provider' => 'smtp', 'smtp_host' => '8.8.8.8', 'smtp_port' => '587'])
            ->assertOk();
        $this->assertSame('8.8.8.8', EmailSettings::get($this->testTenantId, 'smtp_host'));
    }

    /** @return int port of a listening socket on loopback */
    private function loopbackListener(): int
    {
        $this->server = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
        $this->assertIsResource($this->server, "could not bind a test socket: $errstr ($errno)");
        $name = (string) stream_socket_get_name($this->server, false);

        return (int) substr($name, strrpos($name, ':') + 1);
    }

    public function test_f062_mailer_never_connects_to_a_stored_private_tenant_smtp_host(): void
    {
        // A row saved before save-time validation existed.
        $port = $this->loopbackListener();
        config(['mail.mailers.smtp.timeout' => 1]);
        EmailSettings::setMultiple($this->testTenantId, [
            'email_provider' => 'smtp',
            'smtp_host' => '127.0.0.1',
            'smtp_port' => (string) $port,
            'smtp_user' => 'probe',
            'smtp_password' => 'probe',
            'smtp_encryption' => 'none',
        ]);

        $sent = (new Mailer($this->testTenantId))->send('f062-' . Str::random(6) . '@example.com', 'Subject', '<p>Body</p>');

        $this->assertFalse($sent);
        $this->assertFalse(@stream_socket_accept($this->server, 0.5), 'the mailer opened a connection to a loopback port');
    }

    public function test_f062_control_platform_smtp_host_is_not_restricted(): void
    {
        // The platform's own relay (operator configuration, not a community
        // admin's) may legitimately be internal — e.g. a local relay container.
        $port = $this->loopbackListener();
        config([
            'mail.mailers.smtp.host' => '127.0.0.1',
            'mail.mailers.smtp.port' => $port,
            'mail.mailers.smtp.encryption' => 'none',
            'mail.mailers.smtp.timeout' => 1,
            'mail.platform_provider' => 'smtp',
        ]);

        (new Mailer())->send('f062-' . Str::random(6) . '@example.com', 'Subject', '<p>Body</p>');

        $accepted = @stream_socket_accept($this->server, 0.5);
        $this->assertIsResource($accepted, 'the platform SMTP relay must still be reachable');
        fclose($accepted);
    }

    // =====================================================================
    // F-064 — platform cron output is not shown to community admins
    // =====================================================================

    public function test_f064_cron_runner_logs_platform_jobs_without_a_community(): void
    {
        TenantContext::setById($this->testTenantId);
        $runner = app(CronJobRunner::class);
        $ref = new \ReflectionClass($runner);
        $jobId = 'f064-job-' . Str::random(8);

        $ref->getProperty('currentJobId')->setValue($runner, $jobId);
        $ref->getProperty('jobStartTime')->setValue($runner, microtime(true));
        $ref->getMethod('logJob')->invoke($runner, 'success', 'Sent digest to someone@other-community.example');

        $subJobId = 'f064-sub-' . Str::random(8);
        $ref->getMethod('logSubTask')->invoke($runner, $subJobId, 'success', 'output', microtime(true));

        foreach ([$jobId, $subJobId] as $id) {
            $row = DB::table('cron_logs')->where('job_id', $id)->first();
            $this->assertNotNull($row, $id);
            $this->assertNull($row->tenant_id, "{$id} must be logged platform-wide");
        }
    }

    public function test_f064_community_admin_cannot_read_platform_cron_output(): void
    {
        $jobId = 'f064-list-' . Str::random(8);
        $platformLogId = DB::table('cron_logs')->insertGetId([
            'job_id' => $jobId, 'status' => 'success', 'output' => 'Digest sent to member@another-community.example',
            'duration_seconds' => 1, 'executed_at' => now(), 'tenant_id' => null,
        ]);
        $ownLogId = DB::table('cron_logs')->insertGetId([
            'job_id' => $jobId, 'status' => 'success', 'output' => 'own community run',
            'duration_seconds' => 1, 'executed_at' => now(), 'tenant_id' => $this->testTenantId,
        ]);

        $admin = $this->user(['role' => 'admin']);
        Sanctum::actingAs($admin);
        $ids = array_column($this->apiGet('/v2/admin/system/cron-jobs/logs?jobId=' . $jobId)->assertOk()->json('data'), 'id');
        $this->assertNotContains($platformLogId, $ids);
        $this->assertContains($ownLogId, $ids, 'control: the community\'s own log stays visible');
        $this->apiGet("/v2/admin/system/cron-jobs/logs/{$platformLogId}")->assertStatus(404);

        // Control: a platform super-admin sees the platform-wide run.
        Sanctum::actingAs($this->user(['role' => 'admin', 'is_super_admin' => 1]));
        $ids = array_column($this->apiGet('/v2/admin/system/cron-jobs/logs?jobId=' . $jobId)->assertOk()->json('data'), 'id');
        $this->assertContains($platformLogId, $ids);
        $this->apiGet("/v2/admin/system/cron-jobs/logs/{$platformLogId}")->assertOk();
    }
}
