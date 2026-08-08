<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Social\Collections;

use App\Models\User;
use App\Services\Social\SavedCollectionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * SOC10 — Only public collections are returned via getUserCollections($u, true).
 */
class PublicCollectionVisibilityTest extends TestCase
{
    use DatabaseTransactions;

    public function test_public_only_filter_excludes_private(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $svc = new SavedCollectionService();
        $svc->createCollection($user->id, 'Private', null, false);
        $svc->createCollection($user->id, 'Public', null, true);

        $publicOnly = $svc->getUserCollections($user->id, true);
        $all = $svc->getUserCollections($user->id, false);

        $this->assertCount(1, $publicOnly);
        $this->assertSame('Public', $publicOnly[0]->name);
        $this->assertCount(2, $all);
    }
}
