<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Commands;

use App\Models\User;
use App\Services\LegacyVettingEvidenceManager;
use App\Services\SafeguardingJurisdictionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class MigrateLegacyVettingAttestationsCommandTest extends TestCase
{
    use DatabaseTransactions;

    private const COMMAND = 'safeguarding:migrate-legacy-vetting-attestations';
    private const ACKNOWLEDGEMENT = 'IMPORT-LEGACY-VETTING-DECISIONS';

    public function test_default_mode_is_a_dry_run_and_writes_nothing(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales((int) $admin->id);
        $this->seedTrustedLegacyDecision((int) $member->id, (int) $admin->id);

        $exit = Artisan::call(self::COMMAND, ['--tenant' => (string) $this->testTenantId]);

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('DRY-RUN mode', Artisan::output());
        $this->assertDatabaseMissing('member_vetting_attestations', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
        ]);
        $this->assertDatabaseMissing('safeguarding_vetting_review_requests', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
        ]);
    }

    public function test_apply_imports_only_metadata_and_is_idempotent(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales((int) $admin->id);
        $this->seedTrustedLegacyDecision((int) $member->id, (int) $admin->id);

        $arguments = [
            '--tenant' => (string) $this->testTenantId,
            '--apply' => true,
            '--acknowledge' => self::ACKNOWLEDGEMENT,
        ];
        $this->assertSame(0, Artisan::call(self::COMMAND, $arguments));
        $this->assertSame(0, Artisan::call(self::COMMAND, $arguments));

        $this->assertDatabaseHas('member_vetting_attestations', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'scheme_code' => 'dbs_england_wales',
            'attestation_code' => 'dbs_enhanced',
            'purpose_code' => 'safeguarded_member_contact',
            'decision' => 'confirmed',
            'confirmed_by' => $admin->id,
        ]);
        $this->assertDatabaseHas('member_vetting_attestation_events', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'event_type' => 'legacy_imported',
            'reason_code' => 'trusted_legacy_confirmation',
        ]);
        $this->assertSame(1, DB::table('member_vetting_attestations')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->count());
        $this->assertSame(1, DB::table('member_vetting_attestation_events')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->count());

        $columns = DB::getSchemaBuilder()->getColumnListing('member_vetting_attestations');
        foreach (['document_url', 'reference_number', 'issue_date', 'expiry_date', 'notes', 'result'] as $prohibited) {
            $this->assertNotContains($prohibited, $columns);
        }
    }

    public function test_ambiguous_legacy_row_creates_review_without_claiming_member_requested_it(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales((int) $admin->id);

        // Exact type/status but no matching per-record activity_log provenance.
        $this->seedLegacyRecord((int) $member->id, (int) $admin->id, [
            'vetting_type' => 'dbs_enhanced',
            'status' => 'verified',
        ]);

        $exit = Artisan::call(self::COMMAND, [
            '--tenant' => (string) $this->testTenantId,
            '--apply' => true,
            '--acknowledge' => self::ACKNOWLEDGEMENT,
        ]);

        $this->assertSame(0, $exit);
        $this->assertDatabaseMissing('member_vetting_attestations', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
        ]);
        $this->assertDatabaseHas('safeguarding_vetting_review_requests', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'status' => 'pending',
            'request_source' => 'legacy_migration',
            'requested_by' => null,
        ]);

        Artisan::call(self::COMMAND, [
            '--tenant' => (string) $this->testTenantId,
            '--apply' => true,
            '--acknowledge' => self::ACKNOWLEDGEMENT,
        ]);
        $this->assertSame(1, DB::table('safeguarding_vetting_review_requests')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->count());
    }

    public function test_unconfigured_or_non_england_wales_tenant_is_never_inferred_from_country(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        DB::table('tenant_safeguarding_settings')->where('tenant_id', $this->testTenantId)->delete();
        app(SafeguardingJurisdictionService::class)->forget($this->testTenantId);
        $this->seedTrustedLegacyDecision((int) $member->id, (int) $admin->id);

        $exit = Artisan::call(self::COMMAND, [
            '--tenant' => (string) $this->testTenantId,
            '--apply' => true,
            '--acknowledge' => self::ACKNOWLEDGEMENT,
        ]);

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('No explicitly configured England and Wales tenant', Artisan::output());
        $this->assertDatabaseMissing('member_vetting_attestations', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
        ]);
        $this->assertDatabaseMissing('safeguarding_vetting_review_requests', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
        ]);
    }

    public function test_apply_requires_explicit_scope_and_acknowledgement(): void
    {
        $exit = Artisan::call(self::COMMAND, ['--apply' => true]);

        $this->assertSame(2, $exit);
        $this->assertStringContainsString('--apply requires either --tenant=<id> or --all-tenants', Artisan::output());

        $exit = Artisan::call(self::COMMAND, [
            '--tenant' => (string) $this->testTenantId,
            '--apply' => true,
        ]);

        $this->assertSame(2, $exit);
        $this->assertStringContainsString('--acknowledge=' . self::ACKNOWLEDGEMENT, Artisan::output());
    }

    public function test_suspended_legacy_verifier_routes_member_to_review(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales((int) $admin->id);
        $this->seedTrustedLegacyDecision((int) $member->id, (int) $admin->id);
        $admin->forceFill(['status' => 'suspended'])->save();

        $exit = Artisan::call(self::COMMAND, [
            '--tenant' => (string) $this->testTenantId,
            '--apply' => true,
            '--acknowledge' => self::ACKNOWLEDGEMENT,
        ]);

        $this->assertSame(0, $exit, Artisan::output());
        $this->assertDatabaseMissing('member_vetting_attestations', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
        ]);
        $this->assertDatabaseHas('safeguarding_vetting_review_requests', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'status' => 'pending',
            'request_source' => 'legacy_migration',
        ]);
    }

    public function test_cleanup_marker_prevents_a_date_bearing_legacy_row_becoming_import_eligible(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales((int) $admin->id);
        $recordId = $this->seedLegacyRecord((int) $member->id, (int) $admin->id, [
            'expiry_date' => now()->addYear()->toDateString(),
            'document_url' => null,
        ]);
        $verifiedAt = DB::table('vetting_records')->where('id', $recordId)->value('verified_at');
        DB::table('activity_log')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $admin->id,
            'action' => 'vetting_record_verified',
            'details' => 'Test provenance',
            'is_public' => 0,
            'action_type' => 'admin',
            'entity_type' => 'vetting_record',
            'entity_id' => $recordId,
            'created_at' => $verifiedAt,
        ]);

        $base = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'nexus-vetting-import-' . bin2hex(random_bytes(8));
        $root = $base . DIRECTORY_SEPARATOR . 'vetting' . DIRECTORY_SEPARATOR . 'documents';
        mkdir($root, 0700, true);
        $this->app->instance(
            LegacyVettingEvidenceManager::class,
            new LegacyVettingEvidenceManager(['test_root' => $root]),
        );

        try {
            $cleanupArguments = [
                '--tenant' => (string) $this->testTenantId,
                '--delete' => true,
                '--actor' => 'Automated test operator', // F-409: a destructive run must name its operator
                '--dpo-authorisation' => 'DPO-TEST-CLEANUP-IMPORT',
                '--confirm' => 'DELETE-LEGACY-VETTING-EVIDENCE',
            ];
            $importArguments = [
                '--tenant' => (string) $this->testTenantId,
                '--apply' => true,
                '--acknowledge' => self::ACKNOWLEDGEMENT,
            ];

            $this->assertSame(0, Artisan::call('safeguarding:legacy-vetting-evidence', $cleanupArguments), Artisan::output());
            $this->assertDatabaseHas('vetting_records', [
                'id' => $recordId,
                'expiry_date' => null,
                LegacyVettingEvidenceManager::LEGACY_REDACTION_MARKER_COLUMN => 1,
            ]);

            $this->assertSame(0, Artisan::call(self::COMMAND, $importArguments), Artisan::output());
            $this->assertDatabaseMissing('member_vetting_attestations', [
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
            ]);
            $this->assertDatabaseHas('safeguarding_vetting_review_requests', [
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
                'status' => 'pending',
                'request_source' => 'legacy_migration',
            ]);

            $this->assertSame(0, Artisan::call('safeguarding:legacy-vetting-evidence', $cleanupArguments), Artisan::output());
            $this->assertSame(0, Artisan::call(self::COMMAND, $importArguments), Artisan::output());
            $this->assertSame(1, (int) DB::table('vetting_records')
                ->where('id', $recordId)
                ->value(LegacyVettingEvidenceManager::LEGACY_REDACTION_MARKER_COLUMN));
            $this->assertSame(1, DB::table('safeguarding_vetting_review_requests')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $member->id)
                ->count());
            $this->assertDatabaseMissing('member_vetting_attestations', [
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
            ]);
        } finally {
            @rmdir($root);
            @rmdir(dirname($root));
            @rmdir($base);
        }
    }

    private function configureEnglandAndWales(int $adminId): void
    {
        DB::table('tenant_safeguarding_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'jurisdiction' => 'england_wales',
                'policy_version' => 'test-policy-v1',
                'configured_by' => $adminId,
                'configured_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        app(SafeguardingJurisdictionService::class)->forget($this->testTenantId);
    }

    private function seedTrustedLegacyDecision(int $memberId, int $adminId): int
    {
        $recordId = $this->seedLegacyRecord($memberId, $adminId, [
            'vetting_type' => 'dbs_enhanced',
            'status' => 'verified',
            'expiry_date' => null,
        ]);
        $verifiedAt = DB::table('vetting_records')->where('id', $recordId)->value('verified_at');

        DB::table('activity_log')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $adminId,
            'action' => 'vetting_record_verified',
            'details' => 'Test provenance',
            'is_public' => 0,
            'action_type' => 'admin',
            'entity_type' => 'vetting_record',
            'entity_id' => $recordId,
            'created_at' => $verifiedAt,
        ]);

        return $recordId;
    }

    /** @param array<string, mixed> $overrides */
    private function seedLegacyRecord(int $memberId, int $adminId, array $overrides = []): int
    {
        $verifiedAt = now()->subDay()->startOfSecond();

        return DB::table('vetting_records')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $memberId,
            'vetting_type' => 'dbs_enhanced',
            'status' => 'verified',
            'reference_number' => 'MUST-NOT-MIGRATE-123',
            'issue_date' => now()->subYear()->toDateString(),
            'expiry_date' => null,
            'verified_by' => $adminId,
            'verified_at' => $verifiedAt,
            'document_url' => '/uploads/tenants/hour-timebank/vetting/documents/must-not-migrate.pdf',
            'notes' => 'MUST NOT MIGRATE',
            'works_with_children' => 1,
            'works_with_vulnerable_adults' => 1,
            'requires_enhanced_check' => 1,
            'created_at' => $verifiedAt,
            'updated_at' => $verifiedAt,
            'deleted_at' => null,
        ], $overrides));
    }
}
