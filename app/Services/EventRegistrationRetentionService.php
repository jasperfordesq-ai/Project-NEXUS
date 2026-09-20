<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventRegistrationSubmissionStatus;
use App\Exceptions\EventRegistrationFoundationException;
use App\Models\EventRegistrationRetentionRun;
use App\Models\User;
use App\Policies\EventRegistrationPolicy;
use App\Support\Events\EventRegistrationFoundationSupport;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use stdClass;

/** Evidence-preserving, preview-first post-event privacy retention boundary. */
final class EventRegistrationRetentionService
{
    private const MAX_ITEMS = 10000;

    public function __construct(
        private readonly EventRegistrationFoundationSupport $support = new EventRegistrationFoundationSupport(),
        private readonly EventRegistrationPolicy $policy = new EventRegistrationPolicy(),
    ) {
    }

    /** @return array{run:EventRegistrationRetentionRun,changed:bool} */
    public function dryRun(
        int $eventId,
        User|int $actor,
        DateTimeInterface|string $asOf,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $actor,
            $asOf,
            $keyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, false);
            $persistedActor = $this->support->actor($tenantId, $actor, false);
            if (! $this->policy->manageRetention($persistedActor, $event)) {
                throw new EventRegistrationFoundationException('event_registration_retention_denied');
            }
            $asOfUtc = $this->support->inputInstant(
                $asOf,
                $this->support->eventTimezone($event),
                'event_registration_retention_as_of_invalid',
            );
            if ($asOfUtc === null) {
                throw new EventRegistrationFoundationException('event_registration_retention_post_event_only');
            }
            // Replay the immutable snapshot, including older records using this hash
            // format. Applied or amended data must not change a saved request's identity.
            $existing = DB::table('event_registration_retention_runs')
                ->where('tenant_id', $tenantId)
                ->where('idempotency_hash', $keyHash)
                ->first();
            $candidates = $existing === null ? $this->candidates($tenantId, $eventId, $asOfUtc) : [];
            $candidateHash = $existing === null ? $this->candidateHash($candidates) : (string) $existing->candidate_hash;
            $requestHash = $this->support->requestHash([
                'action' => 'retention_dry_run',
                'event_id' => $eventId,
                'actor_id' => (int) $persistedActor->id,
                'as_of' => $asOfUtc,
                'candidate_hash' => $candidateHash,
            ]);
            $replay = $this->runReplay($tenantId, $keyHash, $requestHash);
            if ($replay !== null) {
                return ['run' => $this->runModel($tenantId, (int) $replay->id), 'changed' => false];
            }
            if ($asOfUtc->lessThan($this->support->eventEnd($event))) {
                throw new EventRegistrationFoundationException('event_registration_retention_post_event_only');
            }
            $now = CarbonImmutable::now('UTC');
            $runId = (int) DB::table('event_registration_retention_runs')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'mode' => 'dry_run',
                'dry_run_id' => null,
                'as_of_utc' => $asOfUtc,
                'eligible_count' => count($candidates),
                'affected_count' => 0,
                'candidate_hash' => $candidateHash,
                'idempotency_hash' => $keyHash,
                'request_hash' => $requestHash,
                'actor_user_id' => (int) $persistedActor->id,
                'completed_at' => $now,
                'created_at' => $now,
            ]);
            $this->insertItems($tenantId, $eventId, $runId, $candidates, 'preview', $now);

            return ['run' => $this->runModel($tenantId, $runId), 'changed' => true];
        }, 3);
    }

    /** @return array{run:EventRegistrationRetentionRun,changed:bool} */
    public function apply(
        int $eventId,
        int $dryRunId,
        User|int $actor,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $dryRunId,
            $actor,
            $keyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            if (! $this->policy->manageRetention($persistedActor, $event)) {
                throw new EventRegistrationFoundationException('event_registration_retention_denied');
            }
            $preview = DB::table('event_registration_retention_runs')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $dryRunId)
                ->where('mode', 'dry_run')
                ->lockForUpdate()
                ->first();
            if ($preview === null) {
                throw new EventRegistrationFoundationException('event_registration_retention_preview_not_found');
            }
            $requestHash = $this->support->requestHash([
                'action' => 'retention_apply',
                'event_id' => $eventId,
                'dry_run_id' => $dryRunId,
                'actor_id' => (int) $persistedActor->id,
                'candidate_hash' => (string) $preview->candidate_hash,
            ]);
            $replay = $this->runReplay($tenantId, $keyHash, $requestHash);
            if ($replay !== null) {
                return ['run' => $this->runModel($tenantId, (int) $replay->id), 'changed' => false];
            }
            $asOf = CarbonImmutable::parse((string) $preview->as_of_utc, 'UTC')->utc();
            if ($asOf->lessThan($this->support->eventEnd($event))) {
                throw new EventRegistrationFoundationException('event_registration_retention_post_event_only');
            }
            $previewItems = DB::table('event_registration_retention_items')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('run_id', $dryRunId)
                ->orderBy('id')
                ->get();
            if ($previewItems->count() !== (int) $preview->eligible_count) {
                throw new EventRegistrationFoundationException('event_registration_retention_preview_evidence_invalid');
            }
            $now = CarbonImmutable::now('UTC');
            $results = [];
            $affectedSubmissions = [];
            foreach ($previewItems as $item) {
                if ($item->answer_id !== null) {
                    $answer = DB::table('event_registration_form_answers')
                        ->where('tenant_id', $tenantId)
                        ->where('event_id', $eventId)
                        ->where('id', (int) $item->answer_id)
                        ->lockForUpdate()
                        ->first();
                    $eligible = $answer !== null
                        && $answer->answer_ciphertext !== null
                        && CarbonImmutable::parse((string) $answer->retention_due_at, 'UTC')->lessThanOrEqualTo($asOf)
                        && hash_equals((string) $item->ciphertext_hash, hash('sha256', (string) $answer->answer_ciphertext));
                    if ($eligible) {
                        DB::table('event_registration_form_answers')
                            ->where('tenant_id', $tenantId)
                            ->where('id', (int) $answer->id)
                            ->update([
                                'answer_ciphertext' => null,
                                'purged_at' => $now,
                                'updated_at' => $now,
                            ]);
                        $affectedSubmissions[(int) $answer->submission_id] = true;
                    }
                    $results[] = [
                        'answer_id' => (int) $item->answer_id,
                        'guest_id' => null,
                        'ciphertext_hash' => (string) $item->ciphertext_hash,
                        'action' => $eligible ? 'purged' : 'skipped',
                    ];
                    continue;
                }
                $guest = DB::table('event_registration_guests')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $eventId)
                    ->where('id', (int) $item->guest_id)
                    ->lockForUpdate()
                    ->first();
                $guestCipherHash = $guest === null ? null : $this->guestCipherHash($guest);
                $eligible = $guest !== null
                    && $guest->display_name_ciphertext !== null
                    && CarbonImmutable::parse((string) $guest->retention_due_at, 'UTC')->lessThanOrEqualTo($asOf)
                    && hash_equals((string) $item->ciphertext_hash, (string) $guestCipherHash);
                if ($eligible) {
                    DB::table('event_registration_guests')
                        ->where('tenant_id', $tenantId)
                        ->where('id', (int) $guest->id)
                        ->update([
                            'revision' => (int) $guest->revision + 1,
                            'status' => 'anonymised',
                            'display_name_ciphertext' => null,
                            'email_ciphertext' => null,
                            'phone_ciphertext' => null,
                            'identity_fingerprint' => null,
                            'anonymised_at' => $now,
                            'updated_at' => $now,
                        ]);
                }
                $results[] = [
                    'answer_id' => null,
                    'guest_id' => (int) $item->guest_id,
                    'ciphertext_hash' => (string) $item->ciphertext_hash,
                    'action' => $eligible ? 'purged' : 'skipped',
                ];
            }
            foreach (array_keys($affectedSubmissions) as $submissionId) {
                $remaining = DB::table('event_registration_form_answers')
                    ->where('tenant_id', $tenantId)
                    ->where('submission_id', $submissionId)
                    ->whereNotNull('answer_ciphertext')
                    ->exists();
                if (! $remaining) {
                    DB::table('event_registration_form_submissions')
                        ->where('tenant_id', $tenantId)
                        ->where('id', $submissionId)
                        ->whereIn('status', [
                            EventRegistrationSubmissionStatus::Submitted->value,
                            EventRegistrationSubmissionStatus::Withdrawn->value,
                        ])
                        ->update([
                            'status' => EventRegistrationSubmissionStatus::Anonymised->value,
                            'anonymised_at' => $now,
                            'updated_at' => $now,
                        ]);
                }
            }
            $affected = count(array_filter(
                $results,
                static fn (array $item): bool => $item['action'] === 'purged',
            ));
            $runId = (int) DB::table('event_registration_retention_runs')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'mode' => 'apply',
                'dry_run_id' => $dryRunId,
                'as_of_utc' => $asOf,
                'eligible_count' => count($results),
                'affected_count' => $affected,
                'candidate_hash' => (string) $preview->candidate_hash,
                'idempotency_hash' => $keyHash,
                'request_hash' => $requestHash,
                'actor_user_id' => (int) $persistedActor->id,
                'completed_at' => $now,
                'created_at' => $now,
            ]);
            $this->insertItems($tenantId, $eventId, $runId, $results, null, $now);

            return ['run' => $this->runModel($tenantId, $runId), 'changed' => true];
        }, 3);
    }

    /** @return list<array{answer_id:?int,guest_id:?int,ciphertext_hash:string,action?:string}> */
    private function candidates(int $tenantId, int $eventId, CarbonImmutable $asOf): array
    {
        $answers = DB::table('event_registration_form_answers')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereNotNull('answer_ciphertext')
            ->where('retention_due_at', '<=', $asOf)
            ->orderBy('id')
            ->limit(self::MAX_ITEMS + 1)
            ->get(['id', 'answer_ciphertext']);
        $guests = DB::table('event_registration_guests')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereNotNull('display_name_ciphertext')
            ->where('retention_due_at', '<=', $asOf)
            ->orderBy('id')
            ->limit(self::MAX_ITEMS + 1)
            ->get(['id', 'display_name_ciphertext', 'email_ciphertext', 'phone_ciphertext']);
        if ($answers->count() + $guests->count() > self::MAX_ITEMS) {
            throw new EventRegistrationFoundationException('event_registration_retention_item_limit_exceeded');
        }
        $candidates = [];
        foreach ($answers as $answer) {
            $candidates[] = [
                'answer_id' => (int) $answer->id,
                'guest_id' => null,
                'ciphertext_hash' => hash('sha256', (string) $answer->answer_ciphertext),
            ];
        }
        foreach ($guests as $guest) {
            $candidates[] = [
                'answer_id' => null,
                'guest_id' => (int) $guest->id,
                'ciphertext_hash' => $this->guestCipherHash($guest),
            ];
        }

        return $candidates;
    }

    /** @param list<array{answer_id:?int,guest_id:?int,ciphertext_hash:string,action?:string}> $items */
    private function candidateHash(array $items): string
    {
        return $this->support->requestHash(['items' => $items]);
    }

    private function guestCipherHash(stdClass $guest): string
    {
        return hash('sha256', implode('|', [
            (string) $guest->display_name_ciphertext,
            (string) $guest->email_ciphertext,
            (string) $guest->phone_ciphertext,
        ]));
    }

    /**
     * @param list<array{answer_id:?int,guest_id:?int,ciphertext_hash:string,action?:string}> $items
     */
    private function insertItems(
        int $tenantId,
        int $eventId,
        int $runId,
        array $items,
        ?string $forcedAction,
        CarbonImmutable $now,
    ): void {
        if ($items === []) {
            return;
        }
        DB::table('event_registration_retention_items')->insert(array_map(
            static fn (array $item): array => [
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'run_id' => $runId,
                'answer_id' => $item['answer_id'],
                'guest_id' => $item['guest_id'],
                'action' => $forcedAction ?? (string) $item['action'],
                'ciphertext_hash' => $item['ciphertext_hash'],
                'created_at' => $now,
            ],
            $items,
        ));
    }

    private function runReplay(int $tenantId, string $keyHash, string $requestHash): ?stdClass
    {
        $row = DB::table('event_registration_retention_runs')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_hash', $keyHash)
            ->first();
        if ($row !== null && ! hash_equals((string) $row->request_hash, $requestHash)) {
            throw new EventRegistrationFoundationException('event_registration_retention_idempotency_conflict');
        }

        return $row;
    }

    private function runModel(int $tenantId, int $runId): EventRegistrationRetentionRun
    {
        return EventRegistrationRetentionRun::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($runId)
            ->firstOrFail();
    }

    private function assertSchema(): void
    {
        foreach ([
            'event_registration_retention_runs',
            'event_registration_retention_items',
            'event_registration_form_answers',
            'event_registration_guests',
        ] as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventRegistrationFoundationException('event_registration_retention_schema_unavailable');
            }
        }
    }
}
