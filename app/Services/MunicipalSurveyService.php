<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Support\CsvExportSanitizer;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use RuntimeException;

/**
 * AG62 — Municipality Survey & Feedback Tool
 *
 * Manages the full lifecycle of Gemeinde-grade surveys:
 *   draft → active → closed
 *
 * Anonymous-response option: when is_anonymous = 1, user_id is NOT stored;
 * a session_token (sha256 of user_id + survey_id + date) is stored instead
 * for dedup purposes only.
 */
class MunicipalSurveyService
{
    private const TABLE_SURVEYS   = 'municipality_surveys';
    private const TABLE_QUESTIONS = 'municipality_survey_questions';
    private const TABLE_RESPONSES = 'municipality_survey_responses';

    // ─── Availability ─────────────────────────────────────────────────────────

    /**
     * Returns true when all three tables exist (migration has run).
     */
    public static function isAvailable(): bool
    {
        return Schema::hasTable(self::TABLE_SURVEYS)
            && Schema::hasTable(self::TABLE_QUESTIONS)
            && Schema::hasTable(self::TABLE_RESPONSES);
    }

    // ─── Member-facing reads ──────────────────────────────────────────────────

    /**
     * List surveys visible to the given tenant.
     * Optionally filter by status.
     * Each row includes question_count + response_count.
     */
    public static function listSurveys(int $tenantId, ?string $status = null): array
    {
        $q = DB::table(self::TABLE_SURVEYS . ' as s')
            ->leftJoin(
                DB::raw('(SELECT survey_id, COUNT(*) AS qcount FROM ' . self::TABLE_QUESTIONS . ' GROUP BY survey_id) AS qc'),
                'qc.survey_id', '=', 's.id'
            )
            ->where('s.tenant_id', $tenantId)
            ->select([
                's.id', 's.title', 's.description', 's.status',
                's.is_anonymous', 's.starts_at', 's.ends_at',
                's.response_count', 's.created_at', 's.created_by',
                DB::raw('COALESCE(qc.qcount, 0) AS question_count'),
            ])
            ->orderBy('s.created_at', 'desc');

        if ($status !== null) {
            $q->where('s.status', $status);
        }

        return $q->get()->map(fn ($row) => (array) $row)->toArray();
    }

    /**
     * Fetch a single survey with its questions ordered by sort_order.
     * Returns null when not found or wrong tenant.
     */
    public static function getSurveyById(int $id, int $tenantId): ?array
    {
        $survey = DB::table(self::TABLE_SURVEYS)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if ($survey === null) {
            return null;
        }

        $survey = (array) $survey;

        $survey['questions'] = DB::table(self::TABLE_QUESTIONS)
            ->where('survey_id', $id)
            ->where('tenant_id', $tenantId)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->toArray();

        return $survey;
    }

    /**
     * Active surveys only — for member feed.
     * Excludes expired surveys (ends_at < now).
     */
    public static function getActiveSurveys(int $tenantId): array
    {
        return DB::table(self::TABLE_SURVEYS)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where(function ($q) {
                $q->whereNull('ends_at')
                    ->orWhere('ends_at', '>', Carbon::now());
            })
            ->orderBy('created_at', 'desc')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->toArray();
    }

    // ─── Admin lifecycle ──────────────────────────────────────────────────────

    /**
     * Create a survey with an optional initial set of questions.
     *
     * $data keys:
     *   title (required), description, is_anonymous, starts_at, ends_at,
     *   questions[] (optional — see insertQuestions())
     */
    public static function createSurvey(int $tenantId, int $userId, array $data): array
    {
        if (empty($data['title'])) {
            throw new InvalidArgumentException(__('api.municipal_survey_title_required'));
        }

        $surveyId = DB::table(self::TABLE_SURVEYS)->insertGetId([
            'tenant_id'       => $tenantId,
            'created_by'      => $userId,
            'title'           => mb_substr((string) $data['title'], 0, 255),
            'description'     => isset($data['description']) ? (string) $data['description'] : null,
            'status'          => 'draft',
            'is_anonymous'    => empty($data['is_anonymous']) ? 0 : 1,
            'target_audience' => isset($data['target_audience'])
                ? json_encode($data['target_audience'], JSON_THROW_ON_ERROR)
                : null,
            'starts_at'       => $data['starts_at'] ?? null,
            'ends_at'         => $data['ends_at'] ?? null,
            'response_count'  => 0,
            'created_at'      => Carbon::now(),
            'updated_at'      => Carbon::now(),
        ]);

        if (! empty($data['questions']) && is_array($data['questions'])) {
            self::insertQuestions((int) $surveyId, $tenantId, $data['questions']);
        }

        return self::getSurveyById((int) $surveyId, $tenantId) ?? [];
    }

    /**
     * Update mutable fields of a survey.
     * Replaces all questions when $data['questions'] is provided.
     * Only draft surveys should be updated; callers must enforce this.
     */
    public static function updateSurvey(int $id, int $tenantId, array $data): array
    {
        $survey = DB::table(self::TABLE_SURVEYS)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if ($survey === null) {
            throw new RuntimeException(__('api.municipal_survey_not_found'));
        }

        $update = ['updated_at' => Carbon::now()];

        if (isset($data['title'])) {
            $update['title'] = mb_substr((string) $data['title'], 0, 255);
        }
        if (array_key_exists('description', $data)) {
            $update['description'] = $data['description'] !== null ? (string) $data['description'] : null;
        }
        if (isset($data['is_anonymous'])) {
            $update['is_anonymous'] = empty($data['is_anonymous']) ? 0 : 1;
        }
        if (array_key_exists('starts_at', $data)) {
            $update['starts_at'] = $data['starts_at'];
        }
        if (array_key_exists('ends_at', $data)) {
            $update['ends_at'] = $data['ends_at'];
        }
        if (isset($data['target_audience'])) {
            $update['target_audience'] = json_encode($data['target_audience'], JSON_THROW_ON_ERROR);
        }

        DB::table(self::TABLE_SURVEYS)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($update);

        // Replace questions when provided
        if (isset($data['questions']) && is_array($data['questions'])) {
            DB::table(self::TABLE_QUESTIONS)
                ->where('survey_id', $id)
                ->where('tenant_id', $tenantId)
                ->delete();
            self::insertQuestions($id, $tenantId, $data['questions']);
        }

        return self::getSurveyById($id, $tenantId) ?? [];
    }

    /**
     * Transition a survey from draft → active.
     * Requires at least one question.
     */
    public static function publishSurvey(int $id, int $tenantId): void
    {
        $survey = DB::table(self::TABLE_SURVEYS)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if ($survey === null) {
            throw new RuntimeException(__('api.municipal_survey_not_found'));
        }

        if ($survey->status !== 'draft') {
            throw new RuntimeException(__('api.municipal_survey_publish_draft_only'));
        }

        $questionCount = DB::table(self::TABLE_QUESTIONS)
            ->where('survey_id', $id)
            ->where('tenant_id', $tenantId)
            ->count();

        if ($questionCount === 0) {
            throw new RuntimeException(__('api.municipal_survey_needs_question'));
        }

        DB::table(self::TABLE_SURVEYS)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update(['status' => 'active', 'updated_at' => Carbon::now()]);
    }

    /**
     * Transition a survey from active → closed.
     */
    public static function closeSurvey(int $id, int $tenantId): void
    {
        $survey = DB::table(self::TABLE_SURVEYS)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if ($survey === null) {
            throw new RuntimeException(__('api.municipal_survey_not_found'));
        }

        if ($survey->status !== 'active') {
            throw new RuntimeException(__('api.municipal_survey_close_active_only'));
        }

        DB::table(self::TABLE_SURVEYS)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update(['status' => 'closed', 'updated_at' => Carbon::now()]);
    }

    // ─── Response submission ──────────────────────────────────────────────────

    /**
     * Returns true if the user already submitted a response to this survey.
     */
    public static function hasResponded(int $surveyId, int $tenantId, int $userId): bool
    {
        // Check by user_id (non-anonymous)
        $byUserId = DB::table(self::TABLE_RESPONSES)
            ->where('survey_id', $surveyId)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->exists();

        if ($byUserId) {
            return true;
        }

        // Also check by session_token for anonymous surveys
        $token = self::makeSessionToken($userId, $surveyId);
        return DB::table(self::TABLE_RESPONSES)
            ->where('survey_id', $surveyId)
            ->where('tenant_id', $tenantId)
            ->where('session_token', $token)
            ->exists();
    }

    /**
     * Validate and persist a member's response to a survey.
     *
     * @param  array<int|string, mixed>  $answers  keyed by question_id
     * @throws RuntimeException  when already responded or validation fails
     */
    public static function submitResponse(
        int $surveyId,
        int $tenantId,
        ?int $userId,
        array $answers,
        ?string $ipHash = null
    ): void {
        DB::transaction(function () use ($surveyId, $tenantId, $userId, $answers, $ipHash): void {
            $survey = DB::table(self::TABLE_SURVEYS)
                ->where('id', $surveyId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if ($survey === null) {
                throw new RuntimeException(__('caring_community.survey.errors.not_found'));
            }

            if ($survey->status !== 'active') {
                throw new RuntimeException(__('caring_community.survey.errors.not_accepting'));
            }

            if ($survey->ends_at !== null && Carbon::parse($survey->ends_at)->isPast()) {
                throw new RuntimeException(__('caring_community.survey.errors.closed'));
            }

            if ($userId !== null && self::hasResponded($surveyId, $tenantId, $userId)) {
                throw new RuntimeException(__('caring_community.survey.errors.already_responded'));
            }

            $questions = DB::table(self::TABLE_QUESTIONS)
                ->where('survey_id', $surveyId)
                ->where('tenant_id', $tenantId)
                ->get()
                ->keyBy('id');

            foreach ($questions as $question) {
                if (! $question->is_required) {
                    continue;
                }
                $qId = (string) $question->id;
                if (! array_key_exists($qId, $answers) && ! array_key_exists($question->id, $answers)) {
                    throw new InvalidArgumentException(
                        __('caring_community.survey.errors.required_question', ['id' => $question->id])
                    );
                }
            }

            $normAnswers = [];
            foreach ($answers as $qId => $val) {
                $normAnswers[(string) $qId] = $val;
            }

            $isAnonymous = (bool) $survey->is_anonymous;
            $sessionToken = ($userId !== null)
                ? self::makeSessionToken($userId, $surveyId)
                : null;

            DB::table(self::TABLE_RESPONSES)->insert([
                'survey_id'     => $surveyId,
                'tenant_id'     => $tenantId,
                'user_id'       => $isAnonymous ? null : $userId,
                'session_token' => $sessionToken,
                'answers'       => json_encode($normAnswers, JSON_THROW_ON_ERROR),
                'submitted_at'  => Carbon::now(),
                'ip_hash'       => $ipHash,
            ]);

            DB::table(self::TABLE_SURVEYS)
                ->where('id', $surveyId)
                ->where('tenant_id', $tenantId)
                ->increment('response_count');
        });
    }

    // ─── Analytics ────────────────────────────────────────────────────────────

    /**
     * Build per-question breakdowns for admin analytics.
     *
     * For single_choice / multi_choice / yes_no / likert:
     *   Returns option tallies with absolute count + percentage.
     *
     * For open_text:
     *   Returns up to 10 most-recent verbatim answers.
     *
     * Also returns overall response_count and a 30-day daily submissions chart.
     */
    public static function getAnalytics(int $id, int $tenantId): array
    {
        $survey = self::getSurveyById($id, $tenantId);
        if ($survey === null) {
            throw new RuntimeException(__('api.municipal_survey_not_found'));
        }

        $responses = DB::table(self::TABLE_RESPONSES)
            ->where('survey_id', $id)
            ->where('tenant_id', $tenantId)
            ->select(['answers', 'submitted_at'])
            ->get()
            ->toArray();

        $totalResponses = count($responses);

        // ── Daily submissions (last 30 days) ──────────────────────────────────
        $daily = DB::table(self::TABLE_RESPONSES)
            ->where('survey_id', $id)
            ->where('tenant_id', $tenantId)
            ->where('submitted_at', '>=', Carbon::now()->subDays(30))
            ->selectRaw('DATE(submitted_at) AS day, COUNT(*) AS count')
            ->groupBy('day')
            ->orderBy('day')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->toArray();

        // ── Per-question breakdowns ───────────────────────────────────────────
        $questionAnalytics = [];
        foreach ($survey['questions'] as $question) {
            $qId   = (string) $question['id'];
            $qType = $question['question_type'];

            if ($qType === 'open_text') {
                // Collect up to 10 recent verbatims
                $verbatims = [];
                foreach (array_reverse($responses) as $resp) {
                    if (count($verbatims) >= 10) {
                        break;
                    }
                    $answersDecoded = json_decode((string) $resp->answers, true) ?? [];
                    $val = $answersDecoded[$qId] ?? null;
                    if ($val !== null && $val !== '') {
                        $verbatims[] = (string) $val;
                    }
                }
                $questionAnalytics[] = [
                    'question_id'   => $question['id'],
                    'question_text' => $question['question_text'],
                    'question_type' => $qType,
                    'verbatims'     => $verbatims,
                    'answer_count'  => count($verbatims),
                ];
                continue;
            }

            // Tally for choice / likert / yes_no
            $rawOptions = $question['options'] ?? null;
            $options = [];
            if (is_string($rawOptions)) {
                $options = json_decode($rawOptions, true) ?? [];
            } elseif (is_array($rawOptions)) {
                $options = $rawOptions;
            }

            // For yes_no without explicit options use Yes/No defaults
            if ($qType === 'yes_no' && empty($options)) {
                $options = ['Yes', 'No'];
            }

            $tallies = [];
            foreach ($options as $opt) {
                $tallies[(string) $opt] = 0;
            }
            $answeredCount = 0;

            foreach ($responses as $resp) {
                $answersDecoded = json_decode((string) $resp->answers, true) ?? [];
                $val = $answersDecoded[$qId] ?? null;
                if ($val === null) {
                    continue;
                }
                $answeredCount++;
                if ($qType === 'multi_choice' && is_array($val)) {
                    foreach ($val as $selected) {
                        $key = (string) $selected;
                        if (! isset($tallies[$key])) {
                            $tallies[$key] = 0;
                        }
                        $tallies[$key]++;
                    }
                } else {
                    $key = (string) $val;
                    if (! isset($tallies[$key])) {
                        $tallies[$key] = 0;
                    }
                    $tallies[$key]++;
                }
            }

            // Convert to percentage breakdown
            $breakdown = [];
            foreach ($tallies as $option => $count) {
                $breakdown[] = [
                    'option'     => $option,
                    'count'      => $count,
                    'percentage' => $answeredCount > 0
                        ? round(($count / $answeredCount) * 100, 1)
                        : 0.0,
                ];
            }

            $questionAnalytics[] = [
                'question_id'   => $question['id'],
                'question_text' => $question['question_text'],
                'question_type' => $qType,
                'answer_count'  => $answeredCount,
                'breakdown'     => $breakdown,
            ];
        }

        return [
            'survey_id'       => $id,
            'response_count'  => $totalResponses,
            'daily_chart'     => $daily,
            'questions'       => $questionAnalytics,
        ];
    }

    // ─── CSV Export ───────────────────────────────────────────────────────────

    /**
     * Build a CSV string for all responses to the given survey.
     *
     * Columns: response_id, submitted_at, respondent (user_id or "anonymous"),
     *          then one column per question (text as header).
     */
    public static function exportCsv(int $id, int $tenantId): string
    {
        $survey = self::getSurveyById($id, $tenantId);
        if ($survey === null) {
            throw new RuntimeException(__('api.municipal_survey_not_found'));
        }

        $responses = DB::table(self::TABLE_RESPONSES)
            ->where('survey_id', $id)
            ->where('tenant_id', $tenantId)
            ->orderBy('submitted_at')
            ->get()
            ->toArray();

        $questions = $survey['questions'];

        // Build header row
        $headers = ['response_id', 'submitted_at', 'respondent'];
        foreach ($questions as $q) {
            // Escape quotes in question text for CSV
            $headers[] = str_replace('"', '""', $q['question_text']);
        }

        $lines = [];
        $lines[] = self::csvRow(CsvExportSanitizer::row($headers));

        foreach ($responses as $resp) {
            $answers = json_decode((string) $resp->answers, true) ?? [];
            $respondent = ($resp->user_id !== null) ? (string) $resp->user_id : 'anonymous';

            $row = [
                (string) $resp->id,
                (string) $resp->submitted_at,
                $respondent,
            ];

            foreach ($questions as $q) {
                $qId = (string) $q['id'];
                $val = $answers[$qId] ?? '';
                if (is_array($val)) {
                    $val = implode('; ', $val);
                }
                $row[] = (string) $val;
            }

            $lines[] = self::csvRow(CsvExportSanitizer::row($row));
        }

        return implode("\n", $lines);
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    /**
     * Insert a batch of question rows for a survey.
     *
     * @param  array<int, array<string, mixed>>  $questions
     */
    private static function insertQuestions(int $surveyId, int $tenantId, array $questions): void
    {
        $now = Carbon::now()->toDateTimeString();
        foreach ($questions as $q) {
            if (empty($q['question_text']) || empty($q['question_type'])) {
                continue;
            }
            DB::table(self::TABLE_QUESTIONS)->insert([
                'survey_id'     => $surveyId,
                'tenant_id'     => $tenantId,
                'question_text' => mb_substr((string) $q['question_text'], 0, 500),
                'question_type' => (string) $q['question_type'],
                'options'       => isset($q['options']) && is_array($q['options'])
                    ? json_encode($q['options'], JSON_THROW_ON_ERROR)
                    : null,
                'is_required'   => empty($q['is_required']) ? 0 : 1,
                'sort_order'    => isset($q['sort_order']) ? (int) $q['sort_order'] : 0,
                'created_at'    => $now,
                'updated_at'    => $now,
            ]);
        }
    }

    /**
     * Deterministic session token for dedup on anonymous surveys.
     * Format: sha256(user_id . '|' . survey_id . '|' . YYYY-MM-DD)
     */
    private static function makeSessionToken(int $userId, int $surveyId): string
    {
        $date = Carbon::today()->toDateString();
        return hash('sha256', "{$userId}|{$surveyId}|{$date}");
    }

    /**
     * Format a single CSV row, quoting fields that contain commas, quotes or
     * newlines.
     *
     * @param  array<int, string>  $fields
     */
    private static function csvRow(array $fields): string
    {
        $escaped = array_map(function (string $field): string {
            if (str_contains($field, ',') || str_contains($field, '"') || str_contains($field, "\n")) {
                return '"' . str_replace('"', '""', $field) . '"';
            }
            return $field;
        }, $fields);

        return implode(',', $escaped);
    }
}
