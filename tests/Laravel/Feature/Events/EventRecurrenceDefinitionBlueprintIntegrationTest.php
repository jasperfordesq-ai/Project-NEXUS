<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Exceptions\EventRecurrenceDefinitionBlueprintException;
use App\Models\User;
use App\Services\EventRecurrenceDefinitionBlueprintService;
use App\Services\EventRecurrenceMaterializationService;
use App\Services\EventRecurrenceOccurrenceWriter;
use App\Services\EventRecurrenceRevisionTokenService;
use Carbon\CarbonImmutable;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use LogicException;
use Tests\Laravel\TestCase;

final class EventRecurrenceDefinitionBlueprintIntegrationTest extends TestCase
{
    use DatabaseTransactions;

    private const MIGRATION = '2026_07_12_000071_add_event_recurrence_definition_blueprints.php';

    protected function setUp(): void
    {
        parent::setUp();
        // A Tuesday five days before the October clock change, as 2026-10-20 was.
        // It must stay in the future: EventService checks a new series' start
        // against the real clock, so the old 2026-10-20 freeze (fixture start
        // "tomorrow 09:00" = 2026-10-21) began failing every run on 21 Oct 2026.
        Carbon::setTestNow('2030-10-22 12:00:00');
        config()->set('events.recurrence.engine_v2_enabled', true);
        config()->set('events.recurrence.max_occurrences', 3);
        config()->set('events.recurrence.materialization.enabled', true);
        config()->set('events.recurrence.materialization.lookahead_days', 30);
        config()->set('events.recurrence.materialization.refresh_margin_days', 5);
        config()->set('events.recurrence.materialization.repair_lookback_days', 30);
        config()->set('events.recurrence.materialization.series_limit', 10);
        config()->set('events.recurrence.materialization.occurrence_limit', 12);
        config()->set('events.recurrence.materialization.scan_limit', 100);
        config()->set('events.recurrence.definition_blueprints.enabled', true);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_explicit_versioned_blueprints_apply_only_to_new_occurrences_and_replay_safely(): void
    {
        [$rootId, $organizer, $source, $existingIds] = $this->seriesFixture();
        $admin = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'admin',
            'is_admin' => true,
        ]);
        $staff = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $definitions = $this->insertPortableDefinitions($source, $organizer, $staff);
        $lastInitial = (string) DB::table('events')
            ->where('parent_event_id', $rootId)
            ->max('recurrence_id');
        $effectiveOne = $this->shiftRecurrenceId($lastInitial, 1);
        $effectiveTwo = $this->shiftRecurrenceId($lastInitial, 3);
        $sections = [
            'agenda' => true,
            'ticket_types' => true,
            'registration' => true,
            'safety' => true,
            'staff' => true,
        ];

        Sanctum::actingAs($organizer, ['*']);
        try {
            $domainPreview = app(EventRecurrenceDefinitionBlueprintService::class)->preview(
                (int) $source->id,
                (int) $organizer->id,
                $effectiveOne,
                $sections,
            );
            self::assertTrue($domainPreview['can_commit']);
        } catch (EventRecurrenceDefinitionBlueprintException $exception) {
            self::fail($exception->reasonCode);
        }
        $previewOne = $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/preview",
            [
                'effective_from_recurrence_id' => $effectiveOne,
                'sections' => $sections,
            ],
        )->assertOk()
            ->assertJsonPath('data.can_commit', true)
            ->assertJsonPath('data.counts.sessions', 1)
            ->assertJsonPath('data.counts.ticket_types', 1)
            ->assertJsonPath('data.counts.form_questions', 1)
            ->assertJsonPath('data.counts.safety_requirements', 1)
            ->assertJsonPath('data.counts.staff_assignments', 1);
        self::assertNotSame('', (string) $previewOne->json('data.preview_expires_at'));
        $previewClaims = app(EventRecurrenceRevisionTokenService::class)->decode(
            (string) $previewOne->json('data.preview_token'),
            false,
        );
        self::assertSame(
            CarbonImmutable::createFromTimestampUTC((int) $previewClaims['expires_at'])->toIso8601String(),
            $previewOne->json('data.preview_expires_at'),
        );
        self::assertStringNotContainsString($definitions['secret_url'], $previewOne->getContent());
        self::assertStringNotContainsString('"user_id"', $previewOne->getContent());

        $payloadOne = [
            'effective_from_recurrence_id' => $effectiveOne,
            'sections' => $sections,
            'preview_token' => $previewOne->json('data.preview_token'),
        ];
        $commitOne = $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/commit",
            $payloadOne,
            ['Idempotency-Key' => 'definition-blueprint-one'],
        )->assertCreated();
        $blueprintOne = (int) $commitOne->json('data.blueprint_id');

        // Exact immutable replay remains available through a flag rollback.
        config()->set('events.recurrence.definition_blueprints.enabled', false);
        $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/commit",
            $payloadOne,
            ['Idempotency-Key' => 'definition-blueprint-one'],
        )->assertOk()->assertJsonPath('data.idempotent_replay', true);
        DB::table('users')->where('id', $organizer->id)->update(['status' => 'suspended']);
        DB::table('events')->where('id', $source->id)->update(['operational_status' => 'postponed']);
        $stateMovedReplay = app(EventRecurrenceDefinitionBlueprintService::class)->commit(
            (int) $source->id,
            (int) $organizer->id,
            $effectiveOne,
            $sections,
            (string) $payloadOne['preview_token'],
            'definition-blueprint-one',
        );
        self::assertTrue($stateMovedReplay['idempotent_replay']);
        self::assertSame(1, DB::table(EventRecurrenceDefinitionBlueprintService::BLUEPRINTS)
            ->where('root_event_id', $rootId)->count());
        DB::table('users')->where('id', $organizer->id)->update(['status' => 'active']);
        DB::table('events')->where('id', $source->id)->update(['operational_status' => 'scheduled']);
        config()->set('events.recurrence.definition_blueprints.enabled', true);

        DB::table('event_sessions')->where('event_id', $source->id)->update([
            'version' => 2,
            'title' => 'Future welcome workshop',
            'updated_by' => $organizer->id,
            'updated_at' => now(),
        ]);
        $previewTwo = $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/preview",
            [
                'effective_from_recurrence_id' => $effectiveTwo,
                'sections' => $sections,
            ],
        )->assertOk()->assertJsonPath('data.can_commit', true);
        $commitTwo = $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/commit",
            [
                'effective_from_recurrence_id' => $effectiveTwo,
                'sections' => $sections,
                'preview_token' => $previewTwo->json('data.preview_token'),
            ],
            ['Idempotency-Key' => 'definition-blueprint-two'],
        )->assertCreated()->assertJsonPath('data.blueprint_version', 2);
        $blueprintTwo = (int) $commitTwo->json('data.blueprint_id');

        $historyPageOne = $this->apiGet(
            "/v2/events/{$source->id}/recurrence-definition-blueprints?limit=1",
        )->assertOk()
            ->assertJsonPath('data.items.0.blueprint_version', 2)
            ->assertJsonPath('data.next_before_version', 2);
        self::assertArrayNotHasKey('manifest', $historyPageOne->json('data.items.0'));
        self::assertStringNotContainsString($definitions['secret_url'], $historyPageOne->getContent());
        $this->apiGet(
            "/v2/events/{$source->id}/recurrence-definition-blueprints?limit=1&before_version=2",
        )->assertOk()
            ->assertJsonPath('data.items.0.blueprint_version', 1)
            ->assertJsonPath('data.next_before_version', null);

        $manifest = (string) DB::table(EventRecurrenceDefinitionBlueprintService::BLUEPRINTS)
            ->where('id', $blueprintOne)->value('manifest');
        self::assertStringNotContainsString($definitions['secret_url'], $manifest);
        self::assertStringContainsString($definitions['resource_ciphertext'], $manifest);

        // Existing siblings stay untouched: there is no implicit backfill.
        foreach ($existingIds as $existingId) {
            if ($existingId === (int) $source->id) {
                continue;
            }
            self::assertSame(0, DB::table('event_sessions')->where('event_id', $existingId)->count());
            self::assertSame(0, DB::table('event_ticket_types')->where('event_id', $existingId)->count());
            self::assertSame(0, DB::table(EventRecurrenceDefinitionBlueprintService::APPLICATIONS)
                ->where('event_id', $existingId)->count());
        }

        // A real effective-dated recurrence timezone revision must flow to
        // inherited agenda zones; the source zone is not frozen into future
        // sessions and earlier concrete occurrences remain stable.
        $timezoneSelected = DB::table('events')->where('parent_event_id', $rootId)
            ->orderByDesc('recurrence_id')->first();
        self::assertNotNull($timezoneSelected);
        $timezonePatch = ['timezone' => 'America/New_York'];
        $timezonePreview = $this->apiPost(
            "/v2/events/{$timezoneSelected->id}/recurrence-revisions/preview",
            ['patch' => $timezonePatch],
        )->assertOk()->assertJsonPath('data.can_commit', true);
        $this->apiPost(
            "/v2/events/{$timezoneSelected->id}/recurrence-revisions/commit",
            [
                'patch' => $timezonePatch,
                'preview_token' => $timezonePreview->json('data.preview_token'),
            ],
            ['Idempotency-Key' => 'definition-blueprint-timezone-revision'],
        )->assertCreated();
        DB::table('users')->where('id', $organizer->id)->update([
            'status' => 'deleted',
            'deleted_at' => now(),
        ]);
        TenantContext::setById($this->testTenantId);
        $directStart = DateTimeImmutable::createFromFormat(
            'Ymd\THis\Z',
            $effectiveOne,
            new DateTimeZone('UTC'),
        );
        self::assertInstanceOf(DateTimeImmutable::class, $directStart);
        $directWrite = DB::transaction(fn (): array => app(EventRecurrenceOccurrenceWriter::class)->insert(
            DB::table('events')->where('id', $rootId)->first(),
            [
                'start_utc' => $directStart->format('Y-m-d H:i:s'),
                'end_utc' => $directStart->modify('+6 hours')->format('Y-m-d H:i:s'),
                'occurrence_date' => $directStart->format('Y-m-d'),
                'recurrence_id' => $effectiveOne,
            ],
        ));
        self::assertTrue($directWrite['inserted']);
        $run = app(EventRecurrenceMaterializationService::class)
            ->materialize($this->testTenantId, 10);
        $materializationError = DB::table('event_recurrence_rules')
            ->where('event_id', $rootId)->value('materialization_error_code');
        self::assertSame(
            1,
            $run['succeeded'],
            json_encode(['run' => $run, 'error' => $materializationError], JSON_THROW_ON_ERROR),
        );
        self::assertGreaterThanOrEqual(3, $run['occurrences_inserted']);

        $applications = DB::table(EventRecurrenceDefinitionBlueprintService::APPLICATIONS)
            ->where('root_event_id', $rootId)
            ->orderBy('recurrence_id')
            ->get();
        self::assertNotEmpty($applications);
        self::assertContains(1, $applications->pluck('blueprint_version')->map('intval')->all());
        self::assertContains(2, $applications->pluck('blueprint_version')->map('intval')->all());
        self::assertSame($blueprintOne, (int) $applications->firstWhere('blueprint_version', 1)->blueprint_id);
        self::assertSame($blueprintTwo, (int) $applications->firstWhere('blueprint_version', 2)->blueprint_id);

        $versionOneEvent = (int) $applications->firstWhere('blueprint_version', 1)->event_id;
        $versionTwoEvent = (int) $applications->firstWhere('blueprint_version', 2)->event_id;
        self::assertSame('Free admission', DB::table('event_ticket_types')
            ->where('event_id', $versionOneEvent)->value('name'));
        self::assertSame('Free admission', DB::table('event_ticket_types')
            ->where('event_id', $versionTwoEvent)->value('name'));
        self::assertSame('Welcome workshop', DB::table('event_sessions')
            ->where('event_id', $versionOneEvent)->value('title'));
        self::assertSame('Future welcome workshop', DB::table('event_sessions')
            ->where('event_id', $versionTwoEvent)->value('title'));
        $target = DB::table('events')->where('id', $versionOneEvent)->first();
        $targetSession = DB::table('event_sessions')->where('event_id', $versionOneEvent)->first();
        self::assertNotNull($target);
        self::assertNotNull($targetSession);
        self::assertSame('America/New_York', $target->timezone);
        self::assertSame('America/New_York', $targetSession->timezone);
        self::assertSame(
            7200,
            strtotime((string) $targetSession->starts_at_utc) - strtotime((string) $target->start_time),
        );

        self::assertSame($organizer->id, (int) DB::table(EventRecurrenceDefinitionBlueprintService::BLUEPRINTS)
            ->where('id', $blueprintOne)->value('captured_by_user_id'));
        self::assertSame($admin->id, (int) DB::table(EventRecurrenceDefinitionBlueprintService::APPLICATIONS)
            ->where('event_id', $versionOneEvent)->value('applied_by_user_id'));

        foreach ($this->prohibitedTables() as $table) {
            self::assertSame(
                0,
                DB::table($table)->where('event_id', $versionOneEvent)->count(),
                "Prohibited family {$table} was copied.",
            );
        }

        try {
            DB::table(EventRecurrenceDefinitionBlueprintService::BLUEPRINTS)
                ->where('id', $blueprintOne)->update(['manifest_hash' => str_repeat('b', 64)]);
            self::fail('An immutable blueprint was updated.');
        } catch (QueryException $exception) {
            self::assertStringContainsString('event_recurrence_definition_blueprint_immutable', $exception->getMessage());
        }
        try {
            $this->migration()->down();
            self::fail('Rollback removed durable definition evidence.');
        } catch (LogicException $exception) {
            self::assertSame(
                'event_recurrence_definition_rollback_refused_evidence_exists',
                $exception->getMessage(),
            );
        }
    }

    public function test_history_rejects_non_canonical_positive_decimal_pagination(): void
    {
        [, $organizer, $source] = $this->seriesFixture();
        Sanctum::actingAs($organizer, ['*']);

        foreach ([
            ['?limit=1.5&before_version=2', 'limit'],
            ['?limit=1e2', 'limit'],
            ['?limit=%2B1', 'limit'],
            ['?limit=01', 'limit'],
            ['?limit=999999999999999999999999999999999999', 'limit'],
            ['?limit=1&before_version=2.0', 'before_version'],
            ['?limit=1&before_version=%2B2', 'before_version'],
        ] as [$query, $field]) {
            $response = $this->apiGet(
                "/v2/events/{$source->id}/recurrence-definition-blueprints{$query}",
            );
            self::assertSame(422, $response->getStatusCode(), "Accepted malformed query: {$query}");
            $response->assertJsonPath('errors.0.field', $field)
                ->assertHeader('Pragma', 'no-cache');
            $cacheControl = (string) $response->headers->get('Cache-Control');
            self::assertStringContainsString('private', $cacheControl);
            self::assertStringContainsString('no-store', $cacheControl);
            self::assertStringContainsString('Authorization', (string) $response->headers->get('Vary'));
        }
    }

    public function test_preview_fails_closed_for_unsupported_money_and_invalid_staff_references(): void
    {
        [, $organizer, $source] = $this->seriesFixture();
        $invalidStaff = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $expiringStaff = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->insertActiveTicket($source, $organizer, 'time_credit', '1.00', 'Paid with time');
        DB::table('event_staff_assignments')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $source->id,
            'user_id' => $invalidStaff->id,
            'role' => 'check_in_staff',
            'status' => 'active',
            'assignment_version' => 1,
            'granted_at' => now(),
            'granted_by' => $organizer->id,
            'expires_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('users')->where('id', $invalidStaff->id)->update([
            'status' => 'deleted',
            'deleted_at' => now(),
        ]);
        DB::table('event_staff_assignments')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $source->id,
            'user_id' => $expiringStaff->id,
            'role' => 'communications_manager',
            'status' => 'active',
            'assignment_version' => 1,
            'granted_at' => now(),
            'granted_by' => $organizer->id,
            // Still active now, but non-portable because it expires before the event.
            'expires_at' => now()->addHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Sanctum::actingAs($organizer, ['*']);
        $preview = $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/preview",
            [
                'effective_from_recurrence_id' => (string) $source->recurrence_id,
                'sections' => ['ticket_types' => true, 'staff' => true],
            ],
        )->assertOk()->assertJsonPath('data.can_commit', false);
        $codes = collect($preview->json('data.conflicts'))->pluck('code')->all();
        self::assertContains('unsupported_active_time_credit_ticket', $codes);
        self::assertContains('invalid_staff_reference', $codes);
        self::assertContains('nonportable_staff_expiry', $codes);

        $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/commit",
            [
                'effective_from_recurrence_id' => (string) $source->recurrence_id,
                'sections' => ['ticket_types' => true, 'staff' => true],
                'preview_token' => $preview->json('data.preview_token'),
            ],
            ['Idempotency-Key' => 'blocked-definition-blueprint'],
        )->assertStatus(409);
    }

    public function test_manager_and_tenant_boundaries_are_enforced(): void
    {
        [, $organizer, $source] = $this->seriesFixture();
        $stranger = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($stranger, ['*']);
        $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/preview",
            [
                'effective_from_recurrence_id' => (string) $source->recurrence_id,
                'sections' => ['agenda' => true],
            ],
        )->assertForbidden();
        $this->apiGet(
            "/v2/events/{$source->id}/recurrence-definition-blueprints",
        )->assertForbidden();

        $foreign = User::factory()->forTenant(999)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        TenantContext::setById(999);
        try {
            app(EventRecurrenceDefinitionBlueprintService::class)->preview(
                (int) $source->id,
                (int) $foreign->id,
                (string) $source->recurrence_id,
                ['agenda' => true],
            );
            self::fail('A foreign tenant captured a source occurrence.');
        } catch (EventRecurrenceDefinitionBlueprintException $exception) {
            self::assertSame('event_recurrence_definition_source_invalid', $exception->reasonCode);
        } finally {
            TenantContext::setById($this->testTenantId);
        }
        config()->set('events.recurrence.definition_blueprints.enabled', 'false');
        try {
            app(EventRecurrenceDefinitionBlueprintService::class)->preview(
                (int) $source->id,
                (int) $organizer->id,
                (string) $source->recurrence_id,
                ['agenda' => true],
            );
            self::fail('A malformed truthy rollout value enabled definition capture.');
        } catch (EventRecurrenceDefinitionBlueprintException $exception) {
            self::assertSame('event_recurrence_definition_rollout_disabled', $exception->reasonCode);
        }
        self::assertNotSame($organizer->id, $stranger->id);
    }

    public function test_two_preview_race_has_one_winner_and_exact_idempotency_semantics(): void
    {
        [$rootId, $organizer, $source] = $this->seriesFixture();
        Sanctum::actingAs($organizer, ['*']);
        $request = [
            'effective_from_recurrence_id' => (string) $source->recurrence_id,
            'sections' => ['agenda' => true],
        ];
        $previewA = $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/preview",
            $request,
        )->assertOk();
        $previewB = $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/preview",
            $request,
        )->assertOk();
        self::assertSame(0, $previewA->json('data.blueprint_set_version'));
        self::assertSame(0, $previewB->json('data.blueprint_set_version'));

        $commitPayloadA = $request + ['preview_token' => $previewA->json('data.preview_token')];
        $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/commit",
            $commitPayloadA,
            ['Idempotency-Key' => 'definition-race-winner'],
        )->assertCreated()->assertJsonPath('data.blueprint_version', 1);

        // Root serialization plus the previewed set version makes the second
        // contender stale instead of allowing it to overwrite the winner.
        $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/commit",
            $request + ['preview_token' => $previewB->json('data.preview_token')],
            ['Idempotency-Key' => 'definition-race-loser'],
        )->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'EVENT_RECURRENCE_DEFINITION_PREVIEW_INVALID');

        $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/commit",
            $commitPayloadA,
            ['Idempotency-Key' => 'definition-race-winner'],
        )->assertOk()->assertJsonPath('data.idempotent_replay', true);

        $changedRequest = [
            'effective_from_recurrence_id' => (string) $source->recurrence_id,
            'sections' => ['safety' => true],
        ];
        $changedPreview = $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/preview",
            $changedRequest,
        )->assertOk();
        $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/commit",
            $changedRequest + ['preview_token' => $changedPreview->json('data.preview_token')],
            ['Idempotency-Key' => 'definition-race-winner'],
        )->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'EVENT_RECURRENCE_DEFINITION_CONFLICT');
        self::assertSame(1, DB::table(EventRecurrenceDefinitionBlueprintService::BLUEPRINTS)
            ->where('root_event_id', $rootId)->count());
    }

    public function test_preview_token_key_unavailability_is_preserved_on_decode(): void
    {
        [, $organizer, $source] = $this->seriesFixture();
        Sanctum::actingAs($organizer, ['*']);
        $request = [
            'effective_from_recurrence_id' => (string) $source->recurrence_id,
            'sections' => ['agenda' => true],
        ];
        $preview = $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/preview",
            $request,
        )->assertOk();

        config()->set(
            'events.recurrence.revisions.preview_envelope.active_key_version',
            'rotated-without-previous-key',
        );
        config()->set('events.recurrence.revisions.preview_envelope.previous_keys', []);
        $this->apiPost(
            "/v2/events/{$source->id}/recurrence-definition-blueprints/commit",
            $request + ['preview_token' => $preview->json('data.preview_token')],
            ['Idempotency-Key' => 'definition-key-unavailable'],
        )->assertStatus(503)
            ->assertJsonPath('errors.0.code', 'EVENT_RECURRENCE_DEFINITION_UNAVAILABLE');
    }

    /** @return array{int,User,object,list<int>} */
    private function seriesFixture(): array
    {
        $organizer = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($organizer, ['*']);
        $start = now()->addDay()->setTime(9, 0);
        $response = $this->apiPost('/v2/events/recurring', [
            'title' => 'Definition blueprint series',
            'description' => 'Definition-only propagation fixture.',
            'start_time' => $start->format('Y-m-d H:i:s'),
            'end_time' => $start->copy()->addHours(6)->format('Y-m-d H:i:s'),
            'timezone' => 'Europe/Dublin',
            'recurrence_frequency' => 'daily',
            'recurrence_ends_type' => 'never',
            'federated_visibility' => 'none',
        ])->assertCreated();
        $rootId = (int) $response->json('data.template.id');
        $children = DB::table('events')->where('parent_event_id', $rootId)
            ->orderBy('recurrence_id')->get();

        return [$rootId, $organizer, $children->first(), $children->pluck('id')->map('intval')->all()];
    }

    /** @return array{secret_url:string,resource_ciphertext:string,ticket_id:int} */
    private function insertPortableDefinitions(object $source, User $organizer, User $staff): array
    {
        $sourceStart = Carbon::parse((string) $source->start_time, 'UTC');
        $sessionId = (int) DB::table('event_sessions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'event_id' => $source->id,
            'version' => 1,
            'title' => 'Welcome workshop',
            'description' => 'Portable agenda definition.',
            'session_type' => 'workshop',
            'visibility' => 'registered',
            'capacity' => 20,
            'status' => 'scheduled',
            'starts_at_utc' => $sourceStart->copy()->addHours(2),
            'ends_at_utc' => $sourceStart->copy()->addHours(3),
            'timezone' => 'Europe/Dublin',
            'position' => 1,
            'created_by' => $organizer->id,
            'updated_by' => $organizer->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_session_speakers')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $source->id,
            'session_id' => $sessionId,
            'user_id' => $staff->id,
            'display_name' => null,
            'role_label' => 'Facilitator',
            'position' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $secretUrl = 'https://protected.example.test/stream?token=super-secret';
        $ciphertext = Crypt::encryptString($secretUrl);
        DB::table('event_session_resources')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $source->id,
            'session_id' => $sessionId,
            'resource_type' => 'stream',
            'visibility' => 'registered',
            'title' => 'Protected stream',
            'url_ciphertext' => $ciphertext,
            'position' => 1,
            'created_by' => $organizer->id,
            'updated_by' => $organizer->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $ticketId = $this->insertActiveTicket($source, $organizer, 'free', '0.00', 'Free admission');
        $this->insertPublishedRegistrationForm($source, $organizer);
        $this->insertPublishedSafety($source, $organizer);
        DB::table('event_staff_assignments')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $source->id,
            'user_id' => $staff->id,
            'role' => 'check_in_staff',
            'status' => 'active',
            'assignment_version' => 1,
            'granted_at' => now(),
            'granted_by' => $organizer->id,
            'expires_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [
            'secret_url' => $secretUrl,
            'resource_ciphertext' => $ciphertext,
            'ticket_id' => $ticketId,
        ];
    }

    private function insertActiveTicket(
        object $source,
        User $organizer,
        string $kind,
        string $price,
        string $name,
    ): int {
        $start = Carbon::parse((string) $source->start_time, 'UTC');

        return (int) DB::table('event_ticket_types')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'event_id' => $source->id,
            'occurrence_key' => $source->occurrence_key,
            'ticket_version' => 2,
            'name' => $name,
            'description' => 'Portable ticket definition.',
            'kind' => $kind,
            'unit_price_credits' => $price,
            'allocation_limit' => 25,
            'sales_opens_at_utc' => $start->copy()->subDays(10),
            'sales_closes_at_utc' => $start->copy()->subHour(),
            'event_starts_at_utc_snapshot' => $start,
            'event_timezone_snapshot' => $source->timezone,
            'per_member_limit' => 2,
            'eligibility_policy' => '{}',
            'refund_cutoff_at_utc' => $start->copy()->subHours(2),
            'organizer_cancel_refundable' => 1,
            'status' => 'active',
            'created_by' => $organizer->id,
            'updated_by' => $organizer->id,
            'activated_by' => $organizer->id,
            'activated_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertPublishedRegistrationForm(object $source, User $organizer): void
    {
        $start = Carbon::parse((string) $source->start_time, 'UTC');
        $settingsId = (int) DB::table('event_registration_settings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'event_id' => $source->id,
            'occurrence_key' => $source->occurrence_key,
            'revision' => 1,
            'status' => 'draft',
            'approval_mode' => 'manual',
            'event_starts_at_utc_snapshot' => $start,
            'event_timezone_snapshot' => $source->timezone,
            'opens_at_utc' => $start->copy()->subDays(10),
            'closes_at_utc' => $start->copy()->subHour(),
            'cancellation_cutoff_at_utc' => $start->copy()->subHours(2),
            'per_member_limit' => 1,
            'guests_enabled' => 1,
            'max_guests_per_registration' => 2,
            'guest_retention_days' => 30,
            'form_state' => 'none',
            'created_by' => $organizer->id,
            'updated_by' => $organizer->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $formId = (int) DB::table('event_registration_form_versions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'event_id' => $source->id,
            'version_number' => 1,
            'revision' => 1,
            'status' => 'draft',
            'name' => 'Published questions',
            'description' => 'Portable form definition.',
            'created_by' => $organizer->id,
            'updated_by' => $organizer->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_registration_form_questions')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $source->id,
            'form_version_id' => $formId,
            'stable_key' => 'access_needs',
            'position' => 1,
            'question_type' => 'long_text',
            'prompt' => 'What support do you need?',
            'is_required' => 0,
            'data_classification' => 'sensitive',
            'purpose' => 'Make reasonable event adjustments.',
            'retention_days' => 30,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_registration_form_versions')->where('id', $formId)->update([
            'status' => 'published',
            'definition_hash' => hash('sha256', 'published-questions'),
            'published_by' => $organizer->id,
            'published_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_registration_settings')->where('id', $settingsId)->update([
            'revision' => 2,
            'status' => 'published',
            'form_state' => 'published',
            'published_form_version' => 1,
            'published_by' => $organizer->id,
            'published_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertPublishedSafety(object $source, User $organizer): void
    {
        $requirementsId = (int) DB::table('event_safety_requirements')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'event_id' => $source->id,
            'occurrence_key' => $source->occurrence_key,
            'revision' => 1,
            'current_version' => 1,
            'status' => 'draft',
            'created_by_user_id' => $organizer->id,
            'updated_by_user_id' => $organizer->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_safety_requirement_versions')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $source->id,
            'requirements_id' => $requirementsId,
            'version_number' => 1,
            'minimum_age' => 16,
            'guardian_consent_required' => 1,
            'minor_age_threshold' => 18,
            'code_of_conduct_required' => 0,
            'eligibility_policy_metadata' => '{}',
            'eligibility_policy_hash' => hash('sha256', '{}'),
            'captured_by_user_id' => $organizer->id,
            'idempotency_hash' => hash('sha256', 'source-safety-version'),
            'request_hash' => hash('sha256', 'source-safety-request'),
            'created_at' => now(),
        ]);
        DB::table('event_safety_requirements')->where('id', $requirementsId)->update([
            'revision' => 2,
            'published_version' => 1,
            'status' => 'published',
            'updated_by_user_id' => $organizer->id,
            'published_by_user_id' => $organizer->id,
            'published_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function shiftRecurrenceId(string $recurrenceId, int $days): string
    {
        $parsed = DateTimeImmutable::createFromFormat(
            'Ymd\THis\Z',
            $recurrenceId,
            new DateTimeZone('UTC'),
        );
        self::assertInstanceOf(DateTimeImmutable::class, $parsed);

        return $parsed->modify("+{$days} days")->format('Ymd\THis\Z');
    }

    /** @return list<string> */
    private function prohibitedTables(): array
    {
        return array_values(array_filter([
            'event_registrations',
            'event_waitlist',
            'event_waitlist_entries',
            'event_ticket_entitlements',
            'event_ticket_inventory_history',
            'event_registration_form_submissions',
            'event_registration_form_answers',
            'event_registration_guests',
            'event_invitations',
            'event_attendance',
            'event_checkin_credentials',
            'event_checkin_devices',
            'event_broadcasts',
            'event_reminders',
            'event_notification_deliveries',
            'event_domain_outbox',
            'event_analytics_optional_facts',
            'event_federation_deliveries',
        ], static fn (string $table): bool => Schema::hasTable($table)
            && Schema::hasColumn($table, 'event_id')));
    }

    private function migration(): Migration
    {
        /** @var Migration $migration */
        $migration = require database_path('migrations/' . self::MIGRATION);

        return $migration;
    }
}
