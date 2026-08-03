<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Models\User;
use App\Models\Tenant;
use App\Services\EventHealthService;
use App\Services\EventRecurrenceMaterializationService;
use App\Services\EventService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class EventRecurrenceMaterializationTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('events.recurrence.engine_v2_enabled', true);
        config()->set('events.recurrence.max_occurrences', 366);
        config()->set('events.recurrence.max_horizon_years', 20);
        config()->set('events.recurrence.materialization.enabled', true);
        config()->set('events.recurrence.materialization.lookahead_days', 365);
        config()->set('events.recurrence.materialization.refresh_margin_days', 30);
        config()->set('events.recurrence.materialization.overdue_grace_hours', 6);
        config()->set('events.recurrence.materialization.retry_grace_minutes', 15);
        config()->set('events.recurrence.materialization.repair_lookback_days', 60);
        config()->set('events.recurrence.materialization.series_limit', 50);
        config()->set('events.recurrence.materialization.occurrence_limit', 500);
        config()->set('events.recurrence.materialization.scan_limit', 2000);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_materialization_schema_enforces_single_tenant_safe_rule_ownership(): void
    {
        foreach ([
            'materialized_through_at',
            'materialization_resume_at',
            'materialization_last_attempted_at',
            'materialization_last_succeeded_at',
            'materialization_last_failed_at',
            'materialization_error_code',
            'materialization_truncated',
            'effective_revision_version',
            'materialized_set_version',
        ] as $column) {
            self::assertTrue(
                Schema::hasColumn('event_recurrence_rules', $column),
                "Missing event_recurrence_rules.{$column}",
            );
        }

        $unique = DB::select(
            "SHOW INDEX FROM `event_recurrence_rules` "
            . "WHERE Key_name = 'uq_event_recurrence_rule_tenant_event'",
        );
        self::assertSame(
            ['tenant_id', 'event_id'],
            array_map(static fn (object $row): string => (string) $row->Column_name, $unique),
        );
        self::assertSame([0, 0], array_map(static fn (object $row): int => (int) $row->Non_unique, $unique));

        $foreignKey = DB::table('information_schema.key_column_usage')
            ->where('constraint_schema', DB::getDatabaseName())
            ->where('table_name', 'event_recurrence_rules')
            ->where('constraint_name', 'fk_event_recurrence_rule_event_tenant')
            ->orderBy('ordinal_position')
            ->get(['column_name', 'referenced_column_name']);
        self::assertSame(
            [
                ['column_name' => 'tenant_id', 'referenced_column_name' => 'tenant_id'],
                ['column_name' => 'event_id', 'referenced_column_name' => 'id'],
            ],
            $foreignKey->map(static fn (object $row): array => [
                'column_name' => (string) $row->column_name,
                'referenced_column_name' => (string) $row->referenced_column_name,
            ])->all(),
        );
    }

    public function test_daily_never_series_rolls_past_initial_cap_and_replay_is_idempotent(): void
    {
        config()->set('events.recurrence.max_occurrences', 10);
        config()->set('events.recurrence.materialization.occurrence_limit', 50);
        config()->set('events.recurrence.materialization.scan_limit', 200);
        $createdAt = Carbon::now('UTC');
        [$rootId] = $this->createNeverSeries('Rolling daily cap', 'daily');
        $initialCount = DB::table('events')->where('parent_event_id', $rootId)->count();
        $initialLast = (string) DB::table('events')->where('parent_event_id', $rootId)->max('start_time');
        self::assertSame(10, $initialCount);

        DB::table('events')->where('id', $rootId)->update([
            'sdg_goals' => json_encode([3, 11], JSON_THROW_ON_ERROR),
            'auto_log_hours' => 1,
            'award' => 'community',
            'event' => 'rolling',
        ]);
        Carbon::setTestNow($createdAt->copy()->addDays(400));
        $first = app(EventRecurrenceMaterializationService::class)
            ->materialize($this->testTenantId, 10);

        self::assertSame(1, $first['succeeded'], json_encode($first, JSON_THROW_ON_ERROR));
        self::assertGreaterThan(0, $first['occurrences_inserted']);
        self::assertGreaterThan($initialCount, DB::table('events')->where('parent_event_id', $rootId)->count());
        self::assertGreaterThan(
            $initialLast,
            (string) DB::table('events')->where('parent_event_id', $rootId)->max('start_time'),
        );
        $latest = DB::table('events')->where('parent_event_id', $rootId)->orderByDesc('start_time')->first();
        self::assertNotNull($latest);
        self::assertMatchesRegularExpression('/^\d{8}T\d{6}Z$/', (string) $latest->recurrence_id);
        self::assertSame([3, 11], json_decode((string) $latest->sdg_goals, true, 512, JSON_THROW_ON_ERROR));
        self::assertSame(1, (int) $latest->auto_log_hours);
        self::assertSame('community', $latest->award);
        self::assertSame('rolling', $latest->event);

        $countAfterFirst = DB::table('events')->where('parent_event_id', $rootId)->count();
        $overridden = DB::table('events')
            ->where('parent_event_id', $rootId)
            ->where('start_time', '>=', now()->subDays(30))
            ->orderBy('start_time')
            ->first();
        self::assertNotNull($overridden);
        $overriddenStart = Carbon::parse((string) $overridden->start_time, 'UTC')->addHours(2);
        $overriddenEnd = Carbon::parse((string) $overridden->end_time, 'UTC')->addHours(2);
        $deletedOverrideActor = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('events')->where('id', $overridden->id)->update([
            'start_time' => $overriddenStart,
            'end_time' => $overriddenEnd,
            'is_recurrence_exception' => 1,
            'recurrence_override_fields' => json_encode(['start_time', 'end_time'], JSON_THROW_ON_ERROR),
            'recurrence_override_version' => 1,
            'recurrence_override_updated_at' => now(),
            'recurrence_override_updated_by' => $deletedOverrideActor->id,
        ]);
        DB::table('users')->where('id', $deletedOverrideActor->id)->update([
            'status' => 'deleted',
            'deleted_at' => now(),
        ]);
        DB::table('event_recurrence_rules')->where('event_id', $rootId)->update([
            'materialized_through_at' => null,
            'materialization_resume_at' => null,
            'materialization_last_attempted_at' => null,
        ]);
        $replay = app(EventRecurrenceMaterializationService::class)
            ->materialize($this->testTenantId, 10);

        self::assertSame(1, $replay['succeeded']);
        self::assertSame(0, $replay['occurrences_inserted']);
        self::assertGreaterThan(0, $replay['occurrences_replayed']);
        self::assertSame($countAfterFirst, DB::table('events')->where('parent_event_id', $rootId)->count());
        self::assertSame(
            $overriddenStart->format('Y-m-d H:i:s'),
            (string) DB::table('events')->where('id', $overridden->id)->value('start_time'),
        );
        self::assertSame(
            DB::table('events')->where('parent_event_id', $rootId)->count(),
            DB::table('events')->where('parent_event_id', $rootId)->distinct()->count('recurrence_id'),
        );
        $customizedEvidence = DB::table('event_recurrence_occurrence_ledger')
            ->where('event_id', $overridden->id)
            ->orderByDesc('state_version')
            ->first();
        self::assertNotNull($customizedEvidence);
        self::assertSame('customized', $customizedEvidence->state);
        self::assertNull($customizedEvidence->actor_user_id);
        self::assertSame(
            'override_actor_unavailable',
            json_decode((string) $customizedEvidence->metadata, true, 512, JSON_THROW_ON_ERROR)['actor_resolution'],
        );
    }

    public function test_v2_create_and_regenerate_fail_closed_when_full_schema_is_unavailable(): void
    {
        config()->set('events.recurrence.max_occurrences', 3);
        [$rootId, $organizer] = $this->createNeverSeries('Schema-ready recurrence fixture', 'weekly');

        $this->app->instance(
            EventRecurrenceMaterializationService::class,
            new class extends EventRecurrenceMaterializationService {
                public function __construct()
                {
                }

                public function schemaAvailable(): bool
                {
                    return false;
                }
            },
        );

        Sanctum::actingAs($organizer, ['*']);
        $start = now()->addDays(2)->setTime(10, 0);
        $this->apiPost('/v2/events/recurring', [
            'title' => 'Blocked schema recurrence',
            'description' => 'Must not be inserted before the full schema is available.',
            'start_time' => $start->format('Y-m-d H:i:s'),
            'end_time' => $start->copy()->addHour()->format('Y-m-d H:i:s'),
            'timezone' => 'UTC',
            'recurrence_frequency' => 'weekly',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 3,
        ])->assertStatus(503)
            ->assertJsonPath('errors.0.code', 'EVENT_RECURRENCE_UNAVAILABLE');

        self::assertFalse(DB::table('events')->where('title', 'Blocked schema recurrence')->exists());
        self::assertNull(EventService::regenerateRecurring($rootId, (int) $organizer->id));
        self::assertSame('EVENT_RECURRENCE_UNAVAILABLE', EventService::getErrors()[0]['code'] ?? null);
    }

    public function test_published_rolling_child_uses_lifecycle_federation_and_suppressed_notification_context(): void
    {
        config()->set('events.recurrence.max_occurrences', 5);
        config()->set('events.recurrence.materialization.occurrence_limit', 20);
        $createdAt = Carbon::now('UTC');
        [$rootId, $organizer] = $this->createNeverSeries('Published rolling series', 'daily');
        DB::table('events')
            ->where(fn ($series) => $series->where('id', $rootId)->orWhere('parent_event_id', $rootId))
            ->update([
                'status' => 'active',
                'publication_status' => 'published',
                'operational_status' => 'scheduled',
                'federated_visibility' => 'listed',
                'publication_status_changed_by' => $organizer->id,
            ]);
        $partnerId = $this->federationPartner();
        $this->enableEventFederation();
        $existingIds = DB::table('events')->where('parent_event_id', $rootId)->pluck('id')->all();

        Carbon::setTestNow($createdAt->copy()->addDays(400));
        $result = app(EventRecurrenceMaterializationService::class)
            ->materialize($this->testTenantId, 10);
        self::assertGreaterThan(0, $result['occurrences_inserted'], json_encode($result, JSON_THROW_ON_ERROR));

        $newChild = DB::table('events')
            ->where('parent_event_id', $rootId)
            ->whereNotIn('id', $existingIds)
            ->orderBy('id')
            ->first();
        self::assertNotNull($newChild);
        self::assertSame('published', $newChild->publication_status);
        self::assertSame('active', $newChild->status);
        self::assertSame(1, (int) $newChild->lifecycle_version);

        $history = DB::table('event_status_history')->where('event_id', $newChild->id)->first();
        self::assertNotNull($history);
        $historyMetadata = json_decode((string) $history->metadata, true, 512, JSON_THROW_ON_ERROR);
        self::assertTrue($historyMetadata['notifications_suppressed']);
        self::assertSame('rolling_recurrence', $historyMetadata['materialization']['source']);
        $outbox = DB::table('event_domain_outbox')
            ->where('event_id', $newChild->id)
            ->where('action', 'event.lifecycle.transitioned')
            ->first();
        self::assertNotNull($outbox);
        $payload = json_decode((string) $outbox->payload, true, 512, JSON_THROW_ON_ERROR);
        self::assertTrue($payload['metadata']['notifications_suppressed']);
        self::assertSame([], $payload['affected_recipient_user_ids']);
        self::assertDatabaseHas('event_federation_deliveries', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $newChild->id,
            'external_partner_id' => $partnerId,
            'action' => 'upsert',
        ]);
    }

    public function test_terminal_and_other_tenant_roots_never_grow_in_tenant_scoped_run(): void
    {
        config()->set('events.recurrence.max_occurrences', 5);
        $createdAt = Carbon::now('UTC');
        [$cancelledRoot] = $this->createNeverSeries('Cancelled rolling series', 'weekly');
        DB::table('events')->where('id', $cancelledRoot)->update([
            'status' => 'cancelled',
            'operational_status' => 'cancelled',
        ]);
        $cancelledCount = DB::table('events')->where('parent_event_id', $cancelledRoot)->count();

        $otherTenant = 999;
        $otherUser = User::factory()->forTenant($otherTenant)->create(['status' => 'active', 'is_approved' => true]);
        $otherRoot = $this->manualNeverRoot($otherTenant, (int) $otherUser->id, 'Other tenant recurrence');
        $otherCount = DB::table('events')->where('parent_event_id', $otherRoot)->count();

        Carbon::setTestNow($createdAt->copy()->addDays(400));
        app(EventRecurrenceMaterializationService::class)->materialize($this->testTenantId, 10);

        self::assertSame($cancelledCount, DB::table('events')->where('parent_event_id', $cancelledRoot)->count());
        self::assertSame($otherCount, DB::table('events')->where('parent_event_id', $otherRoot)->count());
    }

    public function test_truncated_window_persists_resume_and_advances_on_next_run(): void
    {
        config()->set('events.recurrence.max_occurrences', 5);
        config()->set('events.recurrence.materialization.occurrence_limit', 5);
        config()->set('events.recurrence.materialization.scan_limit', 20);
        $createdAt = Carbon::now('UTC');
        [$rootId] = $this->createNeverSeries('Truncated rolling series', 'daily');
        Carbon::setTestNow($createdAt->copy()->addDays(400));

        $first = app(EventRecurrenceMaterializationService::class)->materialize($this->testTenantId, 10);
        self::assertSame(1, $first['truncated'], json_encode($first, JSON_THROW_ON_ERROR));
        $firstResume = (string) DB::table('event_recurrence_rules')
            ->where('event_id', $rootId)
            ->value('materialization_resume_at');
        self::assertNotSame('', $firstResume);

        $second = app(EventRecurrenceMaterializationService::class)->materialize($this->testTenantId, 10);
        $secondResume = (string) DB::table('event_recurrence_rules')
            ->where('event_id', $rootId)
            ->value('materialization_resume_at');
        self::assertSame(1, $second['truncated']);
        self::assertGreaterThan($firstResume, $secondResume);
    }

    public function test_health_distinguishes_disabled_legacy_readiness_from_v2_continuity_block(): void
    {
        config()->set('events.recurrence.engine_v2_enabled', false);
        config()->set('events.recurrence.materialization.enabled', false);
        $tenantId = (int) Tenant::factory()->create(['is_active' => 1])->id;
        $organizer = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $legacyRoot = $this->manualNeverRoot(
            $tenantId,
            (int) $organizer->id,
            'Legacy readiness fixture',
            'legacy',
            '1',
        );

        $legacy = app(EventHealthService::class)->snapshot($tenantId)['recurrence'];
        self::assertSame('disabled', $legacy['rollout_state']);
        self::assertSame(1, $legacy['active_legacy_never_blockers']);
        self::assertFalse($legacy['unhealthy']);

        // The v2 writer is permanently on now (the legacy engine was removed),
        // so "writer on, materialization off" is the normal resting state — it
        // used to be reported as 'misconfigured', which flagged every
        // installation as unhealthy the moment the engine switch was turned on.
        config()->set('events.recurrence.engine_v2_enabled', true);
        $writerOnly = app(EventHealthService::class)->snapshot($tenantId)['recurrence'];
        self::assertSame('disabled', $writerOnly['rollout_state']);
        self::assertFalse($writerOnly['unhealthy']);

        // The genuinely incoherent combination is the other way round:
        // materialization ON with the writer OFF would run the cron with nothing
        // able to write. That must still be reported.
        config()->set('events.recurrence.engine_v2_enabled', false);
        config()->set('events.recurrence.materialization.enabled', true);
        $mismatched = app(EventHealthService::class)->snapshot($tenantId)['recurrence'];
        self::assertSame('misconfigured', $mismatched['rollout_state']);
        self::assertTrue($mismatched['unhealthy']);
        config()->set('events.recurrence.materialization.enabled', false);

        DB::table('event_recurrence_rules')->where('event_id', $legacyRoot)->delete();
        DB::table('events')->where('id', $legacyRoot)->delete();
        $this->manualNeverRoot(
            $tenantId,
            (int) $organizer->id,
            'Disabled V2 continuity fixture',
        );
        $v2 = app(EventHealthService::class)->snapshot($tenantId)['recurrence'];
        self::assertSame('disabled_with_v2_roots', $v2['rollout_state']);
        self::assertTrue($v2['v2_continuity_blocked']);
        self::assertTrue($v2['unhealthy']);
    }

    public function test_pending_postponed_and_terminal_roots_are_not_due(): void
    {
        $tenantId = (int) Tenant::factory()->create(['is_active' => 1])->id;
        $organizer = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $pending = $this->manualNeverRoot(
            $tenantId,
            (int) $organizer->id,
            'Pending recurrence fixture',
        );
        DB::table('events')->where('id', $pending)->update(['publication_status' => 'pending_review']);
        $postponed = $this->manualNeverRoot(
            $tenantId,
            (int) $organizer->id,
            'Postponed recurrence fixture',
        );
        DB::table('events')->where('id', $postponed)->update(['operational_status' => 'postponed']);
        $cancelled = $this->manualNeverRoot(
            $tenantId,
            (int) $organizer->id,
            'Cancelled recurrence fixture',
        );
        DB::table('events')->where('id', $cancelled)->update([
            'status' => 'cancelled',
            'operational_status' => 'cancelled',
        ]);

        $health = app(EventHealthService::class)->snapshot($tenantId)['recurrence'];
        self::assertSame(1, $health['paused_pending_review']);
        self::assertSame(1, $health['paused_postponed']);
        self::assertSame(0, $health['due']);
        self::assertSame(0, $health['overdue']);
        self::assertFalse($health['unhealthy']);
        $run = app(EventRecurrenceMaterializationService::class)->materialize($tenantId, 20);
        self::assertSame(0, $run['examined']);
    }

    public function test_health_reports_due_overdue_and_failed_materialization_separately(): void
    {
        $tenantId = (int) Tenant::factory()->create(['is_active' => 1])->id;
        $organizer = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $dueRoot = $this->manualNeverRoot(
            $tenantId,
            (int) $organizer->id,
            'Due recurrence fixture',
        );
        DB::table('event_recurrence_rules')->where('event_id', $dueRoot)->update([
            'materialized_through_at' => now()->addDays(10),
            'materialization_last_attempted_at' => now(),
        ]);

        $overdueRoot = $this->manualNeverRoot(
            $tenantId,
            (int) $organizer->id,
            'Overdue recurrence fixture',
        );
        DB::table('event_recurrence_rules')->where('event_id', $overdueRoot)->update([
            'materialized_through_at' => null,
            'materialization_last_attempted_at' => now()->subHours(7),
        ]);

        $failedRoot = $this->manualNeverRoot(
            $tenantId,
            (int) $organizer->id,
            'Failed recurrence fixture',
        );
        DB::table('event_recurrence_rules')->where('event_id', $failedRoot)->update([
            'materialized_through_at' => now()->addDays(365),
            'materialization_last_attempted_at' => now(),
            'materialization_error_code' => 'event_recurrence_rule_invalid',
        ]);

        $health = app(EventHealthService::class)->snapshot($tenantId)['recurrence'];
        self::assertSame(2, $health['due']);
        self::assertSame(1, $health['overdue']);
        self::assertSame(1, $health['failed']);
        self::assertTrue($health['unhealthy']);
    }

    public function test_directional_lifecycle_health_allows_child_terminal_exception_but_blocks_escape(): void
    {
        config()->set('events.recurrence.max_occurrences', 3);
        [$rootId] = $this->createNeverSeries('Directional lifecycle fixture', 'weekly');
        $children = DB::table('events')->where('parent_event_id', $rootId)->orderBy('id')->pluck('id')->all();
        DB::table('events')
            ->where(fn ($series) => $series->where('id', $rootId)->orWhere('parent_event_id', $rootId))
            ->update(['status' => 'active', 'publication_status' => 'published']);
        DB::table('events')->where('id', $children[0])->update([
            'status' => 'cancelled',
            'operational_status' => 'cancelled',
        ]);
        DB::table('events')->where('id', $children[1])->update([
            'status' => 'draft',
            'publication_status' => 'archived',
        ]);

        $valid = app(EventHealthService::class)->snapshot($this->testTenantId)['recurrence'];
        self::assertSame(0, $valid['child_lifecycle_divergence']);

        DB::table('events')->where('id', $rootId)->update([
            'status' => 'draft',
            'publication_status' => 'archived',
        ]);
        $escaped = app(EventHealthService::class)->snapshot($this->testTenantId)['recurrence'];
        self::assertGreaterThan(0, $escaped['child_lifecycle_divergence']);
        self::assertTrue($escaped['unhealthy']);
    }

    public function test_health_command_materializer_status_and_scheduler_are_registered(): void
    {
        config()->set('events.recurrence.engine_v2_enabled', false);
        config()->set('events.recurrence.materialization.enabled', false);
        $tenantId = (int) Tenant::factory()->create(['is_active' => 1])->id;

        $this->artisan('events:materialize-recurrences', [
            '--tenant' => $tenantId,
            '--status' => true,
            '--json' => true,
        ])
            ->assertExitCode(0);
        $this->artisan('events:materialize-recurrences', ['--tenant' => $tenantId, '--json' => true])
            ->assertExitCode(0);
        $this->artisan('schedule:list')
            ->expectsOutputToContain('events:materialize-recurrences')
            ->assertExitCode(0);
    }

    /** @return array{int,User} */
    private function createNeverSeries(string $title, string $frequency): array
    {
        $organizer = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($organizer, ['*']);
        $start = now()->addDay()->setTime(9, 0);
        $created = $this->apiPost('/v2/events/recurring', [
            'title' => $title,
            'description' => 'Rolling recurrence integration fixture.',
            'start_time' => $start->format('Y-m-d H:i:s'),
            'end_time' => $start->copy()->addHour()->format('Y-m-d H:i:s'),
            'timezone' => 'UTC',
            'all_day' => false,
            'location' => 'Community hall',
            'is_online' => false,
            'allow_remote_attendance' => false,
            'federated_visibility' => 'none',
            'recurrence_frequency' => $frequency,
            'recurrence_ends_type' => 'never',
        ])->assertCreated();

        return [(int) $created->json('data.template.id'), $organizer];
    }

    private function manualNeverRoot(
        int $tenantId,
        int $userId,
        string $title,
        string $engine = 'sabre-vobject',
        string $engineVersion = '2',
    ): int
    {
        $rootId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'title' => $title,
            'description' => 'Tenant isolation root.',
            'start_time' => now()->subYear(),
            'end_time' => now()->subYear()->addHour(),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'status' => 'draft',
            'publication_status' => 'draft',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'calendar_sequence' => 0,
            'federation_version' => 1,
            'is_recurring_template' => 1,
            'recurrence_engine' => $engine,
            'recurrence_engine_version' => $engineVersion,
            'occurrence_key' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_recurrence_rules')->insert([
            'event_id' => $rootId,
            'tenant_id' => $tenantId,
            'frequency' => 'daily',
            'interval_value' => 1,
            'rrule' => 'FREQ=DAILY;INTERVAL=1',
            'recurrence_engine' => $engine,
            'recurrence_engine_version' => $engineVersion,
            'rule_hash' => str_repeat('a', 64),
            'ends_type' => 'never',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $rootId;
    }

    private function federationPartner(): int
    {
        return (int) DB::table('federation_external_partners')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Rolling recurrence partner',
            'base_url' => 'https://rolling-' . uniqid() . '.example.test',
            'api_path' => '/api/v2/federation',
            'auth_method' => 'api_key',
            'protocol_type' => 'nexus',
            'status' => 'active',
            'allow_events' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function enableEventFederation(): void
    {
        DB::table('federation_system_control')->updateOrInsert(
            ['id' => 1],
            [
                'federation_enabled' => 1,
                'whitelist_mode_enabled' => 0,
                'emergency_lockdown_active' => 0,
                'max_federation_level' => 4,
                'cross_tenant_profiles_enabled' => 1,
                'cross_tenant_messaging_enabled' => 1,
                'cross_tenant_transactions_enabled' => 1,
                'cross_tenant_listings_enabled' => 1,
                'cross_tenant_events_enabled' => 1,
                'cross_tenant_groups_enabled' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        );
        foreach (['tenant_federation_enabled', 'tenant_events_enabled'] as $feature) {
            DB::table('federation_tenant_features')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'feature_key' => $feature],
                ['is_enabled' => 1, 'updated_at' => now()],
            );
        }
    }
}
