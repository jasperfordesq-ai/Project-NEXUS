<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\GroupModerationService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class GroupModerationServiceTest extends TestCase
{
    public function test_action_constants_are_defined(): void
    {
        $this->assertEquals('flag', GroupModerationService::ACTION_FLAG);
        $this->assertEquals('hide', GroupModerationService::ACTION_HIDE);
        $this->assertEquals('delete', GroupModerationService::ACTION_DELETE);
        $this->assertEquals('approve', GroupModerationService::ACTION_APPROVE);
    }

    public function test_content_type_constants_are_defined(): void
    {
        $this->assertEquals('group', GroupModerationService::CONTENT_GROUP);
        $this->assertEquals('discussion', GroupModerationService::CONTENT_DISCUSSION);
        $this->assertEquals('post', GroupModerationService::CONTENT_POST);
    }

    public function test_reason_constants_are_defined(): void
    {
        $this->assertEquals('spam', GroupModerationService::REASON_SPAM);
        $this->assertEquals('harassment', GroupModerationService::REASON_HARASSMENT);
        $this->assertEquals('inappropriate', GroupModerationService::REASON_INAPPROPRIATE);
        $this->assertEquals('hate_speech', GroupModerationService::REASON_HATE_SPEECH);
        $this->assertEquals('other', GroupModerationService::REASON_OTHER);
    }

    public function test_flagContent_returns_id_on_success(): void
    {
        DB::shouldReceive('table->insertGetId')->andReturn(5);

        $result = GroupModerationService::flagContent('post', 1, 10, 'spam', 'This is spam');
        $this->assertEquals(5, $result);
    }

    public function test_flagContent_returns_null_on_failure(): void
    {
        DB::shouldReceive('table->insertGetId')->andThrow(new \Exception('error'));
        Log::shouldReceive('warning')->once();

        $result = GroupModerationService::flagContent('post', 1, 10);
        $this->assertNull($result);
    }

    public function test_moderateContent_returns_false_when_flag_not_found(): void
    {
        DB::shouldReceive('table->where->where->first')->andReturn(null);

        $result = GroupModerationService::moderateContent(999, 'approve', 10);
        $this->assertFalse($result);
    }

    /**
     * Regression: isUserBanned() queried a `group_bans` table that never existed in
     * any migration or in the schema dump. The query sat inside a catch-all that
     * logged a warning and returned false, so it reported "not banned" for everyone
     * while looking like an enforced control.
     *
     * Platform-wide group bans are not a feature. The real, enforced ban is
     * per-group — `group_members.status = 'banned'`, checked in GroupService.
     *
     * If you reintroduce a ban check here, create the backing table in a migration
     * FIRST and refresh database/schema/mysql-schema.sql, or this assertion fires.
     */
    public function test_isUserBanned_is_not_reintroduced_without_a_backing_table(): void
    {
        $this->assertFalse(
            method_exists(GroupModerationService::class, 'isUserBanned'),
            'isUserBanned() was removed because it queried the nonexistent `group_bans` '
            . 'table and silently returned false. Add the migration before restoring it.'
        );
    }

    /**
     * Regression: every table this service queries must actually exist.
     *
     * `group_bans` did not, and because each method swallows \Throwable the failure
     * was invisible. This asserts the invariant for all tables at once so the next
     * imagined table is caught at test time rather than by a log warning in prod.
     */
    public function test_every_queried_table_exists_in_the_schema_dump(): void
    {
        $source = file_get_contents(base_path('app/Services/GroupModerationService.php'));
        $schema = $this->schemaDump();

        preg_match_all("/DB::table\('([a-z0-9_]+)'\)/", (string) $source, $matches);
        $tables = array_unique($matches[1]);

        $this->assertNotEmpty($tables, 'Expected to find at least one DB::table() call.');

        foreach ($tables as $table) {
            $this->assertStringContainsString(
                "CREATE TABLE `{$table}`",
                $schema,
                "GroupModerationService queries `{$table}`, which has no CREATE TABLE in "
                . 'database/schema/mysql-schema.sql. Add a migration and refresh the dump.'
            );
        }
    }

    /**
     * Regression: the write paths targeted columns that do not exist either —
     * `updated_at`, `moderated_at` and `action_taken` on `group_content_flags`
     * (the real columns are `resolved_at` and `moderation_action`, and there is no
     * `updated_at` at all). Every insert and update therefore threw, was swallowed,
     * and reported failure — flagging and moderation were both permanently dead.
     */
    public function test_group_content_flags_columns_used_by_write_paths_exist(): void
    {
        $columns = $this->columnsOf('group_content_flags');

        // The exact set flagContent() inserts and moderateContent() updates.
        $used = [
            'tenant_id', 'content_type', 'content_id', 'reported_by', 'reason',
            'description', 'status', 'created_at',
            'moderated_by', 'moderator_notes', 'resolved_at', 'moderation_action',
        ];

        foreach ($used as $column) {
            $this->assertContains(
                $column,
                $columns,
                "group_content_flags has no `{$column}` column, but GroupModerationService "
                . 'writes it. The insert/update would throw and be silently swallowed.'
            );
        }

        // Columns the old code wrote that have never existed on this table.
        foreach (['updated_at', 'moderated_at', 'action_taken'] as $absent) {
            $this->assertNotContains($absent, $columns);
        }
    }

    private function schemaDump(): string
    {
        $path = base_path('database/schema/mysql-schema.sql');
        $this->assertFileExists($path);

        return (string) file_get_contents($path);
    }

    /**
     * @return list<string>
     */
    private function columnsOf(string $table): array
    {
        $schema = $this->schemaDump();

        $start = strpos($schema, "CREATE TABLE `{$table}` (");
        $this->assertNotFalse($start, "No CREATE TABLE for `{$table}` in the schema dump.");

        $end = strpos($schema, 'ENGINE=', $start);
        $this->assertNotFalse($end);

        $block = substr($schema, $start, $end - $start);

        // Column definitions are the backticked identifiers at the start of a line.
        preg_match_all('/^\s+`([a-z0-9_]+)`\s+[a-z]/mi', $block, $matches);

        return array_values(array_unique($matches[1]));
    }
}
