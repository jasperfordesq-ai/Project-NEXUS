<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Events;

use App\Enums\EventPublicationState;
use App\Exceptions\EventRegistrationFoundationException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\Authorization\TenantAdminScope;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * One fail-closed recipient boundary shared by invitation preview, issuance,
 * and delivery. An invitation is contact evidence, never an audience-access
 * grant: member targets must already pass EventPolicy::view().
 */
final class EventInvitationRecipientAuthorizer
{
    public const ALLOWED = 'allowed';
    public const DENIED = 'denied';
    public const UNAVAILABLE = 'unavailable';

    public function __construct(
        private readonly EventRegistrationFoundationSupport $support = new EventRegistrationFoundationSupport(),
        private readonly EventPolicy $eventPolicy = new EventPolicy(),
        private readonly ?SafeguardingInteractionPolicy $safeguarding = null,
    ) {
    }

    /**
     * Filter preview targets without leaking why an individual was excluded.
     * The immutable snapshot and its integrity hash are rebuilt after filtering.
     *
     * @param array{
     *   recipients:list<array{type:string,member_id:?int,email:?string}>,
     *   errors:list<array{row:int,code:string}>,
     *   preview_count:int,
     *   source_reference:?string,
     *   source_hash:string,
     *   snapshot:array<string,mixed>,
     *   criteria_summary:?array<string,mixed>
     * } $expanded
     * @return array{
     *   recipients:list<array{type:string,member_id:?int,email:?string}>,
     *   errors:list<array{row:int,code:string}>,
     *   preview_count:int,
     *   source_reference:?string,
     *   source_hash:string,
     *   snapshot:array<string,mixed>,
     *   criteria_summary:?array<string,mixed>
     * }
     */
    public function filterPreview(
        int $tenantId,
        Event $event,
        User $actor,
        array $expanded,
    ): array {
        $decisions = $this->decisions($tenantId, $event, $actor, $expanded['recipients']);
        $eligible = [];
        $errors = $expanded['errors'];
        $usedRows = array_fill_keys(array_map(
            static fn (array $error): int => (int) $error['row'],
            $errors,
        ), true);
        $nextRow = 1;
        foreach ($expanded['recipients'] as $offset => $recipient) {
            $decision = $decisions[$offset] ?? self::UNAVAILABLE;
            if ($decision === self::UNAVAILABLE) {
                throw new EventRegistrationFoundationException(
                    'event_invitation_target_policy_schema_unavailable',
                );
            }
            if ($decision === self::ALLOWED) {
                $eligible[] = $recipient;
                continue;
            }
            while (isset($usedRows[$nextRow])) {
                $nextRow++;
            }
            // Reuse the translated, deliberately non-disclosing preview code.
            $errors[] = ['row' => $nextRow, 'code' => 'member_not_found'];
            $usedRows[$nextRow] = true;
            $nextRow++;
        }

        if (count($eligible) + count($errors) !== $expanded['preview_count']) {
            throw new EventRegistrationFoundationException('event_invitation_campaign_snapshot_invalid');
        }
        $snapshot = [
            'schema_version' => 1,
            'campaign_type' => $expanded['snapshot']['campaign_type'],
            'recipients' => $eligible,
            'errors' => $errors,
            'preview_count' => $expanded['preview_count'],
            'source_reference' => $expanded['source_reference'],
        ];
        if (array_key_exists('criteria', $expanded['snapshot'])) {
            $snapshot['criteria'] = $expanded['snapshot']['criteria'];
        }

        return array_replace($expanded, [
            'recipients' => $eligible,
            'errors' => $errors,
            'source_hash' => $this->support->requestHash($snapshot),
            'snapshot' => $snapshot,
        ]);
    }

    /**
     * The preview snapshot stays immutable. If any decision changed before
     * issuance, fail the whole write so the manager must create a fresh preview.
     *
     * @param list<array{type:string,member_id:?int,email:?string}> $recipients
     */
    public function assertEligibleForIssue(
        int $tenantId,
        Event $event,
        User $actor,
        array $recipients,
    ): void {
        foreach ($this->decisions($tenantId, $event, $actor, $recipients) as $decision) {
            if ($decision === self::UNAVAILABLE) {
                throw new EventRegistrationFoundationException(
                    'event_invitation_target_policy_schema_unavailable',
                );
            }
            if ($decision !== self::ALLOWED) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_target_ineligible');
            }
        }
    }

    /**
     * @param array{type:string,member_id:?int,email:?string} $recipient
     */
    public function deliveryDecision(
        int $tenantId,
        Event $event,
        User $actor,
        array $recipient,
    ): string {
        return $this->decisions($tenantId, $event, $actor, [$recipient])[0] ?? self::UNAVAILABLE;
    }

    /**
     * @param list<array{type:string,member_id:?int,email:?string}> $recipients
     * @return list<string>
     */
    private function decisions(
        int $tenantId,
        Event $event,
        User $actor,
        array $recipients,
    ): array {
        if ($tenantId <= 0
            || (int) $event->getAttribute('tenant_id') !== $tenantId
            || (int) $actor->getAttribute('tenant_id') !== $tenantId
            || (int) $actor->getKey() <= 0
            || (string) $actor->getAttribute('status') !== 'active'
            || $actor->getAttribute('deleted_at') !== null) {
            return array_fill(0, count($recipients), self::DENIED);
        }

        try {
            [$memberTargets, $emailTargets] = $this->resolveTargets($tenantId, $recipients);
            $contactActorIds = [(int) $actor->getKey()];
            $organizerId = (int) $event->getAttribute('user_id');
            if ($organizerId <= 0) {
                return array_fill(0, count($recipients), self::DENIED);
            }
            if ($organizerId !== (int) $actor->getKey()) {
                $organizerExists = User::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereKey($organizerId)
                    ->where('status', 'active')
                    ->whereNull('deleted_at')
                    ->exists();
                if (! $organizerExists) {
                    return array_fill(0, count($recipients), self::DENIED);
                }
                $contactActorIds[] = $organizerId;
            }
            $targetIds = [];
            foreach ($memberTargets + $emailTargets as $target) {
                $targetIds[] = (int) $target->getKey();
            }
            $blocked = $this->blockedTargetIds(
                $tenantId,
                $contactActorIds,
                array_values(array_unique($targetIds)),
            );
            if ($blocked === null) {
                return array_fill(0, count($recipients), self::UNAVAILABLE);
            }
        } catch (Throwable) {
            return array_fill(0, count($recipients), self::UNAVAILABLE);
        }

        $decisions = [];
        foreach ($recipients as $recipient) {
            $target = null;
            if (($recipient['type'] ?? null) === 'member') {
                $target = $memberTargets[(int) ($recipient['member_id'] ?? 0)] ?? null;
            } elseif (($recipient['type'] ?? null) === 'email' && is_string($recipient['email'] ?? null)) {
                try {
                    $email = $this->support->normalizeEmail($recipient['email']);
                } catch (EventRegistrationFoundationException) {
                    $decisions[] = self::DENIED;
                    continue;
                }
                $target = $emailTargets[$email] ?? null;
                if ($target === null) {
                    $decisions[] = $this->externalTargetDecision($tenantId, $event, $actor);
                    continue;
                }
            } else {
                $decisions[] = self::DENIED;
                continue;
            }

            if (! $target instanceof User
                || (string) $target->getAttribute('status') !== 'active'
                || $target->getAttribute('deleted_at') !== null
                || isset($blocked[(int) $target->getKey()])) {
                $decisions[] = self::DENIED;
                continue;
            }
            try {
                if (! $this->eventPolicy->view($target, $event)) {
                    $decisions[] = self::DENIED;
                    continue;
                }
            } catch (Throwable) {
                $decisions[] = self::UNAVAILABLE;
                continue;
            }

            $decisions[] = $this->safeguardingDecision(
                $tenantId,
                $contactActorIds,
                (int) $target->getKey(),
            );
        }

        return $decisions;
    }

    /**
     * @param list<array{type:string,member_id:?int,email:?string}> $recipients
     * @return array{0:array<int,User>,1:array<string,User>}
     */
    private function resolveTargets(int $tenantId, array $recipients): array
    {
        $memberIds = [];
        $emails = [];
        foreach ($recipients as $recipient) {
            if (($recipient['type'] ?? null) === 'member') {
                $memberId = filter_var($recipient['member_id'] ?? null, FILTER_VALIDATE_INT);
                if ($memberId !== false && $memberId > 0) {
                    $memberIds[] = (int) $memberId;
                }
            } elseif (($recipient['type'] ?? null) === 'email' && is_string($recipient['email'] ?? null)) {
                try {
                    $emails[] = $this->support->normalizeEmail($recipient['email']);
                } catch (EventRegistrationFoundationException) {
                    // The caller records this target as denied below.
                }
            }
        }
        $memberIds = array_values(array_unique($memberIds));
        $emails = array_values(array_unique($emails));
        if ($memberIds === [] && $emails === []) {
            return [[], []];
        }

        $users = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where(static function ($query) use ($memberIds, $emails): void {
                if ($memberIds !== []) {
                    $query->whereIn('id', $memberIds);
                }
                if ($emails !== []) {
                    if ($memberIds === []) {
                        $query->whereIn('email', $emails);
                    } else {
                        $query->orWhereIn('email', $emails);
                    }
                }
            })
            ->get();
        $byId = [];
        $byEmail = [];
        foreach ($users as $user) {
            $byId[(int) $user->getKey()] = $user;
            if (is_string($user->getAttribute('email'))) {
                try {
                    $byEmail[$this->support->normalizeEmail((string) $user->getAttribute('email'))] = $user;
                } catch (EventRegistrationFoundationException) {
                    // A malformed account email must not be matched to an invite.
                }
            }
        }

        return [$byId, $byEmail];
    }

    /** @param list<int> $actorIds @param list<int> $targetIds @return array<int,true>|null */
    private function blockedTargetIds(int $tenantId, array $actorIds, array $targetIds): ?array
    {
        if ($targetIds === []) {
            return [];
        }
        if (! Schema::hasTable('user_blocks') || ! Schema::hasColumn('user_blocks', 'tenant_id')) {
            return null;
        }
        $rows = DB::table('user_blocks')
            ->where('tenant_id', $tenantId)
            ->where(static function ($pairs) use ($actorIds, $targetIds): void {
                $pairs->where(static function ($outbound) use ($actorIds, $targetIds): void {
                    $outbound->whereIn('user_id', $actorIds)
                        ->whereIn('blocked_user_id', $targetIds);
                })->orWhere(static function ($inbound) use ($actorIds, $targetIds): void {
                    $inbound->whereIn('blocked_user_id', $actorIds)
                        ->whereIn('user_id', $targetIds);
                });
            })
            ->get(['user_id', 'blocked_user_id']);
        $blocked = [];
        foreach ($rows as $row) {
            $targetId = in_array((int) $row->user_id, $actorIds, true)
                ? (int) $row->blocked_user_id
                : (int) $row->user_id;
            $blocked[$targetId] = true;
        }

        return $blocked;
    }

    /** @param list<int> $actorIds */
    private function safeguardingDecision(int $tenantId, array $actorIds, int $targetId): string
    {
        try {
            $policy = $this->safeguarding ?? app(SafeguardingInteractionPolicy::class);
            foreach ($actorIds as $actorId) {
                if ($actorId === $targetId) {
                    continue;
                }
                $decision = $policy->evaluateLocalContact(
                    $actorId,
                    $targetId,
                    $tenantId,
                    'event_invitation',
                );
                if ($decision->isUnavailable()) {
                    return self::UNAVAILABLE;
                }
                if ($decision->isDenied()) {
                    return self::DENIED;
                }
            }
        } catch (Throwable) {
            return self::UNAVAILABLE;
        }

        return self::ALLOWED;
    }

    /**
     * A genuinely external email has no User model for EventPolicy::view(). It
     * may receive an invitation only when the published event is visible to an
     * ordinary community member without the invitation itself. Private linked
     * groups and non-published events therefore fail closed.
     */
    private function externalTargetDecision(int $tenantId, Event $event, User $actor): string
    {
        try {
            // Inviting people who are not members is a bulk-reach capability
            // reserved for community admins (E-035 F-161). Re-checked here so
            // delivery of an already-issued invitation also fails closed.
            if (! TenantAdminScope::allows($actor, $tenantId)) {
                return self::DENIED;
            }
            $publication = $event->getRawOriginal('publication_status');
            $published = is_string($publication) && trim($publication) !== ''
                ? $publication === EventPublicationState::Published->value
                : EventPublicationState::fromLegacyStatus(
                    is_string($event->getRawOriginal('status'))
                        ? $event->getRawOriginal('status')
                        : null,
                ) === EventPublicationState::Published;
            if (! $published) {
                return self::DENIED;
            }
            $groupId = filter_var($event->getRawOriginal('group_id'), FILTER_VALIDATE_INT);
            if ($groupId === false || $groupId <= 0) {
                return self::ALLOWED;
            }
            $group = DB::table('groups')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $groupId)
                ->first(['status', 'visibility']);
            if ($group === null) {
                return self::DENIED;
            }

            return (string) $group->status === 'active' && (string) $group->visibility === 'public'
                ? self::ALLOWED
                : self::DENIED;
        } catch (Throwable) {
            return self::UNAVAILABLE;
        }
    }
}
