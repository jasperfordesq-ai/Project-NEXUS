<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Services\Protocols\CreditCommonsAdapter;
use App\Support\OutboundUrlGuard;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * CreditCommonsNodeService — Manages the CC node tree topology, hashchain
 * verification, transaction relay, exchange rates, and validation timeouts.
 *
 * This service implements the "hard" CC features that make NEXUS a fully
 * compliant Credit Commons node:
 *
 *   1. Node tree topology: parent/child relationships, path resolution
 *   2. Transaction relay: forwarding transactions through the node tree
 *   3. Hashchain: cryptographic chain between nodes for tamper detection
 *   4. Exchange rates: cascading rates through the tree hierarchy
 *   5. Validation timeouts: expiring validated (V) transactions
 */
class CreditCommonsNodeService
{
    // ─────────────────────────────────────────────────────────────────────────
    // 1. Node Tree Topology
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get this tenant's CC node configuration.
     * Creates a default config if none exists.
     */
    public static function getNodeConfig(?int $tenantId = null): object
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        $config = DB::table('federation_cc_node_config')
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$config) {
            $config = self::initializeNodeConfig($tenantId);
        }

        return $config;
    }

    /**
     * Initialize a default CC node config for a tenant.
     */
    public static function initializeNodeConfig(int $tenantId): object
    {
        $tenant = DB::table('tenants')->where('id', $tenantId)->first(['slug', 'name']);
        $slug = $tenant?->slug
            ? Str::substr(Str::slug($tenant->slug), 0, 15)
            : "nexus-t{$tenantId}";

        DB::table('federation_cc_node_config')->insert([
            'tenant_id' => $tenantId,
            'node_slug' => $slug,
            'display_name' => $tenant?->name ?? "NEXUS Tenant {$tenantId}",
            'currency_format' => '<quantity> hours',
            'exchange_rate' => 1.0,
            'validated_window' => 300,
            'parent_node_url' => null,
            'parent_node_slug' => null,
            'last_hash' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return DB::table('federation_cc_node_config')
            ->where('tenant_id', $tenantId)
            ->first();
    }

    /**
     * Update CC node configuration.
     */
    public static function updateNodeConfig(int $tenantId, array $data): bool
    {
        $allowed = ['node_slug', 'display_name', 'currency_format', 'exchange_rate',
            'validated_window', 'parent_node_url', 'parent_node_slug'];

        $updates = array_intersect_key($data, array_flip($allowed));
        $updates['updated_at'] = now();

        return DB::table('federation_cc_node_config')
            ->where('tenant_id', $tenantId)
            ->update($updates) > 0;
    }

    /**
     * Build the absolute path for this node in the CC tree.
     *
     * Returns an array of node slugs from root to this node.
     * e.g., ['root-network', 'regional-hub', 'my-timebank']
     */
    public static function getAbsolutePath(?int $tenantId = null): array
    {
        $config = self::getNodeConfig($tenantId);
        $path = [];

        if ($config->parent_node_slug) {
            // Try to resolve the parent chain
            $parentPath = self::resolveParentPath($config);
            $path = array_merge($parentPath, [$config->node_slug]);
        } else {
            $path = [$config->node_slug];
        }

        return $path;
    }

    /**
     * Validate a URL is not pointing to a private/internal IP address.
     * Prevents SSRF attacks via partner node URLs.
     */
    private static function isUrlSafe(string $url): bool
    {

        return OutboundUrlGuard::isSafeHttpUrl($url);
    }

    /**
     * Resolve parent node path by querying the parent node's /about endpoint.
     */
    /**
     * True when the external federation kill switch blocks Credit Commons
     * outbound traffic.
     *
     * These calls talk directly to remote CC nodes with raw Http:: and so do
     * not pass through FederationExternalApiClient::request(), which is where
     * every other outbound partner call is gated.
     */
    private static function outboundBlocked(): bool
    {
        return !app(FederationFeatureService::class)
            ->isExternalProtocolEnabled(FederationFeatureService::EXTERNAL_PROTOCOL_CREDIT_COMMONS);
    }

    private static function resolveParentPath(object $config): array
    {
        if (!$config->parent_node_url) {
            return $config->parent_node_slug ? [$config->parent_node_slug] : [];
        }

        if (self::outboundBlocked()) {
            return $config->parent_node_slug ? [$config->parent_node_slug] : [];
        }

        // SSRF protection: validate URL before making request
        if (!self::isUrlSafe($config->parent_node_url)) {
            Log::warning('[CreditCommonsNode] Parent node URL blocked by SSRF filter', [
                'url' => $config->parent_node_url,
            ]);
            return $config->parent_node_slug ? [$config->parent_node_slug] : [];
        }

        $cacheKey = "cc_parent_path:{$config->tenant_id}";
        $cached = Cache::get($cacheKey);
        if ($cached) {
            return $cached;
        }

        try {
            $aboutUrl = rtrim($config->parent_node_url, '/') . '/about';
            $response = Http::timeout(10)
                ->withOptions(OutboundUrlGuard::httpClientOptions($aboutUrl))
                ->acceptJson()
                ->get($aboutUrl);

            if ($response->successful()) {
                $aboutData = $response->json();
                $parentPath = $aboutData['absolute_path'] ?? [$config->parent_node_slug];
                Cache::put($cacheKey, $parentPath, 3600); // Cache for 1 hour
                return $parentPath;
            }
        } catch (\Throwable $e) {
            Log::warning('[CreditCommonsNode] Failed to resolve parent path', [
                'parent_url' => $config->parent_node_url,
                'error' => $e->getMessage(),
            ]);
        }

        return $config->parent_node_slug ? [$config->parent_node_slug] : [];
    }

    /**
     * Check if a given account path belongs to this node.
     *
     * "my-node/alice" with node_slug "my-node" → true
     * "other-node/alice" with node_slug "my-node" → false
     */
    public static function isLocalAccount(string $accountPath, ?int $tenantId = null): bool
    {
        $config = self::getNodeConfig($tenantId);
        $nodeSlug = CreditCommonsAdapter::extractNodeSlug($accountPath);

        return $nodeSlug === null || $nodeSlug === $config->node_slug;
    }

    /**
     * Find which external partner handles a given remote node slug.
     */
    public static function findPartnerForNode(string $nodeSlug, int $tenantId): ?object
    {
        // Check external partners with CC protocol that might handle this node
        $partners = DB::table('federation_external_partners')
            ->where('tenant_id', $tenantId)
            ->where('protocol_type', 'credit_commons')
            ->whereIn('status', ['active', 'pending'])
            ->get();

        foreach ($partners as $partner) {
            // Check if partner metadata contains node mapping
            $metadata = $partner->partner_metadata ? json_decode($partner->partner_metadata, true) : [];
            $partnerNodeSlug = $metadata['node_slug'] ?? null;

            if ($partnerNodeSlug === $nodeSlug) {
                return $partner;
            }
        }

        // Fallback: check parent node
        $config = self::getNodeConfig($tenantId);
        if ($config->parent_node_slug === $nodeSlug && $config->parent_node_url) {
            // Parent node handles all unknown routes in a tree
            return (object) [
                'id' => 0,
                'base_url' => $config->parent_node_url,
                'protocol_type' => 'credit_commons',
                'is_parent' => true,
            ];
        }

        return null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Transaction Relay
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Relay a transaction through the node tree.
     *
     * CC relay rules:
     *   - If both payer and payee are local → process locally
     *   - If payer is local, payee is remote → relay to payee's node
     *   - If payee is local, payer is remote → relay to payer's node
     *   - If both are remote → relay to parent node (trunkward routing)
     *
     * @param array $transaction CC NewTransaction format
     * @param int   $tenantId   Current tenant ID
     * @return array{success: bool, data?: array, error?: string}
     */
    public static function relayTransaction(array $transaction, int $tenantId): array
    {
        $payerPath = $transaction['payer'] ?? '';
        $payeePath = $transaction['payee'] ?? '';

        $payerIsLocal = self::isLocalAccount($payerPath, $tenantId);
        $payeeIsLocal = self::isLocalAccount($payeePath, $tenantId);

        // Both local — no relay needed, process directly
        if ($payerIsLocal && $payeeIsLocal) {
            return ['success' => true, 'data' => $transaction, 'routing' => 'local'];
        }

        // Determine which node to relay to
        $remoteAccountPath = $payerIsLocal ? $payeePath : $payerPath;
        $remoteNodeSlug = CreditCommonsAdapter::extractNodeSlug($remoteAccountPath);

        if (!$remoteNodeSlug) {
            return ['success' => false, 'error' => __('federation.relay_no_remote_node', ['account' => $remoteAccountPath])];
        }

        $partner = self::findPartnerForNode($remoteNodeSlug, $tenantId);
        if (!$partner) {
            return ['success' => false, 'error' => __('federation.relay_no_route_to_node', ['node' => $remoteNodeSlug])];
        }

        // Apply exchange rate if crossing node boundaries
        $config = self::getNodeConfig($tenantId);
        $exchangeRate = (float) $config->exchange_rate;
        if ($exchangeRate !== 1.0 && $exchangeRate > 0) {
            $transaction['quant'] = round((float) ($transaction['quant'] ?? 0) * $exchangeRate, 4);
        }

        // SSRF protection on relay target
        if (!self::isUrlSafe($partner->base_url)) {
            return ['success' => false, 'error' => __('federation.relay_url_blocked')];
        }

        if (self::outboundBlocked()) {
            return ['success' => false, 'error' => __('api.federation.external_outbound_disabled')];
        }

        // Forward to the remote node's /transaction/relay endpoint
        try {
            $relayUrl = rtrim($partner->base_url, '/') . '/transaction/relay';

            $headers = ['Content-Type' => 'application/json', 'Accept' => 'application/json'];

            // Add Last-hash header for hashchain verification
            if ($config->last_hash) {
                $headers['Last-hash'] = $config->last_hash;
            }

            $response = Http::withHeaders($headers)
                ->withOptions(OutboundUrlGuard::httpClientOptions($relayUrl))
                ->timeout(30)
                ->post($relayUrl, $transaction);

            if ($response->successful()) {
                $responseData = $response->json();

                // Update hashchain if the remote node returns a hash
                $remoteHash = $response->header('Last-hash');
                if ($remoteHash) {
                    self::recordHash($tenantId, $remoteHash);
                }

                return [
                    'success' => true,
                    'data' => $responseData,
                    'routing' => 'relayed',
                    'relayed_to' => $remoteNodeSlug,
                ];
            }

            return [
                'success' => false,
                'error' => "Relay failed: HTTP {$response->status()} — " . substr($response->body(), 0, 500),
                'status_code' => $response->status(),
            ];
        } catch (\Throwable $e) {
            Log::error('[CreditCommonsNode] Relay failed', [
                'remote_node' => $remoteNodeSlug,
                'error' => $e->getMessage(),
            ]);
            return ['success' => false, 'error' => 'Relay failed: ' . $e->getMessage()];
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Hashchain Verification
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Compute the next hash in the chain for a transaction.
     *
     * The hashchain is built from every transaction that hops between two
     * ledgers. Each node maintains its own copy and the protocol ensures
     * hashes match for inter-ledger transactions.
     *
     * Hash formula: SHA256(previous_hash + transaction_uuid + amount + payer + payee)
     */
    public static function computeHash(string $previousHash, string $uuid, float $amount, string $payer, string $payee): string
    {
        $data = implode('|', [$previousHash, $uuid, (string) $amount, $payer, $payee]);
        return hash('sha256', $data);
    }

    /**
     * Record a new hash in the chain after a cross-node transaction.
     */
    public static function recordHash(int $tenantId, string $hash): void
    {
        DB::table('federation_cc_node_config')
            ->where('tenant_id', $tenantId)
            ->update([
                'last_hash' => $hash,
                'updated_at' => now(),
            ]);
    }

    /**
     * Get the current last hash for this node.
     */
    public static function getLastHash(?int $tenantId = null): ?string
    {
        $config = self::getNodeConfig($tenantId);
        return $config->last_hash;
    }

    /**
     * Verify an incoming Last-hash header against our stored hash.
     *
     * Returns true if hashes match or if the remote hasn't sent a hash yet
     * (first interaction). Returns false on mismatch (tamper detected).
     */
    public static function verifyHash(?string $remoteHash, ?int $tenantId = null): bool
    {
        $localHash = self::getLastHash($tenantId);

        // An established chain MUST present a matching Last-hash. Previously a
        // missing/null header returned true unconditionally, which let a caller
        // bypass an existing hashchain (and replay/forge relays) simply by
        // omitting the header. Fail closed once a chain exists.
        if ($localHash !== null) {
            return $remoteHash !== null && hash_equals($localHash, $remoteHash);
        }

        // No local chain yet — genuine first interaction with a peer that has
        // already passed federation API-key authentication. Adopt the peer's
        // hash as the chain root (or start empty if none was provided).
        if ($remoteHash !== null) {
            self::recordHash($tenantId ?? TenantContext::getId(), $remoteHash);
        }

        return true;
    }

    /**
     * Update the hashchain after a successful cross-node transaction.
     *
     * Called after a transaction is relayed or received from another node.
     */
    public static function advanceHashchain(int $tenantId, string $uuid, float $amount, string $payer, string $payee): string
    {
        $previousHash = self::getLastHash($tenantId) ?? str_repeat('0', 64);
        $newHash = self::computeHash($previousHash, $uuid, $amount, $payer, $payee);
        self::recordHash($tenantId, $newHash);

        Log::info('[CreditCommonsNode] Hashchain advanced', [
            'tenant_id' => $tenantId,
            'uuid' => $uuid,
            'new_hash' => substr($newHash, 0, 16) . '...',
        ]);

        return $newHash;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3b. Hashchain Error Recovery
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Rebuild the hashchain from all cross-node CC entries.
     *
     * Called when: hashchain gets out of sync (server crash mid-transaction,
     * network timeout, manual data correction). Recomputes the entire chain
     * from the entries table in chronological order.
     *
     * @return array{success: bool, entries_processed: int, new_hash: string}
     */
    public static function rebuildHashchain(int $tenantId): array
    {
        $entries = DB::table('federation_cc_entries')
            ->where('tenant_id', $tenantId)
            ->where('state', CreditCommonsAdapter::STATE_COMPLETED)
            ->orderBy('written_at')
            ->orderBy('id')
            ->get(['transaction_uuid', 'quant', 'payer', 'payee']);

        $hash = str_repeat('0', 64); // Genesis hash
        $count = 0;

        foreach ($entries as $entry) {
            $hash = self::computeHash(
                $hash,
                $entry->transaction_uuid,
                (float) $entry->quant,
                $entry->payer,
                $entry->payee
            );
            $count++;
        }

        self::recordHash($tenantId, $hash);

        Log::info('[CreditCommonsNode] Hashchain rebuilt', [
            'tenant_id' => $tenantId,
            'entries_processed' => $count,
            'new_hash' => substr($hash, 0, 16) . '...',
        ]);

        return [
            'success' => true,
            'entries_processed' => $count,
            'new_hash' => $hash,
        ];
    }

    /**
     * Attempt to resync hashchain with a remote node.
     *
     * Queries the remote node's /about endpoint to get their last hash,
     * then compares. If they differ, rebuilds our local chain and reports
     * the mismatch for manual investigation.
     *
     * @return array{in_sync: bool, local_hash: ?string, remote_hash: ?string, action: string}
     */
    public static function resyncWithRemote(int $tenantId, string $remoteNodeUrl): array
    {
        // SSRF protection
        if (!self::isUrlSafe($remoteNodeUrl)) {
            return [
                'in_sync' => false,
                'local_hash' => null,
                'remote_hash' => null,
                'action' => 'url_blocked_by_ssrf_filter',
            ];
        }

        $localHash = self::getLastHash($tenantId);

        if (self::outboundBlocked()) {
            return [
                'in_sync' => false,
                'local_hash' => $localHash,
                'remote_hash' => null,
                'action' => 'external_federation_disabled',
            ];
        }

        try {
            $aboutUrl = rtrim($remoteNodeUrl, '/') . '/about';
            $response = Http::timeout(10)
                ->withOptions(OutboundUrlGuard::httpClientOptions($aboutUrl))
                ->acceptJson()
                ->get($aboutUrl);

            if (!$response->successful()) {
                return [
                    'in_sync' => false,
                    'local_hash' => $localHash,
                    'remote_hash' => null,
                    'action' => 'remote_unreachable',
                ];
            }

            // The remote node doesn't expose its hash in /about by default,
            // but some implementations include it in the response headers
            $remoteHash = $response->header('Last-hash');

            if ($remoteHash === null) {
                return [
                    'in_sync' => true, // Can't verify — assume OK
                    'local_hash' => $localHash,
                    'remote_hash' => null,
                    'action' => 'no_remote_hash_available',
                ];
            }

            if ($localHash && hash_equals($localHash, $remoteHash)) {
                return [
                    'in_sync' => true,
                    'local_hash' => $localHash,
                    'remote_hash' => $remoteHash,
                    'action' => 'verified',
                ];
            }

            // Mismatch — rebuild our chain
            $rebuild = self::rebuildHashchain($tenantId);

            return [
                'in_sync' => false,
                'local_hash' => $rebuild['new_hash'],
                'remote_hash' => $remoteHash,
                'action' => 'rebuilt_local_chain',
                'entries_reprocessed' => $rebuild['entries_processed'],
            ];
        } catch (\Throwable $e) {
            Log::error('[CreditCommonsNode] Resync failed', [
                'tenant_id' => $tenantId,
                'remote_url' => $remoteNodeUrl,
                'error' => $e->getMessage(),
            ]);

            return [
                'in_sync' => false,
                'local_hash' => $localHash,
                'remote_hash' => null,
                'action' => 'error',
                'error' => $e->getMessage(),
            ];
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Exchange Rate Cascading
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get the effective exchange rate between this node and a target node.
     *
     * In a CC tree, rates cascade: if A→B is 1.5 and B→C is 0.8,
     * then A→C is 1.5 * 0.8 = 1.2.
     *
     * For now, we support single-hop rates (this node ↔ direct partner).
     * Multi-hop cascading requires querying intermediate nodes.
     *
     * @param string $targetNodeSlug The target node's slug
     * @param int    $tenantId       Current tenant ID
     * @return float Exchange rate (1.0 = same unit)
     */
    public static function getExchangeRate(string $targetNodeSlug, int $tenantId): float
    {
        $config = self::getNodeConfig($tenantId);

        // Same node — rate is 1.0
        if ($targetNodeSlug === $config->node_slug) {
            return 1.0;
        }

        // Direct partner — check if we have a stored rate
        $partner = self::findPartnerForNode($targetNodeSlug, $tenantId);
        if ($partner) {
            $metadata = isset($partner->partner_metadata)
                ? json_decode($partner->partner_metadata, true) : [];
            $directRate = $metadata['exchange_rate'] ?? null;
            if ($directRate !== null) {
                return (float) $directRate;
            }
        }

        // Parent node — use our configured rate
        if ($targetNodeSlug === $config->parent_node_slug) {
            return (float) $config->exchange_rate;
        }

        // Unknown node — try to query via parent (multi-hop)
        if ($config->parent_node_url) {
            return self::queryRemoteExchangeRate($config->parent_node_url, $targetNodeSlug, $config->exchange_rate);
        }

        // Default: 1:1 (same unit assumed)
        return 1.0;
    }

    /**
     * Query a remote node's /about endpoint to get the exchange rate to a target.
     */
    private static function queryRemoteExchangeRate(string $nodeUrl, string $targetNodeSlug, float $localRate): float
    {
        // SSRF protection
        if (!self::isUrlSafe($nodeUrl)) {
            Log::warning('[CreditCommonsNode] Exchange rate URL blocked by SSRF filter', ['url' => $nodeUrl]);
            return 1.0;
        }

        $cacheKey = "cc_exchange_rate:{$targetNodeSlug}";
        $cached = Cache::get($cacheKey);
        if ($cached !== null) {
            return (float) $cached;
        }

        if (self::outboundBlocked()) {
            return 1.0;
        }

        try {
            $aboutUrl = rtrim($nodeUrl, '/') . '/about';
            $response = Http::timeout(10)
                ->withOptions(OutboundUrlGuard::httpClientOptions($aboutUrl))
                ->acceptJson()
                ->get($aboutUrl, ['node_path' => $targetNodeSlug]);

            if ($response->successful()) {
                $data = $response->json();
                $remoteRate = (float) ($data['rate'] ?? 1.0);
                // Cascade: our rate to parent × parent's rate to target
                $cascadedRate = $localRate * $remoteRate;
                Cache::put($cacheKey, $cascadedRate, 3600);
                return $cascadedRate;
            }
        } catch (\Throwable $e) {
            Log::warning('[CreditCommonsNode] Exchange rate query failed', [
                'target' => $targetNodeSlug,
                'error' => $e->getMessage(),
            ]);
        }

        return 1.0;
    }

    /**
     * Convert an amount from this node's currency to a target node's currency.
     */
    public static function convertAmount(float $amount, string $targetNodeSlug, int $tenantId): float
    {
        $rate = self::getExchangeRate($targetNodeSlug, $tenantId);
        return round($amount * $rate, 4);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Validation Timeouts
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Expire validated (V) transactions that have exceeded their timeout window.
     *
     * Called by the scheduled command `federation:expire-cc-validations`.
     *
     * CC spec: a validated transaction has `secs_valid_left` seconds before
     * it automatically transitions to Erased (E). The timeout is the shortest
     * window across all nodes involved in the transaction path.
     *
     * @return int Number of transactions expired
     */
    public static function expireValidatedTransactions(): int
    {
        $expired = 0;

        // Get all tenants with CC node configs
        $tenantConfigs = DB::table('federation_cc_node_config')->get();

        foreach ($tenantConfigs as $config) {
            $windowSeconds = (int) $config->validated_window;

            // Find validated entries past their window
            $staleEntries = DB::table('federation_cc_entries')
                ->where('tenant_id', $config->tenant_id)
                ->where('state', CreditCommonsAdapter::STATE_VALIDATED)
                ->where('updated_at', '<', now()->subSeconds($windowSeconds))
                ->get();

            foreach ($staleEntries as $entry) {
                DB::table('federation_cc_entries')
                    ->where('id', $entry->id)
                    ->update([
                        'state' => CreditCommonsAdapter::STATE_ERASED,
                        'updated_at' => now(),
                    ]);

                Log::info('[CreditCommonsNode] Validated transaction expired', [
                    'tenant_id' => $config->tenant_id,
                    'uuid' => $entry->transaction_uuid,
                    'window' => $windowSeconds,
                ]);

                $expired++;
            }
        }

        return $expired;
    }
}
