<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Commands;

use App\Models\User;
use App\Services\LegacyVettingEvidenceManager;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\Laravel\TestCase;

class ManageLegacyVettingEvidenceCommandTest extends TestCase
{
    use DatabaseTransactions;

    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = sys_get_temp_dir()
            . DIRECTORY_SEPARATOR . 'nexus-vetting-command-' . bin2hex(random_bytes(8))
            . DIRECTORY_SEPARATOR . 'vetting' . DIRECTORY_SEPARATOR . 'documents';
        mkdir($this->root, 0700, true);
        file_put_contents($this->root . DIRECTORY_SEPARATOR . 'synthetic.pdf', 'synthetic');
        $this->app->instance(
            LegacyVettingEvidenceManager::class,
            new LegacyVettingEvidenceManager(['test_root' => $this->root]),
        );
    }

    protected function tearDown(): void
    {
        $base = dirname(dirname($this->root));
        if (is_dir($base)) {
            $iterator = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($base, \RecursiveDirectoryIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::CHILD_FIRST,
            );
            foreach ($iterator as $item) {
                $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
            }
            @rmdir($base);
        }
        parent::tearDown();
    }

    public function test_default_command_is_inventory_only(): void
    {
        $exit = Artisan::call('safeguarding:legacy-vetting-evidence');

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('INVENTORY mode', Artisan::output());
        $this->assertFileExists($this->root . DIRECTORY_SEPARATOR . 'synthetic.pdf');
    }

    public function test_delete_is_rejected_without_every_dpo_safety_flag(): void
    {
        $exit = Artisan::call('safeguarding:legacy-vetting-evidence', [
            '--delete' => true,
            '--all-tenants' => true,
            '--actor' => 'Automated test operator', // F-409: a destructive run must name its operator
            '--dpo-authorisation' => 'DPO-TEST-1',
            // Exact --confirm phrase deliberately omitted.
        ]);

        $this->assertSame(2, $exit);
        $this->assertStringContainsString('--confirm must exactly equal', Artisan::output());
        $this->assertFileExists($this->root . DIRECTORY_SEPARATOR . 'synthetic.pdf');
    }

    public function test_inventory_reports_prohibited_legacy_metadata_without_changing_it(): void
    {
        $recordId = $this->seedSensitiveLegacyRecord();

        $this->artisan('safeguarding:legacy-vetting-evidence', [
            '--tenant' => (string) $this->testTenantId,
        ])->expectsOutputToContain('legacy rows containing prohibited metadata')
            ->assertExitCode(0);
        $this->assertSame(
            'CERTIFICATE-REFERENCE-MUST-BE-REMOVED',
            DB::table('vetting_records')->where('id', $recordId)->value('reference_number'),
        );
        $this->assertSame(
            'Evidence-derived broker note must be removed',
            DB::table('vetting_records')->where('id', $recordId)->value('notes'),
        );
    }

    public function test_authorised_cleanup_redacts_prohibited_metadata_but_preserves_decision_audit(): void
    {
        $recordId = $this->seedSensitiveLegacyRecord();

        $this->artisan('safeguarding:legacy-vetting-evidence', [
            '--tenant' => (string) $this->testTenantId,
            '--delete' => true,
            '--actor' => 'Automated test operator', // F-409: a destructive run must name its operator
            '--dpo-authorisation' => 'DPO-TEST-METADATA',
            '--confirm' => 'DELETE-LEGACY-VETTING-EVIDENCE',
        ])->expectsOutputToContain('legacy rows with prohibited metadata redacted')
            ->assertExitCode(0);
        $record = DB::table('vetting_records')->where('id', $recordId)->first();
        $this->assertNotNull($record);
        $this->assertSame('dbs_enhanced', $record->vetting_type);
        $this->assertSame('verified', $record->status);
        $this->assertNotNull($record->verified_by);
        $this->assertNotNull($record->verified_at);
        $this->assertNull($record->reference_number);
        $this->assertNull($record->issue_date);
        $this->assertNull($record->expiry_date);
        $this->assertNull($record->notes);
        $this->assertNull($record->rejection_reason);
        $this->assertSame(0, (int) $record->works_with_children);
        $this->assertSame(0, (int) $record->works_with_vulnerable_adults);
        $this->assertSame(0, (int) $record->requires_enhanced_check);
        $this->assertSame(1, (int) $record->legacy_sensitive_metadata_redacted);

        $rerunExit = Artisan::call('safeguarding:legacy-vetting-evidence', [
            '--tenant' => (string) $this->testTenantId,
            '--delete' => true,
            '--actor' => 'Automated test operator', // F-409: a destructive run must name its operator
            '--dpo-authorisation' => 'DPO-TEST-METADATA-RERUN',
            '--confirm' => 'DELETE-LEGACY-VETTING-EVIDENCE',
        ]);

        $this->assertSame(0, $rerunExit, Artisan::output());
        $this->assertSame(
            1,
            (int) DB::table('vetting_records')
                ->where('id', $recordId)
                ->value('legacy_sensitive_metadata_redacted'),
        );
    }

    public function test_automated_cleanup_deletes_only_explicit_vetting_aliases_and_leaves_unknown_types_for_review(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Storage::fake('local');
        $unknownPath = 'volunteer-credentials/' . $this->testTenantId . '/custom-community-badge.pdf';
        Storage::disk('local')->put($unknownPath, 'synthetic');
        $prohibitedId = (int) DB::table('vol_credentials')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'credential_type' => ' DBS_ENHANCED ',
            'file_url' => null,
            'file_name' => null,
            'status' => 'verified',
            'notes' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $unknownId = (int) DB::table('vol_credentials')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'credential_type' => 'custom_community_badge',
            'file_url' => 'private:' . $unknownPath,
            'file_name' => 'custom-community-badge.pdf',
            'status' => 'verified',
            'notes' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->artisan('safeguarding:legacy-vetting-evidence', [
            '--tenant' => (string) $this->testTenantId,
            '--delete' => true,
            '--actor' => 'Automated test operator', // F-409: a destructive run must name its operator
            '--dpo-authorisation' => 'DPO-TEST-EXACT-CREDENTIAL-TYPES',
            '--confirm' => 'DELETE-LEGACY-VETTING-EVIDENCE',
        ])->expectsOutputToContain('unknown volunteering credential rows requiring manual review')
            ->assertExitCode(0);
        $this->assertDatabaseMissing('vol_credentials', ['id' => $prohibitedId]);
        $this->assertDatabaseHas('vol_credentials', [
            'id' => $unknownId,
            'credential_type' => 'custom_community_badge',
        ]);
        Storage::disk('local')->assertExists($unknownPath);
    }

    public function test_authorised_cleanup_removes_an_allowed_type_tombstone_after_file_is_absent(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $credentialId = (int) DB::table('vol_credentials')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'credential_type' => 'first_aid',
            'file_url' => null,
            'file_name' => null,
            'status' => 'rejected',
            'notes' => LegacyVettingEvidenceManager::GDPR_CLEANUP_PENDING_MARKER,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $exit = Artisan::call('safeguarding:legacy-vetting-evidence', [
            '--tenant' => (string) $this->testTenantId,
            '--delete' => true,
            '--actor' => 'Automated test operator', // F-409: a destructive run must name its operator
            '--dpo-authorisation' => 'DPO-TEST-TOMBSTONE',
            '--confirm' => 'DELETE-LEGACY-VETTING-EVIDENCE',
        ]);

        $this->assertSame(0, $exit, Artisan::output());
        $this->assertDatabaseMissing('vol_credentials', ['id' => $credentialId]);
    }

    private function seedSensitiveLegacyRecord(): int
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $broker = User::factory()->forTenant($this->testTenantId)->create();
        $confirmedAt = now()->subDay()->startOfSecond();

        return (int) DB::table('vetting_records')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'vetting_type' => 'dbs_enhanced',
            'status' => 'verified',
            'reference_number' => 'CERTIFICATE-REFERENCE-MUST-BE-REMOVED',
            'issue_date' => now()->subYear()->toDateString(),
            'expiry_date' => now()->addYear()->toDateString(),
            'verified_by' => $broker->id,
            'verified_at' => $confirmedAt,
            'document_url' => null,
            'notes' => 'Evidence-derived broker note must be removed',
            'works_with_children' => 1,
            'works_with_vulnerable_adults' => 1,
            'requires_enhanced_check' => 1,
            'rejected_by' => null,
            'rejected_at' => null,
            'rejection_reason' => 'Evidence-derived result must be removed',
            'created_at' => $confirmedAt,
            'updated_at' => $confirmedAt,
            'deleted_at' => null,
        ]);
    }
}
