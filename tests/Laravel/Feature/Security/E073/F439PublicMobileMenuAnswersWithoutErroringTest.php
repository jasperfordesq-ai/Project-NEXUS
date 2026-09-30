<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-073 F-439 — the public `GET /api/menus/mobile` must answer with a usable
 * menu, not a 500.
 *
 * E-073 recorded this as `suspected`: it reproduced the status but did not
 * isolate the cause, and guessed at an unguarded `$menu['items']` under a
 * `catch (\Exception)`. That guess is wrong on both counts — the catch is
 * already `\Throwable`, and `items` is always present on every menu shape
 * `MenuManager` returns.
 *
 * The real cause is `$item['id']` at `MenuController:148` (and `$child['id']`
 * / `$child['type']` in `simplifyChildren`). `config/menu-manager.php` ships
 * with `'enabled' => false`, so `MenuManager::getMenu()` takes its very first
 * branch into `getOriginalNavigation()`; the configured
 * `original_nav_config` class `App\Config\Navigation` does not exist in this
 * repository, so that falls through to `getDefaultMenu('mobile')` →
 * `getDefaultMobileMenu()`. Those built-in items are hand-written arrays with
 * `type`, `label`, `url`, `icon`, `sort_order` and `is_active` — and no `id`
 * at all, because they are not database rows. Reading the missing key raises
 * an "Undefined array key" warning, Laravel promotes that to `ErrorException`,
 * and the controller's own `catch (\Throwable)` turns it into
 * `MOBILE_MENU_LOAD_FAILED` 500. So the endpoint has been failing on the
 * default configuration for every caller, signed in or not.
 *
 * These tests assert the CORRECT behaviour and therefore fail before the fix.
 * The harm case is the anonymous caller, who is the one E-073 observed. The
 * legitimate-access control is in the same file: a signed-in member must still
 * receive a menu that is actually usable — items with a label and a URL — so a
 * fix that answered 200 with nothing in it would fail too.
 */
final class F439PublicMobileMenuAnswersWithoutErroringTest extends TestCase
{
    use DatabaseTransactions;

    // ------------------------------------------------------------------
    // Harm — the anonymous caller must not receive a 500
    // ------------------------------------------------------------------

    public function test_an_anonymous_caller_receives_a_menu_not_a_server_error(): void
    {
        $response = $this->apiGet('/menus/mobile');

        $this->assertNotSame(
            500,
            $response->getStatusCode(),
            'The public mobile menu must not answer 500: ' . $response->getContent()
        );
        $response->assertOk();
        $this->assertIsArray($response->json('data'));
    }

    public function test_the_anonymous_response_is_not_the_load_failed_envelope(): void
    {
        $response = $this->apiGet('/menus/mobile');

        $this->assertNotSame('MOBILE_MENU_LOAD_FAILED', $response->json('error.code'));
        $this->assertNotSame('MOBILE_MENU_LOAD_FAILED', $response->json('code'));
    }

    public function test_every_item_returned_anonymously_is_renderable(): void
    {
        $response = $this->apiGet('/menus/mobile');
        $response->assertOk();

        $items = $response->json('data');
        $this->assertIsArray($items);

        foreach ($items as $item) {
            $this->assertArrayHasKey('id', $item);
            $this->assertArrayHasKey('label', $item);
            $this->assertArrayHasKey('url', $item);
            $this->assertArrayHasKey('type', $item);
            $this->assertArrayHasKey('children', $item);
            $this->assertIsArray($item['children']);
        }
    }

    // ------------------------------------------------------------------
    // Control — a signed-in member still gets a usable menu
    // ------------------------------------------------------------------

    public function test_control_a_signed_in_member_still_receives_a_usable_menu(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status'      => 'active',
            'is_approved' => true,
            'role'        => 'member',
        ]);
        Sanctum::actingAs($member, ['*']);

        $response = $this->apiGet('/menus/mobile');
        $response->assertOk();

        $items = $response->json('data');
        $this->assertIsArray($items);
        $this->assertNotEmpty($items, 'A signed-in member must still be given navigation.');

        foreach ($items as $item) {
            $this->assertNotSame('', trim((string) ($item['label'] ?? '')), 'Every menu item needs a label.');
            $this->assertNotSame('', trim((string) ($item['url'] ?? '')), 'Every menu item needs a destination.');
        }
    }

    public function test_control_a_request_without_a_community_is_still_refused(): void
    {
        // No X-Tenant-ID / X-Tenant-Slug header at all. Whichever community
        // the request resolves to, the answer must be a clean one — this
        // asserts the fix did not simply move the crash somewhere else.
        $response = $this->getJson('/api/menus/mobile', ['Accept' => 'application/json']);

        $this->assertNotSame(
            500,
            $response->getStatusCode(),
            'A community-less request must be refused cleanly, never with a 500.'
        );
    }
}
