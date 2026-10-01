<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\Enterprise\GdprService;
use App\Services\SafeguardingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * F-488 (E-075 H-1) — the Article 15 data export handed a safeguarding reporter
 * the investigators' record that the API deliberately withholds from them.
 *
 * `SafeguardingService::REPORTER_VIEW_FIELDS` is the platform's single statement
 * of what the person who filed a concern may see of it, and its comment says in
 * terms that the investigators' record — `action_taken`, `resolution_notes` and
 * the rest — is never part of the reporter view. `VolunteerWellbeingController`
 * applies it to every non-administrator read (the F-159 fix).
 *
 * `GdprService`'s volunteer export selected `action_taken` and `resolution_notes`
 * straight out of `vol_safeguarding_incidents WHERE reported_by = ?`, so the ZIP
 * handed to the requesting member carried staff conclusions about a THIRD PARTY
 * — the subject of their concern. The neighbouring export block for incidents
 * where the member is the subject already withholds correctly, per Art. 15(4).
 *
 * These tests assert the CORRECT behaviour: the export must not exceed the
 * reporter view, while the reporter's own narrative and the investigator's own
 * read are both untouched.
 *
 * Every string here is synthetic. No member data is used.
 */
final class F488ExportWithholdsInvestigatorsRecordFromReporterTest extends TestCase
{
    use DatabaseTransactions;

    private const ACTION_TAKEN_SECRET = 'F488-ACTION-SUBJECT-SUSPENDED-PENDING-REFERRAL';
    private const RESOLUTION_SECRET   = 'F488-RESOLUTION-REFERRED-TO-STATUTORY-AUTHORITY-REF-0000';
    private const REPORTER_OWN_TEXT   = 'F488 synthetic concern narrative written by the reporter themselves.';

    private string $exportRoot = '';
    private ?string $previousStoragePath = null;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        // Redirect every file GdprService writes (getStoragePath() reads
        // STORAGE_PATH) into a temporary directory, so no export artefact is
        // written into the repository tree.
        $env = getenv('STORAGE_PATH');
        $this->previousStoragePath = $env === false ? null : $env;
        $this->exportRoot = sys_get_temp_dir() . '/f488-export-' . bin2hex(random_bytes(6));
        @mkdir($this->exportRoot, 0755, true);
        putenv('STORAGE_PATH=' . $this->exportRoot);
    }

    protected function tearDown(): void
    {
        if ($this->previousStoragePath === null) {
            putenv('STORAGE_PATH');
        } else {
            putenv('STORAGE_PATH=' . $this->previousStoragePath);
        }
        if ($this->exportRoot !== '' && is_dir($this->exportRoot)) {
            $this->removeTree($this->exportRoot);
        }
        parent::tearDown();
    }

    /**
     * THE FIX — the Article 15 export must not carry the two investigator-only
     * columns, and must not carry any field outside the reporter whitelist.
     */
    public function test_the_article_15_export_withholds_the_investigators_record(): void
    {
        [$reporter, , $incidentId] = $this->incidentUnderInvestigation();

        $json = $this->exportJsonFor((int) $reporter->id);
        $row = $this->exportedIncidentRow($json, $incidentId);

        // CONTROL (the member still receives what they ARE entitled to) — their
        // own narrative is legitimately exported. The section is not deleted.
        self::assertSame(
            self::REPORTER_OWN_TEXT,
            (string) ($row['description'] ?? ''),
            'control: the reporter\'s own description is still exported'
        );
        self::assertSame($incidentId, (int) ($row['id'] ?? 0), 'control: the incident identifier survives');
        self::assertArrayHasKey('status', $row, 'control: the state of their own concern survives');
        self::assertArrayHasKey('severity', $row, 'control: the severity of their own concern survives');
        self::assertArrayHasKey('created_at', $row, 'control: the date of their own concern survives');

        // THE FIX — neither staff field may appear.
        self::assertArrayNotHasKey(
            'action_taken',
            $row,
            'the staff action-taken note must not be in the reporter\'s export'
        );
        self::assertArrayNotHasKey(
            'resolution_notes',
            $row,
            'the staff resolution note must not be in the reporter\'s export'
        );

        // Nothing outside the single shared whitelist may be exported either, so
        // a later column added to the table cannot quietly leak the same way.
        $outsideWhitelist = array_diff(array_keys($row), SafeguardingService::REPORTER_VIEW_FIELDS);
        self::assertSame(
            [],
            array_values($outsideWhitelist),
            'the exported incident must stay inside SafeguardingService::REPORTER_VIEW_FIELDS'
        );

        // And the staff strings must be absent from the artefact itself, not
        // merely from one decoded branch of it.
        $encoded = (string) json_encode($json);
        self::assertStringNotContainsString(
            self::ACTION_TAKEN_SECRET,
            $encoded,
            'the staff action-taken note must not appear anywhere in the exported document'
        );
        self::assertStringNotContainsString(
            self::RESOLUTION_SECRET,
            $encoded,
            'the staff resolution note must not appear anywhere in the exported document'
        );
    }

    /**
     * CONTROL (legitimate access, same fields, same file) — the investigator
     * reading the same incident still gets both fields, so the fix withholds
     * them from the reporter rather than deleting them; and the API reporter
     * view (the F-159 fix) still behaves exactly as before.
     */
    public function test_the_investigator_still_reads_both_fields_and_the_reporter_view_still_drops_them(): void
    {
        [, , $incidentId] = $this->incidentUnderInvestigation();

        $service = app(SafeguardingService::class);
        $full = $service->getIncident($incidentId, $this->testTenantId);
        self::assertIsArray($full, 'precondition: the incident reads back');

        // CONTROL (rightful reader) — the staff record still exists and is
        // still readable by an investigator.
        self::assertSame(
            self::ACTION_TAKEN_SECRET,
            (string) ($full['action_taken'] ?? ''),
            'control: the investigator record still holds the action taken'
        );
        self::assertSame(
            self::RESOLUTION_SECRET,
            (string) ($full['resolution_notes'] ?? ''),
            'control: the investigator record still holds the resolution notes'
        );

        // CONTROL (the surface F-159 fixed) — unchanged.
        $reporterView = $service->toReporterView($full);
        self::assertArrayHasKey('description', $reporterView, 'control: the reporter still sees their own narrative');
        self::assertArrayNotHasKey('action_taken', $reporterView, 'control: the whitelist still drops action_taken');
        self::assertArrayNotHasKey('resolution_notes', $reporterView, 'control: the whitelist still drops resolution_notes');
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /**
     * A real incident reported by one member about another, then updated by an
     * administrator through the production service method.
     *
     * @return array{0: User, 1: User, 2: int}
     */
    private function incidentUnderInvestigation(): array
    {
        $service = app(SafeguardingService::class);

        $reporter = $this->member();
        $subject  = $this->member();
        $admin    = $this->admin();

        $created = $service->reportIncident((int) $reporter->id, [
            'title'           => 'F488 synthetic concern',
            'description'     => self::REPORTER_OWN_TEXT,
            'severity'        => 'high',
            'incident_type'   => 'allegation',
            'subject_user_id' => (int) $subject->id,
        ], $this->testTenantId);

        self::assertIsArray($created, 'precondition: the incident was created');
        $incidentId = (int) ($created['id'] ?? 0);
        self::assertGreaterThan(0, $incidentId, 'precondition: the incident has an id');

        $updated = $service->updateIncident($incidentId, [
            'status'           => 'investigating',
            'action_taken'     => self::ACTION_TAKEN_SECRET,
            'resolution_notes' => self::RESOLUTION_SECRET,
        ], (int) $admin->id, $this->testTenantId);
        self::assertTrue($updated, 'precondition: the administrator recorded the investigation');

        return [$reporter, $subject, $incidentId];
    }

    /**
     * @param  array<string,mixed>  $json
     * @return array<string,mixed>
     */
    private function exportedIncidentRow(array $json, int $incidentId): array
    {
        $section = $json['volunteer_detailed']['safeguarding_incidents'] ?? null;
        self::assertIsArray($section, 'precondition: the export carries the volunteer safeguarding section');

        foreach ($section as $candidate) {
            if (is_array($candidate) && (int) ($candidate['id'] ?? 0) === $incidentId) {
                return $candidate;
            }
        }

        self::fail('precondition: the reporter\'s own incident is in the export');
    }

    /** @return array<string,mixed> */
    private function exportJsonFor(int $userId): array
    {
        $zipPath = (new GdprService($this->testTenantId))->generateDataExport($userId);
        self::assertFileExists($zipPath, 'precondition: an export archive was produced');

        $zip = new \ZipArchive();
        self::assertTrue($zip->open($zipPath) === true, 'precondition: the archive opens');
        $raw = $zip->getFromName('data.json');
        $zip->close();

        self::assertIsString($raw, 'precondition: data.json is in the archive');
        $decoded = json_decode($raw, true);
        self::assertIsArray($decoded, 'precondition: data.json decodes');

        return $decoded;
    }

    private function member(): User
    {
        return $this->account([]);
    }

    private function admin(): User
    {
        return $this->account(['role' => 'admin', 'is_admin' => 1]);
    }

    /** @param array<string,mixed> $flags */
    private function account(array $flags): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => 1, 'role' => 'member',
        ]);
        DB::table('users')->where('id', $u->id)->update(array_merge([
            'role' => 'member',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
            'status' => 'active',
        ], $flags));

        return User::withoutGlobalScopes()->find($u->id);
    }

    private function removeTree(string $dir): void
    {
        foreach (scandir($dir) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $path = $dir . '/' . $entry;
            is_dir($path) ? $this->removeTree($path) : @unlink($path);
        }
        @rmdir($dir);
    }
}
