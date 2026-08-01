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

class PartnerVenueVisit extends Model
{
    use HasFactory, HasTenantScope;

    protected $table = 'partner_venue_visits';

    protected $fillable = [
        'venue_id',
        'user_id',
        'recorded_by_user_id',
        'source',
        'visited_on',
        'visited_at',
        'metadata',
    ];

    protected $casts = [
        'visited_on' => 'date',
        'visited_at' => 'datetime',
        'metadata' => 'array',
    ];

    public function venue(): BelongsTo
    {
        return $this->belongsTo(PartnerVenue::class, 'venue_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function recordedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by_user_id');
    }
}
