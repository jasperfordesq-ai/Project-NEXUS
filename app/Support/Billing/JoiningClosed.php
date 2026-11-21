<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Billing;

use Illuminate\Http\JsonResponse;

/**
 * An administrator tried to add a member to a community whose door is shut by
 * "stop new members joining" (JoiningGate).
 *
 * Thrown by AdminCreatedAccountAdmission::decide(), the step every
 * admin-created account goes through. Callers that can say so catch it and
 * answer 403; anything that lets it through still answers the same 403
 * through render(), so no admin door turns it into a 500.
 *
 * A LogicException on purpose: callers that catch \RuntimeException to mean
 * "the service is unavailable" (the club member import) must not swallow it.
 */
final class JoiningClosed extends \DomainException
{
    /**
     * @param array{tenant_id:int, active:int, max:int} $closedBy
     * @param int $tenantId the community the account was for
     */
    public function __construct(public readonly array $closedBy, public readonly int $tenantId)
    {
        parent::__construct('Joining is closed: the member limit has been reached.');
    }

    public function adminMessage(): string
    {
        return JoiningGate::adminMessage($this->closedBy, $this->tenantId);
    }

    public function render(): JsonResponse
    {
        return response()->json([
            'errors' => [['code' => JoiningGate::CODE, 'message' => $this->adminMessage()]],
            'success' => false,
        ], 403, ['API-Version' => '2.0']);
    }

    /** An expected refusal, not a fault: never sent to error tracking. */
    public function report(): bool
    {
        return true;
    }
}
