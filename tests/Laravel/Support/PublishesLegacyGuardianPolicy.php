<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Support;

use App\Models\EventSafetyRequirement;
use App\Models\EventSafetyRequirementVersion;
use App\Models\User;
use App\Services\EventSafetyRequirementService;
use App\Support\Events\EventSafetyFoundationSupport;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Publishes an event safety policy that REQUIRES guardian consent — the shape a
 * policy published before 2026-09-25 can still have.
 *
 * Guardian consent was switched off that day (the platform is adults-only, 18+):
 * EventSafetyRequirementService now refuses `guardian_consent_required: true`,
 * so no organiser can create such a policy any more. The guardian-consent
 * service, tables and triggers were kept so the switch-off is reversible, and
 * the tests that pin their integrity guarantees need a guardian policy to work
 * against. This writes the draft rows directly (satisfying the same database
 * triggers and CHECK constraints the service would) and then publishes through
 * the real service.
 */
trait PublishesLegacyGuardianPolicy
{
    /**
     * @param array<string,mixed> $configuration same keys as EventSafetyRequirementService::saveDraft()
     * @return array{requirements:EventSafetyRequirement,version:EventSafetyRequirementVersion}
     */
    protected function publishLegacyGuardianPolicy(
        int $eventId,
        User $owner,
        array $configuration,
        string $key,
    ): array {
        $support = new EventSafetyFoundationSupport();
        $tenantId = (int) $owner->tenant_id;
        $event = DB::table('events')->where('tenant_id', $tenantId)->where('id', $eventId)->first();
        $now = CarbonImmutable::now('UTC');
        $requirementsId = (int) DB::table('event_safety_requirements')->insertGetId([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'occurrence_key' => (string) $event->occurrence_key,
            'revision' => 1,
            'current_version' => 1,
            'published_version' => null,
            'status' => 'draft',
            'created_by_user_id' => (int) $owner->id,
            'updated_by_user_id' => (int) $owner->id,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $codeRequired = (bool) ($configuration['code_of_conduct_required'] ?? false);
        $codeText = $codeRequired ? (string) $configuration['code_of_conduct_text'] : null;
        $policy = $support->eligibilityPolicyMetadata();
        DB::table('event_safety_requirement_versions')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'requirements_id' => $requirementsId,
            'version_number' => 1,
            'minimum_age' => $configuration['minimum_age'] ?? null,
            'guardian_consent_required' => 1,
            'minor_age_threshold' => (int) ($configuration['minor_age_threshold'] ?? 18),
            'code_of_conduct_required' => $codeRequired ? 1 : 0,
            'code_of_conduct_text' => $codeText,
            'code_of_conduct_text_version' => $codeRequired
                ? trim((string) $configuration['code_of_conduct_text_version'])
                : null,
            'code_of_conduct_text_hash' => $codeText !== null ? $support->exactTextHash($codeText) : null,
            'eligibility_policy_metadata' => json_encode($policy, JSON_THROW_ON_ERROR),
            'eligibility_policy_hash' => $support->requestHash($policy),
            'captured_by_user_id' => (int) $owner->id,
            'idempotency_hash' => hash('sha256', 'legacy-guardian-version:' . $key),
            'request_hash' => hash('sha256', 'legacy-guardian-request:' . $key),
            'created_at' => $now,
        ]);

        $published = (new EventSafetyRequirementService())->publish(
            $eventId,
            $owner,
            1,
            1,
            'legacy-guardian-publish:' . $key,
        );

        return ['requirements' => $published['requirements'], 'version' => $published['version']];
    }
}
