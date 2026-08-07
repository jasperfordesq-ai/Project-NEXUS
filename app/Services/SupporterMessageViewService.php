<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Support\Safeguarding\SupportTiers;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * SupporterMessageViewService — a supporter's READ-ONLY window onto a
 * supported member's conversations (messages tier ≥ assist, consent-gated;
 * see SubAccountService::applyConsentedMessageAccess for how the tier rises).
 *
 * Design rules, each of which is a boundary test:
 *
 * - Fetches run AS THE MEMBER via MessageService, so the supporter sees
 *   exactly what the member sees: per-user delete filters, archiving, the
 *   lot. A message the member deleted for themselves is invisible here even
 *   though the other participant still has it.
 * - 🔴 NEVER marks anything read. markAsRead lives in MessagesController's
 *   own show() path, not in MessageService::getMessages — this service
 *   simply never calls it. The member's unread counts are their private
 *   state; a supporter's visit must leave no trace on them.
 * - `unread_count` is stripped from the list payload for the same reason.
 * - Federated conversations are excluded outright: the remote counterparty
 *   can never be shown the counterparty notice, so they can never be read
 *   under this capability.
 * - The safeguarding contact policy is re-asserted on EVERY read — a
 *   restriction landing after consent wins immediately.
 * - Every request writes one immutable audit row (mandatory purpose) BEFORE
 *   data is returned. No audit row, no data.
 */
class SupporterMessageViewService
{
    private array $errors = [];

    public function __construct(
        private readonly SubAccountService $subAccounts,
    ) {}

    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * The supported member's conversation list, as they see it (minus their
     * private unread counts). Null with errors on refusal.
     *
     * @return array<int, array<string, mixed>>|null
     */
    public function listConversations(int $supporterUserId, int $supportedUserId, string $purpose, array $filters = []): ?array
    {
        if (! $this->authorize($supporterUserId, $supportedUserId, $purpose)) {
            return null;
        }

        $this->audit($supporterUserId, $supportedUserId, null, 'list', $purpose);

        // getConversations returns a paging envelope: ['items' => rows, 'cursor', 'has_more'].
        $payload = MessageService::getConversations($supportedUserId, $filters);

        // Rows can contain non-array entries (e.g. a partner row that failed
        // hydration maps to null) — drop them rather than crash.
        return array_values(array_map(static function (array $conversation): array {
            unset($conversation['unread_count']);
            return $conversation;
        }, array_filter($payload['items'] ?? [], 'is_array')));
    }

    /**
     * One thread, as the member sees it. Read-only: nothing is marked read.
     *
     * @return array<string, mixed>|null
     */
    public function viewThread(int $supporterUserId, int $supportedUserId, int $partnerUserId, string $purpose, array $filters = []): ?array
    {
        if (! $this->authorize($supporterUserId, $supportedUserId, $purpose)) {
            return null;
        }

        $this->audit($supporterUserId, $supportedUserId, $partnerUserId, 'read', $purpose);

        $payload = MessageService::getMessages($partnerUserId, $supportedUserId, $filters);
        if ($payload === null) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.user_not_found')];
            return null;
        }

        // Belt over MessageService's own filter: federated rows must never
        // surface here (their counterparty can never receive the notice).
        $payload['items'] = array_values(array_filter(
            $payload['items'] ?? [],
            static fn ($m) => ! (bool) (is_array($m) ? ($m['is_federated'] ?? false) : false),
        ));

        return $payload;
    }

    /**
     * The transparency counterpart: when the SUPPORTED MEMBER asks, tell them
     * when their supporter last looked and how often. Their own data — no
     * gate beyond being a party to the relationship.
     *
     * @return array{last_viewed_at: string|null, view_count_30d: int}
     */
    public function viewStatsForMember(int $supportedUserId, int $relationshipId): array
    {
        $row = DB::table('supporter_message_view_audits')
            ->where('tenant_id', TenantContext::getId())
            ->where('relationship_id', $relationshipId)
            ->where('supported_user_id', $supportedUserId)
            ->selectRaw('MAX(created_at) as last_viewed_at, SUM(created_at >= ?) as recent', [now()->subDays(30)])
            ->first();

        return [
            // Raw DATETIME has no timezone marker; browsers parse it as local
            // time and misreport the age. Emit ISO-8601 UTC instead.
            'last_viewed_at' => $row?->last_viewed_at
                ? \Illuminate\Support\Carbon::parse($row->last_viewed_at, 'UTC')->toIso8601String()
                : null,
            'view_count_30d' => (int) ($row?->recent ?? 0),
        ];
    }

    /**
     * Gate: purpose present, active relationship, messages tier ≥ assist
     * (tier vocabulary ONLY — hasPermission('can_view_messages') stays
     * hard-false forever), and the safeguarding contact policy re-asserted
     * at read time.
     */
    private function authorize(int $supporterUserId, int $supportedUserId, string $purpose): bool
    {
        $this->errors = [];

        if (trim($purpose) === '' || mb_strlen($purpose) > 500) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.supporter_message_view_purpose_required')];
            return false;
        }

        $tiers = $this->subAccounts->resolvedTiers($supporterUserId, $supportedUserId);
        if ($tiers === null || ! SupportTiers::atLeast($tiers, 'messages', SupportTiers::ASSIST)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api_controllers_2.sub_account.no_permission')];
            return false;
        }

        try {
            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                $supporterUserId,
                $supportedUserId,
                TenantContext::getId(),
                'supporter_message_view',
            );
        } catch (\Throwable $e) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => $e->getMessage()];
            return false;
        }

        return true;
    }

    /**
     * One immutable row per request, written BEFORE data returns. A failure
     * here refuses the read: an unauditable view must not happen.
     */
    private function audit(int $supporterUserId, int $supportedUserId, ?int $partnerUserId, string $action, string $purpose): void
    {
        $relationshipId = (int) DB::table('account_relationships')
            ->where('tenant_id', TenantContext::getId())
            ->where('parent_user_id', $supporterUserId)
            ->where('child_user_id', $supportedUserId)
            ->where('status', 'active')
            ->value('id');

        DB::table('supporter_message_view_audits')->insert([
            'tenant_id' => TenantContext::getId(),
            'relationship_id' => $relationshipId,
            'supporter_user_id' => $supporterUserId,
            'supported_user_id' => $supportedUserId,
            'partner_user_id' => $partnerUserId,
            'action' => $action,
            'purpose' => mb_substr(trim($purpose), 0, 500),
            'correlation_hash' => hash('sha256', implode('|', [
                $supporterUserId, $supportedUserId, (string) $partnerUserId, trim($purpose), now()->toDateString(),
            ])),
            'created_at' => now(),
        ]);
    }
}
