<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\AccountRelationship;
use App\Models\SupportPendingAction;
use App\Models\User;
use App\Support\Safeguarding\SupportTiers;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The co_decide confirm loop (guardian redesign, phase 3).
 *
 * A supporter holding `co_decide` for a capability prepares an action; it
 * executes only when the supported member confirms. Confirmation channels:
 * in-app (one click on the dashboard prompt or the Linked accounts tab), or a
 * single-use emailed token (read-only GET, confirming POST — copied from
 * `event_guardian_consents` so a mail scanner cannot confirm). Refusing is a
 * first-class answer and never requires a reason.
 *
 * Rules inherited from the proxy endpoints and kept here:
 * - Execution reuses the member's own code path (ListingService::create /
 *   WalletService::transfer) with the supporter as acting_user_id, so caps,
 *   guards, locks and idempotency are inherited, never re-implemented.
 * - The safeguarding contact policy is asserted at PREPARE time and again at
 *   CONFIRM time — a restriction landing between the two must win.
 * - Every transition is audited to org_audit_log and both parties are
 *   notified in their own language.
 *
 * All state transitions happen here, under a row lock, from `pending` only —
 * no other code writes these rows.
 */
class SupportPendingActionService
{
    /** Unconfirmed actions expire after this many days (owner-approved default). */
    public const EXPIRY_DAYS = 14;

    private array $errors = [];

    public function __construct(
        private readonly SupportPendingAction $pendingAction,
        private readonly SubAccountService $subAccounts,
    ) {}

    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * Prepare an action for the supported member to confirm.
     *
     * Requires the supporter to hold at least `co_decide` for the action's
     * capability. A `represent` holder may also use this path — preparing
     * rather than acting alone is always allowed, never required.
     *
     * @return array{id: int, token: string}|null Row id and the RAW token
     *         (returned once, only so the caller can build the email link;
     *         never stored).
     */
    public function prepare(int $supporterUserId, int $supportedUserId, string $actionType, array $payload): ?array
    {
        $this->errors = [];

        $capability = SupportPendingAction::TYPE_CAPABILITIES[$actionType] ?? null;
        if ($capability === null) {
            $this->errors[] = ['code' => 'INVALID_TYPE', 'message' => __('api.support_action_unknown_type')];
            return null;
        }

        /** @var AccountRelationship|null $relationship */
        $relationship = AccountRelationship::query()
            ->where('parent_user_id', $supporterUserId)
            ->where('child_user_id', $supportedUserId)
            ->where('status', 'active')
            ->first();

        if (! $relationship) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api_controllers_2.sub_account.no_permission')];
            return null;
        }

        $tiers = SupportTiers::resolve(is_array($relationship->permissions) ? $relationship->permissions : []);
        if (! SupportTiers::atLeast($tiers, $capability, SupportTiers::CO_DECIDE)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api_controllers_2.sub_account.no_permission')];
            return null;
        }

        try {
            $this->assertContactsAllowed($supporterUserId, $supportedUserId, 'support_action_prepare');
        } catch (\Throwable $e) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => $e->getMessage()];
            return null;
        }

        // Raw token exists only in memory and in the email link; the row keeps
        // its hash. 32 random bytes, hex — same strength as the event flow.
        $token = bin2hex(random_bytes(32));

        $action = $this->pendingAction->newQuery()->create([
            'tenant_id' => TenantContext::getId(),
            'relationship_id' => (int) $relationship->id,
            'supported_user_id' => $supportedUserId,
            'supporter_user_id' => $supporterUserId,
            'action_type' => $actionType,
            'payload' => $payload,
            'status' => SupportPendingAction::STATUS_PENDING,
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addDays(self::EXPIRY_DAYS),
        ]);

        $this->audit($supporterUserId, $supportedUserId, 'support_action_prepared', [
            'action_id' => $action->id,
            'action_type' => $actionType,
        ]);

        $this->notifySupportedOfPending($action, $token);

        return ['id' => (int) $action->id, 'token' => $token];
    }

    /**
     * The supported member confirms in-app. Executes the prepared action.
     *
     * @return array{result_id: int|null}|null
     */
    public function confirmInApp(int $supportedUserId, int $actionId): ?array
    {
        return $this->confirm(
            fn ($q) => $q->where('id', $actionId)->where('supported_user_id', $supportedUserId),
            'in_app',
        );
    }

    /**
     * Token confirmation (from the email link, no login required). The GET
     * lookup is {@see findByToken}; this is the POST that actually confirms.
     *
     * @return array{result_id: int|null}|null
     */
    public function confirmByToken(string $token): ?array
    {
        return $this->confirm(
            fn ($q) => $q->where('token_hash', hash('sha256', $token))->whereNull('token_consumed_at'),
            'email_token',
        );
    }

    /** Channels an offline confirmation can be attested through. */
    public const ATTEST_CHANNELS = ['phone', 'in_person', 'paper'];

    /**
     * A staff member records that the supported member confirmed OFFLINE — by
     * phone, in person, or on paper (guardian redesign, phase 4). This is the
     * path for members who will never click a link or open the app.
     *
     * Deliberately weaker evidence than the member's own click, and recorded
     * as such rather than dressed up: `confirmed_via` says 'attested_offline'
     * and the row names the attesting staff member, the channel, and the
     * witness. The supported member is notified that an offline confirmation
     * was recorded in their name — an attestation they never learn about is
     * substitution, not consent.
     *
     * AUTHORISATION IS THE CALLER'S JOB: the route sits behind the
     * broker-or-admin gate. This method only enforces the channel vocabulary
     * and the same locked pending-only confirm path as every other channel.
     *
     * @return array{result_id: int|null}|null
     */
    public function confirmAttested(int $staffUserId, int $actionId, string $channel, ?string $witness = null): ?array
    {
        if (! in_array($channel, self::ATTEST_CHANNELS, true)) {
            $this->errors = [['code' => 'VALIDATION_ERROR', 'message' => __('api.support_action_invalid_channel')]];
            return null;
        }

        $witness = ($witness !== null && trim($witness) !== '') ? mb_substr(trim($witness), 0, 160) : null;

        return $this->confirm(
            fn ($q) => $q->where('id', $actionId),
            'attested_offline',
            ['attested_by_user_id' => $staffUserId, 'attested_channel' => $channel, 'attested_witness' => $witness],
        );
    }

    /**
     * Read-only token lookup for the confirmation page. Deliberately separate
     * from confirmation so following the link changes nothing.
     */
    public function findByToken(string $token): ?SupportPendingAction
    {
        /** @var SupportPendingAction|null */
        return $this->pendingAction->newQuery()
            ->with(['supporterUser:id,first_name,last_name', 'supportedUser:id,first_name,last_name'])
            ->where('token_hash', hash('sha256', $token))
            ->first();
    }

    /**
     * The supported member declines. A reason is accepted and NEVER required —
     * requiring somebody to justify refusing is pressure to consent.
     */
    public function decline(int $supportedUserId, int $actionId, ?string $reason = null): bool
    {
        $this->errors = [];

        $done = DB::transaction(function () use ($supportedUserId, $actionId, $reason): bool {
            /** @var SupportPendingAction|null $action */
            $action = $this->pendingAction->newQuery()
                ->where('id', $actionId)
                ->where('supported_user_id', $supportedUserId)
                ->where('status', SupportPendingAction::STATUS_PENDING)
                ->lockForUpdate()
                ->first();

            if (! $action) {
                return false;
            }

            $action->status = SupportPendingAction::STATUS_DECLINED;
            $action->declined_at = now();
            $action->decline_reason = ($reason !== null && trim($reason) !== '') ? trim($reason) : null;
            $action->response_ip = request()?->ip();
            $action->response_user_agent = mb_substr((string) request()?->userAgent(), 0, 255);
            $action->save();

            $this->audit($action->supported_user_id, $action->supporter_user_id, 'support_action_declined', [
                'action_id' => $action->id,
                'action_type' => $action->action_type,
            ]);
            $this->notifySupporterOfAnswer($action, false);

            return true;
        });

        if (! $done) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.support_action_not_found')];
        }

        return $done;
    }

    /** The supporter withdraws their own prepared action before it is answered. */
    public function cancel(int $supporterUserId, int $actionId): bool
    {
        $this->errors = [];

        /** @var SupportPendingAction|null $action */
        $action = $this->pendingAction->newQuery()
            ->where('id', $actionId)
            ->where('supporter_user_id', $supporterUserId)
            ->where('status', SupportPendingAction::STATUS_PENDING)
            ->first();

        $updated = $action !== null && $this->pendingAction->newQuery()
            ->where('id', $actionId)
            ->where('status', SupportPendingAction::STATUS_PENDING)
            ->update([
                'status' => SupportPendingAction::STATUS_CANCELLED,
                'cancelled_at' => now(),
                'updated_at' => now(),
            ]) > 0;

        if (! $updated) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.support_action_not_found')];
            return false;
        }

        // The member was told something awaits their answer (bell + email with
        // a confirm link). Withdrawing silently left that prompt pointing at
        // nothing — a member could click a dead link, or worse, sit on a
        // decision that no longer exists. Bell-level: nothing is required of
        // them any more.
        $this->notifySupportedOfWithdrawal($action);

        return true;
    }

    /** Tell the supported member an unanswered action lapsed (bell-level). */
    private function notifySupportedOfExpiry(SupportPendingAction $action): void
    {
        try {
            $supporter = User::find($action->supporter_user_id);
            $supported = User::find($action->supported_user_id);
            $supporterName = $supporter ? trim($supporter->first_name . ' ' . $supporter->last_name) : '';

            LocaleContext::withLocale($supported, function () use ($action, $supporterName): void {
                NotificationDispatcher::dispatch(
                    (int) $action->supported_user_id,
                    'global',
                    0,
                    'support_action_lapsed',
                    __('svc_notifications.support_action.lapsed_bell', [
                        'name' => $supporterName,
                        'what' => __('svc_notifications.support_action.type_' . $action->action_type),
                    ]),
                    SubAccountService::LINKED_ACCOUNTS_LINK,
                    null,
                );
            });
        } catch (\Throwable $e) {
            Log::warning('Failed to notify supported member of expired support action', [
                'action_id' => $action->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /** Tell the supported member the prepared action was withdrawn. */
    private function notifySupportedOfWithdrawal(SupportPendingAction $action): void
    {
        try {
            $supporter = User::find($action->supporter_user_id);
            $supported = User::find($action->supported_user_id);
            $supporterName = $supporter ? trim($supporter->first_name . ' ' . $supporter->last_name) : '';

            LocaleContext::withLocale($supported, function () use ($action, $supporterName): void {
                NotificationDispatcher::dispatch(
                    (int) $action->supported_user_id,
                    'global',
                    0,
                    'support_action_withdrawn',
                    __('svc_notifications.support_action.withdrawn_bell', [
                        'name' => $supporterName,
                        'what' => __('svc_notifications.support_action.type_' . $action->action_type),
                    ]),
                    SubAccountService::LINKED_ACCOUNTS_LINK,
                    null,
                );
            });
        } catch (\Throwable $e) {
            Log::warning('Failed to notify supported member of withdrawn support action', [
                'action_id' => $action->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * The supported member's queue (newest first) and the supporter's own
     * prepared actions, for the two sides of the UI.
     *
     * @return array<int, array<string, mixed>>
     */
    public function listForSupported(int $supportedUserId, bool $pendingOnly = true): array
    {
        $query = $this->pendingAction->newQuery()
            ->with('supporterUser:id,first_name,last_name,avatar_url')
            ->where('supported_user_id', $supportedUserId);
        if ($pendingOnly) {
            $query->where('status', SupportPendingAction::STATUS_PENDING)->where('expires_at', '>', now());
        }

        return $query->orderByDesc('created_at')->limit(50)->get()->map(
            fn (SupportPendingAction $a) => $this->present($a),
        )->all();
    }

    /** @return array<int, array<string, mixed>> */
    public function listForSupporter(int $supporterUserId): array
    {
        return $this->pendingAction->newQuery()
            ->with('supportedUser:id,first_name,last_name,avatar_url')
            ->where('supporter_user_id', $supporterUserId)
            ->orderByDesc('created_at')
            ->limit(50)
            ->get()
            ->map(fn (SupportPendingAction $a) => $this->present($a))
            ->all();
    }

    /**
     * Every live pending action in the tenant, for the broker safeguarding
     * panel — staff need to see what awaits an answer before they can attest
     * an offline confirmation. Tenant scope comes from the model's global
     * scope; both parties' names are included.
     *
     * @return array<int, array<string, mixed>>
     */
    public function listPendingForTenant(): array
    {
        return $this->pendingAction->newQuery()
            ->with([
                'supporterUser:id,first_name,last_name',
                'supportedUser:id,first_name,last_name',
            ])
            ->where('status', SupportPendingAction::STATUS_PENDING)
            ->where('expires_at', '>', now())
            ->orderBy('created_at')
            ->limit(100)
            ->get()
            ->map(fn (SupportPendingAction $a) => $this->present($a))
            ->all();
    }

    public function pendingCountForSupported(int $supportedUserId): int
    {
        return $this->pendingAction->newQuery()
            ->where('supported_user_id', $supportedUserId)
            ->where('status', SupportPendingAction::STATUS_PENDING)
            ->where('expires_at', '>', now())
            ->count();
    }

    /**
     * Expire stale pending actions. Called by the scheduled command; both
     * parties are notified so an expiry is never silent.
     */
    public function expireStale(): int
    {
        $expired = 0;

        $this->pendingAction->newQuery()
            ->withoutGlobalScopes() // scheduler runs with no tenant; rows carry their own tenant_id
            ->where('status', SupportPendingAction::STATUS_PENDING)
            ->where('expires_at', '<=', now())
            ->orderBy('id')
            ->chunkById(100, function ($actions) use (&$expired): void {
                foreach ($actions as $action) {
                    /** @var SupportPendingAction $action */
                    $action->status = SupportPendingAction::STATUS_EXPIRED;
                    $action->save();
                    $expired++;

                    try {
                        TenantContext::runForTenant((int) $action->tenant_id, function () use ($action): void {
                            $this->notifySupporterOfAnswer($action, null);
                            // The docblock has always promised BOTH parties are
                            // notified; until 2026-08-07 only the supporter was.
                            // The member's bell/email still said something
                            // awaited their answer — tell them it lapsed.
                            $this->notifySupportedOfExpiry($action);
                        });
                    } catch (\Throwable $e) {
                        Log::warning('Failed to notify supporter of expired support action', [
                            'action_id' => $action->id,
                            'error' => $e->getMessage(),
                        ]);
                    }
                }
            });

        return $expired;
    }

    /**
     * Shared confirm path for both channels: row lock, pending + unexpired
     * only, contact policy re-asserted, then execution through the member's
     * own code path. Any execution failure leaves the row PENDING so the
     * member can retry — a confirmed-but-not-executed state must not exist.
     *
     * @param callable $scope Narrow the query to the authorised row.
     * @param array<string, mixed>|null $attested attested_by_user_id / channel / witness for offline attestation
     * @return array{result_id: int|null}|null
     */
    private function confirm(callable $scope, string $via, ?array $attested = null): ?array
    {
        $this->errors = [];

        try {
            return DB::transaction(function () use ($scope, $via, $attested): array {
                $query = $this->pendingAction->newQuery();
                if ($via === 'email_token') {
                    // Token arrives with no session, so no tenant context to
                    // scope by — the token IS the credential, and the row
                    // carries its tenant.
                    $query->withoutGlobalScopes();
                }
                $scope($query);

                /** @var SupportPendingAction|null $action */
                $action = $query->where('status', SupportPendingAction::STATUS_PENDING)
                    ->lockForUpdate()
                    ->first();

                if (! $action) {
                    throw new \RuntimeException(__('api.support_action_not_found'));
                }
                if ($action->expires_at !== null && $action->expires_at->isPast()) {
                    throw new \RuntimeException(__('api.support_action_expired'));
                }

                return TenantContext::runForTenant((int) $action->tenant_id, function () use ($action, $via, $attested): array {
                    // Use-time safeguarding re-check: a restriction that landed
                    // after preparation wins.
                    $this->assertContactsAllowed(
                        (int) $action->supporter_user_id,
                        (int) $action->supported_user_id,
                        'support_action_confirm',
                    );

                    $resultId = $this->execute($action);

                    $action->status = SupportPendingAction::STATUS_CONFIRMED;
                    $action->confirmed_at = now();
                    $action->confirmed_via = $via;
                    $action->result_id = $resultId;
                    if ($via === 'email_token') {
                        $action->token_consumed_at = now();
                    }
                    if ($attested !== null) {
                        $action->attested_by_user_id = $attested['attested_by_user_id'] ?? null;
                        $action->attested_channel = $attested['attested_channel'] ?? null;
                        $action->attested_witness = $attested['attested_witness'] ?? null;
                    }
                    $action->response_ip = request()?->ip();
                    $action->response_user_agent = mb_substr((string) request()?->userAgent(), 0, 255);
                    $action->save();

                    $this->audit($action->supported_user_id, $action->supporter_user_id, 'support_action_confirmed', [
                        'action_id' => $action->id,
                        'action_type' => $action->action_type,
                        'confirmed_via' => $via,
                        'result_id' => $resultId,
                    ] + ($attested ?? []));
                    $this->notifySupporterOfAnswer($action, true);
                    if ($attested !== null) {
                        // The member must learn an offline confirmation was
                        // recorded in their name — silence here would turn an
                        // attestation into substitution.
                        $this->notifySupportedOfAttestation($action);
                    }

                    return ['result_id' => $resultId];
                });
            });
        } catch (\Throwable $e) {
            $this->errors[] = ['code' => 'CONFIRM_FAILED', 'message' => $e->getMessage()];
            return null;
        }
    }

    /**
     * Run the prepared action through the member's own code path, attributed
     * to the supporter. Throws on failure (rolls the confirm back).
     */
    private function execute(SupportPendingAction $action): ?int
    {
        $payload = is_array($action->payload) ? $action->payload : [];

        switch ($action->action_type) {
            case SupportPendingAction::TYPE_LISTING_CREATE:
                $listing = ListingService::create(
                    (int) $action->supported_user_id,
                    $payload,
                    (int) $action->supporter_user_id,
                );

                return (int) $listing->id;

            case SupportPendingAction::TYPE_CREDIT_TRANSFER:
                $txn = app(WalletService::class)->transfer(
                    (int) $action->supported_user_id,
                    $payload,
                    (int) $action->supporter_user_id,
                );

                return isset($txn['id']) ? (int) $txn['id'] : null;
        }

        throw new \RuntimeException(__('api.support_action_unknown_type'));
    }

    /** @return array<string, mixed> The API shape both frontends render. */
    private function present(SupportPendingAction $a): array
    {
        $other = $a->relationLoaded('supporterUser') && $a->supporterUser
            ? $a->supporterUser
            : ($a->relationLoaded('supportedUser') ? $a->supportedUser : null);

        return [
            'id' => (int) $a->id,
            'action_type' => $a->action_type,
            'status' => $a->status,
            'payload_summary' => $this->summarisePayload($a),
            'supporter_user_id' => (int) $a->supporter_user_id,
            'supported_user_id' => (int) $a->supported_user_id,
            'other_party_name' => $other ? trim($other->first_name . ' ' . $other->last_name) : null,
            'other_party_avatar_url' => $other->avatar_url ?? null,
            // Both names, for views (the broker panel) that show both sides.
            'supporter_name' => $a->relationLoaded('supporterUser') && $a->supporterUser
                ? trim($a->supporterUser->first_name . ' ' . $a->supporterUser->last_name)
                : null,
            'supported_name' => $a->relationLoaded('supportedUser') && $a->supportedUser
                ? trim($a->supportedUser->first_name . ' ' . $a->supportedUser->last_name)
                : null,
            'created_at' => $a->created_at?->toIso8601String(),
            'expires_at' => $a->expires_at?->toIso8601String(),
            'confirmed_via' => $a->confirmed_via,
            'result_id' => $a->result_id,
        ];
    }

    /**
     * A safe, minimal description of what was prepared — enough for the
     * member to decide, without dumping the raw payload into every list.
     *
     * @return array<string, mixed>
     */
    private function summarisePayload(SupportPendingAction $a): array
    {
        $payload = is_array($a->payload) ? $a->payload : [];

        return match ($a->action_type) {
            SupportPendingAction::TYPE_LISTING_CREATE => [
                'title' => isset($payload['title']) ? (string) $payload['title'] : null,
                'listing_type' => isset($payload['type']) ? (string) $payload['type'] : null,
            ],
            SupportPendingAction::TYPE_CREDIT_TRANSFER => [
                'amount' => isset($payload['amount']) ? (float) $payload['amount'] : null,
                'recipient_id' => isset($payload['recipient_id']) ? (int) $payload['recipient_id'] : null,
            ],
            default => [],
        };
    }

    private function assertContactsAllowed(int $supporterUserId, int $supportedUserId, string $channel): void
    {
        $policy = app(SafeguardingInteractionPolicy::class);
        $tenantId = TenantContext::getId();

        $policy->assertLocalContactAllowed($supporterUserId, $supportedUserId, $tenantId, $channel);
        $policy->assertLocalContactAllowed($supportedUserId, $supporterUserId, $tenantId, $channel);
    }

    private function audit(int $actorUserId, int $otherUserId, string $action, array $details): void
    {
        try {
            app(AuditLogService::class)->logAction(
                TenantContext::getId(),
                $action,
                $actorUserId,
                $details,
                null,
                $otherUserId,
            );
        } catch (\Throwable $e) {
            Log::error('Failed to audit support pending action', [
                'action' => $action,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Tell the supported member something awaits their answer — bell + email
     * (with the single-use confirm link) + push, in THEIR language.
     */
    private function notifySupportedOfPending(SupportPendingAction $action, string $token): void
    {
        try {
            $supporter = User::find($action->supporter_user_id);
            $supported = User::find($action->supported_user_id);
            $supporterName = $supporter ? trim($supporter->first_name . ' ' . $supporter->last_name) : '';

            LocaleContext::withLocale($supported, function () use ($action, $token, $supporterName): void {
                NotificationDispatcher::dispatch(
                    (int) $action->supported_user_id,
                    'global',
                    0,
                    'support_action_pending',
                    __('svc_notifications.support_action.pending', [
                        'name' => $supporterName,
                        'what' => __('svc_notifications.support_action.type_' . $action->action_type),
                    ]),
                    SubAccountService::LINKED_ACCOUNTS_LINK,
                    NotificationDispatcher::buildSupportActionPendingEmail($supporterName, $action, $token),
                    false,
                    // No actor id, deliberately — same decision as the linked-account
                    // request/approval dispatches: an actor id applies the recipient's
                    // mute list, and a pending action silently dropped would just
                    // expire without the member ever knowing it existed.
                );
            });
        } catch (\Throwable $e) {
            Log::warning('Failed to notify supported member of pending support action', [
                'action_id' => $action->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Tell the SUPPORTED MEMBER that a staff member recorded their offline
     * confirmation — bell + email + push, in their language. If the record is
     * wrong, this notice is how they find out and can raise it.
     */
    private function notifySupportedOfAttestation(SupportPendingAction $action): void
    {
        try {
            $attester = $action->attested_by_user_id !== null ? User::find($action->attested_by_user_id) : null;
            $supported = User::find($action->supported_user_id);
            $attesterName = $attester ? trim($attester->first_name . ' ' . $attester->last_name) : '';

            LocaleContext::withLocale($supported, function () use ($action, $attesterName): void {
                NotificationDispatcher::dispatch(
                    (int) $action->supported_user_id,
                    'global',
                    0,
                    'support_action_attested',
                    __('svc_notifications.support_action.attested', [
                        'name' => $attesterName,
                        'what' => __('svc_notifications.support_action.type_' . $action->action_type),
                        'channel' => __('svc_notifications.support_action.channel_' . (string) $action->attested_channel),
                    ]),
                    SubAccountService::LINKED_ACCOUNTS_LINK,
                    NotificationDispatcher::buildSupportActionAnswerEmail($attesterName, $action, 'attested'),
                    false,
                    // No actor id — see notifySupportedOfPending().
                );
            });
        } catch (\Throwable $e) {
            Log::warning('Failed to notify supported member of attested confirmation', [
                'action_id' => $action->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Tell the supporter how it ended. $confirmed: true = confirmed,
     * false = declined (any reason travels), null = expired.
     */
    private function notifySupporterOfAnswer(SupportPendingAction $action, ?bool $confirmed): void
    {
        try {
            $supported = User::find($action->supported_user_id);
            $supporter = User::find($action->supporter_user_id);
            $supportedName = $supported ? trim($supported->first_name . ' ' . $supported->last_name) : '';

            $outcomeKey = match ($confirmed) {
                true => 'confirmed',
                false => 'declined',
                null => 'expired',
            };

            LocaleContext::withLocale($supporter, function () use ($action, $supportedName, $outcomeKey): void {
                NotificationDispatcher::dispatch(
                    (int) $action->supporter_user_id,
                    'global',
                    0,
                    'support_action_' . $outcomeKey,
                    __('svc_notifications.support_action.' . $outcomeKey, [
                        'name' => $supportedName,
                        'what' => __('svc_notifications.support_action.type_' . $action->action_type),
                    ]),
                    SubAccountService::LINKED_ACCOUNTS_LINK,
                    NotificationDispatcher::buildSupportActionAnswerEmail($supportedName, $action, $outcomeKey),
                    false,
                    // No actor id — see notifySupportedOfPending().
                );
            });
        } catch (\Throwable $e) {
            Log::warning('Failed to notify supporter of support action outcome', [
                'action_id' => $action->id,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
