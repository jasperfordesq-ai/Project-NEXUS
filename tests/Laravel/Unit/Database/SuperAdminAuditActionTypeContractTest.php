<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Database;

use App\Services\SuperAdminAuditService;
use PHPUnit\Framework\TestCase;

/**
 * Pins SuperAdminAuditService's action-type map to the super_admin_audit_log
 * `action_type` enum.
 *
 * 🔴 Why this test exists. The platform runs MariaDB with `strict => false`
 * (config/database.php), which makes Laravel issue
 * `sql_mode='NO_ENGINE_SUBSTITUTION'` — STRICT_TRANS_TABLES is removed. Writing a
 * value the enum does not contain therefore does NOT throw: MariaDB coerces it to
 * '' (warning 1265, which PDO never raises) and the INSERT reports success. So this
 * class of drift is invisible at runtime and invisible to the return value of the
 * insert — 'tenant_purged' was written by TenantPurgeService from 2026-03 until
 * 2026-08 and every purge landed with a blank action_type, including a real
 * production purge on 2026-07-05. Nothing failed; the record was simply unfindable.
 *
 * Deliberately reads the committed schema dump rather than a live connection, for
 * the reason set out in scripts/check-db-column-references.mjs: a check that needs
 * a database can pass vacuously on a runner pointed at an empty schema, and
 * "0 problems" then means "nothing was looked at". This test needs no database, so
 * it holds on a stale local nexus_test and with Docker stopped, and a schema dump
 * it cannot parse is an explicit failure rather than a silent pass.
 *
 * The live round-trip counterpart — proving the developer's own database has been
 * migrated — lives in Tests\Laravel\Feature\SchemaWriteRegressionTest.
 */
class SuperAdminAuditActionTypeContractTest extends TestCase
{
    /**
     * @return array<int,string> Sorted enum members declared in the committed dump.
     */
    private function schemaEnumMembers(): array
    {
        $schemaPath = dirname(__DIR__, 4) . '/database/schema/mysql-schema.sql';
        $schema = file_get_contents($schemaPath);

        self::assertNotFalse($schema, 'The committed MySQL schema dump must be readable.');

        $matched = preg_match(
            '/CREATE TABLE `super_admin_audit_log`.*?`action_type` enum\(([^)]*)\)/s',
            $schema,
            $m
        );

        self::assertSame(
            1,
            $matched,
            'Could not find the super_admin_audit_log.action_type enum in the committed schema dump. '
            . 'Refusing to pass without reading it — see this class docblock.'
        );

        preg_match_all("/'([^']*)'/", $m[1], $values);
        $members = $values[1];

        self::assertNotEmpty($members, 'The action_type enum was found but declared no members.');

        sort($members);

        return $members;
    }

    public function testEveryWritableActionTypeIsAnEnumMember(): void
    {
        $codeTypes = SuperAdminAuditService::actionTypes();
        sort($codeTypes);

        self::assertSame(
            $this->schemaEnumMembers(),
            $codeTypes,
            'SuperAdminAuditService::ACTION_LABELS has drifted from super_admin_audit_log.action_type. '
            . 'Every value log() can write MUST be an enum member: with strict mode off a non-member is '
            . 'silently stored as \'\' and the write still succeeds, so the audit entry survives but '
            . 'becomes invisible to the action filter and to getStats(). Add a migration widening the '
            . 'enum (append, never insert mid-list) and refresh database/schema/mysql-schema.sql.'
        );
    }

    /**
     * ACTION_ICONS is a parallel map to ACTION_LABELS and getActionIcon() falls back
     * to 'fa-circle', so a key missing there is silent. Assert every action type
     * resolves to a real icon rather than the fallback.
     */
    public function testEveryActionTypeHasItsOwnIcon(): void
    {
        foreach (SuperAdminAuditService::actionTypes() as $type) {
            self::assertNotSame(
                'fa-circle',
                SuperAdminAuditService::getActionIcon($type),
                "Action type '{$type}' is missing from ACTION_ICONS and fell back to the generic icon."
            );
        }
    }
}
