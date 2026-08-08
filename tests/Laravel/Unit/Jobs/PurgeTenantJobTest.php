<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Jobs;

use App\Core\SuperPanelAccess;
use App\Jobs\PurgeTenantJob;
use App\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

/**
 * PurgeTenantJob is the queued wrapper around TenantPurgeService — the single
 * most destructive code path in the platform (it deletes every row a tenant owns
 * across ~600 tables, its members, and its Stripe/Meilisearch/Redis/upload
 * state). {@see \Tests\Laravel\Feature\TenantProvisioning\TenantPurgeTest} covers
 * the service's own guards; this class covers the three things that only the job
 * can get wrong:
 *
 *   1. It must run the REAL purge (dry_run false) on the tenant it was given, and
 *      no other. A wrong id here destroys the wrong community.
 *   2. It must re-check the destructive guards at EXECUTION time, not trust the
 *      controller's synchronous pre-checks. Those checks run when the god-admin
 *      presses the button; the job runs later, and the tenant can be reactivated
 *      in between.
 *   3. It must never let a failure escape. $tries = 1 plus a swallowing catch is
 *      deliberate: a half-finished purge that auto-retries would re-hit Stripe
 *      and re-log, and a thrown exception would park the job in failed_jobs where
 *      a later queue:retry could fire it against a since-recreated tenant id.
 */
class PurgeTenantJobTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        // SuperAdminAuditService resolves the acting super-admin through
        // SuperPanelAccess, which memoises it in a static for the life of the
        // process. PHPUnit shares one process per shard, so an earlier class can
        // leak an actor into the audit row this purge writes.
        SuperPanelAccess::reset();
    }

    protected function tearDown(): void
    {
        SuperPanelAccess::reset();
        parent::tearDown();
    }

    /**
     * Insert a throwaway tenant. Parented under the always-present test tenant
     * (id 2) because fk_tenant_parent needs a real parent and the test database
     * has no Master tenant (id 1).
     */
    private function makeTenant(bool $active, ?int $parentId = null): int
    {
        $slug = 'purgejob-' . substr(md5(uniqid('', true)), 0, 10);

        return (int) DB::table('tenants')->insertGetId([
            'name'       => 'Purge Job Test ' . $slug,
            'slug'       => $slug,
            'parent_id'  => $parentId ?? $this->testTenantId,
            'is_active'  => $active ? 1 : 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ── Configuration ────────────────────────────────────────────────────────

    /**
     * A purge must never auto-retry. It is idempotent, but a retry re-cancels
     * Stripe subscriptions and re-writes the irreversible audit entry, and the
     * second run reports "0 rows" — which reads as "nothing was there".
     */
    public function test_the_job_never_auto_retries(): void
    {
        $this->assertSame(1, (new PurgeTenantJob(123))->tries);
    }

    /**
     * 30 minutes. Large tenants have millions of rows; a shorter timeout kills
     * the worker mid-purge and leaves the tenant half-deleted.
     */
    public function test_the_job_allows_thirty_minutes(): void
    {
        $this->assertSame(1800, (new PurgeTenantJob(123))->timeout);
    }

    /**
     * The whole reason this job exists is that the work must NOT happen inside
     * the god-admin's HTTP request — a synchronous purge would time out the
     * request and leave the operator with no idea whether it completed.
     */
    public function test_the_job_is_queued_not_run_inline(): void
    {
        $this->assertInstanceOf(ShouldQueue::class, new PurgeTenantJob(123));
    }

    public function test_the_job_carries_the_tenant_id_it_was_constructed_with(): void
    {
        $this->assertSame(4242, (new PurgeTenantJob(4242))->tenantId);
    }

    // ── The real purge ───────────────────────────────────────────────────────

    /**
     * The happy path, end to end: the job runs a REAL purge (not a dry run) on
     * the tenant it was given. A dry run here would silently do nothing while
     * reporting success, and the god-admin would be told the community was gone.
     */
    public function test_handle_really_purges_the_tenant_it_was_given(): void
    {
        $tenantId = $this->makeTenant(active: false);

        DB::table('tenant_settings')->insert([
            'tenant_id'     => $tenantId,
            'setting_key'   => 'general.registration_mode',
            'setting_value' => 'open',
            'setting_type'  => 'string',
        ]);
        $member = User::factory()->create(['tenant_id' => $tenantId]);

        (new PurgeTenantJob($tenantId))->handle();

        $this->assertNull(
            DB::table('tenants')->where('id', $tenantId)->first(),
            'the tenant row must be gone — a dry run would leave it in place'
        );
        $this->assertSame(0, DB::table('tenant_settings')->where('tenant_id', $tenantId)->count());
        $this->assertNull(DB::table('users')->where('id', $member->id)->first());
    }

    /**
     * Blast-radius containment: purging one tenant must not touch its neighbour.
     * The service deletes by `WHERE tenant_id = ?` across ~600 tables, so a
     * scoping mistake would take the whole platform with it.
     */
    public function test_handle_leaves_a_neighbouring_tenant_completely_intact(): void
    {
        $doomed    = $this->makeTenant(active: false);
        $bystander = $this->makeTenant(active: false);

        $doomedMember    = User::factory()->create(['tenant_id' => $doomed]);
        $bystanderMember = User::factory()->create(['tenant_id' => $bystander]);
        DB::table('tenant_settings')->insert([
            ['tenant_id' => $doomed,    'setting_key' => 'general.registration_mode', 'setting_value' => 'open', 'setting_type' => 'string'],
            ['tenant_id' => $bystander, 'setting_key' => 'general.registration_mode', 'setting_value' => 'open', 'setting_type' => 'string'],
        ]);

        (new PurgeTenantJob($doomed))->handle();

        $this->assertNull(DB::table('users')->where('id', $doomedMember->id)->first());
        $this->assertNotNull(
            DB::table('tenants')->where('id', $bystander)->first(),
            'the neighbouring tenant must survive'
        );
        $this->assertNotNull(
            DB::table('users')->where('id', $bystanderMember->id)->first(),
            "the neighbouring tenant's members must survive"
        );
        $this->assertSame(1, DB::table('tenant_settings')->where('tenant_id', $bystander)->count());
    }

    // ── Guards re-checked at execution time ──────────────────────────────────

    /**
     * 🔴 The race the guard exists for. AdminSuperController checks "is this
     * tenant deactivated?" when the button is pressed, then enqueues. If someone
     * reactivates the community before the worker picks the job up, the job must
     * refuse — the operator's intent no longer matches reality.
     */
    public function test_handle_refuses_a_tenant_that_was_reactivated_after_being_queued(): void
    {
        $tenantId = $this->makeTenant(active: false);
        $member   = User::factory()->create(['tenant_id' => $tenantId]);

        // Between dispatch and execution, the community comes back.
        DB::table('tenants')->where('id', $tenantId)->update(['is_active' => 1]);

        (new PurgeTenantJob($tenantId))->handle();

        $this->assertNotNull(
            DB::table('tenants')->where('id', $tenantId)->first(),
            'a reactivated tenant must survive the queued purge'
        );
        $this->assertNotNull(
            DB::table('users')->where('id', $member->id)->first(),
            'a reactivated tenant keeps its members'
        );
    }

    /**
     * Same race, sub-tenants: a child community created after the button was
     * pressed must block the purge, because purging the parent would orphan it.
     */
    public function test_handle_refuses_a_tenant_that_gained_a_sub_tenant_after_being_queued(): void
    {
        $parentId = $this->makeTenant(active: false);
        $this->makeTenant(active: false, parentId: $parentId);

        (new PurgeTenantJob($parentId))->handle();

        $this->assertNotNull(
            DB::table('tenants')->where('id', $parentId)->first(),
            'a tenant with sub-tenants must survive the queued purge'
        );
    }

    /** The Master tenant can never be purged, however the job is invoked. */
    public function test_handle_refuses_the_master_tenant(): void
    {
        Log::spy();

        (new PurgeTenantJob(1))->handle();

        Log::shouldHaveReceived('error')
            ->withArgs(fn (string $message, array $context = []) => $message === 'PurgeTenantJob: purge refused'
                && ($context['tenant_id'] ?? null) === 1
                && str_contains(strtolower((string) ($context['error'] ?? '')), 'master'))
            ->once();
    }

    // ── Failure containment ──────────────────────────────────────────────────

    /**
     * A refusal is logged as an error and swallowed. It must NOT throw: throwing
     * would park the job in failed_jobs, and a later `queue:retry` could fire it
     * against a tenant id that has since been reused by a new community.
     */
    public function test_handle_logs_a_refusal_as_an_error_without_throwing(): void
    {
        Log::spy();

        // A tenant id that does not exist — the service refuses with "Tenant not found."
        (new PurgeTenantJob(2147483600))->handle();

        Log::shouldHaveReceived('error')
            ->withArgs(fn (string $message, array $context = []) => $message === 'PurgeTenantJob: purge refused'
                && ($context['tenant_id'] ?? null) === 2147483600)
            ->once();
    }

    /**
     * A completed purge is logged at WARNING with its row totals. This entry and
     * the super_admin_audit_log row are the only surviving evidence that a
     * community existed, so downgrading it to debug/info would make an
     * irreversible action effectively untraceable in the application log.
     */
    public function test_handle_records_a_completed_purge_at_warning_with_its_totals(): void
    {
        $tenantId = $this->makeTenant(active: false);
        User::factory()->create(['tenant_id' => $tenantId]);

        Log::spy();

        (new PurgeTenantJob($tenantId))->handle();

        Log::shouldHaveReceived('warning')
            ->withArgs(fn (string $message, array $context = []) => $message === 'PurgeTenantJob: tenant purged'
                && ($context['tenant_id'] ?? null) === $tenantId
                && is_array($context['totals'] ?? null))
            ->once();
    }

    /**
     * Structural guard, deliberately not behavioural: there is no way to make the
     * real TenantPurgeService throw from a test without breaking the schema, so
     * this pins the shape instead — handle() must keep its catch-all and must not
     * rethrow. Combined with $tries = 1 (above), that is what stops a partially
     * completed purge from being replayed by the queue.
     */
    public function test_handle_keeps_its_catch_all_and_never_rethrows(): void
    {
        $method = new \ReflectionMethod(PurgeTenantJob::class, 'handle');
        $source = implode('', array_slice(
            file($method->getFileName()),
            $method->getStartLine() - 1,
            $method->getEndLine() - $method->getStartLine() + 1
        ));

        $this->assertMatchesRegularExpression(
            '/catch\s*\(\s*Throwable/',
            $source,
            'handle() must catch Throwable — an escaping error fails the queue job'
        );
        $this->assertDoesNotMatchRegularExpression(
            '/\bthrow\b/',
            $source,
            'handle() must not rethrow: a failed purge job can be retried against a reused tenant id'
        );
    }
}
