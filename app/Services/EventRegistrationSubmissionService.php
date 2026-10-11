<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventRegistrationFormStatus;
use App\Enums\EventRegistrationQuestionType;
use App\Enums\EventRegistrationSubmissionStatus;
use App\Exceptions\EventRegistrationFoundationException;
use App\Models\EventRegistrationFormSubmission;
use App\Models\User;
use App\Policies\EventRegistrationPolicy;
use App\Support\Events\EventRegistrationFoundationSupport;
use App\Support\Events\EventRegistrationFormRuleSet;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use stdClass;

/** Encrypted form submission and audited field-access boundary. */
final class EventRegistrationSubmissionService
{
    private const ACTIVE_REGISTRATION_STATES = ['invited', 'pending', 'confirmed'];

    public function __construct(
        private readonly EventRegistrationFoundationSupport $support = new EventRegistrationFoundationSupport(),
        private readonly EventRegistrationFormRuleSet $rules = new EventRegistrationFormRuleSet(),
        private readonly EventRegistrationPolicy $policy = new EventRegistrationPolicy(),
    ) {
    }

    /**
     * @param array<string,mixed> $answers Stable question keys mapped to user answers.
     * @return array{submission:EventRegistrationFormSubmission,changed:bool}
     */
    public function saveDraft(
        int $eventId,
        int $registrationId,
        int $formVersionId,
        User|int $actor,
        array $answers,
        ?int $expectedRevision,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $registrationId,
            $formVersionId,
            $actor,
            $answers,
            $expectedRevision,
            $keyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $registration = $this->registration($tenantId, $eventId, $registrationId, true);
            if ((int) $registration->user_id !== (int) $persistedActor->id) {
                throw new EventRegistrationFoundationException('event_registration_submission_identity_mismatch');
            }
            if (! in_array((string) $registration->registration_state, self::ACTIVE_REGISTRATION_STATES, true)) {
                throw new EventRegistrationFoundationException('event_registration_submission_registration_inactive');
            }
            $form = $this->publishedForm($tenantId, $eventId, $formVersionId);
            $submission = $this->submissionForRegistration(
                $tenantId,
                $eventId,
                $registrationId,
                $formVersionId,
                true,
            );
            if ($submission === null) {
                $settings = DB::table('event_registration_settings')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $eventId)
                    ->lockForUpdate()
                    ->first();
                if ($settings === null
                    || (string) $settings->form_state !== 'published'
                    || (int) $settings->published_form_version !== (int) $form->version_number) {
                    throw new EventRegistrationFoundationException('event_registration_form_not_active');
                }
            }
            $questions = $this->questions($tenantId, $eventId, $formVersionId);
            $normalized = $this->normalizeAnswers($answers, $questions, false);
            $requestHash = $this->support->requestHash([
                'action' => 'draft_saved',
                'event_id' => $eventId,
                'registration_id' => $registrationId,
                'form_version_id' => $formVersionId,
                'actor_id' => (int) $persistedActor->id,
                'expected_revision' => $expectedRevision,
                'answers' => array_map(
                    static fn (array $answer): mixed => $answer['value'],
                    $normalized,
                ),
            ]);
            $replay = $this->historyReplay($tenantId, $keyHash, $requestHash);
            if ($replay !== null) {
                return [
                    'submission' => $this->submissionModel($tenantId, $eventId, (int) $replay->submission_id),
                    'changed' => false,
                ];
            }
            if ($submission !== null
                && ((string) $submission->status !== EventRegistrationSubmissionStatus::Draft->value
                    || $expectedRevision !== (int) $submission->revision)) {
                throw new EventRegistrationFoundationException('event_registration_submission_revision_conflict');
            }
            if ($submission === null && $expectedRevision !== null && $expectedRevision !== 0) {
                throw new EventRegistrationFoundationException('event_registration_submission_revision_conflict');
            }

            $now = CarbonImmutable::now('UTC');
            if ($submission === null) {
                $revision = 1;
                $submissionId = (int) DB::table('event_registration_form_submissions')->insertGetId([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'registration_id' => $registrationId,
                    'user_id' => (int) $persistedActor->id,
                    'form_version_id' => $formVersionId,
                    'supersedes_submission_id' => null,
                    'lineage_root_submission_id' => null,
                    'attempt_number' => 1,
                    'effective_slot' => 1,
                    'revision' => $revision,
                    'status' => EventRegistrationSubmissionStatus::Draft->value,
                    'submitted_at' => null,
                    'withdrawn_at' => null,
                    'anonymised_at' => null,
                    'superseded_at' => null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            } else {
                $submissionId = (int) $submission->id;
                $revision = (int) $submission->revision + 1;
                if (DB::table('event_registration_form_submissions')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $submissionId)
                    ->where('revision', $expectedRevision)
                    ->where('status', EventRegistrationSubmissionStatus::Draft->value)
                    ->update(['revision' => $revision, 'updated_at' => $now]) !== 1) {
                    throw new EventRegistrationFoundationException('event_registration_submission_revision_conflict');
                }
                DB::table('event_registration_form_answers')
                    ->where('tenant_id', $tenantId)
                    ->where('submission_id', $submissionId)
                    ->delete();
            }
            $eventEnd = $this->support->eventEnd($event);
            $this->insertAnswers(
                $tenantId,
                $eventId,
                $submissionId,
                $formVersionId,
                $normalized,
                $eventEnd,
                $now,
            );
            $this->recordHistory(
                $tenantId,
                $eventId,
                $submissionId,
                (int) $persistedActor->id,
                $revision,
                'draft_saved',
                $keyHash,
                $requestHash,
                array_keys($normalized),
                $now,
            );

            return [
                'submission' => $this->submissionModel($tenantId, $eventId, $submissionId),
                'changed' => true,
            ];
        }, 3);
    }

    /** @return array{submission:EventRegistrationFormSubmission,changed:bool} */
    public function submit(
        int $eventId,
        int $submissionId,
        User|int $actor,
        int $expectedRevision,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $submissionId,
            $actor,
            $expectedRevision,
            $keyHash,
        ): array {
            $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $submission = $this->submission($tenantId, $eventId, $submissionId, true);
            if ((int) $submission->user_id !== (int) $persistedActor->id) {
                throw new EventRegistrationFoundationException('event_registration_submission_identity_mismatch');
            }
            $requestHash = $this->support->requestHash([
                'action' => 'submitted',
                'event_id' => $eventId,
                'submission_id' => $submissionId,
                'actor_id' => (int) $persistedActor->id,
                'expected_revision' => $expectedRevision,
            ]);
            $replay = $this->historyReplay($tenantId, $keyHash, $requestHash);
            if ($replay !== null) {
                return [
                    'submission' => $this->submissionModel($tenantId, $eventId, $submissionId),
                    'changed' => false,
                ];
            }
            if ((string) $submission->status !== EventRegistrationSubmissionStatus::Draft->value
                || (int) ($submission->effective_slot ?? 0) !== 1
                || (int) $submission->revision !== $expectedRevision) {
                throw new EventRegistrationFoundationException('event_registration_submission_revision_conflict');
            }
            $registration = $this->registration(
                $tenantId,
                $eventId,
                (int) $submission->registration_id,
                true,
            );
            if (! in_array((string) $registration->registration_state, self::ACTIVE_REGISTRATION_STATES, true)) {
                throw new EventRegistrationFoundationException('event_registration_submission_registration_inactive');
            }
            $questions = $this->questions($tenantId, $eventId, (int) $submission->form_version_id);
            $stored = DB::table('event_registration_form_answers')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('submission_id', $submissionId)
                ->get()
                ->keyBy('question_id');
            $rawAnswers = [];
            foreach ($questions as $question) {
                $answer = $stored->get($question->id);
                if ($answer !== null && $answer->answer_ciphertext !== null) {
                    $rawAnswers[(string) $question->stable_key] = json_decode(
                        $this->support->decrypt((string) $answer->answer_ciphertext),
                        true,
                        512,
                        JSON_THROW_ON_ERROR,
                    );
                }
            }
            $this->normalizeAnswers($rawAnswers, $questions, true);
            $revision = $expectedRevision + 1;
            $now = CarbonImmutable::now('UTC');
            if (DB::table('event_registration_form_submissions')
                ->where('tenant_id', $tenantId)
                ->where('id', $submissionId)
                ->where('revision', $expectedRevision)
                ->where('status', EventRegistrationSubmissionStatus::Draft->value)
                ->update([
                    'revision' => $revision,
                    'status' => EventRegistrationSubmissionStatus::Submitted->value,
                    'submitted_at' => $now,
                    'updated_at' => $now,
                ]) !== 1) {
                throw new EventRegistrationFoundationException('event_registration_submission_revision_conflict');
            }
            $this->recordHistory(
                $tenantId,
                $eventId,
                $submissionId,
                (int) $persistedActor->id,
                $revision,
                'submitted',
                $keyHash,
                $requestHash,
                array_keys($rawAnswers),
                $now,
            );

            return [
                'submission' => $this->submissionModel($tenantId, $eventId, $submissionId),
                'changed' => true,
            ];
        }, 3);
    }

    /**
     * Start a correction without mutating any submitted answer. The prior
     * attempt remains immutable evidence and the cloned draft becomes the sole
     * effective lineage head.
     *
     * @return array{
     *   submission:EventRegistrationFormSubmission,
     *   superseded_submission:EventRegistrationFormSubmission,
     *   changed:bool
     * }
     */
    public function createAmendment(
        int $eventId,
        int $submissionId,
        User|int $actor,
        int $expectedRevision,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $submissionId,
            $actor,
            $expectedRevision,
            $keyHash,
        ): array {
            $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $source = $this->submission($tenantId, $eventId, $submissionId, true);
            if ((int) $source->user_id !== (int) $persistedActor->id) {
                throw new EventRegistrationFoundationException('event_registration_submission_identity_mismatch');
            }
            $requestHash = $this->support->requestHash([
                'action' => 'amendment_created',
                'event_id' => $eventId,
                'submission_id' => $submissionId,
                'actor_id' => (int) $persistedActor->id,
                'expected_revision' => $expectedRevision,
            ]);
            $replay = $this->historyReplay($tenantId, $keyHash, $requestHash);
            if ($replay !== null) {
                if ((string) $replay->action !== 'amendment_created') {
                    throw new EventRegistrationFoundationException('event_registration_submission_idempotency_conflict');
                }
                $amendment = $this->submissionModel($tenantId, $eventId, (int) $replay->submission_id);
                if ((int) $amendment->supersedes_submission_id !== $submissionId) {
                    throw new EventRegistrationFoundationException('event_registration_submission_idempotency_conflict');
                }

                return [
                    'submission' => $amendment,
                    'superseded_submission' => $this->submissionModel($tenantId, $eventId, $submissionId),
                    'changed' => false,
                ];
            }
            if ((string) $source->status !== EventRegistrationSubmissionStatus::Submitted->value
                || (int) ($source->effective_slot ?? 0) !== 1
                || (int) $source->revision !== $expectedRevision) {
                throw new EventRegistrationFoundationException('event_registration_submission_amendment_conflict');
            }
            $registration = $this->registration(
                $tenantId,
                $eventId,
                (int) $source->registration_id,
                true,
            );
            if ((int) $registration->user_id !== (int) $persistedActor->id
                || ! in_array((string) $registration->registration_state, self::ACTIVE_REGISTRATION_STATES, true)) {
                throw new EventRegistrationFoundationException('event_registration_submission_registration_inactive');
            }
            $this->publishedForm($tenantId, $eventId, (int) $source->form_version_id);
            $maxAttempt = (int) DB::table('event_registration_form_submissions')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('registration_id', (int) $source->registration_id)
                ->where('form_version_id', (int) $source->form_version_id)
                ->lockForUpdate()
                ->max('attempt_number');
            if ($maxAttempt !== (int) $source->attempt_number) {
                throw new EventRegistrationFoundationException('event_registration_submission_amendment_conflict');
            }

            $now = CarbonImmutable::now('UTC');
            $sourceRevision = $expectedRevision + 1;
            if (DB::table('event_registration_form_submissions')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $submissionId)
                ->where('revision', $expectedRevision)
                ->where('status', EventRegistrationSubmissionStatus::Submitted->value)
                ->where('effective_slot', 1)
                ->update([
                    'revision' => $sourceRevision,
                    'effective_slot' => null,
                    'superseded_at' => $now,
                    'updated_at' => $now,
                ]) !== 1) {
                throw new EventRegistrationFoundationException('event_registration_submission_amendment_conflict');
            }
            $rootId = $source->lineage_root_submission_id === null
                ? $submissionId
                : (int) $source->lineage_root_submission_id;
            $attempt = (int) $source->attempt_number + 1;
            $amendmentId = (int) DB::table('event_registration_form_submissions')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'registration_id' => (int) $source->registration_id,
                'user_id' => (int) $persistedActor->id,
                'form_version_id' => (int) $source->form_version_id,
                'supersedes_submission_id' => $submissionId,
                'lineage_root_submission_id' => $rootId,
                'attempt_number' => $attempt,
                'effective_slot' => 1,
                'revision' => 1,
                'status' => EventRegistrationSubmissionStatus::Draft->value,
                'submitted_at' => null,
                'withdrawn_at' => null,
                'anonymised_at' => null,
                'superseded_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $answers = DB::table('event_registration_form_answers')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('submission_id', $submissionId)
                ->whereNotNull('answer_ciphertext')
                ->orderBy('id')
                ->get();
            if ($answers->isNotEmpty()) {
                DB::table('event_registration_form_answers')->insert($answers->map(
                    static fn (object $answer): array => [
                        'tenant_id' => (int) $answer->tenant_id,
                        'event_id' => (int) $answer->event_id,
                        'submission_id' => $amendmentId,
                        'form_version_id' => (int) $answer->form_version_id,
                        'question_id' => (int) $answer->question_id,
                        'data_classification' => (string) $answer->data_classification,
                        'answer_ciphertext' => (string) $answer->answer_ciphertext,
                        'retention_due_at' => $answer->retention_due_at,
                        'consented_at' => $answer->consented_at,
                        'displayed_text_hash' => $answer->displayed_text_hash,
                        'displayed_text_version' => $answer->displayed_text_version,
                        'purged_at' => null,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ],
                )->all());
            }
            $answerKeys = DB::table('event_registration_form_questions')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('form_version_id', (int) $source->form_version_id)
                ->whereIn('id', $answers->pluck('question_id')->all())
                ->pluck('stable_key')
                ->map('strval')
                ->all();
            $this->recordHistory(
                $tenantId,
                $eventId,
                $submissionId,
                (int) $persistedActor->id,
                $sourceRevision,
                'superseded',
                hash('sha256', $keyHash . '|superseded|' . $submissionId),
                $this->support->requestHash([
                    'action' => 'superseded',
                    'submission_id' => $submissionId,
                    'amendment_id' => $amendmentId,
                    'attempt_number' => $attempt,
                ]),
                $answerKeys,
                $now,
            );
            $this->recordHistory(
                $tenantId,
                $eventId,
                $amendmentId,
                (int) $persistedActor->id,
                1,
                'amendment_created',
                $keyHash,
                $requestHash,
                $answerKeys,
                $now,
            );

            return [
                'submission' => $this->submissionModel($tenantId, $eventId, $amendmentId),
                'superseded_submission' => $this->submissionModel($tenantId, $eventId, $submissionId),
                'changed' => true,
            ];
        }, 3);
    }

    /**
     * Decrypt answers only after recording immutable per-field access evidence.
     *
     * @return array<string,array{question_id:int,value:mixed,purged:bool,classification:string}>
     */
    public function readAnswers(
        int $eventId,
        int $submissionId,
        User|int $actor,
        string $purpose,
        string $correlationId,
        string $action = 'read',
        bool $includeSensitive = false,
    ): array {
        $this->assertSchema();
        if (! in_array($action, ['read', 'export'], true)) {
            throw new EventRegistrationFoundationException('event_registration_answer_access_action_invalid');
        }
        $purpose = trim($purpose);
        if ($purpose === '' || mb_strlen($purpose) > 500) {
            throw new EventRegistrationFoundationException('event_registration_answer_access_purpose_invalid');
        }
        $tenantId = $this->support->tenantId();
        $correlationHash = $this->support->idempotencyHash($correlationId);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $submissionId,
            $actor,
            $purpose,
            $correlationHash,
            $action,
            $includeSensitive,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, false);
            $persistedActor = $this->support->actor($tenantId, $actor, false);
            $submission = $this->submission($tenantId, $eventId, $submissionId, false);
            $isOwner = (int) $submission->user_id === (int) $persistedActor->id;
            if (! $isOwner) {
                $allowed = $action === 'export'
                    ? $this->policy->exportAnswers($persistedActor, $event)
                    : $this->policy->reviewAnswers($persistedActor, $event);
                if (! $allowed) {
                    throw new EventRegistrationFoundationException('event_registration_answer_access_denied');
                }
            }
            $canReadSensitive = $isOwner || $this->policy->viewSensitiveAnswers($persistedActor, $event);
            if ($includeSensitive && ! $canReadSensitive) {
                throw new EventRegistrationFoundationException('event_registration_sensitive_answer_access_denied');
            }
            $answers = DB::table('event_registration_form_answers as answer')
                ->join('event_registration_form_questions as question', function ($join): void {
                    $join->on('question.id', '=', 'answer.question_id')
                        ->on('question.tenant_id', '=', 'answer.tenant_id')
                        ->on('question.event_id', '=', 'answer.event_id')
                        ->on('question.form_version_id', '=', 'answer.form_version_id');
                })
                ->where('answer.tenant_id', $tenantId)
                ->where('answer.event_id', $eventId)
                ->where('answer.submission_id', $submissionId)
                ->orderBy('question.position')
                ->get([
                    'answer.id',
                    'answer.question_id',
                    'answer.answer_ciphertext',
                    'answer.data_classification',
                    'answer.purged_at',
                    'question.stable_key',
                ]);
            $now = CarbonImmutable::now('UTC');
            $result = [];
            foreach ($answers as $answer) {
                $classification = (string) $answer->data_classification;
                if ($classification === 'sensitive' && (! $includeSensitive || ! $canReadSensitive)) {
                    continue;
                }
                DB::table('event_registration_answer_access_audits')->insert([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'submission_id' => $submissionId,
                    'answer_id' => (int) $answer->id,
                    'question_id' => (int) $answer->question_id,
                    'actor_user_id' => (int) $persistedActor->id,
                    'action' => $action,
                    'purpose' => $purpose,
                    'correlation_hash' => $correlationHash,
                    'created_at' => $now,
                ]);
                $purged = $answer->answer_ciphertext === null;
                $result[(string) $answer->stable_key] = [
                    'question_id' => (int) $answer->question_id,
                    'value' => $purged ? null : json_decode(
                        $this->support->decrypt((string) $answer->answer_ciphertext),
                        true,
                        512,
                        JSON_THROW_ON_ERROR,
                    ),
                    'purged' => $purged,
                    'classification' => $classification,
                ];
            }

            return $result;
        }, 3);
    }

    /**
     * @param array<string,mixed> $answers
     * @param iterable<int,stdClass> $questions
     * @return array<string,array{question:stdClass,value:mixed,consented:bool}>
     */
    /**
     * Which of these registrations still owe the event's required answers.
     *
     * Answers can only be given once a registration exists, so confirming a
     * place cannot demand them. Check-in is where they become binding: when
     * the event's PUBLISHED form has at least one required question, a
     * registration with no submitted answers is outstanding. A submission
     * counts once submitted, including an attempt later superseded by an
     * amendment or anonymised by retention; a draft or a withdrawn
     * submission does not.
     *
     * @param list<int> $registrationIds
     * @return array<int,true> Outstanding registration ids as keys.
     */
    public function registrationsWithOutstandingRequiredAnswers(
        int $tenantId,
        int $eventId,
        array $registrationIds,
    ): array {
        $registrationIds = array_values(array_unique(array_filter(
            array_map('intval', $registrationIds),
            static fn (int $id): bool => $id > 0,
        )));
        if ($registrationIds === [] || ! $this->publishedFormHasRequiredQuestions($tenantId, $eventId)) {
            return [];
        }

        $answered = DB::table('event_registration_form_submissions')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereIn('registration_id', $registrationIds)
            ->whereIn('status', [
                EventRegistrationSubmissionStatus::Submitted->value,
                EventRegistrationSubmissionStatus::Anonymised->value,
            ])
            ->distinct()
            ->pluck('registration_id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();

        return array_fill_keys(array_values(array_diff($registrationIds, $answered)), true);
    }

    public function requiredAnswersOutstanding(int $tenantId, int $eventId, int $registrationId): bool
    {
        return $this->registrationsWithOutstandingRequiredAnswers(
            $tenantId,
            $eventId,
            [$registrationId],
        ) !== [];
    }

    private function publishedFormHasRequiredQuestions(int $tenantId, int $eventId): bool
    {
        $settings = DB::table('event_registration_settings')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->first(['form_state', 'published_form_version']);
        if ($settings === null
            || (string) $settings->form_state !== 'published'
            || $settings->published_form_version === null) {
            return false;
        }

        return DB::table('event_registration_form_versions as form')
            ->join('event_registration_form_questions as question', function ($join): void {
                $join->on('question.form_version_id', '=', 'form.id')
                    ->on('question.tenant_id', '=', 'form.tenant_id')
                    ->on('question.event_id', '=', 'form.event_id');
            })
            ->where('form.tenant_id', $tenantId)
            ->where('form.event_id', $eventId)
            ->where('form.version_number', (int) $settings->published_form_version)
            ->where('form.status', EventRegistrationFormStatus::Published->value)
            ->where('question.is_required', 1)
            ->exists();
    }

    private function normalizeAnswers(array $answers, iterable $questions, bool $requireComplete): array
    {
        if (array_is_list($answers) && $answers !== []) {
            throw new EventRegistrationFoundationException('event_registration_answers_shape_invalid');
        }
        $byKey = [];
        foreach ($questions as $question) {
            $byKey[(string) $question->stable_key] = $question;
        }
        if (array_diff(array_keys($answers), array_keys($byKey)) !== []) {
            throw new EventRegistrationFoundationException('event_registration_answer_question_unknown');
        }
        $normalized = [];
        $visibleAnswers = [];
        foreach ($byKey as $key => $question) {
            $visibilityRules = $this->jsonRules($question->visibility_rules ?? null);
            $visible = $this->rules->isVisible($visibilityRules, $visibleAnswers);
            if (! $visible) {
                if (array_key_exists($key, $answers)) {
                    throw new EventRegistrationFoundationException('event_registration_hidden_answer_unexpected');
                }
                continue;
            }
            if (! array_key_exists($key, $answers)) {
                if ($requireComplete && (bool) $question->is_required) {
                    throw new EventRegistrationFoundationException('event_registration_required_answer_missing');
                }
                continue;
            }
            [$value, $consented] = $this->normalizeAnswer($question, $answers[$key]);
            $this->rules->assertValue(
                EventRegistrationQuestionType::from((string) $question->question_type),
                $value,
                $this->jsonRules($question->validation_rules ?? null),
            );
            if ($requireComplete && (bool) $question->is_required) {
                if ((is_string($value) && trim($value) === '')
                    || (is_array($value) && $value === [])
                    || (EventRegistrationQuestionType::from((string) $question->question_type)->isConsent()
                        && $consented !== true)) {
                    throw new EventRegistrationFoundationException('event_registration_required_answer_invalid');
                }
            }
            $normalized[$key] = [
                'question' => $question,
                'value' => $value,
                'consented' => $consented,
            ];
            $visibleAnswers[$key] = $value;
        }

        return $normalized;
    }

    /** @return array{0:mixed,1:bool} */
    private function normalizeAnswer(stdClass $question, mixed $value): array
    {
        $type = EventRegistrationQuestionType::from((string) $question->question_type);
        if ($type->isConsent()) {
            if (! is_bool($value)) {
                throw new EventRegistrationFoundationException('event_registration_consent_answer_invalid');
            }

            return [$value, $value];
        }
        if ($type === EventRegistrationQuestionType::MultipleChoice) {
            if (! is_array($value) || ! array_is_list($value) || count($value) > 100) {
                throw new EventRegistrationFoundationException('event_registration_multiple_choice_answer_invalid');
            }
            $choices = $this->choiceOptions($question);
            $values = [];
            foreach ($value as $choice) {
                if (! is_string($choice) || ! in_array($choice, $choices, true)) {
                    throw new EventRegistrationFoundationException('event_registration_choice_answer_invalid');
                }
                $values[] = $choice;
            }
            if (count(array_unique($values)) !== count($values)) {
                throw new EventRegistrationFoundationException('event_registration_choice_answer_duplicate');
            }

            return [$values, false];
        }
        if (! is_string($value)) {
            throw new EventRegistrationFoundationException('event_registration_text_answer_invalid');
        }
        $max = $type === EventRegistrationQuestionType::ShortText ? 500 : 10000;
        if (mb_strlen($value) > $max) {
            throw new EventRegistrationFoundationException('event_registration_text_answer_too_long');
        }
        if ($type === EventRegistrationQuestionType::SingleChoice
            && ! in_array($value, $this->choiceOptions($question), true)) {
            throw new EventRegistrationFoundationException('event_registration_choice_answer_invalid');
        }

        return [$value, false];
    }

    /** @return list<string> */
    private function choiceOptions(stdClass $question): array
    {
        $choices = json_decode((string) $question->choice_options, true, 512, JSON_THROW_ON_ERROR);
        if (! is_array($choices) || ! array_is_list($choices)) {
            throw new EventRegistrationFoundationException('event_registration_question_choices_invalid');
        }

        return array_values(array_map('strval', $choices));
    }

    /** @return array<string,mixed>|null */
    private function jsonRules(mixed $value): ?array
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_array($value)) {
            return $value;
        }
        $decoded = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);

        return is_array($decoded) ? $decoded : null;
    }

    /**
     * @param array<string,array{question:stdClass,value:mixed,consented:bool}> $answers
     */
    private function insertAnswers(
        int $tenantId,
        int $eventId,
        int $submissionId,
        int $formVersionId,
        array $answers,
        CarbonImmutable $eventEnd,
        CarbonImmutable $now,
    ): void {
        if ($answers === []) {
            return;
        }
        $rows = [];
        foreach ($answers as $answer) {
            $question = $answer['question'];
            $consented = $answer['consented'];
            $rows[] = [
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'submission_id' => $submissionId,
                'form_version_id' => $formVersionId,
                'question_id' => (int) $question->id,
                'data_classification' => (string) $question->data_classification,
                'answer_ciphertext' => $this->support->encrypt(json_encode(
                    $answer['value'],
                    JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE,
                )),
                'retention_due_at' => $eventEnd->addDays((int) $question->retention_days),
                'consented_at' => $consented ? $now : null,
                'displayed_text_hash' => $consented
                    ? hash('sha256', (string) $question->displayed_text)
                    : null,
                'displayed_text_version' => $consented
                    ? (string) $question->displayed_text_version
                    : null,
                'purged_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        DB::table('event_registration_form_answers')->insert($rows);
    }

    /** @param list<string> $keys */
    private function recordHistory(
        int $tenantId,
        int $eventId,
        int $submissionId,
        int $actorId,
        int $revision,
        string $action,
        string $keyHash,
        string $requestHash,
        array $keys,
        CarbonImmutable $now,
    ): void {
        sort($keys);
        DB::table('event_registration_submission_history')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'submission_id' => $submissionId,
            'actor_user_id' => $actorId,
            'revision' => $revision,
            'action' => $action,
            'idempotency_hash' => $keyHash,
            'request_hash' => $requestHash,
            'answer_keys' => json_encode($keys, JSON_THROW_ON_ERROR),
            'created_at' => $now,
        ]);
    }

    /** @return iterable<int,stdClass> */
    private function questions(int $tenantId, int $eventId, int $formVersionId): iterable
    {
        return DB::table('event_registration_form_questions')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('form_version_id', $formVersionId)
            ->orderBy('position')
            ->get();
    }

    private function publishedForm(int $tenantId, int $eventId, int $formId): stdClass
    {
        $form = DB::table('event_registration_form_versions')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $formId)
            ->where('status', EventRegistrationFormStatus::Published->value)
            ->first();
        if ($form === null) {
            throw new EventRegistrationFoundationException('event_registration_published_form_not_found');
        }

        return $form;
    }

    private function registration(int $tenantId, int $eventId, int $registrationId, bool $lock): stdClass
    {
        $query = DB::table('event_registrations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $registrationId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $row = $query->first();
        if ($row === null) {
            throw new EventRegistrationFoundationException('event_registration_not_found');
        }

        return $row;
    }

    private function submissionForRegistration(
        int $tenantId,
        int $eventId,
        int $registrationId,
        int $formVersionId,
        bool $lock,
    ): ?stdClass {
        $query = DB::table('event_registration_form_submissions')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('registration_id', $registrationId)
            ->where('form_version_id', $formVersionId)
            ->where('effective_slot', 1);
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->first();
    }

    private function submission(int $tenantId, int $eventId, int $submissionId, bool $lock): stdClass
    {
        $query = DB::table('event_registration_form_submissions')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $submissionId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $row = $query->first();
        if ($row === null) {
            throw new EventRegistrationFoundationException('event_registration_submission_not_found');
        }

        return $row;
    }

    private function historyReplay(int $tenantId, string $keyHash, string $requestHash): ?stdClass
    {
        $row = DB::table('event_registration_submission_history')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_hash', $keyHash)
            ->first();
        if ($row !== null && ! hash_equals((string) $row->request_hash, $requestHash)) {
            throw new EventRegistrationFoundationException('event_registration_submission_idempotency_conflict');
        }

        return $row;
    }

    private function submissionModel(
        int $tenantId,
        int $eventId,
        int $submissionId,
    ): EventRegistrationFormSubmission {
        return EventRegistrationFormSubmission::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereKey($submissionId)
            ->firstOrFail();
    }

    private function assertSchema(): void
    {
        foreach ([
            'event_registration_form_submissions',
            'event_registration_form_answers',
            'event_registration_submission_history',
            'event_registration_answer_access_audits',
        ] as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventRegistrationFoundationException('event_registration_submission_schema_unavailable');
            }
        }
        if (! Schema::hasColumns('event_registration_form_questions', [
            'validation_rules',
            'visibility_rules',
        ])) {
            throw new EventRegistrationFoundationException('event_registration_submission_schema_unavailable');
        }
        if (! Schema::hasColumns('event_registration_form_submissions', [
            'supersedes_submission_id',
            'lineage_root_submission_id',
            'attempt_number',
            'effective_slot',
            'superseded_at',
        ])) {
            throw new EventRegistrationFoundationException('event_registration_submission_schema_unavailable');
        }
    }
}
