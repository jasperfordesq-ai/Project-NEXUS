<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Goal;
use Illuminate\Support\Facades\DB;

final class GoalCreationReceiptService
{
    /** @return array{key_hash:string,request_hash:string}|null|false */
    public static function identity(?string $key, array $intent): array|null|false
    {
        $key = trim((string) $key);
        if ($key === '') return null;
        if (strlen($key) < 8 || strlen($key) > 191) return false;
        return [
            'key_hash' => hash('sha256', $key),
            'request_hash' => hash('sha256', json_encode(
                self::canonicalize($intent),
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
            )),
        ];
    }

    /** @return array{goal:Goal|null,replayed:bool} */
    public static function create(
        int $userId,
        string $type,
        ?int $templateId,
        array $identity,
        callable $create,
    ): array {
        return DB::transaction(function () use ($userId, $type, $templateId, $identity, $create): array {
            $tenantId = TenantContext::getId();
            DB::table('users')->where('tenant_id', $tenantId)->where('id', $userId)->lockForUpdate()->exists();
            $receipt = DB::table('goal_creation_receipts')
                ->where('tenant_id', $tenantId)->where('actor_user_id', $userId)
                ->where('operation_type', $type)->where('idempotency_key_hash', $identity['key_hash'])->first();
            if ($receipt) {
                if (!hash_equals((string) $receipt->request_hash, $identity['request_hash'])
                    || (int) ($receipt->template_id ?? 0) !== (int) ($templateId ?? 0)) {
                    throw new \InvalidArgumentException('Idempotency key was reused for different goal content');
                }
                $goal = Goal::find((int) $receipt->goal_id);
                if (!$goal) throw new \DomainException('Goal creation result is no longer available');
                return ['goal' => $goal, 'replayed' => true];
            }

            $goal = $create();
            if ($goal === null) return ['goal' => null, 'replayed' => false];
            if (!$goal instanceof Goal) throw new \LogicException('Goal creation did not return a goal');
            DB::table('goal_creation_receipts')->insert([
                'tenant_id' => $tenantId, 'actor_user_id' => $userId, 'operation_type' => $type,
                'template_id' => $templateId, 'idempotency_key_hash' => $identity['key_hash'],
                'request_hash' => $identity['request_hash'], 'goal_id' => $goal->id, 'created_at' => now(),
            ]);
            return ['goal' => $goal, 'replayed' => false];
        });
    }

    private static function canonicalize(array $value): array
    {
        foreach ($value as $key => $item) if (is_array($item)) $value[$key] = self::canonicalize($item);
        if (!array_is_list($value)) ksort($value);
        return $value;
    }
}
