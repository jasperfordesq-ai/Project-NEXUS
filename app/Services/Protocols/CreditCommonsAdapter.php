<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Protocols;

use App\Contracts\FederationProtocolAdapter;
use App\Services\CreditCommonsNodeService;
use Illuminate\Support\Facades\Log;

/**
 * CreditCommonsAdapter — Translates between Nexus and Credit Commons protocol.
 *
 * Credit Commons is a protocol for recursive mutual credit accounting that
 * enables independent ledger nodes to interoperate in a hierarchical tree.
 *
 * Key differences from Nexus:
 *   - Network: Hierarchical tree (nodes have parent/child) vs Nexus flat peers
 *   - Transactions: Workflow state machine (P→V→C→E→X) vs simple status enum
 *   - Accounting: Double-entry (Entry objects per transaction) vs single-entry
 *   - Identity: Account paths ("node-slug/username") vs numeric user IDs
 *   - Auth: JWT with scopes + Last-hash header vs API key/HMAC/OAuth2
 *   - Amounts: Arbitrary units with exchange rates vs hours
 *
 * This adapter handles the format translation. The hierarchical tree topology,
 * multi-hop relay, and hashchain verification are out-of-scope for the adapter
 * pattern and would require dedicated services if the CEN group adopts CC.
 *
 * Reference: https://creditcommons.org/
 * OpenAPI spec: https://gitlab.com/credit-commons/cc-php-lib/-/blob/0.9.x/docs/credit-commons-openapi3.yml
 *
 * @see \App\Contracts\FederationProtocolAdapter
 */
class CreditCommonsAdapter implements FederationProtocolAdapter
{
    public const PLATFORM_TYPE = 'credit_commons';

    /**
     * Credit Commons transaction states.
     *
     * P = Pending (proposed, awaiting validation)
     * V = Validated (approved, temporary — has a timeout)
     * C = Completed (written permanently)
     * E = Erased (reversed/cancelled)
     * X = Scrubbed (permanently deleted)
     */
    public const STATE_PENDING    = 'P';
    public const STATE_VALIDATED  = 'V';
    public const STATE_COMPLETED  = 'C';
    public const STATE_ERASED     = 'E';
    public const STATE_SCRUBBED   = 'X';

    /**
     * Valid state transitions per the CC protocol.
     */
    public const STATE_TRANSITIONS = [
        self::STATE_PENDING   => [self::STATE_VALIDATED, self::STATE_COMPLETED, self::STATE_ERASED],
        self::STATE_VALIDATED => [self::STATE_COMPLETED, self::STATE_ERASED],
        self::STATE_COMPLETED => [self::STATE_ERASED],
        self::STATE_ERASED    => [self::STATE_SCRUBBED],
        self::STATE_SCRUBBED  => [],
    ];

    public static function getProtocolName(): string
    {
        return self::PLATFORM_TYPE;
    }

    public static function getDefaultApiPath(): string
    {
        return '';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Endpoint mapping (Nexus actions → Credit Commons endpoints)
    // ─────────────────────────────────────────────────────────────────────────

    public function mapEndpoint(string $action, array $params = []): string
    {
        $id = $params['id'] ?? null;
        $state = $params['state'] ?? null;

        return match ($action) {
            'members', 'accounts'   => '/accounts',
            'member', 'account'     => "/account/{$id}",
            'account_stats'         => '/account',
            'account_history'       => '/account/history',
            'listings'              => '/accounts',   // CC has no listing concept — map to accounts
            'transactions'          => '/transactions',
            'transaction'           => "/transaction/{$id}",
            'transaction_state'     => "/transaction/{$id}/{$state}",
            'transaction_relay'     => '/transaction/relay',
            'entries'               => '/entries',
            'transaction_entries'   => "/entries/{$id}",
            'about'                 => '/about',
            'forms'                 => '/forms',
            'health'                => '/about',
            'messages'              => '/messages',    // CC has no native messaging
            'reviews'               => '/reviews',      // CC extension
            'events'                => '/events',       // CC extension
            'groups'                => '/groups',       // CC extension
            'connections'           => '/connections',  // CC extension
            'volunteering'          => '/volunteering', // CC extension
            default                 => "/{$action}",
        };
    }

    public function mapHttpMethod(string $action, string $default = 'GET'): string
    {
        return match ($action) {
            'transaction_state' => 'PATCH',
            'transaction_relay' => 'POST',
            default             => $default,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Outbound: Nexus → Credit Commons format
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Transform a Nexus transaction into CC's NewTransaction format.
     *
     * CC NewTransaction:
     * {
     *   "payee": "account-path",
     *   "payer": "account-path",
     *   "quant": 2.5,
     *   "description": "Service provided",
     *   "workflow": "0|PC-CE="
     * }
     */
    public function transformOutboundTransaction(array $nexusTransaction, int $partnerId): array
    {
        $amount = (float) ($nexusTransaction['amount'] ?? 0);

        return [
            'payer' => self::resolveOutboundAccountPath($nexusTransaction, 'sender'),
            'payee' => self::resolveOutboundAccountPath($nexusTransaction, 'receiver'),
            'quant' => $amount,
            'description' => $nexusTransaction['description'] ?? 'Federation transfer from Project NEXUS',
            'workflow' => $nexusTransaction['workflow'] ?? '0|PC-CE=',
        ];
    }

    /**
     * Resolve one side of an outbound transaction to a CC account path.
     *
     * 🔴 What was wrong before 2026-08-28. Both sides went through
     * `toAccountPath($identifier)` with NO node slug, and the real outbound
     * payload (see App\Listeners\PushTransactionToFederatedPartner) carries
     * `sender_user_id` / `receiver_user_id` and NOT `sender_account_path`. So
     * every outbound transaction advertised a bare numeric id — `"123"` — as
     * payer and payee. A CC account path is `<node>/<account>`; an unqualified
     * value is not addressable, and a strict CC node is entitled to reject it.
     *
     * Resolution order, deliberately conservative:
     *   1. An explicit `*_account_path` is trusted and returned untouched — the
     *      caller knew the topology better than we do here.
     *   2. Otherwise, if the side's tenant is one of OURS and the member is in
     *      it, qualify with that tenant's node slug via CreditCommonsNodeService
     *      (which is also what our inbound CC controller answers with, so a
     *      member keeps ONE identity in both directions).
     *   3. Otherwise fall back to the bare identifier, unchanged.
     *
     * 🔴 Step 3 is a KNOWN REMAINING GAP, left deliberately rather than guessed.
     * On a genuine external transfer the counterparty lives on the PARTNER's
     * node and is absent from our `users` table, so we cannot name them — and
     * qualifying them with our own node slug would assert we hold their
     * account, which is a routing error in a money path. Closing this properly
     * needs the partner's node slug and their account identifier, verified
     * against a real CC node. External partner federation is switched off in
     * production with no partner connected, so nothing is currently affected.
     * Do NOT "finish" this by prepending the local slug.
     *
     * @param array<string, mixed> $transaction
     * @param 'sender'|'receiver' $side
     */
    private static function resolveOutboundAccountPath(array $transaction, string $side): string
    {
        $explicit = $transaction["{$side}_account_path"] ?? null;
        if (is_string($explicit) && $explicit !== '') {
            return self::toAccountPath($explicit);
        }

        $identifier = $transaction["{$side}_identifier"]
            ?? (string) ($transaction["{$side}_user_id"] ?? '');
        $identifier = (string) $identifier;

        $userId = (int) ($transaction["{$side}_user_id"] ?? 0);
        $tenantId = $transaction["{$side}_tenant_id"] ?? null;
        $tenantId = is_numeric($tenantId) ? (int) $tenantId : null;

        if ($userId > 0 && $tenantId !== null) {
            $localPath = CreditCommonsNodeService::accountPathForUser($userId, $tenantId);
            if ($localPath !== null) {
                return $localPath;
            }
        }

        return self::toAccountPath($identifier);
    }

    public function transformOutboundMessage(array $nexusMessage): array
    {
        // Credit Commons has no native messaging. This is a best-effort mapping
        // for platforms that extend CC with messaging support.
        return [
            'sender' => self::toAccountPath((string) ($nexusMessage['sender_id'] ?? '')),
            'recipient' => self::toAccountPath((string) ($nexusMessage['recipient_id'] ?? '')),
            'subject' => $nexusMessage['subject'] ?? '',
            'body' => $nexusMessage['body'] ?? '',
        ];
    }

    /**
     * Graceful degraded extension envelope for entities CC doesn't natively support.
     *
     * CC nodes that don't understand the extension can safely ignore it; nodes
     * that do can inspect the `payload` key. We do NOT throw on these.
     */
    private static function extensionEnvelope(string $entity, array $payload): array
    {
        return [
            'type'    => 'nexus_extension_' . $entity,
            'payload' => $payload,
            'source_platform' => self::PLATFORM_TYPE === 'credit_commons' ? 'nexus' : 'nexus',
        ];
    }

    public function transformOutboundListing(array $listing): array
    {
        // CC has no listing concept natively — send as an extension.
        return self::extensionEnvelope('listing', [
            'id'          => $listing['id'] ?? null,
            'title'       => $listing['title'] ?? 'Untitled',
            'description' => $listing['description'] ?? null,
            'type'        => $listing['type'] ?? 'offer',
            'author'      => self::toAccountPath((string) ($listing['user_id'] ?? $listing['author_id'] ?? '')),
            'tags'        => $listing['tags'] ?? [],
            'created_at'  => $listing['created_at'] ?? null,
        ]);
    }

    public function transformOutboundReview(array $review): array
    {
        return self::extensionEnvelope('review', [
            'id'              => $review['id'] ?? null,
            'rating'          => (int) ($review['rating'] ?? 0),
            'comment'         => $review['comment'] ?? null,
            'reviewer'        => self::toAccountPath((string) ($review['reviewer_id'] ?? '')),
            'receiver'        => self::toAccountPath((string) ($review['receiver_external_id'] ?? $review['receiver_id'] ?? '')),
            'transaction_ref' => $review['federation_transaction_id']
                ?? $review['transaction_id']
                ?? null,
            'created_at'      => $review['created_at'] ?? null,
        ]);
    }

    public function transformOutboundEvent(array $event): array
    {
        return self::extensionEnvelope('event', [
            'id'          => $event['id'] ?? null,
            'title'       => $event['title'] ?? $event['name'] ?? 'Untitled event',
            'description' => $event['description'] ?? null,
            'starts_at'   => $event['starts_at'] ?? $event['start_time'] ?? null,
            'ends_at'     => $event['ends_at'] ?? $event['end_time'] ?? null,
            'location'    => $event['location'] ?? null,
            'created_at'  => $event['created_at'] ?? null,
        ]);
    }

    public function transformOutboundGroup(array $group): array
    {
        return self::extensionEnvelope('group', [
            'id'          => $group['id'] ?? null,
            'name'        => $group['name'] ?? 'Untitled group',
            'description' => $group['description'] ?? null,
            'privacy'     => $group['privacy'] ?? $group['visibility'] ?? 'public',
            'created_at'  => $group['created_at'] ?? null,
        ]);
    }

    public function transformOutboundConnection(array $connection): array
    {
        return self::extensionEnvelope('connection', [
            'id'        => $connection['id'] ?? null,
            'requester' => self::toAccountPath((string) ($connection['requester_id'] ?? '')),
            'recipient' => self::toAccountPath((string) ($connection['recipient_id'] ?? '')),
            'status'    => $connection['status'] ?? 'pending',
            'note'      => $connection['note'] ?? null,
            'created_at' => $connection['created_at'] ?? null,
        ]);
    }

    public function transformOutboundVolunteering(array $opportunity): array
    {
        return self::extensionEnvelope('volunteering', [
            'id'          => $opportunity['id'] ?? null,
            'title'       => $opportunity['title'] ?? 'Untitled opportunity',
            'description' => $opportunity['description'] ?? null,
            'organization' => $opportunity['organization_name'] ?? $opportunity['organization'] ?? null,
            'starts_at'   => $opportunity['starts_at'] ?? null,
            'ends_at'     => $opportunity['ends_at'] ?? null,
            'location'    => $opportunity['location'] ?? null,
            'hours'       => $opportunity['hours'] ?? null,
            'created_at'  => $opportunity['created_at'] ?? null,
        ]);
    }

    public function transformOutboundMember(array $member): array
    {
        // CC does support members via /accounts, but the account path format
        // differs. Emit as an extension so receivers with full CC semantics
        // can promote it into a real account.
        return self::extensionEnvelope('member', [
            'id'       => $member['id'] ?? null,
            'acc_path' => self::toAccountPath((string) ($member['slug'] ?? $member['username'] ?? $member['id'] ?? '')),
            'name'     => $member['name'] ?? $member['display_name'] ?? null,
            'email'    => $member['email'] ?? null,
            'balance'  => (float) ($member['balance'] ?? 0),
            'active'   => (bool) ($member['active'] ?? true),
            'created_at' => $member['created_at'] ?? null,
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Inbound: Credit Commons → Nexus format
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Transform a CC account into a Nexus user.
     *
     * CC SummaryStats response from GET /account:
     * {
     *   "balance": 15,
     *   "volume": 42,
     *   "gross_in": 28,
     *   "gross_out": 14,
     *   "partners": 5,
     *   "trades": 8,
     *   "entries": 12,
     *   "min": -10,
     *   "max": 20
     * }
     *
     * CC account path from GET /accounts: "node-slug/username"
     */
    public function transformInboundMember(array $protocolMember): array
    {
        // CC responses vary — could be SummaryStats or just an account path string
        $accountPath = $protocolMember['acc_path'] ?? $protocolMember['path'] ?? $protocolMember['id'] ?? null;
        $username = $accountPath ? self::extractUsername($accountPath) : ($protocolMember['name'] ?? 'Unknown');

        return [
            'external_id' => $accountPath,
            'external_account_id' => $accountPath,
            'name' => $username,
            'email' => $protocolMember['email'] ?? null,
            'bio' => $protocolMember['description'] ?? null,
            'balance' => (float) ($protocolMember['balance'] ?? 0),
            'skills' => [],
            'active' => true,
            'location' => null,
            'trading_stats' => [
                'volume' => $protocolMember['volume'] ?? null,
                'gross_in' => $protocolMember['gross_in'] ?? null,
                'gross_out' => $protocolMember['gross_out'] ?? null,
                'partners' => $protocolMember['partners'] ?? null,
                'trades' => $protocolMember['trades'] ?? null,
            ],
            'created_at' => null,
            'source_platform' => self::PLATFORM_TYPE,
        ];
    }

    public function transformInboundMembers(array $protocolMembers): array
    {
        // CC /accounts returns an array of account path strings, not objects
        return array_map(function ($member) {
            if (is_string($member)) {
                return $this->transformInboundMember(['acc_path' => $member]);
            }
            return $this->transformInboundMember($member);
        }, $protocolMembers);
    }

    /**
     * Credit Commons has no listing/offer concept. Return empty for compatibility.
     */
    public function transformInboundListing(array $protocolListing): array
    {
        return [
            'external_id' => $protocolListing['id'] ?? null,
            'title' => $protocolListing['title'] ?? $protocolListing['description'] ?? 'Untitled',
            'description' => $protocolListing['description'] ?? null,
            'type' => 'offer',
            'status' => 'active',
            'source_platform' => self::PLATFORM_TYPE,
        ];
    }

    public function transformInboundListings(array $protocolListings): array
    {
        return array_map([$this, 'transformInboundListing'], $protocolListings);
    }

    /**
     * Transform a CC Transaction/EntryFull into Nexus transaction format.
     *
     * CC Transaction:
     * {
     *   "uuid": "abc-123",
     *   "written": "2026-01-15",
     *   "state": "C",
     *   "workflow": "0|PC-CE=",
     *   "entries": [
     *     { "payer": "node/alice", "payee": "node/bob", "quant": 2.5, "description": "..." }
     *   ]
     * }
     */
    public function transformInboundTransaction(array $protocolResponse): array
    {
        $data = $protocolResponse['data'] ?? $protocolResponse;

        // CC transactions have entries — use the primary (first) entry for amount/description
        $entries = $data['entries'] ?? [];
        $primaryEntry = $entries[0] ?? [];

        $amount = (float) ($primaryEntry['quant'] ?? $data['quant'] ?? 0);

        return [
            'external_transaction_id' => $data['uuid'] ?? '',
            'status' => self::mapCcStateToNexus($data['state'] ?? 'P'),
            'amount_hours' => $amount,
            'description' => $primaryEntry['description'] ?? $data['description'] ?? '',
            'payer' => $primaryEntry['payer'] ?? $data['payer'] ?? null,
            'payee' => $primaryEntry['payee'] ?? $data['payee'] ?? null,
            'completed_at' => $data['written'] ?? null,
            'cc_state' => $data['state'] ?? null,
            'cc_workflow' => $data['workflow'] ?? null,
            'cc_entries' => $entries,
            'source_platform' => self::PLATFORM_TYPE,
        ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Webhooks
    // ─────────────────────────────────────────────────────────────────────────

    public function normalizeWebhookEvent(string $protocolEvent): string
    {
        return match ($protocolEvent) {
            // CC state changes → Nexus events
            'transaction.completed', 'transaction.C' => 'transaction.completed',
            'transaction.validated', 'transaction.V' => 'transaction.requested',
            'transaction.erased', 'transaction.E'    => 'transaction.cancelled',
            'transaction.pending', 'transaction.P'   => 'transaction.requested',
            'transaction.scrubbed', 'transaction.X'  => 'transaction.cancelled',

            // Partnership events
            'node.connected'    => 'partnership.activated',
            'node.disconnected' => 'partnership.terminated',
            'node.suspended'    => 'partnership.suspended',

            default => $protocolEvent,
        };
    }

    public function normalizeWebhookPayload(array $rawPayload): array
    {
        $event = $rawPayload['event'] ?? $rawPayload['type'] ?? 'unknown';

        // CC webhooks may send the transaction directly as the payload
        $data = $rawPayload['data'] ?? $rawPayload;

        // If payload contains a CC transaction, extract key fields into Nexus format
        if (isset($data['uuid']) || isset($data['entries'])) {
            $tx = $this->transformInboundTransaction($data);
            $data = [
                'external_transaction_id' => $tx['external_transaction_id'],
                'amount' => $tx['amount_hours'],
                'description' => $tx['description'],
                'sender_id' => $tx['payer'],
                'recipient_id' => $tx['payee'],
                'cc_state' => $tx['cc_state'],
            ];
        }

        return [
            'event' => $this->normalizeWebhookEvent($event),
            'data'  => $data,
        ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Response unwrapping
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Unwrap a CC response.
     *
     * CC responses are generally flat or wrapped in {data: ..., meta: {...}}.
     * Transaction lists come back as arrays directly or with pagination metadata.
     */
    public function unwrapResponse(array $response, string $action = ''): array
    {
        // CC /about returns flat object
        if ($action === 'about' || $action === 'health') {
            return $response;
        }

        // CC transaction responses may include {data, meta} wrapper
        if (isset($response['data'])) {
            return is_array($response['data']) ? $response['data'] : $response;
        }

        return $response;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CC-specific helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Map CC single-letter state to Nexus status string.
     */
    public static function mapCcStateToNexus(string $ccState): string
    {
        return match ($ccState) {
            self::STATE_COMPLETED => 'completed',
            self::STATE_VALIDATED => 'pending',    // Validated = approved but not yet final
            self::STATE_PENDING   => 'pending',
            self::STATE_ERASED    => 'cancelled',
            self::STATE_SCRUBBED  => 'cancelled',
            default               => 'pending',
        };
    }

    /**
     * Map Nexus status to CC state letter.
     */
    public static function mapNexusStateToCc(string $nexusStatus): string
    {
        return match ($nexusStatus) {
            'completed' => self::STATE_COMPLETED,
            'pending'   => self::STATE_PENDING,
            'cancelled' => self::STATE_ERASED,
            'disputed'  => self::STATE_PENDING,
            default     => self::STATE_PENDING,
        };
    }

    /**
     * Check if a CC state transition is valid.
     */
    public static function isValidTransition(string $from, string $to): bool
    {
        return in_array($to, self::STATE_TRANSITIONS[$from] ?? [], true);
    }

    /**
     * Convert a Nexus user identifier to a CC account path.
     *
     * CC account paths are in the format "node-slug/username" where:
     *   - node-slug is the local node's identifier (3-15 chars, lowercase alphanumeric + hyphens)
     *   - username is the user's slug (same format)
     *
     * If the input already contains a '/', it's assumed to be a valid path and is
     * returned unchanged.
     *
     * If `$nodeSlug` is provided and the identifier has no '/', the node slug is
     * prepended to produce a fully-qualified CC account path. Without a node slug
     * the identifier is returned as-is (callers that know the node slug — such as
     * FederationCreditCommonsController::toAccountPath() — should always pass it).
     *
     * @param string $identifier  Username, numeric user ID, or already-qualified path
     * @param string $nodeSlug    The partner/local node slug (e.g. "my-timebank")
     */
    public static function toAccountPath(string $identifier, string $nodeSlug = ''): string
    {
        if (str_contains($identifier, '/')) {
            return $identifier; // already a fully-qualified path
        }

        if ($nodeSlug !== '') {
            return "{$nodeSlug}/{$identifier}";
        }

        // No node slug supplied, so the identifier is returned unqualified. This
        // is a formatting primitive, not an identity resolver: it cannot know
        // which node an account belongs to. Callers that DO know must pass
        // $nodeSlug, or use one of the resolvers that looks it up —
        // CreditCommonsNodeService::accountPathForUser() for a local member, or
        // FederationCreditCommonsController::toAccountPath() at the controller
        // boundary. Transaction payer/payee resolution lives in
        // self::resolveOutboundAccountPath(), which documents the one case that
        // is still unresolved (naming a remote partner's member).
        return $identifier;
    }

    /**
     * Extract the username portion from a CC account path.
     *
     * "my-node/alice123" → "alice123"
     * "alice123" → "alice123"
     */
    public static function extractUsername(string $accountPath): string
    {
        $parts = explode('/', $accountPath);
        return end($parts) ?: $accountPath;
    }

    /**
     * Extract the node slug from a CC account path.
     *
     * "my-node/alice123" → "my-node"
     * "alice123" → null (no node in path)
     */
    public static function extractNodeSlug(string $accountPath): ?string
    {
        if (!str_contains($accountPath, '/')) {
            return null;
        }

        $parts = explode('/', $accountPath);
        return $parts[0] ?: null;
    }

    /**
     * Generate virtual double-entry entries from a Nexus single-entry transaction.
     *
     * CC requires Entry objects per transaction. This generates them from Nexus's
     * single-entry model where we only have sender/receiver/amount.
     *
     * @param array $nexusTransaction Nexus transaction data
     * @return array Array of CC Entry objects
     */
    public static function generateEntries(array $nexusTransaction): array
    {
        return [
            [
                // Same resolution as transformOutboundTransaction() — these are
                // the ledger entries for the very same movement of credit, so
                // the two must never disagree about who paid whom.
                'payer' => self::resolveOutboundAccountPath($nexusTransaction, 'sender'),
                'payee' => self::resolveOutboundAccountPath($nexusTransaction, 'receiver'),
                'quant' => (float) ($nexusTransaction['amount'] ?? 0),
                'description' => $nexusTransaction['description'] ?? '',
                'state' => self::mapNexusStateToCc($nexusTransaction['status'] ?? 'pending'),
            ],
        ];
    }

    /**
     * Build a CC /about response from Nexus node metadata.
     *
     * Used when serving CC-compatible endpoints for inbound requests from CC nodes.
     *
     * @param array $nodeConfig Node configuration (name, exchange rate, etc.)
     * @return array CC /about response format
     */
    /**
     * Validate a remote hashchain value against the local chain for a tenant.
     *
     * Delegates to CreditCommonsNodeService which owns the hashchain state.
     * Returns true if the remote hash matches the local last-hash (or if either
     * side has no hash yet, which is the first-interaction bootstrap case).
     *
     * @param string|null $remoteHash Hash sent by the remote node via Last-hash header
     * @param int|null    $tenantId   Tenant scope (defaults to current context)
     */
    public static function validateHashchain(?string $remoteHash, ?int $tenantId = null): bool
    {
        return CreditCommonsNodeService::verifyHash($remoteHash, $tenantId);
    }

    public static function buildAboutResponse(array $nodeConfig): array
    {
        return [
            'format' => $nodeConfig['currency_format'] ?? '<quantity> hours',
            'rate' => (float) ($nodeConfig['exchange_rate'] ?? 1.0),
            'absolute_path' => $nodeConfig['absolute_path'] ?? [$nodeConfig['node_slug'] ?? 'nexus'],
            'validated_window' => (int) ($nodeConfig['validated_window'] ?? 300),
            'trades' => (int) ($nodeConfig['trade_count'] ?? 0),
            'traders' => (int) ($nodeConfig['trader_count'] ?? 0),
            'volume' => (float) ($nodeConfig['volume'] ?? 0),
            'accounts' => (int) ($nodeConfig['account_count'] ?? 0),
        ];
    }
}
