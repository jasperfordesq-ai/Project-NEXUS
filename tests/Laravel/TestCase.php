<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel;

use App\Core\TenantContext;
use App\Services\FederationFeatureService;
use App\Services\PartnerApi\PartnerApiKillSwitch;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;

/**
 * Base test case for all Laravel tests in the migration.
 *
 * Boots the Laravel application and sets up the tenant context
 * for multi-tenant testing (defaults to tenant 2 / hour-timebank).
 *
 * Existing legacy tests under tests/Unit, tests/Feature, etc.
 * are NOT affected — they continue to use the legacy bootstrap.
 */
abstract class TestCase extends BaseTestCase
{
    use CreatesApplication;

    /**
     * Application instance booted for class-level setup (setUpBeforeClass).
     *
     * Laravel's TestCase only boots the application in the instance setUp(),
     * so any test that does data seeding / TenantContext work in a static
     * setUpBeforeClass() hits "A facade root has not been set" (or, once a
     * prior class booted then tore the container down, "Class config does not
     * exist"). Booting a dedicated app here and pointing the Facade root at it
     * makes facade-backed helpers (DB, Config, TenantContext) usable from
     * setUpBeforeClass, mirroring how they behave at runtime.
     */
    private static ?\Illuminate\Foundation\Application $classApp = null;

    /**
     * Boot a Laravel application for class-level (static) setup and point the
     * Facade root at it. Idempotent — safe to call from every setUpBeforeClass.
     *
     * Tests that seed fixtures or set TenantContext inside setUpBeforeClass MUST
     * call this first, before touching any facade-backed helper.
     */
    protected static function bootApplicationForClass(): \Illuminate\Foundation\Application
    {
        $app = require dirname(__DIR__, 2) . '/bootstrap/app.php';
        $app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();

        // Point the Facade root at this freshly-booted container so DB::,
        // Config::, Log:: etc. resolve during static setup.
        \Illuminate\Support\Facades\Facade::clearResolvedInstances();
        \Illuminate\Support\Facades\Facade::setFacadeApplication($app);

        self::$classApp = $app;

        return $app;
    }

    /**
     * Default tenant ID for testing (hour-timebank).
     */
    protected int $testTenantId = 2;

    /**
     * Default tenant slug for testing.
     */
    protected string $testTenantSlug = 'hour-timebank';

    /**
     * Set up the test environment.
     */
    protected function setUp(): void
    {
        parent::setUp();

        // BaseApiController::resolveUserId() falls back to the legacy
        // $_SESSION['user_id'] superglobal, which survives across tests in the
        // shared PHPUnit process. A leaked id makes "anonymous" requests in
        // later tests silently authenticate as a user from an earlier test
        // (wrong tenant, rolled-back row, etc.). Clear it so every test starts
        // truly anonymous; tests that need a legacy session set it themselves
        // after parent::setUp().
        unset($_SESSION['user_id']);

        $this->setUpTenantContext();
        $this->setUpExternalAccessControls();
    }

    /**
     * Seed the platform external-access kill switches as ENABLED for tests.
     *
     * Both switches ship disabled in production (external partner federation
     * and the AG60 Partner API), which is the deliberate safety posture. The
     * test suite, however, is full of pre-existing tests that assert what those
     * surfaces DO when they are reachable — protocol endpoints, push listeners,
     * partner auth, rate limiting. Leaving the production default in place makes
     * every one of them assert against a 503 instead of the behaviour under
     * test, which says nothing useful.
     *
     * So the default here mirrors pre-switch behaviour, and the tests that
     * exercise the switches themselves turn them off explicitly. Kept in the
     * base setUp rather than a trait so a newly added test cannot silently
     * inherit the wrong posture.
     */
    protected function setUpExternalAccessControls(): void
    {
        try {
            // Mirror FederationFeatureService::initializeSystemDefaults() in
            // full, not just the external columns. This row is a singleton, so
            // whichever test first creates it wins — and the SQL defaults for
            // cross_tenant_* are 0. Seeding a partial row here would silently
            // pre-empt the per-test insertOrIgnore calls that expect those to
            // be 1, breaking suites depending on which test ran first.
            //
            // No Schema::hasColumn() probes: they run information_schema
            // introspection on every single test in the suite, and the catch
            // below already covers a database without these columns.
            $row = [
                'federation_enabled' => 1,
                // whitelist_mode_enabled MUST be listed: its SQL default is 1,
                // so an insert that omits it switches whitelist mode ON, and
                // isTenantFederationEnabled() then returns false for every
                // non-whitelisted tenant — listeners return early and send
                // nothing, which surfaces as "an expected request was not
                // recorded" rather than anything mentioning a whitelist.
                'whitelist_mode_enabled' => 0,
                'emergency_lockdown_active' => 0,
                'max_federation_level' => 4,
                'cross_tenant_profiles_enabled' => 1,
                'cross_tenant_messaging_enabled' => 1,
                'cross_tenant_transactions_enabled' => 1,
                'cross_tenant_listings_enabled' => 1,
                'cross_tenant_events_enabled' => 1,
                'cross_tenant_groups_enabled' => 1,
                'external_federation_enabled' => 1,
                'updated_at' => now(),
            ];
            foreach (FederationFeatureService::externalProtocolNames() as $protocol) {
                $column = FederationFeatureService::externalProtocolColumn($protocol);
                if ($column !== null) {
                    $row[$column] = 1;
                }
            }
            $row['partner_api_enabled'] = 1;

            // updateOrInsert, NOT update: the schema dump CI builds nexus_test
            // from carries no row for this singleton table, so an update()
            // matches nothing and getExternalControls() — which fails closed by
            // design rather than self-healing like getSystemControls() — then
            // blocks every external surface. That passed locally only because a
            // row already existed in the long-lived dev database.
            DB::table('federation_system_control')->updateOrInsert(['id' => 1], $row);

            app(FederationFeatureService::class)->clearCache();
            app(PartnerApiKillSwitch::class)->clearCache();
        } catch (\Throwable) {
            // Unit tests without a database still need to boot.
        }
    }

    /**
     * Initialize the tenant context for testing.
     *
     * Sets tenant_id=2 (hour-timebank) so that all tenant-scoped
     * queries and model operations work correctly during tests.
     *
     * For unit tests that don't need the database, the DB insert is
     * wrapped in a try-catch so tests can still set the TenantContext
     * without requiring a live DB connection.
     */
    protected function setUpTenantContext(): void
    {
        // Reset ALL leaked tenant state before re-establishing it. The PHPUnit
        // process is shared across every test in a shard (effectively a
        // persistent worker), so state from an earlier test survives into later
        // ones. Two distinct leaks both bite once test order changes (e.g. under
        // sharding):
        //
        //   1. Static state: setById() below only sets $tenant/$cachedId — it
        //      does NOT clear $headerTenantId / $tokenTenantId / $parentDomain.
        //      A prior test that ran TenantContext::initialize() with an
        //      X-Tenant-ID header leaves $headerTenantId set, so e.g.
        //      TenantContextTest::test_getHeaderTenantId_returns_null_by_default
        //      sees the leaked id instead of null. reset() was built for exactly
        //      this persistent-worker case.
        //
        //   2. Superglobals: ResolveTenant middleware writes
        //      $_SERVER['HTTP_X_TENANT_ID'] / ['HTTP_X_TENANT_SLUG'] on every API
        //      request and never clears them. If a later test nulls the tenant
        //      (e.g. a listener calling restoreAfterScopedListener() in CLI mode)
        //      and then touches a tenant-scoped model, TenantContext::resolve()
        //      re-reads the STALE header — and a leaked invalid id throws
        //      INVALID_TENANT (see WalletApiControllerTest / AwardXpOnVolLog*).
        //      reset() does not touch $_SERVER, so clear it explicitly here.
        //      HTTP_AUTHORIZATION is cleared too: ResolveTenant also syncs it and
        //      TenantContext derives a token tenant id from the Bearer token, so a
        //      leaked Authorization header is a third resolution-poisoning vector.
        unset(
            $_SERVER['HTTP_X_TENANT_ID'],
            $_SERVER['HTTP_X_TENANT_SLUG'],
            $_SERVER['HTTP_AUTHORIZATION']
        );
        TenantContext::reset();

        // Seed the test tenant. Use updateOrInsert (NOT insertOrIgnore) keyed on id:
        // CI pre-seeds tenant id=2 with slug 'test-tenant-2', so insertOrIgnore was a
        // no-op and the slug never became the expected 'hour-timebank' — every test
        // that resolves tenant 2 by slug then 400s / asserts the wrong slug. Forcing
        // the row guarantees id=2 carries slug=$testTenantSlug regardless of pre-seed.
        try {
            DB::table('tenants')->updateOrInsert(
                ['id' => $this->testTenantId],
                [
                    'name' => 'Hour Timebank',
                    'slug' => $this->testTenantSlug,
                    'domain' => null,
                    'is_active' => true,
                    'depth' => 0,
                    'allows_subtenants' => false,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]
            );

            // Keep the secondary tenant active even if a stale local fixture row
            // already exists from an earlier non-transactional test run.
            DB::table('tenants')->updateOrInsert(
                ['id' => 999],
                [
                    'name' => 'Other Test Tenant',
                    'slug' => 'test-999',
                    'domain' => null,
                    'is_active' => true,
                    'depth' => 0,
                    'allows_subtenants' => false,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]
            );

            TenantContext::setById($this->testTenantId);
        } catch (\Exception $e) {
            // DB not available — unit tests that don't need DB can still proceed.
            // Use reflection to set the private static $tenant property directly.
            $ref = new \ReflectionClass(TenantContext::class);
            $prop = $ref->getProperty('tenant');
            $prop->setAccessible(true);
            $prop->setValue(null, [
                'id' => $this->testTenantId,
                'name' => 'Hour Timebank',
                'slug' => $this->testTenantSlug,
                'domain' => null,
                'is_active' => true,
                'features' => '{}',
            ]);
        }
    }

    /**
     * Override the test tenant for a specific test.
     */
    protected function withTenant(int $tenantId): static
    {
        $this->testTenantId = $tenantId;
        TenantContext::setById($tenantId);

        return $this;
    }

    /**
     * Add the X-Tenant-ID header to requests.
     *
     * The ResolveTenant middleware resolves tenant from this header,
     * so we include it on all API requests.
     */
    protected function withTenantHeader(array $headers = []): array
    {
        return array_merge($headers, [
            'X-Tenant-ID' => (string) $this->testTenantId,
            'Accept' => 'application/json',
        ]);
    }

    /**
     * Make a JSON API request with the tenant header included.
     */
    protected function apiGet(string $uri, array $headers = []): \Illuminate\Testing\TestResponse
    {
        return $this->getJson('/api' . $uri, $this->withTenantHeader($headers));
    }

    /**
     * Make a JSON POST API request with the tenant header included.
     */
    protected function apiPost(string $uri, array $data = [], array $headers = []): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api' . $uri, $data, $this->withTenantHeader($headers));
    }

    /**
     * Make a JSON PUT API request with the tenant header included.
     */
    protected function apiPut(string $uri, array $data = [], array $headers = []): \Illuminate\Testing\TestResponse
    {
        return $this->putJson('/api' . $uri, $data, $this->withTenantHeader($headers));
    }

    /**
     * Make a JSON DELETE API request with the tenant header included.
     */
    protected function apiDelete(string $uri, array $data = [], array $headers = []): \Illuminate\Testing\TestResponse
    {
        return $this->deleteJson('/api' . $uri, $data, $this->withTenantHeader($headers));
    }

    /**
     * Tear down the test environment.
     *
     * Calls Mockery::close() to reset the Mockery container after each test class.
     * Without this, Mockery accumulates generated mock class definitions across test
     * classes and throws "Cannot redeclare" fatal errors when the same class is mocked
     * by more than one test file in the same PHP process.
     */
    protected function tearDown(): void
    {
        parent::tearDown();
        \Mockery::close();
    }
}
