<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventRegistrationApprovalMode;
use App\Enums\EventRegistrationSettingsStatus;
use App\Exceptions\EventRegistrationFoundationException;
use App\Models\EventRegistrationSettings;
use App\Models\User;
use App\Support\Events\EventRegistrationFoundationSupport;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use stdClass;

/** Optimistically versioned registration-window and approval configuration. */
final class EventRegistrationSettingsService
{
    private const FIELDS = [
        'approval_mode',
        'opens_at',
        'opens_at_utc',
        'closes_at',
        'closes_at_utc',
        'cancellation_cutoff_at',
        'cancellation_cutoff_at_utc',
        'per_member_limit',
        'guests_enabled',
        'max_guests_per_registration',
        'guest_retention_days',
    ];

    public function __construct(
        private readonly EventRegistrationFoundationSupport $support = new EventRegistrationFoundationSupport(),
        private readonly ?EventDomainOutboxService $outbox = null,
    ) {
    }

    /**
     * @param array<string,mixed> $attributes
     * @return array{settings:EventRegistrationSettings,changed:bool}
     */
    public function save(
        int $eventId,
        User|int $actor,
        array $attributes,
        ?int $expectedRevision,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $this->assertKnownFields($attributes);
        $this->assertAliasPairs($attributes);
        $tenantId = $this->support->tenantId();
        $idempotencyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $actor,
            $attributes,
            $expectedRevision,
            $idempotencyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorizeManager($persistedActor, $event);
            $settings = $this->settingsRow($tenantId, $eventId, true);
            $normalized = $this->normalize($event, $attributes, $settings);
            $cancellationPolicyChanged = $this->publishedCancellationPolicyChanged(
                $settings,
                $normalized['cancellation_cutoff_at_utc'],
            );
            $intentAction = $expectedRevision === null || $expectedRevision === 0
                ? 'created'
                : 'updated';
            $requestHash = $this->support->requestHash([
                'action' => $intentAction,
                'event_id' => $eventId,
                'actor_id' => (int) $persistedActor->id,
                'expected_revision' => $expectedRevision,
                'attributes' => $normalized,
            ]);
            $replay = $this->historyReplay($tenantId, $idempotencyHash, $requestHash);
            if ($replay !== null) {
                return [
                    'settings' => $this->settingsModel($tenantId, $eventId),
                    'changed' => false,
                ];
            }

            $now = CarbonImmutable::now('UTC');
            if ($settings === null) {
                if ($expectedRevision !== null && $expectedRevision !== 0) {
                    throw new EventRegistrationFoundationException('event_registration_settings_revision_conflict');
                }
                $revision = 1;
                $settingsId = (int) DB::table('event_registration_settings')->insertGetId([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'occurrence_key' => (string) $event->getRawOriginal('occurrence_key'),
                    'revision' => $revision,
                    'status' => EventRegistrationSettingsStatus::Draft->value,
                    ...$normalized,
                    'form_state' => 'none',
                    'published_form_version' => null,
                    'created_by' => (int) $persistedActor->id,
                    'updated_by' => (int) $persistedActor->id,
                    'published_by' => null,
                    'published_at' => null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $action = 'created';
            } else {
                if ($expectedRevision === null || $expectedRevision !== (int) $settings->revision) {
                    throw new EventRegistrationFoundationException('event_registration_settings_revision_conflict');
                }
                $revision = $expectedRevision + 1;
                $updated = DB::table('event_registration_settings')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $eventId)
                    ->where('revision', $expectedRevision)
                    ->update([
                        ...$normalized,
                        'revision' => $revision,
                        'updated_by' => (int) $persistedActor->id,
                        'updated_at' => $now,
                    ]);
                if ($updated !== 1) {
                    throw new EventRegistrationFoundationException('event_registration_settings_revision_conflict');
                }
                $settingsId = (int) $settings->id;
                $action = 'updated';
            }

            DB::table('event_registration_settings_history')->insert([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'settings_id' => $settingsId,
                'revision' => $revision,
                'action' => $action,
                'actor_user_id' => (int) $persistedActor->id,
                'idempotency_hash' => $idempotencyHash,
                'request_hash' => $requestHash,
                'changed_fields' => json_encode(array_keys($normalized), JSON_THROW_ON_ERROR),
                'created_at' => $now,
            ]);

            if ($cancellationPolicyChanged) {
                ($this->outbox ?? new EventDomainOutboxService())->record(
                    $tenantId,
                    $eventId,
                    $revision,
                    'event.updated',
                    "event-registration-settings:{$tenantId}:{$eventId}:revision:{$revision}",
                    [
                        'schema_version' => 1,
                        'tenant_id' => $tenantId,
                        'event_id' => $eventId,
                        'actor_user_id' => (int) $persistedActor->id,
                        'organizer_user_id' => (int) $event->getAttribute('user_id'),
                        'settings_revision' => $revision,
                        'changed_fields' => ['cancellation_policy'],
                        'recurrence_scope' => 'single',
                        'occurred_at' => $now->toIso8601String(),
                    ],
                    aggregateStream: "event:{$eventId}:registration-settings",
                );
            }

            return [
                'settings' => $this->settingsModel($tenantId, $eventId),
                'changed' => true,
            ];
        }, 3);
    }

    /** @return array{settings:EventRegistrationSettings,changed:bool} */
    public function publish(
        int $eventId,
        User|int $actor,
        int $expectedRevision,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $idempotencyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $actor,
            $expectedRevision,
            $idempotencyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorizeManager($persistedActor, $event);
            $settings = $this->settingsRow($tenantId, $eventId, true);
            if ($settings === null) {
                throw new EventRegistrationFoundationException('event_registration_settings_not_found');
            }
            $requestHash = $this->support->requestHash([
                'action' => 'published',
                'event_id' => $eventId,
                'actor_id' => (int) $persistedActor->id,
                'expected_revision' => $expectedRevision,
            ]);
            $replay = $this->historyReplay($tenantId, $idempotencyHash, $requestHash);
            if ($replay !== null) {
                return ['settings' => $this->settingsModel($tenantId, $eventId), 'changed' => false];
            }
            if ($expectedRevision !== (int) $settings->revision) {
                throw new EventRegistrationFoundationException('event_registration_settings_revision_conflict');
            }
            $revision = $expectedRevision + 1;
            $now = CarbonImmutable::now('UTC');
            $updated = DB::table('event_registration_settings')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('revision', $expectedRevision)
                ->update([
                    'revision' => $revision,
                    'status' => EventRegistrationSettingsStatus::Published->value,
                    'published_by' => (int) $persistedActor->id,
                    'published_at' => $now,
                    'updated_by' => (int) $persistedActor->id,
                    'updated_at' => $now,
                ]);
            if ($updated !== 1) {
                throw new EventRegistrationFoundationException('event_registration_settings_revision_conflict');
            }
            DB::table('event_registration_settings_history')->insert([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'settings_id' => (int) $settings->id,
                'revision' => $revision,
                'action' => 'published',
                'actor_user_id' => (int) $persistedActor->id,
                'idempotency_hash' => $idempotencyHash,
                'request_hash' => $requestHash,
                'changed_fields' => json_encode(['status'], JSON_THROW_ON_ERROR),
                'created_at' => $now,
            ]);

            return ['settings' => $this->settingsModel($tenantId, $eventId), 'changed' => true];
        }, 3);
    }

    /** @param array<string,mixed> $attributes */
    private function normalize(object $event, array $attributes, ?stdClass $current): array
    {
        $timezone = $this->support->eventTimezone($event);
        $eventStart = $this->support->eventStart($event);
        $value = static fn (string $field, mixed $default): mixed => array_key_exists($field, $attributes)
            ? $attributes[$field]
            : $default;
        $raw = static function (stdClass $row, string $field): mixed {
            return property_exists($row, $field) ? $row->{$field} : null;
        };

        // An explicit null removes a date; only an omitted field preserves it.
        // Alias pairs have already been rejected by assertAliasPairs().
        $dateInput = static function (string $field) use ($attributes, $current, $raw): mixed {
            foreach ([$field . '_utc', $field] as $key) {
                if (array_key_exists($key, $attributes)) {
                    return $attributes[$key];
                }
            }

            return $current !== null ? $raw($current, $field . '_utc') : null;
        };
        $opensInput = $dateInput('opens_at');
        $closesInput = $dateInput('closes_at');
        $cutoffInput = $dateInput('cancellation_cutoff_at');
        $opens = $this->normalizeStoredOrInput($opensInput, $timezone, 'event_registration_opens_at_invalid', array_key_exists('opens_at_utc', $attributes));
        $closes = $this->normalizeStoredOrInput($closesInput, $timezone, 'event_registration_closes_at_invalid', array_key_exists('closes_at_utc', $attributes));
        $cutoff = $this->normalizeStoredOrInput($cutoffInput, $timezone, 'event_registration_cutoff_invalid', array_key_exists('cancellation_cutoff_at_utc', $attributes));
        if (($opens === null) !== ($closes === null)
            || ($opens !== null && $closes !== null && ! $opens->lessThan($closes))) {
            throw new EventRegistrationFoundationException('event_registration_window_invalid');
        }
        if (($closes !== null && $closes->greaterThan($eventStart))
            || ($cutoff !== null && $cutoff->greaterThan($eventStart))) {
            throw new EventRegistrationFoundationException('event_registration_window_after_event_start');
        }

        $approval = (string) $value(
            'approval_mode',
            $current?->approval_mode ?? EventRegistrationApprovalMode::Auto->value,
        );
        if (EventRegistrationApprovalMode::tryFrom($approval) === null) {
            throw new EventRegistrationFoundationException('event_registration_approval_mode_invalid');
        }
        $perMember = $this->boundedInt(
            $value('per_member_limit', $current?->per_member_limit ?? 1),
            1,
            10,
            'event_registration_per_member_limit_invalid',
        );
        $guestsEnabled = filter_var(
            $value('guests_enabled', $current?->guests_enabled ?? false),
            FILTER_VALIDATE_BOOL,
            FILTER_NULL_ON_FAILURE,
        );
        if ($guestsEnabled === null) {
            throw new EventRegistrationFoundationException('event_registration_guests_enabled_invalid');
        }
        if ($guestsEnabled && ! (bool) app(EventConfigurationService::class)->value(
            'guest_registration_enabled',
            true,
            (int) $event->tenant_id,
        )) {
            throw new EventRegistrationFoundationException('event_registration_guests_tenant_disabled');
        }
        $maxGuests = $this->boundedInt(
            $value('max_guests_per_registration', $current?->max_guests_per_registration ?? 0),
            0,
            10,
            'event_registration_max_guests_invalid',
        );
        if ((! $guestsEnabled && $maxGuests !== 0) || ($guestsEnabled && $maxGuests < 1)) {
            throw new EventRegistrationFoundationException('event_registration_guest_configuration_invalid');
        }

        return [
            'approval_mode' => $approval,
            'event_starts_at_utc_snapshot' => $eventStart,
            'event_timezone_snapshot' => $timezone,
            'opens_at_utc' => $opens,
            'closes_at_utc' => $closes,
            'cancellation_cutoff_at_utc' => $cutoff,
            'per_member_limit' => $perMember,
            'guests_enabled' => $guestsEnabled,
            'max_guests_per_registration' => $maxGuests,
            'guest_retention_days' => $this->boundedInt(
                $value('guest_retention_days', $current?->guest_retention_days ?? 30),
                1,
                36500,
                'event_registration_guest_retention_invalid',
            ),
        ];
    }

    private function normalizeStoredOrInput(
        mixed $value,
        string $timezone,
        string $reason,
        bool $explicitUtc = false,
    ): ?CarbonImmutable {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $value) === 1) {
            return CarbonImmutable::parse($value, 'UTC')->utc();
        }

        // Explicit UTC fields are sent as UTC ISO instants by web and native clients.
        // Legacy local fields still require an offset matching the event timezone.
        if ($explicitUtc && is_string($value) && preg_match('/(?:Z|[+-]00:00)$/', trim($value)) === 1) {
            return $this->support->inputInstant($value, 'UTC', $reason);
        }

        return $this->support->inputInstant($value, $timezone, $reason);
    }

    private function publishedCancellationPolicyChanged(
        ?stdClass $settings,
        ?CarbonImmutable $nextCutoff,
    ): bool {
        if ($settings === null
            || (string) ($settings->status ?? '') !== EventRegistrationSettingsStatus::Published->value) {
            return false;
        }

        $current = $settings->cancellation_cutoff_at_utc ?? null;
        $currentIdentity = $current === null || $current === ''
            ? null
            : CarbonImmutable::parse((string) $current, 'UTC')->utc()->format('Y-m-d H:i:s');
        $nextIdentity = $nextCutoff?->utc()->format('Y-m-d H:i:s');

        return $currentIdentity !== $nextIdentity;
    }

    private function boundedInt(mixed $value, int $min, int $max, string $reason): int
    {
        if (filter_var($value, FILTER_VALIDATE_INT) === false) {
            throw new EventRegistrationFoundationException($reason);
        }
        $number = (int) $value;
        if ($number < $min || $number > $max) {
            throw new EventRegistrationFoundationException($reason);
        }

        return $number;
    }

    /** @param array<string,mixed> $attributes */
    private function assertKnownFields(array $attributes): void
    {
        $unknown = array_diff(array_keys($attributes), self::FIELDS);
        if ($unknown !== []) {
            throw new EventRegistrationFoundationException('event_registration_settings_fields_unknown');
        }
    }

    /** @param array<string,mixed> $attributes */
    private function assertAliasPairs(array $attributes): void
    {
        foreach ([
            ['opens_at', 'opens_at_utc'],
            ['closes_at', 'closes_at_utc'],
            ['cancellation_cutoff_at', 'cancellation_cutoff_at_utc'],
        ] as [$left, $right]) {
            if (array_key_exists($left, $attributes) && array_key_exists($right, $attributes)) {
                throw new EventRegistrationFoundationException('event_registration_settings_alias_conflict');
            }
        }
    }

    private function settingsRow(int $tenantId, int $eventId, bool $lock): ?stdClass
    {
        $query = DB::table('event_registration_settings')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId);
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->first();
    }

    private function historyReplay(int $tenantId, string $key, string $requestHash): ?stdClass
    {
        $row = DB::table('event_registration_settings_history')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_hash', $key)
            ->first();
        if ($row !== null && ! hash_equals((string) $row->request_hash, $requestHash)) {
            throw new EventRegistrationFoundationException('event_registration_settings_idempotency_conflict');
        }

        return $row;
    }

    private function settingsModel(int $tenantId, int $eventId): EventRegistrationSettings
    {
        return EventRegistrationSettings::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->firstOrFail();
    }

    private function assertSchema(): void
    {
        if (! Schema::hasTable('event_registration_settings')
            || ! Schema::hasTable('event_registration_settings_history')) {
            throw new EventRegistrationFoundationException('event_registration_settings_schema_unavailable');
        }
    }
}
