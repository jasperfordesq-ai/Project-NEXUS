<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Exceptions\SafeguardingPolicyException;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Support\Facades\Log;

/**
 * One fail-closed policy boundary for member-to-member interactions.
 *
 * The evaluator is a pure read. Callers record attempted writes separately so
 * opening a conversation never alerts staff or creates an audit event.
 *
 * 🔴 F-336: two questions are answered here, not one.
 *
 *  1. Safeguarding vetting — does the recipient's community require the sender
 *     to hold an attestation before contacting them?
 *  2. Blocking — has either member blocked the other?
 *
 * Until 2026-09-30 this class answered only the first, while its name and this
 * docblock told every author it was "the" contact boundary. 52 files call it;
 * 17 also checked blocks by hand; 35 did not, and each of those was a bypass
 * waiting to be found (F-070, F-158, F-246, F-271, F-279, F-285, F-332 …).
 * The block check now lives on the DIRECTED member-to-member entry points, so
 * a new interaction path is protected by calling this class at all.
 *
 * Two entry points deliberately do NOT apply it, and neither omission is an
 * oversight:
 *
 *  - evaluateExternalContact() has no sender user id — an external partner
 *    actor is not a member, so no block row can describe the pair.
 *  - evaluateManyLocalContacts() is the INDIVISIBLE group-broadcast path, where
 *    one denied recipient denies the whole send. Applying blocking there would
 *    let any member veto another member's group participation by blocking
 *    them. Blocking hides an individual interaction; it is not a group ban.
 *    Group paths that need it apply their own per-recipient rule.
 *
 * Hand-placed BlockUserService checks in callers are kept: they run before this
 * class, they answer with the same BLOCKED code, and a path that owns its own
 * check does not depend on remembering to reach this one.
 */
class SafeguardingInteractionPolicy
{
    /**
     * Steady-state "policy unavailable" reasons already logged by this
     * instance, keyed "tenantId|reason". See logUnavailable().
     *
     * @var array<string, true>
     */
    private array $loggedSteadyStateReasons = [];

    public function __construct(
        private readonly MemberVettingAttestationService $attestations,
        private readonly SafeguardingJurisdictionService $jurisdictions,
    ) {}

    public function evaluateLocalContact(
        int $senderId,
        int $recipientId,
        int $tenantId,
        string $channel = 'direct_message',
    ): SafeguardingInteractionDecision {
        // F-336: blocking is decided first, so a blocked member cannot use the
        // answer to probe the other member's safeguarding settings.
        $blocked = $this->blockedDecision($senderId, $recipientId, $tenantId, crossCommunity: false);
        if ($blocked !== null) {
            return $blocked;
        }

        return $this->evaluate(
            senderUserId: $senderId,
            senderTenantId: $tenantId,
            recipientId: $recipientId,
            recipientTenantId: $tenantId,
            channel: $channel,
            externalActor: false,
        );
    }

    /**
     * Definitive local-contact decision for a write transaction.
     *
     * Lock order is tenant policy, recipient preferences, referenced options,
     * then sender attestations. Every decision input is read directly from the
     * locked database state; shared caches are deliberately bypassed.
     */
    public function evaluateLockedLocalContact(
        int $senderId,
        int $recipientId,
        int $tenantId,
        string $channel = 'direct_message',
    ): SafeguardingInteractionDecision {
        // F-336: decided before any row is locked — a block needs no lock, and
        // refusing first keeps a blocked member out of the lock order entirely.
        $blocked = $this->blockedDecision($senderId, $recipientId, $tenantId, crossCommunity: false);
        if ($blocked !== null) {
            return $blocked;
        }

        try {
            $policy = $this->jurisdictions->lockPolicyForUpdate($tenantId);
        } catch (\Throwable $e) {
            $this->logUnavailable($tenantId, $recipientId, $channel, 'locked_jurisdiction_lookup_failed', $e);

            return $this->unavailable($tenantId, 'SAFEGUARDING_POLICY_UNAVAILABLE');
        }

        try {
            $triggers = SafeguardingTriggerService::getActiveTriggersForUpdate($recipientId, $tenantId);
        } catch (\Throwable $e) {
            $this->logUnavailable($tenantId, $recipientId, $channel, 'locked_trigger_lookup_failed', $e);

            return $this->unavailable($tenantId, 'SAFEGUARDING_POLICY_UNAVAILABLE');
        }

        if (! empty($triggers['requires_vetted_interaction'])) {
            try {
                $this->attestations->lockMemberAttestationsForUpdate($tenantId, $senderId);
            } catch (\Throwable $e) {
                $this->logUnavailable($tenantId, $recipientId, $channel, 'locked_attestation_lookup_failed', $e);

                return $this->unavailable($tenantId, 'SAFEGUARDING_POLICY_UNAVAILABLE');
            }
        }

        return $this->evaluateResolvedState(
            senderUserId: $senderId,
            senderTenantId: $tenantId,
            recipientId: $recipientId,
            recipientTenantId: $tenantId,
            channel: $channel,
            externalActor: false,
            triggers: $triggers,
            policy: $policy,
        );
    }

    public function evaluateCrossTenantContact(
        int $senderId,
        int $senderTenantId,
        int $recipientId,
        int $recipientTenantId,
        string $channel = 'federated_message',
    ): SafeguardingInteractionDecision {
        // F-336 + F-284 (owner decision, 29 Sep 2026): a member may block a
        // member of a partner community, and that block stops their internal
        // federated contact. isBlockedEitherAcrossCommunities() is used when the
        // two members are in different communities because the tenant-scoped
        // read cannot see the other side's row.
        $blocked = $this->blockedDecision(
            $senderId,
            $recipientId,
            $recipientTenantId,
            crossCommunity: $senderTenantId !== $recipientTenantId,
        );
        if ($blocked !== null) {
            return $blocked;
        }

        return $this->evaluate(
            senderUserId: $senderId,
            senderTenantId: $senderTenantId,
            recipientId: $recipientId,
            recipientTenantId: $recipientTenantId,
            channel: $channel,
            externalActor: false,
        );
    }

    public function evaluateExternalContact(
        int $recipientId,
        int $recipientTenantId,
        string $externalActorReference,
        string $channel = 'external_federated_message',
    ): SafeguardingInteractionDecision {
        if ($externalActorReference === '') {
            return $this->unavailable($recipientTenantId, 'SAFEGUARDING_POLICY_UNAVAILABLE');
        }

        return $this->evaluate(
            senderUserId: null,
            senderTenantId: null,
            recipientId: $recipientId,
            recipientTenantId: $recipientTenantId,
            channel: $channel,
            externalActor: true,
        );
    }

    /** @throws SafeguardingPolicyException */
    public function assertLocalContactAllowed(
        int $senderId,
        int $recipientId,
        int $tenantId,
        string $channel,
    ): void {
        $this->throwWhenDenied($this->evaluateLocalContact($senderId, $recipientId, $tenantId, $channel));
    }

    /** @throws SafeguardingPolicyException */
    public function assertCrossTenantContactAllowed(
        int $senderId,
        int $senderTenantId,
        int $recipientId,
        int $recipientTenantId,
        string $channel,
    ): void {
        $this->throwWhenDenied($this->evaluateCrossTenantContact(
            $senderId,
            $senderTenantId,
            $recipientId,
            $recipientTenantId,
            $channel,
        ));
    }

    /**
     * A shared group message is indivisible: one protected recipient denies the
     * entire send. Unavailable takes precedence over an ordinary denial because
     * it must be reported as a retryable policy failure, not missing vetting.
     *
     * 🔴 F-336: this path deliberately evaluates SAFEGUARDING ONLY. It calls
     * evaluate() directly rather than evaluateLocalContact(), so the block
     * check is not folded into the all-or-nothing decision. Folding it in would
     * mean one member could silence another across a whole group simply by
     * blocking them, which is not what blocking means here. Do not "tidy" this
     * back into a call to evaluateLocalContact().
     *
     * @param list<int> $recipientIds
     */
    public function evaluateManyLocalContacts(
        int $senderId,
        array $recipientIds,
        int $tenantId,
        string $channel,
    ): SafeguardingInteractionDecision {
        $firstDenial = null;
        foreach (array_values(array_unique($recipientIds)) as $recipientId) {
            if ($recipientId === $senderId) {
                continue;
            }

            $decision = $this->evaluate(
                senderUserId: $senderId,
                senderTenantId: $tenantId,
                recipientId: $recipientId,
                recipientTenantId: $tenantId,
                channel: $channel,
                externalActor: false,
            );
            if ($decision->isUnavailable()) {
                return $decision;
            }
            if ($decision->isDenied() && $firstDenial === null) {
                $firstDenial = $decision;
            }
        }

        return $firstDenial ?? $this->allowed($tenantId);
    }

    /**
     * Assert an indivisible local contact write against every recipient.
     *
     * @param list<int> $recipientIds
     * @throws SafeguardingPolicyException
     */
    public function assertManyLocalContactsAllowed(
        int $senderId,
        array $recipientIds,
        int $tenantId,
        string $channel,
    ): void {
        $this->throwWhenDenied($this->evaluateManyLocalContacts(
            $senderId,
            $recipientIds,
            $tenantId,
            $channel,
        ));
    }

    /**
     * F-336: the block half of "may A interact with B".
     *
     * Returns a DENY decision when either member has blocked the other, and
     * null when there is nothing to say — so a caller reads it as "no objection
     * from this half", not as "allowed".
     *
     * The answer is deliberately direction-neutral (BlockUserService's own rule)
     * so the actor cannot tell whether they were blocked or are the blocker, and
     * it carries the same BLOCKED code and message the 20 hand-placed
     * assertNoBlockBetween() call sites already produce.
     *
     * canRequestCoordinator is false: a block is the other member's own
     * decision, not a vetting gap a coordinator can help with, so the UI must
     * not offer to escalate it.
     */
    private function blockedDecision(
        ?int $senderUserId,
        int $recipientId,
        int $recipientTenantId,
        bool $crossCommunity,
    ): ?SafeguardingInteractionDecision {
        // An external partner actor has no sender user id, and a self-contact
        // or a non-positive id can never have a block row.
        if ($senderUserId === null || $senderUserId <= 0 || $recipientId <= 0 || $senderUserId === $recipientId) {
            return null;
        }

        $blocked = $crossCommunity
            ? BlockUserService::isBlockedEitherAcrossCommunities($senderUserId, $recipientId)
            : BlockUserService::isBlockedEither($senderUserId, $recipientId);

        if (! $blocked) {
            return null;
        }

        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::DENY,
            code: 'BLOCKED',
            recipientTenantId: $recipientTenantId,
            purposeCode: SafeguardingJurisdictionService::PURPOSE_SAFEGUARDED_MEMBER_CONTACT,
            scopeType: SafeguardingJurisdictionService::SCOPE_TENANT,
            scopeIdentifier: '',
            canRequestCoordinator: false,
        );
    }

    private function evaluate(
        ?int $senderUserId,
        ?int $senderTenantId,
        int $recipientId,
        int $recipientTenantId,
        string $channel,
        bool $externalActor,
    ): SafeguardingInteractionDecision {
        try {
            $triggers = SafeguardingTriggerService::getActiveTriggers($recipientId, $recipientTenantId);
        } catch (\Throwable $e) {
            $this->logUnavailable($recipientTenantId, $recipientId, $channel, 'trigger_lookup_failed', $e);

            return $this->unavailable($recipientTenantId, 'SAFEGUARDING_POLICY_UNAVAILABLE');
        }

        $policy = null;
        if (! empty($triggers['requires_vetted_interaction'])) {
            try {
                $policy = $this->jurisdictions->getPolicy($recipientTenantId);
            } catch (\Throwable $e) {
                $this->logUnavailable($recipientTenantId, $recipientId, $channel, 'jurisdiction_lookup_failed', $e);

                return $this->unavailable($recipientTenantId, 'SAFEGUARDING_POLICY_UNAVAILABLE');
            }
        }

        return $this->evaluateResolvedState(
            senderUserId: $senderUserId,
            senderTenantId: $senderTenantId,
            recipientId: $recipientId,
            recipientTenantId: $recipientTenantId,
            channel: $channel,
            externalActor: $externalActor,
            triggers: $triggers,
            policy: $policy,
        );
    }

    /**
     * @param array<string, mixed> $triggers
     * @param array<string, mixed>|null $policy
     */
    private function evaluateResolvedState(
        ?int $senderUserId,
        ?int $senderTenantId,
        int $recipientId,
        int $recipientTenantId,
        string $channel,
        bool $externalActor,
        array $triggers,
        ?array $policy,
    ): SafeguardingInteractionDecision {

        if (! empty($triggers['restricts_messaging'])) {
            return new SafeguardingInteractionDecision(
                status: SafeguardingInteractionDecision::DENY,
                code: 'SAFEGUARDING_CONTACT_RESTRICTED',
                recipientTenantId: $recipientTenantId,
                purposeCode: SafeguardingJurisdictionService::PURPOSE_SAFEGUARDED_MEMBER_CONTACT,
                scopeType: SafeguardingJurisdictionService::SCOPE_TENANT,
                scopeIdentifier: '',
                canRequestCoordinator: true,
            );
        }

        if (empty($triggers['requires_vetted_interaction'])) {
            return $this->allowed($recipientTenantId);
        }

        $requiredCodes = array_values(array_unique(array_filter(
            is_array($triggers['vetting_types_required'] ?? null)
                ? $triggers['vetting_types_required']
                : [],
            static fn (mixed $code): bool => is_string($code) && $code !== '',
        )));

        if ($requiredCodes === []) {
            $this->logUnavailable($recipientTenantId, $recipientId, $channel, 'missing_attestation_requirement');

            return $this->unavailable($recipientTenantId, 'SAFEGUARDING_POLICY_UNAVAILABLE');
        }

        if ($policy === null || ! SafeguardingJurisdictionService::isContactGateUsable($policy)) {
            $this->logUnavailable($recipientTenantId, $recipientId, $channel, 'jurisdiction_unconfigured_or_unsupported');

            return $this->unavailable($recipientTenantId, 'SAFEGUARDING_POLICY_UNAVAILABLE', $requiredCodes);
        }

        if (count($requiredCodes) !== 1 || $requiredCodes[0] !== $policy['attestation_code']) {
            $this->logUnavailable($recipientTenantId, $recipientId, $channel, 'requirement_policy_mismatch');

            return $this->unavailable($recipientTenantId, 'SAFEGUARDING_POLICY_UNAVAILABLE', $requiredCodes);
        }

        $labels = $this->attestationLabels($requiredCodes);

        // Recipient-tenant policy is authoritative. Until an explicit signed
        // trust contract exists, cross-tenant/external assertions cannot satisfy it.
        if ($externalActor || $senderUserId === null || $senderTenantId !== $recipientTenantId) {
            return new SafeguardingInteractionDecision(
                status: SafeguardingInteractionDecision::DENY,
                code: 'VETTING_REQUIRED',
                recipientTenantId: $recipientTenantId,
                purposeCode: $policy['purpose_code'],
                scopeType: $policy['scope_type'],
                scopeIdentifier: $policy['scope_identifier'],
                policyVersion: $policy['policy_version'],
                requiredAttestationCodes: $requiredCodes,
                requiredAttestationLabels: $labels,
                canRequestCoordinator: true,
            );
        }

        try {
            $confirmed = $this->attestations->hasConfirmedAttestation(
                tenantId: $recipientTenantId,
                memberId: $senderUserId,
                schemeCode: $policy['scheme_code'],
                attestationCode: $policy['attestation_code'],
                purposeCode: $policy['purpose_code'],
                scopeType: $policy['scope_type'],
                scopeIdentifier: $policy['scope_identifier'],
                policyVersion: $policy['policy_version'],
            );
        } catch (\Throwable $e) {
            $this->logUnavailable($recipientTenantId, $recipientId, $channel, 'attestation_lookup_failed', $e);

            return $this->unavailable($recipientTenantId, 'SAFEGUARDING_POLICY_UNAVAILABLE', $requiredCodes);
        }

        if (! $confirmed) {
            return new SafeguardingInteractionDecision(
                status: SafeguardingInteractionDecision::DENY,
                code: 'VETTING_REQUIRED',
                recipientTenantId: $recipientTenantId,
                purposeCode: $policy['purpose_code'],
                scopeType: $policy['scope_type'],
                scopeIdentifier: $policy['scope_identifier'],
                policyVersion: $policy['policy_version'],
                requiredAttestationCodes: $requiredCodes,
                requiredAttestationLabels: $labels,
                canRequestCoordinator: true,
            );
        }

        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'SAFEGUARDING_ALLOWED',
            recipientTenantId: $recipientTenantId,
            purposeCode: $policy['purpose_code'],
            scopeType: $policy['scope_type'],
            scopeIdentifier: $policy['scope_identifier'],
            policyVersion: $policy['policy_version'],
            requiredAttestationCodes: $requiredCodes,
            requiredAttestationLabels: $labels,
        );
    }

    private function allowed(int $recipientTenantId): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'SAFEGUARDING_ALLOWED',
            recipientTenantId: $recipientTenantId,
            purposeCode: SafeguardingJurisdictionService::PURPOSE_SAFEGUARDED_MEMBER_CONTACT,
            scopeType: SafeguardingJurisdictionService::SCOPE_TENANT,
            scopeIdentifier: '',
        );
    }

    /** @throws SafeguardingPolicyException */
    private function throwWhenDenied(SafeguardingInteractionDecision $decision): void
    {
        if ($decision->isAllowed()) {
            return;
        }

        $message = match ($decision->code) {
            // F-336: the same message the 20 hand-placed assertNoBlockBetween()
            // call sites throw, so a member sees one sentence for one situation.
            'BLOCKED' => __('safeguarding.errors.blocked_interaction'),
            'SAFEGUARDING_POLICY_UNAVAILABLE' => __('safeguarding.errors.policy_unavailable'),
            'VETTING_REQUIRED' => __('safeguarding.errors.vetting_required', [
                'types' => implode(', ', $decision->requiredAttestationLabels),
            ]),
            default => __('safeguarding.errors.contact_restricted'),
        };

        throw new SafeguardingPolicyException($decision->code, $message);
    }

    /** @param list<string> $requiredCodes */
    private function unavailable(
        int $recipientTenantId,
        string $code,
        array $requiredCodes = [],
    ): SafeguardingInteractionDecision {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::UNAVAILABLE,
            code: $code,
            recipientTenantId: $recipientTenantId,
            purposeCode: SafeguardingJurisdictionService::PURPOSE_SAFEGUARDED_MEMBER_CONTACT,
            scopeType: SafeguardingJurisdictionService::SCOPE_TENANT,
            scopeIdentifier: '',
            requiredAttestationCodes: $requiredCodes,
            requiredAttestationLabels: $this->attestationLabels($requiredCodes),
            canRequestCoordinator: true,
        );
    }

    /** @param list<string> $codes @return list<string> */
    private function attestationLabels(array $codes): array
    {
        return array_map(static function (string $code): string {
            $key = 'safeguarding.vetting_types.' . $code;
            $translated = __($key);

            return $translated === $key
                ? ucwords(str_replace('_', ' ', $code))
                : $translated;
        }, $codes);
    }

    private function logUnavailable(
        int $tenantId,
        int $recipientId,
        string $channel,
        string $reason,
        ?\Throwable $exception = null,
    ): void {
        // Steady-state configuration facts are identical on every evaluation
        // until an admin acts, so they log at WARNING (kept in daily/stderr,
        // below the sentry channel's ERROR threshold). Genuine lookup
        // failures stay at ERROR. Before 2026-08-28 everything here was
        // ERROR, and one matches page load in an unconfigured tenant emitted
        // it once per protected candidate per direction (Sentry 134069538).
        $steadyState = in_array($reason, [
            'jurisdiction_unconfigured_or_unsupported',
            'requirement_policy_mismatch',
            'missing_attestation_requirement',
        ], true);

        // The matching engines reuse one policy instance across hundreds of
        // candidates in a single request; repeating an identical steady-state
        // line for each adds volume, not information. Transient failures are
        // not deduplicated — each may carry a different exception.
        if ($steadyState) {
            $memoKey = $tenantId . '|' . $reason;
            if (isset($this->loggedSteadyStateReasons[$memoKey])) {
                return;
            }
            $this->loggedSteadyStateReasons[$memoKey] = true;
        }

        $context = array_filter([
            'tenant_id' => $tenantId,
            'recipient_id' => $recipientId,
            'channel' => $channel,
            'reason_code' => $reason,
            'exception_class' => $exception !== null ? $exception::class : null,
        ], static fn (mixed $value): bool => $value !== null);

        if ($steadyState) {
            Log::warning('Safeguarding interaction policy unavailable', $context);

            return;
        }

        Log::error('Safeguarding interaction policy unavailable', $context);
    }
}
