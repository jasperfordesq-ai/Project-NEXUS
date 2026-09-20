<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventInvitationCampaignStatus;
use App\Enums\EventInvitationCampaignType;
use App\Exceptions\EventRegistrationFoundationException;
use App\Models\EventInvitationCampaign;
use App\Models\User;
use App\Support\Events\EventInvitationRecipientAuthorizer;
use App\Support\Events\EventInvitationRecipientExpander;
use App\Support\Events\EventRegistrationFoundationSupport;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Versioned preview, schedule, and cancellation workflow for invitation campaigns. */
final class EventInvitationCampaignService
{
    private const SUPPORTED_LOCALES = [
        'ar', 'de', 'en', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt',
    ];

    private readonly EventInvitationRecipientAuthorizer $recipientAuthorizer;

    public function __construct(
        private readonly EventRegistrationFoundationSupport $support = new EventRegistrationFoundationSupport(),
        private readonly EventInvitationRecipientExpander $expander = new EventInvitationRecipientExpander(),
        ?EventInvitationRecipientAuthorizer $recipientAuthorizer = null,
    ) {
        $this->recipientAuthorizer = $recipientAuthorizer ?? new EventInvitationRecipientAuthorizer();
    }

    /**
     * @param array<string,mixed> $source Raw source is expanded in memory. Only the
     * validated normalized target snapshot is retained, encrypted at rest.
     * @return array{campaign:EventInvitationCampaign,changed:bool}
     */
    public function preview(
        int $eventId,
        User|int $actor,
        EventInvitationCampaignType|string $campaignType,
        array $source,
        string $idempotencyKey,
        ?string $defaultLocale = null,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $type = is_string($campaignType)
            ? EventInvitationCampaignType::tryFrom($campaignType)
            : $campaignType;
        if ($type === null) {
            throw new EventRegistrationFoundationException('event_invitation_campaign_type_invalid');
        }
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $actor,
            $type,
            $source,
            $keyHash,
            $defaultLocale,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorizeManager($persistedActor, $event);
            // Bind recovery to the submitted request, not to a recipient set that
            // can change while a successful preview's response is in flight.
            $requestHash = $this->support->requestHash([
                'action' => 'campaign_preview_input_v2',
                'event_id' => $eventId,
                'actor_id' => (int) $persistedActor->id,
                'campaign_type' => $type->value,
                'source' => $source,
                'default_locale' => $defaultLocale,
            ]);
            $replay = DB::table('event_invitation_campaigns')
                ->where('tenant_id', $tenantId)
                ->where('idempotency_hash', $keyHash)
                ->first();
            if ($replay !== null && hash_equals((string) $replay->request_hash, $requestHash)) {
                if (in_array($type, [EventInvitationCampaignType::Group, EventInvitationCampaignType::Audience], true)) {
                    $frozen = $this->expander->restoreSnapshot((string) $replay->source_snapshot_ciphertext, $type);
                    $this->expander->assertSnapshotSourceAuthority($tenantId, $type, $frozen['snapshot'], $persistedActor);
                }
                return [
                    'campaign' => $this->campaignModel($tenantId, (int) $replay->id),
                    'changed' => false,
                ];
            }
            $expanded = $this->expander->expand(
                $tenantId,
                $type,
                $source,
                $persistedActor,
            );
            $expanded = $this->recipientAuthorizer->filterPreview(
                $tenantId,
                $event,
                $persistedActor,
                $expanded,
            );
            $locale = $this->locale($defaultLocale ?? (string) ($persistedActor->preferred_language ?? 'en'));
            // Older previews stored only an expanded-snapshot fingerprint. Keep
            // their original comparison; the missing raw input cannot be inferred.
            $legacyRequestHash = $this->support->requestHash([
                'action' => 'campaign_previewed',
                'event_id' => $eventId,
                'actor_id' => (int) $persistedActor->id,
                'campaign_type' => $type->value,
                'source_hash' => $expanded['source_hash'],
                'default_locale' => $locale,
            ]);
            if ($replay !== null) {
                if (! hash_equals((string) $replay->request_hash, $legacyRequestHash)) {
                    throw new EventRegistrationFoundationException('event_invitation_campaign_idempotency_conflict');
                }

                return [
                    'campaign' => $this->campaignModel($tenantId, (int) $replay->id),
                    'changed' => false,
                ];
            }
            $now = CarbonImmutable::now('UTC');
            $campaignId = (int) DB::table('event_invitation_campaigns')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'occurrence_key' => (string) $event->getRawOriginal('occurrence_key'),
                'campaign_type' => $type->value,
                'status' => 'previewed',
                'revision' => 1,
                'source_hash' => $expanded['source_hash'],
                'source_schema_version' => 1,
                'source_snapshot_ciphertext' => $this->support->encrypt(json_encode(
                    $expanded['snapshot'],
                    JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
                )),
                'segment_criteria_summary' => $expanded['criteria_summary'] === null
                    ? null
                    : json_encode($expanded['criteria_summary'], JSON_THROW_ON_ERROR),
                'source_reference' => $expanded['source_reference'],
                'preview_count' => $expanded['preview_count'],
                'valid_count' => count($expanded['recipients']),
                'error_count' => count($expanded['errors']),
                'preview_errors' => json_encode($expanded['errors'], JSON_THROW_ON_ERROR),
                'default_locale' => $locale,
                'scheduled_for_utc' => null,
                'idempotency_hash' => $keyHash,
                'request_hash' => $requestHash,
                'created_by' => (int) $persistedActor->id,
                'updated_by' => (int) $persistedActor->id,
                'issued_at' => null,
                'started_at' => null,
                'completed_at' => null,
                'cancelled_at' => null,
                'cancelled_reason' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            DB::table('event_invitation_campaign_history')->insert([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'campaign_id' => $campaignId,
                'revision' => 1,
                'action' => EventInvitationCampaignStatus::Previewed->value,
                'actor_user_id' => (int) $persistedActor->id,
                'idempotency_hash' => $keyHash,
                'request_hash' => $requestHash,
                'metadata' => json_encode([
                    'campaign_type' => $type->value,
                    'preview_count' => $expanded['preview_count'],
                    'valid_count' => count($expanded['recipients']),
                    'error_count' => count($expanded['errors']),
                ], JSON_THROW_ON_ERROR),
                'created_at' => $now,
            ]);

            return ['campaign' => $this->campaignModel($tenantId, $campaignId), 'changed' => true];
        }, 3);
    }

    /** @return array{campaign:EventInvitationCampaign,changed:bool} */
    public function schedule(
        int $eventId,
        int $campaignId,
        User|int $actor,
        DateTimeInterface|string $scheduledFor,
        int $expectedRevision,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $campaignId,
            $actor,
            $scheduledFor,
            $expectedRevision,
            $keyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorizeManager($persistedActor, $event);
            $instant = $this->support->inputInstant(
                $scheduledFor,
                $this->support->eventTimezone($event),
                'event_invitation_campaign_schedule_invalid',
            );
            $now = CarbonImmutable::now('UTC');
            if ($instant === null) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_schedule_invalid');
            }
            $requestHash = $this->support->requestHash([
                'action' => EventInvitationCampaignStatus::Scheduled->value,
                'event_id' => $eventId,
                'campaign_id' => $campaignId,
                'actor_id' => (int) $persistedActor->id,
                'expected_revision' => $expectedRevision,
                'scheduled_for_utc' => $instant,
            ]);
            $replay = $this->historyReplay($tenantId, $keyHash, 'scheduled', $requestHash);
            if ($replay !== null) {
                return [
                    'campaign' => $this->campaignModel($tenantId, (int) $replay->campaign_id),
                    'changed' => false,
                ];
            }
            // A lost acknowledgement can be retried after the send time. Exact
            // replay returns the current campaign without scheduling it again.
            if (! $instant->greaterThan($now)
                || ! $instant->lessThan($this->support->eventStart($event))) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_schedule_invalid');
            }
            $campaign = $this->campaign($tenantId, $eventId, $campaignId, true);
            if ((string) $campaign->status !== EventInvitationCampaignStatus::Previewed->value
                || (int) $campaign->revision !== $expectedRevision) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_revision_conflict');
            }
            $revision = $expectedRevision + 1;
            if (DB::table('event_invitation_campaigns')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $campaignId)
                ->where('status', EventInvitationCampaignStatus::Previewed->value)
                ->where('revision', $expectedRevision)
                ->update([
                    'status' => EventInvitationCampaignStatus::Scheduled->value,
                    'revision' => $revision,
                    'scheduled_for_utc' => $instant,
                    'updated_by' => (int) $persistedActor->id,
                    'updated_at' => $now,
                ]) !== 1) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_revision_conflict');
            }
            $this->recordHistory(
                $tenantId,
                $eventId,
                $campaignId,
                $revision,
                EventInvitationCampaignStatus::Scheduled->value,
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                ['scheduled_for_utc' => $instant->format('Y-m-d\TH:i:s.u\Z')],
                $now,
            );

            return ['campaign' => $this->campaignModel($tenantId, $campaignId), 'changed' => true];
        }, 3);
    }

    /** @return array{campaign:EventInvitationCampaign,changed:bool} */
    public function cancel(
        int $eventId,
        int $campaignId,
        User|int $actor,
        int $expectedRevision,
        string $reason,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason) > 500) {
            throw new EventRegistrationFoundationException('event_invitation_campaign_cancellation_reason_invalid');
        }

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $campaignId,
            $actor,
            $expectedRevision,
            $reason,
            $keyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorizeManager($persistedActor, $event);
            $requestHash = $this->support->requestHash([
                'action' => EventInvitationCampaignStatus::Cancelled->value,
                'event_id' => $eventId,
                'campaign_id' => $campaignId,
                'actor_id' => (int) $persistedActor->id,
                'expected_revision' => $expectedRevision,
                'reason' => $reason,
            ]);
            $replay = $this->historyReplay($tenantId, $keyHash, 'cancelled', $requestHash);
            if ($replay !== null) {
                return [
                    'campaign' => $this->campaignModel($tenantId, (int) $replay->campaign_id),
                    'changed' => false,
                ];
            }
            $campaign = $this->campaign($tenantId, $eventId, $campaignId, true);
            if (! in_array((string) $campaign->status, [
                EventInvitationCampaignStatus::Previewed->value,
                EventInvitationCampaignStatus::Scheduled->value,
            ], true) || (int) $campaign->revision !== $expectedRevision) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_revision_conflict');
            }
            $revision = $expectedRevision + 1;
            $now = CarbonImmutable::now('UTC');
            if (DB::table('event_invitation_campaigns')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $campaignId)
                ->whereIn('status', [
                    EventInvitationCampaignStatus::Previewed->value,
                    EventInvitationCampaignStatus::Scheduled->value,
                ])
                ->where('revision', $expectedRevision)
                ->update([
                    'status' => EventInvitationCampaignStatus::Cancelled->value,
                    'revision' => $revision,
                    'scheduled_for_utc' => null,
                    'cancelled_at' => $now,
                    'cancelled_reason' => $reason,
                    'updated_by' => (int) $persistedActor->id,
                    'updated_at' => $now,
                ]) !== 1) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_revision_conflict');
            }
            $this->recordHistory(
                $tenantId,
                $eventId,
                $campaignId,
                $revision,
                EventInvitationCampaignStatus::Cancelled->value,
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                ['reason' => $reason],
                $now,
            );

            return ['campaign' => $this->campaignModel($tenantId, $campaignId), 'changed' => true];
        }, 3);
    }

    /** @return list<int> */
    public function dueCampaignIds(int $limit = 100): array
    {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $limit = max(1, min(500, $limit));

        return DB::table('event_invitation_campaigns')
            ->where('tenant_id', $tenantId)
            ->where('status', EventInvitationCampaignStatus::Scheduled->value)
            ->where('scheduled_for_utc', '<=', CarbonImmutable::now('UTC'))
            ->orderBy('scheduled_for_utc')
            ->orderBy('id')
            ->limit($limit)
            ->pluck('id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
    }

    private function campaignModel(int $tenantId, int $campaignId): EventInvitationCampaign
    {
        return EventInvitationCampaign::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($campaignId)
            ->firstOrFail();
    }

    private function campaign(int $tenantId, int $eventId, int $campaignId, bool $lock): object
    {
        $query = DB::table('event_invitation_campaigns')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $campaignId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $campaign = $query->first();
        if ($campaign === null) {
            throw new EventRegistrationFoundationException('event_invitation_campaign_not_found');
        }

        return $campaign;
    }

    private function historyReplay(
        int $tenantId,
        string $keyHash,
        string $action,
        string $requestHash,
    ): ?object {
        $history = DB::table('event_invitation_campaign_history')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_hash', $keyHash)
            ->first();
        if ($history !== null
            && ((string) $history->action !== $action
                || ! hash_equals((string) $history->request_hash, $requestHash))) {
            throw new EventRegistrationFoundationException('event_invitation_campaign_idempotency_conflict');
        }

        return $history;
    }

    /** @param array<string,mixed> $metadata */
    private function recordHistory(
        int $tenantId,
        int $eventId,
        int $campaignId,
        int $revision,
        string $action,
        int $actorId,
        string $keyHash,
        string $requestHash,
        array $metadata,
        CarbonImmutable $now,
    ): void {
        DB::table('event_invitation_campaign_history')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'campaign_id' => $campaignId,
            'revision' => $revision,
            'action' => $action,
            'actor_user_id' => $actorId,
            'idempotency_hash' => $keyHash,
            'request_hash' => $requestHash,
            'metadata' => json_encode($metadata, JSON_THROW_ON_ERROR),
            'created_at' => $now,
        ]);
    }

    private function locale(string $locale): string
    {
        $locale = strtolower(trim(str_replace('_', '-', $locale)));
        $locale = explode('-', $locale, 2)[0];
        if (! in_array($locale, self::SUPPORTED_LOCALES, true)) {
            throw new EventRegistrationFoundationException('event_invitation_campaign_locale_invalid');
        }

        return $locale;
    }

    private function assertSchema(): void
    {
        foreach (['event_invitation_campaigns', 'event_invitation_campaign_history'] as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_schema_unavailable');
            }
        }
        foreach ([
            'source_schema_version', 'source_snapshot_ciphertext', 'segment_criteria_summary',
            'default_locale', 'scheduled_for_utc', 'started_at', 'completed_at',
            'cancelled_reason',
        ] as $column) {
            if (! Schema::hasColumn('event_invitation_campaigns', $column)) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_schema_unavailable');
            }
        }
    }
}
