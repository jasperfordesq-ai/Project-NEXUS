<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\AuditLogService;
use App\Services\SmartMatchingAnalyticsService;
use App\Services\SmartMatchingEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;
use App\Services\MatchApprovalWorkflowService;
use App\Services\Matching\MatchApprovalGate;
use Illuminate\Support\Facades\Log;

/**
 * AdminMatchingController -- Admin matching approval, configuration, cache, and statistics.
 *
 * The five approval endpoints (index/approvalStats/show/approve/reject) are
 * broker-or-admin — reviewing proposed matches is a core broker duty and the
 * broker panel surfaces them at /broker/match-approvals. Configuration, cache,
 * analytics and the two diagnosis endpoints stay admin-only.
 */
class AdminMatchingController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly SmartMatchingEngine $smartMatchingEngine,
        private readonly SmartMatchingAnalyticsService $smartMatchingAnalyticsService,
        private readonly MatchApprovalWorkflowService $matchApprovalWorkflowService,
        private readonly AuditLogService $auditLogService,
    ) {}

    /**
     * Self-dealing guard for approve/reject: a broker must not review a match
     * they are a party to (either as the matched member or as the listing
     * owner) — they could otherwise wave through matches that benefit
     * themselves. Admin-tier callers retain full latitude, mirroring the
     * adjust-balance guard in AdminTimebankingController.
     *
     * Returns an error response to short-circuit with, or null when allowed.
     */
    private function guardBrokerNotParty(int $approvalId, int $callerId): ?JsonResponse
    {
        if ($this->callerIsAdminTier()) {
            return null;
        }

        $row = DB::selectOne(
            "SELECT user_id, listing_owner_id FROM match_approvals WHERE id = ? AND tenant_id = ?",
            [$approvalId, $this->getTenantId()]
        );

        if ($row && ($callerId === (int) $row->user_id || $callerId === (int) $row->listing_owner_id)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.broker_cannot_review_own_match'), null, 403);
        }

        return null;
    }

    /** GET /api/v2/admin/matching */
    public function index(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 20, 1, 100);
        $offset = ($page - 1) * $limit;
        $status = $this->query('status', 'all');

        $conditions = ['ma.tenant_id = ?'];
        $params = [$tenantId];

        if ($status && $status !== 'all' && in_array($status, ['pending', 'approved', 'rejected'])) {
            $conditions[] = 'ma.status = ?';
            $params[] = $status;
        }

        $where = implode(' AND ', $conditions);

        $total = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM match_approvals ma WHERE {$where}", $params)->cnt;

        $items = DB::select(
            "SELECT ma.id, ma.user_id, ma.listing_id, ma.listing_owner_id,
                    ma.match_score, ma.match_type, ma.match_reasons, ma.distance_km,
                    ma.status, ma.submitted_at, ma.reviewed_by, ma.reviewed_at, ma.review_notes,
                    CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as user_1_name,
                    u.email as user_1_email, u.avatar_url as user_1_avatar,
                    CONCAT(COALESCE(o.first_name, ''), ' ', COALESCE(o.last_name, '')) as user_2_name,
                    o.email as user_2_email, o.avatar_url as user_2_avatar,
                    l.title as listing_title, l.type as listing_type, l.description as listing_description,
                    CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, '')) as reviewer_name
             FROM match_approvals ma
             JOIN users u ON ma.user_id = u.id
             JOIN users o ON ma.listing_owner_id = o.id
             LEFT JOIN listings l ON ma.listing_id = l.id
             LEFT JOIN users r ON ma.reviewed_by = r.id
             WHERE {$where}
             ORDER BY CASE WHEN ma.status = 'pending' THEN 0 ELSE 1 END, ma.submitted_at DESC
             LIMIT ? OFFSET ?",
            array_merge($params, [$limit, $offset])
        );

        $formatted = array_map(function ($row) {
            $reasons = $row->match_reasons ?? null;
            if (is_string($reasons)) $reasons = json_decode($reasons, true) ?: [];
            return [
                'id' => (int) $row->id,
                'user_1_id' => (int) $row->user_id, 'user_1_name' => trim($row->user_1_name ?? ''),
                'user_1_email' => $row->user_1_email ?? '', 'user_1_avatar' => $row->user_1_avatar ?? null,
                'user_2_id' => (int) $row->listing_owner_id, 'user_2_name' => trim($row->user_2_name ?? ''),
                'user_2_email' => $row->user_2_email ?? '', 'user_2_avatar' => $row->user_2_avatar ?? null,
                'listing_id' => $row->listing_id ? (int) $row->listing_id : null,
                'listing_title' => $row->listing_title ?? null, 'listing_type' => $row->listing_type ?? null,
                'listing_description' => $row->listing_description ?? null,
                'match_score' => (float) ($row->match_score ?? 0), 'match_type' => $row->match_type ?? 'one_way',
                'match_reasons' => $reasons,
                'distance_km' => $row->distance_km !== null ? (float) $row->distance_km : null,
                'status' => $row->status ?? 'pending', 'notes' => $row->review_notes ?? null,
                'created_at' => $row->submitted_at ?? null, 'reviewed_at' => $row->reviewed_at ?? null,
                'reviewer_id' => $row->reviewed_by ? (int) $row->reviewed_by : null,
                'reviewer_name' => $row->reviewer_name ? trim($row->reviewer_name) : null,
            ];
        }, $items);

        return $this->respondWithPaginatedCollection($formatted, $total, $page, $limit);
    }

    /** GET /api/v2/admin/matching/approval-stats */
    public function approvalStats(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $days = $this->queryInt('days', 30, 1);
        return $this->respondWithData($this->matchApprovalWorkflowService->getStatistics($days));
    }

    /** GET /api/v2/admin/matching/{id} */
    public function show(int $id): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();

        $rowObj = DB::selectOne(
            "SELECT ma.*,
                    CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as user_1_name,
                    u.email as user_1_email, u.avatar_url as user_1_avatar, u.bio as user_1_bio, u.location as user_1_location,
                    CONCAT(COALESCE(o.first_name, ''), ' ', COALESCE(o.last_name, '')) as user_2_name,
                    o.email as user_2_email, o.avatar_url as user_2_avatar, o.bio as user_2_bio, o.location as user_2_location,
                    l.title as listing_title, l.type as listing_type, l.description as listing_description, l.status as listing_status,
                    c.name as category_name,
                    CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, '')) as reviewer_name
             FROM match_approvals ma
             JOIN users u ON ma.user_id = u.id
             JOIN users o ON ma.listing_owner_id = o.id
             LEFT JOIN listings l ON ma.listing_id = l.id
             LEFT JOIN categories c ON l.category_id = c.id
             LEFT JOIN users r ON ma.reviewed_by = r.id
             WHERE ma.id = ? AND ma.tenant_id = ?",
            [$id, $tenantId]
        );
        $row = $rowObj ? (array)$rowObj : null;

        if (!$row) {
            return $this->respondWithError('NOT_FOUND', __('api.not_found', ['model' => 'Match approval']), null, 404);
        }

        $reasons = $row['match_reasons'] ?? null;
        if (is_string($reasons)) { $reasons = json_decode($reasons, true) ?: []; }

        return $this->respondWithData([
            'id' => (int) $row['id'],
            'user_1_id' => (int) $row['user_id'], 'user_1_name' => trim($row['user_1_name'] ?? ''),
            'user_1_email' => $row['user_1_email'] ?? '', 'user_1_avatar' => $row['user_1_avatar'] ?? null,
            'user_1_bio' => $row['user_1_bio'] ?? null, 'user_1_location' => $row['user_1_location'] ?? null,
            'user_2_id' => (int) $row['listing_owner_id'], 'user_2_name' => trim($row['user_2_name'] ?? ''),
            'user_2_email' => $row['user_2_email'] ?? '', 'user_2_avatar' => $row['user_2_avatar'] ?? null,
            'user_2_bio' => $row['user_2_bio'] ?? null, 'user_2_location' => $row['user_2_location'] ?? null,
            'listing_id' => $row['listing_id'] ? (int) $row['listing_id'] : null,
            'listing_title' => $row['listing_title'] ?? null, 'listing_type' => $row['listing_type'] ?? null,
            'listing_description' => $row['listing_description'] ?? null, 'listing_status' => $row['listing_status'] ?? null,
            'category_name' => $row['category_name'] ?? null,
            'match_score' => (float) ($row['match_score'] ?? 0), 'match_type' => $row['match_type'] ?? 'one_way',
            'match_reasons' => $reasons, 'distance_km' => $row['distance_km'] !== null ? (float) $row['distance_km'] : null,
            'status' => $row['status'] ?? 'pending', 'notes' => $row['review_notes'] ?? null,
            'created_at' => $row['submitted_at'] ?? $row['created_at'] ?? null,
            'reviewed_at' => $row['reviewed_at'] ?? null,
            'reviewer_id' => $row['reviewed_by'] ? (int) $row['reviewed_by'] : null,
            'reviewer_name' => $row['reviewer_name'] ? trim($row['reviewer_name']) : null,
        ]);
    }

    /** POST /api/v2/admin/matching/{id}/approve */
    public function approve(int $id): JsonResponse
    {
        $reviewerId = $this->requireBrokerOrAdmin();
        if ($guard = $this->guardBrokerNotParty($id, $reviewerId)) return $guard;

        $notesInput = $this->input('notes', '');
        $notes = is_string($notesInput) ? trim($notesInput) : '';
        $outcome = MatchApprovalWorkflowService::approveMatchOutcome($id, $reviewerId, $notes);
        if ($outcome !== MatchApprovalWorkflowService::OUTCOME_OK) {
            return $this->decisionRefused($outcome);
        }

        $this->auditLogService->log('match_approved', null, $reviewerId, ['approval_id' => $id]);

        return $this->respondWithData(['approved' => true, 'id' => $id]);
    }

    /**
     * Turn "the decision was not recorded" into an answer the reviewer can act
     * on. Each case has its own code and its own translated sentence: the old
     * single 404 ("Match approval or already reviewed not found.", half of it
     * untranslated) was also what a broker saw when the safeguarding contact
     * policy refused the pair, which left the row pending with no explanation.
     */
    private function decisionRefused(string $outcome): JsonResponse
    {
        return match ($outcome) {
            MatchApprovalWorkflowService::OUTCOME_NOT_FOUND => $this->respondWithError(
                'NOT_FOUND', __('api.match_approval_not_found'), null, 404
            ),
            MatchApprovalWorkflowService::OUTCOME_ALREADY_REVIEWED => $this->respondWithError(
                'MATCH_ALREADY_REVIEWED', __('api.match_approval_already_reviewed'), null, 409
            ),
            // The row is deliberately left pending: the policy can change
            // (a vetting record arrives, a restriction is lifted).
            MatchApprovalWorkflowService::OUTCOME_CONTACT_BLOCKED => $this->respondWithError(
                'MATCH_CONTACT_NOT_ALLOWED', __('api.match_approval_contact_blocked'), null, 409
            ),
            default => $this->respondWithError('SERVER_ERROR', __('api.server_error'), null, 500),
        };
    }

    /** POST /api/v2/admin/matching/{id}/reject */
    public function reject(int $id): JsonResponse
    {
        $reviewerId = $this->requireBrokerOrAdmin();
        if ($guard = $this->guardBrokerNotParty($id, $reviewerId)) return $guard;

        $reasonInput = $this->input('reason', '');
        $reason = is_string($reasonInput) ? trim($reasonInput) : '';
        if (empty($reason)) return $this->respondWithError('VALIDATION_ERROR', __('api.reason_required'), 'reason', 422);

        $outcome = MatchApprovalWorkflowService::rejectMatchOutcome($id, $reviewerId, $reason);
        if ($outcome !== MatchApprovalWorkflowService::OUTCOME_OK) {
            return $this->decisionRefused($outcome);
        }

        $this->auditLogService->log('match_rejected', null, $reviewerId, ['approval_id' => $id, 'reason' => $reason]);

        return $this->respondWithData(['rejected' => true, 'id' => $id]);
    }

    /** GET /api/v2/admin/matching/config */
    public function getConfig(): JsonResponse
    {
        $this->requireAdmin();
        $config = $this->smartMatchingEngine->getConfig();
        $weights = $config['weights'] ?? [];
        $proximity = $config['proximity'] ?? [];

        // 🔴 `broker_approval_enabled` is deliberately NOT returned (and not
        // written by updateConfig()). Nothing in the matching engine has ever
        // read it: whether a match waits for a coordinator is decided by the
        // members' own safeguarding choices and by administrative monitoring
        // (App\Services\Matching\MatchApprovalGate), and that protection must
        // not be something a settings screen can switch off. The screen used
        // to show a "Broker approval required" switch and an "Enabled" chip
        // that changed nothing. Any value already stored in a community's
        // configuration is left exactly as it is.
        //
        // The proximity bands carry distances only. The score each band earns
        // is fixed inside the scorer; the screen used to offer an editable
        // "Score" column that this endpoint silently threw away.
        return $this->respondWithData([
            'category_weight' => (float) ($weights['category'] ?? 0.25),
            'skill_weight' => (float) ($weights['skill'] ?? 0.20),
            'proximity_weight' => (float) ($weights['proximity'] ?? 0.25),
            'freshness_weight' => (float) ($weights['freshness'] ?? 0.10),
            'reciprocity_weight' => (float) ($weights['reciprocity'] ?? 0.15),
            'quality_weight' => (float) ($weights['quality'] ?? 0.05),
            'proximity_bands' => [
                ['distance_km' => (int) ($proximity['walking_km'] ?? 5)],
                ['distance_km' => (int) ($proximity['local_km'] ?? 15)],
                ['distance_km' => (int) ($proximity['city_km'] ?? 30)],
                ['distance_km' => (int) ($proximity['regional_km'] ?? 50)],
                ['distance_km' => (int) ($proximity['max_km'] ?? 100)],
            ],
            'enabled' => (bool) ($config['enabled'] ?? true),
            'max_distance_km' => (int) ($config['max_distance_km'] ?? 50),
            'min_match_score' => (int) ($config['min_match_score'] ?? 40),
            'hot_match_threshold' => (int) ($config['hot_match_threshold'] ?? 80),
            'gates' => [
                'geo_hard_gate' => (bool) ($config['gates']['geo_hard_gate'] ?? true),
                'missing_coords_mode' => (string) ($config['gates']['missing_coords_mode'] ?? 'remote_only'),
                'dormancy_days' => (int) ($config['gates']['dormancy_days'] ?? 90),
                'owner_dismissal_threshold' => (int) ($config['gates']['owner_dismissal_threshold'] ?? 3),
            ],
            'engine_version' => (int) ($config['engine_version'] ?? 2),
            'pillars' => [
                'relevance' => (float) ($config['pillars']['relevance'] ?? 0.45),
                'feasibility' => (float) ($config['pillars']['feasibility'] ?? 0.35),
                'trust' => (float) ($config['pillars']['trust'] ?? 0.20),
            ],
            'adjustments' => [
                'mutual_bonus' => (float) ($config['adjustments']['mutual_bonus'] ?? 8),
                'freshness_max' => (float) ($config['adjustments']['freshness_max'] ?? 4),
                'semantic_boost' => (float) ($config['adjustments']['semantic_boost'] ?? 8),
                'knn_boost' => (float) ($config['adjustments']['knn_boost'] ?? 6),
            ],
            'ai' => [
                'semantic_signal' => (bool) ($config['ai']['semantic_signal'] ?? true),
                'llm_explanations' => (bool) ($config['ai']['llm_explanations'] ?? true),
                'explanation_top_n' => (int) ($config['ai']['explanation_top_n'] ?? 5),
                // Whether the AI layer can actually run for this tenant
                // (keys + cost limits) — read-only status for the admin UI.
                'available' => \App\Services\AI\AIServiceFactory::isEnabled(),
            ],
        ]);
    }

    /** The six v1 weight fields, request name => stored name. */
    private const WEIGHT_FIELDS = [
        'category_weight' => 'category',
        'skill_weight' => 'skill',
        'proximity_weight' => 'proximity',
        'freshness_weight' => 'freshness',
        'reciprocity_weight' => 'reciprocity',
        'quality_weight' => 'quality',
    ];

    private const PILLAR_DEFAULTS = ['relevance' => 0.45, 'feasibility' => 0.35, 'trust' => 0.20];

    private static function numberInRange(mixed $value, float $min, float $max): bool
    {
        return is_numeric($value) && (float) $value >= $min && (float) $value <= $max;
    }

    /**
     * Refuse a settings save that would break matching for the community.
     *
     * Until November 2026 nothing here was checked: a maximum distance of -5
     * or a minimum score of 500 was stored as typed and quietly stopped every
     * member getting matches. Only fields that were actually sent are checked,
     * so a partial save still works.
     *
     * @param array<string, mixed> $input    request body
     * @param array<string, mixed> $existing the stored smart_matching block
     * @return JsonResponse|null the 422 to return, or null when the input is fine
     */
    private function validateConfigInput(array $input, array $existing): ?JsonResponse
    {
        $refuse = fn (string $field, string $messageKey): JsonResponse
            => $this->respondWithError('VALIDATION_ERROR', __($messageKey), $field, 422);

        if (array_key_exists('max_distance_km', $input) && !self::numberInRange($input['max_distance_km'], 1, 20000)) {
            return $refuse('max_distance_km', 'api.matching_max_distance_range');
        }
        if (array_key_exists('min_match_score', $input) && !self::numberInRange($input['min_match_score'], 0, 100)) {
            return $refuse('min_match_score', 'api.matching_min_score_range');
        }
        if (array_key_exists('hot_match_threshold', $input) && !self::numberInRange($input['hot_match_threshold'], 0, 100)) {
            return $refuse('hot_match_threshold', 'api.matching_hot_threshold_range');
        }
        if (array_key_exists('min_match_score', $input) || array_key_exists('hot_match_threshold', $input)) {
            $min = (int) ($input['min_match_score'] ?? $existing['min_match_score'] ?? 40);
            $hot = (int) ($input['hot_match_threshold'] ?? $existing['hot_match_threshold'] ?? 80);
            if ($hot < $min) {
                return $refuse('hot_match_threshold', 'api.matching_hot_below_min');
            }
        }

        // Five bands, each further than the one before. They are NOT re-sorted
        // any more: sorting silently moved the admin's numbers under different
        // labels ("Walking 30 km" became "City 30 km").
        if (($input['proximity_bands'] ?? null) !== null) {
            $bands = $input['proximity_bands'];
            if (!is_array($bands) || count($bands) !== 5) {
                return $refuse('proximity_bands', 'api.matching_bands_invalid');
            }
            $previous = 0.0;
            foreach (array_values($bands) as $band) {
                $distance = is_array($band) ? ($band['distance_km'] ?? null) : null;
                if (!self::numberInRange($distance, 1, 20000) || (float) $distance <= $previous) {
                    return $refuse('proximity_bands', 'api.matching_bands_invalid');
                }
                $previous = (float) $distance;
            }
        }

        foreach (array_keys(self::WEIGHT_FIELDS) as $field) {
            if (array_key_exists($field, $input) && !self::numberInRange($input[$field], 0, 1)) {
                return $refuse($field, 'api.matching_weights_invalid');
            }
        }

        if (($input['pillars'] ?? null) !== null) {
            if (!is_array($input['pillars'])) {
                return $refuse('pillars', 'api.matching_weights_invalid');
            }
            $sum = 0.0;
            foreach (self::PILLAR_DEFAULTS as $pillar => $default) {
                $value = $input['pillars'][$pillar] ?? $existing['pillars'][$pillar] ?? $default;
                if (!self::numberInRange($value, 0, 1)) {
                    return $refuse('pillars', 'api.matching_weights_invalid');
                }
                $sum += (float) $value;
            }
            // The scorer scales the three to a total of 1; all-zero cannot be scaled.
            if ($sum <= 0.0) {
                return $refuse('pillars', 'api.matching_weights_invalid');
            }
        }

        return null;
    }

    /** PUT /api/v2/admin/matching/config */
    public function updateConfig(): JsonResponse
    {
        $this->requireAdmin();
        $input = $this->getAllInput();
        $tenantId = $this->getTenantId();

        $tenantRow = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$tenantId]);
        $tenant = $tenantRow ? (array)$tenantRow : null;
        $config = $tenant && $tenant['configuration'] ? json_decode($tenant['configuration'], true) : [];
        $config = is_array($config) ? $config : [];
        $config['algorithms'] = $config['algorithms'] ?? [];
        $existing = is_array($config['algorithms']['smart_matching'] ?? null) ? $config['algorithms']['smart_matching'] : [];

        if ($refused = $this->validateConfigInput($input, $existing)) {
            return $refused;
        }

        $proximityBands = $input['proximity_bands'] ?? null;
        $proximity = $existing['proximity'] ?? ['walking_km' => 5, 'local_km' => 15, 'city_km' => 30, 'regional_km' => 50, 'max_km' => 100];

        // Already checked above: exactly five, positive, strictly ascending.
        if (is_array($proximityBands)) {
            $proximityBands = array_values($proximityBands);
            $proximity = [
                'walking_km' => (int) $proximityBands[0]['distance_km'],
                'local_km' => (int) $proximityBands[1]['distance_km'],
                'city_km' => (int) $proximityBands[2]['distance_km'],
                'regional_km' => (int) $proximityBands[3]['distance_km'],
                'max_km' => (int) $proximityBands[4]['distance_km'],
            ];
        }

        // Hard-gate settings (additive; UI may send a partial gates object).
        $gatesIn = is_array($input['gates'] ?? null) ? $input['gates'] : [];
        $gatesExisting = is_array($existing['gates'] ?? null) ? $existing['gates'] : [];
        $missingCoordsMode = (string) ($gatesIn['missing_coords_mode'] ?? $gatesExisting['missing_coords_mode'] ?? 'remote_only');
        if (!in_array($missingCoordsMode, ['remote_only', 'tenant_wide'], true)) {
            $missingCoordsMode = 'remote_only';
        }

        $weightDefaults = ['category' => 0.25, 'skill' => 0.20, 'proximity' => 0.25, 'freshness' => 0.10, 'reciprocity' => 0.15, 'quality' => 0.05];
        $weights = [];
        foreach (self::WEIGHT_FIELDS as $field => $key) {
            $weights[$key] = (float) ($input[$field] ?? $existing['weights'][$key] ?? $weightDefaults[$key]);
        }

        // Merge over the existing block so keys this endpoint doesn't manage
        // survive a save from this UI — `adjustments`, `signals`, and the old
        // `broker_approval_enabled` value, which is intentionally neither read
        // nor written here (see getConfig()).
        $config['algorithms']['smart_matching'] = array_merge($existing, [
            'enabled' => (bool) ($input['enabled'] ?? $existing['enabled'] ?? true),
            'max_distance_km' => (int) ($input['max_distance_km'] ?? $existing['max_distance_km'] ?? 50),
            'min_match_score' => (int) ($input['min_match_score'] ?? $existing['min_match_score'] ?? 40),
            'hot_match_threshold' => (int) ($input['hot_match_threshold'] ?? $existing['hot_match_threshold'] ?? 80),
            // The gates and ai blocks keep the keys this page has no control
            // for (gates.community_centre_fallback, ai.listing_enrichment).
            // Built from the page's own keys alone, every save reset them.
            'gates' => array_merge($gatesExisting, [
                'geo_hard_gate' => (bool) ($gatesIn['geo_hard_gate'] ?? $gatesExisting['geo_hard_gate'] ?? true),
                'missing_coords_mode' => $missingCoordsMode,
                'dormancy_days' => max(0, min(3650, (int) ($gatesIn['dormancy_days'] ?? $gatesExisting['dormancy_days'] ?? 90))),
                'owner_dismissal_threshold' => max(1, min(100, (int) ($gatesIn['owner_dismissal_threshold'] ?? $gatesExisting['owner_dismissal_threshold'] ?? 3))),
            ]),
            'engine_version' => in_array((int) ($input['engine_version'] ?? $existing['engine_version'] ?? 2), [1, 2], true)
                ? (int) ($input['engine_version'] ?? $existing['engine_version'] ?? 2) : 2,
            'ai' => array_merge(is_array($existing['ai'] ?? null) ? $existing['ai'] : [], [
                'semantic_signal' => (bool) ($input['ai']['semantic_signal'] ?? $existing['ai']['semantic_signal'] ?? true),
                'llm_explanations' => (bool) ($input['ai']['llm_explanations'] ?? $existing['ai']['llm_explanations'] ?? true),
                'explanation_top_n' => max(1, min(10, (int) ($input['ai']['explanation_top_n'] ?? $existing['ai']['explanation_top_n'] ?? 5))),
            ]),
            'pillars' => [
                'relevance' => max(0.0, min(1.0, (float) ($input['pillars']['relevance'] ?? $existing['pillars']['relevance'] ?? 0.45))),
                'feasibility' => max(0.0, min(1.0, (float) ($input['pillars']['feasibility'] ?? $existing['pillars']['feasibility'] ?? 0.35))),
                'trust' => max(0.0, min(1.0, (float) ($input['pillars']['trust'] ?? $existing['pillars']['trust'] ?? 0.20))),
            ],
            'weights' => $weights,
            'proximity' => $proximity,
        ]);

        DB::update("UPDATE tenants SET configuration = ? WHERE id = ?", [json_encode($config), $tenantId]);
        $this->smartMatchingEngine->clearCache();

        return $this->respondWithData(['message' => __('api.matching_config_updated')]);
    }

    // =========================================================================
    // DIAGNOSIS — why one member / one listing does or does not get matches
    // =========================================================================

    /**
     * The community settings a diagnosis is read against.
     *
     * @return array<string, mixed>
     */
    private function diagnosisSettings(): array
    {
        $config = $this->smartMatchingEngine->getConfig();
        $gates = is_array($config['gates'] ?? null) ? $config['gates'] : [];

        return [
            'matching_enabled' => (bool) ($config['enabled'] ?? true),
            'min_match_score' => (int) ($config['min_match_score'] ?? 40),
            'max_distance_km' => (int) ($config['max_distance_km'] ?? 50),
            'geo_hard_gate' => (bool) ($gates['geo_hard_gate'] ?? true),
            'missing_coords_mode' => ($gates['missing_coords_mode'] ?? 'remote_only') === 'tenant_wide' ? 'tenant_wide' : 'remote_only',
            'dormancy_days' => max(0, (int) ($gates['dormancy_days'] ?? 90)),
        ];
    }

    /**
     * GET /api/v2/admin/matching/diagnose/user/{id}
     *
     * Plain facts about why one member of THIS community does or does not get
     * matches, plus `findings`: the short list of things that are holding
     * matches back, as codes the screen words. Admin only; an id from another
     * community answers 404, exactly like an id that does not exist.
     *
     * (The Matching diagnostic page used to call /v2/admin/matching/stats with
     * ?user_id=, which that endpoint never read: any id, real or not, printed
     * the same community-wide figures.)
     */
    public function diagnoseUser(int $id): JsonResponse
    {
        // Only the Matching diagnostic page calls this, and that page is in
        // the Platform team panel (pinned in Security/PlatformTeamLocks).
        $this->requireGodPlatformAdmin();

        $facts = $this->smartMatchingAnalyticsService->diagnoseUser($id);
        if ($facts === null) {
            return $this->respondWithError('NOT_FOUND', __('api.member_not_found'), 'id', 404);
        }

        $settings = $this->diagnosisSettings();

        // Does a coordinator have to approve this member's matches first?
        // null = it could not be checked, which the screen says in words: the
        // engine itself withholds matches in that case, so "unknown" matters.
        $needsApproval = null;
        try {
            $flagged = app(MatchApprovalGate::class)->membersNeedingApproval([$id], $this->getTenantId());
            $needsApproval = isset($flagged[$id]);
        } catch (\Throwable $e) {
            Log::warning('[AdminMatching] diagnoseUser could not read the approval state', [
                'user_id' => $id,
                'exception' => $e::class,
            ]);
        }

        $prefs = $facts['preferences'];
        $userMax = $prefs['max_distance_km'];
        $effective = [
            // The member's own floor wins; the community's applies otherwise.
            'min_match_score' => $prefs['min_match_score'] ?? $settings['min_match_score'],
            // The member can tighten the community maximum, never exceed it.
            'max_distance_km' => $userMax !== null && $userMax > 0
                ? min($userMax, $settings['max_distance_km'])
                : $settings['max_distance_km'],
        ];

        $findings = [];
        if (!$settings['matching_enabled']) {
            $findings[] = 'matching_off';
        }
        if ($facts['member']['status'] !== 'active') {
            $findings[] = 'member_not_active';
        }
        if ($prefs['matching_paused']) {
            $findings[] = 'matching_paused';
        }
        if ($facts['listings']['active_count'] === 0) {
            // No listing of their own: the engine can only offer browsing
            // suggestions, not matches scored against what they offer or need.
            $findings[] = 'no_active_listings';
        }
        if (!$facts['member']['has_coordinates']) {
            $findings[] = $settings['geo_hard_gate'] && $settings['missing_coords_mode'] !== 'tenant_wide'
                ? 'no_location_remote_only'
                : 'no_location';
        }
        if ($needsApproval === true) {
            $findings[] = 'needs_coordinator_approval';
        } elseif ($needsApproval === null) {
            $findings[] = 'approval_state_unknown';
        }
        if ($findings === []) {
            $findings[] = 'nothing_blocking';
        }

        return $this->respondWithData(array_merge($facts, [
            'community' => $settings,
            'effective' => $effective,
            'needs_coordinator_approval' => $needsApproval,
            'findings' => $findings,
        ]));
    }

    /**
     * GET /api/v2/admin/matching/diagnose/listing/{id}
     *
     * Plain facts about why one listing of THIS community is or is not being
     * offered to members as a match. Admin only; 404 outside the community.
     */
    public function diagnoseListing(int $id): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        $facts = $this->smartMatchingAnalyticsService->diagnoseListing($id);
        if ($facts === null) {
            return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), 'id', 404);
        }

        $settings = $this->diagnosisSettings();

        $findings = [];
        if (!$settings['matching_enabled']) {
            $findings[] = 'matching_off';
        }
        if ($facts['listing']['status'] !== 'active') {
            $findings[] = 'listing_not_active';
        }
        // …or that is waiting for review or was not approved (the same rule
        // as ListingService::applyPublicVisibility()).
        $moderation = $facts['listing']['moderation_status'];
        if ($moderation !== null && $moderation !== 'approved') {
            $findings[] = 'listing_not_approved';
        }
        // The candidate search only takes listings whose owner is an ACTIVE
        // member: not deactivated, suspended, banned, refused or still
        // waiting for approval (Matching\CandidateRetriever).
        if ($facts['owner']['status'] !== 'active') {
            $findings[] = 'owner_not_active';
        }
        // …and listings whose owner has not been active for `dormancy_days`
        // (an owner with no recorded activity date is let through).
        $idleDays = $facts['owner']['days_since_active'];
        if ($settings['dormancy_days'] > 0 && $idleDays !== null && $idleDays > $settings['dormancy_days']) {
            $findings[] = 'owner_dormant';
        }
        // An in-person listing needs a place: its own, or its owner's.
        if (
            $settings['geo_hard_gate']
            && in_array($facts['listing']['service_type'], ['physical_only', 'location_dependent'], true)
            && !$facts['listing']['has_coordinates']
            && !$facts['owner']['has_coordinates']
        ) {
            $findings[] = 'no_location_in_person';
        }
        if ($findings === []) {
            $findings[] = 'nothing_blocking';
        }

        return $this->respondWithData(array_merge($facts, [
            'community' => $settings,
            'findings' => $findings,
        ]));
    }

    /** POST /api/v2/admin/matching/clear-cache */
    public function clearCache(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $deleted = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM match_cache WHERE tenant_id = ?", [$tenantId])->cnt;
            DB::delete("DELETE FROM match_cache WHERE tenant_id = ?", [$tenantId]);
            $this->smartMatchingEngine->clearCache();
            return $this->respondWithData(['message' => __('api.match_cache_cleared'), 'entries_cleared' => $deleted]);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.failed_to_clear_cache'), null, 500);
        }
    }

    /** GET /api/v2/admin/matching/stats */
    public function getStats(): JsonResponse
    {
        $this->requireAdmin();

        try {
            // "Hot" is whatever this community set it to on the configuration
            // screen, not a fixed 80.
            $config = $this->smartMatchingEngine->getConfig();
            $hotThreshold = (float) ($config['hot_match_threshold'] ?? 80);

            $stats = $this->smartMatchingAnalyticsService->getOverallStats($hotThreshold);
            $scoreDistribution = $this->smartMatchingAnalyticsService->getScoreDistribution();
            $distanceDistribution = $this->smartMatchingAnalyticsService->getDistanceDistribution();

            $pendingApprovals = 0;
            $approvedCount = 0;
            $rejectedCount = 0;
            $tenantId = $this->getTenantId();
            $pendingApprovals = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM match_approvals WHERE tenant_id = ? AND status = 'pending'", [$tenantId])->cnt;
            $approvedCount = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM match_approvals WHERE tenant_id = ? AND status = 'approved'", [$tenantId])->cnt;
            $rejectedCount = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM match_approvals WHERE tenant_id = ? AND status = 'rejected'", [$tenantId])->cnt;

            $totalReviewed = $approvedCount + $rejectedCount;
            $approvalRate = $totalReviewed > 0 ? round(($approvedCount / $totalReviewed) * 100, 1) : 0;

            return $this->respondWithData([
                'overview' => $stats, 'score_distribution' => $scoreDistribution,
                'distance_distribution' => $distanceDistribution,
                'pending_approvals' => $pendingApprovals, 'approved_count' => $approvedCount,
                'rejected_count' => $rejectedCount, 'approval_rate' => $approvalRate,
                'gate_impact' => $this->smartMatchingAnalyticsService->getGateImpact(),
                'pillar_averages' => $this->smartMatchingAnalyticsService->getPillarAverages(),
            ]);
        } catch (\Throwable $e) {
            Log::error('[AdminMatching] getStats failed', ['exception' => $e::class, 'error' => $e->getMessage()]);
            return $this->respondWithError('SERVER_ERROR', __('api.server_error'), null, 500);
        }
    }

}
