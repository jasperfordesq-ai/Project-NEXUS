<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Services;

use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The "workshop or class" and "a team helping someone" kinds, and the community
 * fund's "group_exchange" ledger entry, exist in the database — appended to the
 * existing enums so the change is metadata-only.
 */
final class GroupExchangeKindsSchemaTest extends TestCase
{
    private function enumOf(string $table, string $column): string
    {
        $row = DB::selectOne(
            'SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
            [$table, $column],
        );

        return (string) ($row->t ?? '');
    }

    public function test_split_type_has_the_two_new_kinds_appended(): void
    {
        self::assertSame(
            "enum('equal','custom','weighted','workshop','team')",
            $this->enumOf('group_exchanges', 'split_type'),
        );
    }

    public function test_community_fund_can_record_group_exchange_income(): void
    {
        self::assertSame(
            "enum('deposit','withdrawal','donation','starting_balance_grant','group_exchange')",
            $this->enumOf('community_fund_transactions', 'type'),
        );
    }
}
