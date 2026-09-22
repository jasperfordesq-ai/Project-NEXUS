<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Events;

use Carbon\CarbonImmutable;

/** Minimal, expiring offline projection. It intentionally excludes contact and form data. */
final readonly class EventCheckinManifest
{
    /**
     * @param list<array{
     *   registration_id:int,
     *   user_id:int,
     *   display_name:string,
     *   credential_version:int,
     *   credential_fingerprint:string,
     *   credential_verifier:string,
     *   attendance_status:?string,
     *   attendance_version:int,
     *   undo_state?:?string
     * }> $registrations
     * @param list<array{kid:string,alg:string,public_key:string}> $verificationKeys
     */
    public function __construct(
        public int $tenantId,
        public int $eventId,
        public string $occurrenceKey,
        public int $manifestVersion,
        public int $deviceId,
        public int $deviceVersion,
        public CarbonImmutable $generatedAt,
        public CarbonImmutable $expiresAt,
        public array $registrations,
        public array $verificationKeys,
        public int $schemaVersion = 2,
    ) {
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return [
            'schema_version' => $this->schemaVersion,
            'tenant_id' => $this->tenantId,
            'event_id' => $this->eventId,
            'occurrence_key' => $this->occurrenceKey,
            'manifest_version' => $this->manifestVersion,
            'device' => [
                'id' => $this->deviceId,
                'version' => $this->deviceVersion,
            ],
            'generated_at' => $this->generatedAt->toIso8601String(),
            'expires_at' => $this->expiresAt->toIso8601String(),
            'credential_verification' => [
                'format' => 'nqx2',
                'algorithm' => 'Ed25519',
                'keys' => $this->verificationKeys,
            ],
            'registrations' => $this->registrations,
            'privacy' => [
                'credential_contains_pii' => false,
                'encrypted_at_rest_required' => true,
            ],
        ];
    }
}
