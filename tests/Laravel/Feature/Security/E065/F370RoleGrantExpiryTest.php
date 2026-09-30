<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-370 (E-065) — `user_roles.expires_at` was honoured by four copies of the
 * "does this member hold role X" predicate and ignored by two.
 *
 * Honoured: `EnsureIsAdmin:99-101`, `VereinMemberImportService:309-311`,
 * `TwoFactorPolicy:44`, `Enterprise\PermissionService:427`.
 * Ignored: `MunicipalSurveyController:76-82` and `FeedService:1536-1541`.
 *
 * The municipal-survey half is resolved by the F-347 fix — that controller no
 * longer reads `user_roles` at all, because the feed-announcer grant no longer
 * confers survey administration. This file covers the remaining copy: the
 * official-notice badge in `FeedService::createPost()`.
 *
 * No API endpoint writes `user_roles.expires_at` today, so the precondition is
 * seeded directly, exactly as the E-065 reproduction
 * `.local-docs-archive/security-log/E-065/repro/j/AnnouncerGrantExpiryTest.php`
 * did. Its attack assertion is inverted here.
 */
final class F370RoleGrantExpiryTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT = 2;

    private int $memberId = 0;
    private int $roleId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        // No schema guard here on purpose. Every table and column this test
        // touches is in the committed schema dump, so a guard could never fire
        // in CI and would only hide a broken fixture locally — which is what the
        // pre-commit schema-skip budget exists to prevent.

        $this->enableFeed();
        TenantContext::setById(self::TENANT);

        $this->memberId = $this->makeMember();

        DB::table('roles')->insertOrIgnore([
            'name' => 'municipality_announcer',
            'display_name' => 'Municipality Announcer',
            'description' => 'Verified municipal authority that can post pinned official notices to the community feed.',
            'level' => 5,
            'is_system' => 1,
            'tenant_id' => null,
        ]);
        $this->roleId = (int) DB::table('roles')->where('name', 'municipality_announcer')->value('id');
    }

    /**
     * A grant that expired yesterday must not badge a feed post as official.
     */
    public function test_expired_announcer_grant_does_not_badge_a_post_official(): void
    {
        $this->grant(expiresAt: now()->subDay());

        $isOfficial = $this->postAndReadIsOfficial('F370 expired grant ');

        $this->assertSame(
            0,
            $isOfficial,
            'BAD OUTCOME: a grant that expired yesterday still badged a feed post as an '
            . 'official municipal notice.'
        );
    }

    /**
     * CONTROL — an unexpired grant still badges the post, so the case above
     * does not pass because the feature broke.
     */
    public function test_control_unexpired_grant_still_badges_a_post_official(): void
    {
        $this->grant(expiresAt: now()->addYear());

        $this->assertSame(1, $this->postAndReadIsOfficial('F370 live grant '));
    }

    /**
     * CONTROL — a member with no grant is never badged official.
     */
    public function test_control_member_without_a_grant_is_not_official(): void
    {
        $this->assertSame(0, $this->postAndReadIsOfficial('F370 no grant '));
    }

    // ── fixtures ───────────────────────────────────────────────────────────

    private function postAndReadIsOfficial(string $prefix): int
    {
        Sanctum::actingAs(User::find($this->memberId));

        $content = $prefix . bin2hex(random_bytes(5));
        $response = $this->postJson('/api/v2/feed/posts', ['content' => $content], $this->withTenantHeader());
        $this->assertSame(201, $response->getStatusCode(), $response->getContent());

        $row = DB::table('feed_posts')
            ->where('tenant_id', self::TENANT)
            ->where('content', $content)
            ->first(['is_official']);
        $this->assertNotNull($row, 'the post was not stored');

        return (int) $row->is_official;
    }

    private function grant(?\DateTimeInterface $expiresAt): void
    {
        DB::table('user_roles')->insert([
            'user_id' => $this->memberId,
            'role_id' => $this->roleId,
            'tenant_id' => self::TENANT,
            'assigned_by' => null,
            'expires_at' => $expiresAt,
        ]);
    }

    private function enableFeed(): void
    {
        $tenant = DB::table('tenants')->where('id', self::TENANT)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['feed'] = true;
        DB::table('tenants')->where('id', self::TENANT)->update(['features' => json_encode($features)]);
        TenantContext::reset();
        TenantContext::setById(self::TENANT);
    }

    private function makeMember(): int
    {
        $email = 'f370.member.' . bin2hex(random_bytes(5)) . '@example.test';

        return (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT,
            'name' => 'F370 Member',
            'first_name' => 'F370',
            'last_name' => 'Member',
            'email' => $email,
            'username' => 'f370_' . substr(md5($email), 0, 10),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'role' => 'member',
            'status' => 'active',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
