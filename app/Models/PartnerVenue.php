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
use Illuminate\Database\Eloquent\Relations\HasMany;

class PartnerVenue extends Model
{
    use HasFactory, HasTenantScope;

    protected $table = 'partner_venues';

    protected $fillable = [
        'name',
        'slug',
        'description',
        'category',
        'offer_summary',
        'address_line',
        'city',
        'postcode',
        'latitude',
        'longitude',
        'website',
        'contact_email',
        'logo_url',
        'status',
        'created_by',
    ];

    protected $casts = [
        'latitude' => 'float',
        'longitude' => 'float',
    ];

    /**
     * poster_token is deliberately not fillable — no poster tokens are issued
     * in v1, and when they are they must be generated server-side.
     */
    protected $hidden = ['poster_token'];

    public function visits(): HasMany
    {
        return $this->hasMany(PartnerVenueVisit::class, 'venue_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
