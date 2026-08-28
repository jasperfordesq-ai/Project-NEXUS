<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Exceptions\SafeguardingPolicyException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Explicit tenant safeguarding jurisdiction and controlled contact policy.
 *
 * Country code is deliberately not consulted: GB cannot distinguish England
 * and Wales, Scotland, and Northern Ireland.
 */
class SafeguardingJurisdictionService
{
    public const PURPOSE_SAFEGUARDED_MEMBER_CONTACT = 'safeguarded_member_contact';
    public const SCOPE_TENANT = 'tenant';
    public const UNCONFIGURED = 'unconfigured';

    private const CACHE_PREFIX = 'safeguarding_jurisdiction:';
    private const CACHE_TTL = 300;

    /** @var array<string, array<string, mixed>> */
    private const POLICIES = [
        'united_kingdom' => [
            'scheme_code' => 'uk_national_safeguarding',
            'attestation_code' => 'uk_safeguarding_clearance',
            'policy_version' => 'safeguarded-contact-v2',
            'contact_policy_available' => true,
            'label_key' => 'safeguarding.jurisdictions.united_kingdom',
            'attestation_label_key' => 'safeguarding.attestations.uk_safeguarding_clearance',
            'preset' => 'united_kingdom',
            'certification_options' => [
                [
                    'code' => 'dbs_enhanced',
                    'jurisdiction' => 'england_wales',
                    'label_key' => 'safeguarding.vetting_types.dbs_enhanced',
                    'authority_expiry_required' => false,
                ],
                [
                    'code' => 'pvg_scotland',
                    'jurisdiction' => 'scotland',
                    'label_key' => 'safeguarding.vetting_types.pvg_scotland',
                    'authority_expiry_required' => true,
                ],
                [
                    'code' => 'access_ni',
                    'jurisdiction' => 'northern_ireland',
                    'label_key' => 'safeguarding.vetting_types.access_ni',
                    'authority_expiry_required' => false,
                ],
            ],
        ],
        'england_wales' => [
            'scheme_code' => 'dbs_england_wales',
            'attestation_code' => 'dbs_enhanced',
            'policy_version' => 'safeguarded-contact-v1',
            'contact_policy_available' => true,
            'label_key' => 'safeguarding.jurisdictions.england_wales',
            'attestation_label_key' => 'safeguarding.attestations.dbs_enhanced',
            'preset' => 'england_wales',
            'certification_options' => [[
                'code' => 'dbs_enhanced',
                'jurisdiction' => 'england_wales',
                'label_key' => 'safeguarding.vetting_types.dbs_enhanced',
                'authority_expiry_required' => false,
            ]],
        ],
        'scotland' => [
            'scheme_code' => 'pvg_scotland',
            'attestation_code' => 'pvg_scotland',
            'policy_version' => 'safeguarded-contact-v1',
            'contact_policy_available' => true,
            'label_key' => 'safeguarding.jurisdictions.scotland',
            'attestation_label_key' => 'safeguarding.attestations.pvg_scotland',
            'preset' => 'scotland',
            'certification_options' => [[
                'code' => 'pvg_scotland',
                'jurisdiction' => 'scotland',
                'label_key' => 'safeguarding.vetting_types.pvg_scotland',
                'authority_expiry_required' => true,
            ]],
        ],
        'northern_ireland' => [
            'scheme_code' => 'access_ni',
            'attestation_code' => 'access_ni',
            'policy_version' => 'safeguarded-contact-v1',
            'contact_policy_available' => true,
            'label_key' => 'safeguarding.jurisdictions.northern_ireland',
            'attestation_label_key' => 'safeguarding.attestations.access_ni',
            'preset' => 'northern_ireland',
            'certification_options' => [[
                'code' => 'access_ni',
                'jurisdiction' => 'northern_ireland',
                'label_key' => 'safeguarding.vetting_types.access_ni',
                'authority_expiry_required' => false,
            ]],
        ],
        // Enabled 2026-08-28 (owner decision): Garda Vetting gating was
        // switched off, which left every Irish tenant permanently unable to
        // satisfy the contact gate — members who chose "only vetted people
        // may contact me" silently emptied their own matches lists
        // (Sentry 134069538). Garda vetting disclosures carry no printed
        // expiry date, so authority_expiry_required is false; brokers may
        // still record a voluntary review date.
        'ireland' => [
            'scheme_code' => 'garda_vetting',
            'attestation_code' => 'garda_vetting',
            'policy_version' => 'safeguarded-contact-v1',
            'contact_policy_available' => true,
            'label_key' => 'safeguarding.jurisdictions.ireland',
            'attestation_label_key' => 'safeguarding.attestations.garda_vetting',
            'preset' => 'ireland',
            'certification_options' => [[
                'code' => 'garda_vetting',
                'jurisdiction' => 'ireland',
                'label_key' => 'safeguarding.vetting_types.garda_vetting',
                'authority_expiry_required' => false,
            ]],
        ],
        'custom' => [
            'scheme_code' => null,
            'attestation_code' => null,
            'policy_version' => 'custom-unconfigured-v1',
            'contact_policy_available' => false,
            'label_key' => 'safeguarding.jurisdictions.custom',
            'attestation_label_key' => null,
            'preset' => null,
            'certification_options' => [],
        ],
    ];

    /**
     * @return array{configured: bool, contact_policy_available: bool, jurisdiction: string, scheme_code: string|null, attestation_code: string|null, purpose_code: string, scope_type: string, scope_identifier: string, policy_version: string|null, label: string, attestation_label: string|null, preset: string|null}
     */
    public function getPolicy(int $tenantId): array
    {
        return Cache::remember(self::CACHE_PREFIX . $tenantId, self::CACHE_TTL, function () use ($tenantId): array {
            return $this->getPolicyUncached($tenantId);
        });
    }

    /**
     * Read the authoritative policy without consulting or populating shared cache.
     *
     * @return array{configured: bool, contact_policy_available: bool, jurisdiction: string, scheme_code: string|null, attestation_code: string|null, purpose_code: string, scope_type: string, scope_identifier: string, policy_version: string|null, label: string, attestation_label: string|null, preset: string|null}
     */
    public function getPolicyUncached(int $tenantId): array
    {
        $row = DB::table('tenant_safeguarding_settings')
            ->where('tenant_id', $tenantId)
            ->first();

        return $this->policyFromSetting($row);
    }

    /**
     * Lock the tenant policy mutex and derive policy from the locked settings
     * row. Definitive authorization writes must use this method rather than
     * invalidating and re-entering the shared cache, because an already-running
     * cache callback can repopulate stale state after invalidation.
     *
     * The tenant row is a guaranteed mutex even before safeguarding has been
     * configured, so a new preference cannot phantom past a definitive check.
     * Callers must already be inside a database transaction.
     *
     * @return array{configured: bool, contact_policy_available: bool, jurisdiction: string, scheme_code: string|null, attestation_code: string|null, purpose_code: string, scope_type: string, scope_identifier: string, policy_version: string|null, label: string, attestation_label: string|null, preset: string|null}
     */
    public function lockPolicyForUpdate(int $tenantId): array
    {
        if (DB::transactionLevel() < 1) {
            throw new \LogicException('Safeguarding policy locks require an active database transaction.');
        }

        DB::table('tenants')
            ->where('id', $tenantId)
            ->lockForUpdate()
            ->first(['id']);

        $row = DB::table('tenant_safeguarding_settings')
            ->where('tenant_id', $tenantId)
            ->lockForUpdate()
            ->first();

        return $this->policyFromSetting($row);
    }

    /**
     * @return array{configured: bool, contact_policy_available: bool, jurisdiction: string, scheme_code: string|null, attestation_code: string|null, purpose_code: string, scope_type: string, scope_identifier: string, policy_version: string|null, label: string, attestation_label: string|null, preset: string|null}
     */
    public function configure(int $tenantId, string $jurisdiction, int $actorUserId): array
    {
        if ($jurisdiction !== self::UNCONFIGURED && ! array_key_exists($jurisdiction, self::POLICIES)) {
            throw new SafeguardingPolicyException('INVALID_SAFEGUARDING_JURISDICTION');
        }

        if ($jurisdiction === self::UNCONFIGURED) {
            DB::table('tenant_safeguarding_settings')
                ->where('tenant_id', $tenantId)
                ->delete();
            $this->forget($tenantId);

            return $this->getPolicy($tenantId);
        }

        $definition = self::POLICIES[$jurisdiction];
        $now = now();

        $existing = DB::table('tenant_safeguarding_settings')
            ->where('tenant_id', $tenantId)
            ->first();
        if ($existing !== null && $existing->jurisdiction === $jurisdiction) {
            return $this->getPolicy($tenantId);
        }

        $policyVersion = $definition['policy_version'] . ':' . Str::uuid()->toString();

        if ($existing === null) {
            DB::table('tenant_safeguarding_settings')->insert([
                'tenant_id' => $tenantId,
                'jurisdiction' => $jurisdiction,
                'policy_version' => $policyVersion,
                'configured_by' => $actorUserId,
                'configured_at' => $now,
                'updated_at' => $now,
                'created_at' => $now,
            ]);
        } else {
            DB::table('tenant_safeguarding_settings')
                ->where('tenant_id', $tenantId)
                ->update([
                    'jurisdiction' => $jurisdiction,
                    'policy_version' => $policyVersion,
                    'configured_by' => $actorUserId,
                    'configured_at' => $now,
                    'updated_at' => $now,
                ]);
        }

        $this->forget($tenantId);

        return $this->getPolicy($tenantId);
    }

    /**
     * Rotate the operational policy version without claiming that a criminal-
     * record certificate has expired. Existing confirmations stop authorising
     * until a broker explicitly reconfirms them under the new policy.
     *
     * @return array{policy: array<string, mixed>, affected_member_ids: list<int>}
     */
    public function rotatePolicyVersion(int $tenantId, int $actorUserId, string $reasonCode): array
    {
        $affectedMemberIds = DB::transaction(function () use ($tenantId, $actorUserId, $reasonCode): array {
            $policy = $this->lockPolicyForUpdate($tenantId);
            if (! $policy['configured']) {
                throw new SafeguardingPolicyException('SAFEGUARDING_JURISDICTION_REQUIRED');
            }

            $jurisdiction = $policy['jurisdiction'];
            $definition = self::POLICIES[$jurisdiction] ?? null;
            if ($definition === null) {
                throw new SafeguardingPolicyException('SAFEGUARDING_JURISDICTION_REQUIRED');
            }
            if (! $definition['contact_policy_available']
                || $definition['scheme_code'] === null
                || $definition['attestation_code'] === null) {
                throw new SafeguardingPolicyException('SAFEGUARDING_POLICY_UNAVAILABLE');
            }

            $previousVersion = is_string($policy['policy_version'])
                ? trim($policy['policy_version'])
                : '';
            if ($previousVersion === '') {
                throw new SafeguardingPolicyException('SAFEGUARDING_JURISDICTION_REQUIRED');
            }

            $affectedMemberIds = DB::table('member_vetting_attestations')
                ->where('tenant_id', $tenantId)
                ->where('scheme_code', $definition['scheme_code'])
                ->where('attestation_code', $definition['attestation_code'])
                ->where('purpose_code', self::PURPOSE_SAFEGUARDED_MEMBER_CONTACT)
                ->where('scope_type', self::SCOPE_TENANT)
                ->where('scope_identifier', '')
                ->where('policy_version', $previousVersion)
                ->where('decision', 'confirmed')
                ->distinct()
                ->pluck('user_id')
                ->map(static fn ($id): int => (int) $id)
                ->values()
                ->all();

            $newVersion = explode(':', $previousVersion, 2)[0] . ':' . Str::uuid()->toString();
            $now = now();

            DB::table('tenant_safeguarding_settings')
                ->where('tenant_id', $tenantId)
                ->where('policy_version', $previousVersion)
                ->update([
                    'policy_version' => $newVersion,
                    'configured_by' => $actorUserId,
                    'configured_at' => $now,
                    'updated_at' => $now,
                ]);

            foreach ($affectedMemberIds as $memberId) {
                DB::table('safeguarding_vetting_review_requests')->updateOrInsert(
                    [
                        'tenant_id' => $tenantId,
                        'user_id' => $memberId,
                        'purpose_code' => self::PURPOSE_SAFEGUARDED_MEMBER_CONTACT,
                        'scope_type' => self::SCOPE_TENANT,
                        'scope_identifier' => '',
                    ],
                    [
                        'jurisdiction' => $jurisdiction,
                        'scheme_code' => $definition['scheme_code'],
                        'attestation_code' => $definition['attestation_code'],
                        'policy_version' => $newVersion,
                        'status' => 'pending',
                        'request_source' => 'policy_rotation',
                        'requested_by' => $actorUserId,
                        'requested_at' => $now,
                        'handled_by' => null,
                        'handled_at' => null,
                        'resolution_code' => null,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ],
                );
            }

            DB::table('safeguarding_policy_rotation_events')->insert([
                'tenant_id' => $tenantId,
                'jurisdiction' => $jurisdiction,
                'scheme_code' => $definition['scheme_code'],
                'attestation_code' => $definition['attestation_code'],
                'purpose_code' => self::PURPOSE_SAFEGUARDED_MEMBER_CONTACT,
                'scope_type' => self::SCOPE_TENANT,
                'scope_identifier' => '',
                'previous_policy_version' => $previousVersion,
                'new_policy_version' => $newVersion,
                'reason_code' => $reasonCode,
                'actor_user_id' => $actorUserId,
                'affected_member_count' => count($affectedMemberIds),
                'created_at' => $now,
            ]);

            return $affectedMemberIds;
        });

        $this->forget($tenantId);

        return [
            'policy' => $this->getPolicy($tenantId),
            'affected_member_ids' => $affectedMemberIds,
        ];
    }

    public function forget(int $tenantId): void
    {
        Cache::forget(self::CACHE_PREFIX . $tenantId);
    }

    /**
     * Whether a policy array (from getPolicy/getPolicyUncached/
     * lockPolicyForUpdate) can actually operate the vetted-contact gate.
     * This is THE definition of "usable" — it was previously copied inline
     * in four services, which is how they drift apart. Field-by-field: the
     * tenant chose a jurisdiction, that jurisdiction supports contact
     * gating, and the scheme/attestation/version triple the attestation
     * queries key on is complete.
     *
     * @param array<string, mixed> $policy
     */
    public static function isContactGateUsable(array $policy): bool
    {
        return ! empty($policy['configured'])
            && ! empty($policy['contact_policy_available'])
            && ($policy['scheme_code'] ?? null) !== null
            && ($policy['attestation_code'] ?? null) !== null
            && ($policy['policy_version'] ?? null) !== null;
    }

    public static function isSupportedAttestationCode(string $code): bool
    {
        foreach (self::POLICIES as $policy) {
            if ($policy['attestation_code'] === $code) {
                return true;
            }
        }

        return false;
    }

    /** @return list<array<string, mixed>> */
    public function availableJurisdictions(): array
    {
        $items = [[
            'code' => self::UNCONFIGURED,
            'label' => __('safeguarding.jurisdictions.unconfigured'),
            'attestation_code' => null,
            'attestation_label' => null,
            'available_for_contact_policy' => false,
            'contact_policy_available' => false,
            'certification_options' => [],
        ]];
        foreach (self::POLICIES as $code => $definition) {
            $items[] = [
                'code' => $code,
                'label' => __($definition['label_key']),
                'attestation_code' => $definition['attestation_code'],
                'attestation_label' => $definition['attestation_label_key'] !== null
                    ? __($definition['attestation_label_key'])
                    : null,
                'available_for_contact_policy' => $definition['contact_policy_available'],
                'contact_policy_available' => $definition['contact_policy_available'],
                'certification_options' => $this->localizedCertificationOptions($definition),
            ];
        }

        return $items;
    }

    /** @return array<string, mixed> */
    private function unconfiguredPolicy(): array
    {
        return [
            'configured' => false,
            'contact_policy_available' => false,
            'jurisdiction' => self::UNCONFIGURED,
            'scheme_code' => null,
            'attestation_code' => null,
            'purpose_code' => self::PURPOSE_SAFEGUARDED_MEMBER_CONTACT,
            'scope_type' => self::SCOPE_TENANT,
            'scope_identifier' => '',
            'policy_version' => null,
            'label' => __('safeguarding.jurisdictions.unconfigured'),
            'attestation_label' => null,
            'preset' => null,
            'certification_options' => [],
        ];
    }

    /**
     * @return array{configured: bool, contact_policy_available: bool, jurisdiction: string, scheme_code: string|null, attestation_code: string|null, purpose_code: string, scope_type: string, scope_identifier: string, policy_version: string|null, label: string, attestation_label: string|null, preset: string|null}
     */
    private function policyFromSetting(?object $row): array
    {
        $jurisdiction = is_string($row?->jurisdiction ?? null)
            ? (string) $row->jurisdiction
            : self::UNCONFIGURED;
        $definition = self::POLICIES[$jurisdiction] ?? null;

        if ($definition === null) {
            return $this->unconfiguredPolicy();
        }

        return [
            'configured' => true,
            'contact_policy_available' => $definition['contact_policy_available'],
            'jurisdiction' => $jurisdiction,
            'scheme_code' => $definition['scheme_code'],
            'attestation_code' => $definition['attestation_code'],
            'purpose_code' => self::PURPOSE_SAFEGUARDED_MEMBER_CONTACT,
            'scope_type' => self::SCOPE_TENANT,
            'scope_identifier' => '',
            'policy_version' => is_string($row?->policy_version ?? null)
                ? (string) $row->policy_version
                : $definition['policy_version'],
            'label' => __($definition['label_key']),
            'attestation_label' => $definition['attestation_label_key'] !== null
                ? __($definition['attestation_label_key'])
                : null,
            'preset' => $definition['preset'],
            'certification_options' => $this->localizedCertificationOptions($definition),
        ];
    }

    /** @param array<string, mixed> $definition @return list<array<string, mixed>> */
    private function localizedCertificationOptions(array $definition): array
    {
        $options = is_array($definition['certification_options'] ?? null)
            ? $definition['certification_options']
            : [];

        return array_values(array_map(static fn (array $option): array => [
            'code' => (string) $option['code'],
            'jurisdiction' => (string) $option['jurisdiction'],
            'label' => __((string) $option['label_key']),
            'authority_expiry_required' => (bool) ($option['authority_expiry_required'] ?? false),
        ], $options));
    }
}
