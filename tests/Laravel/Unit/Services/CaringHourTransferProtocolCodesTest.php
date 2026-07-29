<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\CaringCommunity\CaringHourTransferService;
use PHPUnit\Framework\TestCase;

/**
 * Pins the wire vocabulary of the inbound hour-transfer federation endpoint.
 *
 * These five values are the `error` field of the JSON response that
 * `FederationHourTransferController::inbound()` returns to the *peer install*
 * that POSTed a transfer. A remote NEXUS deployment we do not control branches
 * on them, and our own controller maps `signature_invalid` to HTTP 401 while
 * everything else becomes 422 — so the value is load-bearing twice over.
 *
 * They were inline string literals until 2026-07-29, when the surrounding
 * service had its 22 prose exception messages moved into lang/en/api.php. That
 * sweep looks for hardcoded English, and these read exactly like hardcoded
 * English to a regex; naming them keeps the sweep's rule honest without an
 * exemption list, and this test makes the rename non-negotiable in the other
 * direction: the constants may be renamed, but their VALUES are a published
 * protocol and a "tidy-up" that changes one silently breaks a peer.
 *
 * If a value here genuinely has to change, that is a protocol version bump and
 * needs the peer's side updated first.
 */
class CaringHourTransferProtocolCodesTest extends TestCase
{
    public function test_inbound_rejection_codes_keep_their_published_values(): void
    {
        self::assertSame('peer_no_secret', CaringHourTransferService::REJECT_PEER_NO_SECRET);
        self::assertSame('signature_invalid', CaringHourTransferService::REJECT_SIGNATURE_INVALID);
        self::assertSame('payload_invalid', CaringHourTransferService::REJECT_PAYLOAD_INVALID);
        self::assertSame('amount_exceeds_limit', CaringHourTransferService::REJECT_AMOUNT_EXCEEDS_LIMIT);
        self::assertSame('destination_member_not_found', CaringHourTransferService::REJECT_DESTINATION_MEMBER_NOT_FOUND);
    }

    /**
     * The 401/422 split is the one place a rejection code changes the response
     * status rather than just its body, and the controller compares against the
     * constant. A test that only checked the constant's value would still pass
     * if the controller were edited back to a literal that no longer matches.
     */
    public function test_the_inbound_controller_selects_its_status_from_the_constant(): void
    {
        $controller = file_get_contents(
            dirname(__DIR__, 4) . '/app/Http/Controllers/Api/FederationHourTransferController.php'
        );

        self::assertStringContainsString(
            'CaringHourTransferService::REJECT_SIGNATURE_INVALID ? 401 : 422',
            (string) $controller,
            'The inbound endpoint must decide 401 vs 422 by comparing against the constant. A '
            . 'literal there can drift from the value the service actually returns, and the '
            . 'failure mode is silent: an invalid signature would be reported as 422.'
        );
    }
}
