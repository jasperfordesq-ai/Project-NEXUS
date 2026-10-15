<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Enums\EventOperationalState;
use App\Enums\EventPublicationState;
use App\Models\Concerns\HasTenantScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Event extends Model
{
    use HasFactory;
    use HasTenantScope;

    protected $table = 'events';

    protected $fillable = [
        'user_id', 'title', 'description', 'location',
        'latitude', 'longitude', 'start_time', 'end_time', 'group_id',
        'category_id', 'max_attendees', 'is_online', 'online_link',
        'image_url', 'cover_image', 'federated_visibility', 'video_url',
        'allow_remote_attendance', 'series_id', 'is_public_listing',
        'accessibility_step_free', 'accessibility_toilet',
        'accessibility_hearing_loop', 'accessibility_quiet_space',
        'accessibility_seating', 'accessibility_parking',
        'accessibility_parking_details', 'accessibility_transit_details',
        'accessibility_assistance_contact', 'accessibility_notes',
    ];

    /**
     * Attributes hidden from JSON serialization to prevent data leakage.
     */
    protected $hidden = [
        'tenant_id',
        'publication_status_changed_by',
        'operational_status_changed_by',
        'moderation_submitted_by',
        'moderated_by',
        'moderation_reason',
        'lifecycle_reason',
        'recurrence_id',
        'recurrence_override_fields',
        'recurrence_override_updated_by',
    ];

    protected $casts = [
        'latitude' => 'float',
        'longitude' => 'float',
        'start_time' => 'datetime',
        'end_time' => 'datetime',
        'max_attendees' => 'integer',
        'is_online' => 'boolean',
        'allow_remote_attendance' => 'boolean',
        'is_public_listing' => 'boolean',
        'all_day' => 'boolean',
        'accessibility_step_free' => 'boolean',
        'accessibility_toilet' => 'boolean',
        'accessibility_hearing_loop' => 'boolean',
        'accessibility_quiet_space' => 'boolean',
        'accessibility_seating' => 'boolean',
        'accessibility_parking' => 'boolean',
        'publication_status' => EventPublicationState::class,
        'operational_status' => EventOperationalState::class,
        'lifecycle_version' => 'integer',
        'calendar_sequence' => 'integer',
        'federation_version' => 'integer',
        'agenda_version' => 'integer',
        'is_recurrence_exception' => 'boolean',
        'recurrence_override_fields' => 'array',
        'recurrence_override_version' => 'integer',
        'recurrence_override_updated_at' => 'datetime',
        'publication_status_changed_at' => 'datetime',
        'operational_status_changed_at' => 'datetime',
        'moderation_submitted_at' => 'datetime',
        'moderated_at' => 'datetime',
    ];

    /**
     * Appended attributes for frontend compatibility.
     *
     * Frontend expects `start_date`/`end_date` (aliases for start_time/end_time).
     */
    protected $appends = ['start_date', 'end_date'];

    public function getStartDateAttribute(): ?string
    {
        return $this->start_time?->toIso8601String();
    }

    public function getEndDateAttribute(): ?string
    {
        return $this->end_time?->toIso8601String();
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class);
    }

    public function series(): BelongsTo
    {
        return $this->belongsTo(EventSeries::class, 'series_id');
    }

    public function rsvps(): HasMany
    {
        return $this->hasMany(EventRsvp::class);
    }

    public function polls(): HasMany
    {
        return $this->hasMany(Poll::class);
    }

    public function statusHistory(): HasMany
    {
        return $this->hasMany(EventStatusHistory::class);
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(EventSession::class)
            ->orderBy('starts_at_utc')
            ->orderBy('position')
            ->orderBy('id');
    }

    public function scopeUpcoming(Builder $query): Builder
    {
        return $query->where('start_time', '>=', now())->orderBy('start_time');
    }

    public function scopePast(Builder $query): Builder
    {
        return $query->where('end_time', '<', now())->orderByDesc('start_time');
    }
}
