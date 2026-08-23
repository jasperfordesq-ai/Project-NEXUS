<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Models\Concerns\HasTenantScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Transaction extends Model
{
    use HasFactory;
    use HasTenantScope;

    protected $table = 'transactions';

    protected $fillable = [
        'sender_id', 'receiver_id', 'amount', 'description',
        'transaction_type', 'status', 'source_match_id', 'deleted_for_sender', 'deleted_for_receiver',
        // Who actually initiated this, when that is not one of the two parties —
        // currently a linked-account carer/guardian spending a dependent's
        // balance. NULL for every ordinary transfer.
        'acting_user_id',
    ];

    /**
     * Attributes hidden from JSON serialization to prevent data leakage.
     */
    protected $hidden = ['tenant_id'];

    protected $casts = [
        'amount' => 'decimal:2',
        'deleted_for_sender' => 'boolean',
        'deleted_for_receiver' => 'boolean',
    ];

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sender_id');
    }

    public function receiver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'receiver_id');
    }

    public function listing(): BelongsTo
    {
        return $this->belongsTo(Listing::class);
    }

    public function scopeCompleted(Builder $query): Builder
    {
        return $query->where('status', 'completed');
    }

    /**
     * Pending transactions only.
     *
     * 🔴 Only external federation creates one of these (`FederationController`), so in an
     * ordinary community the set is empty — but the wallet advertises pending totals from
     * `getBalance()` and both frontends offer a "Pending" filter, and until 2026-08-23
     * `getTransactions()` was hard-scoped to `completed()` so that filter could only ever
     * answer "No matching transactions" while the tile beside it claimed hours were pending.
     */
    public function scopePending(Builder $query): Builder
    {
        return $query->where('status', 'pending');
    }

    public function scopeForUser(Builder $query, int $userId): Builder
    {
        return $query->where(function ($q) use ($userId) {
            $q->where('sender_id', $userId)->where('deleted_for_sender', false);
        })->orWhere(function ($q) use ($userId) {
            $q->where('receiver_id', $userId)->where('deleted_for_receiver', false);
        });
    }
}
