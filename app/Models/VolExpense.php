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

class VolExpense extends Model
{
    use HasFactory, HasTenantScope;

    protected $table = 'vol_expenses';

    public $timestamps = false;

    protected $fillable = [
        'user_id',
        'creation_idempotency_key_hash',
        'creation_request_hash',
        'organization_id',
        'opportunity_id',
        'shift_id',
        'expense_type',
        'amount',
        'currency',
        'description',
        'receipt_path',
        'receipt_filename',
        'status',
        'reviewed_by',
        'review_notes',
        'reviewed_at',
        'paid_at',
        'payment_reference',
        'submitted_at',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'submitted_at' => 'datetime',
        'reviewed_at' => 'datetime',
        'paid_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(VolOrganization::class, 'organization_id');
    }

    public function opportunity(): BelongsTo
    {
        return $this->belongsTo(VolOpportunity::class, 'opportunity_id');
    }

    public function shift(): BelongsTo
    {
        return $this->belongsTo(VolShift::class, 'shift_id');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }
}
