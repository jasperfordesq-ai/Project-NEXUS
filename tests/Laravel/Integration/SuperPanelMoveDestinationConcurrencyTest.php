<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\SuperPanelAccess;
use App\Models\User;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

final class SuperPanelMoveDestinationConcurrencyTest extends TestCase
{
    #[DataProvider('moveRaceCases')]
    public function test_user_move_rechecks_destination_state_after_preflight(string $operation): void
    {
        $hubId = $this->makeTenant('F144 Hub', null, true);
        $sourceId = $this->makeTenant('F144 Source', $hubId, false);
        $destinationStartsAsHub = $operation === 'move_and_promote';
        $destinationId = $this->makeTenant('F144 Destination', $hubId, $destinationStartsAsHub);
        $admin = User::factory()->forTenant($hubId)->admin()->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        DB::table('users')->where('id', $admin->id)->update([
            'is_tenant_super_admin' => 1,
            'is_super_admin' => 0,
            'is_god' => 0,
        ]);
        $admin->refresh();
        $member = User::factory()->forTenant($sourceId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);

        $raceConnection = 'f144_destination_racer';
        config(["database.connections.{$raceConnection}" => config('database.connections.mysql')]);
        $raced = false;

        try {
            $this->withTenant($hubId);
            Sanctum::actingAs($admin);
            SuperPanelAccess::reset();

            DB::listen(function (QueryExecuted $event) use (
                &$raced,
                $destinationId,
                $raceConnection,
                $operation
            ): void {
                if ($raced || $event->connectionName !== DB::getDefaultConnection()) {
                    return;
                }
                $sql = strtolower($event->sql);
                if (
                    str_contains($sql, 'from `tenants`')
                    && !str_contains($sql, 'for update')
                    && in_array($destinationId, array_map('intval', $event->bindings), true)
                ) {
                    $raced = true;
                    DB::connection($raceConnection)
                        ->table('tenants')
                        ->where('id', $destinationId)
                        ->update($operation === 'move_and_promote'
                            ? ['allows_subtenants' => 0]
                            : ['is_active' => 0]);
                }
            });

            $response = match ($operation) {
                'move' => $this->apiPost("/v2/admin/super/users/{$member->id}/move-tenant", [
                    'new_tenant_id' => $destinationId,
                ])->assertStatus(422),
                'move_and_promote' => $this->apiPost("/v2/admin/super/users/{$member->id}/move-and-promote", [
                    'target_tenant_id' => $destinationId,
                ])->assertStatus(422),
                'bulk' => $this->apiPost('/v2/admin/super/bulk/move-users', [
                    'user_ids' => [$member->id],
                    'target_tenant_id' => $destinationId,
                ])->assertStatus(200),
            };

            if ($operation === 'bulk') {
                self::assertSame(0, (int) $response->json('data.moved_count'));
                self::assertContains(
                    'TARGET_TENANT_INACTIVE',
                    array_column($response->json('data.errors'), 'code')
                );
            }

            self::assertTrue($raced, 'The destination must change after the controller preflight read.');
            self::assertSame(
                $sourceId,
                (int) DB::table('users')->where('id', $member->id)->value('tenant_id')
            );
        } finally {
            DB::connection($raceConnection)
                ->table('tenants')
                ->where('id', $destinationId)
                ->update([
                    'is_active' => 1,
                    'allows_subtenants' => $destinationStartsAsHub ? 1 : 0,
                ]);
            DB::purge($raceConnection);
            SuperPanelAccess::reset();
            DB::table('super_admin_audit_log')->where('target_id', $member->id)->delete();
            DB::table('users')->whereIn('id', [$member->id, $admin->id])->delete();
            DB::table('tenants')->whereIn('id', [$sourceId, $destinationId])->delete();
            DB::table('tenants')->where('id', $hubId)->delete();
        }
    }

    public static function moveRaceCases(): array
    {
        return [
            'single move becomes inactive' => ['move'],
            'move and promote loses hub capability' => ['move_and_promote'],
            'bulk move becomes inactive' => ['bulk'],
        ];
    }

    private function makeTenant(string $name, ?int $parentId, bool $hub): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name . ' ' . uniqid('', false),
            'slug' => strtolower(str_replace(' ', '-', $name)) . '-' . uniqid('', false),
            'parent_id' => $parentId,
            'is_active' => 1,
            'allows_subtenants' => $hub ? 1 : 0,
            'depth' => $parentId === null ? 0 : 1,
            'path' => '/pending/',
            'max_depth' => 3,
        ]);
        $parentPath = $parentId === null
            ? '/'
            : (string) DB::table('tenants')->where('id', $parentId)->value('path');
        DB::table('tenants')->where('id', $id)->update(['path' => $parentPath . $id . '/']);

        return $id;
    }
}
