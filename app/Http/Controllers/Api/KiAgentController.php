<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Core\TenantContext;
use App\Services\KiAgentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * AG61 — KI-Agenten admin API controller.
 *
 * All endpoints require admin role. Feature-gated to caring_community.
 */
class KiAgentController extends BaseApiController
{
    protected bool $isV2Api = true;

    private const VALID_AGENT_TYPES = [
        'tandem_matching',
        'help_routing',
        'activity_summary',
        'demand_forecast',
        'nudge_dispatch',
        'member_welcome',
    ];

    // =========================================================================
    // Config
    // =========================================================================

    public function getConfig(): JsonResponse
    {
        $adminId  = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if ($denied = $this->agentsDisabledResponse($tenantId)) {
            return $denied;
        }

        if (!KiAgentService::isAvailable()) {
            return $this->respondWithError('UNAVAILABLE', 'KiAgent tables not available', null, 503);
        }

        return $this->respondWithData(KiAgentService::getConfig($tenantId));
    }

    public function updateConfig(): JsonResponse
    {
        $adminId  = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if ($denied = $this->agentsDisabledResponse($tenantId)) {
            return $denied;
        }

        if (!KiAgentService::isAvailable()) {
            return $this->respondWithError('UNAVAILABLE', 'KiAgent tables not available', null, 503);
        }

        $data   = $this->getAllInput();
        $config = KiAgentService::updateConfig($tenantId, $data);

        return $this->respondWithData($config);
    }

    // =========================================================================
    // Runs
    // =========================================================================

    public function listRuns(): JsonResponse
    {
        $adminId  = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if ($denied = $this->agentsDisabledResponse($tenantId)) {
            return $denied;
        }

        if (!KiAgentService::isAvailable()) {
            return $this->respondWithData([]);
        }

        $agentType = $this->query('agent_type') ?: null;
        $status    = $this->query('status') ?: null;
        $limit     = $this->queryInt('limit', 50, 1, 200);

        $runs = KiAgentService::listRuns($tenantId, $agentType, $status, $limit ?? 50);

        return $this->respondWithData($runs);
    }

    public function getRun(int $id): JsonResponse
    {
        $adminId  = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if ($denied = $this->agentsDisabledResponse($tenantId)) {
            return $denied;
        }

        if (!KiAgentService::isAvailable()) {
            return $this->respondNotFound('Run not found');
        }

        $run = KiAgentService::getRun($id, $tenantId);

        if ($run === null) {
            return $this->respondNotFound('Run not found');
        }

        return $this->respondWithData($run);
    }

    /**
     * Trigger a run immediately and return the populated run+proposals.
     */
    public function triggerRun(): JsonResponse
    {
        $adminId  = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if ($denied = $this->agentsDisabledResponse($tenantId)) {
            return $denied;
        }

        if (!KiAgentService::isAvailable()) {
            return $this->respondWithError('UNAVAILABLE', 'KiAgent tables not available', null, 503);
        }

        $agentType = (string) $this->requireInput('agent_type');

        if (!in_array($agentType, self::VALID_AGENT_TYPES, true)) {
            return $this->respondWithError('INVALID_AGENT_TYPE', 'Unknown agent type: ' . $agentType, 'agent_type');
        }

        $runId = KiAgentService::createRun($tenantId, $agentType, 'admin', $adminId);
        KiAgentService::startRun($runId);

        try {
            TenantContext::setById($tenantId);

            $result = match ($agentType) {
                'tandem_matching'  => KiAgentService::runTandemMatching($tenantId, $runId),
                'demand_forecast'  => KiAgentService::runDemandForecast($tenantId, $runId),
                'nudge_dispatch'   => KiAgentService::runNudgeDispatch($tenantId, $runId),
                'activity_summary' => KiAgentService::runActivitySummary($tenantId, $runId),
                default            => ['proposals_created' => 0],
            };

            $generated = (int) ($result['proposals_created'] ?? 0);
            KiAgentService::completeRun($runId, $generated, "{$generated} proposals generated via admin trigger.");
        } catch (\Throwable $e) {
            KiAgentService::failRun($runId, $e->getMessage());
            return $this->respondServerError('Agent run failed: ' . $e->getMessage());
        }

        $run = KiAgentService::getRun($runId, $tenantId);

        return $this->respondWithData($run, null, 201);
    }

    // =========================================================================
    // Proposals
    // =========================================================================

    public function listProposals(): JsonResponse
    {
        $adminId  = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if ($denied = $this->agentsDisabledResponse($tenantId)) {
            return $denied;
        }

        if (!KiAgentService::isAvailable()) {
            return $this->respondWithData([]);
        }

        $status = $this->query('status') ?: null;
        $limit  = $this->queryInt('limit', 100, 1, 500);

        $proposals = KiAgentService::listProposals($tenantId, $status, $limit ?? 100);

        return $this->respondWithData($proposals);
    }

    public function approveProposal(int $id): JsonResponse
    {
        $adminId  = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if ($denied = $this->agentsDisabledResponse($tenantId)) {
            return $denied;
        }

        if (!KiAgentService::isAvailable()) {
            return $this->respondNotFound('Proposal not found');
        }

        try {
            $updated = KiAgentService::approveProposal($id, $tenantId, $adminId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\RuntimeException $e) {
            return $this->respondNotFound($e->getMessage());
        } catch (\Throwable $e) {
            return $this->respondServerError('Failed to apply proposal: ' . $e->getMessage());
        }

        return $this->respondWithData($updated);
    }

    public function rejectProposal(int $id): JsonResponse
    {
        $adminId  = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if ($denied = $this->agentsDisabledResponse($tenantId)) {
            return $denied;
        }

        if (!KiAgentService::isAvailable()) {
            return $this->respondNotFound('Proposal not found');
        }

        KiAgentService::rejectProposal($id, $tenantId, $adminId);

        return $this->respondWithData(['rejected' => true, 'id' => $id]);
    }

    /**
     * Auto-approve all proposals above the configured threshold.
     */
    public function approveAllEligible(): JsonResponse
    {
        $adminId  = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if ($denied = $this->agentsDisabledResponse($tenantId)) {
            return $denied;
        }

        if (!KiAgentService::isAvailable()) {
            return $this->respondWithData(['approved' => 0, 'failed' => 0]);
        }

        $config    = KiAgentService::getConfig($tenantId);
        $threshold = (float) $config['auto_apply_threshold'];
        $eligible  = KiAgentService::autoApplyEligible($tenantId, $threshold);

        $approved = 0;
        $failed   = 0;

        foreach ($eligible as $proposal) {
            try {
                KiAgentService::approveProposal((int) $proposal['id'], $tenantId, $adminId);
                $approved++;
            } catch (\Throwable $e) {
                $failed++;
            }
        }

        return $this->respondWithData([
            'approved'  => $approved,
            'failed'    => $failed,
            'threshold' => $threshold,
        ]);
    }

    // =========================================================================
    // Stats
    // =========================================================================

    public function getStats(): JsonResponse
    {
        $adminId  = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if ($denied = $this->agentsDisabledResponse($tenantId)) {
            return $denied;
        }

        if (!KiAgentService::isAvailable()) {
            return $this->respondWithData([
                'total_runs'       => 0,
                'total_proposals'  => 0,
                'proposals_by_status' => [],
                'runs_last_30_days'   => [],
            ]);
        }

        $totalRuns = DB::table('agent_runs')
            ->where('tenant_id', $tenantId)
            ->count();

        $totalProposals = DB::table('agent_proposals')
            ->where('tenant_id', $tenantId)
            ->count();

        $byStatus = DB::table('agent_proposals')
            ->where('tenant_id', $tenantId)
            ->selectRaw('status, COUNT(*) as count')
            ->groupBy('status')
            ->get()
            ->mapWithKeys(fn ($r) => [$r->status => (int) $r->count])
            ->all();

        $runsChart = DB::table('agent_runs')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', now()->subDays(30))
            ->selectRaw("DATE(created_at) AS day, agent_type, COUNT(*) AS count")
            ->groupBy('day', 'agent_type')
            ->orderBy('day')
            ->get()
            ->map(fn ($r) => [
                'day'        => $r->day,
                'agent_type' => $r->agent_type,
                'count'      => (int) $r->count,
            ])
            ->all();

        return $this->respondWithData([
            'total_runs'          => $totalRuns,
            'total_proposals'     => $totalProposals,
            'proposals_by_status' => $byStatus,
            'runs_last_30_days'   => $runsChart,
        ]);
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /**
     * Every action needs both switches: `ai_agents` (the agent switch the admin
     * page and AgentAdminController follow) and `caring_community` (the module
     * these agents work on). Until F-531 three actions checked only the second
     * and seven — proposal approval among them — checked neither.
     */
    private function agentsDisabledResponse(int $tenantId): ?JsonResponse
    {
        if (!TenantContext::hasFeature('ai_agents') || !$this->hasCaringCommunityAccess($tenantId)) {
            return $this->respondForbidden(__('api.module_disabled_for_community'));
        }

        return null;
    }

    private function hasCaringCommunityAccess(int $tenantId): bool
    {
        // Super-admins can always access for setup purposes
        $user = \Illuminate\Support\Facades\Auth::user();
        if ($user && in_array($user->role ?? '', ['super_admin', 'god'], true)) {
            return true;
        }
        return TenantContext::hasFeature('caring_community');
    }
}
