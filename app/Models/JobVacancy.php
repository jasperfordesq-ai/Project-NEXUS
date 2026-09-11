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

class JobVacancy extends Model
{
    use HasFactory, HasTenantScope;

    protected $table = 'job_vacancies';

    protected $fillable = [
        'tenant_id',
        'user_id',
        'creation_idempotency_key_hash',
        'creation_request_hash',
        'organization_id',
        'title',
        'description',
        'tagline',
        'video_url',
        'culture_photos',
        'company_size',
        'benefits',
        'location',
        'latitude',
        'longitude',
        'is_remote',
        'type',
        'commitment',
        'category',
        'skills_required',
        'hours_per_week',
        'time_credits',
        'contact_email',
        'contact_phone',
        'deadline',
        'status',
        'salary_min',
        'salary_max',
        'salary_type',
        'salary_currency',
        'salary_negotiable',
        'is_featured',
        'featured_until',
        'expired_at',
        'renewed_at',
        'renewal_count',
        'views_count',
        'applications_count',
        'moderation_status',
        'moderation_notes',
        'moderated_by',
        'moderated_at',
        'spam_score',
        'spam_flags',
        'blind_hiring',
    ];

    protected $hidden = [
        'creation_idempotency_key_hash',
        'creation_request_hash',
    ];

    protected $casts = [
        'tenant_id' => 'integer',
        'user_id' => 'integer',
        'organization_id' => 'integer',
        'latitude' => 'float',
        'longitude' => 'float',
        'is_remote' => 'boolean',
        'hours_per_week' => 'float',
        'time_credits' => 'float',
        'culture_photos' => 'array',
        'benefits' => 'array',
        'salary_min' => 'float',
        'salary_max' => 'float',
        'salary_negotiable' => 'boolean',
        'is_featured' => 'boolean',
        'featured_until' => 'datetime',
        'expired_at' => 'datetime',
        'renewed_at' => 'datetime',
        'renewal_count' => 'integer',
        'views_count' => 'integer',
        'applications_count' => 'integer',
        'deadline' => 'datetime',
        'moderated_by' => 'integer',
        'moderated_at' => 'datetime',
        'spam_score' => 'integer',
        'spam_flags' => 'array',
        'blind_hiring' => 'boolean',
    ];

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function applications(): HasMany
    {
        return $this->hasMany(JobApplication::class, 'vacancy_id');
    }
}
