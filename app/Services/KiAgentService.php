<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Services\CaringCommunity\CaringCommunityForecastService;
use App\Services\CaringCommunity\CaringNudgeService;
use App\Services\CaringTandemMatchingService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * AG61 — KI-Agenten Autonomous Agent Framework
 *
 * Scheduled background agents that propose matches, draft notifications,
 * route requests, and summarise community activity — all with human-in-the-
 * loop approval before anything is acted upon.
 *
 * The community intelligence AI pillar for Project NEXUS.
 */
class KiAgentService
{
    private const TABLE_RUNS      = 'agent_runs';
    private const TABLE_PROPOSALS = 'agent_proposals';
    private const TABLE_CONFIG    = 'agent_config';

    private const DEFAULT_CONFIG = [
        'enabled'                    => false,
        'auto_apply_threshold'       => 0.9,
        'tandem_matching_enabled'    => true,
        'nudge_dispatch_enabled'     => true,
        'activity_summary_enabled'   => true,
        'demand_forecast_enabled'    => true,
        'help_routing_enabled'       => true,
        'schedule_hour'              => 2,
        'max_proposals_per_run'      => 50,
        'notification_email'         => null,
    ];

    // =========================================================================
    // Schema guard
    // =========================================================================

    public static function isAvailable(): bool
    {
        return Schema::hasTable(self::TABLE_RUNS)
            && Schema::hasTable(self::TABLE_PROPOSALS)
            && Schema::hasTable(self::TABLE_CONFIG);
    }

    // =========================================================================
    // Config
    // =========================================================================

    /**
     * Returns the agent config for a tenant, merging with defaults.
     *
     * @return array<string,mixed>
     */
    public static function getConfig(int $tenantId): array
    {
        if (!self::isAvailable()) {
            return self::DEFAULT_CONFIG;
        }

        $row = DB::table(self::TABLE_CONFIG)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$row) {
            return self::DEFAULT_CONFIG;
        }

        return [
            'enabled'                    => (bool) $row->enabled,
            'auto_apply_threshold'       => (float) $row->auto_apply_threshold,
            'tandem_matching_enabled'    => (bool) $row->tandem_matching_enabled,
            'nudge_dispatch_enabled'     => (bool) $row->nudge_dispatch_enabled,
            'activity_summary_enabled'   => (bool) $row->activity_summary_enabled,
            'demand_forecast_enabled'    => (bool) $row->demand_forecast_enabled,
            'help_routing_enabled'       => (bool) $row->help_routing_enabled,
            'schedule_hour'              => (int) $row->schedule_hour,
            'max_proposals_per_run'      => (int) $row->max_proposals_per_run,
            'notification_email'         => $row->notification_email,
        ];
    }

    /**
     * Upserts agent config for a tenant, returns the updated config.
     *
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    public static function updateConfig(int $tenantId, array $data): array
    {
        if (!self::isAvailable()) {
            return self::DEFAULT_CONFIG;
        }

        $current = self::getConfig($tenantId);

        $update = [
            'enabled'                    => array_key_exists('enabled', $data)
                                                ? (int) (bool) $data['enabled']
                                                : (int) $current['enabled'],
            'auto_apply_threshold'       => array_key_exists('auto_apply_threshold', $data)
                                                ? max(0.0, min(1.0, (float) $data['auto_apply_threshold']))
                                                : (float) $current['auto_apply_threshold'],
            'tandem_matching_enabled'    => array_key_exists('tandem_matching_enabled', $data)
                                                ? (int) (bool) $data['tandem_matching_enabled']
                                                : (int) $current['tandem_matching_enabled'],
            'nudge_dispatch_enabled'     => array_key_exists('nudge_dispatch_enabled', $data)
                                                ? (int) (bool) $data['nudge_dispatch_enabled']
                                                : (int) $current['nudge_dispatch_enabled'],
            'activity_summary_enabled'   => array_key_exists('activity_summary_enabled', $data)
                                                ? (int) (bool) $data['activity_summary_enabled']
                                                : (int) $current['activity_summary_enabled'],
            'demand_forecast_enabled'    => array_key_exists('demand_forecast_enabled', $data)
                                                ? (int) (bool) $data['demand_forecast_enabled']
                                                : (int) $current['demand_forecast_enabled'],
            'help_routing_enabled'       => array_key_exists('help_routing_enabled', $data)
                                                ? (int) (bool) $data['help_routing_enabled']
                                                : (int) $current['help_routing_enabled'],
            'schedule_hour'              => array_key_exists('schedule_hour', $data)
                                                ? max(0, min(23, (int) $data['schedule_hour']))
                                                : (int) $current['schedule_hour'],
            'max_proposals_per_run'      => array_key_exists('max_proposals_per_run', $data)
                                                ? max(1, min(500, (int) $data['max_proposals_per_run']))
                                                : (int) $current['max_proposals_per_run'],
            'notification_email'         => array_key_exists('notification_email', $data)
                                                ? ($data['notification_email'] ?: null)
                                                : $current['notification_email'],
            'updated_at'                 => now(),
        ];

        DB::table(self::TABLE_CONFIG)->updateOrInsert(
            ['tenant_id' => $tenantId],
            array_merge(['tenant_id' => $tenantId, 'created_at' => now()], $update),
        );

        return self::getConfig($tenantId);
    }

    // =========================================================================
    // Run lifecycle
    // =========================================================================

    /**
     * Create a new agent run record. Returns the new run ID.
     *
     * @param array<string,mixed> $inputContext
     */
    public static function createRun(
        int $tenantId,
        string $agentType,
        string $triggeredBy,
        ?int $triggeredByUserId = null,
        array $inputContext = [],
    ): int {
        if (!self::isAvailable()) {
            throw new \RuntimeException('KiAgent tables not available');
        }

        return DB::table(self::TABLE_RUNS)->insertGetId([
            'tenant_id'            => $tenantId,
            'agent_type'           => $agentType,
            'status'               => 'pending',
            'triggered_by'         => $triggeredBy,
            'triggered_by_user_id' => $triggeredByUserId,
            'input_context'        => $inputContext ? json_encode($inputContext) : null,
            'proposals_generated'  => 0,
            'proposals_applied'    => 0,
            'created_at'           => now(),
            'updated_at'           => now(),
        ]);
    }

    public static function startRun(int $runId): void
    {
        if (!self::isAvailable()) {
            return;
        }

        DB::table(self::TABLE_RUNS)->where('id', $runId)->update([
            'status'     => 'running',
            'started_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public static function completeRun(int $runId, int $proposalsGenerated, string $summary): void
    {
        if (!self::isAvailable()) {
            return;
        }

        DB::table(self::TABLE_RUNS)->where('id', $runId)->update([
            'status'               => 'completed',
            'proposals_generated'  => $proposalsGenerated,
            'output_summary'       => $summary,
            'completed_at'         => now(),
            'updated_at'           => now(),
        ]);
    }

    public static function failRun(int $runId, string $error): void
    {
        if (!self::isAvailable()) {
            return;
        }

        DB::table(self::TABLE_RUNS)->where('id', $runId)->update([
            'status'        => 'failed',
            'error_message' => $error,
            'completed_at'  => now(),
            'updated_at'    => now(),
        ]);
    }

    // =========================================================================
    // Proposal management
    // =========================================================================

    /**
     * Create a proposal for human review. Returns the new proposal ID.
     *
     * @param array<string,mixed> $data
     */
    public static function createProposal(
        int $tenantId,
        int $runId,
        string $type,
        array $data,
        float $confidence = 0.5,
        ?int $subjectUserId = null,
        ?int $targetUserId = null,
    ): int {
        if (!self::isAvailable()) {
            throw new \RuntimeException('KiAgent tables not available');
        }

        $expiresAt = now()->addDays(7);

        return DB::table(self::TABLE_PROPOSALS)->insertGetId([
            'tenant_id'        => $tenantId,
            'run_id'           => $runId,
            'proposal_type'    => $type,
            'subject_user_id'  => $subjectUserId,
            'target_user_id'   => $targetUserId,
            'proposal_data'    => json_encode($data),
            'status'           => 'pending_review',
            'confidence_score' => round(max(0.0, min(1.0, $confidence)), 4),
            'expires_at'       => $expiresAt,
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);
    }

    /**
     * Approve a proposal, run it through applyProposal(), and mark applied.
     *
     * @return array<string,mixed> the updated proposal row
     */
    public static function approveProposal(int $proposalId, int $tenantId, int $reviewerId): array
    {
        if (!self::isAvailable()) {
            return [];
        }

        $proposal = DB::table(self::TABLE_PROPOSALS)
            ->where('id', $proposalId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$proposal) {
            throw new \RuntimeException("Proposal {$proposalId} not found");
        }

        $proposalArr = (array) $proposal;
        $proposalArr['proposal_data'] = json_decode((string) $proposal->proposal_data, true) ?? [];

        self::applyProposal($proposalArr, $tenantId);

        DB::table(self::TABLE_PROPOSALS)->where('id', $proposalId)->update([
            'status'      => 'approved',
            'reviewer_id' => $reviewerId,
            'reviewed_at' => now(),
            'applied_at'  => now(),
            'updated_at'  => now(),
        ]);

        // Increment proposals_applied on the parent run
        DB::table(self::TABLE_RUNS)
            ->where('id', $proposal->run_id)
            ->increment('proposals_applied');

        return (array) DB::table(self::TABLE_PROPOSALS)->where('id', $proposalId)->first();
    }

    public static function rejectProposal(int $proposalId, int $tenantId, int $reviewerId): void
    {
        if (!self::isAvailable()) {
            return;
        }

        DB::table(self::TABLE_PROPOSALS)
            ->where('id', $proposalId)
            ->where('tenant_id', $tenantId)
            ->update([
                'status'      => 'rejected',
                'reviewer_id' => $reviewerId,
                'reviewed_at' => now(),
                'updated_at'  => now(),
            ]);
    }

    /**
     * Return all pending_review proposals above the auto-apply confidence threshold
     * that have not expired.
     *
     * @return list<array<string,mixed>>
     */
    public static function autoApplyEligible(int $tenantId, float $threshold): array
    {
        if (!self::isAvailable()) {
            return [];
        }

        $rows = DB::table(self::TABLE_PROPOSALS)
            ->where('tenant_id', $tenantId)
            ->where('status', 'pending_review')
            ->where('confidence_score', '>=', $threshold)
            ->where(function ($q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->get();

        return $rows->map(function ($row) {
            $arr = (array) $row;
            $arr['proposal_data'] = json_decode((string) $row->proposal_data, true) ?? [];
            return $arr;
        })->all();
    }

    /**
     * Dispatch the action encoded in a proposal.
     *
     * @param array<string,mixed> $proposal
     */
    private static function applyProposal(array $proposal, int $tenantId): void
    {
        $type = (string) ($proposal['proposal_type'] ?? '');
        $data = (array) ($proposal['proposal_data'] ?? []);

        switch ($type) {
            case 'create_tandem':
                if (!Schema::hasTable('caring_support_relationships')) {
                    break;
                }
                $supporterId = (int) ($data['supporter_id'] ?? 0);
                $recipientId = (int) ($data['recipient_id'] ?? 0);
                if ($supporterId && $recipientId) {
                    $existing = DB::table('caring_support_relationships')
                        ->where('tenant_id', $tenantId)
                        ->where('supporter_id', $supporterId)
                        ->where('recipient_id', $recipientId)
                        ->exists();
                    if (!$existing) {
                        $interactionPolicy = app(SafeguardingInteractionPolicy::class);
                        $interactionPolicy->assertLocalContactAllowed(
                            $supporterId,
                            $recipientId,
                            $tenantId,
                            'ki_agent_tandem_approval',
                        );
                        $interactionPolicy->assertLocalContactAllowed(
                            $recipientId,
                            $supporterId,
                            $tenantId,
                            'ki_agent_tandem_approval',
                        );

                        // `caring_support_relationships` requires NOT NULL `title`
                        // and `start_date` (neither has a DB default). Omitting them
                        // either rejected the row (strict mode) or wrote an empty
                        // title and a zero start_date (non-strict mode) — never a
                        // usable tandem. Populate them like CaringSupportRelationshipService.
                        $supporterName = trim((string) ($data['supporter_name'] ?? ''));
                        $recipientName = trim((string) ($data['recipient_name'] ?? ''));
                        $title = ($supporterName !== '' && $recipientName !== '')
                            ? $supporterName . ' & ' . $recipientName
                            : (string) __('api.caring_support_relationship_default_title');

                        DB::table('caring_support_relationships')->insertGetId([
                            'tenant_id'    => $tenantId,
                            'supporter_id' => $supporterId,
                            'recipient_id' => $recipientId,
                            'title'        => mb_substr($title, 0, 255),
                            'start_date'   => now()->toDateString(),
                            'status'       => 'active',
                            'created_at'   => now(),
                            'updated_at'   => now(),
                        ]);
                    }
                }
                break;

            case 'send_nudge':
                $userId = (int) ($proposal['subject_user_id'] ?? 0);
                if ($userId) {
                    $title = (string) ($data['title'] ?? 'NEXUS');
                    $body  = (string) ($data['body'] ?? '');
                    $extra = ['type' => 'caring_smart_nudge', 'link' => '/notifications'];
                    FCMPushService::sendToUsers([$userId], $title, $body, $extra);
                }
                break;

            case 'send_activity_summary':
                $userId = (int) ($proposal['subject_user_id'] ?? 0);
                if ($userId) {
                    $title = (string) ($data['title'] ?? 'Activity Summary');
                    $body  = (string) ($data['body'] ?? '');
                    $extra = ['type' => 'activity_summary', 'link' => '/activity'];
                    FCMPushService::sendToUsers([$userId], $title, $body, $extra);
                }
                break;

            case 'route_help_request':
                if (!Schema::hasTable('caring_help_requests')) {
                    break;
                }
                $requestId    = (int) ($data['request_id'] ?? 0);
                $assignedToId = (int) ($proposal['target_user_id'] ?? 0);
                if ($requestId && $assignedToId) {
                    // `caring_help_requests` has no `assigned_to` column, so the
                    // original UPDATE raised an "Unknown column" error and routing
                    // silently failed. The coordinator is recorded on the proposal
                    // (target_user_id); the real transition is `pending` -> `matched`.
                    DB::table('caring_help_requests')
                        ->where('id', $requestId)
                        ->where('tenant_id', $tenantId)
                        ->where('status', 'pending')
                        ->update([
                            'status'     => 'matched',
                            'updated_at' => now(),
                        ]);
                }
                break;

            default:
                Log::warning("KiAgentService: unknown proposal_type '{$type}'", [
                    'proposal_id' => $proposal['id'] ?? null,
                    'tenant_id'   => $tenantId,
                ]);
                break;
        }
    }

    // =========================================================================
    // Listing
    // =========================================================================

    /**
     * @return list<array<string,mixed>>
     */
    public static function listRuns(
        int $tenantId,
        ?string $agentType = null,
        ?string $status = null,
        int $limit = 50,
    ): array {
        if (!self::isAvailable()) {
            return [];
        }

        $query = DB::table(self::TABLE_RUNS)
            ->where('tenant_id', $tenantId)
            ->orderByDesc('created_at')
            ->limit($limit);

        if ($agentType !== null && $agentType !== '') {
            $query->where('agent_type', $agentType);
        }

        if ($status !== null && $status !== '') {
            $query->where('status', $status);
        }

        return $query->get()->map(fn ($r) => (array) $r)->all();
    }

    /**
     * Returns the run row with its proposals. Returns null if not found or
     * belongs to a different tenant.
     *
     * @return array<string,mixed>|null
     */
    public static function getRun(int $id, int $tenantId): ?array
    {
        if (!self::isAvailable()) {
            return null;
        }

        $run = DB::table(self::TABLE_RUNS)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$run) {
            return null;
        }

        $proposals = DB::table(self::TABLE_PROPOSALS)
            ->where('run_id', $id)
            ->where('tenant_id', $tenantId)
            ->orderByDesc('confidence_score')
            ->get()
            ->map(function ($p) {
                $arr = (array) $p;
                $arr['proposal_data'] = json_decode((string) $p->proposal_data, true) ?? [];
                return $arr;
            })
            ->all();

        $runArr = (array) $run;
        $runArr['input_context'] = $run->input_context
            ? (json_decode((string) $run->input_context, true) ?? [])
            : null;
        $runArr['proposals'] = $proposals;

        return $runArr;
    }

    /**
     * @return list<array<string,mixed>>
     */
    public static function listProposals(
        int $tenantId,
        ?string $status = null,
        int $limit = 100,
    ): array {
        if (!self::isAvailable()) {
            return [];
        }

        $query = DB::table(self::TABLE_PROPOSALS . ' as ap')
            ->join(self::TABLE_RUNS . ' as ar', 'ar.id', '=', 'ap.run_id')
            ->where('ap.tenant_id', $tenantId)
            ->orderByDesc('ap.created_at')
            ->limit($limit)
            ->select([
                'ap.*',
                'ar.agent_type as run_agent_type',
                'ar.status as run_status',
                'ar.triggered_by as run_triggered_by',
            ]);

        if ($status !== null && $status !== '') {
            $query->where('ap.status', $status);
        }

        return $query->get()->map(function ($p) {
            $arr = (array) $p;
            $arr['proposal_data'] = json_decode((string) $p->proposal_data, true) ?? [];
            return $arr;
        })->all();
    }

    // =========================================================================
    // Agent executors
    // =========================================================================

    /**
     * Tandem matching — calls CaringTandemMatchingService::suggestTandems(),
     * creates proposals for pairs with score >= 0.4.
     *
     * @return array<string,mixed>
     */
    public static function runTandemMatching(int $tenantId, int $runId): array
    {
        $service = app(CaringTandemMatchingService::class);
        $config  = self::getConfig($tenantId);
        $maxProp = (int) $config['max_proposals_per_run'];

        $suggestions = $service->suggestTandems($tenantId, $maxProp);

        $count = 0;
        foreach ($suggestions as $pair) {
            $score = (float) ($pair['score'] ?? 0.0);
            if ($score < 0.4) {
                continue;
            }
            if ($count >= $maxProp) {
                break;
            }

            $supporterId = (int) ($pair['supporter']['id'] ?? 0);
            $recipientId = (int) ($pair['recipient']['id'] ?? 0);
            if (!$supporterId || !$recipientId) {
                continue;
            }

            self::createProposal(
                tenantId: $tenantId,
                runId: $runId,
                type: 'create_tandem',
                data: [
                    'supporter_id'   => $supporterId,
                    'supporter_name' => $pair['supporter']['name'] ?? '',
                    'recipient_id'   => $recipientId,
                    'recipient_name' => $pair['recipient']['name'] ?? '',
                    'signals'        => $pair['signals'] ?? [],
                    'reasons'        => $pair['reasons'] ?? [],
                ],
                confidence: $score,
                subjectUserId: $supporterId,
                targetUserId: $recipientId,
            );
            $count++;
        }

        return ['proposals_created' => $count];
    }

    /**
     * Demand forecast — calls CaringCommunityForecastService, creates proposals
     * for each alert signal (declining trends, capacity gaps).
     *
     * @return array<string,mixed>
     */
    public static function runDemandForecast(int $tenantId, int $runId): array
    {
        TenantContext::setById($tenantId);

        $service = app(CaringCommunityForecastService::class);

        $hours     = $service->forecastHours();
        $members   = $service->forecastMembers();
        $recipients = $service->forecastRecipients();

        $count = 0;

        foreach ([
            ['label' => 'volunteer_hours', 'data' => $hours],
            ['label' => 'active_members',  'data' => $members],
            ['label' => 'recipients',      'data' => $recipients],
        ] as $metric) {
            $trend      = $metric['data']['trend'] ?? 'stable';
            $confidence = $metric['data']['confidence'] ?? 'medium';
            $growth     = (float) ($metric['data']['growth_rate_pct'] ?? 0.0);

            if ($trend === 'declining') {
                $conf = match ($confidence) {
                    'high'   => 0.85,
                    'medium' => 0.65,
                    default  => 0.45,
                };

                self::createProposal(
                    tenantId: $tenantId,
                    runId: $runId,
                    type: 'demand_forecast_alert',
                    data: [
                        'metric'          => $metric['label'],
                        'trend'           => $trend,
                        'growth_rate_pct' => $growth,
                        'confidence'      => $confidence,
                        'forecast'        => $metric['data']['forecast'] ?? [],
                    ],
                    confidence: $conf,
                );
                $count++;
            }
        }

        return ['proposals_created' => $count];
    }

    /**
     * Nudge dispatch — calls CaringNudgeService in dry-run mode,
     * creates proposals for each candidate nudge.
     *
     * @return array<string,mixed>
     */
    public static function runNudgeDispatch(int $tenantId, int $runId, bool $dryRun = true): array
    {
        $service = app(CaringNudgeService::class);
        $result  = $service->dispatchDue($tenantId, null, true); // always dry-run at proposal stage

        $candidates = (array) ($result['candidates_detail'] ?? []);
        $config     = self::getConfig($tenantId);
        $maxProp    = (int) $config['max_proposals_per_run'];

        $count = 0;
        foreach ($candidates as $candidate) {
            if ($count >= $maxProp) {
                break;
            }
            $userId = (int) ($candidate['user_id'] ?? 0);
            if (!$userId) {
                continue;
            }
            $score = (float) ($candidate['score'] ?? 0.5);

            self::createProposal(
                tenantId: $tenantId,
                runId: $runId,
                type: 'send_nudge',
                data: [
                    'title'   => $candidate['title'] ?? 'Community Update',
                    'body'    => $candidate['body'] ?? '',
                    'extra'   => $candidate['extra'] ?? [],
                    'reason'  => $candidate['reason'] ?? null,
                    'reasons' => $candidate['reasons'] ?? [],
                ],
                confidence: $score,
                subjectUserId: $userId,
            );
            $count++;
        }

        return ['proposals_created' => $count];
    }

    /**
     * Activity summary — queries vol_logs for the last 7 days, creates one
     * summary proposal per coordinator in the tenant.
     *
     * @return array<string,mixed>
     */
    public static function runActivitySummary(int $tenantId, int $runId): array
    {
        if (!Schema::hasTable('vol_logs') || !Schema::hasTable('users')) {
            return ['proposals_created' => 0];
        }

        $since = now()->subDays(7)->toDateString();

        // Aggregate approved hours per volunteer
        $rows = DB::select(
            "SELECT user_id, COUNT(*) AS sessions, COALESCE(SUM(hours), 0) AS total_hours
             FROM vol_logs
             WHERE tenant_id = ? AND status = 'approved' AND date_logged >= ?
             GROUP BY user_id
             ORDER BY total_hours DESC
             LIMIT 50",
            [$tenantId, $since],
        );

        if (empty($rows)) {
            return ['proposals_created' => 0];
        }

        // Find coordinators/admins who should receive summaries
        $coordinators = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereIn('role', ['admin', 'coordinator', 'broker'])
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        if (empty($coordinators)) {
            return ['proposals_created' => 0];
        }

        $config  = self::getConfig($tenantId);
        $maxProp = (int) $config['max_proposals_per_run'];

        $totalSessions    = array_sum(array_column($rows, 'sessions'));
        $totalHours       = array_sum(array_column($rows, 'total_hours'));
        $volunteerCount   = count($rows);

        $count = 0;
        foreach ($coordinators as $coordId) {
            if ($count >= $maxProp) {
                break;
            }

            self::createProposal(
                tenantId: $tenantId,
                runId: $runId,
                type: 'send_activity_summary',
                data: [
                    'title'           => 'Weekly Activity Summary',
                    'body'            => sprintf(
                        '%d volunteer sessions logged in the last 7 days. '
                        . 'Total hours: %.1f across %d volunteers.',
                        $totalSessions,
                        $totalHours,
                        $volunteerCount,
                    ),
                    'period_start'    => $since,
                    'period_end'      => now()->toDateString(),
                    'total_sessions'  => $totalSessions,
                    'total_hours'     => (float) $totalHours,
                    'volunteer_count' => $volunteerCount,
                    'extra'           => ['type' => 'activity_summary'],
                ],
                confidence: 0.95,
                subjectUserId: $coordId,
            );
            $count++;
        }

        return ['proposals_created' => $count];
    }

    // =========================================================================
    // Full dispatcher
    // =========================================================================

    /**
     * Orchestrate all enabled agent types for a tenant.
     *
     * @return array<string,mixed>
     */
    public static function runAllAgents(int $tenantId): array
    {
        if (!self::isAvailable()) {
            return ['error' => 'KiAgent tables not available', 'tenant_id' => $tenantId];
        }

        $config = self::getConfig($tenantId);

        if (!$config['enabled']) {
            return [
                'tenant_id' => $tenantId,
                'skipped'   => true,
                'reason'    => 'agent disabled',
            ];
        }

        $summary   = ['tenant_id' => $tenantId, 'agents' => []];
        $threshold = (float) $config['auto_apply_threshold'];

        $agentMap = [
            'tandem_matching'  => 'tandem_matching_enabled',
            'demand_forecast'  => 'demand_forecast_enabled',
            'nudge_dispatch'   => 'nudge_dispatch_enabled',
            'activity_summary' => 'activity_summary_enabled',
        ];

        foreach ($agentMap as $agentType => $enableKey) {
            if (!$config[$enableKey]) {
                $summary['agents'][$agentType] = ['skipped' => true];
                continue;
            }

            try {
                $runId = self::createRun($tenantId, $agentType, 'schedule');
                self::startRun($runId);

                $result = match ($agentType) {
                    'tandem_matching'  => self::runTandemMatching($tenantId, $runId),
                    'demand_forecast'  => self::runDemandForecast($tenantId, $runId),
                    'nudge_dispatch'   => self::runNudgeDispatch($tenantId, $runId),
                    'activity_summary' => self::runActivitySummary($tenantId, $runId),
                    default            => ['proposals_created' => 0],
                };

                $generated = (int) ($result['proposals_created'] ?? 0);

                // Auto-apply proposals that exceed the threshold
                $eligible   = self::autoApplyEligible($tenantId, $threshold);
                $autoApplied = 0;
                foreach ($eligible as $proposal) {
                    if ((int) $proposal['run_id'] !== $runId) {
                        continue;
                    }
                    try {
                        $proposalArr = $proposal;
                        self::applyProposal($proposalArr, $tenantId);
                        DB::table(self::TABLE_PROPOSALS)
                            ->where('id', $proposal['id'])
                            ->update([
                                'status'     => 'auto_applied',
                                'applied_at' => now(),
                                'updated_at' => now(),
                            ]);
                        DB::table(self::TABLE_RUNS)
                            ->where('id', $runId)
                            ->increment('proposals_applied');
                        $autoApplied++;
                    } catch (\Throwable $e) {
                        Log::warning("KiAgent: auto-apply failed for proposal {$proposal['id']}: {$e->getMessage()}");
                    }
                }

                self::completeRun($runId, $generated, sprintf(
                    '%d proposals generated, %d auto-applied.',
                    $generated,
                    $autoApplied,
                ));

                $summary['agents'][$agentType] = [
                    'run_id'          => $runId,
                    'proposals'       => $generated,
                    'auto_applied'    => $autoApplied,
                ];
            } catch (\Throwable $e) {
                Log::error("KiAgent [{$agentType}] failed for tenant {$tenantId}: {$e->getMessage()}");
                if (isset($runId)) {
                    self::failRun($runId, $e->getMessage());
                }
                $summary['agents'][$agentType] = ['error' => $e->getMessage()];
            }
        }

        return $summary;
    }
}
