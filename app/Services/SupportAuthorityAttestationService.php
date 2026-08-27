<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\AccountRelationship;
use App\Support\Safeguarding\SupportTiers;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * Legal-basis attestation for support relationships (guardian redesign,
 * phase 6) — the staff-decision surface for act-alone (represent) power,
 * cloned from the member-vetting attestation pattern:
 *
 * - Staff attest that they SIGHTED formal authority (a decision-making
 *   representative order, power of attorney, or registered ADMCA 2015
 *   arrangement). The explicit acknowledgement is required, never inferred.
 * - EVIDENCE IS REFUSED at the controller. This service stores only the
 *   attestation, an encrypted scope summary and encrypted private notes —
 *   the platform must not become a store of capacity orders.
 * - Revocation uses a CLOSED reason vocabulary.
 * - Every transition writes an append-only event (DB-trigger enforced) with
 *   decision_before / decision_after, actor and policy version.
 *
 * An attestation is a RECORD, not authorisation — nothing anywhere grants
 * power because of it. The represent tier itself remains granted only by the
 * supported member. This surface exists so a community can answer "what is
 * this act-alone power based on?" with something better than memory.
 */
class SupportAuthorityAttestationService
{
    public const POLICY_VERSION = '1';

    /** ADMCA 2015 / EPA authority types. Closed vocabulary. */
    public const AUTHORITY_TYPES = [
        'dmr_court_order',
        'power_of_attorney',
        'edm_assistant_agreement',
        'co_decision_agreement',
    ];

    /** Closed revocation vocabulary — free text is how trails become unqueryable. */
    public const REVOCATION_REASON_CODES = [
        'authority_ended',
        'superseded',
        'entered_in_error',
        'expired',
        'other_documented',
    ];

    private array $errors = [];

    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * Attest that formal authority behind a relationship has been sighted.
     * Re-attesting a previously revoked (tenant, relationship, type) row
     * transitions it back to active; the events table carries the history.
     *
     * @return array<string, mixed>|null The presented attestation, or null
     *         with errors populated.
     */
    public function attest(
        int $staffUserId,
        int $relationshipId,
        string $authorityType,
        bool $acknowledgedSighted,
        ?string $scopeSummary = null,
        ?string $privateNotes = null,
    ): ?array {
        $this->errors = [];

        if (! in_array($authorityType, self::AUTHORITY_TYPES, true)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.authority_invalid_type')];
            return null;
        }
        if (! $acknowledgedSighted) {
            // The acknowledgement is the substance of the attestation — a row
            // written without it would be a claim nobody actually made.
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.authority_ack_required')];
            return null;
        }

        $tenantId = TenantContext::getId();

        /** @var AccountRelationship|null $relationship */
        $relationship = AccountRelationship::query()
            ->where('id', $relationshipId)
            ->where('status', 'active')
            ->first();

        if (! $relationship) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.authority_relationship_not_found')];
            return null;
        }

        return DB::transaction(function () use ($tenantId, $staffUserId, $relationship, $authorityType, $scopeSummary, $privateNotes): array {
            $existing = DB::table('support_authority_attestations')
                ->where('tenant_id', $tenantId)
                ->where('relationship_id', $relationship->id)
                ->where('authority_type', $authorityType)
                ->lockForUpdate()
                ->first();

            $now = now();
            $values = [
                'acknowledged_sighted' => true,
                'scope_summary_encrypted' => $scopeSummary !== null && trim($scopeSummary) !== ''
                    ? Crypt::encryptString(mb_substr(trim($scopeSummary), 0, 2000))
                    : null,
                'private_notes_encrypted' => $privateNotes !== null && trim($privateNotes) !== ''
                    ? Crypt::encryptString(mb_substr(trim($privateNotes), 0, 2000))
                    : null,
                'decision' => 'active',
                'attested_by' => $staffUserId,
                'attested_at' => $now,
                'revoked_by' => null,
                'revoked_at' => null,
                'revocation_reason_code' => null,
                'policy_version' => self::POLICY_VERSION,
                'updated_at' => $now,
            ];

            if ($existing) {
                DB::table('support_authority_attestations')->where('id', $existing->id)->update($values);
                $attestationId = (int) $existing->id;
                $eventType = 're_attested';
                $decisionBefore = (string) $existing->decision;
            } else {
                $attestationId = (int) DB::table('support_authority_attestations')->insertGetId($values + [
                    'tenant_id' => $tenantId,
                    'relationship_id' => (int) $relationship->id,
                    'supported_user_id' => (int) $relationship->child_user_id,
                    'authority_type' => $authorityType,
                    'created_at' => $now,
                ]);
                $eventType = 'attested';
                $decisionBefore = null;
            }

            $this->writeEvent($tenantId, $attestationId, (int) $relationship->id, (int) $relationship->child_user_id, $eventType, $decisionBefore, 'active', null, $staffUserId);
            $this->audit($staffUserId, (int) $relationship->child_user_id, 'support_authority_attested', [
                'attestation_id' => $attestationId,
                'relationship_id' => (int) $relationship->id,
                'authority_type' => $authorityType,
            ]);

            return ['id' => $attestationId, 'decision' => 'active', 'authority_type' => $authorityType];
        });
    }

    /** Revoke an attestation with a reason from the closed vocabulary. */
    public function revoke(int $staffUserId, int $attestationId, string $reasonCode): bool
    {
        $this->errors = [];

        if (! in_array($reasonCode, self::REVOCATION_REASON_CODES, true)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.authority_invalid_reason')];
            return false;
        }

        $tenantId = TenantContext::getId();

        return DB::transaction(function () use ($tenantId, $staffUserId, $attestationId, $reasonCode): bool {
            $existing = DB::table('support_authority_attestations')
                ->where('tenant_id', $tenantId)
                ->where('id', $attestationId)
                ->where('decision', 'active')
                ->lockForUpdate()
                ->first();

            if (! $existing) {
                $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.authority_relationship_not_found')];
                return false;
            }

            DB::table('support_authority_attestations')->where('id', $attestationId)->update([
                'decision' => 'revoked',
                'revoked_by' => $staffUserId,
                'revoked_at' => now(),
                'revocation_reason_code' => $reasonCode,
                'updated_at' => now(),
            ]);

            $this->writeEvent($tenantId, $attestationId, (int) $existing->relationship_id, (int) $existing->supported_user_id, 'revoked', 'active', 'revoked', $reasonCode, $staffUserId);
            $this->audit($staffUserId, (int) $existing->supported_user_id, 'support_authority_revoked', [
                'attestation_id' => $attestationId,
                'reason_code' => $reasonCode,
            ]);

            return true;
        });
    }

    /**
     * The staff view: every ACTIVE relationship in the tenant whose resolved
     * tiers include act-alone (represent) power on any capability, with the
     * attestations recorded against it. This is the population the phase-6
     * record-keeping exists for.
     *
     * @return array<int, array<string, mixed>>
     */
    public function listRepresentRelationships(): array
    {
        $relationships = AccountRelationship::query()
            ->with([
                'parentUser:id,first_name,last_name,profile_type,organization_name',
                'childUser:id,first_name,last_name,profile_type,organization_name',
            ])
            ->where('status', 'active')
            ->orderByDesc('created_at')
            ->limit(200)
            ->get()
            ->filter(function (AccountRelationship $rel): bool {
                $tiers = SupportTiers::resolve(is_array($rel->permissions) ? $rel->permissions : []);
                return in_array(SupportTiers::REPRESENT, $tiers, true);
            });

        if ($relationships->isEmpty()) {
            return [];
        }

        $attestations = DB::table('support_authority_attestations')
            ->whereIn('relationship_id', $relationships->pluck('id')->all())
            ->orderBy('id')
            ->get()
            ->groupBy('relationship_id');

        return $relationships->map(function (AccountRelationship $rel) use ($attestations): array {
            return [
                'relationship_id' => (int) $rel->id,
                'supporter_name' => $rel->parentUser
                    ? UserDisplayName::resolve($rel->parentUser)
                    : null,
                'supported_name' => $rel->childUser
                    ? UserDisplayName::resolve($rel->childUser)
                    : null,
                'relationship_type' => $rel->relationship_type,
                'tiers' => SupportTiers::resolve(is_array($rel->permissions) ? $rel->permissions : []),
                'attestations' => collect($attestations->get($rel->id, collect()))->map(
                    fn (object $a): array => $this->present($a),
                )->values()->all(),
            ];
        })->values()->all();
    }

    /** @return array<string, mixed> Decrypted for the staff-gated endpoint only. */
    private function present(object $a): array
    {
        return [
            'id' => (int) $a->id,
            'authority_type' => $a->authority_type,
            'decision' => $a->decision,
            'scope_summary' => $this->decrypt($a->scope_summary_encrypted),
            'attested_at' => $a->attested_at,
            'revoked_at' => $a->revoked_at,
            'revocation_reason_code' => $a->revocation_reason_code,
            'policy_version' => $a->policy_version,
        ];
    }

    private function decrypt(?string $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        try {
            return Crypt::decryptString($value);
        } catch (\Throwable) {
            // An undecryptable value must read as absent, never as ciphertext.
            return null;
        }
    }

    private function writeEvent(
        int $tenantId,
        int $attestationId,
        int $relationshipId,
        int $supportedUserId,
        string $eventType,
        ?string $decisionBefore,
        string $decisionAfter,
        ?string $reasonCode,
        int $actorUserId,
    ): void {
        DB::table('support_authority_attestation_events')->insert([
            'tenant_id' => $tenantId,
            'attestation_id' => $attestationId,
            'relationship_id' => $relationshipId,
            'supported_user_id' => $supportedUserId,
            'event_type' => $eventType,
            'decision_before' => $decisionBefore,
            'decision_after' => $decisionAfter,
            'reason_code' => $reasonCode,
            'actor_user_id' => $actorUserId,
            'policy_version' => self::POLICY_VERSION,
            'created_at' => now(),
        ]);
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
            Log::error('Failed to audit support authority attestation', [
                'action' => $action,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
