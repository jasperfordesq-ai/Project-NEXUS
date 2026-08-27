<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * GroupExchangeService — Native Laravel implementation for group time exchanges.
 *
 * Manages multi-participant time credit exchanges with equal, custom, or weighted splits.
 * Tables: group_exchanges, group_exchange_participants
 */
class GroupExchangeService
{
    private ?SafeguardingInteractionDecision $lastContactRestriction = null;

    public function __construct()
    {
    }

    /**
     * Create a new group exchange.
     */
    public function create(int $organizerId, array $data): ?int
    {
        $this->lastContactRestriction = null;
        $tenantId = TenantContext::getId();
        $participants = [];
        foreach (is_array($data['participants'] ?? null) ? $data['participants'] : [] as $participant) {
            $userId = (int) ($participant['user_id'] ?? 0);
            $role = trim((string) ($participant['role'] ?? ''));
            if ($userId <= 0 || $role === '') {
                continue;
            }
            $participants[$userId . ':' . $role] = [
                'user_id' => $userId,
                'role' => $role,
                'hours' => (float) ($participant['hours'] ?? 0),
                'weight' => (float) ($participant['weight'] ?? 1.0),
            ];
        }

        $contactIds = array_values(array_unique(array_merge(
            [$organizerId],
            array_column($participants, 'user_id'),
        )));
        $tenantUserCount = (int) DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereIn('id', $contactIds)
            ->count();
        $restriction = $this->firstContactRestriction($contactIds, $tenantId, 'group_exchange_create');
        if ($tenantUserCount !== count($contactIds) || $restriction !== null) {
            $this->lastContactRestriction = $restriction;
            return null;
        }

        return DB::transaction(function () use ($tenantId, $organizerId, $data, $participants): int {
            $id = (int) DB::table('group_exchanges')->insertGetId([
                'tenant_id'    => $tenantId,
                'title'        => trim($data['title'] ?? ''),
                'description'  => trim($data['description'] ?? '') ?: null,
                'organizer_id' => $organizerId,
                'listing_id'   => $data['listing_id'] ?? null,
                'status'       => $data['status'] ?? 'draft',
                'split_type'   => $data['split_type'] ?? 'equal',
                'total_hours'  => (float) ($data['total_hours'] ?? 0),
                'broker_id'    => $data['broker_id'] ?? null,
                'broker_notes' => $data['broker_notes'] ?? null,
                'created_at'   => now(),
                'updated_at'   => now(),
            ]);

            foreach ($participants as $participant) {
                DB::table('group_exchange_participants')->insert([
                    'group_exchange_id' => $id,
                    'user_id' => $participant['user_id'],
                    'role' => $participant['role'],
                    'hours' => $participant['hours'],
                    'weight' => $participant['weight'],
                    'confirmed' => 0,
                    'created_at' => now(),
                ]);
            }

            return $id;
        });
    }

    /**
     * Get a single exchange by ID with its participants.
     */
    public function get(int $id): ?array
    {
        $tenantId = TenantContext::getId();

        $exchange = DB::table('group_exchanges')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $exchange) {
            return null;
        }

        $participants = DB::table('group_exchange_participants as p')
            ->join('users as u', function ($join) use ($tenantId) {
                $join->on('p.user_id', '=', 'u.id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('p.group_exchange_id', $id)
            ->orderBy('p.id')
            ->select([
                'p.id as participant_id',
                'p.group_exchange_id',
                'p.user_id',
                'p.role',
                'p.hours',
                'p.weight',
                'p.confirmed',
                'p.confirmed_at',
                'p.notes',
                'p.created_at',
                'u.first_name',
                'u.last_name', 'u.profile_type', 'u.organization_name',
                'u.avatar_url',
                'u.email',
            ])
            ->get();

        // The React detail page reads user_name / user_avatar / user_email. Keep the
        // legacy name / avatar_url keys too so any other consumer is unaffected.
        $participantList = $participants->map(function ($p) {
            $fullName = UserDisplayName::resolve($p);

            return [
                'id'                => (int) $p->participant_id,
                'group_exchange_id' => (int) $p->group_exchange_id,
                'user_id'           => (int) $p->user_id,
                'name'              => $fullName,
                'user_name'         => $fullName,
                'avatar_url'        => $p->avatar_url,
                'user_avatar'       => $p->avatar_url,
                'user_email'        => $p->email,
                'role'              => $p->role,
                'hours'             => (float) $p->hours,
                'weight'            => (float) $p->weight,
                'confirmed'         => (bool) $p->confirmed,
                'confirmed_at'      => $p->confirmed_at,
                'notes'             => $p->notes,
                'created_at'        => $p->created_at,
            ];
        })->all();

        $organizer = DB::table('users')
            ->where('id', $exchange->organizer_id)
            ->where('tenant_id', $tenantId)
            ->select(['first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url'])
            ->first();

        $organizerName = $organizer
            ? UserDisplayName::resolve($organizer)
            : '';

        return [
            'id'                => (int) $exchange->id,
            'tenant_id'         => (int) $exchange->tenant_id,
            'title'             => $exchange->title,
            'description'       => $exchange->description,
            'organizer_id'      => (int) $exchange->organizer_id,
            'organizer_name'    => $organizerName,
            'organizer_avatar'  => $organizer->avatar_url ?? null,
            'listing_id'        => $exchange->listing_id ? (int) $exchange->listing_id : null,
            'status'            => $exchange->status,
            'split_type'        => $exchange->split_type,
            'total_hours'       => (float) $exchange->total_hours,
            'broker_id'         => $exchange->broker_id ? (int) $exchange->broker_id : null,
            'broker_notes'      => $exchange->broker_notes,
            'completed_at'      => $exchange->completed_at,
            'created_at'        => $exchange->created_at,
            'updated_at'        => $exchange->updated_at,
            'participant_count' => count($participantList),
            'participants'      => $participantList,
        ];
    }

    /**
     * List exchanges for a user (as organizer or participant).
     *
     * @return array{items: array, has_more: bool}
     */
    public function listForUser(int $userId, array $filters = []): array
    {
        $tenantId = TenantContext::getId();
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $offset = (int) ($filters['offset'] ?? 0);

        $query = DB::table('group_exchanges as e')
            ->leftJoin('users as org', function ($join) use ($tenantId) {
                $join->on('org.id', '=', 'e.organizer_id')
                    ->where('org.tenant_id', '=', $tenantId);
            })
            ->where('e.tenant_id', $tenantId)
            ->where(function ($q) use ($userId) {
                $q->where('e.organizer_id', $userId)
                  ->orWhereExists(function ($sub) use ($userId) {
                      $sub->select(DB::raw(1))
                          ->from('group_exchange_participants')
                          ->whereColumn('group_exchange_participants.group_exchange_id', 'e.id')
                          ->where('group_exchange_participants.user_id', $userId);
                  });
            })
            ->select([
                'e.id',
                'e.title',
                'e.description',
                'e.organizer_id',
                'e.status',
                'e.split_type',
                'e.total_hours',
                'e.created_at',
                'e.updated_at',
                'e.completed_at',
                'org.first_name as organizer_first_name',
                'org.last_name as organizer_last_name', 'org.profile_type as organizer_profile_type', 'org.organization_name as organizer_organization_name',
                'org.avatar_url as organizer_avatar',
                DB::raw('(SELECT COUNT(*) FROM group_exchange_participants gp WHERE gp.group_exchange_id = e.id) as participant_count'),
            ]);

        if (! empty($filters['status'])) {
            $query->where('e.status', $filters['status']);
        }

        $query->orderByDesc('e.id');

        $exchanges = $query->offset($offset)->limit($limit + 1)->get();

        $hasMore = $exchanges->count() > $limit;
        if ($hasMore) {
            $exchanges->pop();
        }

        $items = $exchanges->map(fn ($e) => [
            'id'                => (int) $e->id,
            'title'             => $e->title,
            'description'       => $e->description,
            'organizer_id'      => (int) $e->organizer_id,
            'organizer_name'    => UserDisplayName::resolvePrefixed($e, 'organizer_'),
            'organizer_avatar'  => $e->organizer_avatar,
            'status'            => $e->status,
            'split_type'        => $e->split_type,
            'total_hours'       => (float) $e->total_hours,
            'participant_count' => (int) $e->participant_count,
            'created_at'        => $e->created_at,
            'updated_at'        => $e->updated_at,
            'completed_at'      => $e->completed_at,
        ])->all();

        return [
            'items'    => $items,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Add a participant to an exchange.
     */
    public function addParticipant(int $exchangeId, int $userId, string $role, float $hours = 0, float $weight = 1.0): bool
    {
        $this->lastContactRestriction = null;
        $tenantId = TenantContext::getId();
        $exchange = DB::table('group_exchanges')
            ->where('id', $exchangeId)
            ->where('tenant_id', $tenantId)
            ->first(['organizer_id']);
        if (! $exchange) {
            return false;
        }

        $targetExists = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->exists();
        if (! $targetExists) {
            return false;
        }

        // Check if already exists
        $exists = DB::table('group_exchange_participants')
            ->where('group_exchange_id', $exchangeId)
            ->where('user_id', $userId)
            ->where('role', $role)
            ->exists();

        if ($exists) {
            return false;
        }

        // Broker-approval preferences are evaluated directly and remain
        // separate from administrative message monitoring.
        $hasSafeguardingRestriction = SafeguardingTriggerService::requiresBrokerApproval($userId, $tenantId);

        if ($hasSafeguardingRestriction) {
            Log::info('[GroupExchange] Blocked: participant has safeguarding restrictions', [
                'exchange_id' => $exchangeId,
                'user_id' => $userId,
            ]);
            return false;
        }

        $existingUserIds = DB::table('group_exchange_participants')
            ->where('group_exchange_id', $exchangeId)
            ->pluck('user_id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
        $contactIds = array_values(array_unique(array_merge(
            [(int) $exchange->organizer_id, $userId],
            $existingUserIds,
        )));
        $restriction = $this->firstContactRestriction($contactIds, $tenantId, 'group_exchange_add_participant');
        if ($restriction !== null) {
            $this->lastContactRestriction = $restriction;
            return false;
        }

        DB::table('group_exchange_participants')->insert([
            'group_exchange_id' => $exchangeId,
            'user_id'           => $userId,
            'role'              => $role,
            'hours'             => $hours,
            'weight'            => $weight,
            'confirmed'         => 0,
            'created_at'        => now(),
        ]);

        return true;
    }

    public function getLastContactRestriction(): ?SafeguardingInteractionDecision
    {
        return $this->lastContactRestriction;
    }

    /**
     * Remove a participant from an exchange.
     */
    public function removeParticipant(int $exchangeId, int $userId): bool
    {
        $deleted = DB::table('group_exchange_participants')
            ->where('group_exchange_id', $exchangeId)
            ->where('user_id', $userId)
            ->delete();

        return $deleted > 0;
    }

    /**
     * Calculate the hour split for an exchange based on its split type.
     *
     * @return array<int, array{user_id: int, role: string, hours: float}>
     */
    public function calculateSplit(int $exchangeId): array
    {
        $tenantId = TenantContext::getId();

        $exchange = DB::table('group_exchanges')
            ->where('id', $exchangeId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $exchange) {
            return [];
        }

        $participants = DB::table('group_exchange_participants')
            ->where('group_exchange_id', $exchangeId)
            ->get();

        if ($participants->isEmpty()) {
            return [];
        }

        $totalHours = (float) $exchange->total_hours;
        $splitType = $exchange->split_type;

        $result = [];

        if ($splitType === 'custom') {
            // Custom: each participant already has their hours set
            foreach ($participants as $p) {
                $result[] = [
                    'user_id' => (int) $p->user_id,
                    'role'    => $p->role,
                    'hours'   => (float) $p->hours,
                ];
            }
        } elseif ($splitType === 'weighted') {
            // Weighted: distribute total_hours proportionally by weight within each role.
            // The LAST participant in each role absorbs the rounding remainder so the
            // role's shares sum to total_hours EXACTLY — otherwise independent per-role
            // rounding makes provider-credits != receiver-debits, minting or destroying
            // credits on completion (a conservation violation).
            $byRole = $participants->groupBy('role');

            foreach ($byRole as $roleParticipants) {
                $totalWeight = $roleParticipants->sum('weight');
                if ($totalWeight <= 0) {
                    $totalWeight = $roleParticipants->count();
                }

                $count = $roleParticipants->count();
                $allocated = 0.0;
                $idx = 0;
                foreach ($roleParticipants as $p) {
                    $idx++;
                    if ($idx === $count) {
                        $hours = round($totalHours - $allocated, 2);
                    } else {
                        $weight = (float) ($p->weight ?: 1.0);
                        $hours = round(($weight / $totalWeight) * $totalHours, 2);
                        $allocated += $hours;
                    }

                    $result[] = [
                        'user_id' => (int) $p->user_id,
                        'role'    => $p->role,
                        'hours'   => $hours,
                    ];
                }
            }
        } else {
            // Equal: split total_hours equally within each role. The LAST participant
            // in each role absorbs the rounding remainder so the role sums to
            // total_hours EXACTLY (see weighted note above on conservation).
            $byRole = $participants->groupBy('role');

            foreach ($byRole as $roleParticipants) {
                $count = $roleParticipants->count();
                $hoursEach = $count > 0 ? round($totalHours / $count, 2) : 0;

                $idx = 0;
                foreach ($roleParticipants as $p) {
                    $idx++;
                    $hours = ($idx === $count)
                        ? round($totalHours - $hoursEach * ($count - 1), 2)
                        : $hoursEach;

                    $result[] = [
                        'user_id' => (int) $p->user_id,
                        'role'    => $p->role,
                        'hours'   => $hours,
                    ];
                }
            }
        }

        return $result;
    }

    /**
     * Conservation guard: the credits complete() would give providers must equal
     * the debits it would take from receivers, or completing the exchange changes
     * the total credits in circulation. Equal/weighted splits are derived from
     * total_hours per role so they conserve by construction, but a CUSTOM split
     * returns whatever hours each participant was added with — unvalidated, an
     * organizer could set provider=100h / receiver=1h and mint 99 credits on
     * completion. Totals are computed exactly as complete() applies them (rounded
     * to 2dp, entries <= 0 skipped) so a negative-hours row can't disguise an
     * imbalance that a plain SUM() would miss.
     *
     * @param array<int, array{user_id: int, role: string, hours: float}> $split
     * @return string|null translated rejection message, or null when balanced
     */
    private function splitImbalanceError(array $split): ?string
    {
        $credits = 0.0;
        $debits = 0.0;

        foreach ($split as $entry) {
            $hours = round((float) $entry['hours'], 2);
            if ($hours <= 0) {
                continue;
            }
            if ($entry['role'] === 'provider') {
                $credits += $hours;
            } else {
                $debits += $hours;
            }
        }

        // Both sums are multiples of 0.01, so any true imbalance is >= 0.01;
        // 0.005 only tolerates float accumulation noise.
        if (abs($credits - $debits) > 0.005) {
            return __('api.group_exchange_split_unbalanced', [
                'credits' => number_format($credits, 2, '.', ''),
                'debits'  => number_format($debits, 2, '.', ''),
            ]);
        }

        return null;
    }

    /**
     * Update an exchange's fields.
     */
    public function update(int $id, array $data): bool
    {
        $tenantId = TenantContext::getId();

        $allowed = ['title', 'description', 'split_type', 'total_hours', 'broker_id', 'broker_notes', 'listing_id'];
        $updates = collect($data)->only($allowed)->filter(fn ($v) => $v !== null)->all();

        if (empty($updates)) {
            return true;
        }

        $updates['updated_at'] = now();

        $affected = DB::table('group_exchanges')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($updates);

        return $affected >= 0;
    }

    /**
     * Update the status of an exchange.
     */
    public function updateStatus(int $id, string $status): bool
    {
        $tenantId = TenantContext::getId();

        $updates = [
            'status'     => $status,
            'updated_at' => now(),
        ];

        if ($status === 'completed') {
            $updates['completed_at'] = now();
        }

        $affected = DB::table('group_exchanges')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($updates);

        return $affected > 0;
    }

    /**
     * Start an exchange: move it out of draft into pending_confirmation so
     * participants can confirm. Requires at least one provider and one receiver.
     *
     * Status changes never go through update() (its allow-list excludes status on
     * purpose); they flow through controlled transitions like this one, confirm(),
     * complete() and cancel so the state machine stays well-defined.
     *
     * @return array{success: bool, error?: string}
     */
    public function start(int $exchangeId): array
    {
        $tenantId = TenantContext::getId();

        $exchange = DB::table('group_exchanges')
            ->where('id', $exchangeId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $exchange) {
            return ['success' => false, 'error' => __('api.group_exchange_not_found')];
        }

        if (! in_array($exchange->status, ['draft', 'pending_participants'], true)) {
            return ['success' => false, 'error' => __('api.group_exchange_cannot_start')];
        }

        $roleCounts = DB::table('group_exchange_participants')
            ->where('group_exchange_id', $exchangeId)
            ->selectRaw("SUM(role = 'provider') as providers, SUM(role = 'receiver') as receivers")
            ->first();

        $providers = (int) ($roleCounts->providers ?? 0);
        $receivers = (int) ($roleCounts->receivers ?? 0);

        if ($providers < 1 || $receivers < 1) {
            return ['success' => false, 'error' => __('api.group_exchange_start_needs_participants')];
        }

        // Reject an unbalanced split up front so the organizer hears about it
        // before participants are asked to confirm. complete() re-checks — the
        // split can still change after start (update() allows split_type edits).
        $imbalance = $this->splitImbalanceError($this->calculateSplit($exchangeId));
        if ($imbalance !== null) {
            return ['success' => false, 'error' => $imbalance];
        }

        $participantIds = DB::table('group_exchange_participants')
            ->where('group_exchange_id', $exchangeId)
            ->pluck('user_id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
        $restriction = $this->firstContactRestriction(
            array_values(array_unique(array_merge([(int) $exchange->organizer_id], $participantIds))),
            $tenantId,
            'group_exchange_start',
        );
        if ($restriction !== null) {
            $error = MessageService::buildSafeguardingError([
                'code' => $restriction->code,
                'required_vetting_types' => $restriction->requiredAttestationCodes,
                'required_vetting_labels' => $restriction->requiredAttestationLabels,
            ]);

            return [
                'success' => false,
                'code' => $restriction->code,
                'error' => (string) $error['message'],
            ];
        }

        $this->updateStatus($exchangeId, 'pending_confirmation');

        // Bell + push + email each participant that the exchange is live and awaiting
        // their confirmation. Fail-safe: a notification failure never unwinds the start.
        $this->notifyParticipantsToConfirm($exchangeId, (string) $exchange->title, $tenantId);

        return ['success' => true];
    }

    /**
     * Notify every participant that an exchange has started and needs their
     * confirmation. Mirrors notifyBalanceChanges(): each recipient is belled,
     * pushed and emailed in their OWN preferred_language, deduped so a user added
     * as both provider and receiver only gets one prompt, and every failure is
     * swallowed so it can never unwind the already-committed status transition.
     */
    private function notifyParticipantsToConfirm(int $exchangeId, string $title, int $tenantId): void
    {
        $exchangeTitle = trim($title) !== '' ? $title : __('svc_notifications.group_exchange.fallback_title');
        $link = '/group-exchanges/' . $exchangeId;

        try {
            $recipients = DB::table('group_exchange_participants as p')
                ->join('users as u', function ($join) use ($tenantId) {
                    $join->on('p.user_id', '=', 'u.id')
                        ->where('u.tenant_id', '=', $tenantId);
                })
                ->where('p.group_exchange_id', $exchangeId)
                ->select(['p.user_id', 'u.email', 'u.first_name', 'u.name', 'u.preferred_language'])
                ->get()
                ->unique('user_id');
        } catch (\Throwable $e) {
            // Loading recipients must never fail the already-committed start() —
            // the status transition has persisted, notifications are best-effort.
            Log::warning('[GroupExchange] start notification recipient load failed (continuing)', [
                'exchange_id' => $exchangeId,
                'error'       => $e->getMessage(),
            ]);
            return;
        }

        foreach ($recipients as $recipient) {
            try {
                $userId = (int) $recipient->user_id;
                if ($userId <= 0) {
                    continue;
                }

                // Wrap INSIDE the per-recipient loop — bell, push AND email all render
                // in the recipient's own locale, not the organizer's / worker's.
                LocaleContext::withLocale($recipient, function () use ($userId, $recipient, $exchangeId, $exchangeTitle, $link, $tenantId) {
                    $message = __('svc_notifications.group_exchange.needs_confirmation', ['title' => $exchangeTitle]);

                    Notification::createNotification($userId, $message, $link, 'group_exchange');
                    \App\Services\NotificationDispatcher::fanOutPush($userId, 'group_exchange', $message, $link);

                    // Force-instant transactional email (sent directly, bypassing the
                    // digest queue; respects an explicit email_transactions opt-out).
                    // Body reuses the bell string so the channels stay identical.
                    $recipientName = $recipient->first_name ?: ($recipient->name ?: __('emails.common.fallback_name'));
                    $this->sendExchangeEmail(
                        $recipient,
                        __('emails.group_exchange.start_subject', ['title' => $exchangeTitle]),
                        $this->buildExchangeEmail(
                            (string) $recipientName,
                            __('emails.group_exchange.start_title'),
                            $message,
                            __('emails.group_exchange.view_exchange'),
                            $this->frontendUrl($link),
                            'indigo'
                        ),
                        $tenantId
                    );
                });
            } catch (\Throwable $e) {
                Log::warning('[GroupExchange] start notification failed (continuing)', [
                    'exchange_id' => $exchangeId,
                    'user_id'     => $recipient->user_id ?? null,
                    'error'       => $e->getMessage(),
                ]);
            }
        }
    }

    /** @param list<int> $userIds */
    private function firstContactRestriction(
        array $userIds,
        int $tenantId,
        string $channel,
    ): ?SafeguardingInteractionDecision {
        $ids = array_values(array_filter(
            array_unique(array_map('intval', $userIds)),
            static fn (int $id): bool => $id > 0,
        ));
        $firstDenial = null;

        try {
            $policy = app(SafeguardingInteractionPolicy::class);
            for ($left = 0, $count = count($ids); $left < $count; $left++) {
                for ($right = $left + 1; $right < $count; $right++) {
                    foreach ([[$ids[$left], $ids[$right]], [$ids[$right], $ids[$left]]] as [$senderId, $recipientId]) {
                        $decision = $policy->evaluateLocalContact($senderId, $recipientId, $tenantId, $channel);
                        if ($decision->isUnavailable()) {
                            return $decision;
                        }
                        if ($decision->isDenied() && $firstDenial === null) {
                            $firstDenial = $decision;
                        }
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::error('[GroupExchange] safeguarding contact policy unavailable', [
                'tenant_id' => $tenantId,
                'channel' => $channel,
                'error' => $e->getMessage(),
            ]);

            return new SafeguardingInteractionDecision(
                status: SafeguardingInteractionDecision::UNAVAILABLE,
                code: 'SAFEGUARDING_POLICY_UNAVAILABLE',
                recipientTenantId: $tenantId,
                purposeCode: SafeguardingJurisdictionService::PURPOSE_SAFEGUARDED_MEMBER_CONTACT,
                scopeType: SafeguardingJurisdictionService::SCOPE_TENANT,
                scopeIdentifier: '',
                canRequestCoordinator: true,
            );
        }

        return $firstDenial;
    }

    /**
     * Confirm a user's participation in an exchange.
     */
    public function confirmParticipation(int $exchangeId, int $userId): bool
    {
        $this->lastContactRestriction = null;
        $tenantId = TenantContext::getId();
        $participantIds = DB::table('group_exchange_participants as gep')
            ->join('group_exchanges as ge', 'ge.id', '=', 'gep.group_exchange_id')
            ->where('gep.group_exchange_id', $exchangeId)
            ->where('ge.tenant_id', $tenantId)
            ->pluck('gep.user_id')
            ->map(static fn ($id): int => (int) $id)
            ->all();
        if (! in_array($userId, $participantIds, true)) {
            return false;
        }

        $decision = $this->firstContactRestriction(
            $participantIds,
            $tenantId,
            'group_exchange_confirm',
        );
        if ($decision !== null) {
            $this->lastContactRestriction = $decision;
            return false;
        }

        $affected = DB::table('group_exchange_participants')
            ->where('group_exchange_id', $exchangeId)
            ->where('user_id', $userId)
            ->where('confirmed', 0)
            ->update([
                'confirmed'    => 1,
                'confirmed_at' => now(),
            ]);

        return $affected > 0;
    }

    /**
     * Complete an exchange: verify all participants confirmed, create wallet transactions.
     *
     * @return array{success: bool, error?: string, transaction_ids?: array}
     */
    public function complete(int $exchangeId): array
    {
        $this->lastContactRestriction = null;
        $tenantId = TenantContext::getId();

        $exchange = DB::table('group_exchanges')
            ->where('id', $exchangeId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $exchange) {
            return ['success' => false, 'error' => __('api.group_exchange_not_found')];
        }

        if ($exchange->status === 'completed') {
            return ['success' => false, 'error' => __('api.group_exchange_already_completed')];
        }

        if ($exchange->status === 'cancelled') {
            return ['success' => false, 'error' => __('api_controllers_1.group_exchange.exchange_cancelled')];
        }

        // Check all participants have confirmed
        $unconfirmed = DB::table('group_exchange_participants')
            ->where('group_exchange_id', $exchangeId)
            ->where('confirmed', 0)
            ->count();

        if ($unconfirmed > 0) {
            return ['success' => false, 'error' => __('api.group_exchange_unconfirmed_remaining', ['count' => $unconfirmed])];
        }

        $participantIds = DB::table('group_exchange_participants')
            ->where('group_exchange_id', $exchangeId)
            ->pluck('user_id')
            ->map(static fn ($id): int => (int) $id)
            ->all();
        $decision = $this->firstContactRestriction(
            $participantIds,
            $tenantId,
            'group_exchange_complete',
        );
        if ($decision !== null) {
            $this->lastContactRestriction = $decision;
            return [
                'success' => false,
                'error' => MessageService::buildSafeguardingError([
                    'status' => $decision->status,
                    'code' => $decision->code,
                    'required_vetting_types' => $decision->requiredAttestationCodes,
                    'required_vetting_labels' => $decision->requiredAttestationLabels,
                    'can_request_coordinator' => $decision->canRequestCoordinator,
                ])['message'],
                'code' => $decision->code,
            ];
        }

        $split = $this->calculateSplit($exchangeId);
        if (empty($split)) {
            return ['success' => false, 'error' => __('api.group_exchange_no_participants')];
        }

        // Authoritative conservation gate — money only moves from here, so this
        // check must live here (start() checks too, but the split can change
        // between start and complete).
        $imbalance = $this->splitImbalanceError($split);
        if ($imbalance !== null) {
            return ['success' => false, 'error' => $imbalance];
        }

        $transactionIds = [];
        // Participants whose balance actually changed in the committed transaction.
        // Captured here so we can bell them ONLY after the DB::transaction commits.
        // Each entry: ['user_id' => int, 'role' => 'provider'|string, 'hours' => float]
        $balanceChanges = [];

        $completed = DB::transaction(function () use ($exchangeId, $exchange, $split, $tenantId, &$transactionIds, &$balanceChanges): bool {
            // Claim completion FIRST, atomically — the status predicate makes a
            // concurrent double-complete (double-click / parallel request) a
            // no-op instead of crediting every participant twice.
            $claimed = DB::table('group_exchanges')
                ->where('id', $exchangeId)
                ->where('tenant_id', $tenantId)
                ->whereNotIn('status', ['completed', 'cancelled'])
                ->update([
                    'status'       => 'completed',
                    'completed_at' => now(),
                    'updated_at'   => now(),
                ]);

            if ($claimed === 0) {
                return false; // another request completed it first
            }

            // Create wallet transactions for each participant
            foreach ($split as $entry) {
                // Keep the 2-decimal split — (int) casting truncated shares
                // (3×3.33h credited 9h while debiting 10h) and zeroed sub-1h
                // shares while still writing their ledger rows.
                $hours = round((float) $entry['hours'], 2);
                if ($hours <= 0) {
                    continue;
                }

                // Providers earn credits, receivers spend them
                if ($entry['role'] === 'provider') {
                    // Credit the provider: system (sender=0) sends to provider
                    $txnId = DB::table('transactions')->insertGetId([
                        'tenant_id'        => $tenantId,
                        'sender_id'        => $exchange->organizer_id,
                        'receiver_id'      => $entry['user_id'],
                        'amount'           => $hours,
                        'description'      => __('api.group_exchange_transaction_description', ['title' => $exchange->title]),
                        'status'           => 'completed',
                        'transaction_type' => 'exchange',
                        'listing_id'       => null,
                        'created_at'       => now(),
                    ]);
                    $transactionIds[] = (int) $txnId;

                    DB::table('users')
                        ->where('id', $entry['user_id'])
                        ->where('tenant_id', $tenantId)
                        ->increment('balance', $hours);
                } else {
                    // Debit the receiver — guarded like every other debit path
                    // (balance >= amount) so receivers can't be driven negative;
                    // failure rolls back the whole completion.
                    $debited = DB::table('users')
                        ->where('id', $entry['user_id'])
                        ->where('tenant_id', $tenantId)
                        ->where('balance', '>=', $hours)
                        ->decrement('balance', $hours);

                    if ($debited === 0) {
                        throw new \RuntimeException(__('api.insufficient_balance'));
                    }
                }

                $balanceChanges[] = [
                    'user_id' => (int) $entry['user_id'],
                    'role'    => $entry['role'],
                    'hours'   => $hours,
                ];
            }

            return true;
        });

        if (! $completed) {
            return ['success' => false, 'error' => __('api.group_exchange_already_completed')];
        }

        // SUCCESS PATH ONLY — the DB::transaction above committed. Bell each
        // participant whose balance actually changed so the financial event is no
        // longer silent. Wrapped in try/catch so a notification failure can never
        // unwind or mask the already-committed credit/debit.
        $this->notifyBalanceChanges($exchangeId, (string) $exchange->title, $balanceChanges, $tenantId);

        return [
            'success'         => true,
            'transaction_ids' => $transactionIds,
        ];
    }

    /**
     * Bell each participant whose wallet balance changed when an exchange completed.
     *
     * MUST be called only on the success path — after the balance change has
     * persisted (the DB::transaction in complete() has committed). Providers were
     * credited; all other roles were debited. Each recipient is notified in their
     * own preferred_language, and the whole thing is fail-safe: a bell failure is
     * logged but never propagated, so the already-committed financial transaction
     * is never affected.
     *
     * @param array<int, array{user_id: int, role: string, hours: float}> $balanceChanges
     */
    private function notifyBalanceChanges(int $exchangeId, string $title, array $balanceChanges, int $tenantId): void
    {
        if (empty($balanceChanges)) {
            return;
        }

        $exchangeTitle = trim($title) !== '' ? $title : __('svc_notifications.group_exchange.fallback_title');

        foreach ($balanceChanges as $change) {
            try {
                $userId = (int) ($change['user_id'] ?? 0);
                $hours = round((float) ($change['hours'] ?? 0), 2);
                if ($userId <= 0 || $hours <= 0) {
                    continue;
                }

                // 2dp then trimmed ("0.5", "1.5", "6") — the int cast this
                // replaces dropped sub-hour shares entirely (0.5 → 0 → no bell
                // for a real balance change) and showed 1.5h as "1".
                $hoursLabel = rtrim(rtrim(number_format($hours, 2, '.', ''), '0'), '.');

                $isProvider = ($change['role'] ?? '') === 'provider';

                // Resolve recipient + preferred_language so the bell renders in
                // THEIR language (not the caller's / queue worker's locale).
                $recipient = DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->select(['id', 'email', 'first_name', 'name', 'preferred_language'])
                    ->first();

                if (! $recipient) {
                    continue;
                }

                // Wrap INSIDE the per-recipient loop — bell, push AND email render in
                // the recipient's own locale.
                LocaleContext::withLocale($recipient, function () use ($userId, $recipient, $isProvider, $hoursLabel, $exchangeTitle, $tenantId) {
                    $message = $isProvider
                        ? __('svc_notifications.group_exchange.completed_credit', ['hours' => $hoursLabel, 'title' => $exchangeTitle])
                        : __('svc_notifications.group_exchange.completed_debit', ['hours' => $hoursLabel, 'title' => $exchangeTitle]);

                    // Canonical tenant-safe writer — forces tenant_id to the
                    // recipient's users.tenant_id. Never raw Notification::create().
                    Notification::createNotification(
                        $userId,
                        $message,
                        '/wallet',
                        'transaction'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'transaction', $message, '/wallet');

                    // Force-instant transactional email — same wording as the bell,
                    // credit (emerald) vs debit (amber) accent, links to the wallet.
                    $recipientName = $recipient->first_name ?: ($recipient->name ?: __('emails.common.fallback_name'));
                    $this->sendExchangeEmail(
                        $recipient,
                        __('emails.group_exchange.completed_subject', ['title' => $exchangeTitle]),
                        $this->buildExchangeEmail(
                            (string) $recipientName,
                            __('emails.group_exchange.completed_title'),
                            $message,
                            __('emails.notification.view_wallet'),
                            $this->frontendUrl('/wallet'),
                            $isProvider ? 'emerald' : 'amber'
                        ),
                        $tenantId
                    );
                });
            } catch (\Throwable $e) {
                // A bell failure must never unwind or mask the committed transfer.
                Log::warning('[GroupExchange] completion bell failed (continuing)', [
                    'exchange_id' => $exchangeId,
                    'user_id'     => $change['user_id'] ?? null,
                    'error'       => $e->getMessage(),
                ]);
            }
        }
    }

    /**
     * Build an absolute frontend URL for a relative app path, in the current
     * tenant's context (custom domain + slug prefix).
     */
    private function frontendUrl(string $path): string
    {
        return TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $path;
    }

    /**
     * Send a group-exchange email to a recipient unless they have opted out of
     * transaction emails. Sent directly (not via the digest queue) so it is
     * effectively "instant", and fail-safe so a mail error never unwinds the
     * already-committed status/balance change. MUST be called inside the
     * recipient's LocaleContext so any fallback strings render in their language.
     *
     * @param object $recipient row carrying at least ->email and ->user_id|->id
     */
    private function sendExchangeEmail(object $recipient, string $subject, string $htmlBody, int $tenantId): void
    {
        try {
            $email = $recipient->email ?? null;
            if (empty($email)) {
                return;
            }

            $userId = (int) ($recipient->user_id ?? $recipient->id ?? 0);

            // Respect an explicit transaction-email opt-out (default on). A lookup
            // failure is non-fatal — we fall through and send the transactional mail.
            try {
                $prefs = \App\Models\User::getNotificationPreferences($userId);
                if (! (bool) ($prefs['email_transactions'] ?? true)) {
                    return;
                }
            } catch (\Throwable $prefError) {
                Log::debug('[GroupExchange] email_transactions pref lookup failed', [
                    'user_id' => $userId,
                    'error'   => $prefError->getMessage(),
                ]);
            }

            \App\Services\EmailDispatchService::sendRaw(
                (string) $email,
                $subject,
                $htmlBody,
                null,
                null,
                null,
                'transaction',
                ['tenant_id' => $tenantId, 'source' => 'GroupExchangeService']
            );
        } catch (\Throwable $e) {
            Log::warning('[GroupExchange] email send failed (continuing)', [
                'user_id' => $recipient->user_id ?? $recipient->id ?? null,
                'error'   => $e->getMessage(),
            ]);
        }
    }

    /**
     * Build a self-contained HTML email in the platform's notification style.
     * $accent picks the header gradient / button colour: indigo (start), emerald
     * (credit) or amber (debit). Body text is a pre-translated string that may
     * contain user data (the exchange title) so it is HTML-escaped here.
     */
    private function buildExchangeEmail(string $recipientName, string $title, string $bodyText, string $ctaText, string $ctaUrl, string $accent): string
    {
        $gradients = [
            'indigo'  => 'linear-gradient(135deg,#6366f1,#8b5cf6)',
            'emerald' => 'linear-gradient(135deg,#10b981,#059669)',
            'amber'   => 'linear-gradient(135deg,#f59e0b,#d97706)',
        ];
        $buttons = [
            'indigo'  => '#6366f1',
            'emerald' => '#10b981',
            'amber'   => '#d97706',
        ];
        $gradient = $gradients[$accent] ?? $gradients['indigo'];
        $button = $buttons[$accent] ?? $buttons['indigo'];

        $tenantName = htmlspecialchars((string) TenantContext::getSetting('site_name', __('emails.common.platform_name')));
        $greeting = __('emails.common.greeting', ['name' => htmlspecialchars($recipientName)]);
        $footer = __('emails.footer.sent_by', ['community' => $tenantName]);

        $safeTitle = htmlspecialchars($title);
        $safeBody = htmlspecialchars($bodyText);
        $safeCta = htmlspecialchars($ctaText);
        $safeUrl = htmlspecialchars($ctaUrl, ENT_QUOTES);

        return <<<HTML
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background:{$gradient};padding:32px;text-align:center;">
    <h1 style="margin:0;color:#fff;font-size:24px;">{$safeTitle}</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 16px;font-size:16px;color:#374151;">{$greeting}</p>
    <p style="margin:0 0 24px;font-size:16px;color:#374151;line-height:1.6;">{$safeBody}</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="{$safeUrl}" style="display:inline-block;padding:14px 32px;background:{$button};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">{$safeCta}</a>
    </div>
  </td></tr>
  <tr><td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">{$footer}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>
HTML;
    }
}
