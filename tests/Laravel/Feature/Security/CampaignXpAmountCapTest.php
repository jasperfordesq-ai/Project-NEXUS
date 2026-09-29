<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-311 — an achievement campaign's `xp_amount` was stored as any integer, so a
 * recurring "all members" campaign could mint arbitrary XP every day. The
 * challenge path in the same controller already caps `xp_reward` at 0–1000;
 * campaigns now use the same bound.
 */
final class CampaignXpAmountCapTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
    }

    /** @return array<string, array{int}> */
    public static function outOfRange(): array
    {
        return [
            'far above the cap' => [1000000],
            'just above the cap' => [1001],
            'negative' => [-5],
        ];
    }

    /**
     * @dataProvider outOfRange
     */
    public function test_create_refuses_an_out_of_range_xp_amount(int $xp): void
    {
        $response = $this->apiPost('/v2/admin/gamification/campaigns', [
            'name' => 'F-311 create ' . $xp,
            'type' => 'recurring',
            'xp_amount' => $xp,
            'schedule' => 'daily',
        ]);

        $this->assertSame(422, $response->status(), $response->getContent());
        $this->assertSame(0, DB::table('achievement_campaigns')->where('name', 'F-311 create ' . $xp)->count());
    }

    /**
     * @dataProvider outOfRange
     */
    public function test_update_refuses_an_out_of_range_xp_amount(int $xp): void
    {
        $created = $this->apiPost('/v2/admin/gamification/campaigns', [
            'name' => 'F-311 update',
            'type' => 'recurring',
            'xp_amount' => 50,
            'schedule' => 'daily',
        ]);
        $this->assertSame(201, $created->status(), $created->getContent());
        $id = (int) $created->json('data.id');

        $response = $this->apiPut("/v2/admin/gamification/campaigns/{$id}", ['xp_amount' => $xp]);

        $this->assertSame(422, $response->status(), $response->getContent());
        $this->assertSame(50, (int) DB::table('achievement_campaigns')->where('id', $id)->value('xp_amount'));
    }

    /** @return array<string, array{int}> */
    public static function inRange(): array
    {
        return ['zero' => [0], 'typical' => [50], 'the cap itself' => [1000]];
    }

    /**
     * Legitimate-access control: an in-range amount is stored as given.
     *
     * @dataProvider inRange
     */
    public function test_control_an_in_range_xp_amount_is_stored(int $xp): void
    {
        $created = $this->apiPost('/v2/admin/gamification/campaigns', [
            'name' => 'F-311 control ' . $xp,
            'type' => 'recurring',
            'xp_amount' => $xp,
            'schedule' => 'daily',
        ]);

        $this->assertSame(201, $created->status(), $created->getContent());
        $this->assertSame($xp, (int) DB::table('achievement_campaigns')->where('id', (int) $created->json('data.id'))->value('xp_amount'));

        $updated = $this->apiPut('/v2/admin/gamification/campaigns/' . (int) $created->json('data.id'), ['xp_amount' => 1000]);
        $this->assertSame(200, $updated->status(), $updated->getContent());
    }

    /**
     * The admin list's pause/resume button sends only `status`. That used to
     * answer 500 (json_decode() of the already-cast audience_config) after the
     * status had in fact changed.
     */
    public function test_control_a_status_only_update_succeeds(): void
    {
        $created = $this->apiPost('/v2/admin/gamification/campaigns', [
            'name' => 'F-311 status only',
            'type' => 'recurring',
            'xp_amount' => 10,
            'schedule' => 'weekly',
        ]);
        $id = (int) $created->json('data.id');

        $response = $this->apiPut("/v2/admin/gamification/campaigns/{$id}", ['status' => 'paused']);

        $this->assertSame(200, $response->status(), $response->getContent());
        $this->assertSame(10, (int) DB::table('achievement_campaigns')->where('id', $id)->value('xp_amount'));
    }
}
