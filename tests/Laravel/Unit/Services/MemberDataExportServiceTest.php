<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\MemberDataExportService;
use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;

/**
 * MemberDataExportServiceTest
 *
 * Tests GDPR/FADP personal-data portability for MemberDataExportService.
 *
 * Strategy:
 *  - Uses a dedicated high-range tenant ID (98765) so that test data never
 *    collides with live tenant-2 rows. DatabaseTransactions rolls back every
 *    test automatically.
 *  - Tests buildArchive() for structure, tenant isolation (no other user's
 *    data leaks), section content (wallet, listings, reviews, consents, etc.),
 *    and format metadata.
 *  - Tests buildJsonArchive() for valid JSON output and filename convention.
 *  - Tests buildZipArchive() for ZIP header and filename convention.
 *  - Tests recordExportRequest() / markCompleted() / countRecentRequests() /
 *    recentHistory() helper lifecycle.
 *
 * Sections skipped as impractically large to fixture:
 *  - caring_support_relationships, caring_favours, caring_loyalty_redemptions,
 *    caring_hour_transfers, caring_tandem_suggestions — these belong to
 *    optional "caring" modules. The schema-guard returns empty arrays when the
 *    tables are absent, so the keys are still present in the archive.
 *  - vol_logs — would require organization/opportunity FK rows.
 *  - group_members — has a FK into groups; tested separately via assertArrayHasKey
 *    to confirm the key is present without requiring group fixture.
 *  - event_rsvps — requires an events FK row; same approach.
 *  - login_history / login_attempts — schema-guarded; key presence confirmed.
 */
class MemberDataExportServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID  = 98765;
    private const TENANT_SLUG = 'export-test-98765';

    private MemberDataExportService $svc;

    protected function setUp(): void
    {
        parent::setUp();

        DB::table('tenants')->updateOrInsert(
            ['id' => self::TENANT_ID],
            [
                'name'              => 'Export Test Tenant',
                'slug'              => self::TENANT_SLUG,
                'is_active'         => true,
                'depth'             => 0,
                'allows_subtenants' => false,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]
        );

        TenantContext::setById(self::TENANT_ID);

        $this->svc = new MemberDataExportService();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Insert a minimal users row and return its ID.
     */
    private function insertUser(
        string $email = '',
        float $balance = 5.0,
        string $suffix = ''
    ): int {
        $uid = uniqid($suffix ?: 'mde', true);
        $email = $email ?: "mde.{$uid}@example.test";

        return DB::table('users')->insertGetId([
            'tenant_id'          => self::TENANT_ID,
            'name'               => 'Export User ' . $uid,
            'first_name'         => 'Export',
            'last_name'          => 'User',
            'email'              => $email,
            'status'             => 'active',
            'balance'            => $balance,
            'role'               => 'member',
            'is_approved'        => 1,
            'preferred_language' => 'en',
            'created_at'         => now(),
            'updated_at'         => now(),
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // buildArchive — top-level structure
    // ─────────────────────────────────────────────────────────────────────────

    public function test_buildArchive_returns_required_top_level_keys(): void
    {
        $userId  = $this->insertUser();
        $archive = $this->svc->buildArchive($userId);

        $expectedKeys = [
            'format_version', 'generated_at', 'tenant',
            'profile', 'addresses', 'wallet',
            'vol_logs', 'support_relationships',
            'caring_favours', 'caring_loyalty_redemptions', 'caring_hour_transfers',
            'tandem_suggestions', 'listings', 'events_attended', 'groups_membership',
            'messages_metadata', 'feed_posts', 'reviews_given', 'reviews_received',
            'login_history', 'notifications', 'consents',
        ];

        foreach ($expectedKeys as $key) {
            $this->assertArrayHasKey($key, $archive, "Missing top-level key: {$key}");
        }
    }

    public function test_buildArchive_format_version_is_1_0(): void
    {
        $userId  = $this->insertUser();
        $archive = $this->svc->buildArchive($userId);

        $this->assertSame('1.0', $archive['format_version']);
    }

    public function test_buildArchive_generated_at_is_iso8601(): void
    {
        $userId  = $this->insertUser();
        $archive = $this->svc->buildArchive($userId);

        $this->assertMatchesRegularExpression(
            '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/',
            $archive['generated_at']
        );
    }

    public function test_buildArchive_tenant_section_has_correct_slug_and_name(): void
    {
        $userId  = $this->insertUser();
        $archive = $this->svc->buildArchive($userId);

        $this->assertSame(self::TENANT_SLUG, $archive['tenant']['slug']);
        $this->assertSame('Export Test Tenant', $archive['tenant']['name']);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // profile section
    // ─────────────────────────────────────────────────────────────────────────

    public function test_buildArchive_profile_contains_user_email(): void
    {
        $email   = 'profile.test.' . uniqid() . '@example.test';
        $userId  = $this->insertUser($email);
        $archive = $this->svc->buildArchive($userId);

        $this->assertArrayHasKey('email', $archive['profile']);
        $this->assertSame($email, $archive['profile']['email']);
    }

    public function test_buildArchive_profile_is_empty_for_nonexistent_user(): void
    {
        $archive = $this->svc->buildArchive(999999999);

        $this->assertSame([], $archive['profile']);
    }

    public function test_buildArchive_profile_contains_expected_fields(): void
    {
        $userId  = $this->insertUser();
        $archive = $this->svc->buildArchive($userId);
        $profile = $archive['profile'];

        foreach (['id', 'email', 'role', 'status', 'preferred_language'] as $field) {
            $this->assertArrayHasKey($field, $profile, "Profile missing field: {$field}");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // wallet section
    // ─────────────────────────────────────────────────────────────────────────

    public function test_wallet_section_has_required_keys(): void
    {
        $userId  = $this->insertUser(balance: 10.0);
        $archive = $this->svc->buildArchive($userId);
        $wallet  = $archive['wallet'];

        foreach (['balance', 'lifetime_credits', 'lifetime_debits', 'transactions'] as $k) {
            $this->assertArrayHasKey($k, $wallet, "Wallet missing key: {$k}");
        }
    }

    public function test_wallet_balance_matches_user_row(): void
    {
        $userId  = $this->insertUser(balance: 42.5);
        $archive = $this->svc->buildArchive($userId);

        $this->assertSame(42.5, $archive['wallet']['balance']);
    }

    public function test_wallet_includes_transactions_for_user(): void
    {
        $userId   = $this->insertUser(balance: 10.0);
        $otherId  = $this->insertUser(balance: 20.0);

        // Insert a transaction where user is receiver (credit = "in")
        DB::table('transactions')->insert([
            'tenant_id'        => self::TENANT_ID,
            'sender_id'        => $otherId,
            'receiver_id'      => $userId,
            'amount'           => 3.0,
            'description'      => 'Test credit',
            'status'           => 'completed',
            'transaction_type' => 'transfer',
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $archive      = $this->svc->buildArchive($userId);
        $transactions = $archive['wallet']['transactions'];

        $this->assertCount(1, $transactions);
        $this->assertSame('in', $transactions[0]['direction']);
        $this->assertSame(3.0, $transactions[0]['amount']);
        $this->assertSame(3.0, $archive['wallet']['lifetime_credits']);
        $this->assertSame(0.0, $archive['wallet']['lifetime_debits']);
    }

    public function test_wallet_does_not_include_other_tenant_transactions(): void
    {
        $userId  = $this->insertUser(balance: 0.0);

        // Insert a transaction for a DIFFERENT tenant
        DB::table('transactions')->insert([
            'tenant_id'        => 999,
            'sender_id'        => 99999,
            'receiver_id'      => $userId,
            'amount'           => 100.0,
            'description'      => 'Other-tenant credit',
            'status'           => 'completed',
            'transaction_type' => 'transfer',
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $archive = $this->svc->buildArchive($userId);

        $this->assertCount(0, $archive['wallet']['transactions'],
            'Cross-tenant transaction must NOT appear in wallet export');
    }

    public function test_wallet_transaction_direction_is_out_when_user_is_sender(): void
    {
        $userId  = $this->insertUser(balance: 20.0);
        $otherId = $this->insertUser(balance: 5.0);

        DB::table('transactions')->insert([
            'tenant_id'        => self::TENANT_ID,
            'sender_id'        => $userId,
            'receiver_id'      => $otherId,
            'amount'           => 7.0,
            'description'      => 'Test debit',
            'status'           => 'completed',
            'transaction_type' => 'transfer',
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $archive = $this->svc->buildArchive($userId);
        $txns    = $archive['wallet']['transactions'];

        $this->assertCount(1, $txns);
        $this->assertSame('out', $txns[0]['direction']);
        $this->assertSame(0.0, $archive['wallet']['lifetime_credits']);
        $this->assertSame(7.0, $archive['wallet']['lifetime_debits']);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // listings section
    // ─────────────────────────────────────────────────────────────────────────

    public function test_listings_section_returns_user_listings(): void
    {
        $userId = $this->insertUser();

        DB::table('listings')->insert([
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $userId,
            'title'       => 'Test Listing Alpha',
            'description' => 'A test listing',
            'type'        => 'offer',
            'status'      => 'active',
            'price'       => 2.0,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        $archive  = $this->svc->buildArchive($userId);
        $listings = $archive['listings'];

        $this->assertCount(1, $listings);
        $this->assertSame('Test Listing Alpha', $listings[0]['title']);
        $this->assertSame('offer', $listings[0]['type']);
        $this->assertSame(2.0, $listings[0]['price']);
    }

    public function test_listings_section_does_not_include_other_user_listings(): void
    {
        $userId  = $this->insertUser();
        $otherId = $this->insertUser();

        // Insert a listing for the OTHER user
        DB::table('listings')->insert([
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $otherId,
            'title'       => 'Other User Listing',
            'type'        => 'offer',
            'status'      => 'active',
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        $archive = $this->svc->buildArchive($userId);

        $this->assertCount(0, $archive['listings'],
            'Another user\'s listing must NOT appear in the export');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // reviews_given / reviews_received
    // ─────────────────────────────────────────────────────────────────────────

    public function test_reviews_given_contains_review_authored_by_user(): void
    {
        $userId  = $this->insertUser();
        $otherId = $this->insertUser();

        DB::table('reviews')->insert([
            'tenant_id'   => self::TENANT_ID,
            'reviewer_id' => $userId,
            'receiver_id' => $otherId,
            'rating'      => 5,
            'comment'     => 'Great member!',
            'review_type' => 'local',
            'status'      => 'approved',
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        $archive = $this->svc->buildArchive($userId);

        $this->assertCount(1, $archive['reviews_given']);
        $this->assertCount(0, $archive['reviews_received']);
        $this->assertSame(5, $archive['reviews_given'][0]['rating']);
        $this->assertSame('Great member!', $archive['reviews_given'][0]['comment']);
    }

    public function test_reviews_received_contains_review_authored_by_others(): void
    {
        $userId  = $this->insertUser();
        $otherId = $this->insertUser();

        DB::table('reviews')->insert([
            'tenant_id'   => self::TENANT_ID,
            'reviewer_id' => $otherId,
            'receiver_id' => $userId,
            'rating'      => 4,
            'comment'     => 'Reliable!',
            'review_type' => 'local',
            'status'      => 'approved',
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        $archive = $this->svc->buildArchive($userId);

        $this->assertCount(0, $archive['reviews_given']);
        $this->assertCount(1, $archive['reviews_received']);
        $this->assertSame(4, $archive['reviews_received'][0]['rating']);
    }

    public function test_reviews_do_not_cross_tenant_boundary(): void
    {
        $userId  = $this->insertUser();
        $otherId = $this->insertUser();

        // Review on a DIFFERENT tenant
        DB::table('reviews')->insert([
            'tenant_id'   => 999,
            'reviewer_id' => $userId,
            'receiver_id' => $otherId,
            'rating'      => 3,
            'comment'     => 'Wrong tenant review',
            'review_type' => 'local',
            'status'      => 'approved',
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        $archive = $this->svc->buildArchive($userId);

        $this->assertCount(0, $archive['reviews_given'],
            'Cross-tenant review must NOT appear in reviews_given');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // consents section
    // ─────────────────────────────────────────────────────────────────────────

    public function test_consents_section_returns_user_consents(): void
    {
        $userId = $this->insertUser();

        DB::table('user_consents')->insertOrIgnore([
            'user_id'          => $userId,
            'tenant_id'        => self::TENANT_ID,
            'consent_type'     => 'marketing_email',
            'consent_given'    => 1,
            'consent_text'     => 'I agree to receive marketing emails.',
            'consent_version'  => 'v1',
            'source'           => 'web',
            'given_at'         => now(),
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $archive  = $this->svc->buildArchive($userId);
        $consents = $archive['consents'];

        $this->assertCount(1, $consents);
        $this->assertSame('marketing_email', $consents[0]['consent_type']);
        $this->assertTrue($consents[0]['consent_given']);
        $this->assertSame('v1', $consents[0]['consent_version']);
    }

    public function test_consents_do_not_include_other_user_or_tenant(): void
    {
        $userId  = $this->insertUser();
        $otherId = $this->insertUser();

        // Consent for a different user on same tenant
        DB::table('user_consents')->insertOrIgnore([
            'user_id'          => $otherId,
            'tenant_id'        => self::TENANT_ID,
            'consent_type'     => 'terms',
            'consent_given'    => 1,
            'consent_text'     => 'Terms',
            'consent_version'  => 'v1',
            'source'           => 'web',
            'given_at'         => now(),
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $archive = $this->svc->buildArchive($userId);

        $this->assertCount(0, $archive['consents'],
            'Another user\'s consent must NOT appear in the export');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // notifications section
    // ─────────────────────────────────────────────────────────────────────────

    public function test_notifications_section_returns_user_notifications(): void
    {
        $userId = $this->insertUser();

        DB::table('notifications')->insert([
            'user_id'    => $userId,
            'tenant_id'  => self::TENANT_ID,
            'type'       => 'system',
            'title'      => 'Welcome!',
            'message'    => 'Thanks for joining.',
            'is_read'    => 0,
            'created_at' => now(),
        ]);

        $archive = $this->svc->buildArchive($userId);
        $notifs  = $archive['notifications'];

        $this->assertCount(1, $notifs);
        $this->assertSame('system', $notifs[0]['type']);
        $this->assertSame('Welcome!', $notifs[0]['title']);
        $this->assertFalse($notifs[0]['is_read']);
    }

    public function test_notifications_do_not_include_other_user_notifications(): void
    {
        $userId  = $this->insertUser();
        $otherId = $this->insertUser();

        DB::table('notifications')->insert([
            'user_id'    => $otherId,
            'tenant_id'  => self::TENANT_ID,
            'type'       => 'system',
            'title'      => 'Other notification',
            'message'    => 'Not yours.',
            'is_read'    => 0,
            'created_at' => now(),
        ]);

        $archive = $this->svc->buildArchive($userId);

        $this->assertCount(0, $archive['notifications'],
            'Another user\'s notification must NOT appear in export');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // feed_posts section
    // ─────────────────────────────────────────────────────────────────────────

    public function test_feed_posts_section_returns_user_posts(): void
    {
        $userId = $this->insertUser();

        DB::table('feed_posts')->insert([
            'tenant_id'      => self::TENANT_ID,
            'user_id'        => $userId,
            'content'        => 'Hello community!',
            'visibility'     => 'public',
            'publish_status' => 'published',
            'type'           => 'post',
            'likes_count'    => 3,
            'created_at'     => now(),
        ]);

        $archive = $this->svc->buildArchive($userId);
        $posts   = $archive['feed_posts'];

        $this->assertCount(1, $posts);
        $this->assertSame('Hello community!', $posts[0]['content']);
        $this->assertSame('public', $posts[0]['visibility']);
        $this->assertSame(3, $posts[0]['likes_count']);
    }

    public function test_feed_posts_do_not_include_other_user_posts(): void
    {
        $userId  = $this->insertUser();
        $otherId = $this->insertUser();

        DB::table('feed_posts')->insert([
            'tenant_id'      => self::TENANT_ID,
            'user_id'        => $otherId,
            'content'        => 'Someone else\'s post',
            'visibility'     => 'public',
            'publish_status' => 'published',
            'type'           => 'post',
            'created_at'     => now(),
        ]);

        $archive = $this->svc->buildArchive($userId);

        $this->assertCount(0, $archive['feed_posts'],
            'Another user\'s feed post must NOT appear in export');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // messages_metadata section
    // ─────────────────────────────────────────────────────────────────────────

    public function test_messages_metadata_has_required_keys(): void
    {
        $userId  = $this->insertUser();
        $archive = $this->svc->buildArchive($userId);
        $meta    = $archive['messages_metadata'];

        foreach (['sent_count', 'received_count', 'conversations_participated', 'note'] as $k) {
            $this->assertArrayHasKey($k, $meta, "messages_metadata missing key: {$k}");
        }
    }

    public function test_messages_metadata_note_does_not_include_message_body(): void
    {
        $userId  = $this->insertUser();
        $archive = $this->svc->buildArchive($userId);

        // The note field should NOT say "message contents" are included
        $note = $archive['messages_metadata']['note'] ?? '';
        $this->assertStringContainsString('Counts only', $note);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Optional schema-guarded sections — key presence only
    // ─────────────────────────────────────────────────────────────────────────

    public function test_optional_sections_are_present_as_keys_even_if_empty(): void
    {
        $userId  = $this->insertUser();
        $archive = $this->svc->buildArchive($userId);

        $optionalKeys = [
            'vol_logs', 'support_relationships',
            'caring_favours', 'caring_loyalty_redemptions', 'caring_hour_transfers',
            'tandem_suggestions', 'events_attended', 'groups_membership',
            'login_history', 'addresses',
        ];

        foreach ($optionalKeys as $key) {
            $this->assertArrayHasKey($key, $archive, "Archive missing optional key: {$key}");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // buildJsonArchive
    // ─────────────────────────────────────────────────────────────────────────

    public function test_buildJsonArchive_returns_valid_json(): void
    {
        $userId = $this->insertUser();
        $result = $this->svc->buildJsonArchive($userId);

        $this->assertArrayHasKey('filename', $result);
        $this->assertArrayHasKey('content', $result);

        $decoded = json_decode($result['content'], true);
        $this->assertNotNull($decoded, 'buildJsonArchive content must be valid JSON');
        $this->assertIsArray($decoded);
    }

    public function test_buildJsonArchive_filename_contains_slug_and_user_id(): void
    {
        $userId = $this->insertUser();
        $result = $this->svc->buildJsonArchive($userId);

        $this->assertStringContainsString(self::TENANT_SLUG, $result['filename']);
        $this->assertStringContainsString((string) $userId, $result['filename']);
        $this->assertStringEndsWith('.json', $result['filename']);
    }

    public function test_buildJsonArchive_json_contains_format_version(): void
    {
        $userId  = $this->insertUser();
        $result  = $this->svc->buildJsonArchive($userId);
        $decoded = json_decode($result['content'], true);

        $this->assertSame('1.0', $decoded['format_version'] ?? null);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // buildZipArchive
    // ─────────────────────────────────────────────────────────────────────────

    public function test_buildZipArchive_returns_zip_filename(): void
    {
        $userId = $this->insertUser();
        $result = $this->svc->buildZipArchive($userId);

        $this->assertArrayHasKey('filename', $result);
        $this->assertStringEndsWith('.zip', $result['filename']);
        $this->assertStringContainsString(self::TENANT_SLUG, $result['filename']);
    }

    public function test_buildZipArchive_content_has_zip_magic_bytes(): void
    {
        $userId  = $this->insertUser();
        $result  = $this->svc->buildZipArchive($userId);
        $content = $result['content'];

        // ZIP files begin with PK\x03\x04
        $this->assertStringStartsWith("PK\x03\x04", $content,
            'buildZipArchive content must be a valid ZIP file (PK magic bytes)');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // recordExportRequest / markCompleted / countRecentRequests / recentHistory
    // ─────────────────────────────────────────────────────────────────────────

    public function test_recordExportRequest_inserts_row_and_returns_positive_id(): void
    {
        $userId = $this->insertUser();
        $id     = $this->svc->recordExportRequest($userId, 'json');

        $this->assertGreaterThan(0, $id);

        $row = DB::table('member_data_exports')->where('id', $id)->first();
        $this->assertNotNull($row);
        $this->assertSame((int) self::TENANT_ID, (int) $row->tenant_id);
        $this->assertSame($userId, (int) $row->user_id);
        $this->assertSame('json', $row->format);
    }

    public function test_recordExportRequest_normalises_invalid_format_to_json(): void
    {
        $userId = $this->insertUser();
        $id     = $this->svc->recordExportRequest($userId, 'csv'); // not valid

        $row = DB::table('member_data_exports')->where('id', $id)->first();
        $this->assertSame('json', $row->format);
    }

    public function test_recordExportRequest_accepts_zip_format(): void
    {
        $userId = $this->insertUser();
        $id     = $this->svc->recordExportRequest($userId, 'zip');

        $row = DB::table('member_data_exports')->where('id', $id)->first();
        $this->assertSame('zip', $row->format);
    }

    public function test_markCompleted_sets_completed_at_and_file_size(): void
    {
        $userId    = $this->insertUser();
        $exportId  = $this->svc->recordExportRequest($userId, 'json');

        $this->svc->markCompleted($exportId, 12345);

        $row = DB::table('member_data_exports')->where('id', $exportId)->first();
        $this->assertNotNull($row->completed_at);
        $this->assertSame(12345, (int) $row->file_size_bytes);
    }

    public function test_export_request_idempotency_replays_one_ledger_row_and_rejects_a_different_format(): void
    {
        $userId = $this->insertUser();
        $key = 'mobile-export-response-loss-unit-1';

        $first = $this->svc->recordExportRequest($userId, 'json', $key);
        $replay = $this->svc->recordExportRequest($userId, 'json', $key);

        $this->assertSame($first, $replay);
        $this->assertSame($first, $this->svc->findIdempotentExport($userId, 'json', $key));
        $this->assertSame(1, DB::table('member_data_exports')->where('user_id', $userId)->count());

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('IDEMPOTENCY_CONFLICT');
        $this->svc->findIdempotentExport($userId, 'zip', $key);
    }

    public function test_only_one_completion_event_claim_wins_for_an_export(): void
    {
        $userId = $this->insertUser();
        $exportId = $this->svc->recordExportRequest($userId, 'json', 'mobile-export-event-claim-1');

        $this->assertTrue($this->svc->claimCompletionEvent($exportId));
        $this->assertFalse($this->svc->claimCompletionEvent($exportId));
    }

    public function test_countRecentRequests_returns_zero_when_none(): void
    {
        $userId = $this->insertUser();

        $count = $this->svc->countRecentRequests($userId);

        $this->assertSame(0, $count);
    }

    public function test_countRecentRequests_counts_only_within_24h(): void
    {
        $userId = $this->insertUser();

        // Insert a request from 2 days ago
        DB::table('member_data_exports')->insert([
            'tenant_id'    => self::TENANT_ID,
            'user_id'      => $userId,
            'format'       => 'json',
            'requested_at' => now()->subDays(2),
            'created_at'   => now()->subDays(2),
            'updated_at'   => now()->subDays(2),
        ]);

        // Insert a recent request
        $this->svc->recordExportRequest($userId, 'json');

        $count = $this->svc->countRecentRequests($userId);

        $this->assertSame(1, $count, 'Only requests within the last 24h should be counted');
    }

    public function test_countRecentRequests_is_tenant_scoped(): void
    {
        $userId = $this->insertUser();

        // Insert a request under a different tenant
        DB::table('member_data_exports')->insert([
            'tenant_id'    => 999,
            'user_id'      => $userId,
            'format'       => 'json',
            'requested_at' => now(),
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        $count = $this->svc->countRecentRequests($userId);

        $this->assertSame(0, $count, 'Cross-tenant export requests must not be counted');
    }

    public function test_recentHistory_returns_export_rows_in_descending_order(): void
    {
        $userId = $this->insertUser();

        $this->svc->recordExportRequest($userId, 'json');
        $this->svc->recordExportRequest($userId, 'zip');

        $history = $this->svc->recentHistory($userId);

        $this->assertCount(2, $history);
        // Most recent first — zip was inserted last
        $this->assertSame('zip', $history[0]['format']);
    }

    public function test_recentHistory_is_tenant_scoped(): void
    {
        $userId = $this->insertUser();

        // A row on a different tenant
        DB::table('member_data_exports')->insert([
            'tenant_id'    => 999,
            'user_id'      => $userId,
            'format'       => 'json',
            'requested_at' => now(),
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        $history = $this->svc->recentHistory($userId);

        $this->assertCount(0, $history, 'Cross-tenant export rows must not appear in history');
    }

    public function test_recentHistory_row_has_expected_keys(): void
    {
        $userId   = $this->insertUser();
        $exportId = $this->svc->recordExportRequest($userId, 'json');
        $this->svc->markCompleted($exportId, 999);

        $history = $this->svc->recentHistory($userId);

        $this->assertArrayHasKey('id', $history[0]);
        $this->assertArrayHasKey('format', $history[0]);
        $this->assertArrayHasKey('requested_at', $history[0]);
        $this->assertArrayHasKey('completed_at', $history[0]);
        $this->assertArrayHasKey('file_size_bytes', $history[0]);

        $this->assertSame(999, $history[0]['file_size_bytes']);
    }
}
