<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\AI;

use App\Core\TenantContext;
use App\Services\AI\AiModuleDocsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * AiModuleDocsServiceTest
 *
 * Strategy:
 *   findRelevant()        — keyword matching, scoring, MAX_INJECTED cap (4),
 *                           inactive docs excluded, tenant isolation, empty message.
 *   renderForPrompt()     — returns '' when no match, Markdown section when matched,
 *                           includes slug and title.
 *   upsert()              — insert (new slug), update (existing slug), validation
 *                           errors for blank slug/title/body, invalid slug format.
 *   delete()              — removes the correct row; returns false for non-existent.
 *   getById()             — returns array with decoded keywords; throws on missing.
 *   listForTenant()       — returns all rows for the tenant; decodes keywords.
 *   seedDefaultsForTenant() — idempotent; inserts defaults; skips existing slugs.
 *   defaultSeed()         — static; returns non-empty array; every entry has
 *                           title, body, keywords.
 *
 * Tenant isolation is verified by inserting under a different tenant and
 * asserting the service never returns those rows for tenant 2.
 *
 * NOTE: ai_module_docs does not exist in the nexus_test database (migration
 * pending). We create it in setUp() and drop it in tearDown() so the tests
 * exercise real SQL behaviour without touching the production schema.
 */
class AiModuleDocsServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID       = 2;
    private const OTHER_TENANT_ID = 9991;

    // IDs used as "created_by" — no FK enforced in the schema.
    private const ADMIN_USER_ID   = 1;

    private AiModuleDocsService $svc;

    /** @var bool Whether we created the table this run (so tearDown can drop it). */
    private bool $tableCreated = false;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        TenantContext::setById(self::TENANT_ID);
        $this->svc = new AiModuleDocsService();

        // Create the table if it doesn't exist in the test DB.
        // Mirrors the production schema exactly (see database/schema/mysql-schema.sql).
        if (!DB::getSchemaBuilder()->hasTable('ai_module_docs')) {
            DB::statement("
                CREATE TABLE IF NOT EXISTS `ai_module_docs` (
                    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
                    `tenant_id` int(10) unsigned NOT NULL,
                    `module_slug` varchar(64) NOT NULL,
                    `title` varchar(255) NOT NULL,
                    `body` text NOT NULL,
                    `keywords` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
                    `is_active` tinyint(1) NOT NULL DEFAULT 1,
                    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    `created_by` int(10) unsigned DEFAULT NULL,
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uk_tenant_module` (`tenant_id`,`module_slug`),
                    KEY `idx_tenant_active` (`tenant_id`,`is_active`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            ");
            $this->tableCreated = true;
        }
    }

    protected function tearDown(): void
    {
        if ($this->tableCreated) {
            DB::statement('DROP TABLE IF EXISTS `ai_module_docs`');
            $this->tableCreated = false;
        }
        parent::tearDown();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /**
     * Insert a doc row directly and return its ID.
     */
    private function insertDoc(
        string $slug,
        string $title,
        string $body,
        array $keywords = [],
        bool $isActive = true,
        int $tenantId = self::TENANT_ID
    ): int {
        return DB::table('ai_module_docs')->insertGetId([
            'tenant_id'   => $tenantId,
            'module_slug' => $slug,
            'title'       => $title,
            'body'        => $body,
            'keywords'    => json_encode($keywords),
            'is_active'   => $isActive ? 1 : 0,
            'created_by'  => self::ADMIN_USER_ID,
        ]);
    }

    /**
     * Generate a slug unlikely to collide with existing tenant 2 data.
     */
    private function uniqueSlug(string $prefix = 'test'): string
    {
        return $prefix . '_' . substr(md5(uniqid('', true)), 0, 8);
    }

    // ── findRelevant() ────────────────────────────────────────────────────────

    public function test_findRelevant_returns_empty_when_no_docs_match(): void
    {
        $slug = $this->uniqueSlug('nomatch');
        $this->insertDoc($slug, 'No Match Doc', 'Body text here.', ['xyzzy_keyword_noop']);

        $results = $this->svc->findRelevant(self::TENANT_ID, 'How do I post a listing?');

        // The doc's keyword 'xyzzy_keyword_noop' is not in the message.
        $slugs = array_column($results, 'slug');
        $this->assertNotContains($slug, $slugs);
    }

    public function test_findRelevant_returns_doc_when_keyword_matches(): void
    {
        $slug = $this->uniqueSlug('wallet');
        $this->insertDoc($slug, 'Wallet Doc', 'About your wallet.', ['wallet', 'balance']);

        $results = $this->svc->findRelevant(self::TENANT_ID, 'What is my wallet balance?');

        $slugs = array_column($results, 'slug');
        $this->assertContains($slug, $slugs);
    }

    public function test_findRelevant_is_case_insensitive(): void
    {
        $slug = $this->uniqueSlug('events');
        $this->insertDoc($slug, 'Events Doc', 'About events.', ['Events', 'RSVP']);

        $results = $this->svc->findRelevant(self::TENANT_ID, 'how do i rsvp to an event');

        $slugs = array_column($results, 'slug');
        $this->assertContains($slug, $slugs);
    }

    public function test_findRelevant_excludes_inactive_docs(): void
    {
        $slug = $this->uniqueSlug('inactive');
        $this->insertDoc($slug, 'Inactive Doc', 'Should not appear.', ['inactive_kw_test'], false);

        $results = $this->svc->findRelevant(self::TENANT_ID, 'inactive_kw_test query');

        $slugs = array_column($results, 'slug');
        $this->assertNotContains($slug, $slugs);
    }

    public function test_findRelevant_respects_tenant_isolation(): void
    {
        $slug = $this->uniqueSlug('othertenant');
        // Insert under a different tenant.
        $this->insertDoc($slug, 'Other Tenant Doc', 'Body.', ['othertenant_unique_kw'], true, self::OTHER_TENANT_ID);

        $results = $this->svc->findRelevant(self::TENANT_ID, 'othertenant_unique_kw');

        $slugs = array_column($results, 'slug');
        $this->assertNotContains($slug, $slugs);
    }

    public function test_findRelevant_caps_results_at_four(): void
    {
        // Insert 6 docs all matching the same keyword so > MAX_INJECTED will match.
        $kw = 'capstest_' . substr(md5(uniqid('', true)), 0, 6);
        for ($i = 0; $i < 6; $i++) {
            $slug = $this->uniqueSlug('cap' . $i);
            $this->insertDoc($slug, "Cap Doc $i", "Body $i.", [$kw]);
        }

        $results = $this->svc->findRelevant(self::TENANT_ID, "I need help with $kw");

        $this->assertLessThanOrEqual(4, count($results));
    }

    public function test_findRelevant_higher_score_doc_outranks_lower(): void
    {
        $kw  = 'scoring_' . substr(md5(uniqid('', true)), 0, 6);
        // Doc A: one short keyword hit.
        $slugA = $this->uniqueSlug('scorea');
        $this->insertDoc($slugA, 'Score A', 'Body A.', [$kw]);
        // Doc B: two keyword hits (multi-keyword message).
        $slugB = $this->uniqueSlug('scoreb');
        $this->insertDoc($slugB, 'Score B', 'Body B.', [$kw, 'bonus_kw']);

        $results = $this->svc->findRelevant(self::TENANT_ID, "$kw and also bonus_kw");

        $slugs = array_column($results, 'slug');
        $posA  = array_search($slugA, $slugs);
        $posB  = array_search($slugB, $slugs);

        $this->assertNotFalse($posA, 'Doc A should appear');
        $this->assertNotFalse($posB, 'Doc B should appear');
        $this->assertLessThan($posA, $posB, 'Doc B (2 hits) should rank before Doc A (1 hit)');
    }

    public function test_findRelevant_falls_back_to_slug_when_no_keywords_stored(): void
    {
        $slug = $this->uniqueSlug('slugfall');
        // Insert with empty keywords array — service should use the slug itself.
        $this->insertDoc($slug, 'Slug Fallback Doc', 'Body about slug fallback.', []);

        // Message contains the slug string.
        $results = $this->svc->findRelevant(self::TENANT_ID, "Question about $slug thing");

        $slugs = array_column($results, 'slug');
        $this->assertContains($slug, $slugs);
    }

    public function test_findRelevant_result_contains_required_keys(): void
    {
        $kw   = 'reqkeys_' . substr(md5(uniqid('', true)), 0, 6);
        $slug = $this->uniqueSlug('reqkeys');
        $this->insertDoc($slug, 'Required Keys Doc', 'Body text.', [$kw]);

        $results = $this->svc->findRelevant(self::TENANT_ID, $kw);

        $this->assertNotEmpty($results);
        $doc = $results[0];
        $this->assertArrayHasKey('slug', $doc);
        $this->assertArrayHasKey('title', $doc);
        $this->assertArrayHasKey('body', $doc);
        $this->assertArrayHasKey('matched_keyword', $doc);
    }

    public function test_findRelevant_truncates_body_at_the_injection_limit(): void
    {
        $kw   = 'longbody_' . substr(md5(uniqid('', true)), 0, 6);
        $slug = $this->uniqueSlug('longbody');
        $longBody = str_repeat("x", AiModuleDocsService::MAX_BODY_INJECT_CHARS + 800);
        $this->insertDoc($slug, 'Long Body Doc', $longBody, [$kw]);

        $results = $this->svc->findRelevant(self::TENANT_ID, $kw);

        $match = null;
        foreach ($results as $r) {
            if ($r['slug'] === $slug) {
                $match = $r;
                break;
            }
        }
        $this->assertNotNull($match, 'Long body doc should be returned');
        $this->assertSame(AiModuleDocsService::MAX_BODY_INJECT_CHARS, mb_strlen($match["body"]));
    }

    // ── renderForPrompt() ─────────────────────────────────────────────────────

    public function test_renderForPrompt_returns_empty_string_when_no_match(): void
    {
        $output = $this->svc->renderForPrompt(self::TENANT_ID, 'xyzzy_noop_phrase_nobody_would_say');

        $this->assertSame('', $output);
    }

    public function test_renderForPrompt_returns_markdown_section_when_match(): void
    {
        $kw   = 'rendertest_' . substr(md5(uniqid('', true)), 0, 6);
        $slug = $this->uniqueSlug('rendertest');
        $this->insertDoc($slug, 'Render Test Doc', 'Some body content.', [$kw]);

        $output = $this->svc->renderForPrompt(self::TENANT_ID, "Can you help with $kw?");

        $this->assertStringContainsString('## Admin Module Docs', $output);
        $this->assertStringContainsString('Render Test Doc', $output);
        $this->assertStringContainsString($slug, $output);
        $this->assertStringContainsString('Some body content.', $output);
    }

    // ── upsert() ─────────────────────────────────────────────────────────────

    public function test_upsert_inserts_new_doc_and_returns_it(): void
    {
        $slug = $this->uniqueSlug('upsertins');
        $result = $this->svc->upsert(self::TENANT_ID, self::ADMIN_USER_ID, [
            'module_slug' => $slug,
            'title'       => 'Upsert Insert Test',
            'body'        => 'Some body text for new doc.',
            'keywords'    => ['keyword1', 'keyword2'],
            'is_active'   => true,
        ]);

        $this->assertIsArray($result);
        $this->assertSame($slug, $result['module_slug']);
        $this->assertSame('Upsert Insert Test', $result['title']);
        $this->assertContains('keyword1', $result['keywords']);
    }

    public function test_upsert_updates_existing_doc_by_slug(): void
    {
        $slug = $this->uniqueSlug('upsertupd');
        // First insert.
        $this->svc->upsert(self::TENANT_ID, self::ADMIN_USER_ID, [
            'module_slug' => $slug,
            'title'       => 'Original Title',
            'body'        => 'Original body.',
            'keywords'    => ['kw_a'],
        ]);

        // Second upsert with same slug — should update.
        $result = $this->svc->upsert(self::TENANT_ID, self::ADMIN_USER_ID, [
            'module_slug' => $slug,
            'title'       => 'Updated Title',
            'body'        => 'Updated body.',
            'keywords'    => ['kw_b'],
        ]);

        $this->assertSame('Updated Title', $result['title']);
        $this->assertSame('Updated body.', $result['body']);
        // Only one row should exist for this slug + tenant.
        $count = DB::table('ai_module_docs')
            ->where('tenant_id', self::TENANT_ID)
            ->where('module_slug', $slug)
            ->count();
        $this->assertSame(1, $count);
    }

    public function test_upsert_throws_when_slug_is_blank(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        $this->svc->upsert(self::TENANT_ID, self::ADMIN_USER_ID, [
            'module_slug' => '',
            'title'       => 'Title',
            'body'        => 'Body',
        ]);
    }

    public function test_upsert_throws_when_title_is_blank(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        $this->svc->upsert(self::TENANT_ID, self::ADMIN_USER_ID, [
            'module_slug' => $this->uniqueSlug('notable'),
            'title'       => '',
            'body'        => 'Body',
        ]);
    }

    public function test_upsert_throws_when_body_is_blank(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        $this->svc->upsert(self::TENANT_ID, self::ADMIN_USER_ID, [
            'module_slug' => $this->uniqueSlug('nobody'),
            'title'       => 'Title',
            'body'        => '',
        ]);
    }

    public function test_upsert_throws_for_invalid_slug_characters(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        $this->svc->upsert(self::TENANT_ID, self::ADMIN_USER_ID, [
            'module_slug' => 'Invalid Slug With Spaces!',
            'title'       => 'Title',
            'body'        => 'Body',
        ]);
    }

    // ── delete() ─────────────────────────────────────────────────────────────

    public function test_delete_removes_doc_and_returns_true(): void
    {
        $slug = $this->uniqueSlug('del');
        $id   = $this->insertDoc($slug, 'To Delete', 'body');

        $result = $this->svc->delete(self::TENANT_ID, $id);

        $this->assertTrue($result);
        $this->assertNull(DB::table('ai_module_docs')->where('id', $id)->first());
    }

    public function test_delete_returns_false_for_nonexistent_id(): void
    {
        $result = $this->svc->delete(self::TENANT_ID, 999999999);

        $this->assertFalse($result);
    }

    public function test_delete_respects_tenant_isolation(): void
    {
        $slug = $this->uniqueSlug('deliso');
        $id   = $this->insertDoc($slug, 'Isolated Delete', 'body', [], true, self::OTHER_TENANT_ID);

        // Attempt to delete from tenant 2 — should not touch the other tenant's row.
        $result = $this->svc->delete(self::TENANT_ID, $id);

        $this->assertFalse($result);
        // Row should still exist under the other tenant.
        $this->assertNotNull(DB::table('ai_module_docs')->where('id', $id)->first());
    }

    // ── getById() ─────────────────────────────────────────────────────────────

    public function test_getById_returns_array_with_decoded_keywords(): void
    {
        $slug = $this->uniqueSlug('getbyid');
        $id   = $this->insertDoc($slug, 'Get By ID Doc', 'Body text.', ['kw1', 'kw2']);

        $result = $this->svc->getById(self::TENANT_ID, $id);

        $this->assertIsArray($result);
        $this->assertSame($slug, $result['module_slug']);
        $this->assertIsArray($result['keywords']);
        $this->assertContains('kw1', $result['keywords']);
        $this->assertContains('kw2', $result['keywords']);
        $this->assertIsBool($result['is_active']);
    }

    public function test_getById_throws_for_nonexistent_id(): void
    {
        $this->expectException(\RuntimeException::class);

        $this->svc->getById(self::TENANT_ID, 999999999);
    }

    // ── listForTenant() ───────────────────────────────────────────────────────

    public function test_listForTenant_returns_all_tenant_docs(): void
    {
        // Count pre-existing docs so we can assert delta.
        $before = count($this->svc->listForTenant(self::TENANT_ID));

        $slug1 = $this->uniqueSlug('list1');
        $slug2 = $this->uniqueSlug('list2');
        $this->insertDoc($slug1, 'List Doc 1', 'Body 1.');
        $this->insertDoc($slug2, 'List Doc 2', 'Body 2.');

        $all = $this->svc->listForTenant(self::TENANT_ID);

        $this->assertCount($before + 2, $all);
        $slugs = array_column(array_map(fn ($r) => (array) $r, $all), 'module_slug');
        $this->assertContains($slug1, $slugs);
        $this->assertContains($slug2, $slugs);
    }

    public function test_listForTenant_does_not_include_other_tenant_docs(): void
    {
        $slug = $this->uniqueSlug('listother');
        $this->insertDoc($slug, 'Other Tenant List Doc', 'Body.', [], true, self::OTHER_TENANT_ID);

        $all   = $this->svc->listForTenant(self::TENANT_ID);
        $slugs = array_column(array_map(fn ($r) => (array) $r, $all), 'module_slug');

        $this->assertNotContains($slug, $slugs);
    }

    // ── seedDefaultsForTenant() ───────────────────────────────────────────────

    public function test_listForTenant_marks_only_unchanged_seed_titles_with_a_stable_code(): void
    {
        $isolatedTenant = 999904;
        $this->svc->seedDefaultsForTenant($isolatedTenant);

        $overview = collect($this->svc->listForTenant($isolatedTenant))
            ->first(fn ($row) => $row->module_slug === 'overview');

        $this->assertNotNull($overview);
        $this->assertSame('overview', $overview->default_title_code);

        DB::table('ai_module_docs')
            ->where('tenant_id', $isolatedTenant)
            ->where('module_slug', 'overview')
            ->update(['title' => 'Our community overview']);

        $customOverview = collect($this->svc->listForTenant($isolatedTenant))
            ->first(fn ($row) => $row->module_slug === 'overview');

        $this->assertNotNull($customOverview);
        $this->assertNull($customOverview->default_title_code);
    }

    public function test_seedDefaultsForTenant_is_idempotent(): void
    {
        // Use an isolated tenant to avoid polluting tenant 2.
        $isolatedTenant = 999902;

        $firstRun  = $this->svc->seedDefaultsForTenant($isolatedTenant);
        $secondRun = $this->svc->seedDefaultsForTenant($isolatedTenant);

        $this->assertGreaterThan(0, $firstRun, 'First run should insert at least one doc');
        $this->assertSame(0, $secondRun, 'Second run should insert nothing (idempotent)');
    }

    public function test_seedDefaultsForTenant_skips_existing_slugs(): void
    {
        $isolatedTenant = 999903;
        // Pre-insert the 'overview' slug so seed should skip it.
        DB::table('ai_module_docs')->insert([
            'tenant_id'   => $isolatedTenant,
            'module_slug' => 'overview',
            'title'       => 'Custom Overview',
            'body'        => 'Custom body that must not be overwritten.',
            'keywords'    => json_encode([]),
            'is_active'   => 1,
        ]);

        $this->svc->seedDefaultsForTenant($isolatedTenant);

        $row = DB::table('ai_module_docs')
            ->where('tenant_id', $isolatedTenant)
            ->where('module_slug', 'overview')
            ->first();

        // Title should be the custom one, not the built-in default.
        $this->assertSame('Custom Overview', $row->title);
    }

    // ── defaultSeed() ─────────────────────────────────────────────────────────

    public function test_defaultSeed_returns_non_empty_array(): void
    {
        $defaults = AiModuleDocsService::defaultSeed();

        $this->assertIsArray($defaults);
        $this->assertNotEmpty($defaults);
    }

    public function test_defaultSeed_every_entry_has_title_body_keywords(): void
    {
        $defaults = AiModuleDocsService::defaultSeed();

        foreach ($defaults as $slug => $data) {
            $this->assertArrayHasKey('title', $data, "Slug '$slug' missing 'title'");
            $this->assertArrayHasKey('body', $data, "Slug '$slug' missing 'body'");
            $this->assertArrayHasKey('keywords', $data, "Slug '$slug' missing 'keywords'");
            $this->assertNotEmpty($data['title'], "Slug '$slug' has empty title");
            $this->assertNotEmpty($data['body'], "Slug '$slug' has empty body");
            $this->assertIsArray($data['keywords'], "Slug '$slug' keywords should be an array");
        }
    }

    public function test_defaultSeed_slugs_are_valid_format(): void
    {
        $defaults = AiModuleDocsService::defaultSeed();

        foreach (array_keys($defaults) as $slug) {
            $this->assertMatchesRegularExpression(
                '/^[a-z0-9_\-]{1,64}$/',
                $slug,
                "Slug '$slug' does not match the allowed slug format"
            );
        }
    }
}
