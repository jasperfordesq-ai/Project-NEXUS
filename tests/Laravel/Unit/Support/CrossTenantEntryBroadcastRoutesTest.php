<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support;

use App\Support\Authorization\CrossTenantEntry;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** E-106: exactly the organiser-message routes are admitted below, nothing longer or looser. */
final class CrossTenantEntryBroadcastRoutesTest extends TestCase
{
    /** @return array<string, array{string,string,bool}> */
    public static function routes(): array
    {
        return [
            'open a message' => ['GET', 'api/v2/event-broadcasts/{broadcastId}', true],
            'open by digits' => ['GET', '/api/v2/event-broadcasts/42', true],
            'edit a draft' => ['POST', 'api/v2/event-broadcasts/{broadcastId}/revisions', true],
            'send' => ['POST', 'api/v2/event-broadcasts/{broadcastId}/schedule', true],
            'cancel' => ['POST', 'api/v2/event-broadcasts/{broadcastId}/cancel', true],
            'retry' => ['POST', 'api/v2/event-broadcasts/{broadcastId}/retry', true],
            'no id' => ['GET', 'api/v2/event-broadcasts/', false],
            'not an id' => ['GET', 'api/v2/event-broadcasts/latest', false],
            'longer path' => ['POST', 'api/v2/event-broadcasts/42/schedule/extra', false],
            'unknown action' => ['POST', 'api/v2/event-broadcasts/42/delete', false],
            'wrong method' => ['DELETE', 'api/v2/event-broadcasts/42', false],
            'action by GET' => ['GET', 'api/v2/event-broadcasts/42/schedule', false],
            'dot segment' => ['GET', 'api/v2/event-broadcasts/42/../../admin/users', false],
        ];
    }

    #[DataProvider('routes')]
    public function test_broadcast_routes(string $method, string $path, bool $admitted): void
    {
        self::assertSame($admitted, CrossTenantEntry::isEventOrganiserRequest($method, $path));
    }
}
