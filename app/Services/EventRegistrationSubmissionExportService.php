<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Exceptions\EventRegistrationFoundationException;
use App\Models\User;
use App\Policies\EventRegistrationPolicy;
use App\Support\Events\EventRegistrationCsv;
use App\Support\Events\EventRegistrationFoundationSupport;
use Illuminate\Support\Facades\DB;

/** Audited, bounded and formula-safe organizer export. */
final class EventRegistrationSubmissionExportService
{
    private const MAX_SUBMISSIONS = 10000;

    public function __construct(
        private readonly EventRegistrationFoundationSupport $support = new EventRegistrationFoundationSupport(),
        private readonly EventRegistrationSubmissionService $submissions = new EventRegistrationSubmissionService(),
        private readonly EventRegistrationPolicy $policy = new EventRegistrationPolicy(),
    ) {
    }

    /** @return array{headers:list<string>,rows:list<list<string>>,sensitive_included:bool} */
    public function export(
        int $eventId,
        User|int $actor,
        string $purpose,
        string $correlationId,
        bool $includeSensitive = false,
    ): array {
        $tenantId = $this->support->tenantId();
        $event = $this->support->concreteEvent($tenantId, $eventId, false);
        $persistedActor = $this->support->actor($tenantId, $actor, false);
        if (! $this->policy->exportAnswers($persistedActor, $event)) {
            throw new EventRegistrationFoundationException('event_registration_answer_export_denied');
        }
        if ($includeSensitive && ! $this->policy->viewSensitiveAnswers($persistedActor, $event)) {
            throw new EventRegistrationFoundationException('event_registration_sensitive_answer_access_denied');
        }

        // Validate even when there are no submissions to pass through readAnswers().
        $purpose = trim($purpose);
        if ($purpose === '' || mb_strlen($purpose) > 500) {
            throw new EventRegistrationFoundationException('event_registration_answer_access_purpose_invalid');
        }
        $this->support->idempotencyHash($correlationId);

        $questions = DB::table('event_registration_form_questions')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->orderBy('form_version_id')
            ->orderBy('position')
            ->get(['stable_key', 'prompt', 'data_classification'])
            ->unique('stable_key')
            ->filter(static fn (object $question): bool => $includeSensitive
                || (string) $question->data_classification !== 'sensitive')
            ->values();
        $questionKeys = $questions->pluck('stable_key')->map('strval')->all();
        $headers = [
            'submission_id',
            'registration_id',
            'member_id',
            'member_name',
            'attempt_number',
            'status',
            'submitted_at',
            ...$questions->map(static fn (object $question): string => EventRegistrationCsv::cell(
                (string) $question->stable_key . ': ' . (string) $question->prompt,
            ))->all(),
        ];
        $records = DB::table('event_registration_form_submissions as submission')
            ->join('users as member', function ($join): void {
                $join->on('member.id', '=', 'submission.user_id')
                    ->on('member.tenant_id', '=', 'submission.tenant_id');
            })
            ->where('submission.tenant_id', $tenantId)
            ->where('submission.event_id', $eventId)
            ->where('submission.effective_slot', 1)
            ->whereIn('submission.status', ['submitted', 'withdrawn'])
            ->orderBy('submission.id')
            ->limit(self::MAX_SUBMISSIONS + 1)
            ->get([
                'submission.id',
                'submission.registration_id',
                'submission.user_id',
                'submission.status',
                'submission.attempt_number',
                'submission.submitted_at',
                'member.name',
            ]);
        if ($records->count() > self::MAX_SUBMISSIONS) {
            throw new EventRegistrationFoundationException('event_registration_export_limit_exceeded');
        }

        $rows = [];
        foreach ($records as $record) {
            $recordCorrelation = $correlationId . ':' . (int) $record->id;
            // Keep existing audit hashes stable, while accepting a full-length
            // reference without truncating the submission-specific identity.
            if (strlen($recordCorrelation) > 512) {
                $recordCorrelation = hash('sha256', $recordCorrelation);
            }
            $answers = $this->submissions->readAnswers(
                $eventId,
                (int) $record->id,
                $persistedActor,
                $purpose,
                $recordCorrelation,
                'export',
                $includeSensitive,
            );
            $row = [
                EventRegistrationCsv::cell((int) $record->id),
                EventRegistrationCsv::cell((int) $record->registration_id),
                EventRegistrationCsv::cell((int) $record->user_id),
                EventRegistrationCsv::cell((string) $record->name),
                EventRegistrationCsv::cell((int) $record->attempt_number),
                EventRegistrationCsv::cell((string) $record->status),
                EventRegistrationCsv::cell($record->submitted_at),
            ];
            foreach ($questionKeys as $key) {
                $row[] = EventRegistrationCsv::cell($answers[$key]['value'] ?? null);
            }
            $rows[] = $row;
        }

        return [
            'headers' => $headers,
            'rows' => $rows,
            'sensitive_included' => $includeSensitive,
        ];
    }
}
