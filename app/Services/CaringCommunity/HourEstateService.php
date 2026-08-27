<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use RuntimeException;
use App\Support\UserDisplayName;

class HourEstateService
{
    private const TABLE = 'caring_hour_estates';
    private const ACTIONS = ['transfer_to_beneficiary', 'donate_to_solidarity', 'expire'];

    public function isAvailable(): bool
    {
        return Schema::hasTable(self::TABLE);
    }

    public function myEstate(int $tenantId, int $memberId): array
    {
        $this->assertAvailable();

        $row = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('member_user_id', $memberId)
            ->first();

        if (!$row) {
            return [
                'tenant_id' => $tenantId,
                'member_user_id' => $memberId,
                'status' => 'not_set',
                'policy_action' => null,
                'beneficiary_user_id' => null,
            ];
        }

        return $this->formatEstate($row);
    }

    public function nominate(int $tenantId, int $memberId, array $input): array
    {
        $this->assertAvailable();

        $action = (string) ($input['policy_action'] ?? 'donate_to_solidarity');
        if (!in_array($action, self::ACTIONS, true)) {
            throw new InvalidArgumentException(__('api.caring_hour_estate_policy_invalid'));
        }

        $beneficiaryId = isset($input['beneficiary_user_id']) && $input['beneficiary_user_id'] !== ''
            ? (int) $input['beneficiary_user_id']
            : null;

        if ($action === 'transfer_to_beneficiary') {
            if ($beneficiaryId === null || $beneficiaryId <= 0) {
                throw new InvalidArgumentException(__('api.caring_hour_estate_beneficiary_required'));
            }
            if ($beneficiaryId === $memberId) {
                throw new InvalidArgumentException(__('api.caring_hour_estate_self_beneficiary'));
            }
            $exists = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('id', $beneficiaryId)
                ->exists();
            if (!$exists) {
                throw new InvalidArgumentException(__('api.user_not_found'));
            }
        } else {
            $beneficiaryId = null;
        }

        $now = now();
        DB::table(self::TABLE)->updateOrInsert(
            ['tenant_id' => $tenantId, 'member_user_id' => $memberId],
            [
                'beneficiary_user_id' => $beneficiaryId,
                'policy_action' => $action,
                'status' => 'nominated',
                'policy_document_reference' => isset($input['policy_document_reference'])
                    ? mb_substr((string) $input['policy_document_reference'], 0, 255)
                    : null,
                'member_notes' => isset($input['member_notes']) ? mb_substr((string) $input['member_notes'], 0, 2000) : null,
                'nominated_at' => $now,
                'updated_at' => $now,
                'created_at' => $now,
            ]
        );

        return $this->myEstate($tenantId, $memberId);
    }

    public function listEstates(int $tenantId, ?string $status = null): array
    {
        $this->assertAvailable();

        $query = DB::table(self::TABLE . ' as e')
            ->leftJoin('users as m', function ($join) {
                $join->on('m.id', '=', 'e.member_user_id')
                    ->on('m.tenant_id', '=', 'e.tenant_id');
            })
            ->leftJoin('users as b', function ($join) {
                $join->on('b.id', '=', 'e.beneficiary_user_id')
                    ->on('b.tenant_id', '=', 'e.tenant_id');
            })
            ->where('e.tenant_id', $tenantId)
            ->orderByDesc('e.updated_at');

        if ($status !== null && in_array($status, ['nominated', 'reported', 'settled', 'cancelled'], true)) {
            $query->where('e.status', $status);
        }

        return $query->get([
            'e.*',
            'm.name as member_name',
            'm.first_name as member_first_name',
            'm.last_name as member_last_name',
            'm.profile_type as member_profile_type',
            'm.organization_name as member_organization_name',
            'b.name as beneficiary_name',
            'b.first_name as beneficiary_first_name',
            'b.last_name as beneficiary_last_name',
            'b.profile_type as beneficiary_profile_type',
            'b.organization_name as beneficiary_organization_name',
        ])->map(fn ($row) => $this->formatEstate($row))->all();
    }

    public function reportDeceased(int $tenantId, int $estateId, int $actorId, ?string $notes): array
    {
        $this->assertAvailable();

        return DB::transaction(function () use ($tenantId, $estateId, $actorId, $notes): array {
            $estate = DB::table(self::TABLE)
                ->where('tenant_id', $tenantId)
                ->where('id', $estateId)
                ->lockForUpdate()
                ->first();
            if (!$estate) {
                throw new RuntimeException(__('api.caring_hour_estate_not_found'));
            }
            if (!in_array((string) $estate->status, ['nominated', 'reported'], true)) {
                throw new RuntimeException(__('api.caring_hour_estate_not_reportable'));
            }

            $balance = (float) (DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $estate->member_user_id)
                ->value('balance') ?? 0);

            DB::table(self::TABLE)
                ->where('id', $estateId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'status' => 'reported',
                    'reported_balance_hours' => round($balance, 2),
                    'reported_deceased_at' => now(),
                    'reported_by' => $actorId,
                    'coordinator_notes' => $notes,
                    'updated_at' => now(),
                ]);

            return $this->formatEstate(DB::table(self::TABLE)->where('id', $estateId)->first());
        });
    }

    public function settle(int $tenantId, int $estateId, int $actorId, ?string $notes): array
    {
        $this->assertAvailable();

        return DB::transaction(function () use ($tenantId, $estateId, $actorId, $notes): array {
            $estate = DB::table(self::TABLE)
                ->where('tenant_id', $tenantId)
                ->where('id', $estateId)
                ->lockForUpdate()
                ->first();
            if (!$estate) {
                throw new RuntimeException(__('api.caring_hour_estate_not_found'));
            }
            if ((string) $estate->status !== 'reported') {
                throw new RuntimeException(__('api.caring_hour_estate_not_settleable'));
            }

            $member = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $estate->member_user_id)
                ->lockForUpdate()
                ->first(['id', 'balance']);
            if (!$member) {
                throw new RuntimeException(__('api.user_not_found'));
            }

            $hours = max(0.0, round((float) $member->balance, 2));
            if ($hours > 0) {
                DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $member->id)
                    ->decrement('balance', $hours);

                if ((string) $estate->policy_action === 'transfer_to_beneficiary') {
                    $beneficiaryId = (int) ($estate->beneficiary_user_id ?? 0);
                    if ($beneficiaryId <= 0) {
                        throw new RuntimeException(__('api.caring_hour_estate_beneficiary_required'));
                    }

                    DB::table('users')
                        ->where('tenant_id', $tenantId)
                        ->where('id', $beneficiaryId)
                        ->lockForUpdate()
                        ->increment('balance', $hours);
                }
            }

            DB::table(self::TABLE)
                ->where('tenant_id', $tenantId)
                ->where('id', $estateId)
                ->update([
                    'status' => 'settled',
                    'settled_hours' => $hours,
                    'settled_at' => now(),
                    'settled_by' => $actorId,
                    'coordinator_notes' => $notes ?? $estate->coordinator_notes,
                    'updated_at' => now(),
                ]);

            return $this->formatEstate(DB::table(self::TABLE)->where('id', $estateId)->first());
        });
    }

    private function assertAvailable(): void
    {
        if (!$this->isAvailable()) {
            throw new RuntimeException(__('api.caring_hour_estates_unavailable'));
        }
    }

    private function formatEstate(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'tenant_id' => (int) $row->tenant_id,
            'member_user_id' => (int) $row->member_user_id,
            'member_name' => $this->displayName($row, 'member'),
            'beneficiary_user_id' => $row->beneficiary_user_id ? (int) $row->beneficiary_user_id : null,
            'beneficiary_name' => $this->displayName($row, 'beneficiary'),
            'policy_action' => (string) $row->policy_action,
            'status' => (string) $row->status,
            'reported_balance_hours' => $row->reported_balance_hours !== null ? (float) $row->reported_balance_hours : null,
            'settled_hours' => $row->settled_hours !== null ? (float) $row->settled_hours : null,
            'policy_document_reference' => $row->policy_document_reference,
            'member_notes' => $row->member_notes,
            'coordinator_notes' => $row->coordinator_notes,
            'nominated_at' => $row->nominated_at,
            'reported_deceased_at' => $row->reported_deceased_at,
            'settled_at' => $row->settled_at,
        ];
    }

    private function displayName(object $row, string $prefix): ?string
    {
        $name = UserDisplayName::resolvePrefixed($row, $prefix . '_');
        if ($name !== '') {
            return $name;
        }

        $fallback = (string) ($row->{$prefix . '_name'} ?? '');
        return $fallback !== '' ? $fallback : null;
    }
}
