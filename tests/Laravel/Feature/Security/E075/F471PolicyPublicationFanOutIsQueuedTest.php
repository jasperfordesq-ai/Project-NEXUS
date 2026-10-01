<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Jobs\RecordLegalPublicationDeliveries;
use App\Models\User;
use App\Services\LegalDocumentService;
use App\Services\LegalPublicationDeliveryService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * E-075 F-471 — publishing a policy must not write one row per member inside
 * the administrator's request and inside the publication transaction.
 *
 * `LegalPublicationDeliveryService::record()` fanned out to every active member
 * synchronously, reached from `LegalDocumentService::publishVersion()` inside a
 * transaction that holds `lockForUpdate()` on the version row (and from the
 * admin "notify again" action). Now only the first chunk is written there and
 * the remainder is queued; the every-minute send command resumes a fan-out
 * whose job was lost.
 *
 * These tests assert the CORRECT behaviour and fail before the fix. Controls in
 * the same file: a small community still gets every member written at
 * publication with nothing queued; and a recently published version that has
 * NO delivery row — a policy published before this feature existed — is never
 * picked up by the repair, so deploying this cannot start emailing about it.
 */
final class F471PolicyPublicationFanOutIsQueuedTest extends TestCase
{
    use DatabaseTransactions;

    /** Written as a literal so the harm test fails on the old code by behaviour, not by a missing constant. */
    private const CHUNK = 250;

    private int $tenantId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        $slug = 'e077-f471-' . bin2hex(random_bytes(4));
        $this->tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'E077 F471 ' . $slug,
            'slug' => $slug,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        TenantContext::setById($this->tenantId);
    }

    protected function tearDown(): void
    {
        TenantContext::reset();
        parent::tearDown();
    }

    public function test_publication_writes_only_the_first_chunk_and_queues_the_rest(): void
    {
        Queue::fake();
        $members = $this->members(self::CHUNK + 15);
        $versionId = $this->draft();

        $this->assertTrue(LegalDocumentService::publishVersion($versionId));

        $this->assertSame(
            self::CHUNK,
            $this->deliveryCount($versionId),
            'F-471: only the first chunk may be written inside the publication transaction.',
        );
        Queue::assertPushed(
            RecordLegalPublicationDeliveries::class,
            fn (RecordLegalPublicationDeliveries $job) => $job->tenantId === $this->tenantId
                && $job->versionId === $versionId,
        );

        // The queued job completes the ledger, in chunks, for every member.
        Queue::pushed(RecordLegalPublicationDeliveries::class)->first()->handle();
        $this->assertSame($members, $this->deliveryCount($versionId), 'the job reaches every eligible member');

        // And running it again changes nothing.
        Queue::pushed(RecordLegalPublicationDeliveries::class)->first()->handle();
        $this->assertSame($members, $this->deliveryCount($versionId), 'the fan-out is idempotent');
    }

    public function test_a_lost_fanout_job_is_resumed_by_the_scheduled_send(): void
    {
        Queue::fake(); // the job is never run: as if the queue lost it
        $members = $this->members(self::CHUNK + 15);
        $versionId = $this->draft();
        $this->assertTrue(LegalDocumentService::publishVersion($versionId));
        $this->assertSame(self::CHUNK, $this->deliveryCount($versionId));

        // The every-minute command; limit 0 so this run sends nothing.
        app(LegalPublicationDeliveryService::class)->processBatch(0);

        $this->assertSame(
            $members,
            $this->deliveryCount($versionId),
            'F-471: the scheduler must finish a fan-out whose background job was lost.',
        );
    }

    /** CONTROL — a small community is written in full at publication, nothing queued. */
    public function test_control_a_small_community_is_recorded_in_full_at_publication(): void
    {
        Queue::fake();
        $members = $this->members(3);
        $versionId = $this->draft();

        $this->assertTrue(LegalDocumentService::publishVersion($versionId));

        $this->assertSame($members, $this->deliveryCount($versionId));
        Queue::assertNotPushed(RecordLegalPublicationDeliveries::class);
    }

    /**
     * CONTROL — the repair never starts a fan-out on its own. A current version
     * published yesterday with no delivery row (a policy published before this
     * feature shipped) must stay that way.
     */
    public function test_control_repair_never_starts_a_fanout_that_publication_did_not(): void
    {
        $this->members(3);
        $versionId = $this->draft();
        $docId = (int) DB::table('legal_document_versions')->where('id', $versionId)->value('document_id');
        DB::table('legal_document_versions')->where('id', $versionId)->update([
            'is_draft' => 0, 'is_current' => 1, 'published_at' => now()->subDay(),
        ]);
        DB::table('legal_documents')->where('id', $docId)->update(['current_version_id' => $versionId]);

        LegalPublicationDeliveryService::repairFanouts();

        $this->assertSame(0, $this->deliveryCount($versionId), 'a version with no ledger is never emailed by the repair');
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @return int the number of eligible active members in the community */
    private function members(int $count): int
    {
        User::factory()->count($count)->forTenant($this->tenantId)->create(['status' => 'active']);

        return (int) DB::table('users')->where('tenant_id', $this->tenantId)
            ->where('status', 'active')->whereNull('deleted_at')->count();
    }

    private function draft(): int
    {
        $doc = DB::table('legal_documents')->insertGetId([
            'tenant_id' => $this->tenantId, 'document_type' => 'acceptable_use',
            'title' => 'F471 policy', 'slug' => 'acceptable-use', 'is_active' => 1,
            'requires_acceptance' => 0, 'notify_on_update' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        return (int) DB::table('legal_document_versions')->insertGetId([
            'document_id' => $doc, 'version_number' => '2.0', 'content' => '<p>Policy</p>',
            'content_plain' => 'Policy', 'summary_of_changes' => 'Updated retention information.',
            'effective_date' => '2026-09-30', 'is_draft' => 1, 'is_current' => 0, 'created_at' => now(),
            'created_by' => 1,
        ]);
    }

    private function deliveryCount(int $versionId): int
    {
        return (int) DB::table('legal_publication_deliveries')
            ->where('tenant_id', $this->tenantId)->where('version_id', $versionId)->count();
    }
}
