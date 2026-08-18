<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Policies;

use App\Core\TenantContext;
use App\Enums\EventStaffAssignmentStatus;
use App\Enums\EventStaffCapability;
use App\Enums\EventStaffRole;
use App\Enums\EventPublicationState;
use App\Models\Event;
use App\Models\User;
use App\Support\Authorization\AdminTier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * Tenant-safe, fail-closed authorization boundary for Events.
 *
 * Event detail resources may expose aggregate registration counts after `view`
 * succeeds. Identity-bearing rosters and waitlists require their own explicit
 * abilities and must never be inferred from detail visibility.
 *
 * Delegated staff capabilities are resolved from the append-only, tenant-scoped
 * Events role foundation. Unknown, expired, revoked, or unavailable assignment
 * data always fails closed.
 */
class EventPolicy
{
    /** @var list<string> */
    private const CONFIRMED_RSVP_STATES = [
        'going',
        'attended',
    ];

    /** @var array<string, object|null> */
    private array $linkedGroupCache = [];

    /** @var array<string, bool> */
    private array $groupMembershipCache = [];

    /** @var array<string, bool> */
    private array $confirmedRegistrationCache = [];

    /** @var array<string, bool> */
    private array $activeWaitlistCache = [];

    /** @var array<string, array<string, true>> */
    private array $assignedCapabilityCache = [];

    /** @var array<string, bool|null> */
    private array $tableAvailabilityCache = [];

    /**
     * Evaluate the complete policy matrix for an Events collection in bounded
     * queries. The returned decisions are not cached; only their durable input
     * facts are primed for this policy instance.
     *
     * @param iterable<Event> $events
     * @return array<int, array{
     *     view: bool,
     *     viewMeetingLink: bool,
     *     viewRegisteredAgenda: bool,
     *     viewStaffAgenda: bool,
     *     viewRoster: bool,
     *     viewWaitlist: bool,
     *     manage: bool,
     *     manageAgenda: bool,
     *     manageStaff: bool,
     *     manageAttendance: bool,
     *     messagePeople: bool,
     *     exportPeople: bool,
     *     linkSeries: bool,
     *     manageRegistration: bool,
     *     broadcast: bool,
     *     manageFinance: bool,
     *     reconcileCredits: bool,
     *     reconcileTickets: bool,
     *     transferOwnership: bool
     * }>
     */
    public function abilitiesForEvents(User $user, iterable $events): array
    {
        $this->clearFactCaches();

        $eventsById = [];
        foreach ($events as $event) {
            $eventId = (int) $event->getKey();
            if ($eventId > 0) {
                $eventsById[$eventId] = $event;
            }
        }

        if ($eventsById === []) {
            return [];
        }

        $this->primeFacts($user, array_values($eventsById));

        $abilities = [];
        foreach ($eventsById as $eventId => $event) {
            $abilities[$eventId] = [
                'view' => $this->view($user, $event),
                'viewMeetingLink' => $this->viewMeetingLink($user, $event),
                'viewRegisteredAgenda' => $this->viewRegisteredAgenda($user, $event),
                'viewStaffAgenda' => $this->viewStaffAgenda($user, $event),
                'viewRoster' => $this->viewRoster($user, $event),
                'viewWaitlist' => $this->viewWaitlist($user, $event),
                'manage' => $this->manage($user, $event),
                'manageAgenda' => $this->manageAgenda($user, $event),
                'manageStaff' => $this->manageStaff($user, $event),
                'manageAttendance' => $this->manageAttendance($user, $event),
                'messagePeople' => $this->messagePeople($user, $event),
                'exportPeople' => $this->exportPeople($user, $event),
                'linkSeries' => $this->linkSeries($user, $event),
                'manageRegistration' => $this->manageRegistration($user, $event),
                'broadcast' => $this->broadcast($user, $event),
                'manageFinance' => $this->manageFinance($user, $event),
                'reconcileCredits' => $this->reconcileCredits($user, $event),
                'reconcileTickets' => $this->reconcileTickets($user, $event),
                'transferOwnership' => $this->transferOwnership($user, $event),
            ];
        }

        return $abilities;
    }

    public function view(User $user, Event $event): bool
    {
        if (! $this->hasValidContext($user, $event) || ! $this->hasValidLinkedGroup($event)) {
            return false;
        }

        if ($this->canManageCurrentEvent($user, $event)
            || ($this->canManageLinkedGroupBoundary($user, $event)
                && $this->hasAssignedCapability($user, $event, 'view'))) {
            return true;
        }

        if (! $this->isPublished($event)) {
            return false;
        }

        return $this->canViewAudience($user, $event);
    }

    /**
     * Determine meeting-link eligibility only.
     *
     * Callers must still apply the configured reveal/end/grace time window and
     * the event lifecycle before returning a URL.
     */
    public function viewMeetingLink(User $user, Event $event): bool
    {
        if (! $this->view($user, $event)) {
            return false;
        }

        if ($this->canManageCurrentEvent($user, $event)
            || ($this->canManageLinkedGroupBoundary($user, $event)
                && $this->hasAssignedCapability($user, $event, 'viewMeetingLink'))) {
            return true;
        }

        return ! $this->isActivelyWaitlisted($user, $event)
            && $this->hasConfirmedRegistration($user, $event);
    }

    /** View sessions intended only for canonically confirmed attendees. */
    public function viewRegisteredAgenda(User $user, Event $event): bool
    {
        if (! $this->view($user, $event)) {
            return false;
        }

        return $this->viewStaffAgenda($user, $event)
            || $this->hasConfirmedRegistration($user, $event);
    }

    /** View staff-only sessions without implying broad event mutation rights. */
    public function viewStaffAgenda(User $user, Event $event): bool
    {
        return $this->canPerformManagementAbility(
            $user,
            $event,
            EventStaffCapability::View->value,
        );
    }

    /**
     * Authorize an identity-bearing participant roster, not aggregate counts.
     */
    public function viewRoster(User $user, Event $event): bool
    {
        return $this->canPerformManagementAbility($user, $event, 'viewRoster');
    }

    /**
     * Authorize the complete identity-bearing waitlist.
     *
     * A member's own queue position belongs in their registration projection
     * and does not imply access to this operational list.
     */
    public function viewWaitlist(User $user, Event $event): bool
    {
        return $this->canPerformManagementAbility($user, $event, 'viewWaitlist');
    }

    public function manage(User $user, Event $event): bool
    {
        if (! $this->hasValidContext($user, $event) || ! $this->hasValidLinkedGroup($event)) {
            return false;
        }

        return $this->canManageLinkedGroupBoundary($user, $event)
            && ($this->hasImplicitFullAuthority($user, $event)
                || $this->hasAssignedCapability($user, $event, EventStaffCapability::Manage->value));
    }

    /** Manage the complete agenda using the existing broad event authority. */
    public function manageAgenda(User $user, Event $event): bool
    {
        return $this->manage($user, $event);
    }

    public function manageStaff(User $user, Event $event): bool
    {
        return $this->canPerformManagementAbility(
            $user,
            $event,
            EventStaffCapability::ManageStaff->value,
        );
    }

    public function manageAttendance(User $user, Event $event): bool
    {
        return $this->canPerformManagementAbility($user, $event, 'manageAttendance');
    }

    public function messagePeople(User $user, Event $event): bool
    {
        return $this->canPerformManagementAbility($user, $event, 'messagePeople');
    }

    public function exportPeople(User $user, Event $event): bool
    {
        return $this->canPerformManagementAbility($user, $event, 'exportPeople');
    }

    public function linkSeries(User $user, Event $event): bool
    {
        return $this->canPerformManagementAbility($user, $event, 'linkSeries');
    }

    public function manageRegistration(User $user, Event $event): bool
    {
        return $this->canPerformManagementAbility(
            $user,
            $event,
            EventStaffCapability::ManageRegistration->value,
        );
    }

    public function broadcast(User $user, Event $event): bool
    {
        return $this->canPerformManagementAbility(
            $user,
            $event,
            EventStaffCapability::Broadcast->value,
        );
    }

    public function manageFinance(User $user, Event $event): bool
    {
        return $this->canPerformManagementAbility(
            $user,
            $event,
            EventStaffCapability::ManageFinance->value,
        );
    }

    public function reconcileCredits(User $user, Event $event): bool
    {
        return $this->canPerformManagementAbility(
            $user,
            $event,
            EventStaffCapability::ReconcileCredits->value,
        );
    }

    public function reconcileTickets(User $user, Event $event): bool
    {
        return $this->canPerformManagementAbility(
            $user,
            $event,
            EventStaffCapability::ReconcileTickets->value,
        );
    }

    public function transferOwnership(User $user, Event $event): bool
    {
        if (! $this->hasValidContext($user, $event) || ! $this->hasValidLinkedGroup($event)) {
            return false;
        }

        return $this->canManageLinkedGroupBoundary($user, $event)
            && $this->hasImplicitFullAuthority($user, $event);
    }

    private function canPerformManagementAbility(
        User $user,
        Event $event,
        string $capability,
    ): bool {
        if (! $this->hasValidContext($user, $event) || ! $this->hasValidLinkedGroup($event)) {
            return false;
        }

        return $this->canManageLinkedGroupBoundary($user, $event)
            && ($this->hasImplicitFullAuthority($user, $event)
                || $this->hasAssignedCapability($user, $event, $capability));
    }

    private function hasValidContext(User $user, Event $event): bool
    {
        $tenantId = TenantContext::currentId();

        // Auth is GLOBAL; only resources are tenant-scoped. The EVENT must
        // belong to the current tenant, but the ACTING user's home tenant must
        // not be compared against it: that refused organisers and admins whose
        // account row lives on another tenant (network admins, anyone acting on
        // a sub-tenant) — including the creator of the very event being checked.
        if ($tenantId === null || $tenantId <= 0
            || (int) $user->getKey() <= 0
            || (int) $event->getKey() <= 0
            || (int) $event->getAttribute('tenant_id') !== $tenantId
            || (string) $user->getAttribute('status') !== 'active'
            || $user->getAttribute('deleted_at') !== null) {
            return false;
        }

        try {
            return TenantContext::hasFeature('events');
        } catch (Throwable) {
            return false;
        }
    }

    private function hasValidLinkedGroup(Event $event): bool
    {
        $groupId = $this->groupId($event);
        if ($groupId === null) {
            return true;
        }

        $group = $this->linkedGroup($event);

        return $group !== null && (string) ($group->status ?? '') === 'active';
    }

    private function isPublished(Event $event): bool
    {
        $publication = $event->getRawOriginal('publication_status');
        if (is_string($publication) && trim($publication) !== '') {
            return $publication === EventPublicationState::Published->value;
        }

        try {
            return EventPublicationState::fromLegacyStatus(
                is_string($event->getRawOriginal('status'))
                    ? $event->getRawOriginal('status')
                    : null,
            ) === EventPublicationState::Published;
        } catch (Throwable) {
            return false;
        }
    }

    private function canManageCurrentEvent(User $user, Event $event): bool
    {
        return $this->canManageLinkedGroupBoundary($user, $event)
            && ($this->hasImplicitFullAuthority($user, $event)
                || $this->hasAssignedCapability($user, $event, EventStaffCapability::Manage->value));
    }

    /**
     * Event authority never outranks the parent Group boundary. A public
     * linked group may still expose a published event, but organizer or
     * delegated write authority closes as soon as the actor loses active
     * Group access or the Group leaves the active lifecycle.
     */
    private function canManageLinkedGroupBoundary(User $user, Event $event): bool
    {
        $groupId = $this->groupId($event);
        if ($groupId === null) {
            return true;
        }

        $group = $this->linkedGroup($event);
        if ($group === null || (string) ($group->status ?? '') !== 'active') {
            return false;
        }

        return $this->isTenantAdmin($user)
            || $this->hasGroupAudienceAccess($user, $groupId, $group);
    }

    private function hasImplicitFullAuthority(User $user, Event $event): bool
    {
        if ($this->isTenantAdmin($user)) {
            return true;
        }

        if ((int) $event->getAttribute('user_id') !== (int) $user->getKey()) {
            return false;
        }

        return true;
    }

    private function canViewAudience(User $user, Event $event): bool
    {
        $groupId = $this->groupId($event);
        if ($groupId === null) {
            return true;
        }

        $group = $this->linkedGroup($event);
        if ($group === null || (string) ($group->status ?? '') !== 'active') {
            return false;
        }

        if ($this->isTenantAdmin($user) || (string) ($group->visibility ?? '') === 'public') {
            return true;
        }

        return $this->hasGroupAudienceAccess($user, $groupId, $group);
    }

    private function hasGroupAudienceAccess(User $user, int $groupId, object $group): bool
    {
        if ((int) ($group->owner_id ?? 0) === (int) $user->getKey()) {
            return true;
        }

        $tenantId = (int) TenantContext::currentId();
        $cacheKey = $this->groupMembershipCacheKey($tenantId, (int) $user->getKey(), $groupId);
        if (array_key_exists($cacheKey, $this->groupMembershipCache)) {
            return $this->groupMembershipCache[$cacheKey];
        }

        try {
            $isMember = DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->where('user_id', (int) $user->getKey())
                ->where('status', 'active')
                ->exists();
            $this->groupMembershipCache[$cacheKey] = $isMember;

            return $isMember;
        } catch (Throwable) {
            $this->groupMembershipCache[$cacheKey] = false;
            return false;
        }
    }

    private function isTenantAdmin(User $user): bool
    {
        return AdminTier::allows($user);
    }

    private function hasConfirmedRegistration(User $user, Event $event): bool
    {
        $tenantId = (int) TenantContext::currentId();
        $cacheKey = $this->eventUserCacheKey(
            $tenantId,
            (int) $user->getKey(),
            (int) $event->getKey()
        );
        if (array_key_exists($cacheKey, $this->confirmedRegistrationCache)) {
            return $this->confirmedRegistrationCache[$cacheKey];
        }

        try {
            $canonicalAvailable = $this->tableAvailability('event_registrations');
            $legacyAvailable = $this->tableAvailability('event_rsvps');
            if ($canonicalAvailable === null || $legacyAvailable === null) {
                throw new \RuntimeException('Event registration schema availability is ambiguous.');
            }

            $defaultPool = $this->defaultCapacityPoolKey();
            $canonicalDefaultSubject = false;
            $isConfirmed = false;
            $canonicalRows = $canonicalAvailable
                ? DB::table('event_registrations')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', (int) $event->getKey())
                    ->where('user_id', (int) $user->getKey())
                    ->get(['capacity_pool_key', 'registration_state'])
                : collect();
            foreach ($canonicalRows as $row) {
                $canonicalDefaultSubject = $canonicalDefaultSubject
                    || (string) $row->capacity_pool_key === $defaultPool;
                $isConfirmed = $isConfirmed
                    || (string) $row->registration_state === 'confirmed';
            }

            if (! $isConfirmed && ! $canonicalDefaultSubject && $legacyAvailable) {
                $isConfirmed = DB::table('event_rsvps')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', (int) $event->getKey())
                    ->where('user_id', (int) $user->getKey())
                    ->whereIn('status', self::CONFIRMED_RSVP_STATES)
                    ->exists();
            }
            $this->confirmedRegistrationCache[$cacheKey] = $isConfirmed;

            return $isConfirmed;
        } catch (Throwable) {
            $this->confirmedRegistrationCache[$cacheKey] = false;
            return false;
        }
    }

    private function isActivelyWaitlisted(User $user, Event $event): bool
    {
        $tenantId = (int) TenantContext::currentId();
        $cacheKey = $this->eventUserCacheKey(
            $tenantId,
            (int) $user->getKey(),
            (int) $event->getKey()
        );
        if (array_key_exists($cacheKey, $this->activeWaitlistCache)) {
            return $this->activeWaitlistCache[$cacheKey];
        }

        try {
            $canonicalAvailable = $this->tableAvailability('event_waitlist_entries');
            $legacyAvailable = $this->tableAvailability('event_waitlist');
            if ($canonicalAvailable === null || $legacyAvailable === null
                || (! $canonicalAvailable && ! $legacyAvailable)) {
                throw new \RuntimeException('Event waitlist schema availability is ambiguous.');
            }

            $defaultPool = $this->defaultCapacityPoolKey();
            $canonicalDefaultSubject = false;
            $isWaitlisted = false;
            $canonicalRows = $canonicalAvailable
                ? DB::table('event_waitlist_entries')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', (int) $event->getKey())
                    ->where('user_id', (int) $user->getKey())
                    ->get(['capacity_pool_key', 'queue_state'])
                : collect();
            foreach ($canonicalRows as $row) {
                $canonicalDefaultSubject = $canonicalDefaultSubject
                    || (string) $row->capacity_pool_key === $defaultPool;
                $isWaitlisted = $isWaitlisted
                    || in_array((string) $row->queue_state, ['waiting', 'offered'], true);
            }

            if (! $isWaitlisted && ! $canonicalDefaultSubject && $legacyAvailable) {
                $isWaitlisted = DB::table('event_waitlist')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', (int) $event->getKey())
                    ->where('user_id', (int) $user->getKey())
                    ->where('status', 'waiting')
                    ->exists();
            }
            $this->activeWaitlistCache[$cacheKey] = $isWaitlisted;

            return $isWaitlisted;
        } catch (Throwable) {
            // Ambiguous registration state must never reveal a meeting URL.
            $this->activeWaitlistCache[$cacheKey] = true;
            return true;
        }
    }

    private function groupId(Event $event): ?int
    {
        $groupId = $event->getAttribute('group_id');

        return is_numeric($groupId) && (int) $groupId > 0 ? (int) $groupId : null;
    }

    private function linkedGroup(Event $event): ?object
    {
        $groupId = $this->groupId($event);
        $tenantId = TenantContext::currentId();

        if ($groupId === null || $tenantId === null) {
            return null;
        }

        $cacheKey = $this->groupCacheKey($tenantId, $groupId);
        if (array_key_exists($cacheKey, $this->linkedGroupCache)) {
            return $this->linkedGroupCache[$cacheKey];
        }

        try {
            $group = DB::table('groups')
                ->where('id', $groupId)
                ->where('tenant_id', $tenantId)
                ->first(['id', 'tenant_id', 'owner_id', 'visibility', 'status']);
            $this->linkedGroupCache[$cacheKey] = $group;

            return $group;
        } catch (Throwable) {
            $this->linkedGroupCache[$cacheKey] = null;
            return null;
        }
    }

    /** @param list<Event> $events */
    private function primeFacts(User $user, array $events): void
    {
        $tenantId = TenantContext::currentId();
        // Same rule as hasValidContext(): never compare the ACTING user's home
        // tenant against the current tenant. Skipping the prime here would only
        // cost lazy lookups, but the predicates must stay aligned.
        if ($tenantId === null
            || (int) $user->getKey() <= 0
            || (string) $user->getAttribute('status') !== 'active'
            || $user->getAttribute('deleted_at') !== null) {
            return;
        }

        try {
            if (! TenantContext::hasFeature('events')) {
                return;
            }
        } catch (Throwable) {
            return;
        }

        $eventIds = [];
        $groupIds = [];
        foreach ($events as $event) {
            if ((int) $event->getAttribute('tenant_id') !== $tenantId) {
                continue;
            }

            $eventId = (int) $event->getKey();
            if ($eventId > 0) {
                $eventIds[] = $eventId;
            }
            $groupId = $this->groupId($event);
            if ($groupId !== null) {
                $groupIds[] = $groupId;
            }
        }
        $eventIds = array_values(array_unique($eventIds));
        $groupIds = array_values(array_unique($groupIds));

        if ($groupIds !== []) {
            foreach ($groupIds as $groupId) {
                $this->linkedGroupCache[$this->groupCacheKey($tenantId, $groupId)] = null;
                $this->groupMembershipCache[
                    $this->groupMembershipCacheKey($tenantId, (int) $user->getKey(), $groupId)
                ] = false;
            }

            try {
                $groups = DB::table('groups')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('id', $groupIds)
                    ->get(['id', 'tenant_id', 'owner_id', 'visibility', 'status']);
                foreach ($groups as $group) {
                    $this->linkedGroupCache[
                        $this->groupCacheKey($tenantId, (int) $group->id)
                    ] = $group;
                }
            } catch (Throwable) {
                // Null defaults fail closed for every linked group.
            }

            try {
                $memberGroupIds = DB::table('group_members')
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', (int) $user->getKey())
                    ->where('status', 'active')
                    ->whereIn('group_id', $groupIds)
                    ->pluck('group_id');
                foreach ($memberGroupIds as $groupId) {
                    $this->groupMembershipCache[
                        $this->groupMembershipCacheKey($tenantId, (int) $user->getKey(), (int) $groupId)
                    ] = true;
                }
            } catch (Throwable) {
                // False defaults fail closed for every membership.
            }
        }

        if ($eventIds === []) {
            return;
        }

        foreach ($eventIds as $eventId) {
            $cacheKey = $this->eventUserCacheKey($tenantId, (int) $user->getKey(), $eventId);
            $this->confirmedRegistrationCache[$cacheKey] = false;
            $this->assignedCapabilityCache[$cacheKey] = [];
            // Default to restricted until a complete waitlist query proves the
            // viewer is not currently waiting.
            $this->activeWaitlistCache[$cacheKey] = true;
        }

        try {
            $canonicalAvailable = $this->tableAvailability('event_registrations');
            $legacyAvailable = $this->tableAvailability('event_rsvps');
            if ($canonicalAvailable === null || $legacyAvailable === null) {
                throw new \RuntimeException('Event registration schema availability is ambiguous.');
            }

            $defaultPool = $this->defaultCapacityPoolKey();
            $registrationFactsQuery = $canonicalAvailable
                ? DB::table('event_registrations')
                    ->select(['event_id', 'capacity_pool_key'])
                    ->selectRaw('registration_state AS fact_state')
                    ->selectRaw("'canonical' AS fact_source")
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', (int) $user->getKey())
                    ->whereIn('event_id', $eventIds)
                : null;
            if ($legacyAvailable) {
                $legacyQuery = DB::table('event_rsvps')
                    ->select('event_id')
                    ->selectRaw('NULL AS capacity_pool_key')
                    ->selectRaw('status AS fact_state')
                    ->selectRaw("'legacy' AS fact_source")
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', (int) $user->getKey())
                    ->whereIn('event_id', $eventIds);
                $registrationFactsQuery = $registrationFactsQuery === null
                    ? $legacyQuery
                    : $registrationFactsQuery->union($legacyQuery);
            }

            $canonicalDefaultSubjects = [];
            $legacyConfirmed = [];
            $registrationFacts = $registrationFactsQuery?->get() ?? collect();
            foreach ($registrationFacts as $fact) {
                $eventId = (int) $fact->event_id;
                if ((string) $fact->fact_source === 'canonical') {
                    if ((string) $fact->capacity_pool_key === $defaultPool) {
                        $canonicalDefaultSubjects[$eventId] = true;
                    }
                    if ((string) $fact->fact_state === 'confirmed') {
                        $this->confirmedRegistrationCache[
                            $this->eventUserCacheKey($tenantId, (int) $user->getKey(), $eventId)
                        ] = true;
                    }
                } elseif (in_array((string) $fact->fact_state, self::CONFIRMED_RSVP_STATES, true)) {
                    $legacyConfirmed[$eventId] = true;
                }
            }
            foreach (array_keys($legacyConfirmed) as $eventId) {
                if (isset($canonicalDefaultSubjects[$eventId])) {
                    continue;
                }
                $this->confirmedRegistrationCache[
                    $this->eventUserCacheKey($tenantId, (int) $user->getKey(), $eventId)
                ] = true;
            }
        } catch (Throwable) {
            // False defaults fail closed for meeting-link eligibility.
        }

        try {
            $canonicalAvailable = $this->tableAvailability('event_waitlist_entries');
            $legacyAvailable = $this->tableAvailability('event_waitlist');
            if ($canonicalAvailable === null || $legacyAvailable === null
                || (! $canonicalAvailable && ! $legacyAvailable)) {
                throw new \RuntimeException('Event waitlist schema availability is ambiguous.');
            }

            $defaultPool = $this->defaultCapacityPoolKey();
            $waitlistFactsQuery = $canonicalAvailable
                ? DB::table('event_waitlist_entries')
                    ->select(['event_id', 'capacity_pool_key'])
                    ->selectRaw('queue_state AS fact_state')
                    ->selectRaw("'canonical' AS fact_source")
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', (int) $user->getKey())
                    ->whereIn('event_id', $eventIds)
                : null;
            if ($legacyAvailable) {
                $legacyQuery = DB::table('event_waitlist')
                    ->select('event_id')
                    ->selectRaw('NULL AS capacity_pool_key')
                    ->selectRaw('status AS fact_state')
                    ->selectRaw("'legacy' AS fact_source")
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', (int) $user->getKey())
                    ->whereIn('event_id', $eventIds);
                $waitlistFactsQuery = $waitlistFactsQuery === null
                    ? $legacyQuery
                    : $waitlistFactsQuery->union($legacyQuery);
            }

            $canonicalDefaultSubjects = [];
            $canonicalActive = [];
            $legacyActive = [];
            $waitlistFacts = $waitlistFactsQuery?->get() ?? collect();
            foreach ($waitlistFacts as $fact) {
                $eventId = (int) $fact->event_id;
                if ((string) $fact->fact_source === 'canonical') {
                    if ((string) $fact->capacity_pool_key === $defaultPool) {
                        $canonicalDefaultSubjects[$eventId] = true;
                    }
                    if (in_array((string) $fact->fact_state, ['waiting', 'offered'], true)) {
                        $canonicalActive[$eventId] = true;
                    }
                } elseif ((string) $fact->fact_state === 'waiting') {
                    $legacyActive[$eventId] = true;
                }
            }
            foreach ($eventIds as $eventId) {
                $this->activeWaitlistCache[
                    $this->eventUserCacheKey($tenantId, (int) $user->getKey(), $eventId)
                ] = isset($canonicalActive[$eventId])
                    || (isset($legacyActive[$eventId]) && ! isset($canonicalDefaultSubjects[$eventId]));
            }
        } catch (Throwable) {
            // True defaults fail closed for meeting-link eligibility.
        }

        try {
            $assignments = DB::table('event_staff_assignments')
                ->where('tenant_id', $tenantId)
                ->where('user_id', (int) $user->getKey())
                ->whereIn('event_id', $eventIds)
                ->where('status', EventStaffAssignmentStatus::Active->value)
                ->where(static function ($expiry): void {
                    $expiry->whereNull('expires_at')->orWhere('expires_at', '>', now());
                })
                ->get(['event_id', 'role']);
            foreach ($assignments as $assignment) {
                $role = EventStaffRole::tryFrom((string) $assignment->role);
                if ($role === null) {
                    continue;
                }

                $cacheKey = $this->eventUserCacheKey(
                    $tenantId,
                    (int) $user->getKey(),
                    (int) $assignment->event_id,
                );
                foreach ($role->capabilities() as $capability) {
                    $this->assignedCapabilityCache[$cacheKey][$capability->value] = true;
                }
            }
        } catch (Throwable) {
            // Empty defaults fail closed when the delegated-role schema is absent.
        }
    }

    private function clearFactCaches(): void
    {
        $this->linkedGroupCache = [];
        $this->groupMembershipCache = [];
        $this->confirmedRegistrationCache = [];
        $this->activeWaitlistCache = [];
        $this->assignedCapabilityCache = [];
    }

    private function groupCacheKey(int $tenantId, int $groupId): string
    {
        return "{$tenantId}:{$groupId}";
    }

    private function groupMembershipCacheKey(int $tenantId, int $userId, int $groupId): string
    {
        return "{$tenantId}:{$userId}:{$groupId}";
    }

    private function eventUserCacheKey(int $tenantId, int $userId, int $eventId): string
    {
        return "{$tenantId}:{$userId}:{$eventId}";
    }

    private function defaultCapacityPoolKey(): string
    {
        $configured = trim((string) config('events.registration.default_capacity_pool_key', 'event'));

        return $configured !== '' ? $configured : 'event';
    }

    /**
     * Return null when the schema cannot be inspected. Callers treat that as
     * ambiguity and fail closed rather than falling back to a potentially stale
     * projection.
     */
    private function tableAvailability(string $table): ?bool
    {
        if (array_key_exists($table, $this->tableAvailabilityCache)) {
            return $this->tableAvailabilityCache[$table];
        }

        try {
            return $this->tableAvailabilityCache[$table] = Schema::hasTable($table);
        } catch (Throwable) {
            $this->tableAvailabilityCache[$table] = null;
            return null;
        }
    }

    /** Resolve one exact delegated capability without broad-role inference. */
    protected function hasAssignedCapability(
        User $user,
        Event $event,
        string $capability,
    ): bool {
        if (EventStaffCapability::tryFrom($capability) === null) {
            return false;
        }

        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            return false;
        }

        $cacheKey = $this->eventUserCacheKey(
            $tenantId,
            (int) $user->getKey(),
            (int) $event->getKey(),
        );
        if (! array_key_exists($cacheKey, $this->assignedCapabilityCache)) {
            $this->assignedCapabilityCache[$cacheKey] = [];

            try {
                $roles = DB::table('event_staff_assignments')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', (int) $event->getKey())
                    ->where('user_id', (int) $user->getKey())
                    ->where('status', EventStaffAssignmentStatus::Active->value)
                    ->where(static function ($expiry): void {
                        $expiry->whereNull('expires_at')->orWhere('expires_at', '>', now());
                    })
                    ->pluck('role');
                foreach ($roles as $storedRole) {
                    $role = EventStaffRole::tryFrom((string) $storedRole);
                    if ($role === null) {
                        continue;
                    }
                    foreach ($role->capabilities() as $granted) {
                        $this->assignedCapabilityCache[$cacheKey][$granted->value] = true;
                    }
                }
            } catch (Throwable) {
                // Empty cache entry fails closed and prevents repeated queries.
            }
        }

        return isset($this->assignedCapabilityCache[$cacheKey][$capability]);
    }
}
