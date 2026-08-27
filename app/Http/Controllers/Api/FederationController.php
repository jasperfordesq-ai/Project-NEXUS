<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\FederationActivityService;
use App\Services\FederationEmailService;
use App\Services\FederationJwtService;
use App\Services\FederationRealtimeService;
use App\Services\FederationUserService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\CorsHelper;
use App\Core\FederationApiMiddleware;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\BrokerMessageVisibilityService;
use App\Services\FederationAuditService;
use App\Services\FederationFeatureService;
use App\Services\MessageService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\UserDisplayName;

/**
 * FederationController -- Federation cross-tenant features.
 *
 * V2 endpoints (status, opt-in/out, partners, activity) use user JWT auth.
 * V1 federation API endpoints use FederationApiMiddleware (API key auth).
 * All methods converted from delegation to direct service/DB calls.
 */
class FederationController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly FederationActivityService $federationActivityService,
        private readonly FederationAuditService $federationAuditService,
        private readonly FederationEmailService $federationEmailService,
        private readonly FederationFeatureService $federationFeatureService,
        private readonly FederationJwtService $federationJwtService,
        private readonly FederationRealtimeService $federationRealtimeService,
        private readonly FederationUserService $federationUserService,
        private readonly BrokerMessageVisibilityService $brokerMessageVisibilityService,
    ) {}

    private const LEVEL_NAMES = [
        1 => 'Discovery',
        2 => 'Social',
        3 => 'Economic',
        4 => 'Integrated',
    ];

    // =====================================================================
    // V2 STATUS & OPT-IN/OUT (migrated)
    // =====================================================================

    /** GET federation/status */
    public function status(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $tenantFederationEnabled = $this->federationFeatureService->isGloballyEnabled()
            && $this->federationFeatureService->isTenantFederationEnabled($tenantId);

        $userSettings = $this->federationUserService->getUserSettings($userId);
        $userOptedIn = (bool) ($userSettings['federation_optin'] ?? false);

        $partnershipsCount = 0;
        try {
            $result = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM federation_partnerships
                 WHERE (tenant_id = ? OR partner_tenant_id = ?) AND status = 'active'",
                [$tenantId, $tenantId]
            );
            $partnershipsCount = (int) ($result->cnt ?? 0);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::status partnerships count error: " . $e->getMessage());
        }

        return $this->respondWithData([
            'enabled' => $tenantFederationEnabled && $userOptedIn,
            'tenant_federation_enabled' => $tenantFederationEnabled,
            'partnerships_count' => $partnershipsCount,
            'federation_optin' => $userOptedIn,
        ]);
    }

    /** POST federation/opt-in */
    public function optIn(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $tenantEnabled = $this->federationFeatureService->isGloballyEnabled()
            && $this->federationFeatureService->isTenantFederationEnabled($tenantId);

        if (!$tenantEnabled) {
            return $this->respondWithError('FEDERATION_NOT_AVAILABLE', __('api.federation_not_available'), null, 403);
        }

        $current = $this->federationUserService->getUserSettings($userId);

        if ($current['federation_optin']) {
            return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.federation.already_opted_in')]);
        }

        $settings = array_merge($current, [
            'federation_optin' => true,
            'profile_visible_federated' => true,
            'appear_in_federated_search' => true,
            'show_skills_federated' => true,
            'messaging_enabled_federated' => true,
            'transactions_enabled_federated' => true,
        ]);

        $success = $this->federationUserService->updateSettings($userId, $settings);

        if ($success) {
            $this->federationAuditService->log('user_federation_optin', $tenantId, null, $userId, [], FederationAuditService::LEVEL_INFO);
            return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.federation.enabled_successfully')]);
        } else {
            return $this->respondWithError('OPT_IN_FAILED', __('api.federation_opt_in_failed'), null, 500);
        }
    }

    /** POST federation/setup */
    public function setup(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $tenantEnabled = $this->federationFeatureService->isGloballyEnabled()
            && $this->federationFeatureService->isTenantFederationEnabled($tenantId);

        if (!$tenantEnabled) {
            return $this->respondWithError('FEDERATION_NOT_AVAILABLE', __('api.federation_not_available'), null, 403);
        }

        $data = $this->getAllInput();

        $settings = [
            'federation_optin' => true,
            'profile_visible_federated' => $data['profile_visible_federated'] ?? true,
            'appear_in_federated_search' => $data['appear_in_federated_search'] ?? true,
            'show_skills_federated' => $data['show_skills_federated'] ?? true,
            'show_location_federated' => $data['show_location_federated'] ?? false,
            'show_reviews_federated' => $data['show_reviews_federated'] ?? true,
            'messaging_enabled_federated' => $data['messaging_enabled_federated'] ?? true,
            'transactions_enabled_federated' => $data['transactions_enabled_federated'] ?? true,
            'email_notifications' => $data['email_notifications'] ?? true,
            'service_reach' => $data['service_reach'] ?? 'local_only',
            'travel_radius_km' => array_key_exists('travel_radius_km', $data) ? (int) $data['travel_radius_km'] : 25,
        ];

        $success = $this->federationUserService->updateSettings($userId, $settings);

        if ($success) {
            $this->federationAuditService->log('user_federation_optin', $tenantId, null, $userId, [], FederationAuditService::LEVEL_INFO);
            return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.federation.enabled_successfully')]);
        } else {
            return $this->respondWithError('SETUP_FAILED', __('api.federation_opt_in_failed'), null, 500);
        }
    }

    /** POST federation/opt-out */
    public function optOut(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $success = $this->federationUserService->optOut($userId);

        if ($success) {
            $this->federationAuditService->log('user_federation_optout', $tenantId, null, $userId, [], FederationAuditService::LEVEL_INFO);
            return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.federation.disabled_successfully')]);
        } else {
            return $this->respondWithError('OPT_OUT_FAILED', __('api.federation_opt_out_failed'), null, 500);
        }
    }

    /** GET federation/partners */
    public function partners(): JsonResponse
    {
        $this->requireAuth();
        $tenantId = $this->getTenantId();

        try {
            $partnershipResults = DB::select("
                SELECT
                    fp.id as partnership_id,
                    fp.federation_level,
                    fp.created_at as partnership_since,
                    fp.profiles_enabled, fp.messaging_enabled, fp.transactions_enabled,
                    fp.listings_enabled, fp.events_enabled, fp.groups_enabled,
                    CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END as partner_tenant_id,
                    CASE WHEN fp.tenant_id = ? THEN t2.name ELSE t1.name END as partner_name,
                    CASE WHEN fp.tenant_id = ? THEN t2.tagline ELSE t1.tagline END as partner_tagline,
                    CASE WHEN fp.tenant_id = ? THEN t2.location_name ELSE t1.location_name END as partner_location,
                    CASE WHEN fp.tenant_id = ? THEN t2.country_code ELSE t1.country_code END as partner_country,
                    CASE WHEN fp.tenant_id = ? THEN dp2.logo_url ELSE dp1.logo_url END as partner_logo,
                    CASE WHEN fp.tenant_id = ? THEN dp2.member_count ELSE dp1.member_count END as partner_member_count
                FROM federation_partnerships fp
                LEFT JOIN tenants t1 ON fp.tenant_id = t1.id
                LEFT JOIN tenants t2 ON fp.partner_tenant_id = t2.id
                LEFT JOIN federation_directory_profiles dp1 ON dp1.tenant_id = fp.tenant_id
                LEFT JOIN federation_directory_profiles dp2 ON dp2.tenant_id = fp.partner_tenant_id
                WHERE (fp.tenant_id = ? OR fp.partner_tenant_id = ?)
                AND fp.status = 'active'
                ORDER BY partner_name ASC
            ", [
                $tenantId, $tenantId, $tenantId, $tenantId,
                $tenantId, $tenantId, $tenantId,
                $tenantId, $tenantId,
            ]);
            $partnerships = array_map(fn($r) => (array)$r, $partnershipResults);

            $formatted = array_map(function ($p) {
                $level = (int) ($p['federation_level'] ?? 1);
                $permissions = [];
                if ($p['profiles_enabled']) $permissions[] = 'profiles';
                if ($p['messaging_enabled']) $permissions[] = 'messaging';
                if ($p['transactions_enabled']) $permissions[] = 'transactions';
                if ($p['listings_enabled']) $permissions[] = 'listings';
                if ($p['events_enabled']) $permissions[] = 'events';
                if ($p['groups_enabled']) $permissions[] = 'groups';

                return [
                    'id' => (int) $p['partner_tenant_id'],
                    'name' => $p['partner_name'] ?? 'Unknown',
                    'logo' => $p['partner_logo'] ?: null,
                    'tagline' => $p['partner_tagline'] ?? '',
                    'location' => $p['partner_location'] ?? '',
                    'country' => $p['partner_country'] ?? '',
                    'member_count' => (int) ($p['partner_member_count'] ?? 0),
                    'federation_level' => $level,
                    'federation_level_name' => self::LEVEL_NAMES[$level] ?? 'Discovery',
                    'permissions' => $permissions,
                    'partnership_since' => $p['partnership_since'] ?? null,
                ];
            }, $partnerships);

            return $this->respondWithData($formatted);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::partners error: " . $e->getMessage());
            return $this->respondWithData([]);
        }
    }

    /** GET federation/activity */
    public function activity(): JsonResponse
    {
        $userId = $this->requireAuth();

        try {
            $rawActivity = $this->federationActivityService->getActivityFeed($userId, 20);

            $formatted = [];
            $id = 1;
            foreach ($rawActivity as $item) {
                $type = $this->mapActivityType($item['type'] ?? 'message');
                $formatted[] = [
                    'id' => $id++,
                    'type' => $type,
                    'title' => $item['title'] ?? '',
                    'description' => $item['description'] ?? ($item['preview'] ?? ''),
                    'created_at' => $item['timestamp'] ?? date('Y-m-d H:i:s'),
                    'actor' => [
                        'name' => $item['subtitle'] ?? __('api.federation_network_name'),
                        'avatar' => null,
                        'tenant_name' => $item['subtitle'] ?? null,
                    ],
                ];
            }

            return $this->respondWithData($formatted);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::activity error: " . $e->getMessage());
            return $this->respondWithData([]);
        }
    }

    // =====================================================================
    // V1 FEDERATION API — Direct implementation (API key auth)
    // =====================================================================

    /** GET /api/v1/federation — API info */
    public function index(): JsonResponse
    {
        return $this->fedSuccess([
            'api' => 'Federation API',
            'version' => '1.0',
            'documentation' => '/docs/api/federation',
            'endpoints' => [
                'GET /api/v1/federation/health' => 'Health check',
                'GET /api/v1/federation/timebanks' => 'List partner timebanks',
                'GET /api/v1/federation/members' => 'Search federated members',
                'GET /api/v1/federation/members/{id}' => 'Get member profile',
                'GET /api/v1/federation/listings' => 'Search federated listings',
                'GET /api/v1/federation/listings/{id}' => 'Get listing details',
                'GET /api/v1/federation/messages' => 'Retrieve federated messages',
                'POST /api/v1/federation/messages' => 'Send federated message',
                'GET /api/v1/federation/reviews' => 'Get federated reviews for a user',
                'POST /api/v1/federation/reviews' => 'Create federated review',
                'GET /api/v1/federation/transactions/{id}' => 'Get transaction status',
                'POST /api/v1/federation/transactions' => 'Initiate time credit transfer',
            ],
        ]);
    }

    /** GET /api/v1/federation/health — Health check for partner connectivity */
    public function health(): JsonResponse
    {
        return $this->fedSuccess([
            'status' => 'ok',
            'timestamp' => now()->toIso8601String(),
            'version' => '1.0',
        ]);
    }

    /** GET /api/v1/federation/timebanks */
    public function timebanks(): JsonResponse
    {
        $auth = $this->fedAuth('timebanks:read');
        if ($auth instanceof JsonResponse) return $auth;

        $partnerTenantId = $auth['tenant_id'];
        $isExternal = !empty($auth['platform_id']);
        $db = DB::getPdo();

        if ($isExternal) {
            $stmt = $db->prepare("
                SELECT t.id, t.name, t.tagline, t.location_name, t.country_code, t.created_at as partnership_since,
                    (SELECT COUNT(*) FROM federation_user_settings fus JOIN users u ON u.id = fus.user_id
                     WHERE u.tenant_id = t.id AND fus.federation_optin = 1 AND u.status = 'active') as member_count
                FROM tenants t WHERE t.id = ?
            ");
            $stmt->execute([$partnerTenantId]);
        } else {
            $stmt = $db->prepare("
                SELECT t.id, t.name, t.tagline, t.location_name, t.country_code, fp.status as partnership_status, fp.created_at as partnership_since,
                    (SELECT COUNT(*) FROM federation_user_settings fus JOIN users u ON u.id = fus.user_id
                     WHERE u.tenant_id = t.id AND fus.federation_optin = 1) as member_count
                FROM federation_partnerships fp
                JOIN tenants t ON ((fp.tenant_id = ? AND t.id = fp.partner_tenant_id) OR (fp.partner_tenant_id = ? AND t.id = fp.tenant_id))
                WHERE fp.status = 'active' ORDER BY t.name ASC
            ");
            $stmt->execute([$partnerTenantId, $partnerTenantId]);
        }

        $timebanks = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        $formatted = array_map(fn($tb) => [
            'id' => (int) $tb['id'],
            'name' => $tb['name'],
            'tagline' => $tb['tagline'],
            'location' => ['city' => $tb['location_name'], 'country' => $tb['country_code']],
            'member_count' => (int) $tb['member_count'],
            'partnership_status' => $tb['partnership_status'] ?? 'active',
            'partnership_since' => $tb['partnership_since'],
        ], $timebanks);

        return $this->fedSuccess(['data' => $formatted, 'count' => count($formatted)]);
    }

    /** GET /api/v1/federation/members */
    public function members(): JsonResponse
    {
        $auth = $this->fedAuth('members:read');
        if ($auth instanceof JsonResponse) return $auth;

        $partnerTenantId = $auth['tenant_id'];
        $isExternal = !empty($auth['platform_id']);
        $db = DB::getPdo();

        $query = request()->query('q', '');
        $timebankId = request()->query('timebank_id') !== null ? (int) request()->query('timebank_id') : null;
        $skills = !empty(request()->query('skills')) ? array_slice(explode(',', request()->query('skills')), 0, 10) : [];
        $location = request()->query('location', '');
        $page = max(1, (int) request()->query('page', 1));
        $perPage = min(100, max(1, (int) request()->query('per_page', 20)));

        if ($isExternal) {
            $baseCondition = "FROM users u JOIN federation_user_settings fus ON fus.user_id = u.id JOIN tenants t ON t.id = u.tenant_id
                    WHERE u.tenant_id = ? AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND fus.appear_in_federated_search = 1 AND u.status = 'active'";
            $params = [$partnerTenantId];
        } else {
            // FED-005: Check profiles_enabled on partnership to enforce permission boundaries
            $baseCondition = "FROM users u JOIN federation_user_settings fus ON fus.user_id = u.id JOIN tenants t ON t.id = u.tenant_id
                    JOIN federation_partnerships fp ON ((fp.tenant_id = ? AND fp.partner_tenant_id = u.tenant_id) OR (fp.partner_tenant_id = ? AND fp.tenant_id = u.tenant_id))
                    WHERE fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND fus.appear_in_federated_search = 1 AND fp.status = 'active' AND fp.profiles_enabled = 1 AND u.tenant_id != ?";
            $params = [$partnerTenantId, $partnerTenantId, $partnerTenantId];
        }

        if (!empty($query)) {
            $baseCondition .= " AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.username LIKE ? OR u.skills LIKE ?)";
            $term = "%{$query}%";
            array_push($params, $term, $term, $term, $term);
        }
        if ($timebankId) { $baseCondition .= " AND u.tenant_id = ?"; $params[] = $timebankId; }
        foreach ($skills as $skill) { $baseCondition .= " AND u.skills LIKE ?"; $params[] = "%{$skill}%"; }
        if (!empty($location)) { $baseCondition .= " AND u.location LIKE ?"; $params[] = "%{$location}%"; }

        // COUNT query uses same WHERE conditions without LIMIT
        $countStmt = $db->prepare("SELECT COUNT(*) " . $baseCondition);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $sql = "SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url as avatar, u.location, u.bio, u.skills, u.created_at, u.tenant_id, fus.service_reach, t.name as timebank_name " . $baseCondition;
        $sql .= " ORDER BY u.first_name ASC, u.last_name ASC LIMIT ?, ?";
        $paginatedParams = array_merge($params, [(int) (($page - 1) * $perPage), (int) $perPage]);

        $stmt = $db->prepare($sql);
        $stmt->execute($paginatedParams);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        $formatted = array_map(fn($m) => [
            'id' => (int) $m['id'], 'username' => $m['username'],
            'name' => UserDisplayName::resolve($m),
            'avatar' => $m['avatar'] ?: null, 'bio' => $m['bio'],
            'skills' => $m['skills'] ? explode(',', $m['skills']) : [],
            'location' => $m['location'],
            'timebank' => ['id' => (int) $m['tenant_id'], 'name' => $m['timebank_name']],
            'service_reach' => $m['service_reach'], 'joined' => $m['created_at'],
        ], $rows);

        return $this->fedPaginated($formatted, $total, $page, $perPage);
    }

    /** GET /api/v1/federation/members/{id} */
    public function member($id): JsonResponse
    {
        $auth = $this->fedAuth('members:read');
        if ($auth instanceof JsonResponse) return $auth;

        $partnerTenantId = $auth['tenant_id'];
        $isExternal = !empty($auth['platform_id']);
        $db = DB::getPdo();

        if ($isExternal) {
            $stmt = $db->prepare("
                SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url as avatar, u.location, u.bio, u.skills, u.created_at, u.tenant_id,
                       fus.service_reach, fus.messaging_enabled_federated, fus.transactions_enabled_federated, t.name as timebank_name
                FROM users u JOIN federation_user_settings fus ON fus.user_id = u.id JOIN tenants t ON t.id = u.tenant_id
                WHERE u.id = ? AND u.tenant_id = ? AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND u.status = 'active'
            ");
            $stmt->execute([$id, $partnerTenantId]);
        } else {
            // FED-005: Also check profiles_enabled on partnership
            $stmt = $db->prepare("
                SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url as avatar, u.location, u.bio, u.skills, u.created_at, u.tenant_id,
                       fus.service_reach, fus.messaging_enabled_federated, fus.transactions_enabled_federated, t.name as timebank_name
                FROM users u JOIN federation_user_settings fus ON fus.user_id = u.id JOIN tenants t ON t.id = u.tenant_id
                JOIN federation_partnerships fp ON ((fp.tenant_id = ? AND fp.partner_tenant_id = u.tenant_id) OR (fp.partner_tenant_id = ? AND fp.tenant_id = u.tenant_id))
                WHERE u.id = ? AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND fp.status = 'active' AND fp.profiles_enabled = 1
            ");
            $stmt->execute([$partnerTenantId, $partnerTenantId, $id]);
        }

        $member = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$member) {
            return $this->fedError(404, 'Member not found or not accessible', 'MEMBER_NOT_FOUND');
        }

        return $this->fedSuccess(['data' => [
            'id' => (int) $member['id'], 'username' => $member['username'],
            'name' => UserDisplayName::resolve($member),
            'avatar' => $member['avatar'] ?: null, 'bio' => $member['bio'],
            'skills' => $member['skills'] ? explode(',', $member['skills']) : [],
            'location' => $member['location'],
            'timebank' => ['id' => (int) $member['tenant_id'], 'name' => $member['timebank_name']],
            'service_reach' => $member['service_reach'],
            'accepts_messages' => (bool) $member['messaging_enabled_federated'],
            'accepts_transactions' => (bool) $member['transactions_enabled_federated'],
            'joined' => $member['created_at'],
        ]]);
    }

    /** GET /api/v1/federation/listings */
    public function listings(): JsonResponse
    {
        $auth = $this->fedAuth('listings:read');
        if ($auth instanceof JsonResponse) return $auth;

        $partnerTenantId = $auth['tenant_id'];
        $isExternal = !empty($auth['platform_id']);
        $db = DB::getPdo();

        $query = request()->query('q', '');
        $type = request()->query('type', '');
        $timebankId = request()->query('timebank_id') !== null ? (int) request()->query('timebank_id') : null;
        $category = request()->query('category', '');
        $page = max(1, (int) request()->query('page', 1));
        $perPage = min(100, max(1, (int) request()->query('per_page', 20)));

        if ($isExternal) {
            $baseCondition = "FROM listings l JOIN users u ON u.id = l.user_id JOIN tenants t ON t.id = l.tenant_id JOIN federation_user_settings fus ON fus.user_id = l.user_id LEFT JOIN categories c ON c.id = l.category_id
                    WHERE l.status = 'active' AND l.federated_visibility IN ('listed', 'bookable') AND l.tenant_id = ? AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND fus.appear_in_federated_search = 1";
            $params = [$partnerTenantId];
        } else {
            // FED-006: Check listings_enabled on partnership to enforce permission boundaries
            $baseCondition = "FROM listings l JOIN users u ON u.id = l.user_id JOIN tenants t ON t.id = l.tenant_id JOIN federation_user_settings fus ON fus.user_id = l.user_id LEFT JOIN categories c ON c.id = l.category_id
                    JOIN federation_partnerships fp ON ((fp.tenant_id = ? AND fp.partner_tenant_id = l.tenant_id) OR (fp.partner_tenant_id = ? AND fp.tenant_id = l.tenant_id))
                    WHERE l.status = 'active' AND l.federated_visibility IN ('listed', 'bookable') AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND fus.appear_in_federated_search = 1 AND fp.status = 'active' AND fp.listings_enabled = 1 AND l.tenant_id != ?";
            $params = [$partnerTenantId, $partnerTenantId, $partnerTenantId];
        }

        if (!empty($query)) { $baseCondition .= " AND (l.title LIKE ? OR l.description LIKE ?)"; $term = "%{$query}%"; array_push($params, $term, $term); }
        if (!empty($type) && in_array($type, ['offer', 'request'])) { $baseCondition .= " AND l.type = ?"; $params[] = $type; }
        if ($timebankId) { $baseCondition .= " AND l.tenant_id = ?"; $params[] = $timebankId; }
        if (!empty($category)) { $baseCondition .= " AND l.category_id = ?"; $params[] = $category; }

        // COUNT query uses same WHERE conditions without LIMIT
        $countStmt = $db->prepare("SELECT COUNT(*) " . $baseCondition);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $sql = "SELECT l.id, l.title, l.description, l.type, l.category_id, c.name as category_name, l.price as rate, l.created_at, l.user_id, u.first_name, u.last_name, u.avatar_url as avatar, l.tenant_id, t.name as timebank_name " . $baseCondition;
        $sql .= " ORDER BY l.created_at DESC LIMIT ?, ?";
        $paginatedParams = array_merge($params, [(int) (($page - 1) * $perPage), (int) $perPage]);

        $stmt = $db->prepare($sql);
        $stmt->execute($paginatedParams);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        $formatted = array_map(fn($l) => [
            'id' => (int) $l['id'], 'title' => $l['title'], 'description' => $l['description'],
            'type' => $l['type'], 'category' => $l['category_name'] ?? null, 'category_id' => $l['category_id'] ? (int) $l['category_id'] : null, 'rate' => $l['rate'],
            'owner' => ['id' => (int) $l['user_id'], 'name' => UserDisplayName::resolve($l), 'avatar' => $l['avatar'] ?: null],
            'timebank' => ['id' => (int) $l['tenant_id'], 'name' => $l['timebank_name']],
            'created_at' => $l['created_at'],
        ], $rows);

        return $this->fedPaginated($formatted, $total, $page, $perPage);
    }

    /** GET /api/v1/federation/listings/{id} */
    public function listing($id): JsonResponse
    {
        $auth = $this->fedAuth('listings:read');
        if ($auth instanceof JsonResponse) return $auth;

        $partnerTenantId = $auth['tenant_id'];
        $isExternal = !empty($auth['platform_id']);
        $db = DB::getPdo();

        if ($isExternal) {
            $stmt = $db->prepare("
                SELECT l.id, l.title, l.description, l.type, l.status, l.category_id, c.name as category_name, l.price, l.user_id, l.tenant_id, l.created_at, l.updated_at, u.first_name, u.last_name, u.avatar_url as avatar, u.location, t.name as timebank_name
                FROM listings l JOIN users u ON u.id = l.user_id JOIN tenants t ON t.id = l.tenant_id JOIN federation_user_settings fus ON fus.user_id = l.user_id LEFT JOIN categories c ON c.id = l.category_id
                WHERE l.id = ? AND l.tenant_id = ? AND l.status = 'active' AND l.federated_visibility IN ('listed', 'bookable') AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND fus.appear_in_federated_search = 1
            ");
            $stmt->execute([$id, $partnerTenantId]);
        } else {
            // FED-006: Also check listings_enabled on partnership
            $stmt = $db->prepare("
                SELECT l.id, l.title, l.description, l.type, l.status, l.category_id, c.name as category_name, l.price, l.user_id, l.tenant_id, l.created_at, l.updated_at, u.first_name, u.last_name, u.avatar_url as avatar, u.location, t.name as timebank_name
                FROM listings l JOIN users u ON u.id = l.user_id JOIN tenants t ON t.id = l.tenant_id JOIN federation_user_settings fus ON fus.user_id = l.user_id LEFT JOIN categories c ON c.id = l.category_id
                JOIN federation_partnerships fp ON ((fp.tenant_id = ? AND fp.partner_tenant_id = l.tenant_id) OR (fp.partner_tenant_id = ? AND fp.tenant_id = l.tenant_id))
                WHERE l.id = ? AND l.status = 'active' AND l.federated_visibility IN ('listed', 'bookable') AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND fus.appear_in_federated_search = 1 AND fp.status = 'active' AND fp.listings_enabled = 1
            ");
            $stmt->execute([$partnerTenantId, $partnerTenantId, $id]);
        }

        $listing = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$listing) {
            return $this->fedError(404, 'Listing not found or not accessible', 'LISTING_NOT_FOUND');
        }

        return $this->fedSuccess(['data' => [
            'id' => (int) $listing['id'], 'title' => $listing['title'], 'description' => $listing['description'],
            'type' => $listing['type'], 'category' => $listing['category_name'] ?? null, 'category_id' => $listing['category_id'] ? (int) $listing['category_id'] : null, 'rate' => $listing['rate'] ?? $listing['price'] ?? null,
            'owner' => ['id' => (int) $listing['user_id'], 'name' => UserDisplayName::resolve($listing), 'avatar' => $listing['avatar'] ?: null, 'location' => $listing['location']],
            'timebank' => ['id' => (int) $listing['tenant_id'], 'name' => $listing['timebank_name']],
            'created_at' => $listing['created_at'], 'updated_at' => $listing['updated_at'] ?? null,
        ]]);
    }

    /** POST /api/v1/federation/messages */
    public function sendMessage(): JsonResponse
    {
        $auth = $this->fedAuth('messages:write');
        if ($auth instanceof JsonResponse) return $auth;

        $partnerTenantId = $auth['tenant_id'];
        $isExternal = !empty($auth['platform_id']);
        $input = request()->json()->all();
        $db = DB::getPdo();

        foreach (['recipient_id', 'subject', 'body', 'sender_id'] as $field) {
            if (empty($input[$field])) {
                return $this->fedError(400, "Missing required field: {$field}", 'VALIDATION_ERROR');
            }
        }

        // Validate sender — for external partners, the sender is on the REMOTE server
        // and can't be validated locally. The API key authentication already proves legitimacy.
        if (!$isExternal) {
            $senderCheck = DB::selectOne(
                "SELECT u.id FROM users u
                 JOIN federation_user_settings fus ON fus.user_id = u.id
                 WHERE u.id = ? AND u.tenant_id = ? AND fus.federation_optin = 1 AND u.status = 'active'",
                [(int) $input['sender_id'], $partnerTenantId]
            );
            if (!$senderCheck) {
                return $this->fedError(403, 'Sender not found, not in your tenant, or has not opted into federation', 'SENDER_NOT_ELIGIBLE');
            }
        }

        if ($isExternal) {
            // For external partners, the recipient is a local user — use the current
            // tenant context rather than the partner's tenant_id from the API key,
            // which may differ from the recipient's actual tenant.
            $recipientTenantId = \App\Core\TenantContext::getId() ?? $partnerTenantId;
            $stmt = $db->prepare("SELECT u.id, u.first_name, u.tenant_id, fus.messaging_enabled_federated FROM users u JOIN federation_user_settings fus ON fus.user_id = u.id WHERE u.id = ? AND u.tenant_id = ? AND fus.federation_optin = 1 AND u.status = 'active'");
            $stmt->execute([$input['recipient_id'], $recipientTenantId]);
        } else {
            // FED-004: Check messaging_enabled on partnership to prevent bypass
            $stmt = $db->prepare("SELECT u.id, u.first_name, u.tenant_id, fus.messaging_enabled_federated FROM users u JOIN federation_user_settings fus ON fus.user_id = u.id JOIN federation_partnerships fp ON ((fp.tenant_id = ? AND fp.partner_tenant_id = u.tenant_id) OR (fp.partner_tenant_id = ? AND fp.tenant_id = u.tenant_id)) WHERE u.id = ? AND fus.federation_optin = 1 AND fp.status = 'active' AND fp.messaging_enabled = 1");
            $stmt->execute([$partnerTenantId, $partnerTenantId, $input['recipient_id']]);
        }

        $recipient = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$recipient) return $this->fedError(404, 'Recipient not found or not accessible', 'RECIPIENT_NOT_FOUND');
        if (!$recipient['messaging_enabled_federated']) return $this->fedError(403, 'Recipient does not accept federated messages', 'MESSAGES_DISABLED');

        if ($this->brokerMessageVisibilityService->isMessagingDisabledForUser((int) $input['sender_id'])) {
            return $this->fedError(403, 'Sender messaging privileges have been restricted', 'SENDER_RESTRICTED');
        }
        if ($this->brokerMessageVisibilityService->isMessagingDisabledForUser((int) $input['recipient_id'])) {
            return $this->fedError(403, 'Recipient is not currently accepting messages', 'RECIPIENT_UNAVAILABLE');
        }

        $recipientTenantId = (int) $recipient['tenant_id'];
        $safeguardingDecision = $isExternal
            ? app(SafeguardingInteractionPolicy::class)->evaluateExternalContact(
                (int) $input['recipient_id'],
                $recipientTenantId,
                'federation-v1:' . (string) ($auth['platform_id'] ?? 'external'),
                'federated_message_v1',
            )
            : app(SafeguardingInteractionPolicy::class)->evaluateCrossTenantContact(
                (int) $input['sender_id'],
                (int) $partnerTenantId,
                (int) $input['recipient_id'],
                $recipientTenantId,
                'federated_message_v1',
            );

        if (! $safeguardingDecision->isAllowed()) {
            $error = MessageService::buildSafeguardingError([
                'code' => $safeguardingDecision->code,
                'required_vetting_types' => $safeguardingDecision->requiredAttestationCodes,
                'required_vetting_labels' => $safeguardingDecision->requiredAttestationLabels,
            ]);

            return $this->fedError(
                $safeguardingDecision->isUnavailable() ? 503 : 403,
                (string) $error['message'],
                $safeguardingDecision->code,
            );
        }

        // FED-007: Sanitize external input to prevent stored XSS
        $sanitizedSubject = htmlspecialchars(substr($input['subject'], 0, 500), ENT_QUOTES, 'UTF-8');
        $sanitizedBody = htmlspecialchars(substr($input['body'], 0, 10000), ENT_QUOTES, 'UTF-8');

        $stmt = $db->prepare("INSERT INTO messages (tenant_id, sender_id, receiver_id, subject, body, is_federated, created_at) VALUES (?, ?, ?, ?, ?, 1, NOW())");
        $stmt->execute([$recipient['tenant_id'], $input['sender_id'], $input['recipient_id'], $sanitizedSubject, $sanitizedBody]);
        $messageId = $db->lastInsertId();

        // For external inbound messages, also insert into federation_messages so
        // the V2 federation messages page can display them alongside outbound messages.
        $senderName = htmlspecialchars($input['sender_name'] ?? 'A federation member', ENT_QUOTES, 'UTF-8');
        if ($isExternal) {
            // Find the external partner record for this inbound request.
            // Prefer matching by the authenticated API key's platform_id against
            // the external partner's name (deterministic) rather than guessing
            // based on last_sync_at ordering, which breaks with multiple partners.
            $externalPartnerId = null;
            $platformId = $auth['platform_id'] ?? null;

            if ($platformId) {
                $epRow = DB::selectOne(
                    "SELECT id FROM federation_external_partners WHERE tenant_id = ? AND status = 'active' AND name = ? LIMIT 1",
                    [(int) $recipient['tenant_id'], $platformId]
                );
                if ($epRow) {
                    $externalPartnerId = (int) $epRow->id;
                }
            }

            // Fallback: match by most recently synced active partner for this tenant
            if (!$externalPartnerId) {
                $epRow = DB::selectOne(
                    "SELECT id FROM federation_external_partners WHERE tenant_id = ? AND status = 'active' ORDER BY last_sync_at DESC, id DESC LIMIT 1",
                    [(int) $recipient['tenant_id']]
                );
                if ($epRow) $externalPartnerId = (int) $epRow->id;
            }

            try {
                DB::insert("
                    INSERT INTO federation_messages
                    (sender_tenant_id, sender_user_id, receiver_tenant_id, receiver_user_id,
                     subject, body, direction, status,
                     external_partner_id, external_receiver_name, external_message_id, created_at)
                    VALUES (0, ?, ?, ?, ?, ?, 'inbound', 'unread', ?, ?, ?, NOW())
                ", [
                    (int) $input['sender_id'],
                    (int) $recipient['tenant_id'], (int) $input['recipient_id'],
                    $sanitizedSubject, $sanitizedBody,
                    $externalPartnerId,
                    $senderName,
                    (int) $messageId,
                ]);
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning("FederationV1: federation_messages insert failed: " . $e->getMessage());
            }
        }

        $this->federationAuditService->log('api_message_sent', $partnerTenantId, $recipient['tenant_id'], null, ['message_id' => $messageId, 'recipient_id' => $input['recipient_id'], 'external_partner' => $isExternal]);

        // Non-blocking notifications
        $senderTenantName = 'Partner Timebank';
        try {
            if (!$isExternal) {
                $sRow = $db->prepare("SELECT u.name, u.first_name, u.last_name, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.id = ?");
                $sRow->execute([$input['sender_id']]);
                $sr = $sRow->fetch(\PDO::FETCH_ASSOC);
                if ($sr) { $senderName = $sr['name'] ?: UserDisplayName::resolve($sr); $senderTenantName = $sr['tenant_name'] ?: 'Partner Timebank'; }
            }
        } catch (\Exception $e) {
            \Log::warning('[Federation] sender name lookup failed', ['sender_id' => $input['sender_id'] ?? null, 'error' => $e->getMessage()]);
        }

        try {
            if (!$this->federationEmailService->sendNewMessageNotification((int) $input['recipient_id'], (int) $input['sender_id'], (int) $partnerTenantId, substr($input['body'], 0, 200), (int) $recipient['tenant_id'])) {
                \Illuminate\Support\Facades\Log::warning('FederationV1: email service returned false', [
                    'recipient_id' => $input['recipient_id'] ?? null,
                    'sender_id' => $input['sender_id'] ?? null,
                    'sender_tenant_id' => $partnerTenantId,
                ]);
            }
        } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning("FederationV1: email failed: " . $e->getMessage()); }
        try { $this->federationRealtimeService->broadcastNewMessage((int) $input['sender_id'], (int) $partnerTenantId, (int) $input['recipient_id'], (int) $recipient['tenant_id'], ['message_id' => (int) $messageId, 'sender_name' => $senderName, 'sender_tenant_name' => $senderTenantName, 'subject' => $sanitizedSubject, 'body' => $sanitizedBody]); } catch (\Exception $e) { \Log::warning('[Federation] broadcastNewMessage failed', ['error' => $e->getMessage()]); }
        try {
            // Render the federation-message bell under the recipient's
            // preferred_language — the federation API caller is an external
            // partner server and their locale carries no meaning here.
            $recipientUser = DB::table('users')
                ->where('id', (int) $input['recipient_id'])
                ->where('tenant_id', (int) $recipient['tenant_id'])
                ->select(['preferred_language'])
                ->first();

            LocaleContext::withLocale($recipientUser, function () use ($input, $senderName, $senderTenantName, $recipient) {
                $notifBody = __('notifications.federation.new_message', [
                    'sender' => $senderName,
                    'tenant' => $senderTenantName,
                    'subject' => substr($input['subject'], 0, 50),
                ]);
                Notification::createNotification((int) $input['recipient_id'], $notifBody, '/federation/messages', 'federation_message', true, (int) $recipient['tenant_id']);
                \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $input['recipient_id']), 'federation_message', $notifBody, '/federation/messages');
            });
        } catch (\Exception $e) {
            \Log::warning('[Federation] createNotification failed', ['recipient' => $input['recipient_id'] ?? null, 'error' => $e->getMessage()]);
        }

        return $this->fedSuccess(['message_id' => (int) $messageId, 'status' => 'sent'], 201);
    }

    /** POST /api/v1/federation/transactions */
    public function createTransaction(): JsonResponse
    {
        $auth = $this->fedAuth('transactions:write');
        if ($auth instanceof JsonResponse) return $auth;

        $partnerTenantId = $auth['tenant_id'];
        $isExternal = !empty($auth['platform_id']);
        $input = request()->json()->all();
        $db = DB::getPdo();

        foreach (['recipient_id', 'amount', 'description', 'sender_id'] as $field) {
            if (!isset($input[$field]) || $input[$field] === '') {
                return $this->fedError(400, "Missing required field: {$field}", 'VALIDATION_ERROR');
            }
        }

        // Prevent self-transactions
        if ((int) $input['sender_id'] === (int) $input['recipient_id']) {
            return $this->fedError(400, 'Cannot send a transaction to yourself', 'SELF_TRANSACTION');
        }

        $amount = (int) $input['amount'];
        if ($amount <= 0 || $amount > 100) {
            return $this->fedError(400, 'Amount must be between 1 and 100 whole hours', 'INVALID_AMOUNT');
        }
        if ((float) $input['amount'] != $amount) {
            return $this->fedError(400, 'Amount must be between 1 and 100 whole hours', 'INVALID_AMOUNT');
        }

        if ($isExternal) {
            $stmt = $db->prepare("SELECT u.id, u.first_name, u.tenant_id, fus.transactions_enabled_federated FROM users u JOIN federation_user_settings fus ON fus.user_id = u.id WHERE u.id = ? AND u.tenant_id = ? AND fus.federation_optin = 1 AND u.status = 'active'");
            $stmt->execute([$input['recipient_id'], $partnerTenantId]);
        } else {
            $stmt = $db->prepare("SELECT u.id, u.first_name, u.tenant_id, fus.transactions_enabled_federated FROM users u JOIN federation_user_settings fus ON fus.user_id = u.id JOIN federation_partnerships fp ON ((fp.tenant_id = ? AND fp.partner_tenant_id = u.tenant_id) OR (fp.partner_tenant_id = ? AND fp.tenant_id = u.tenant_id)) WHERE u.id = ? AND fus.federation_optin = 1 AND fp.status = 'active'");
            $stmt->execute([$partnerTenantId, $partnerTenantId, $input['recipient_id']]);
        }

        $recipient = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$recipient) return $this->fedError(404, 'Recipient not found or not accessible', 'RECIPIENT_NOT_FOUND');
        if (!$recipient['transactions_enabled_federated']) return $this->fedError(403, 'Recipient does not accept federated transactions', 'TRANSACTIONS_DISABLED');

        // Validate sender — skip for external partners (sender is on remote server)
        $senderId = (int) $input['sender_id'];
        if (!$isExternal) {
            $senderCheck = DB::selectOne(
                "SELECT u.id FROM users u
                 JOIN federation_user_settings fus ON fus.user_id = u.id
                 WHERE u.id = ? AND u.tenant_id = ? AND fus.federation_optin = 1 AND fus.transactions_enabled_federated = 1 AND u.status = 'active'",
                [$senderId, $partnerTenantId]
            );
            if (!$senderCheck) {
                return $this->fedError(403, 'Sender not found, not in your tenant, or has not opted into federation', 'SENDER_NOT_ELIGIBLE');
            }
        }

        $safeguardingDecision = $isExternal
            ? app(SafeguardingInteractionPolicy::class)->evaluateExternalContact(
                (int) $recipient['id'],
                (int) $recipient['tenant_id'],
                'v1-partner:' . (string) ($auth['platform_id'] ?? 'unknown') . ':sender:' . $senderId,
                'v1_federated_transaction',
            )
            : app(SafeguardingInteractionPolicy::class)->evaluateCrossTenantContact(
                $senderId,
                (int) $partnerTenantId,
                (int) $recipient['id'],
                (int) $recipient['tenant_id'],
                'v1_federated_transaction',
            );
        if (! $safeguardingDecision->isAllowed()) {
            $error = MessageService::buildSafeguardingError([
                'status' => $safeguardingDecision->status,
                'code' => $safeguardingDecision->code,
                'required_vetting_types' => $safeguardingDecision->requiredAttestationCodes,
                'required_vetting_labels' => $safeguardingDecision->requiredAttestationLabels,
                'can_request_coordinator' => $safeguardingDecision->canRequestCoordinator,
            ]);

            return $this->fedError(
                $safeguardingDecision->isUnavailable() ? 503 : 403,
                (string) $error['message'],
                $safeguardingDecision->code,
            );
        }

        // Idempotency check FIRST (before expensive partnership / credit-agreement
        // queries) so a partner spamming retries cannot DOS those lookups.
        // Accept a client-supplied idempotency_key; otherwise derive a deterministic
        // key from the request payload so identical retries are still de-duplicated.
        // Always hash to a fixed-width digest so two long client keys sharing a
        // common prefix cannot collide via truncation.
        $rawKey = isset($input['idempotency_key']) && is_string($input['idempotency_key'])
            ? $input['idempotency_key']
            : json_encode([
                $partnerTenantId,
                $senderId,
                (int) $recipient['id'],
                $amount,
                $input['description'] ?? '',
            ]);
        $clientKey = hash('sha256', $rawKey);
        $nonce = 'tx:' . $partnerTenantId . ':' . $clientKey; // 'tx:' + N + ':' + 64 hex = always < 128
        $partnerKeyId = $isExternal ? (int) ($auth['platform_id'] ?? 0) : 0;
        try {
            $inserted = DB::affectingStatement(
                "INSERT IGNORE INTO federation_webhook_nonces (partner_id, nonce, seen_at) VALUES (?, ?, NOW())",
                [$partnerKeyId, $nonce]
            );
            if ($inserted === 0) {
                return $this->fedError(409, 'Duplicate transaction (idempotency replay)', 'DUPLICATE_REQUEST');
            }
        } catch (\Throwable $e) {
            // Fail closed: if the dedup table is unavailable, refuse the
            // transaction rather than risk processing a duplicate. Money safety
            // outranks availability for federation transfers.
            \Illuminate\Support\Facades\Log::error('FederationV1::createTransaction idempotency check failed (fail-closed): ' . $e->getMessage());
            return $this->fedError(503, 'Idempotency service unavailable; please retry', 'IDEMPOTENCY_UNAVAILABLE');
        }

        // Fix 4: Check partnership level allows transactions
        if (!$isExternal) {
            $partnershipCheck = DB::selectOne(
                "SELECT id FROM federation_partnerships
                 WHERE ((tenant_id = ? AND partner_tenant_id = ?) OR (partner_tenant_id = ? AND tenant_id = ?))
                 AND status = 'active' AND (transactions_enabled = 1 OR federation_level >= 3)",
                [$partnerTenantId, $recipient['tenant_id'], $partnerTenantId, $recipient['tenant_id']]
            );
            if (!$partnershipCheck) {
                return $this->fedError(403, 'Partnership does not allow transactions', 'TRANSACTIONS_NOT_ALLOWED');
            }
        }

        // Fix 5: Enforce credit agreements between tenants
        $creditAgreement = DB::selectOne(
            "SELECT id FROM federation_credit_agreements
             WHERE ((from_tenant_id = ? AND to_tenant_id = ?) OR (from_tenant_id = ? AND to_tenant_id = ?))
             AND status = 'active'",
            [$partnerTenantId, $recipient['tenant_id'], $recipient['tenant_id'], $partnerTenantId]
        );
        if (!$creditAgreement) {
            return $this->fedError(403, 'No active credit agreement between tenants', 'NO_CREDIT_AGREEMENT');
        }

        // Fix 1: Wrap transaction creation in DB transaction for atomicity
        DB::beginTransaction();
        try {
            // Fix 2: Deduct sender balance (atomic double-spend prevention).
            // For external partners the sender lives on the remote server and has
            // no local row — skip the local deduction; the remote node is
            // responsible for debiting the remote sender. For internal partners
            // the sender was verified above to belong to $partnerTenantId, but
            // we re-assert it here so the atomic UPDATE cannot match a
            // coincidentally-id'd user in a different tenant.
            if (!$isExternal) {
                $deducted = DB::update(
                    "UPDATE users SET balance = balance - ? WHERE id = ? AND tenant_id = ? AND balance >= ?",
                    [$amount, $senderId, $partnerTenantId, $amount]
                );
                if ($deducted === 0) {
                    DB::rollBack();
                    return $this->fedError(400, 'Insufficient balance', 'INSUFFICIENT_BALANCE');
                }
            }

            // Use the validated recipient id from the authoritative SELECT above,
            // not the raw request body, to avoid TOCTOU drift.
            $validatedRecipientId = (int) $recipient['id'];
            $validatedRecipientTenantId = (int) $recipient['tenant_id'];

            $stmt = $db->prepare("INSERT INTO transactions (tenant_id, sender_id, receiver_id, amount, description, status, is_federated, sender_tenant_id, receiver_tenant_id, created_at) VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?, NOW())");
            $stmt->execute([$validatedRecipientTenantId, $senderId, $validatedRecipientId, $amount, $input['description'], $partnerTenantId, $validatedRecipientTenantId]);
            $transactionId = $db->lastInsertId();

            $status = 'pending';
            if ($isExternal) {
                $db->prepare("UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?")->execute([$amount, $validatedRecipientId, $validatedRecipientTenantId]);
                $db->prepare("UPDATE transactions SET status = 'completed' WHERE id = ?")->execute([$transactionId]);
                $status = 'completed';
            }

            DB::commit();
        } catch (\Exception $e) {
            DB::rollBack();
            \Illuminate\Support\Facades\Log::warning("FederationV1: transaction creation failed: " . $e->getMessage());
            return $this->fedError(500, 'Transaction creation failed', 'TRANSACTION_ERROR');
        }

        $this->federationAuditService->log('api_transaction_initiated', $partnerTenantId, $recipient['tenant_id'], null, ['transaction_id' => $transactionId, 'amount' => $amount, 'recipient_id' => $input['recipient_id'], 'external_partner' => $isExternal]);

        try {
            FederationEmailService::sendTransactionNotification(
                (int) $recipient['id'],
                $senderId,
                $partnerTenantId,
                (float) $amount,
                (string) $input['description'],
                (int) $recipient['tenant_id']
            );
        } catch (\Throwable $emailEx) {
            \Illuminate\Support\Facades\Log::warning('FederationV1::createTransaction email notification failed', [
                'transaction_id' => (int) $transactionId,
                'sender_tenant_id' => $partnerTenantId,
                'receiver_tenant_id' => (int) $recipient['tenant_id'],
                'external_partner' => $isExternal,
                'error' => $emailEx->getMessage(),
            ]);
        }

        return $this->fedSuccess(['transaction_id' => (int) $transactionId, 'status' => $status, 'amount' => $amount, 'note' => $status === 'completed' ? 'Transaction completed successfully' : 'Transaction requires recipient confirmation'], 201);
    }

    /** POST /api/v1/federation/reviews */
    public function createReview(): JsonResponse
    {
        $auth = $this->fedAuth('reviews:write');
        if ($auth instanceof JsonResponse) return $auth;

        $partnerTenantId = $auth['tenant_id'];
        $isExternal = !empty($auth['platform_id']);
        $input = request()->json()->all();
        $db = DB::getPdo();

        foreach (['reviewer_id', 'reviewee_id', 'rating'] as $field) {
            if (!isset($input[$field]) || $input[$field] === '') {
                return $this->fedError(400, "Missing required field: {$field}", 'VALIDATION_ERROR');
            }
        }

        // Prevent self-reviews
        if ((int) $input['reviewer_id'] === (int) $input['reviewee_id']) {
            return $this->fedError(400, 'Cannot review yourself', 'SELF_REVIEW');
        }

        $rating = (int) $input['rating'];
        if ($rating < 1 || $rating > 5) {
            return $this->fedError(400, 'Rating must be between 1 and 5', 'INVALID_RATING');
        }

        // Validate reviewer — skip for external partners (reviewer is on remote server)
        if (!$isExternal) {
            $reviewerCheck = DB::selectOne(
                "SELECT u.id FROM users u
                 JOIN federation_user_settings fus ON fus.user_id = u.id
                 WHERE u.id = ? AND u.tenant_id = ? AND fus.federation_optin = 1 AND u.status = 'active'",
                [(int) $input['reviewer_id'], $partnerTenantId]
            );
            if (!$reviewerCheck) {
                return $this->fedError(403, 'Reviewer not found, not in your tenant, or has not opted into federation', 'REVIEWER_NOT_ELIGIBLE');
            }
        }

        // Validate reviewee exists and has show_reviews_federated enabled
        if ($isExternal) {
            $stmt = $db->prepare("
                SELECT u.id, u.tenant_id, u.first_name, u.last_name, fus.show_reviews_federated
                FROM users u JOIN federation_user_settings fus ON fus.user_id = u.id
                WHERE u.id = ? AND u.tenant_id = ? AND fus.federation_optin = 1 AND u.status = 'active'
            ");
            $stmt->execute([(int) $input['reviewee_id'], $partnerTenantId]);
        } else {
            $stmt = $db->prepare("
                SELECT u.id, u.tenant_id, u.first_name, u.last_name, fus.show_reviews_federated
                FROM users u JOIN federation_user_settings fus ON fus.user_id = u.id
                JOIN federation_partnerships fp ON ((fp.tenant_id = ? AND fp.partner_tenant_id = u.tenant_id) OR (fp.partner_tenant_id = ? AND fp.tenant_id = u.tenant_id))
                WHERE u.id = ? AND fus.federation_optin = 1 AND fp.status = 'active' AND u.status = 'active'
            ");
            $stmt->execute([$partnerTenantId, $partnerTenantId, (int) $input['reviewee_id']]);
        }

        $reviewee = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$reviewee) {
            return $this->fedError(404, 'Reviewee not found or not accessible', 'REVIEWEE_NOT_FOUND');
        }
        if (!$reviewee['show_reviews_federated']) {
            return $this->fedError(403, 'Reviewee does not accept federated reviews', 'REVIEWS_DISABLED');
        }

        // Validate active partnership between the two tenants (non-external only)
        if (!$isExternal) {
            $partnershipCheck = DB::selectOne(
                "SELECT id FROM federation_partnerships
                 WHERE ((tenant_id = ? AND partner_tenant_id = ?) OR (partner_tenant_id = ? AND tenant_id = ?))
                 AND status = 'active'",
                [$partnerTenantId, $reviewee['tenant_id'], $partnerTenantId, $reviewee['tenant_id']]
            );
            if (!$partnershipCheck) {
                return $this->fedError(403, 'No active partnership between tenants', 'NO_PARTNERSHIP');
            }
        }

        $revieweeTenantId = (int) $reviewee['tenant_id'];
        $safeguardingDecision = $isExternal
            ? app(SafeguardingInteractionPolicy::class)->evaluateExternalContact(
                (int) $input['reviewee_id'],
                $revieweeTenantId,
                'federation-v1:' . (string) ($auth['platform_id'] ?? 'external')
                    . ':reviewer:' . (string) $input['reviewer_id'],
                'federated_review_v1',
            )
            : app(SafeguardingInteractionPolicy::class)->evaluateCrossTenantContact(
                (int) $input['reviewer_id'],
                (int) $partnerTenantId,
                (int) $input['reviewee_id'],
                $revieweeTenantId,
                'federated_review_v1',
            );

        if (! $safeguardingDecision->isAllowed()) {
            $error = MessageService::buildSafeguardingError([
                'status' => $safeguardingDecision->status,
                'code' => $safeguardingDecision->code,
                'required_vetting_types' => $safeguardingDecision->requiredAttestationCodes,
                'required_vetting_labels' => $safeguardingDecision->requiredAttestationLabels,
                'can_request_coordinator' => $safeguardingDecision->canRequestCoordinator,
            ]);

            return $this->fedError(
                $safeguardingDecision->isUnavailable() ? 503 : 403,
                (string) $error['message'],
                $safeguardingDecision->code,
            );
        }

        // Sanitize comment
        $comment = isset($input['comment']) ? htmlspecialchars(substr($input['comment'], 0, 5000), ENT_QUOTES, 'UTF-8') : null;
        $transactionId = isset($input['transaction_id']) ? (int) $input['transaction_id'] : null;

        $stmt = $db->prepare("
            INSERT INTO reviews (tenant_id, reviewer_id, reviewer_tenant_id, receiver_id, receiver_tenant_id, rating, comment, review_type, status, show_cross_tenant, transaction_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'federated', 'approved', 1, ?, NOW())
        ");
        $stmt->execute([
            $reviewee['tenant_id'],
            (int) $input['reviewer_id'],
            $partnerTenantId,
            (int) $input['reviewee_id'],
            (int) $reviewee['tenant_id'],
            $rating,
            $comment,
            $transactionId,
        ]);
        $reviewId = $db->lastInsertId();

        $this->federationAuditService->log('api_review_created', $partnerTenantId, (int) $reviewee['tenant_id'], null, [
            'review_id' => $reviewId,
            'reviewer_id' => (int) $input['reviewer_id'],
            'reviewee_id' => (int) $input['reviewee_id'],
            'rating' => $rating,
            'external_partner' => $isExternal,
        ]);

        // Notify reviewee of federated review in their preferred_language.
        // The federation API caller is an external partner server, so the
        // caller locale cannot represent the reviewee's preference here.
        try {
            $reviewerName = 'A member from another community';
            $revieweeUser = DB::table('users')
                ->where('id', (int) $input['reviewee_id'])
                ->where('tenant_id', (int) $reviewee['tenant_id'])
                ->select(['preferred_language'])
                ->first();

            LocaleContext::withLocale($revieweeUser, function () use ($input, $reviewerName, $rating, $reviewee) {
                \App\Models\Notification::createNotification(
                    (int) $input['reviewee_id'],
                    __('api_controllers_3.federation.review_received', ['name' => $reviewerName, 'rating' => $rating]),
                    '/reviews',
                    'review',
                    (int) $reviewee['tenant_id']
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $input['reviewee_id']), 'review', __('api_controllers_3.federation.review_received', ['name' => $reviewerName, 'rating' => $rating]), '/reviews');
            });
        } catch (\Throwable $e) {
            \Log::warning('[Federation] review notification failed', ['reviewee' => $input['reviewee_id'] ?? null, 'error' => $e->getMessage()]);
        }

        return $this->fedSuccess([
            'data' => [
                'id' => (int) $reviewId,
                'reviewer_id' => (int) $input['reviewer_id'],
                'reviewee_id' => (int) $input['reviewee_id'],
                'rating' => $rating,
                'comment' => $comment,
                'transaction_id' => $transactionId,
                'review_type' => 'federated',
                'status' => 'approved',
                'created_at' => date('Y-m-d H:i:s'),
            ],
        ], 201);
    }

    /** GET /api/v1/federation/reviews */
    public function getReviews(): JsonResponse
    {
        $auth = $this->fedAuth('reviews:read');
        if ($auth instanceof JsonResponse) return $auth;

        $partnerTenantId = $auth['tenant_id'];
        $isExternal = !empty($auth['platform_id']);
        $db = DB::getPdo();

        $userId = request()->query('user_id');
        if (empty($userId)) {
            return $this->fedError(400, 'Missing required parameter: user_id', 'VALIDATION_ERROR');
        }
        $userId = (int) $userId;

        $page = max(1, (int) request()->query('page', 1));
        $perPage = min(100, max(1, (int) request()->query('per_page', 20)));

        // Validate the user has show_reviews_federated enabled
        $userCheck = DB::selectOne(
            "SELECT u.id, fus.show_reviews_federated FROM users u JOIN federation_user_settings fus ON fus.user_id = u.id WHERE u.id = ? AND fus.federation_optin = 1 AND u.status = 'active'",
            [$userId]
        );
        if (!$userCheck || !$userCheck->show_reviews_federated) {
            return $this->fedError(404, 'User not found or federated reviews are disabled', 'USER_NOT_FOUND');
        }

        // Scope reviews to the calling partner's tenant — a partner can only read
        // reviews where the reviewer or receiver belongs to their tenant.
        $baseCondition = "FROM reviews r
                JOIN users u ON u.id = r.reviewer_id
                LEFT JOIN tenants t ON t.id = r.reviewer_tenant_id
                WHERE r.receiver_id = ? AND r.review_type = 'federated' AND r.show_cross_tenant = 1 AND r.status = 'approved'
                AND (r.reviewer_tenant_id = ? OR r.receiver_tenant_id = ?)";
        $params = [$userId, $partnerTenantId, $partnerTenantId];

        // COUNT query uses same WHERE conditions without LIMIT
        $countStmt = $db->prepare("SELECT COUNT(*) " . $baseCondition);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $sql = "SELECT r.id, r.reviewer_id, r.reviewer_tenant_id, r.receiver_id, r.receiver_tenant_id, r.rating, r.comment, r.review_type, r.status, r.transaction_id, r.created_at,
                       u.first_name as reviewer_first_name, u.last_name as reviewer_last_name,
 u.profile_type as reviewer_profile_type,
 u.organization_name as reviewer_organization_name, u.avatar_url as reviewer_avatar,
                       t.name as reviewer_tenant_name " . $baseCondition;
        $sql .= " ORDER BY r.created_at DESC LIMIT ?, ?";
        $paginatedParams = array_merge($params, [(int) (($page - 1) * $perPage), (int) $perPage]);

        $stmt = $db->prepare($sql);
        $stmt->execute($paginatedParams);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        $formatted = array_map(fn($r) => [
            'id' => (int) $r['id'],
            'rating' => (int) $r['rating'],
            'comment' => $r['comment'],
            'review_type' => $r['review_type'],
            'transaction_id' => $r['transaction_id'] ? (int) $r['transaction_id'] : null,
            'reviewer' => [
                'id' => (int) $r['reviewer_id'],
                'name' => UserDisplayName::resolvePrefixed($r, 'reviewer_'),
                'avatar' => $r['reviewer_avatar'] ?: null,
                'tenant_name' => $r['reviewer_tenant_name'] ?? null,
            ],
            'created_at' => $r['created_at'],
        ], $rows);

        return $this->fedPaginated($formatted, $total, $page, $perPage);
    }

    /** GET /api/v1/federation/messages */
    public function getMessages(): JsonResponse
    {
        $auth = $this->fedAuth('messages:read');
        if ($auth instanceof JsonResponse) return $auth;

        $partnerTenantId = $auth['tenant_id'];
        $db = DB::getPdo();

        $since = request()->query('since');
        $direction = request()->query('direction', 'all');
        $page = max(1, (int) request()->query('page', 1));
        $perPage = min(100, max(1, (int) request()->query('per_page', 20)));

        $baseCondition = "FROM messages m
                JOIN users su ON su.id = m.sender_id
                JOIN users ru ON ru.id = m.receiver_id
                JOIN federation_user_settings sfus ON sfus.user_id = m.sender_id
                JOIN federation_user_settings rfus ON rfus.user_id = m.receiver_id
                LEFT JOIN tenants st ON st.id = su.tenant_id
                LEFT JOIN tenants rt ON rt.id = ru.tenant_id
                WHERE m.is_federated = 1
                  AND sfus.federation_optin = 1
                  AND rfus.federation_optin = 1";
        $params = [];

        // Filter to messages involving the partner's tenant
        if ($direction === 'inbound') {
            $baseCondition .= " AND ru.tenant_id = ?";
            $params[] = $partnerTenantId;
        } elseif ($direction === 'outbound') {
            $baseCondition .= " AND su.tenant_id = ?";
            $params[] = $partnerTenantId;
        } else {
            $baseCondition .= " AND (su.tenant_id = ? OR ru.tenant_id = ?)";
            $params[] = $partnerTenantId;
            $params[] = $partnerTenantId;
        }

        if (!empty($since)) {
            $baseCondition .= " AND m.created_at >= ?";
            $params[] = $since;
        }

        // COUNT query uses same WHERE conditions without LIMIT
        $countStmt = $db->prepare("SELECT COUNT(*) " . $baseCondition);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $sql = "SELECT m.id, m.sender_id, m.receiver_id, m.subject, m.body, m.created_at, m.is_read,
                       su.first_name as sender_first_name, su.last_name as sender_last_name,
 su.profile_type as sender_profile_type,
 su.organization_name as sender_organization_name, su.tenant_id as sender_tenant_id,
                       ru.first_name as receiver_first_name, ru.last_name as receiver_last_name,
 ru.profile_type as receiver_profile_type,
 ru.organization_name as receiver_organization_name, ru.tenant_id as receiver_tenant_id,
                       st.name as sender_tenant_name, rt.name as receiver_tenant_name " . $baseCondition;
        $sql .= " ORDER BY m.created_at DESC LIMIT ?, ?";
        $paginatedParams = array_merge($params, [(int) (($page - 1) * $perPage), (int) $perPage]);

        $stmt = $db->prepare($sql);
        $stmt->execute($paginatedParams);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        $formatted = array_map(fn($m) => [
            'id' => (int) $m['id'],
            'subject' => $m['subject'],
            'body' => $m['body'],
            'sender' => [
                'id' => (int) $m['sender_id'],
                'name' => UserDisplayName::resolvePrefixed($m, 'sender_'),
                'tenant_id' => (int) $m['sender_tenant_id'],
                'tenant_name' => $m['sender_tenant_name'] ?? null,
            ],
            'receiver' => [
                'id' => (int) $m['receiver_id'],
                'name' => UserDisplayName::resolvePrefixed($m, 'receiver_'),
                'tenant_id' => (int) $m['receiver_tenant_id'],
                'tenant_name' => $m['receiver_tenant_name'] ?? null,
            ],
            'is_read' => (bool) $m['is_read'],
            'created_at' => $m['created_at'],
        ], $rows);

        return $this->fedPaginated($formatted, $total, $page, $perPage);
    }

    /** GET /api/v1/federation/transactions/{id} */
    public function getTransaction($id): JsonResponse
    {
        $auth = $this->fedAuth('transactions:read');
        if ($auth instanceof JsonResponse) return $auth;

        $partnerTenantId = $auth['tenant_id'];
        $db = DB::getPdo();

        $stmt = $db->prepare("
            SELECT t.id, t.amount, t.status, t.description, t.created_at, t.is_federated,
                   t.sender_id, t.receiver_id, t.sender_tenant_id, t.receiver_tenant_id,
                   su.first_name as sender_first_name, su.last_name as sender_last_name,
 su.profile_type as sender_profile_type,
 su.organization_name as sender_organization_name,
                   ru.first_name as receiver_first_name, ru.last_name as receiver_last_name,
 ru.profile_type as receiver_profile_type,
 ru.organization_name as receiver_organization_name,
                   st.name as sender_tenant_name, rt.name as receiver_tenant_name
            FROM transactions t
            JOIN users su ON su.id = t.sender_id
            JOIN users ru ON ru.id = t.receiver_id
            LEFT JOIN tenants st ON st.id = t.sender_tenant_id
            LEFT JOIN tenants rt ON rt.id = t.receiver_tenant_id
            WHERE t.id = ? AND t.is_federated = 1
            AND (t.sender_tenant_id = ? OR t.receiver_tenant_id = ?)
        ");
        $stmt->execute([(int) $id, $partnerTenantId, $partnerTenantId]);

        $transaction = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$transaction) {
            return $this->fedError(404, 'Transaction not found or not accessible', 'TRANSACTION_NOT_FOUND');
        }

        return $this->fedSuccess(['data' => [
            'id' => (int) $transaction['id'],
            'amount' => (float) $transaction['amount'],
            'status' => $transaction['status'],
            'description' => $transaction['description'],
            'sender' => [
                'id' => (int) $transaction['sender_id'],
                'name' => UserDisplayName::resolvePrefixed($transaction, 'sender_'),
                'tenant_id' => $transaction['sender_tenant_id'] ? (int) $transaction['sender_tenant_id'] : null,
                'tenant_name' => $transaction['sender_tenant_name'] ?? null,
            ],
            'receiver' => [
                'id' => (int) $transaction['receiver_id'],
                'name' => UserDisplayName::resolvePrefixed($transaction, 'receiver_'),
                'tenant_id' => $transaction['receiver_tenant_id'] ? (int) $transaction['receiver_tenant_id'] : null,
                'tenant_name' => $transaction['receiver_tenant_name'] ?? null,
            ],
            'created_at' => $transaction['created_at'],
        ]]);
    }

    /** POST /api/v1/federation/oauth/token */
    public function oauthToken(): JsonResponse
    {
        CorsHelper::handlePreflight([], ['POST', 'OPTIONS'], ['Content-Type', 'Authorization']);
        CorsHelper::setHeaders([], ['POST', 'OPTIONS'], ['Content-Type', 'Authorization']);

        $result = $this->federationJwtService->handleTokenRequest();

        if (isset($result['error'])) {
            return response()->json($result, 400);
        }

        return response()->json($result, 200)->withHeaders([
            'Cache-Control' => 'no-store',
            'Pragma' => 'no-cache',
        ]);
    }

    /** POST /api/v1/federation/test-webhook */
    public function testWebhook(): JsonResponse
    {
        $platformId = request()->header('X-Federation-Platform-Id', '');
        $timestamp = request()->header('X-Federation-Timestamp', '');
        $signature = request()->header('X-Federation-Signature', '');

        if (empty($platformId) || empty($timestamp) || empty($signature)) {
            return $this->fedError(400, 'Missing required headers', 'MISSING_HEADERS');
        }

        $requestTime = strtotime($timestamp);
        if ($requestTime === false) {
            $requestTime = is_numeric($timestamp) ? (int) $timestamp : null;
            if ($requestTime === null) return $this->fedError(400, 'Invalid timestamp format', 'INVALID_TIMESTAMP');
        }

        $timeDiff = abs(time() - $requestTime);
        if ($timeDiff > 300) return $this->fedError(401, 'Timestamp expired (max 5 minutes)', 'TIMESTAMP_EXPIRED');

        $db = DB::getPdo();
        $stmt = $db->prepare("SELECT id, name, signing_secret, platform_id FROM federation_api_keys WHERE platform_id = ? AND status = 'active'");
        $stmt->execute([$platformId]);
        $partner = $stmt->fetch(\PDO::FETCH_ASSOC);

        if (!$partner) return $this->fedError(404, 'Platform not found', 'PLATFORM_NOT_FOUND');
        if (empty($partner['signing_secret'])) return $this->fedError(400, 'HMAC signing not configured for this platform', 'SIGNING_NOT_CONFIGURED');

        $method = request()->method();
        $path = request()->getRequestUri();
        $body = request()->getContent() ?: '';
        $stringToSign = implode("\n", [$method, $path, $timestamp, $body]);
        $expectedSignature = hash_hmac('sha256', $stringToSign, $partner['signing_secret']);
        $signatureValid = hash_equals($expectedSignature, $signature);

        if (!$signatureValid) {
            return $this->fedError(401, 'Signature verification failed', 'SIGNATURE_INVALID');
        }

        return $this->fedSuccess([
            'valid' => true, 'message' => __('api_controllers_1.federation.signature_verified'),
            'platform' => ['id' => $partner['platform_id'], 'name' => $partner['name']],
            'timestamp_age_seconds' => $timeDiff,
        ]);
    }

    // =====================================================================
    // PRIVATE HELPERS
    // =====================================================================

    private function mapActivityType(string $rawType): string
    {
        return ['message' => 'message_received', 'transaction' => 'transaction_received', 'new_partner' => 'partnership_approved'][$rawType] ?? 'member_joined';
    }

    /**
     * Authenticate federation API request. Returns partner array on success, JsonResponse on failure.
     *
     * FederationApiMiddleware::authenticate() returns true on success or a JsonResponse on failure.
     *
     * @return array|JsonResponse
     */
    private function fedAuth(string $permission): array|JsonResponse
    {
        try {
            $result = FederationApiMiddleware::authenticate();
        } catch (\Throwable $e) {
            return $this->fedError(500, 'Authentication error', 'AUTH_ERROR');
        }

        // authenticate() returns a JsonResponse on failure
        if ($result instanceof \Illuminate\Http\JsonResponse) {
            return $result;
        }

        if (!$result) {
            return $this->fedError(401, 'Authentication failed', 'AUTH_FAILED');
        }

        // Check permission
        if (!FederationApiMiddleware::hasPermission($permission)) {
            return $this->fedError(403, "Permission denied for: {$permission}", 'PERMISSION_DENIED');
        }

        return FederationApiMiddleware::getPartner();
    }

    /** Federation API error response */
    private function fedError(int $status, string $message, string $code): JsonResponse
    {
        return response()->json(['error' => true, 'code' => $code, 'message' => $message, 'timestamp' => date('c')], $status);
    }

    /** Federation API success response */
    private function fedSuccess(array $data, int $status = 200): JsonResponse
    {
        return response()->json(array_merge(['success' => true, 'timestamp' => date('c')], $data), $status);
    }

    /** Federation API paginated response */
    private function fedPaginated(array $items, int $total, int $page, int $perPage): JsonResponse
    {
        $totalPages = (int) ceil($total / $perPage);
        return $this->fedSuccess([
            'data' => $items,
            'pagination' => ['total' => $total, 'page' => $page, 'per_page' => $perPage, 'total_pages' => $totalPages, 'has_more' => $page < $totalPages],
        ]);
    }
}
