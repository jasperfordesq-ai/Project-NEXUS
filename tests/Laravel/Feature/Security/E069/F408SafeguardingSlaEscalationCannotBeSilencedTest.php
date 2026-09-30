<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Core\TenantContext;
use App\Services\CaringCommunity\SafeguardingService;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-408 — automatic safeguarding SLA escalation must not be silenceable by a
 * community administrator.
 *
 * `SafeguardingSlaEscalateCommand` enumerated `tenants` filtered by
 * `is_active = 1` and then skipped any community without the `caring_community`
 * feature. Both switches are reachable by an ordinary community administrator
 * (`PUT /v2/admin/config/features` → `AdminConfigController::updateFeature()`,
 * which calls `requireAdmin()`, not `requireSuperAdmin()`), so a concern that
 * was ALREADY OPEN and already past its review deadline stopped being escalated
 * — no bell, no email, no audit action — and the toggle itself wrote no admin
 * audit entry.
 *
 * Correct behaviour, asserted here:
 *   1. an overdue open concern is escalated and audited (the baseline);
 *   2. it is STILL escalated and audited when `caring_community` is off;
 *   3. it is STILL escalated when the community is marked inactive;
 *   4. changing any tenant feature writes an admin audit row naming the feature.
 */
final class F408SafeguardingSlaEscalationCannotBeSilencedTest extends TestCase
{
    use DatabaseTransactions;

    private int $tenantId = 0;
    private int $reporterId = 0;
    private int $subjectId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'F408 Community',
            'slug' => 'f408-' . bin2hex(random_bytes(4)),
            'is_active' => 1,
            'features' => json_encode(['caring_community' => true]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->reporterId = $this->makeMember('reporter');
        $this->subjectId = $this->makeMember('subject');

        TenantContext::setById($this->tenantId);
    }

    protected function tearDown(): void
    {
        TenantContext::reset();
        parent::tearDown();
    }

    private function makeMember(string $label): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->tenantId,
            'email' => 'f408-' . $label . '-' . bin2hex(random_bytes(5)) . '@example.invalid',
            'password' => password_hash('not-a-real-password-' . bin2hex(random_bytes(8)), PASSWORD_BCRYPT),
            'first_name' => 'F408',
            'last_name' => ucfirst($label),
            'name' => 'F408 ' . ucfirst($label),
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** A real concern submitted through the member-facing service, then aged past its SLA. */
    private function openOverdueConcern(): int
    {
        $result = app(SafeguardingService::class)->submitReport($this->reporterId, [
            'category' => 'inappropriate_behavior',
            'severity' => 'high',
            'description' => 'F-408 regression fixture: an open concern past its review deadline.',
            'subject_user_id' => $this->subjectId,
        ]);

        $reportId = (int) $result['report_id'];

        // The only thing done to it afterwards is the passage of time.
        DB::table('safeguarding_reports')
            ->where('id', $reportId)
            ->update(['review_due_at' => now()->subHours(2)]);

        return $reportId;
    }

    private function escalatedFlag(int $reportId): int
    {
        return (int) DB::table('safeguarding_reports')->where('id', $reportId)->value('escalated');
    }

    private function escalationAuditRows(int $reportId): int
    {
        return (int) DB::table('safeguarding_report_actions')
            ->where('report_id', $reportId)
            ->where('action', 'escalated')
            ->count();
    }

    private function runSlaCommand(): void
    {
        $this->artisan('safeguarding:sla-escalate')->assertExitCode(0);
    }

    /** The exact write AdminConfigController::updateFeature() performs. */
    private function setCaringCommunity(bool $enabled): void
    {
        DB::table('tenants')
            ->where('id', $this->tenantId)
            ->update(['features' => json_encode(['caring_community' => $enabled])]);
        TenantContext::reset();
    }

    /** BASELINE — with the module on and the community active, the breach is escalated. */
    public function test_an_overdue_concern_is_escalated_and_audited(): void
    {
        $reportId = $this->openOverdueConcern();
        $this->assertSame(0, $this->escalatedFlag($reportId), 'precondition: not yet escalated');

        $this->runSlaCommand();

        $this->assertSame(1, $this->escalatedFlag($reportId), 'the SLA sweep escalates an overdue open concern');
        $this->assertGreaterThan(0, $this->escalationAuditRows($reportId), 'the escalation writes its audit action');
    }

    /**
     * F-408 — the SAME overdue concern, differing only in the community's
     * `caring_community` feature flag, must still be escalated. Turning a
     * module off is not a way to stop safeguarding concerns that are already
     * open from breaching visibly.
     */
    public function test_turning_caring_community_off_does_not_silence_an_already_open_concern(): void
    {
        $reportId = $this->openOverdueConcern();

        $this->setCaringCommunity(false);

        $this->runSlaCommand();

        $this->assertSame(
            1,
            $this->escalatedFlag($reportId),
            'an overdue safeguarding concern is escalated even with the caring_community module off',
        );
        $this->assertGreaterThan(
            0,
            $this->escalationAuditRows($reportId),
            'the escalation audit action is written even with the module off',
        );
    }

    /**
     * F-408, second trigger — marking the community inactive had the same
     * effect, because the tenant list was filtered on `is_active = 1`.
     */
    public function test_an_inactive_community_still_escalates_an_open_overdue_concern(): void
    {
        $reportId = $this->openOverdueConcern();

        DB::table('tenants')->where('id', $this->tenantId)->update(['is_active' => 0]);
        TenantContext::reset();

        $this->runSlaCommand();

        $this->assertSame(
            1,
            $this->escalatedFlag($reportId),
            'an inactive community\'s overdue safeguarding concern is still escalated',
        );
        $this->assertGreaterThan(
            0,
            $this->escalationAuditRows($reportId),
            'and the escalation is recorded',
        );
    }

    /**
     * Both switches at once — deactivated AND the module off — is still not a
     * way to make an open, overdue concern go quiet.
     */
    public function test_an_inactive_community_with_the_module_off_still_escalates(): void
    {
        $reportId = $this->openOverdueConcern();

        DB::table('tenants')->where('id', $this->tenantId)->update([
            'is_active' => 0,
            'features' => json_encode(['caring_community' => false]),
        ]);
        TenantContext::reset();

        $this->runSlaCommand();

        $this->assertSame(1, $this->escalatedFlag($reportId), 'both switches together do not silence the sweep');
    }

    /**
     * F-408 — escalating inside a community whose module is off is itself
     * reported. The console counter this replaces was printed and discarded,
     * which is what let the suppression be silent. (The Sentry capture in the
     * same branch cannot run here — `sentry.dsn` is unset under test — so this
     * asserts the branch, not the delivery.)
     */
    public function test_escalating_with_the_module_off_is_reported_and_names_the_community(): void
    {
        $this->openOverdueConcern();
        $this->setCaringCommunity(false);

        // Only the tenant id is asserted: the rest of the line is rendered
        // through Symfony's error block, which hard-wraps at terminal width and
        // can split any longer phrase across a newline.
        $this->artisan('safeguarding:sla-escalate')
            ->expectsOutputToContain('Tenant ' . $this->tenantId . ':')
            ->assertExitCode(0);
    }

    /**
     * A concern that is resolved, dismissed or not yet due must NOT be
     * escalated — the sweep is still selective, it has simply stopped letting
     * tenant configuration decide.
     */
    public function test_a_concern_that_is_not_overdue_is_not_escalated(): void
    {
        $reportId = $this->openOverdueConcern();
        DB::table('safeguarding_reports')
            ->where('id', $reportId)
            ->update(['review_due_at' => now()->addDay()]);

        $this->setCaringCommunity(false);

        $this->runSlaCommand();

        $this->assertSame(0, $this->escalatedFlag($reportId), 'a concern inside its SLA window is left alone');
    }

    /**
     * F-408 — the off-switch itself must leave an admin audit entry. The audit
     * write was conditional on `biometric_login`, so switching a safeguarding
     * module off was invisible in the audit trail.
     */
    public function test_changing_a_tenant_feature_writes_an_admin_audit_entry(): void
    {
        // The standard test tenant, because this leg exercises the real HTTP
        // route and its tenant-resolution middleware.
        $admin = \App\Models\User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $admin->id,
            $admin->tenant_id,
            TwoFactorPolicy::claims('totp'),
        )]);

        $before = (int) DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $admin->id)
            ->count();

        $this->apiPut('/v2/admin/config/features', [
            'feature' => 'caring_community',
            'enabled' => false,
        ])->assertStatus(200);

        $rows = DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $admin->id)
            ->get();

        $this->assertGreaterThan($before, $rows->count(), 'switching a tenant feature is audited');

        $match = $rows->first(static function (object $row): bool {
            $details = json_decode((string) ($row->details ?? ''), true);

            return is_array($details) && ($details['feature'] ?? null) === 'caring_community';
        });

        $this->assertNotNull($match, 'the audit entry names the feature that was changed');
        $details = json_decode((string) $match->details, true);
        $this->assertFalse($details['enabled'], 'the audit entry records the new state');
    }
}
