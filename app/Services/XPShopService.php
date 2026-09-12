<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\XpShopItem;
use App\Models\UserXpPurchase;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * XPShopService — Eloquent/DB query builder service for the XP shop.
 *
 * Manages shop items, purchases, and user perks. All queries are tenant-scoped
 * via HasTenantScope trait on models or explicit where clauses.
 */
class XPShopService
{
    /**
     * Get all available shop items for the current tenant.
     */
    public static function getItems(int $tenantId): array
    {
        return DB::table('xp_shop_items')
            ->where('tenant_id', $tenantId)
            ->where('is_active', 1)
            ->orderBy('display_order')
            ->orderBy('xp_cost')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Purchase an item (with explicit tenant_id parameter).
     */
    public static function purchase(int $tenantId, int $userId, int $itemId): bool
    {
        $result = self::purchaseItem($userId, $itemId);
        return $result['success'] ?? false;
    }

    /**
     * Get user's purchases.
     */
    public static function getUserPurchases(int $tenantId, int $userId): array
    {
        return DB::table('user_xp_purchases as uxp')
            ->join('xp_shop_items as xsi', 'uxp.item_id', '=', 'xsi.id')
            ->where('uxp.tenant_id', $tenantId)
            ->where('uxp.user_id', $userId)
            ->select(['xsi.*', 'uxp.purchased_at', 'uxp.expires_at', 'uxp.xp_spent'])
            ->orderByDesc('uxp.purchased_at')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Get user's XP balance.
     */
    public static function getBalance(int $tenantId, int $userId): int
    {
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['xp']);

        return (int) ($user->xp ?? 0);
    }

    /**
     * Get items with user purchase status.
     */
    public static function getItemsWithUserStatus(int $userId): array
    {
        $tenantId = TenantContext::getId();

        $items = XpShopItem::where('is_active', 1)
            ->orderBy('display_order')
            ->orderBy('xp_cost')
            ->get()
            ->map(fn ($r) => $r->toArray())
            ->all();

        // Get user's purchases grouped by item
        $purchases = DB::table('user_xp_purchases')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->selectRaw('item_id, COUNT(*) as purchase_count')
            ->groupBy('item_id')
            ->pluck('purchase_count', 'item_id')
            ->all();

        // Get user's current XP
        $userXP = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->value('xp');
        $userXP = (int) ($userXP ?? 0);

        foreach ($items as &$item) {
            $item['user_purchases'] = $purchases[$item['id']] ?? 0;
            $item['can_purchase'] = self::canPurchaseItem($userId, $item, $userXP);
            $item['reason'] = self::getPurchaseBlockReason($userId, $item, $userXP);
            $item['cost_xp'] = $item['xp_cost'] ?? 0;
        }

        return [
            'items' => $items,
            'user_xp' => $userXP,
        ];
    }

    /**
     * Purchase an item for a user (uses TenantContext for tenant scoping).
     */
    public static function purchaseItem(int $userId, $itemId, ?string $idempotencyKey = null): array
    {
        $tenantId = TenantContext::getId();
        $itemId = (int) $itemId;
        $idempotencyKey = trim((string) $idempotencyKey);
        if ($idempotencyKey !== '' && (strlen($idempotencyKey) < 8 || strlen($idempotencyKey) > 191)) {
            return ['success' => false, 'error' => __('api.validation_failed')];
        }
        $keyHash = $idempotencyKey !== '' ? hash('sha256', $idempotencyKey) : null;

        if ($keyHash !== null) {
            $replay = self::findPurchaseReplay($tenantId, $userId, $keyHash, $itemId);
            if ($replay !== null) return $replay;
        }

        $item = DB::table('xp_shop_items')
            ->where('id', $itemId)
            ->where('tenant_id', $tenantId)
            ->where('is_active', 1)
            ->first();

        if (!$item) {
            return ['success' => false, 'error' => __('api.xp_shop_item_not_found')];
        }

        $itemArr = (array) $item;

        // Pre-check outside transaction (fast path for common rejection cases)
        if (!self::canPurchaseItem($userId, $itemArr)) {
            $reason = self::getPurchaseBlockReason($userId, $itemArr, null);
            return ['success' => false, 'error' => $reason ?? __('api.xp_shop_cannot_purchase')];
        }

        DB::beginTransaction();
        try {
            // Re-check stock and per-user limits inside transaction to prevent
            // TOCTOU race conditions on concurrent purchases
            if ($item->stock_limit !== null) {
                $totalPurchases = DB::table('user_xp_purchases')
                    ->where('item_id', $item->id)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->count();
                if ($totalPurchases >= $item->stock_limit) {
                    DB::rollBack();
                    return ['success' => false, 'error' => __('api.xp_shop_out_of_stock')];
                }
            }

            if ($item->per_user_limit !== null) {
                $userPurchases = DB::table('user_xp_purchases')
                    ->where('user_id', $userId)
                    ->where('item_id', $item->id)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->count();
                if ($userPurchases >= $item->per_user_limit) {
                    DB::rollBack();
                    return ['success' => false, 'error' => __('api.xp_shop_already_owned')];
                }
            }

            // Deduct XP (atomic — WHERE xp >= cost prevents negative balance)
            $affected = DB::update(
                'UPDATE users SET xp = xp - ? WHERE id = ? AND tenant_id = ? AND xp >= ?',
                [(int) $item->xp_cost, $userId, $tenantId, (int) $item->xp_cost]
            );

            if ($affected === 0) {
                DB::rollBack();
                return ['success' => false, 'error' => __('api.xp_shop_not_enough_xp')];
            }

            // Record purchase
            $expiresAt = null;
            if ($item->item_type === 'perk') {
                $expiresAt = now()->addDays(30);
            }

            DB::table('user_xp_purchases')->insert([
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'creation_idempotency_key_hash' => $keyHash,
                'item_id' => $itemId,
                'xp_spent' => $item->xp_cost,
                'expires_at' => $expiresAt,
                'purchased_at' => now(),
            ]);

            DB::commit();
        } catch (QueryException $e) {
            DB::rollBack();
            if ($keyHash !== null) {
                $replay = self::findPurchaseReplay($tenantId, $userId, $keyHash, $itemId);
                if ($replay !== null) return $replay;
            }
            Log::error('XPShopService::purchaseItem error: ' . $e->getMessage());
            return ['success' => false, 'error' => __('api.purchase_failed')];
        } catch (\Throwable $e) {
            DB::rollBack();
            Log::error('XPShopService::purchaseItem error: ' . $e->getMessage());
            return ['success' => false, 'error' => __('api.purchase_failed')];
        }

        return [
            'success' => true,
            'item' => $itemArr,
            'xp_spent' => $item->xp_cost,
        ];
    }

    /** Resolve a completed retry or reject reuse of its key for another item. */
    private static function findPurchaseReplay(int $tenantId, int $userId, string $keyHash, int $itemId): ?array
    {
        $purchase = DB::table('user_xp_purchases')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('creation_idempotency_key_hash', $keyHash)
            ->first(['item_id', 'xp_spent']);
        if (!$purchase) return null;
        if ((int) $purchase->item_id !== $itemId) {
            return [
                'success' => false,
                'error' => __('event_registration.idempotency_conflict'),
                'idempotency_conflict' => true,
            ];
        }

        return [
            'success' => true,
            'item' => ['id' => $itemId],
            'xp_spent' => (int) $purchase->xp_spent,
            'idempotent_replay' => true,
        ];
    }

    /**
     * Get all available items (active, for current tenant).
     */
    public static function getAvailableItems(): array
    {
        return XpShopItem::where('is_active', 1)
            ->orderBy('display_order')
            ->orderBy('xp_cost')
            ->get()
            ->map(fn ($r) => $r->toArray())
            ->all();
    }

    /**
     * Get user's active perks.
     */
    public static function getUserActivePerks(int $userId): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('user_xp_purchases as uxp')
            ->join('xp_shop_items as xsi', 'uxp.item_id', '=', 'xsi.id')
            ->where('uxp.tenant_id', $tenantId)
            ->where('uxp.user_id', $userId)
            ->where('uxp.is_active', 1)
            ->where(function ($q) {
                $q->whereNull('uxp.expires_at')
                    ->orWhere('uxp.expires_at', '>', now());
            })
            ->select(['xsi.*', 'uxp.purchased_at', 'uxp.expires_at'])
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Check if user can purchase an item.
     */
    private static function canPurchaseItem(int $userId, array $item, ?int $userXP = null): bool
    {
        if ($userXP === null) {
            $tenantId = TenantContext::getId();
            $userXP = (int) DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->value('xp');
        }

        if ($userXP < $item['xp_cost']) {
            return false;
        }

        $tenantId = TenantContext::getId();

        if ($item['stock_limit'] !== null) {
            $totalPurchases = DB::table('user_xp_purchases')
                ->where('item_id', $item['id'])
                ->where('tenant_id', $tenantId)
                ->count();
            if ($totalPurchases >= $item['stock_limit']) {
                return false;
            }
        }

        if ($item['per_user_limit'] !== null) {
            $userPurchases = DB::table('user_xp_purchases')
                ->where('user_id', $userId)
                ->where('item_id', $item['id'])
                ->where('tenant_id', $tenantId)
                ->count();
            if ($userPurchases >= $item['per_user_limit']) {
                return false;
            }
        }

        return true;
    }

    /**
     * Get reason why purchase is blocked.
     */
    private static function getPurchaseBlockReason(int $userId, array $item, ?int $userXP): ?string
    {
        if ($userXP === null) {
            $tenantId = TenantContext::getId();
            $userXP = (int) DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->value('xp');
        }

        if ($userXP < $item['xp_cost']) {
            return __('api.xp_shop_not_enough_xp');
        }

        $tenantId = TenantContext::getId();

        if ($item['stock_limit'] !== null) {
            $totalPurchases = DB::table('user_xp_purchases')
                ->where('item_id', $item['id'])
                ->where('tenant_id', $tenantId)
                ->count();
            if ($totalPurchases >= $item['stock_limit']) {
                return __('api.xp_shop_out_of_stock');
            }
        }

        if ($item['per_user_limit'] !== null) {
            $userPurchases = DB::table('user_xp_purchases')
                ->where('user_id', $userId)
                ->where('item_id', $item['id'])
                ->where('tenant_id', $tenantId)
                ->count();
            if ($userPurchases >= $item['per_user_limit']) {
                return __('api.xp_shop_already_owned');
            }
        }

        return null;
    }
}
