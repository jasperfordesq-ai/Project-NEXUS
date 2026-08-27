<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\AI;

use App\Core\TenantContext;
use App\Services\AI\AiUserMemoryService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * AiUserMemoryServiceTest
 *
 * Tests AiUserMemoryService::buildPrompt() which produces a personalised
 * system-context string for AI chat.
 *
 * Strategy:
 *   - Seed minimal user + (optionally) listing rows in tenant 2.
 *   - Verify the prompt includes the expected fields for the seeded data.
 *   - Verify missing / null fields are omitted gracefully.
 *   - Verify tenant isolation (wrong tenant_id → empty string).
 *   - Verify non-existent user → empty string.
 *   - Verify organisation profile type uses organization_name instead of name.
 *   - Verify balance is formatted with 2 decimal places.
 *   - Verify recent listings are appended when present.
 */
class AiUserMemoryServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    private AiUserMemoryService $service;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        TenantContext::setById(self::TENANT_ID);
        $this->service = new AiUserMemoryService();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private function insertUser(array $overrides = []): int
    {
        $uid = uniqid('', true);
        // preferred_language is NOT NULL DEFAULT 'en' in the test DB — do not pass
        // null; omit the key so the DB default applies.  Other nullable columns are
        // fine to pass null explicitly.
        $defaults = [
            'tenant_id'          => self::TENANT_ID,
            'name'               => 'Test User ' . $uid,
            'first_name'         => 'Alice',
            'last_name'          => 'Smith',
            'email'              => 'alice.' . $uid . '@example.test',
            'role'               => 'member',
            'profile_type'       => 'individual',
            'organization_name'  => null,
            'preferred_language' => 'en',   // NOT NULL DEFAULT 'en' in test DB
            'tagline'            => null,
            'location'           => null,
            'skills'             => null,
            'balance'            => 5.00,
            'status'             => 'active',
            'is_approved'        => 1,
            'created_at'         => now(),
        ];
        return DB::table('users')->insertGetId(array_merge($defaults, $overrides));
    }

    private function insertListing(int $userId, string $title, string $status = 'active'): int
    {
        return DB::table('listings')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'user_id'    => $userId,
            'title'      => $title,
            'type'       => 'offer',
            'status'     => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ── tests ─────────────────────────────────────────────────────────────────

    public function test_returns_empty_string_for_nonexistent_user(): void
    {
        $prompt = $this->service->buildPrompt(self::TENANT_ID, 999999999);

        $this->assertSame('', $prompt);
    }

    public function test_returns_empty_string_when_tenant_mismatch(): void
    {
        // Insert user under tenant 2 but query with a different tenant id.
        $userId = $this->insertUser();

        $prompt = $this->service->buildPrompt(99902, $userId);

        $this->assertSame('', $prompt);
    }

    public function test_prompt_contains_user_name(): void
    {
        $userId = $this->insertUser(['first_name' => 'Bob', 'last_name' => 'Jones']);

        $prompt = $this->service->buildPrompt(self::TENANT_ID, $userId);

        $this->assertStringContainsString('Bob Jones', $prompt);
    }

    public function test_prompt_contains_role(): void
    {
        $userId = $this->insertUser(['role' => 'admin']);

        $prompt = $this->service->buildPrompt(self::TENANT_ID, $userId);

        $this->assertStringContainsString('admin', $prompt);
    }

    public function test_prompt_contains_balance_with_two_decimal_places(): void
    {
        $userId = $this->insertUser(['balance' => 12.5]);

        $prompt = $this->service->buildPrompt(self::TENANT_ID, $userId);

        $this->assertStringContainsString('12.50', $prompt);
    }

    public function test_prompt_contains_preferred_language(): void
    {
        $userId = $this->insertUser(['preferred_language' => 'ga']);

        $prompt = $this->service->buildPrompt(self::TENANT_ID, $userId);

        $this->assertStringContainsString('ga', $prompt);
        $this->assertStringContainsString('reply in this language', $prompt);
    }

    public function test_prompt_contains_location_when_set(): void
    {
        $userId = $this->insertUser(['location' => 'Galway, Ireland']);

        $prompt = $this->service->buildPrompt(self::TENANT_ID, $userId);

        $this->assertStringContainsString('Galway, Ireland', $prompt);
    }

    public function test_prompt_omits_location_when_null(): void
    {
        $userId = $this->insertUser(['location' => null]);

        $prompt = $this->service->buildPrompt(self::TENANT_ID, $userId);

        $this->assertStringNotContainsString('Location:', $prompt);
    }

    public function test_organisation_profile_uses_organisation_name(): void
    {
        $userId = $this->insertUser([
            // BRITISH value, AMERICAN column. Seeding 'organization' here made this
            // test pass only while the service carried the same misspelling, so its
            // organisation branch never once ran. See App\Support\UserDisplayName.
            'profile_type'      => 'organisation',
            'organization_name' => 'Green Thumb Co-op',
            'first_name'        => 'Bob',
            'last_name'         => 'Ignored',
        ]);

        $prompt = $this->service->buildPrompt(self::TENANT_ID, $userId);

        $this->assertStringContainsString('Green Thumb Co-op', $prompt);
        // Should NOT fall back to personal name for an org profile.
        $this->assertStringNotContainsString('Bob Ignored', $prompt);
    }

    public function test_prompt_contains_skills_when_set(): void
    {
        $userId = $this->insertUser(['skills' => 'gardening, carpentry']);

        $prompt = $this->service->buildPrompt(self::TENANT_ID, $userId);

        $this->assertStringContainsString('gardening', $prompt);
    }

    public function test_prompt_includes_recent_active_listings(): void
    {
        $userId = $this->insertUser();
        $this->insertListing($userId, 'Offer gardening help');
        $this->insertListing($userId, 'Baking lessons available');

        $prompt = $this->service->buildPrompt(self::TENANT_ID, $userId);

        $this->assertStringContainsString('Offer gardening help', $prompt);
        $this->assertStringContainsString('Baking lessons available', $prompt);
    }

    public function test_prompt_excludes_inactive_listings(): void
    {
        $userId = $this->insertUser();
        $this->insertListing($userId, 'Inactive listing', 'inactive');

        $prompt = $this->service->buildPrompt(self::TENANT_ID, $userId);

        $this->assertStringNotContainsString('Inactive listing', $prompt);
    }

    public function test_prompt_starts_with_current_user_heading(): void
    {
        $userId = $this->insertUser();

        $prompt = $this->service->buildPrompt(self::TENANT_ID, $userId);

        $this->assertStringContainsString('## Current user', $prompt);
    }

    public function test_skills_are_truncated_to_200_chars(): void
    {
        $longSkills = str_repeat('gardening ', 25); // 250 chars
        $userId = $this->insertUser(['skills' => $longSkills]);

        $prompt = $this->service->buildPrompt(self::TENANT_ID, $userId);

        // The skills line itself should contain at most 200 chars from skills.
        preg_match('/- Skills: (.+)/u', $prompt, $matches);
        $this->assertNotEmpty($matches);
        $this->assertLessThanOrEqual(200, mb_strlen($matches[1]));
    }
}
