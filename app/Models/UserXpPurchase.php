<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Models\Concerns\HasTenantScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class UserXpPurchase extends Model
{
    use HasFactory, HasTenantScope;

    protected $table = 'user_xp_purchases';

    const CREATED_AT = 'purchased_at';
    const UPDATED_AT = null;

    protected $fillable = [
        'tenant_id', 'user_id', 'creation_idempotency_key_hash', 'item_id', 'xp_spent', 'is_active', 'expires_at',
    ];

    protected $casts = [
        'xp_spent' => 'integer',
        'is_active' => 'boolean',
        'expires_at' => 'datetime',
        'purchased_at' => 'datetime',
    ];

    public function item(): BelongsTo
    {
        return $this->belongsTo(XpShopItem::class, 'item_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
