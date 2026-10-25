<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support;

final readonly class SafeguardingInteractionDecision
{
    public const ALLOW = 'allow';
    public const DENY = 'deny';
    public const UNAVAILABLE = 'unavailable';

    /**
     * @param list<string> $requiredAttestationCodes
     * @param list<string> $requiredAttestationLabels
     */
    public function __construct(
        public string $status,
        public string $code,
        public int $recipientTenantId,
        public string $purposeCode,
        public string $scopeType,
        public string $scopeIdentifier,
        public ?string $policyVersion = null,
        public array $requiredAttestationCodes = [],
        public array $requiredAttestationLabels = [],
        public bool $canRequestCoordinator = false,
        /**
         * True when the SENDER's own protection stopped the interaction (they
         * chose to have a coordinator arrange contact), rather than the
         * recipient's. Same code, different explanation for the member.
         */
        public bool $restrictedBySender = false,
    ) {}

    public function isAllowed(): bool
    {
        return $this->status === self::ALLOW;
    }

    public function isDenied(): bool
    {
        return $this->status === self::DENY;
    }

    public function isUnavailable(): bool
    {
        return $this->status === self::UNAVAILABLE;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'status' => $this->status,
            'code' => $this->code,
            'recipient_tenant_id' => $this->recipientTenantId,
            'purpose_code' => $this->purposeCode,
            'scope_type' => $this->scopeType,
            'scope_identifier' => $this->scopeIdentifier,
            'policy_version' => $this->policyVersion,
            'required_attestation_codes' => $this->requiredAttestationCodes,
            'required_attestation_labels' => $this->requiredAttestationLabels,
            'can_request_coordinator' => $this->canRequestCoordinator,
            'restricted_by_sender' => $this->restrictedBySender,
        ];
    }
}
