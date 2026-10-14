<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Core;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Http\Controllers\Api\NotificationUnsubscribeController;
use App\Jobs\SendPasswordResetEmail;
use App\Models\Tenant;
use App\Services\TenantProvisioning\TenantProvisioningMailer;
use App\Support\Tenancy\UserTenantResolver;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Every email link is built from a host (TenantContext::getFrontendUrl()) and
 * a slug prefix (TenantContext::getSlugPrefix()). A community reached only by
 * its slug — no domain of its own — must get the slug in every link, and a
 * child under a hub must get the hub's domain. These tests pin the four
 * community shapes for every helper that builds such links, so a helper that
 * forgets one half fails here rather than in a member's inbox.
 *
 * Email-links audit, 2026-10-14.
 */
class TenantEmailLinkShapesTest extends TestCase
{
    use DatabaseTransactions;

    private const PLATFORM = 'https://app.example.test';
    private const ACCESSIBLE_PLATFORM = 'https://accessible.example.test';

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
            if ($env === null) {
                unset($_ENV[$key]);
            } else {
                $_ENV[$key] = $env;
            }
            if ($server === null) {
                unset($_SERVER[$key]);
            } else {
                $_SERVER[$key] = $server;
            }
            if ($put === false) {
                putenv($key);
            } else {
                putenv($key . '=' . $put);
            }
        }
        TenantContext::reset();
        parent::tearDown();
    }

    private function setEnv(string $key, ?string $value): void
    {
        $this->envBackup[$key] ??= [$_ENV[$key] ?? null, $_SERVER[$key] ?? null, getenv($key)];
        if ($value === null) {
            unset($_ENV[$key], $_SERVER[$key]);
            putenv($key);
            return;
        }
        $_ENV[$key] = $value;
        $_SERVER[$key] = $value;
        putenv($key . '=' . $value);
    }

    // ------------------------------------------------------------- fixtures

    /**
     * @param array{domain?:string|null, accessible_domain?:string|null, parent?:array{domain?:string|null, accessible_domain?:string|null}} $shape
     * @return array{id:int, slug:string, parent_slug:?string}
     */
    private function makeTenant(array $shape): array
    {
        $parentId = null;
        $parentSlug = null;
        if (isset($shape['parent'])) {
            $parentSlug = 'hub-' . bin2hex(random_bytes(4));
            $parent = Tenant::factory()->create([
                'slug' => $parentSlug,
                'domain' => $shape['parent']['domain'] ?? null,
                'accessible_domain' => $shape['parent']['accessible_domain'] ?? null,
                'parent_id' => null,
                'path' => '/' . $parentSlug,
                'depth' => 0,
                'is_active' => true,
                'allows_subtenants' => true,
            ]);
            $parentId = (int) $parent->id;
        }

        $slug = 'kid-' . bin2hex(random_bytes(4));
        $tenant = Tenant::factory()->create([
            'slug' => $slug,
            'domain' => $shape['domain'] ?? null,
            'accessible_domain' => $shape['accessible_domain'] ?? null,
            'parent_id' => $parentId,
            'path' => ($parentSlug !== null ? '/' . $parentSlug : '') . '/' . $slug,
            'depth' => $parentId !== null ? 1 : 0,
            'is_active' => true,
        ]);

        return ['id' => (int) $tenant->id, 'slug' => $slug, 'parent_slug' => $parentSlug];
    }

    /**
     * Host and prefix templates: {platform} is FRONTEND_URL, {slug} the
     * community's slug.
     *
     * @return array<string, array{0:array<string,mixed>, 1:string, 2:string}>
     */
    public static function shapes(): array
    {
        return [
            'own domain' => [
                ['domain' => 'own.example.test'],
                'https://own.example.test',
                '',
            ],
            'pure slug-only' => [
                [],
                '{platform}',
                '/{slug}',
            ],
            'child, hub has domain' => [
                ['parent' => ['domain' => 'hub.example.test']],
                'https://hub.example.test',
                '/{slug}',
            ],
            'child, hub has no domain' => [
                ['parent' => []],
                '{platform}',
                '/{slug}',
            ],
        ];
    }

    private function fill(string $template, string $slug): string
    {
        return strtr($template, ['{platform}' => self::PLATFORM, '{slug}' => $slug]);
    }

    // ------------------------------------------------------- the core pair

    /** @dataProvider shapes */
    public function test_host_and_slug_prefix_match_the_community_shape(array $shape, string $hostTpl, string $prefixTpl): void
    {
        $t = $this->makeTenant($shape);
        $host = $this->fill($hostTpl, $t['slug']);
        $prefix = $this->fill($prefixTpl, $t['slug']);

        TenantContext::runForTenant($t['id'], function () use ($host, $prefix): void {
            $this->assertSame($host, TenantContext::getFrontendUrl(), 'getFrontendUrl()');
            $this->assertSame($prefix, TenantContext::getSlugPrefix(), 'getSlugPrefix()');
            $this->assertSame($host . $prefix . '/events/7', EmailTemplateBuilder::tenantUrl('/events/7'), 'EmailTemplateBuilder::tenantUrl()');
        });
    }

    /** @dataProvider shapes */
    public function test_user_tenant_resolver_agrees_with_the_core_pair(array $shape, string $hostTpl, string $prefixTpl): void
    {
        $t = $this->makeTenant($shape);

        $resolved = UserTenantResolver::resolve(['tenant_id' => $t['id']]);

        $this->assertSame($this->fill($hostTpl, $t['slug']), $resolved['frontend_url']);
        $this->assertSame($this->fill($prefixTpl, $t['slug']), $resolved['slug_prefix']);
    }

    /** @dataProvider shapes */
    public function test_provisioning_welcome_url_agrees_with_the_core_pair(array $shape, string $hostTpl, string $prefixTpl): void
    {
        $t = $this->makeTenant($shape);
        $row = DB::table('tenants')->where('id', $t['id'])->first();

        $method = new \ReflectionMethod(TenantProvisioningMailer::class, 'tenantUrl');
        $url = $method->invoke(null, $row);

        $this->assertSame($this->fill($hostTpl, $t['slug']) . $this->fill($prefixTpl, $t['slug']), $url);
    }

    // ----------------------------------------------------- unsubscribe (F1)

    /**
     * The unsubscribe endpoint is an API route. Every community host proxies
     * /api/ to Laravel; nothing proxies /{slug}/api/, which the React host
     * answers with its own "page not found". So the link must sit directly
     * under the host, whatever the community's shape.
     *
     * @dataProvider shapes
     */
    public function test_unsubscribe_link_is_an_api_path_directly_under_the_host(array $shape, string $hostTpl, string $prefixTpl): void
    {
        $t = $this->makeTenant($shape);
        $host = $this->fill($hostTpl, $t['slug']);

        $url = TenantContext::runForTenant(
            $t['id'],
            static fn (): string => NotificationUnsubscribeController::buildSignedUrl(1, $t['id'], 'all'),
        );

        $this->assertStringStartsWith($host . '/api/v2/notifications/unsubscribe?token=', $url);
    }

    // ------------------------------------------ accessible reset link (F6)

    private function accessibleResetBase(int $tenantId): ?string
    {
        $job = new SendPasswordResetEmail('member@example.test', $tenantId, true);
        $method = new \ReflectionMethod($job, 'accessibleResetBase');

        return TenantContext::runForTenant($tenantId, static fn () => $method->invoke($job));
    }

    public function test_accessible_reset_uses_the_community_own_accessible_domain(): void
    {
        $t = $this->makeTenant(['domain' => 'own.example.test', 'accessible_domain' => 'easy.own.example.test']);

        $this->assertSame('https://easy.own.example.test', $this->accessibleResetBase($t['id']));
    }

    public function test_accessible_reset_for_slug_only_community_uses_the_platform_accessible_host(): void
    {
        $t = $this->makeTenant([]);

        $this->assertSame(self::ACCESSIBLE_PLATFORM . '/' . $t['slug'] . '/accessible', $this->accessibleResetBase($t['id']));
    }

    /** Proven live on 2026-10-14: the hub's accessible host serves /{child}/accessible/... */
    public function test_accessible_reset_for_child_uses_the_hub_accessible_domain_with_the_child_slug(): void
    {
        $t = $this->makeTenant(['parent' => ['domain' => 'hub.example.test', 'accessible_domain' => 'easy.hub.example.test']]);

        $this->assertSame('https://easy.hub.example.test/' . $t['slug'] . '/accessible', $this->accessibleResetBase($t['id']));
    }

    public function test_accessible_reset_has_no_accessible_link_when_the_platform_host_is_not_configured(): void
    {
        config()->set('app.accessible_frontend_url', null);
        $t = $this->makeTenant([]);

        $this->assertNull($this->accessibleResetBase($t['id']));
    }

    // ------------------------------------------ switching tenant mid-request

    /**
     * A request on a hub's domain that resolves a child by slug remembers the
     * hub's domain. Sending an email for a member of ANOTHER community from
     * that request (runForTenant) must not inherit it: that community's own
     * parent decides its host.
     */
    public function test_run_for_tenant_does_not_inherit_the_request_hub_domain(): void
    {
        $grandchild = $this->makeTenant(['parent' => ['domain' => 'middle.example.test']]);
        $hubRequestTenant = $this->makeTenant(['parent' => ['domain' => 'hub.example.test']]);

        // Simulate the request path that set the hub's domain while resolving a child by slug.
        TenantContext::setById($hubRequestTenant['id']);
        $parentDomain = new \ReflectionProperty(TenantContext::class, 'parentDomain');
        $parentDomain->setValue(null, 'hub.example.test');
        $this->assertSame('https://hub.example.test', TenantContext::getFrontendUrl(), 'precondition: the request host is in effect');

        $host = TenantContext::runForTenant($grandchild['id'], static fn (): string => TenantContext::getFrontendUrl());

        $this->assertSame('https://middle.example.test', $host);
        $this->assertSame('https://hub.example.test', TenantContext::getFrontendUrl(), 'the request host is restored afterwards');
    }
}
