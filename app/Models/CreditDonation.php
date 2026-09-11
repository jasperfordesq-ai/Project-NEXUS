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

class CreditDonation extends Model
{
    use HasFactory, HasTenantScope;

    protected $table = 'credit_donations';

    // The credit_donations table has a created_at column but NO updated_at.
    // Without this, Eloquent's default timestamps emit "Unknown column
    // 'updated_at'" on create()/save() and donate-to-member 500s.
    public const UPDATED_AT = null;

    protected $fillable = [
        'donor_id', 'recipient_type', 'recipient_id',
        'amount', 'message', 'transaction_id', 'idempotency_fingerprint',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
    ];

    protected $hidden = ['idempotency_fingerprint'];

    public function donor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'donor_id');
    }

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recipient_id');
    }

    public function transaction(): BelongsTo
    {
        return $this->belongsTo(Transaction::class, 'transaction_id');
    }
}
