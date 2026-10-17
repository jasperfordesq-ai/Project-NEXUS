<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\PageContentPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

class PageContentPolicyTest extends TestCase
{
    use DatabaseTransactions;

    public function test_links_to_member_profiles_is_true_for_a_profile_link(): void
    {
        $this->assertTrue(PageContentPolicy::linksToMemberProfiles([
            'content' => '<p><a href="/profile/12">Jo</a></p>',
            'tenant_id' => $this->testTenantId,
        ]));
    }

    public function test_links_to_member_profiles_is_false_for_a_page_link(): void
    {
        $this->assertFalse(PageContentPolicy::linksToMemberProfiles([
            'content' => '<p><a href="/page/x">About</a></p>',
            'tenant_id' => $this->testTenantId,
        ]));
    }

    public function test_it_sees_member_links_hidden_in_the_design_json(): void
    {
        $this->assertTrue(PageContentPolicy::linksToMemberProfiles((object) [
            'content' => '',
            'design_json' => '{"href":"\/members\/7"}',
            'tenant_id' => $this->testTenantId,
        ]));
    }

    public function test_it_sees_a_members_grid_block(): void
    {
        $this->assertTrue(PageContentPolicy::linksToMemberProfiles([
            'content' => '<div class="members-grid"></div>',
            'tenant_id' => $this->testTenantId,
        ]));
    }
}
