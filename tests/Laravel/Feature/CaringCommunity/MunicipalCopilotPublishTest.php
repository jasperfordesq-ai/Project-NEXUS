<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\EmergencyAlertService;
use App\Services\CaringCommunity\MunicipalCommunicationCopilotService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * AG89 — accept → publish flow for municipal copilot proposals.
 *
 * Accepting a proposal must publish it as a live caring-community
 * announcement (caring_emergency_alerts, severity "info") and stamp the
 * proposal published with the source_announcement_id. Re-accepting must
 * never double-publish; rejecting must never publish.
 */
class MunicipalCopilotPublishTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT = 2; // hour-timebank

    private MunicipalCommunicationCopilotService $service;

    protected function setUp(): void
    {
        parent::setUp();

        TenantContext::setById(self::TENANT);

        // Never let the copilot reach OpenAI from tests — force the offline stub.
        Http::fake(['api.openai.com/*' => Http::response(null, 500)]);

        $this->service = new MunicipalCommunicationCopilotService();
    }

    private function makeAdmin(): int
    {
        $email = 'copilot.' . uniqid() . '@example.com';

        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => self::TENANT,
            'first_name' => 'Copilot',
            'last_name'  => 'Admin',
            'email'      => $email,
            'username'   => 'cp_' . substr(md5($email . microtime(true)), 0, 8),
            'password'   => password_hash('password', PASSWORD_BCRYPT),
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function alertCount(): int
    {
        return (int) DB::table('caring_emergency_alerts')
            ->where('tenant_id', self::TENANT)
            ->count();
    }

    public function test_accept_publishes_proposal_as_visible_announcement(): void
    {
        $admin = $this->makeAdmin();
        $draft = "Community lunch resumes\nThe weekly community lunch resumes on Monday at the parish hall.";

        $proposal = $this->service->generateProposal(self::TENANT, $admin, $draft, null, null);
        $this->assertSame('proposed', $proposal['status']);

        $before = $this->alertCount();

        $published = $this->service->acceptAndPublish(self::TENANT, $proposal['id'], null, $admin);

        $this->assertNotNull($published);
        $this->assertSame('published', $published['status']);
        $this->assertNotNull($published['accepted_at']);
        $this->assertNotNull($published['published_at'] ?? null);
        $this->assertSame($admin, (int) ($published['published_by'] ?? 0));
        $this->assertIsInt($published['source_announcement_id']);
        $this->assertGreaterThan(0, $published['source_announcement_id']);

        // Exactly one new announcement, tenant-scoped, info severity, live.
        $this->assertSame($before + 1, $this->alertCount());

        $alert = EmergencyAlertService::getAlertById(
            (int) $published['source_announcement_id'],
            self::TENANT,
        );
        $this->assertNotNull($alert);
        $this->assertSame('info', $alert['severity']);
        $this->assertSame(1, (int) $alert['is_active']);
        $this->assertSame($admin, (int) $alert['created_by']);
        // Stub analysis keeps polished_text === draft; body must carry it.
        $this->assertSame($draft, $alert['body']);
        $this->assertSame('Community lunch resumes', $alert['title']);

        // Visible state: the announcement is live for members of the tenant.
        $activeIds = array_column(EmergencyAlertService::getActiveAlerts(self::TENANT), 'id');
        $this->assertContains($published['source_announcement_id'], $activeIds);

        // Audit trail persisted on the stored proposal too.
        $stored = $this->service->getProposal(self::TENANT, $proposal['id']);
        $this->assertSame('published', $stored['status']);
        $this->assertSame($published['source_announcement_id'], $stored['source_announcement_id']);
    }

    public function test_re_accept_is_idempotent_and_never_double_publishes(): void
    {
        $admin = $this->makeAdmin();
        $proposal = $this->service->generateProposal(self::TENANT, $admin, 'Bin collection moves to Tuesday next week.', null, null);

        $first = $this->service->acceptAndPublish(self::TENANT, $proposal['id'], null, $admin);
        $this->assertSame('published', $first['status']);
        $announcementId = $first['source_announcement_id'];

        $countAfterFirst = $this->alertCount();

        // Re-accept (e.g. double-click, replayed request) — must be a no-op.
        $second = $this->service->acceptAndPublish(self::TENANT, $proposal['id'], null, $admin);

        $this->assertSame('published', $second['status']);
        $this->assertSame($announcementId, $second['source_announcement_id']);
        $this->assertSame($countAfterFirst, $this->alertCount(), 'Re-accept must not create a second announcement');

        // Direct low-level accept must never downgrade a published proposal.
        $direct = $this->service->acceptProposal(self::TENANT, $proposal['id'], null, $admin);
        $this->assertSame('published', $direct['status']);
        $this->assertSame($announcementId, $direct['source_announcement_id']);
    }

    public function test_reject_does_not_publish(): void
    {
        $admin = $this->makeAdmin();
        $proposal = $this->service->generateProposal(self::TENANT, $admin, 'Draft that should never go live.', null, null);

        $before = $this->alertCount();

        $rejected = $this->service->rejectProposal(self::TENANT, $proposal['id'], 'Tone is wrong.', $admin);
        $this->assertSame('rejected', $rejected['status']);
        $this->assertSame($before, $this->alertCount(), 'Reject must not create an announcement');

        // Publishing a rejected proposal must be refused (returned unchanged).
        $stillRejected = $this->service->publishAcceptedProposal(self::TENANT, $proposal['id'], $admin);
        $this->assertSame('rejected', $stillRejected['status']);
        $this->assertNull($stillRejected['source_announcement_id']);
        $this->assertSame($before, $this->alertCount());
    }
}
