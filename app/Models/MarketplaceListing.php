<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Models\Concerns\HasTenantScope;
use App\Core\TenantContext;
use App\Scopes\TenantScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOneThrough;
use Illuminate\Database\Eloquent\Builder;

class MarketplaceListing extends Model
{
    use HasFactory;
    use HasTenantScope;

    protected $table = 'marketplace_listings';

    protected $fillable = [
        'user_id',
        'category_id',
        'title',
        'tagline',
        'description',
        'condition',
        'price',
        'price_currency',
        'price_type',
        'time_credit_price',
        'loan_terms',
        'quantity',
        'template_data',
        'location',
        'latitude',
        'longitude',
        'shipping_available',
        'local_pickup',
        'delivery_method',
        'seller_type',
        'status',
        'marketplace_status',
        'moderation_status',
        'moderation_notes',
        'moderated_by',
        'moderated_at',
        'promotion_type',
        'promoted_until',
        'marketplace_enforcement_report_id',
        'expires_at',
        'renewed_at',
        'renewal_count',
        'video_url',
    ];

    /**
     * Attributes hidden from JSON serialization to prevent data leakage.
     */
    protected $hidden = ['tenant_id'];

    protected $casts = [
        'template_data' => 'array',
        'shipping_available' => 'boolean',
        'local_pickup' => 'boolean',
        'price' => 'decimal:2',
        'time_credit_price' => 'decimal:2',
        'latitude' => 'float',
        'longitude' => 'float',
        'moderated_at' => 'datetime',
        'promoted_until' => 'datetime',
        'expires_at' => 'datetime',
        'renewed_at' => 'datetime',
        'renewal_count' => 'integer',
        'quantity' => 'integer',
        'views_count' => 'integer',
        'saves_count' => 'integer',
        'contacts_count' => 'integer',
        'moderated_by' => 'integer',
    ];

    // ---------------------------------------------------------------
    //  Relationships
    // ---------------------------------------------------------------

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function category(): BelongsTo
    {
        $tenantId = TenantContext::getId();

        return $this->belongsTo(MarketplaceCategory::class, 'category_id')
            ->withoutGlobalScope(TenantScope::class)
            ->where(static function (Builder $query) use ($tenantId): void {
                $query->where('marketplace_categories.tenant_id', $tenantId)
                    ->orWhereNull('marketplace_categories.tenant_id');
            });
    }

    public function images(): HasMany
    {
        return $this->hasMany(MarketplaceImage::class)->orderBy('sort_order');
    }

    public function offers(): HasMany
    {
        return $this->hasMany(MarketplaceOffer::class);
    }

    public function savedByUsers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'marketplace_saved_listings');
    }

    public function sellerProfile(): HasOneThrough
    {
        return $this->hasOneThrough(
            MarketplaceSellerProfile::class,
            User::class,
            'id',           // users.id
            'user_id',      // marketplace_seller_profiles.user_id
            'user_id',      // marketplace_listings.user_id
            'id'            // users.id
        );
    }

    // ---------------------------------------------------------------
    //  Scopes
    // ---------------------------------------------------------------

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('status', 'active')
                     ->where('moderation_status', 'approved')
                     ->where(static function (Builder $expiryQuery): void {
                         $expiryQuery->whereNull('expires_at')
                             ->orWhere('expires_at', '>', now());
                     });
    }

    public function scopeFree(Builder $query): Builder
    {
        return $query->where('price_type', 'free');
    }

    /** Borrow & lend listings: the item is lent and returned, never sold. */
    public function scopeLend(Builder $query): Builder
    {
        return $query->where('price_type', 'lend');
    }

    /**
     * Filter listings within a given radius (km) of a coordinate using the haversine formula.
     */
    public function scopeNearby(Builder $query, float $lat, float $lng, float $radiusKm): Builder
    {
        $haversine = "(6371 * acos(LEAST(1, GREATEST(-1, cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude))))))";

        return $query->withinRadiusBoundingBox($lat, $lng, $radiusKm)
                     ->whereRaw("{$haversine} <= ?", [$lat, $lng, $lat, $radiusKm])
                     ->orderByRaw("{$haversine} ASC", [$lat, $lng, $lat]);
    }

    /**
     * Apply an index-friendly latitude/longitude bounding box before an exact
     * Haversine calculation. Handles boxes that cross the antimeridian.
     */
    public function scopeWithinRadiusBoundingBox(
        Builder $query,
        float $lat,
        float $lng,
        float $radiusKm
    ): Builder {
        $latitudeDelta = $radiusKm / 111.045;
        $minimumLatitude = max(-90.0, $lat - $latitudeDelta);
        $maximumLatitude = min(90.0, $lat + $latitudeDelta);

        $query->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->whereBetween('latitude', [$minimumLatitude, $maximumLatitude]);

        $longitudeScale = abs(cos(deg2rad($lat)));
        if ($longitudeScale < 0.000001) {
            return $query;
        }

        $longitudeDelta = min(180.0, $radiusKm / (111.045 * $longitudeScale));
        if ($longitudeDelta >= 180.0) {
            return $query;
        }

        $west = $lng - $longitudeDelta;
        $east = $lng + $longitudeDelta;

        if ($west < -180.0) {
            return $query->where(static function (Builder $longitudeQuery) use ($west, $east): void {
                $longitudeQuery->where('longitude', '>=', $west + 360.0)
                    ->orWhere('longitude', '<=', $east);
            });
        }

        if ($east > 180.0) {
            return $query->where(static function (Builder $longitudeQuery) use ($west, $east): void {
                $longitudeQuery->where('longitude', '>=', $west)
                    ->orWhere('longitude', '<=', $east - 360.0);
            });
        }

        return $query->whereBetween('longitude', [$west, $east]);
    }
}
