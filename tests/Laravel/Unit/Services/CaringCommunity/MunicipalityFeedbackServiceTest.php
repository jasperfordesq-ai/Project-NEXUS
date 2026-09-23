<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\MunicipalityFeedbackService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * MunicipalityFeedbackServiceTest
 *
 * Covers:
 *  - submit: validation errors (category, subject, body, sentiment, sub_region_id)
 *  - submit: happy path (non-anonymous, anonymous with sentinel redaction)
 *  - submit: is_public and sentiment_tag stored correctly
 *  - listForMember: returns own submissions only, ordered newest-first
 *  - listForAdmin: pagination totals, status/category filter
 *  - show: null when not found, correct shape admin/member context
 *  - triage: invalid status error, assigns user/role/notes, status transition
 *  - resolve: empty notes error, sets status + resolution_notes
 *  - close: sets status to closed
 *  - dashboardStats: by_status, by_category, recent_7d, sentiment_distribution, total_open
 *  - exportCsv: header row present, anonymous redaction, status filter applied
 */
class MunicipalityFeedbackServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    private MunicipalityFeedbackService $svc;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        TenantContext::setById(self::TENANT_ID);
        $this->svc = new MunicipalityFeedbackService();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private function insertUser(): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'name'       => 'MFB User ' . uniqid(),
            'email'      => 'mfb.' . uniqid() . '@example.test',
            'status'     => 'active',
            'role'       => 'member',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function validPayload(array $overrides = []): array
    {
        return array_merge([
            'category' => 'question',
            'subject'  => 'Test subject',
            'body'     => 'Test body content.',
        ], $overrides);
    }

    private function insertFeedback(array $overrides = []): int
    {
        $userId = $this->insertUser();
        $now    = now();

        return (int) DB::table(MunicipalityFeedbackService::TABLE)->insertGetId(array_merge([
            'tenant_id'         => self::TENANT_ID,
            'submitter_user_id' => $userId,
            'category'          => 'question',
            'subject'           => 'Inserted subject',
            'body'              => 'Inserted body.',
            'status'            => 'new',
            'is_anonymous'      => 0,
            'is_public'         => 0,
            'created_at'        => $now,
            'updated_at'        => $now,
        ], $overrides));
    }

    // ── submit: validation ────────────────────────────────────────────────────

    public function test_submit_returns_error_for_invalid_category(): void
    {
        $result = $this->svc->submit(self::TENANT_ID, null, $this->validPayload(['category' => 'bogus']));

        $this->assertArrayHasKey('errors', $result);
        $codes = array_column($result['errors'], 'code');
        $this->assertContains('INVALID_CATEGORY', $codes);
    }

    public function test_submit_returns_error_when_subject_is_empty(): void
    {
        $result = $this->svc->submit(self::TENANT_ID, null, $this->validPayload(['subject' => '   ']));

        $this->assertArrayHasKey('errors', $result);
        $codes = array_column($result['errors'], 'code');
        $this->assertContains('SUBJECT_REQUIRED', $codes);
    }

    public function test_submit_returns_error_when_subject_exceeds_200_chars(): void
    {
        $result = $this->svc->submit(self::TENANT_ID, null, $this->validPayload(['subject' => str_repeat('x', 201)]));

        $this->assertArrayHasKey('errors', $result);
        $codes = array_column($result['errors'], 'code');
        $this->assertContains('SUBJECT_TOO_LONG', $codes);
    }

    public function test_submit_returns_error_when_body_is_empty(): void
    {
        $result = $this->svc->submit(self::TENANT_ID, null, $this->validPayload(['body' => '']));

        $this->assertArrayHasKey('errors', $result);
        $codes = array_column($result['errors'], 'code');
        $this->assertContains('BODY_REQUIRED', $codes);
    }

    public function test_submit_returns_error_for_invalid_sentiment_tag(): void
    {
        $result = $this->svc->submit(
            self::TENANT_ID,
            null,
            $this->validPayload(['sentiment_tag' => 'happy'])
        );

        $this->assertArrayHasKey('errors', $result);
        $codes = array_column($result['errors'], 'code');
        $this->assertContains('INVALID_SENTIMENT', $codes);
    }

    public function test_submit_returns_error_for_non_numeric_sub_region_id(): void
    {
        $result = $this->svc->submit(
            self::TENANT_ID,
            null,
            $this->validPayload(['sub_region_id' => 'abc'])
        );

        $this->assertArrayHasKey('errors', $result);
        $codes = array_column($result['errors'], 'code');
        $this->assertContains('INVALID_SUB_REGION', $codes);
    }

    // ── submit: happy path ────────────────────────────────────────────────────

    public function test_submit_happy_path_returns_feedback_row(): void
    {
        $userId = $this->insertUser();
        $result = $this->svc->submit(
            self::TENANT_ID,
            $userId,
            $this->validPayload(['category' => 'idea', 'sentiment_tag' => 'positive'])
        );

        $this->assertArrayHasKey('feedback', $result);
        $fb = $result['feedback'];
        $this->assertSame(self::TENANT_ID, $fb['tenant_id']);
        $this->assertSame('idea', $fb['category']);
        $this->assertSame('positive', $fb['sentiment_tag']);
        $this->assertSame('new', $fb['status']);
        $this->assertSame($userId, $fb['submitter_user_id']);
    }

    public function test_submit_stores_sub_region_id_when_provided(): void
    {
        $userId = $this->insertUser();
        $result = $this->svc->submit(
            self::TENANT_ID,
            $userId,
            $this->validPayload(['sub_region_id' => '7'])
        );

        $this->assertArrayHasKey('feedback', $result);
        $this->assertSame(7, $result['feedback']['sub_region_id']);
    }

    public function test_submit_anonymous_redacts_submitter_in_member_context(): void
    {
        $userId = $this->insertUser();
        $result = $this->svc->submit(
            self::TENANT_ID,
            $userId,
            $this->validPayload(['is_anonymous' => true])
        );

        $this->assertArrayHasKey('feedback', $result);
        // submit() calls formatRow with adminContext=false, memberOwnView=false → redact
        $this->assertNull($result['feedback']['submitter_user_id']);
        $this->assertTrue($result['feedback']['is_anonymous']);
    }

    public function test_submit_is_public_flag_is_stored(): void
    {
        $userId = $this->insertUser();
        $result = $this->svc->submit(
            self::TENANT_ID,
            $userId,
            $this->validPayload(['is_public' => true])
        );

        $this->assertArrayHasKey('feedback', $result);
        $this->assertTrue($result['feedback']['is_public']);
    }

    // ── listForMember ─────────────────────────────────────────────────────────

    public function test_listForMember_returns_only_this_users_submissions(): void
    {
        $userA = $this->insertUser();
        $userB = $this->insertUser();

        $this->insertFeedback(['submitter_user_id' => $userA, 'subject' => 'A1']);
        $this->insertFeedback(['submitter_user_id' => $userA, 'subject' => 'A2']);
        $this->insertFeedback(['submitter_user_id' => $userB, 'subject' => 'B1']);

        $listA = $this->svc->listForMember(self::TENANT_ID, $userA);
        $listB = $this->svc->listForMember(self::TENANT_ID, $userB);

        $this->assertCount(2, $listA);
        $this->assertCount(1, $listB);
        $subjectsA = array_column($listA, 'subject');
        $this->assertContains('A1', $subjectsA);
        $this->assertContains('A2', $subjectsA);
    }

    public function test_listForMember_returns_newest_first(): void
    {
        $userId = $this->insertUser();
        $now    = now();

        DB::table(MunicipalityFeedbackService::TABLE)->insert([
            [
                'tenant_id'         => self::TENANT_ID,
                'submitter_user_id' => $userId,
                'category'          => 'question',
                'subject'           => 'Older',
                'body'              => 'Body',
                'status'            => 'new',
                'is_anonymous'      => 0,
                'is_public'         => 0,
                'created_at'        => $now->copy()->subMinutes(10),
                'updated_at'        => $now,
            ],
            [
                'tenant_id'         => self::TENANT_ID,
                'submitter_user_id' => $userId,
                'category'          => 'idea',
                'subject'           => 'Newer',
                'body'              => 'Body',
                'status'            => 'new',
                'is_anonymous'      => 0,
                'is_public'         => 0,
                'created_at'        => $now,
                'updated_at'        => $now,
            ],
        ]);

        $list = $this->svc->listForMember(self::TENANT_ID, $userId);

        $this->assertGreaterThanOrEqual(2, count($list));
        $this->assertSame('Newer', $list[0]['subject']);
    }

    // ── listForAdmin ──────────────────────────────────────────────────────────

    public function test_listForAdmin_returns_pagination_shape(): void
    {
        $result = $this->svc->listForAdmin(self::TENANT_ID);

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('total', $result);
        $this->assertArrayHasKey('page', $result);
        $this->assertArrayHasKey('per_page', $result);
    }

    public function test_listForAdmin_status_filter_limits_results(): void
    {
        $this->insertFeedback(['status' => 'new']);
        $this->insertFeedback(['status' => 'resolved']);

        $newOnly = $this->svc->listForAdmin(self::TENANT_ID, statusFilter: 'new');
        $resolvedOnly = $this->svc->listForAdmin(self::TENANT_ID, statusFilter: 'resolved');

        foreach ($newOnly['items'] as $item) {
            $this->assertSame('new', $item['status']);
        }
        foreach ($resolvedOnly['items'] as $item) {
            $this->assertSame('resolved', $item['status']);
        }
    }

    public function test_listForAdmin_category_filter_limits_results(): void
    {
        $this->insertFeedback(['category' => 'question']);
        $this->insertFeedback(['category' => 'idea']);

        $ideas = $this->svc->listForAdmin(self::TENANT_ID, categoryFilter: 'idea');

        foreach ($ideas['items'] as $item) {
            $this->assertSame('idea', $item['category']);
        }
        $this->assertGreaterThanOrEqual(1, $ideas['total']);
    }

    // ── show ──────────────────────────────────────────────────────────────────

    public function test_show_returns_null_for_unknown_id(): void
    {
        $result = $this->svc->show(self::TENANT_ID, 999999999, false);
        $this->assertNull($result);
    }

    public function test_show_returns_correct_shape_in_admin_context(): void
    {
        $userId = $this->insertUser();
        $id     = $this->insertFeedback(['submitter_user_id' => $userId, 'is_anonymous' => 1]);

        $result = $this->svc->show(self::TENANT_ID, $id, true);

        $this->assertNotNull($result);
        // F-139: anonymous stays anonymous in the admin triage view too
        $this->assertNull($result['submitter_user_id']);
        $this->assertTrue($result['is_anonymous']);
        $this->assertArrayHasKey('triage_notes', $result);
        $this->assertArrayHasKey('resolution_notes', $result);
    }

    public function test_show_redacts_submitter_in_member_context_when_anonymous(): void
    {
        $userId = $this->insertUser();
        $id     = $this->insertFeedback(['submitter_user_id' => $userId, 'is_anonymous' => 1]);

        $result = $this->svc->show(self::TENANT_ID, $id, false);

        $this->assertNotNull($result);
        $this->assertNull($result['submitter_user_id']);
    }

    // ── triage ────────────────────────────────────────────────────────────────

    public function test_triage_returns_not_found_for_unknown_id(): void
    {
        $result = $this->svc->triage(self::TENANT_ID, 999999999, ['status' => 'triaging']);

        $this->assertArrayHasKey('errors', $result);
        $this->assertSame('NOT_FOUND', $result['errors'][0]['code']);
    }

    public function test_triage_returns_error_for_invalid_status(): void
    {
        $id     = $this->insertFeedback();
        $result = $this->svc->triage(self::TENANT_ID, $id, ['status' => 'wonky']);

        $this->assertArrayHasKey('errors', $result);
        $this->assertSame('INVALID_STATUS', $result['errors'][0]['code']);
    }

    public function test_triage_transitions_status_to_triaging(): void
    {
        $id     = $this->insertFeedback(['status' => 'new']);
        $result = $this->svc->triage(self::TENANT_ID, $id, ['status' => 'triaging']);

        $this->assertArrayHasKey('feedback', $result);
        $this->assertSame('triaging', $result['feedback']['status']);
    }

    public function test_triage_assigns_user_role_and_notes(): void
    {
        $userId = $this->insertUser();
        $id     = $this->insertFeedback();

        $result = $this->svc->triage(self::TENANT_ID, $id, [
            'status'           => 'in_progress',
            'assigned_user_id' => $userId,
            'assigned_role'    => 'coordinator',
            'triage_notes'     => 'Looking into this.',
        ]);

        $this->assertArrayHasKey('feedback', $result);
        $fb = $result['feedback'];
        $this->assertSame('in_progress', $fb['status']);
        $this->assertSame($userId, $fb['assigned_user_id']);
        $this->assertSame('coordinator', $fb['assigned_role']);
        $this->assertSame('Looking into this.', $fb['triage_notes']);
    }

    public function test_triage_clears_assigned_user_when_set_to_null(): void
    {
        $userId = $this->insertUser();
        $id     = $this->insertFeedback(['assigned_user_id' => $userId]);

        $result = $this->svc->triage(self::TENANT_ID, $id, ['assigned_user_id' => null]);

        $this->assertArrayHasKey('feedback', $result);
        $this->assertNull($result['feedback']['assigned_user_id']);
    }

    // ── resolve ───────────────────────────────────────────────────────────────

    public function test_resolve_returns_error_when_notes_are_empty(): void
    {
        $id     = $this->insertFeedback();
        $result = $this->svc->resolve(self::TENANT_ID, $id, '   ');

        $this->assertArrayHasKey('errors', $result);
        $this->assertSame('NOTES_REQUIRED', $result['errors'][0]['code']);
    }

    public function test_resolve_sets_status_and_resolution_notes(): void
    {
        $id     = $this->insertFeedback(['status' => 'in_progress']);
        $result = $this->svc->resolve(self::TENANT_ID, $id, 'Issue fixed by team.');

        $this->assertArrayHasKey('feedback', $result);
        $this->assertSame('resolved', $result['feedback']['status']);
        $this->assertSame('Issue fixed by team.', $result['feedback']['resolution_notes']);
    }

    // ── close ─────────────────────────────────────────────────────────────────

    public function test_close_sets_status_to_closed(): void
    {
        $id     = $this->insertFeedback(['status' => 'new']);
        $result = $this->svc->close(self::TENANT_ID, $id);

        $this->assertArrayHasKey('feedback', $result);
        $this->assertSame('closed', $result['feedback']['status']);
    }

    public function test_close_returns_not_found_for_unknown_id(): void
    {
        $result = $this->svc->close(self::TENANT_ID, 999999999);

        $this->assertArrayHasKey('errors', $result);
        $this->assertSame('NOT_FOUND', $result['errors'][0]['code']);
    }

    // ── dashboardStats ────────────────────────────────────────────────────────

    public function test_dashboardStats_returns_all_required_keys(): void
    {
        $stats = $this->svc->dashboardStats(self::TENANT_ID);

        $this->assertArrayHasKey('total_open', $stats);
        $this->assertArrayHasKey('by_status', $stats);
        $this->assertArrayHasKey('by_category', $stats);
        $this->assertArrayHasKey('by_sub_region', $stats);
        $this->assertArrayHasKey('recent_count_7d', $stats);
        $this->assertArrayHasKey('sentiment_distribution', $stats);
    }

    public function test_dashboardStats_total_open_counts_only_open_statuses(): void
    {
        // Insert one open ('new') and one closed, in a fresh isolated context via high tenant id
        $isolatedTenantId = 99991001;

        $now = now();
        DB::table(MunicipalityFeedbackService::TABLE)->insert([
            [
                'tenant_id'         => $isolatedTenantId,
                'submitter_user_id' => null,
                'category'          => 'question',
                'subject'           => 'Open item',
                'body'              => 'Body',
                'status'            => 'new',
                'is_anonymous'      => 0,
                'is_public'         => 0,
                'created_at'        => $now,
                'updated_at'        => $now,
            ],
            [
                'tenant_id'         => $isolatedTenantId,
                'submitter_user_id' => null,
                'category'          => 'idea',
                'subject'           => 'Closed item',
                'body'              => 'Body',
                'status'            => 'closed',
                'is_anonymous'      => 0,
                'is_public'         => 0,
                'created_at'        => $now,
                'updated_at'        => $now,
            ],
        ]);

        $stats = $this->svc->dashboardStats($isolatedTenantId);

        $this->assertSame(1, $stats['total_open']);
        $this->assertIsArray($stats['by_status']);
        $this->assertSame(1, $stats['by_status']['new'] ?? null);
    }

    public function test_dashboardStats_sentiment_distribution_aggregates_correctly(): void
    {
        $isolatedTenantId = 99991002;
        $now = now();

        DB::table(MunicipalityFeedbackService::TABLE)->insert([
            [
                'tenant_id'         => $isolatedTenantId,
                'submitter_user_id' => null,
                'category'          => 'sentiment',
                'subject'           => 'Pos1',
                'body'              => 'Body',
                'sentiment_tag'     => 'positive',
                'status'            => 'new',
                'is_anonymous'      => 0,
                'is_public'         => 0,
                'created_at'        => $now,
                'updated_at'        => $now,
            ],
            [
                'tenant_id'         => $isolatedTenantId,
                'submitter_user_id' => null,
                'category'          => 'sentiment',
                'subject'           => 'Pos2',
                'body'              => 'Body',
                'sentiment_tag'     => 'positive',
                'status'            => 'new',
                'is_anonymous'      => 0,
                'is_public'         => 0,
                'created_at'        => $now,
                'updated_at'        => $now,
            ],
            [
                'tenant_id'         => $isolatedTenantId,
                'submitter_user_id' => null,
                'category'          => 'sentiment',
                'subject'           => 'Neg1',
                'body'              => 'Body',
                'sentiment_tag'     => 'negative',
                'status'            => 'new',
                'is_anonymous'      => 0,
                'is_public'         => 0,
                'created_at'        => $now,
                'updated_at'        => $now,
            ],
        ]);

        $stats = $this->svc->dashboardStats($isolatedTenantId);

        $this->assertSame(2, $stats['sentiment_distribution']['positive'] ?? null);
        $this->assertSame(1, $stats['sentiment_distribution']['negative'] ?? null);
    }

    public function test_dashboardStats_recent_count_7d_only_includes_last_7_days(): void
    {
        $isolatedTenantId = 99991003;
        $now = now();

        DB::table(MunicipalityFeedbackService::TABLE)->insert([
            [
                'tenant_id'         => $isolatedTenantId,
                'submitter_user_id' => null,
                'category'          => 'question',
                'subject'           => 'Recent',
                'body'              => 'Body',
                'status'            => 'new',
                'is_anonymous'      => 0,
                'is_public'         => 0,
                'created_at'        => $now,
                'updated_at'        => $now,
            ],
            [
                'tenant_id'         => $isolatedTenantId,
                'submitter_user_id' => null,
                'category'          => 'question',
                'subject'           => 'Old',
                'body'              => 'Body',
                'status'            => 'new',
                'is_anonymous'      => 0,
                'is_public'         => 0,
                'created_at'        => $now->copy()->subDays(10),
                'updated_at'        => $now,
            ],
        ]);

        $stats = $this->svc->dashboardStats($isolatedTenantId);

        $this->assertSame(1, $stats['recent_count_7d']);
    }

    // ── exportCsv ─────────────────────────────────────────────────────────────

    public function test_exportCsv_produces_header_row(): void
    {
        $csv = $this->svc->exportCsv(self::TENANT_ID);

        // Strip UTF-8 BOM if present
        $csv = ltrim($csv, "\xEF\xBB\xBF");
        $firstLine = strtok($csv, "\n");
        $this->assertStringContainsString('id', $firstLine);
        $this->assertStringContainsString('category', $firstLine);
        $this->assertStringContainsString('status', $firstLine);
    }

    public function test_exportCsv_redacts_submitter_for_anonymous_row(): void
    {
        $userId = $this->insertUser();
        $isolatedTenantId = 99991004;
        $now = now();

        DB::table(MunicipalityFeedbackService::TABLE)->insert([
            'tenant_id'         => $isolatedTenantId,
            'submitter_user_id' => $userId,
            'category'          => 'question',
            'subject'           => 'Anon submission',
            'body'              => 'Body',
            'status'            => 'new',
            'is_anonymous'      => 1,
            'is_public'         => 0,
            'created_at'        => $now,
            'updated_at'        => $now,
        ]);

        $csv = $this->svc->exportCsv($isolatedTenantId);

        $this->assertStringContainsString('(anonymous)', $csv);
        $this->assertStringNotContainsString((string) $userId, $csv);
    }

    public function test_exportCsv_status_filter_limits_rows_exported(): void
    {
        $isolatedTenantId = 99991005;
        $now = now();

        DB::table(MunicipalityFeedbackService::TABLE)->insert([
            [
                'tenant_id'         => $isolatedTenantId,
                'submitter_user_id' => null,
                'category'          => 'question',
                'subject'           => 'StatusNew',
                'body'              => 'Body',
                'status'            => 'new',
                'is_anonymous'      => 0,
                'is_public'         => 0,
                'created_at'        => $now,
                'updated_at'        => $now,
            ],
            [
                'tenant_id'         => $isolatedTenantId,
                'submitter_user_id' => null,
                'category'          => 'idea',
                'subject'           => 'StatusResolved',
                'body'              => 'Body',
                'status'            => 'resolved',
                'is_anonymous'      => 0,
                'is_public'         => 0,
                'created_at'        => $now,
                'updated_at'        => $now,
            ],
        ]);

        $csvNewOnly = $this->svc->exportCsv($isolatedTenantId, statusFilter: 'new');

        $this->assertStringContainsString('StatusNew', $csvNewOnly);
        $this->assertStringNotContainsString('StatusResolved', $csvNewOnly);
    }
}
