<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Models\Concerns\HasTenantScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class VolGivingDay extends Model
{
    use HasFactory, HasTenantScope;

    protected $table = 'vol_giving_days';

    public $timestamps = false;

    protected $fillable = [
        'title',
        'description',
        'start_date',
        'end_date',
        'goal_amount',
        'raised_amount',
        'target_hours',
        'is_active',
        'organization_id',
        'created_by',
        'created_at',
    ];

    protected $casts = [
        'goal_amount' => 'decimal:2',
        'raised_amount' => 'decimal:2',
        'target_hours' => 'decimal:1',
        'is_active' => 'boolean',
        'organization_id' => 'integer',
        'created_at' => 'datetime',
    ];

    public function donations(): HasMany
    {
        return $this->hasMany(VolDonation::class, 'giving_day_id');
    }
}
