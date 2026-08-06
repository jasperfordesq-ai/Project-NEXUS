<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Models\Concerns\HasTenantScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A co_decide-tier action a supporter prepared and the supported member has
 * not yet answered. See the migration for the design, and
 * SupportPendingActionService for every state transition — no other code
 * should write these rows.
 */
class SupportPendingAction extends Model
{
    use HasTenantScope;

    public const STATUS_PENDING = 'pending';
    public const STATUS_CONFIRMED = 'confirmed';
    public const STATUS_DECLINED = 'declined';
    public const STATUS_EXPIRED = 'expired';
    public const STATUS_CANCELLED = 'cancelled';

    public const TYPE_LISTING_CREATE = 'listing_create';
    public const TYPE_CREDIT_TRANSFER = 'credit_transfer';

    /** action_type => the SupportTiers capability it exercises */
    public const TYPE_CAPABILITIES = [
        self::TYPE_LISTING_CREATE => 'listings',
        self::TYPE_CREDIT_TRANSFER => 'credits',
    ];

    protected $table = 'support_pending_actions';

    protected $fillable = [
        'tenant_id', 'relationship_id', 'supported_user_id', 'supporter_user_id',
        'action_type', 'payload', 'status', 'token_hash', 'expires_at',
    ];

    protected $casts = [
        'relationship_id' => 'integer',
        'supported_user_id' => 'integer',
        'supporter_user_id' => 'integer',
        'payload' => 'array',
        'expires_at' => 'datetime',
        'token_consumed_at' => 'datetime',
        'confirmed_at' => 'datetime',
        'declined_at' => 'datetime',
        'cancelled_at' => 'datetime',
        'result_id' => 'integer',
    ];

    public function supportedUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'supported_user_id');
    }

    public function supporterUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'supporter_user_id');
    }

    public function relationship(): BelongsTo
    {
        return $this->belongsTo(AccountRelationship::class, 'relationship_id');
    }
}
