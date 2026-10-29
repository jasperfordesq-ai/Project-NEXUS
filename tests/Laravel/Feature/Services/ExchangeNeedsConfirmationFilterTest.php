<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Services;

use App\Core\TenantContext;
use App\Models\ExchangeRequest;
use App\Models\Listing;
use App\Models\User;
use App\Services\ExchangeService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * "Needs confirmation" means an exchange waiting for someone to confirm the
 * hours (`pending_confirmation`), as React's tab sends. The `needs_confirmation`
 * filter, which the accessible site uses, also returned completed exchanges,
 * so a finished exchange showed under both "Needs confirmation" and "Completed"
 * (29 Oct 2026).
 */
final class ExchangeNeedsConfirmationFilterTest extends TestCase
{
    use DatabaseTransactions;

    public function test_needs_confirmation_returns_only_exchanges_awaiting_confirmation(): void
    {
        TenantContext::setById($this->testTenantId);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $listing = Listing::factory()->forTenant($this->testTenantId)->create(['user_id' => $other->id]);
        $make = fn (string $status) => ExchangeRequest::factory()->forTenant($this->testTenantId)->create([
            'listing_id' => $listing->id,
            'requester_id' => $member->id,
            'provider_id' => $other->id,
            'status' => $status,
        ])->id;
        $awaiting = $make('pending_confirmation');
        $completed = $make('completed');

        $ids = array_map(
            static fn (array $row): int => (int) $row['id'],
            (new ExchangeService())->getAll((int) $member->id, ['status' => 'needs_confirmation', 'limit' => 50])['items']
        );

        $this->assertContains($awaiting, $ids);
        $this->assertNotContains($completed, $ids, 'a completed exchange belongs under Completed only');
    }
}
