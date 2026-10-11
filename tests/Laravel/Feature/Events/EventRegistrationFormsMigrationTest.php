<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

final class EventRegistrationFormsMigrationTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    private const MIGRATION = '2026_07_11_000056_create_event_registration_forms_and_invitations.php';

    /** Later migration that replaces this one's guest guard (E-102, guests can be re-added). */
    private const LATER_GUEST_RULES = '2026_10_11_180000_let_withdrawn_event_guests_be_re_added.php';

    protected function setUp(): void
    {
        parent::setUp();
        // Re-running the original up() recreates the old guest trigger and CHECK
        // constraint, and DDL survives the test's rollback, so every later test
        // would run against the pre-2026-10-11 guest rules. Put the newer rules
        // back once this test's own data has been rolled back.
        $this->beforeApplicationDestroyed(function (): void {
            /** @var Migration $later */
            $later = require database_path('migrations/' . self::LATER_GUEST_RULES);
            $later->up();
        });
    }

    public function test_schema_is_idempotent_and_exposes_all_privacy_and_evidence_boundaries(): void
    {
        /** @var Migration $migration */
        $migration = require database_path('migrations/' . self::MIGRATION);
        $migration->up();

        self::assertTrue(Schema::hasColumn('event_registrations', 'party_size'));
        foreach ([
            'event_registration_settings',
            'event_registration_settings_history',
            'event_registration_form_versions',
            'event_registration_form_questions',
            'event_registration_form_submissions',
            'event_registration_form_answers',
            'event_registration_submission_history',
            'event_registration_answer_access_audits',
            'event_invitation_campaigns',
            'event_invitations',
            'event_invitation_history',
            'event_registration_guests',
            'event_registration_retention_runs',
            'event_registration_retention_items',
        ] as $table) {
            self::assertTrue(Schema::hasTable($table), $table);
        }
        foreach ([
            'answer_ciphertext',
            'data_classification',
            'retention_due_at',
            'displayed_text_hash',
            'purged_at',
        ] as $column) {
            self::assertTrue(Schema::hasColumn('event_registration_form_answers', $column), $column);
        }
        foreach ([
            'email_ciphertext',
            'email_blind_hash',
            'token_hash',
            'token_used_at',
        ] as $column) {
            self::assertTrue(Schema::hasColumn('event_invitations', $column), $column);
        }
        self::assertSame(
            ['tenant_id', 'event_id', 'id'],
            $this->indexColumns('event_registration_form_submissions', 'uq_ev_reg_submission_event_id'),
        );
        self::assertSame(
            ['tenant_id', 'event_id', 'id'],
            $this->indexColumns('event_registration_form_answers', 'uq_ev_reg_answer_event_id'),
        );
        self::assertSame(
            ['tenant_id', 'event_id', 'id'],
            $this->indexColumns('event_registration_guests', 'uq_ev_reg_guest_event_id'),
        );

        if (DB::getDriverName() === 'mysql') {
            foreach ([
                'chk_event_reg_party_size',
                'chk_ev_reg_settings_guests',
                'chk_ev_reg_question_type',
                'chk_ev_reg_answer_purge',
                'chk_event_invitation_target',
                'chk_ev_reg_retention_subject',
            ] as $constraint) {
                self::assertTrue($this->constraintExists($constraint, 'CHECK'), $constraint);
            }
            foreach ([
                'fk_ev_reg_submission_hist_submission',
                'fk_ev_reg_retention_item_answer',
                'fk_ev_reg_retention_item_guest',
                'fk_ev_reg_answer_audit_answer',
            ] as $constraint) {
                self::assertTrue($this->constraintExists($constraint, 'FOREIGN KEY'), $constraint);
            }
            foreach ([
                'trg_ev_reg_settings_history_no_update',
                'trg_ev_reg_submission_history_no_delete',
                'trg_ev_reg_answer_access_audit_no_update',
                'trg_event_invitation_history_no_delete',
                'trg_ev_reg_retention_run_no_update',
            ] as $trigger) {
                self::assertTrue($this->triggerExists($trigger), $trigger);
            }
        }
    }

    public function test_direct_sql_cannot_bypass_party_size_and_concrete_occurrence_guards(): void
    {
        if (DB::getDriverName() !== 'mysql') {
            self::markTestSkipped('MariaDB constraints are production-driver invariants.');
        }
        $owner = $this->eventUser();
        [$eventId] = $this->registrationEvent((int) $owner->id);
        $registrationId = $this->canonicalRegistration($eventId, (int) $owner->id);

        $this->assertConstraintViolation(
            fn () => DB::table('event_registrations')
                ->where('id', $registrationId)
                ->update(['party_size' => 0]),
            'chk_event_reg_party_size',
        );
        $this->assertConstraintViolation(
            fn () => DB::table('event_registrations')
                ->where('id', $registrationId)
                ->update(['party_size' => 12]),
            'chk_event_reg_party_size',
        );

        [$templateId, $start] = $this->registrationEvent(
            (int) $owner->id,
            template: true,
        );
        $this->assertConstraintViolation(
            fn () => DB::table('event_registration_settings')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $templateId,
                'occurrence_key' => 'template-not-concrete',
                'revision' => 1,
                'status' => 'draft',
                'approval_mode' => 'auto',
                'event_starts_at_utc_snapshot' => $start->utc(),
                'event_timezone_snapshot' => 'UTC',
                'opens_at_utc' => null,
                'closes_at_utc' => null,
                'cancellation_cutoff_at_utc' => null,
                'per_member_limit' => 1,
                'guests_enabled' => false,
                'max_guests_per_registration' => 0,
                'guest_retention_days' => 30,
                'form_state' => 'none',
                'published_form_version' => null,
                'created_by' => (int) $owner->id,
                'updated_by' => (int) $owner->id,
                'published_by' => null,
                'published_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]),
            'event_registration_concrete_occurrence_required',
        );
    }

    public function test_rollback_refuses_phase_b_dependent_schema_before_foundation_teardown(): void
    {
        /** @var Migration $migration */
        $migration = require database_path('migrations/' . self::MIGRATION);

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('event_registration_forms_rollback_refused_dependents_exist');
        $migration->down();
    }

    private function constraintExists(string $name, string $type): bool
    {
        return DB::table('information_schema.TABLE_CONSTRAINTS')
            ->where('CONSTRAINT_SCHEMA', DB::getDatabaseName())
            ->where('CONSTRAINT_NAME', $name)
            ->where('CONSTRAINT_TYPE', $type)
            ->exists();
    }

    private function triggerExists(string $name): bool
    {
        return DB::table('information_schema.TRIGGERS')
            ->where('TRIGGER_SCHEMA', DB::getDatabaseName())
            ->where('TRIGGER_NAME', $name)
            ->exists();
    }

    /** @return list<string> */
    private function indexColumns(string $table, string $index): array
    {
        return DB::table('information_schema.STATISTICS')
            ->where('TABLE_SCHEMA', DB::getDatabaseName())
            ->where('TABLE_NAME', $table)
            ->where('INDEX_NAME', $index)
            ->orderBy('SEQ_IN_INDEX')
            ->pluck('COLUMN_NAME')
            ->map(static fn (mixed $column): string => (string) $column)
            ->all();
    }

    /** @param callable():mixed $operation */
    private function assertConstraintViolation(callable $operation, string $needle): void
    {
        try {
            $operation();
            self::fail("Expected {$needle}.");
        } catch (QueryException $exception) {
            self::assertStringContainsString($needle, $exception->getMessage());
        }
    }
}
