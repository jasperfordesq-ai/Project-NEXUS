<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support;

use App\Support\SafeguardingInteractionDecision;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The value object every safeguarding contact decision is expressed in.
 *
 * SafeguardingInteractionPolicy hands one of these to callers that gate
 * member-to-member contact, and callers branch on isAllowed(). The invariant
 * worth pinning is fail-closed: only an explicit ALLOW may read as allowed, so
 * a policy that could not be evaluated (UNAVAILABLE) can never be mistaken for
 * permission. toArray() is the shape that crosses the API boundary.
 *
 * Plain PHPUnit — the object is pure, so this test cannot skip itself.
 */
final class SafeguardingInteractionDecisionTest extends TestCase
{
    private static function make(string $status, string $code = 'CODE'): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: $status,
            code: $code,
            recipientTenantId: 2,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
        );
    }

    // ------------------------------------------------------ the fail-closed core

    /**
     * Exactly one predicate may answer true for any status. If two ever do, a
     * caller's if/else chain silently takes the wrong branch.
     */
    #[DataProvider('statusProvider')]
    public function test_exactly_one_predicate_is_true_for_each_status(string $status): void
    {
        $decision = self::make($status);

        $true = array_filter([
            'allowed' => $decision->isAllowed(),
            'denied' => $decision->isDenied(),
            'unavailable' => $decision->isUnavailable(),
        ]);

        $this->assertCount(1, $true, "exactly one predicate must hold for status '{$status}'");
    }

    /**
     * The rule the whole boundary rests on: an unevaluable policy is NOT
     * permission. If this fails, an outage opens contact rather than closing it.
     */
    public function test_unavailable_is_not_allowed(): void
    {
        $decision = self::make(SafeguardingInteractionDecision::UNAVAILABLE);

        $this->assertFalse($decision->isAllowed(), 'an unavailable policy must never read as allowed');
        $this->assertTrue($decision->isUnavailable());
    }

    public function test_denied_is_not_allowed(): void
    {
        $this->assertFalse(self::make(SafeguardingInteractionDecision::DENY)->isAllowed());
    }

    public function test_allowed_only_for_the_allow_status(): void
    {
        $this->assertTrue(self::make(SafeguardingInteractionDecision::ALLOW)->isAllowed());
    }

    /**
     * An unrecognised status must fall through to "not allowed" rather than
     * matching by accident — e.g. a future status added to the policy but not
     * yet handled here.
     */
    public function test_unknown_status_is_not_allowed(): void
    {
        $decision = self::make('something_new');

        $this->assertFalse($decision->isAllowed(), 'an unrecognised status must fail closed');
        $this->assertFalse($decision->isDenied());
        $this->assertFalse($decision->isUnavailable());
    }

    /** Guards against the statuses being renamed without updating callers. */
    public function test_status_constants_are_frozen(): void
    {
        $this->assertSame('allow', SafeguardingInteractionDecision::ALLOW);
        $this->assertSame('deny', SafeguardingInteractionDecision::DENY);
        $this->assertSame('unavailable', SafeguardingInteractionDecision::UNAVAILABLE);
    }

    // ------------------------------------------------------------ wire shape

    /**
     * toArray() crosses the API boundary, so its keys are a contract. Renaming
     * one here without renaming it in the frontend breaks the contact gate
     * silently.
     */
    public function test_to_array_keys_are_frozen(): void
    {
        $this->assertSame([
            'status',
            'code',
            'recipient_tenant_id',
            'purpose_code',
            'scope_type',
            'scope_identifier',
            'policy_version',
            'required_attestation_codes',
            'required_attestation_labels',
            'can_request_coordinator',
        ], array_keys(self::make(SafeguardingInteractionDecision::ALLOW)->toArray()));
    }

    public function test_to_array_carries_every_constructor_value(): void
    {
        $decision = new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::DENY,
            code: 'VETTING_REQUIRED',
            recipientTenantId: 7,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: 'scope-1',
            policyVersion: 'v3',
            requiredAttestationCodes: ['dbs_enhanced'],
            requiredAttestationLabels: ['DBS Enhanced'],
            canRequestCoordinator: true,
        );

        $this->assertSame([
            'status' => 'deny',
            'code' => 'VETTING_REQUIRED',
            'recipient_tenant_id' => 7,
            'purpose_code' => 'safeguarded_member_contact',
            'scope_type' => 'tenant',
            'scope_identifier' => 'scope-1',
            'policy_version' => 'v3',
            'required_attestation_codes' => ['dbs_enhanced'],
            'required_attestation_labels' => ['DBS Enhanced'],
            'can_request_coordinator' => true,
        ], $decision->toArray());
    }

    /**
     * The optional tail must default to a shape the frontend can render without
     * null-guards: empty lists, no policy version, and no coordinator offer.
     */
    public function test_optional_fields_default_to_safe_empty_values(): void
    {
        $array = self::make(SafeguardingInteractionDecision::ALLOW)->toArray();

        $this->assertNull($array['policy_version']);
        $this->assertSame([], $array['required_attestation_codes']);
        $this->assertSame([], $array['required_attestation_labels']);
        $this->assertFalse(
            $array['can_request_coordinator'],
            'offering a coordinator route must be opt-in, never the default',
        );
    }

    /** @return iterable<string, array{string}> */
    public static function statusProvider(): iterable
    {
        yield 'allow' => [SafeguardingInteractionDecision::ALLOW];
        yield 'deny' => [SafeguardingInteractionDecision::DENY];
        yield 'unavailable' => [SafeguardingInteractionDecision::UNAVAILABLE];
    }
}
