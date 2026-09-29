<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Database;

use App\Models\Group;
use App\Models\User;
use App\Services\GroupAssignmentService;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * O-087 / F-328 (E-063): a row written without a tenant must be refused, not
 * filed under a default community.
 *
 * These tables declared tenant_id DEFAULT 1 (the master tenant) or DEFAULT 0.
 * Under the connection's non-strict sql_mode an insert that forgot the tenant
 * therefore succeeded and put the row in the wrong community — TimeBank
 * Ireland reviews, group posts, a volunteer application and badges were found
 * in tenant 1 on production. Migration 2026_09_29_180000 drops the defaults and
 * adds a BEFORE INSERT trigger that refuses a NULL or 0 tenant.
 */
class TenantlessInsertRefusedTest extends TestCase
{
    use DatabaseTransactions;

    private int $memberId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->memberId = (int) User::factory()->create(['tenant_id' => $this->testTenantId])->id;
    }

    private const GUARDED = [
        'campaign_awards', 'comments', 'connections', 'event_rsvps', 'group_discussions',
        'group_members', 'group_posts', 'help_articles', 'help_article_feedback', 'legal_documents',
        'likes', 'marketplace_delivery_offers', 'post_shares', 'reviews', 'tenant_settings',
        'user_badges', 'vol_applications', 'vol_emergency_alert_recipients', 'vol_logs',
        'vol_opportunities', 'vol_reviews', 'vol_shifts', 'vol_shift_group_members',
        'exchange_history', 'message_reactions', 'poll_options', 'poll_votes',
        'user_hidden_posts', 'user_muted_users',
    ];

    /**
     * Tables allowed to keep a tenant_id default. Performance recording
     * deliberately stores requests that resolved no tenant as tenant 0, and a
     * view cannot be altered. Anything else defaulting tenant_id is the bug
     * this test exists to stop coming back.
     */
    private const DEFAULT_ALLOWED = [
        'performance_query_samples', 'performance_request_hourly', 'performance_request_samples',
        'v_legal_acceptance_stats',
    ];

    public function test_every_guarded_table_has_no_tenant_default_and_a_refusing_trigger(): void
    {
        foreach (self::GUARDED as $table) {
            $column = DB::selectOne(
                'SELECT COLUMN_DEFAULT AS d FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
                [$table, 'tenant_id'],
            );
            self::assertNotNull($column, "{$table}.tenant_id must exist");
            self::assertNull($column->d, "{$table}.tenant_id must not default to a community");

            $trigger = DB::selectOne(
                "SELECT ACTION_STATEMENT AS body FROM information_schema.TRIGGERS
                  WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = ?
                    AND ACTION_TIMING = 'BEFORE' AND EVENT_MANIPULATION = 'INSERT' AND TRIGGER_NAME = ?",
                [$table, "trg_{$table}_require_tenant"],
            );
            self::assertNotNull($trigger, "{$table} must refuse inserts without a tenant");
            self::assertStringContainsString('SIGNAL', (string) $trigger->body);
        }
    }

    public function test_no_other_table_silently_defaults_its_tenant(): void
    {
        $rows = DB::select(
            "SELECT TABLE_NAME AS t FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenant_id'
                AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NOT NULL"
        );
        $defaulting = array_values(array_diff(array_map(static fn ($r) => $r->t, $rows), self::DEFAULT_ALLOWED));
        sort($defaulting);

        self::assertSame(
            [],
            $defaulting,
            'These tables file a row under a default community when code forgets the tenant: '
            . implode(', ', $defaulting)
            . '. Drop the default and add a trg_<table>_require_tenant trigger, as 2026_09_29_180000 does.',
        );
    }

    public function test_a_like_without_a_tenant_is_refused_and_nothing_is_written(): void
    {
        $before = DB::table('likes')->count();

        foreach ([[], ['tenant_id' => 0], ['tenant_id' => null]] as $tenant) {
            try {
                DB::table('likes')->insert(array_merge(
                    ['user_id' => $this->memberId, 'target_type' => 'post', 'target_id' => 999001],
                    $tenant,
                ));
                self::fail('A like without a tenant was accepted: ' . json_encode($tenant));
            } catch (QueryException $e) {
                self::assertStringContainsString('likes: insert without a tenant_id refused', $e->getMessage());
            }
        }

        self::assertSame($before, DB::table('likes')->count());
    }

    public function test_insert_or_ignore_does_not_swallow_the_refusal(): void
    {
        $this->expectException(QueryException::class);
        $this->expectExceptionMessage('user_badges: insert without a tenant_id refused');

        DB::table('user_badges')->insertOrIgnore([
            'user_id' => $this->memberId,
            'badge_key' => 'e063_probe',
        ]);
    }

    /**
     * GroupAssignmentService inserted group_members without tenant_id, so an
     * automatic hub assignment was filed under tenant 1 (and now would be
     * refused). The membership must carry the assigning community.
     */
    public function test_automatic_group_assignment_records_the_community(): void
    {
        $parent = Group::factory()->create(['tenant_id' => $this->testTenantId, 'has_children' => 1]);
        $leaf = Group::factory()->create([
            'tenant_id' => $this->testTenantId,
            'parent_id' => $parent->id,
            'has_children' => 0,
            'name' => 'Zzqvillage E063 Hub',
            'location' => 'Zzqvillage',
        ]);

        $result = (new GroupAssignmentService())->assignUser(['id' => $this->memberId, 'location' => 'Zzqvillage']);

        self::assertSame('ASSIGNED: Zzqvillage E063 Hub', $result);
        self::assertSame(
            $this->testTenantId,
            (int) DB::table('group_members')->where('group_id', $leaf->id)->where('user_id', $this->memberId)->value('tenant_id'),
        );
    }

    public function test_rows_that_name_their_community_still_save(): void
    {
        DB::table('likes')->insert([
            'user_id' => $this->memberId, 'target_type' => 'post', 'target_id' => 999001, 'tenant_id' => 2,
        ]);
        DB::table('user_badges')->insert([
            'user_id' => $this->memberId, 'badge_key' => 'e063_probe', 'tenant_id' => 1,
        ]);

        self::assertSame(2, (int) DB::table('likes')->where('user_id', $this->memberId)->value('tenant_id'));
        self::assertSame(1, (int) DB::table('user_badges')->where('user_id', $this->memberId)->value('tenant_id'));
    }
}
