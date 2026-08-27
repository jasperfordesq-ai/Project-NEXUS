<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\AI\Tools;

use App\Core\TenantContext;
use App\Services\AI\Tools\SearchMembersTool;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * SearchMembersToolTest
 *
 * Tests the SearchMembersTool which queries the `users` table for active
 * members scoped to the current tenant, matching on skills / bio / tagline /
 * name / organization_name.
 *
 * Privacy note: the tool must never leak email or phone — confirmed by shape
 * assertion.
 *
 * Strategy:
 *  - Seed minimal users via DB::table — unique email per row.
 *  - Assert metadata, query matching, location filter, limit, empty returns,
 *    self-exclusion (callerUserId excluded from results), tenant scoping.
 *  - DatabaseTransactions rolls back all inserts automatically.
 */
class SearchMembersToolTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID       = 2;
    private const OTHER_TENANT_ID = 1;

    private SearchMembersTool $tool;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        TenantContext::setById(self::TENANT_ID);
        $this->tool = new SearchMembersTool();
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private function insertUser(array $overrides = [], int $tenantId = self::TENANT_ID): int
    {
        $uid = uniqid('mu', true);
        $defaults = [
            'tenant_id'   => $tenantId,
            'name'        => 'Test Member ' . $uid,
            'first_name'  => 'Test',
            'last_name'   => 'Member',
            'email'       => "member.{$uid}@example.test",
            'status'      => 'active',
            'role'        => 'member',
            'is_approved' => 1,
            'balance'     => 0,
            'skills'      => null,
            'bio'         => null,
            'tagline'     => null,
            'location'    => null,
            'profile_type' => 'individual',
            'organization_name' => null,
            'created_at'  => now()->toDateTimeString(),
            'updated_at'  => now()->toDateTimeString(),
        ];
        return DB::table('users')->insertGetId(array_merge($defaults, $overrides));
    }

    // ─── Metadata ─────────────────────────────────────────────────────────────

    public function test_name_returns_search_members(): void
    {
        $this->assertSame('search_members', $this->tool->name());
    }

    public function test_parameters_schema_has_required_query(): void
    {
        $schema = $this->tool->parametersSchema();

        $this->assertSame('object', $schema['type']);
        $this->assertArrayHasKey('query', $schema['properties']);
        $this->assertArrayHasKey('location', $schema['properties']);
        $this->assertArrayHasKey('limit', $schema['properties']);
        $this->assertContains('query', $schema['required']);
    }

    // ─── Execute: empty query guard ───────────────────────────────────────────

    public function test_execute_returns_error_when_query_is_empty(): void
    {
        $result = $this->tool->execute(['query' => ''], 1);

        $this->assertFalse($result['ok']);
        $this->assertNotEmpty($result['error']);
        $this->assertSame([], $result['results']);
    }

    // ─── Execute: matching on skills ─────────────────────────────────────────

    public function test_execute_returns_member_matching_skills(): void
    {
        $token = 'Carpentry' . uniqid();
        $id = $this->insertUser(['skills' => "Woodwork, {$token}, Joinery"]);

        $result = $this->tool->execute(['query' => $token], 999);

        $this->assertTrue($result['ok']);
        $ids = array_column($result['results'], 'id');
        $this->assertContains($id, $ids);
    }

    // ─── Execute: matching on bio ─────────────────────────────────────────────

    public function test_execute_returns_member_matching_bio(): void
    {
        $token = 'BIOKW' . uniqid();
        $id = $this->insertUser(['bio' => "I enjoy {$token} and community gardening."]);

        $result = $this->tool->execute(['query' => $token], 999);

        $this->assertTrue($result['ok']);
        $ids = array_column($result['results'], 'id');
        $this->assertContains($id, $ids);
    }

    // ─── Execute: matching on tagline ─────────────────────────────────────────

    public function test_execute_returns_member_matching_tagline(): void
    {
        $token = 'TGKW' . uniqid();
        $id = $this->insertUser(['tagline' => "Passionate about {$token}"]);

        $result = $this->tool->execute(['query' => $token], 999);

        $this->assertTrue($result['ok']);
        $ids = array_column($result['results'], 'id');
        $this->assertContains($id, $ids);
    }

    // ─── Execute: inactive users excluded ─────────────────────────────────────

    public function test_execute_excludes_inactive_users(): void
    {
        $token = 'INACTIVE' . uniqid();
        $this->insertUser(['status' => 'inactive', 'skills' => $token]);

        $result = $this->tool->execute(['query' => $token], 999);

        $this->assertTrue($result['ok']);
        $this->assertSame([], $result['results']);
    }

    // ─── Execute: caller excluded from results ────────────────────────────────

    public function test_execute_excludes_caller_user_from_results(): void
    {
        $token = 'SELFEXCL' . uniqid();
        $callerId = $this->insertUser(['skills' => $token]);

        $result = $this->tool->execute(['query' => $token], $callerId);

        $this->assertTrue($result['ok']);
        $ids = array_column($result['results'], 'id');
        $this->assertNotContains($callerId, $ids);
    }

    // ─── Execute: empty results ───────────────────────────────────────────────

    public function test_execute_returns_ok_with_empty_results_on_no_match(): void
    {
        $result = $this->tool->execute(['query' => 'ZZZ_NOMATCH_' . uniqid()], 1);

        $this->assertTrue($result['ok']);
        $this->assertSame([], $result['results']);
        $this->assertStringContainsString('No members matched', $result['summary']);
    }

    // ─── Execute: location filter ─────────────────────────────────────────────

    public function test_execute_filters_by_location(): void
    {
        $token    = 'LOCMBR' . uniqid();
        $idLondon = $this->insertUser(['skills' => $token, 'location' => 'London']);
        $idParis  = $this->insertUser(['skills' => $token, 'location' => 'Paris']);

        $result = $this->tool->execute(['query' => $token, 'location' => 'London'], 999);

        $this->assertTrue($result['ok']);
        $ids = array_column($result['results'], 'id');
        $this->assertContains($idLondon, $ids);
        $this->assertNotContains($idParis, $ids);
    }

    // ─── Execute: limit ───────────────────────────────────────────────────────

    public function test_execute_respects_limit_argument(): void
    {
        $token = 'LMTMBR' . uniqid();
        for ($i = 0; $i < 6; $i++) {
            $this->insertUser(['skills' => $token]);
        }

        $result = $this->tool->execute(['query' => $token, 'limit' => 3], 999);

        $this->assertTrue($result['ok']);
        $this->assertCount(3, $result['results']);
    }

    // ─── Execute: result shape — no PII ──────────────────────────────────────

    public function test_execute_result_does_not_contain_email_or_phone(): void
    {
        $token = 'SHAPEMBR' . uniqid();
        $this->insertUser(['skills' => $token, 'phone' => '+353 87 1234567']);

        $result = $this->tool->execute(['query' => $token], 999);

        $this->assertTrue($result['ok']);
        $this->assertNotEmpty($result['results']);

        $row = $result['results'][0];
        $this->assertArrayNotHasKey('email', $row, 'email must not be exposed');
        $this->assertArrayNotHasKey('phone', $row, 'phone must not be exposed');
    }

    public function test_execute_result_row_has_expected_public_keys(): void
    {
        $token = 'KEYCHK' . uniqid();
        $this->insertUser(['skills' => $token]);

        $result = $this->tool->execute(['query' => $token], 999);

        $this->assertTrue($result['ok']);
        $this->assertNotEmpty($result['results']);

        $row = $result['results'][0];
        foreach (['id', 'name', 'profile_type', 'tagline', 'location', 'skills', 'bio_excerpt', 'avatar_url', 'url'] as $key) {
            $this->assertArrayHasKey($key, $row, "Missing key: {$key}");
        }
        $this->assertIsInt($row['id']);
        $this->assertStringContainsString('/profile/', $row['url']);
    }

    // ─── Execute: tenant scoping ──────────────────────────────────────────────

    public function test_execute_does_not_return_members_from_other_tenants(): void
    {
        $token = 'TENANTMBR' . uniqid();
        $this->insertUser(['skills' => $token], self::OTHER_TENANT_ID);

        $result = $this->tool->execute(['query' => $token], 999);

        $this->assertTrue($result['ok']);
        $this->assertSame([], $result['results']);
    }

    // ─── Execute: organisation profile_type ──────────────────────────────────

    public function test_execute_matches_organization_name_for_org_profile(): void
    {
        $token = 'ORG' . uniqid();
        $id = $this->insertUser([
            // BRITISH value, AMERICAN column. See App\Support\UserDisplayName.
            'profile_type'      => 'organisation',
            'organization_name' => "The {$token} Society",
            'first_name'        => 'Alice',
            'last_name'         => 'Smith',
        ]);

        $result = $this->tool->execute(['query' => $token], 999);

        $this->assertTrue($result['ok']);
        $ids = array_column($result['results'], 'id');
        $this->assertContains($id, $ids);

        // For org profiles the display name should prefer organization_name.
        $row = array_values(array_filter($result['results'], fn ($r) => $r['id'] === $id))[0];
        $this->assertStringContainsString($token, $row['name']);
    }
}
