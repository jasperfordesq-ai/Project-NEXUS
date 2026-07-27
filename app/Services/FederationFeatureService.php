<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * FederationFeatureService — Manages feature toggles for the federation system
 * at both system and tenant level.
 */
class FederationFeatureService
{
    /** System-level constants */
    public const SYSTEM_FEDERATION_ENABLED = 'system_federation_enabled';
    public const SYSTEM_WHITELIST_MODE = 'system_whitelist_mode';
    public const SYSTEM_EMERGENCY_LOCKDOWN = 'system_emergency_lockdown';
    public const SYSTEM_MAX_FEDERATION_LEVEL = 'system_max_federation_level';
    public const SYSTEM_PROFILES_ENABLED = 'system_cross_tenant_profiles';
    public const SYSTEM_MESSAGING_ENABLED = 'system_cross_tenant_messaging';
    public const SYSTEM_TRANSACTIONS_ENABLED = 'system_cross_tenant_transactions';
    public const SYSTEM_LISTINGS_ENABLED = 'system_cross_tenant_listings';
    public const SYSTEM_EVENTS_ENABLED = 'system_cross_tenant_events';
    public const SYSTEM_GROUPS_ENABLED = 'system_cross_tenant_groups';

    /** Tenant-level constants */
    public const TENANT_FEDERATION_ENABLED = 'tenant_federation_enabled';
    public const TENANT_APPEAR_IN_DIRECTORY = 'tenant_appear_in_directory';
    public const TENANT_AUTO_ACCEPT_HIERARCHY = 'tenant_auto_accept_hierarchy';
    public const TENANT_PROFILES_ENABLED = 'tenant_profiles_enabled';
    public const TENANT_MESSAGING_ENABLED = 'tenant_messaging_enabled';
    public const TENANT_TRANSACTIONS_ENABLED = 'tenant_transactions_enabled';
    public const TENANT_LISTINGS_ENABLED = 'tenant_listings_enabled';
    public const TENANT_EVENTS_ENABLED = 'tenant_events_enabled';
    public const TENANT_GROUPS_ENABLED = 'tenant_groups_enabled';

    /**
     * External protocol constants.
     *
     * These name traffic exchanged with OTHER installations, as opposed to the
     * SYSTEM_/TENANT_ constants above which gate cross-tenant federation
     * between tenants inside this install.
     */
    public const EXTERNAL_PROTOCOL_NEXUS = 'nexus';
    public const EXTERNAL_PROTOCOL_KOMUNITIN = 'komunitin';
    public const EXTERNAL_PROTOCOL_CREDIT_COMMONS = 'credit_commons';
    public const EXTERNAL_PROTOCOL_LEGACY_V1 = 'legacy_v1';
    public const EXTERNAL_PROTOCOL_WEBHOOKS = 'webhooks';
    public const EXTERNAL_PROTOCOL_HOUR_TRANSFER = 'hour_transfer';
    public const EXTERNAL_PROTOCOL_AGGREGATES = 'aggregates';

    /**
     * Protocol name => `federation_system_control` column.
     *
     * @var array<string, string>
     */
    private const EXTERNAL_PROTOCOL_COLUMNS = [
        self::EXTERNAL_PROTOCOL_NEXUS => 'external_protocol_nexus_enabled',
        self::EXTERNAL_PROTOCOL_KOMUNITIN => 'external_protocol_komunitin_enabled',
        self::EXTERNAL_PROTOCOL_CREDIT_COMMONS => 'external_protocol_credit_commons_enabled',
        self::EXTERNAL_PROTOCOL_LEGACY_V1 => 'external_protocol_legacy_v1_enabled',
        self::EXTERNAL_PROTOCOL_WEBHOOKS => 'external_protocol_webhooks_enabled',
        self::EXTERNAL_PROTOCOL_HOUR_TRANSFER => 'external_protocol_hour_transfer_enabled',
        self::EXTERNAL_PROTOCOL_AGGREGATES => 'external_protocol_aggregates_enabled',
    ];

    /** In-process caches */
    private ?array $systemControlCache = null;
    private array $tenantFeatureCache = [];
    private array $whitelistCache = [];
    private ?array $externalControlCache = null;

    public function __construct(
        private readonly FederationAuditService $auditService,
    ) {}

    // =========================================================================
    // SYSTEM-LEVEL CONTROLS
    // =========================================================================

    /**
     * Get all system-level federation controls.
     */
    public function getSystemControls(): array
    {
        if ($this->systemControlCache !== null) {
            return $this->systemControlCache;
        }

        try {
            $result = DB::table('federation_system_control')->where('id', 1)->first();

            if (!$result) {
                $this->initializeSystemDefaults();
                $result = DB::table('federation_system_control')->where('id', 1)->first();
            }

            $this->systemControlCache = $result ? (array) $result : $this->getSystemDefaults();
            return $this->systemControlCache;
        } catch (\Exception $e) {
            Log::error('FederationFeatureService: Failed to get system controls - ' . $e->getMessage());
            return $this->getSystemDefaults();
        }
    }

    /**
     * Check if federation is globally enabled (master switch).
     */
    public function isGloballyEnabled(): bool
    {
        $controls = $this->getSystemControls();

        if (!empty($controls['emergency_lockdown_active'])) {
            return false;
        }

        return !empty($controls['federation_enabled']);
    }

    /**
     * Check if whitelist mode is active.
     */
    public function isWhitelistModeActive(): bool
    {
        $controls = $this->getSystemControls();
        return !empty($controls['whitelist_mode_enabled']);
    }

    /**
     * Check if a tenant is whitelisted for federation.
     */
    public function isTenantWhitelisted(int $tenantId): bool
    {
        if (!$this->isWhitelistModeActive()) {
            return true;
        }

        if (isset($this->whitelistCache[$tenantId])) {
            return $this->whitelistCache[$tenantId];
        }

        try {
            $result = DB::table('federation_tenant_whitelist')
                ->where('tenant_id', $tenantId)
                ->exists();

            $this->whitelistCache[$tenantId] = $result;
            return $result;
        } catch (\Exception $e) {
            Log::error('FederationFeatureService: Failed to check whitelist - ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Check if a system-level feature is enabled.
     */
    public function isSystemFeatureEnabled(string $feature): bool
    {
        $controls = $this->getSystemControls();

        $columnMap = [
            self::SYSTEM_PROFILES_ENABLED => 'cross_tenant_profiles_enabled',
            self::SYSTEM_MESSAGING_ENABLED => 'cross_tenant_messaging_enabled',
            self::SYSTEM_TRANSACTIONS_ENABLED => 'cross_tenant_transactions_enabled',
            self::SYSTEM_LISTINGS_ENABLED => 'cross_tenant_listings_enabled',
            self::SYSTEM_EVENTS_ENABLED => 'cross_tenant_events_enabled',
            self::SYSTEM_GROUPS_ENABLED => 'cross_tenant_groups_enabled',
        ];

        $column = $columnMap[$feature] ?? null;
        if (!$column) {
            return false;
        }

        return !empty($controls[$column]);
    }

    /**
     * Get maximum allowed federation level.
     */
    public function getMaxFederationLevel(): int
    {
        $controls = $this->getSystemControls();
        return (int) ($controls['max_federation_level'] ?? 0);
    }

    // =========================================================================
    // EXTERNAL PARTNER PROTOCOL CONTROLS
    // =========================================================================

    /**
     * Read the external-protocol columns, failing CLOSED.
     *
     * Deliberately does NOT route through getSystemControls()/getSystemDefaults():
     * those fail OPEN (a missing row or DB error yields federation_enabled = 1)
     * so that a transient fault cannot silently sever working internal
     * cross-tenant federation. External protocol traffic has the opposite
     * risk profile — an unaudited protocol answering partners during a fault
     * is worse than downtime — so a missing row, a missing column, or any
     * exception here resolves to "blocked".
     *
     * @return array<string, int>
     */
    private function getExternalControls(): array
    {
        if ($this->externalControlCache !== null) {
            return $this->externalControlCache;
        }

        $closed = ['external_federation_enabled' => 0];
        foreach (self::EXTERNAL_PROTOCOL_COLUMNS as $column) {
            $closed[$column] = 0;
        }
        $closed['external_federation_disabled_reason'] = null;

        try {
            $row = DB::table('federation_system_control')->where('id', 1)->first();
            if (! $row) {
                return $this->externalControlCache = $closed;
            }

            $row = (array) $row;
            $resolved = $closed;
            foreach (array_keys($closed) as $key) {
                if (! array_key_exists($key, $row)) {
                    // Column absent (migration not yet run) — stay closed.
                    continue;
                }
                $resolved[$key] = $key === 'external_federation_disabled_reason'
                    ? ($row[$key] !== null ? (string) $row[$key] : null)
                    : (int) (bool) $row[$key];
            }

            return $this->externalControlCache = $resolved;
        } catch (\Throwable $e) {
            // \Throwable, not \Exception: a TypeError or Error here must also
            // resolve to "blocked". Not cached, so a transient fault does not
            // pin the gate closed for the rest of the request.
            Log::error('FederationFeatureService: Failed to read external federation controls, failing closed - ' . $e->getMessage());
            return $closed;
        }
    }

    /**
     * Master switch for all traffic to/from OTHER installations.
     *
     * Nested under the platform master switch, so `federation_enabled = 0` or
     * an active emergency lockdown also blocks every external protocol.
     */
    public function isExternalFederationEnabled(): bool
    {
        if (! $this->isGloballyEnabled()) {
            return false;
        }

        return (bool) ($this->getExternalControls()['external_federation_enabled'] ?? 0);
    }

    /**
     * Check whether one external protocol may exchange traffic.
     *
     * Unknown protocol names resolve to false so a typo cannot open a hole.
     */
    public function isExternalProtocolEnabled(string $protocol): bool
    {
        $column = self::EXTERNAL_PROTOCOL_COLUMNS[$protocol] ?? null;
        if ($column === null) {
            Log::warning('FederationFeatureService: Unknown external federation protocol, failing closed', [
                'protocol' => $protocol,
            ]);
            return false;
        }

        if (! $this->isExternalFederationEnabled()) {
            return false;
        }

        return (bool) ($this->getExternalControls()[$column] ?? 0);
    }

    /**
     * Snapshot of the external switch state, for the super-admin UI and diagnostics.
     *
     * @return array{
     *     platform_enabled: bool,
     *     master_enabled: bool,
     *     effective: bool,
     *     emergency_lockdown_active: bool,
     *     reason: ?string,
     *     protocols: array<string, bool>
     * }
     */
    public function externalProtocolStatus(): array
    {
        $controls = $this->getExternalControls();
        $systemControls = $this->getSystemControls();

        $protocols = [];
        foreach (array_keys(self::EXTERNAL_PROTOCOL_COLUMNS) as $protocol) {
            $protocols[$protocol] = $this->isExternalProtocolEnabled($protocol);
        }

        return [
            'platform_enabled' => $this->isGloballyEnabled(),
            'master_enabled' => (bool) ($controls['external_federation_enabled'] ?? 0),
            'effective' => $this->isExternalFederationEnabled(),
            'emergency_lockdown_active' => (bool) ($systemControls['emergency_lockdown_active'] ?? 0),
            'reason' => $controls['external_federation_disabled_reason'] ?? null,
            'protocols' => $protocols,
        ];
    }

    /**
     * All supported external protocol names.
     *
     * @return array<int, string>
     */
    public static function externalProtocolNames(): array
    {
        return array_keys(self::EXTERNAL_PROTOCOL_COLUMNS);
    }

    /**
     * Map an external protocol name to its control column.
     */
    public static function externalProtocolColumn(string $protocol): ?string
    {
        return self::EXTERNAL_PROTOCOL_COLUMNS[$protocol] ?? null;
    }

    /**
     * Resolve a request path to its external protocol, or null when the path is
     * not an external federation surface.
     *
     * Routes carry their protocol explicitly via the `federation.external:<p>`
     * middleware parameter; this prefix map exists only as a backstop so a
     * future route added under an existing external prefix is still gated if
     * someone forgets that middleware. Callers must treat null as "not an
     * external surface" and NOT as "allowed".
     */
    public static function protocolForInboundPath(string $path): ?string
    {
        // Request::path() omits the leading slash and includes the api/ prefix.
        $normalised = '/' . ltrim($path, '/');
        if (str_starts_with($normalised, '/api/')) {
            $normalised = substr($normalised, 4);
        }

        $prefixes = [
            '/v2/federation/komunitin/' => self::EXTERNAL_PROTOCOL_KOMUNITIN,
            '/v2/federation/cc/' => self::EXTERNAL_PROTOCOL_CREDIT_COMMONS,
            '/v2/federation/ingest/' => self::EXTERNAL_PROTOCOL_NEXUS,
            '/v2/federation/external/webhooks/' => self::EXTERNAL_PROTOCOL_WEBHOOKS,
            '/v2/federation/hour-transfer/' => self::EXTERNAL_PROTOCOL_HOUR_TRANSFER,
            '/v2/federation/aggregates' => self::EXTERNAL_PROTOCOL_AGGREGATES,
            '/v1/federation' => self::EXTERNAL_PROTOCOL_LEGACY_V1,
        ];

        foreach ($prefixes as $prefix => $protocol) {
            if (str_starts_with($normalised, $prefix)) {
                return $protocol;
            }
        }

        return null;
    }

    /**
     * Map `federation_external_partners.protocol_type` to a switch protocol.
     *
     * Returns null for an unknown or missing type so outbound callers fail
     * closed rather than guessing. TimeOverflow partners exchange traffic over
     * the webhook surface, so they share that protocol's switch.
     */
    public static function protocolForPartnerType(?string $protocolType): ?string
    {
        return match ($protocolType) {
            'nexus' => self::EXTERNAL_PROTOCOL_NEXUS,
            'komunitin' => self::EXTERNAL_PROTOCOL_KOMUNITIN,
            'credit_commons' => self::EXTERNAL_PROTOCOL_CREDIT_COMMONS,
            'timeoverflow' => self::EXTERNAL_PROTOCOL_WEBHOOKS,
            default => null,
        };
    }

    /**
     * Toggle the external federation master switch.
     */
    public function setExternalFederation(bool $enabled, int $adminId, ?string $reason = null): bool
    {
        try {
            DB::table('federation_system_control')->where('id', 1)->update([
                'external_federation_enabled' => $enabled ? 1 : 0,
                'external_federation_disabled_reason' => $enabled ? null : $reason,
                'external_federation_updated_at' => now(),
                'external_federation_updated_by' => $adminId,
                'updated_at' => now(),
                'updated_by' => $adminId,
            ]);

            $this->clearCache();

            $this->auditService->log(
                $enabled ? 'external_federation_enabled' : 'external_federation_disabled',
                null, null, $adminId,
                ['reason' => $reason],
                'critical'
            );

            return true;
        } catch (\Exception $e) {
            Log::error('FederationFeatureService: Failed to set external federation switch - ' . $e->getMessage());
            return false;
        }
    }

    // =========================================================================
    // TENANT-LEVEL CONTROLS
    // =========================================================================

    /**
     * Check if federation is enabled for a specific tenant.
     */
    public function isTenantFederationEnabled(?int $tenantId = null): bool
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        try {
            $exists = DB::table('tenants')->where('id', $tenantId)->exists();
            if (!$exists) {
                return false;
            }
        } catch (\Exception $e) {
            Log::warning('[FederationFeature] isTenantFederationEnabled DB check failed: ' . $e->getMessage());
            return false;
        }

        if (!$this->isGloballyEnabled()) {
            return false;
        }

        if (!$this->isTenantWhitelisted($tenantId)) {
            return false;
        }

        return $this->isTenantFeatureEnabled(self::TENANT_FEDERATION_ENABLED, $tenantId);
    }

    /**
     * Check if a tenant-level feature is enabled.
     */
    public function isTenantFeatureEnabled(string $feature, ?int $tenantId = null): bool
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        // Check parent feature first (for non-main features)
        if ($feature !== self::TENANT_FEDERATION_ENABLED) {
            if (!$this->isTenantFeatureEnabled(self::TENANT_FEDERATION_ENABLED, $tenantId)) {
                return false;
            }
        }

        $cacheKey = "{$tenantId}:{$feature}";
        if (isset($this->tenantFeatureCache[$cacheKey])) {
            return $this->tenantFeatureCache[$cacheKey];
        }

        try {
            $result = DB::table('federation_tenant_features')
                ->where('tenant_id', $tenantId)
                ->where('feature_key', $feature)
                ->first();

            if ($result) {
                $enabled = (bool) $result->is_enabled;
            } else {
                $enabled = $this->getTenantFeatureDefault($feature);
            }

            $this->tenantFeatureCache[$cacheKey] = $enabled;
            return $enabled;
        } catch (\Exception $e) {
            Log::error('FederationFeatureService: Failed to check tenant feature - ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Enable a federation feature for a tenant.
     */
    public function enableTenantFeature(string $feature, ?int $tenantId = null): bool
    {
        return $this->setTenantFeature($feature, true, $tenantId);
    }

    /**
     * Disable a federation feature for a tenant.
     */
    public function disableTenantFeature(string $feature, ?int $tenantId = null): bool
    {
        return $this->setTenantFeature($feature, false, $tenantId);
    }

    /**
     * Get all tenant features with their states.
     */
    public function getAllTenantFeatures(?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        $definitions = $this->getTenantFeatureDefinitions();
        $features = [];

        try {
            $results = DB::table('federation_tenant_features')
                ->where('tenant_id', $tenantId)
                ->get();

            $stored = [];
            foreach ($results as $row) {
                $stored[$row->feature_key] = (bool) $row->is_enabled;
            }

            foreach ($definitions as $key => $definition) {
                $features[$key] = [
                    'enabled' => $stored[$key] ?? $definition['default'],
                    'label_code' => $definition['label_code'],
                    'description_code' => $definition['description_code'],
                    'category' => $definition['category'],
                    'requires_system' => $definition['requires_system'] ?? null,
                ];

                if (!empty($definition['requires_system'])) {
                    $features[$key]['system_enabled'] = $this->isSystemFeatureEnabled($definition['requires_system']);
                    if (!$features[$key]['system_enabled']) {
                        $features[$key]['blocked_reason_code'] = 'system_feature_disabled';
                    }
                }
            }

            return $features;
        } catch (\Exception $e) {
            Log::error('FederationFeatureService: Failed to get tenant features - ' . $e->getMessage());
            return [];
        }
    }

    // =========================================================================
    // COMPREHENSIVE CHECK
    // =========================================================================

    /**
     * Check if a specific federation operation is allowed.
     *
     * @param string $operation One of: profiles, messaging, transactions, listings, events, groups
     */
    public function isOperationAllowed(string $operation, ?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        try {
            $exists = DB::table('tenants')->where('id', $tenantId)->exists();
            if (!$exists) {
                return ['allowed' => false, 'reason' => 'Tenant does not exist', 'level' => 'invalid'];
            }
        } catch (\Exception $e) {
            return ['allowed' => false, 'reason' => 'Unable to verify tenant', 'level' => 'error'];
        }

        $controls = $this->getSystemControls();
        if (!empty($controls['emergency_lockdown_active'])) {
            return ['allowed' => false, 'reason' => 'Federation is in emergency lockdown', 'level' => 'emergency'];
        }

        if (empty($controls['federation_enabled'])) {
            return ['allowed' => false, 'reason' => 'Federation is globally disabled', 'level' => 'system'];
        }

        if (!$this->isTenantWhitelisted($tenantId)) {
            return ['allowed' => false, 'reason' => 'Tenant not approved for federation', 'level' => 'whitelist'];
        }

        $systemFeatureMap = [
            'profiles' => self::SYSTEM_PROFILES_ENABLED,
            'messaging' => self::SYSTEM_MESSAGING_ENABLED,
            'transactions' => self::SYSTEM_TRANSACTIONS_ENABLED,
            'listings' => self::SYSTEM_LISTINGS_ENABLED,
            'events' => self::SYSTEM_EVENTS_ENABLED,
            'groups' => self::SYSTEM_GROUPS_ENABLED,
        ];
        $systemFeature = $systemFeatureMap[$operation] ?? null;
        if ($systemFeature && !$this->isSystemFeatureEnabled($systemFeature)) {
            return ['allowed' => false, 'reason' => "Cross-tenant {$operation} is disabled at system level", 'level' => 'system_feature'];
        }

        if (!$this->isTenantFeatureEnabled(self::TENANT_FEDERATION_ENABLED, $tenantId)) {
            return ['allowed' => false, 'reason' => 'Federation is disabled for this tenant', 'level' => 'tenant'];
        }

        $tenantFeatureMap = [
            'profiles' => self::TENANT_PROFILES_ENABLED,
            'messaging' => self::TENANT_MESSAGING_ENABLED,
            'transactions' => self::TENANT_TRANSACTIONS_ENABLED,
            'listings' => self::TENANT_LISTINGS_ENABLED,
            'events' => self::TENANT_EVENTS_ENABLED,
            'groups' => self::TENANT_GROUPS_ENABLED,
        ];
        $tenantFeature = $tenantFeatureMap[$operation] ?? null;
        if ($tenantFeature && !$this->isTenantFeatureEnabled($tenantFeature, $tenantId)) {
            return ['allowed' => false, 'reason' => "Cross-tenant {$operation} is disabled for this tenant", 'level' => 'tenant_feature'];
        }

        return ['allowed' => true, 'reason' => null];
    }

    // =========================================================================
    // EMERGENCY CONTROLS
    // =========================================================================

    /**
     * Trigger emergency lockdown.
     */
    public function triggerEmergencyLockdown(int $adminId, string $reason): bool
    {
        try {
            DB::table('federation_system_control')->where('id', 1)->update([
                'emergency_lockdown_active' => 1,
                'emergency_lockdown_reason' => $reason,
                'emergency_lockdown_at' => now(),
                'emergency_lockdown_by' => $adminId,
                'updated_at' => now(),
                'updated_by' => $adminId,
            ]);

            $this->clearCache();

            $this->auditService->log(
                'emergency_lockdown_triggered',
                null, null, $adminId,
                ['reason' => $reason],
                'critical'
            );

            return true;
        } catch (\Exception $e) {
            Log::error('FederationFeatureService: Failed to trigger emergency lockdown - ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Lift emergency lockdown.
     */
    public function liftEmergencyLockdown(int $adminId): bool
    {
        try {
            DB::table('federation_system_control')->where('id', 1)->update([
                'emergency_lockdown_active' => 0,
                'updated_at' => now(),
                'updated_by' => $adminId,
            ]);

            $this->clearCache();

            $this->auditService->log(
                'emergency_lockdown_lifted',
                null, null, $adminId,
                [],
                'critical'
            );

            return true;
        } catch (\Exception $e) {
            Log::error('FederationFeatureService: Failed to lift emergency lockdown - ' . $e->getMessage());
            return false;
        }
    }

    // =========================================================================
    // WHITELIST MANAGEMENT
    // =========================================================================

    /**
     * Add tenant to whitelist.
     */
    public function addToWhitelist(int $tenantId, int $adminId, ?string $notes = null): bool
    {
        try {
            DB::statement(
                "INSERT INTO federation_tenant_whitelist (tenant_id, approved_at, approved_by, notes)
                 VALUES (?, NOW(), ?, ?)
                 ON DUPLICATE KEY UPDATE approved_at = NOW(), approved_by = ?, notes = ?",
                [$tenantId, $adminId, $notes, $adminId, $notes]
            );

            unset($this->whitelistCache[$tenantId]);

            $this->auditService->log('tenant_whitelisted', $tenantId, null, $adminId, ['notes' => $notes]);

            return true;
        } catch (\Exception $e) {
            Log::error('FederationFeatureService: Failed to add to whitelist - ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Remove tenant from whitelist.
     */
    public function removeFromWhitelist(int $tenantId, int $adminId): bool
    {
        try {
            DB::table('federation_tenant_whitelist')->where('tenant_id', $tenantId)->delete();

            unset($this->whitelistCache[$tenantId]);

            $this->auditService->log('tenant_removed_from_whitelist', $tenantId, null, $adminId, []);

            return true;
        } catch (\Exception $e) {
            Log::error('FederationFeatureService: Failed to remove from whitelist - ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Get all whitelisted tenants.
     */
    public function getWhitelistedTenants(): array
    {
        try {
            return DB::table('federation_tenant_whitelist as fw')
                ->join('tenants as t', 'fw.tenant_id', '=', 't.id')
                ->leftJoin('users as u', 'fw.approved_by', '=', 'u.id')
                ->select(
                    'fw.*',
                    't.name as tenant_name',
                    't.domain as tenant_domain',
                    DB::raw("CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as approved_by_name")
                )
                ->orderByDesc('fw.approved_at')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->all();
        } catch (\Exception $e) {
            Log::error('FederationFeatureService: Failed to get whitelisted tenants - ' . $e->getMessage());
            return [];
        }
    }

    // =========================================================================
    // CACHE MANAGEMENT
    // =========================================================================

    /**
     * Clear all in-process caches.
     */
    public function clearCache(): void
    {
        $this->systemControlCache = null;
        $this->tenantFeatureCache = [];
        $this->whitelistCache = [];
        $this->externalControlCache = null;
    }

    // =========================================================================
    // DEFINITIONS & DEFAULTS
    // =========================================================================

    /**
     * Get tenant feature definitions.
     */
    public function getTenantFeatureDefinitions(): array
    {
        return [
            self::TENANT_FEDERATION_ENABLED => [
                'label_code' => 'tenant_federation_enabled',
                'description_code' => 'tenant_federation_enabled',
                'category' => 'core',
                'default' => true,
            ],
            self::TENANT_APPEAR_IN_DIRECTORY => [
                'label_code' => 'tenant_appear_in_directory',
                'description_code' => 'tenant_appear_in_directory',
                'category' => 'core',
                'default' => true,
            ],
            self::TENANT_AUTO_ACCEPT_HIERARCHY => [
                'label_code' => 'tenant_auto_accept_hierarchy',
                'description_code' => 'tenant_auto_accept_hierarchy',
                'category' => 'core',
                'default' => false,
            ],
            self::TENANT_PROFILES_ENABLED => [
                'label_code' => 'tenant_profiles_enabled',
                'description_code' => 'tenant_profiles_enabled',
                'category' => 'features',
                'default' => true,
                'requires_system' => self::SYSTEM_PROFILES_ENABLED,
            ],
            self::TENANT_MESSAGING_ENABLED => [
                'label_code' => 'tenant_messaging_enabled',
                'description_code' => 'tenant_messaging_enabled',
                'category' => 'features',
                'default' => true,
                'requires_system' => self::SYSTEM_MESSAGING_ENABLED,
            ],
            self::TENANT_TRANSACTIONS_ENABLED => [
                'label_code' => 'tenant_transactions_enabled',
                'description_code' => 'tenant_transactions_enabled',
                'category' => 'features',
                'default' => true,
                'requires_system' => self::SYSTEM_TRANSACTIONS_ENABLED,
            ],
            self::TENANT_LISTINGS_ENABLED => [
                'label_code' => 'tenant_listings_enabled',
                'description_code' => 'tenant_listings_enabled',
                'category' => 'features',
                'default' => true,
                'requires_system' => self::SYSTEM_LISTINGS_ENABLED,
            ],
            self::TENANT_EVENTS_ENABLED => [
                'label_code' => 'tenant_events_enabled',
                'description_code' => 'tenant_events_enabled',
                'category' => 'features',
                'default' => true,
                'requires_system' => self::SYSTEM_EVENTS_ENABLED,
            ],
            self::TENANT_GROUPS_ENABLED => [
                'label_code' => 'tenant_groups_enabled',
                'description_code' => 'tenant_groups_enabled',
                'category' => 'features',
                'default' => true,
                'requires_system' => self::SYSTEM_GROUPS_ENABLED,
            ],
        ];
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    private function setTenantFeature(string $feature, bool $enabled, ?int $tenantId = null): bool
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        try {
            DB::statement(
                "REPLACE INTO federation_tenant_features
                 (tenant_id, feature_key, is_enabled, updated_at, updated_by)
                 VALUES (?, ?, ?, NOW(), ?)",
                [$tenantId, $feature, $enabled ? 1 : 0, auth()->id()]
            );

            $cacheKey = "{$tenantId}:{$feature}";
            unset($this->tenantFeatureCache[$cacheKey]);

            $this->auditService->log(
                'tenant_feature_changed',
                $tenantId, null, auth()->id(),
                ['feature' => $feature, 'enabled' => $enabled]
            );

            return true;
        } catch (\Exception $e) {
            Log::error('FederationFeatureService: Failed to set tenant feature - ' . $e->getMessage());
            return false;
        }
    }

    private function getSystemDefaults(): array
    {
        // Internal cross-tenant federation defaults ON so a transient DB fault
        // cannot silently sever working same-install federation. Every
        // external_* key defaults OFF — see getExternalControls().
        $defaults = [
            'federation_enabled' => 1,
            'whitelist_mode_enabled' => 0,
            'emergency_lockdown_active' => 0,
            'max_federation_level' => 4,
            'cross_tenant_profiles_enabled' => 1,
            'cross_tenant_messaging_enabled' => 1,
            'cross_tenant_transactions_enabled' => 1,
            'cross_tenant_listings_enabled' => 1,
            'cross_tenant_events_enabled' => 1,
            'cross_tenant_groups_enabled' => 1,
            'external_federation_enabled' => 0,
        ];

        foreach (self::EXTERNAL_PROTOCOL_COLUMNS as $column) {
            $defaults[$column] = 0;
        }

        return $defaults;
    }

    private function getTenantFeatureDefault(string $feature): bool
    {
        $definitions = $this->getTenantFeatureDefinitions();
        return $definitions[$feature]['default'] ?? false;
    }

    private function initializeSystemDefaults(): void
    {
        // The external_* columns are intentionally omitted: their column
        // defaults are 0, so a self-healed control row starts with external
        // partner federation blocked and must be enabled explicitly.
        try {
            DB::statement(
                "INSERT INTO federation_system_control (
                    id, federation_enabled, whitelist_mode_enabled, emergency_lockdown_active,
                    max_federation_level, cross_tenant_profiles_enabled, cross_tenant_messaging_enabled,
                    cross_tenant_transactions_enabled, cross_tenant_listings_enabled,
                    cross_tenant_events_enabled, cross_tenant_groups_enabled, created_at
                ) VALUES (1, 1, 0, 0, 4, 1, 1, 1, 1, 1, 1, NOW())
                ON DUPLICATE KEY UPDATE id = id"
            );
        } catch (\Exception $e) {
            Log::error('FederationFeatureService: Failed to initialize system defaults - ' . $e->getMessage());
        }
    }
}
