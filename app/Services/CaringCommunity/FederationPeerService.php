<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Support\OutboundUrlGuard;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use RuntimeException;

/**
 * FederationPeerService — AG23 follow-up
 *
 * Tenant-scoped registry of remote NEXUS installs that this cooperative has
 * agreed to federate hour-transfers with. Each peer carries its own HMAC
 * shared secret (separate from the same-platform `app.key`-derived secret).
 *
 * Peers are identified by `peer_slug`, which the source tenant chooses and
 * embeds in the outbound `destination_tenant_slug` field. When
 * `CaringHourTransferService::approveAtSource()` resolves the destination, it
 * first checks for a registered peer; if found, the delivery is HTTP, not
 * same-platform.
 */
class FederationPeerService
{
    private const TABLE = 'caring_federation_peers';

    public function isAvailable(): bool
    {
        return Schema::hasTable(self::TABLE);
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function listForTenant(int $tenantId): array
    {
        if (! $this->isAvailable()) {
            return [];
        }

        return DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->orderBy('display_name')
            ->get()
            ->map(fn ($row) => $this->castRow($row, redactSecret: true))
            ->all();
    }

    public function findByPeerSlug(int $tenantId, string $peerSlug): ?array
    {
        if (! $this->isAvailable()) {
            return null;
        }

        $row = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('peer_slug', $peerSlug)
            ->first();

        return $row ? $this->castRow($row, redactSecret: false) : null;
    }

    /**
     * Find an inbound peer by signature: the inbound endpoint receives
     * `source_tenant_slug` from the payload, and we use that as the
     * `peer_slug` to look up the secret on this side.
     */
    public function findInboundBySourceSlug(int $tenantId, string $sourceSlug): ?array
    {
        return $this->findByPeerSlug($tenantId, $sourceSlug);
    }

    /**
     * @param array<string,mixed> $input
     * @return array<string,mixed>
     */
    public function create(int $tenantId, array $input): array
    {
        $this->assertAvailable();

        $peerSlug = trim((string) ($input['peer_slug'] ?? ''));
        $displayName = trim((string) ($input['display_name'] ?? ''));
        $baseUrl = trim((string) ($input['base_url'] ?? ''));

        if ($peerSlug === '' || $displayName === '' || $baseUrl === '') {
            throw new InvalidArgumentException(__('api.federation_peer_fields_required'));
        }

        if (! preg_match('/^[a-z0-9][a-z0-9\-]{1,99}$/', $peerSlug)) {
            throw new InvalidArgumentException(__('api.federation_peer_slug_invalid'));
        }

        if (! OutboundUrlGuard::isSafeHttpUrl($baseUrl, requireHttps: true)) {
            throw new InvalidArgumentException(__('api.federation_peer_base_url_invalid'));
        }

        // Pre-existing slug? Reject with a clear error rather than overwriting silently.
        $existing = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('peer_slug', $peerSlug)
            ->exists();
        if ($existing) {
            throw new InvalidArgumentException(__('api.federation_peer_slug_taken'));
        }

        // Generate a 64-char hex shared secret unless the caller supplied one.
        $sharedSecret = trim((string) ($input['shared_secret'] ?? ''));
        if ($sharedSecret === '') {
            $sharedSecret = bin2hex(random_bytes(32));
        } elseif (strlen($sharedSecret) < 32) {
            throw new InvalidArgumentException(__('api.federation_peer_secret_too_short'));
        }

        $now = now();
        $id = (int) DB::table(self::TABLE)->insertGetId([
            'tenant_id' => $tenantId,
            'peer_slug' => $peerSlug,
            'display_name' => $displayName,
            'base_url' => rtrim($baseUrl, '/'),
            'shared_secret' => $sharedSecret,
            'status' => in_array($input['status'] ?? null, ['pending', 'active', 'suspended'], true)
                ? (string) $input['status']
                : 'pending',
            'notes' => isset($input['notes']) ? (string) $input['notes'] : null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        // Return the row WITH the secret on creation only — the admin needs
        // to copy it to the remote side.  Subsequent reads redact it.
        return $this->castRow(
            DB::table(self::TABLE)->where('id', $id)->first(),
            redactSecret: false,
        );
    }

    public function updateStatus(int $tenantId, int $id, string $status): array
    {
        $this->assertAvailable();
        if (! in_array($status, ['pending', 'active', 'suspended'], true)) {
            throw new InvalidArgumentException(__('api.federation_peer_status_invalid'));
        }

        DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->update(['status' => $status, 'updated_at' => now()]);

        $row = DB::table(self::TABLE)->where('id', $id)->where('tenant_id', $tenantId)->first();
        if (! $row) {
            throw new RuntimeException(__('api.federation_peer_not_found'));
        }
        return $this->castRow($row, redactSecret: true);
    }

    public function rotateSecret(int $tenantId, int $id): array
    {
        $this->assertAvailable();
        $newSecret = bin2hex(random_bytes(32));

        DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->update(['shared_secret' => $newSecret, 'updated_at' => now()]);

        $row = DB::table(self::TABLE)->where('id', $id)->where('tenant_id', $tenantId)->first();
        if (! $row) {
            throw new RuntimeException(__('api.federation_peer_not_found'));
        }
        // Return with the secret revealed once so the admin can copy it.
        return $this->castRow($row, redactSecret: false);
    }

    public function delete(int $tenantId, int $id): void
    {
        $this->assertAvailable();
        DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->delete();
    }

    public function recordHandshake(int $tenantId, int $id): void
    {
        if (! $this->isAvailable()) {
            return;
        }
        DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->update(['last_handshake_at' => now(), 'updated_at' => now()]);
    }

    /**
     * Find the local tenant for which a given peer_slug is registered as a
     * remote source. Used by the inbound endpoint to figure out which tenant
     * a transfer is being delivered to.
     */
    public function findInboundContext(string $destinationTenantSlug, string $sourceSlug): ?array
    {
        if (! $this->isAvailable()) {
            return null;
        }

        $tenant = DB::table('tenants')
            ->where('slug', $destinationTenantSlug)
            ->first(['id', 'slug', 'name']);
        if (! $tenant) {
            return null;
        }

        $peer = $this->findByPeerSlug((int) $tenant->id, $sourceSlug);
        if (! $peer) {
            return null;
        }

        return [
            'tenant'      => ['id' => (int) $tenant->id, 'slug' => (string) $tenant->slug, 'name' => (string) $tenant->name],
            'peer'        => $peer,
        ];
    }

    /**
     * List peers that members of the given tenant can discover and select
     * as the destination for a federated hour-transfer. Filters to active
     * peers (and the optional `discoverable` flag if the column exists).
     *
     * Returned rows are member-safe: no shared_secret, no notes.
     *
     * @return array<int,array<string,mixed>>
     */
    public function listDiscoverable(int $tenantId): array
    {
        if (! $this->isAvailable()) {
            return [];
        }

        $query = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active');

        if (Schema::hasColumn(self::TABLE, 'discoverable')) {
            $query->where('discoverable', 1);
        }

        $rows = $query->orderBy('display_name')->get();

        return $rows->map(function ($row) {
            return [
                'id'                         => (int) $row->id,
                'slug'                       => (string) $row->peer_slug,
                'display_name'               => (string) $row->display_name,
                'base_url'                   => (string) $row->base_url,
                'region'                     => isset($row->region) ? (string) $row->region : null,
                'member_count_bucket'        => isset($row->member_count_bucket) ? (string) $row->member_count_bucket : null,
                'accepts_inbound_transfers'  => (string) $row->status === 'active',
            ];
        })->all();
    }

    private function assertAvailable(): void
    {
        if (! $this->isAvailable()) {
            throw new RuntimeException(__('api.federation_peers_unavailable'));
        }
    }

    /**
     * @return array<string,mixed>
     */
    private function castRow(object $row, bool $redactSecret): array
    {
        return [
            'id'                => (int) $row->id,
            'tenant_id'         => (int) $row->tenant_id,
            'peer_slug'         => (string) $row->peer_slug,
            'display_name'      => (string) $row->display_name,
            'base_url'          => (string) $row->base_url,
            'shared_secret'     => $redactSecret ? null : (string) $row->shared_secret,
            'shared_secret_set' => isset($row->shared_secret) && $row->shared_secret !== '',
            'status'            => (string) $row->status,
            'notes'             => $row->notes !== null ? (string) $row->notes : null,
            'last_handshake_at' => $row->last_handshake_at,
            'created_at'        => $row->created_at,
            'updated_at'        => $row->updated_at,
        ];
    }

    /**
     * Helper for cross-tenant context callers that don't have the int id yet.
     */
    public function tenantId(): int
    {
        return (int) TenantContext::getId();
    }
}
