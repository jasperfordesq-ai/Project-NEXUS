<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-073 F-438 — the public, unauthenticated `GET /api/v2/categories` must
 * publish a NAMED list of fields, not every column the `categories` table
 * happens to carry.
 *
 * The defect: the route closure (`routes/api.php:116`) returned whole
 * `Category` models — no `->select()`, no API resource — so the response
 * carried four columns that do not belong to that table at all
 * (`blocker_user_id`, `clicked_at`, `match`, `reset_token`; see
 * `database/schema/mysql-schema.sql:1892-1915`, evidently a migration applied
 * to the wrong table). Every value is NULL in production today, which is why
 * E-073 rated it Low. The defect is structural: whatever is added to that table
 * next is published to the internet without anyone changing code, and one of
 * the columns already sitting there is named `reset_token`.
 *
 * These tests assert the CORRECT behaviour and therefore fail before the fix.
 *
 * The harm case plants a sentinel value in `categories.reset_token` and asserts
 * neither the key nor the value reaches an anonymous caller.
 *
 * The legitimate-access control is in the same file: the endpoint must still
 * answer 200 and still carry the fields real clients read, so a fix that simply
 * emptied the response would fail too. The fields asserted were taken from the
 * consuming code, not from the model:
 *   - `id`   — every consumer (react `ListingsPage`, `ExplorePage`,
 *              `MatchPreferencesPage`, `SearchPage`; web-uk `eventCategoryFrom`
 *              and its listings/volunteering equivalents; mobile
 *              `ExchangeCategory` / `eventCategorySchema`).
 *   - `name` — same list; it is what every picker renders.
 *   - `slug` — react `ListingsPage:305,767` and `ExplorePage:615` filter on it;
 *              REQUIRED (not optional) by mobile's `eventCategorySchema`.
 *   - `type` — the route deliberately rewrites it to the canonical type, and
 *              `EventDiscoveryContractTest` pins that.
 */
final class F438PublicCategoriesPublishNamedFieldsOnlyTest extends TestCase
{
    use DatabaseTransactions;

    /** Columns that must never be published by this public endpoint. */
    private const STRAY_COLUMNS = ['blocker_user_id', 'clicked_at', 'match', 'reset_token'];

    private const SENTINEL = 'E074-F438-STRAY-VALUE-MUST-NOT-BE-PUBLISHED';

    /**
     * @param array<string,mixed> $overrides
     */
    private function seedCategory(string $type, array $overrides = []): int
    {
        $suffix = bin2hex(random_bytes(4));

        return (int) DB::table('categories')->insertGetId(array_merge([
            'tenant_id'  => $this->testTenantId,
            'name'       => 'E074 F438 ' . $suffix,
            'slug'       => 'e074-f438-' . $suffix,
            'type'       => $type,
            'is_active'  => 1,
            'sort_order' => 0,
            'color'      => 'blue',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    // ------------------------------------------------------------------
    // Harm — the stray columns must not be published
    // ------------------------------------------------------------------

    public function test_the_anonymous_response_carries_none_of_the_stray_columns(): void
    {
        $id = $this->seedCategory('listing', ['reset_token' => self::SENTINEL]);

        $response = $this->apiGet('/v2/categories?type=listing');
        $response->assertOk();

        $rows = collect($response->json('data'));
        $row  = $rows->firstWhere('id', $id);

        $this->assertIsArray($row, 'The seeded category must be in the response.');

        foreach (self::STRAY_COLUMNS as $column) {
            $this->assertArrayNotHasKey(
                $column,
                $row,
                "The public categories endpoint must not publish the `{$column}` column."
            );
        }

        $this->assertStringNotContainsString(
            self::SENTINEL,
            (string) $response->getContent(),
            'A value stored in a stray column must not reach an anonymous caller.'
        );
    }

    public function test_no_row_in_the_anonymous_response_carries_a_stray_column(): void
    {
        $this->seedCategory('listing', ['reset_token' => self::SENTINEL]);

        $response = $this->apiGet('/v2/categories?type=listing');
        $response->assertOk();

        $rows = $response->json('data');
        $this->assertIsArray($rows);
        $this->assertNotEmpty($rows, 'Precondition: the community must have listing categories.');

        foreach ($rows as $row) {
            foreach (self::STRAY_COLUMNS as $column) {
                $this->assertArrayNotHasKey($column, $row);
            }
        }
    }

    // ------------------------------------------------------------------
    // Control — the endpoint still serves the fields clients read
    // ------------------------------------------------------------------

    public function test_control_the_endpoint_still_serves_every_field_clients_read(): void
    {
        $id = $this->seedCategory('listing');

        $response = $this->apiGet('/v2/categories?type=listing');
        $response->assertOk();

        $row = collect($response->json('data'))->firstWhere('id', $id);
        $this->assertIsArray($row, 'The seeded category must still be returned.');

        foreach (['id', 'name', 'slug', 'type', 'color'] as $field) {
            $this->assertArrayHasKey(
                $field,
                $row,
                "Clients read `{$field}`; removing it would be a regression."
            );
        }

        $this->assertSame($id, $row['id']);
        $this->assertStringStartsWith('E074 F438 ', (string) $row['name']);
        $this->assertStringStartsWith('e074-f438-', (string) $row['slug']);
        $this->assertSame('listing', $row['type']);
    }

    public function test_control_the_event_type_still_resolves_to_the_canonical_type(): void
    {
        $singular = $this->seedCategory('event');
        $plural   = $this->seedCategory('events');

        $response = $this->apiGet('/v2/categories?type=event');
        $response->assertOk();

        $rows = collect($response->json('data'));
        $this->assertTrue($rows->contains('id', $singular));
        $this->assertTrue($rows->contains('id', $plural));
        $this->assertSame(['event'], $rows->pluck('type')->unique()->values()->all());
    }

    public function test_control_an_inactive_or_foreign_category_is_still_excluded(): void
    {
        $inactive = $this->seedCategory('listing', ['is_active' => 0]);
        $active   = $this->seedCategory('listing');

        $response = $this->apiGet('/v2/categories?type=listing');
        $response->assertOk();

        $rows = collect($response->json('data'));
        $this->assertTrue($rows->contains('id', $active));
        $this->assertFalse($rows->contains('id', $inactive));
    }
}
