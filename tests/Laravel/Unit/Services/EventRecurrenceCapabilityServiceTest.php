<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Http\Resources\EventRecurrenceCapabilityResource;
use App\Services\EventRecurrenceCapabilityService;
use Tests\Laravel\TestCase;

final class EventRecurrenceCapabilityServiceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config()->set('events.recurrence.engine_v2_enabled', false);
        config()->set('events.recurrence.max_occurrences', 366);
        config()->set('events.recurrence.materialization.enabled', false);
        config()->set('events.recurrence.definition_blueprints.enabled', false);
    }

    /**
     * E-102: the legacy engine was deleted (1e419abd5), so creation always
     * writes v2 and the runtime contract must never claim "legacy" (52
     * occurrences). With the engine flag off, only series edits — which
     * EventRecurrenceRevisionService still gates on that flag — and the
     * rolling writer are reported unavailable.
     */
    public function test_engine_flag_off_still_reports_the_only_engine_v2(): void
    {
        $capabilities = $this->service(true, true, false, true, true, true)->capabilities();

        self::assertSame([
            'contract_version' => 1,
            'engine' => 'v2',
            'structured_input' => true,
            'supported_frequencies' => ['daily', 'weekly', 'monthly', 'yearly'],
            'max_occurrences' => 366,
            'supported_end_types' => ['after_count', 'on_date'],
            'supports_rolling_never' => false,
            'supports_effective_revisions' => false,
            'supports_definition_blueprints' => false,
            'schema_ready' => true,
            'rollout_state' => 'v2_finite',
        ], $capabilities);
        self::assertSame('v2', EventRecurrenceCapabilityResource::fromCapabilities($capabilities)['engine']);
    }

    /**
     * E-102: a community that switched recurring events off was still offered
     * "Repeat this event", and the organiser got a 403 on save. The contract
     * now offers nothing to create (no frequency, no end type) while keeping
     * what an existing series can do.
     */
    public function test_tenant_with_recurrence_switched_off_is_offered_nothing_to_create(): void
    {
        config()->set('events.recurrence.engine_v2_enabled', true);

        $capabilities = $this->service(true, false, true, true, true, true, false)->capabilities();
        $resource = EventRecurrenceCapabilityResource::fromCapabilities($capabilities);

        self::assertSame([], $resource['supported_frequencies']);
        self::assertSame([], $resource['supported_end_types']);
        self::assertSame('v2', $resource['engine']);
        self::assertTrue($resource['supports_effective_revisions']);
    }

    public function test_v2_finite_contract_exposes_revisions_but_not_unavailable_never_or_blueprints(): void
    {
        config()->set('events.recurrence.engine_v2_enabled', true);
        config()->set('events.recurrence.max_occurrences', 800);
        config()->set('events.recurrence.definition_blueprints.enabled', true);

        $capabilities = $this->service(true, false, true, true, true, true)->capabilities();

        self::assertSame('v2', $capabilities['engine']);
        self::assertSame(800, $capabilities['max_occurrences']);
        self::assertSame(['after_count', 'on_date'], $capabilities['supported_end_types']);
        self::assertFalse($capabilities['supports_rolling_never']);
        self::assertTrue($capabilities['supports_effective_revisions']);
        self::assertFalse($capabilities['supports_definition_blueprints']);
        self::assertTrue($capabilities['schema_ready']);
        self::assertSame('v2_finite', $capabilities['rollout_state']);
    }

    public function test_full_v2_rollout_exposes_rolling_never_revisions_and_definition_blueprints(): void
    {
        config()->set('events.recurrence.engine_v2_enabled', true);
        config()->set('events.recurrence.materialization.enabled', true);
        config()->set('events.recurrence.definition_blueprints.enabled', true);

        $capabilities = $this->service(true, true, true, true, true, true)->capabilities();

        self::assertSame(['after_count', 'on_date', 'never'], $capabilities['supported_end_types']);
        self::assertTrue($capabilities['supports_rolling_never']);
        self::assertTrue($capabilities['supports_effective_revisions']);
        self::assertTrue($capabilities['supports_definition_blueprints']);
        self::assertTrue($capabilities['schema_ready']);
        self::assertSame('v2_rolling', $capabilities['rollout_state']);
    }

    /**
     * @dataProvider degradedProvider
     * @param array<string,mixed> $configuration
     * @param array<string,mixed> $expected
     */
    public function test_partial_schema_and_configuration_states_fail_safe(
        array $configuration,
        array $expected,
    ): void {
        config()->set('events.recurrence.engine_v2_enabled', $configuration['v2_flag']);
        config()->set('events.recurrence.max_occurrences', $configuration['max_occurrences']);
        config()->set('events.recurrence.materialization.enabled', $configuration['materialization_flag']);
        config()->set('events.recurrence.definition_blueprints.enabled', $configuration['blueprint_flag']);

        $capabilities = $this->service(
            $configuration['schema'],
            $configuration['materialization_enabled'],
            $configuration['writer_enabled'],
            $configuration['materialization_valid'],
            $configuration['revision_schema'],
            $configuration['blueprint_schema'],
        )->capabilities();

        foreach ($expected as $key => $value) {
            self::assertSame($value, $capabilities[$key], $key);
        }
    }

    /** @return iterable<string,array{0:array<string,mixed>,1:array<string,mixed>}> */
    public static function degradedProvider(): iterable
    {
        $base = [
            'v2_flag' => true,
            'max_occurrences' => 366,
            'materialization_flag' => true,
            'blueprint_flag' => true,
            'schema' => true,
            'materialization_enabled' => true,
            'writer_enabled' => true,
            'materialization_valid' => true,
            'revision_schema' => true,
            'blueprint_schema' => true,
        ];

        yield 'missing core schema' => [[...$base, 'schema' => false], [
            'engine' => 'v2',
            'schema_ready' => false,
            'rollout_state' => 'v2_degraded',
            'supports_rolling_never' => false,
            'supports_effective_revisions' => false,
            'supports_definition_blueprints' => false,
        ]];
        yield 'missing revision schema' => [[...$base, 'revision_schema' => false], [
            'schema_ready' => false,
            'rollout_state' => 'v2_degraded',
            'supports_rolling_never' => false,
            'supports_effective_revisions' => false,
            'supports_definition_blueprints' => false,
        ]];
        yield 'invalid materialization configuration' => [[
            ...$base,
            'materialization_valid' => false,
        ], [
            'schema_ready' => true,
            'rollout_state' => 'v2_finite',
            'supports_rolling_never' => false,
            'supports_effective_revisions' => true,
            'supports_definition_blueprints' => false,
        ]];
        yield 'missing blueprint schema' => [[...$base, 'blueprint_schema' => false], [
            'schema_ready' => true,
            'rollout_state' => 'v2_rolling',
            'supports_rolling_never' => true,
            'supports_effective_revisions' => true,
            'supports_definition_blueprints' => false,
        ]];
        yield 'invalid max occurrence configuration' => [[
            ...$base,
            'max_occurrences' => 'not-an-integer',
        ], [
            'max_occurrences' => 1,
            'schema_ready' => true,
            'rollout_state' => 'v2_degraded',
            'supports_rolling_never' => false,
            'supports_effective_revisions' => false,
            'supports_definition_blueprints' => false,
        ]];
        yield 'non-boolean engine flag still reports the only engine, v2' => [[
            ...$base,
            'v2_flag' => 'true',
        ], [
            'engine' => 'v2',
            'max_occurrences' => 366,
        ]];
    }

    public function test_resource_is_an_exact_allowlist_and_fails_closed_for_unknown_values(): void
    {
        $resource = EventRecurrenceCapabilityResource::fromCapabilities([
            'contract_version' => 99,
            'engine' => 'unknown',
            'structured_input' => 'yes',
            'supported_frequencies' => ['yearly', 'unknown', 'daily'],
            'max_occurrences' => 9000,
            'supported_end_types' => ['never', 'unknown', 'on_date'],
            'supports_rolling_never' => 1,
            'supports_effective_revisions' => true,
            'supports_definition_blueprints' => 'true',
            'schema_ready' => true,
            'rollout_state' => 'internal-state',
            'internal_error' => 'must-not-leak',
        ]);

        self::assertSame([
            'contract_version',
            'engine',
            'structured_input',
            'supported_frequencies',
            'max_occurrences',
            'supported_end_types',
            'supports_rolling_never',
            'supports_effective_revisions',
            'supports_definition_blueprints',
            'schema_ready',
            'rollout_state',
        ], array_keys($resource));
        self::assertSame('legacy', $resource['engine']);
        self::assertSame(['daily', 'yearly'], $resource['supported_frequencies']);
        self::assertSame(['on_date'], $resource['supported_end_types']);
        self::assertSame(52, $resource['max_occurrences']);
        self::assertFalse($resource['supports_rolling_never']);
        self::assertFalse($resource['supports_effective_revisions']);
        self::assertFalse($resource['supports_definition_blueprints']);
        self::assertSame('legacy', $resource['rollout_state']);
    }

    private function service(
        bool $schemaAvailable,
        bool $materializationEnabled,
        bool $writerEnabled,
        bool $materializationValid,
        bool $revisionSchemaAvailable,
        bool $blueprintSchemaAvailable,
        bool $tenantRecurrenceEnabled = true,
    ): EventRecurrenceCapabilityService {
        return new class(
            $schemaAvailable,
            $materializationEnabled,
            $writerEnabled,
            $materializationValid,
            $revisionSchemaAvailable,
            $blueprintSchemaAvailable,
            $tenantRecurrenceEnabled,
        ) extends EventRecurrenceCapabilityService {
            public function __construct(
                private readonly bool $schemaAvailable,
                private readonly bool $materializationEnabled,
                private readonly bool $writerEnabled,
                private readonly bool $materializationValid,
                private readonly bool $revisionSchemaAvailable,
                private readonly bool $blueprintSchemaAvailable,
                private readonly bool $tenantRecurrenceEnabled,
            ) {}

            protected function tenantRecurrenceEnabled(): bool
            {
                return $this->tenantRecurrenceEnabled;
            }

            protected function materializationState(): array
            {
                return [
                    'schema_available' => $this->schemaAvailable,
                    'configuration' => [
                        'enabled' => $this->materializationEnabled,
                        'engine_v2_writer_enabled' => $this->writerEnabled,
                        'valid' => $this->materializationValid,
                    ],
                ];
            }

            protected function revisionSchemaAvailable(): bool
            {
                return $this->revisionSchemaAvailable;
            }

            protected function definitionBlueprintSchemaAvailable(): bool
            {
                return $this->blueprintSchemaAvailable;
            }
        };
    }
}
