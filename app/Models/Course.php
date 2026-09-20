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
use Illuminate\Database\Eloquent\Relations\HasMany;

class Course extends Model
{
    use HasFactory;
    use HasTenantScope;

    protected $table = 'courses';

    // Author identity, lifecycle status, and moderation columns are deliberately
    // NOT mass-assignable so untrusted request input can never spoof authorship,
    // self-publish, or bypass moderation. They are set explicitly by the service
    // layer (CourseService::create/publish, AdminCourseController::moderate).
    protected $fillable = [
        'category_id',
        'title',
        'slug',
        'summary',
        'description',
        'cover_image',
        'level',
        'visibility',
        'enrollment_type',
        'credit_cost',
        'learner_credit_reward',
        'instructor_credit_reward',
        'prerequisites',
    ];

    protected $hidden = ['tenant_id'];

    protected $casts = [
        'prerequisites' => 'array',
        'credit_cost' => 'decimal:2',
        'learner_credit_reward' => 'decimal:2',
        'instructor_credit_reward' => 'decimal:2',
        'rating_avg' => 'decimal:2',
        'rating_count' => 'integer',
        'enrollment_count' => 'integer',
        'completion_count' => 'integer',
        'moderated_by' => 'integer',
        'moderated_at' => 'datetime',
        'published_at' => 'datetime',
    ];

    // ---------------------------------------------------------------
    //  Relationships
    // ---------------------------------------------------------------

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_user_id');
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(CourseCategory::class, 'category_id');
    }

    public function sections(): HasMany
    {
        return $this->hasMany(CourseSection::class)->orderBy('position');
    }

    public function lessons(): HasMany
    {
        return $this->hasMany(CourseLesson::class)->orderBy('position');
    }

    public function unassignedLessons(): HasMany
    {
        return $this->hasMany(CourseLesson::class)->whereNull('section_id')->orderBy('position')->orderBy('id');
    }

    public function enrollments(): HasMany
    {
        return $this->hasMany(CourseEnrollment::class);
    }

    public function reviews(): HasMany
    {
        return $this->hasMany(CourseReview::class);
    }

    // ---------------------------------------------------------------
    //  Scopes
    // ---------------------------------------------------------------

    public function scopePublished(Builder $query): Builder
    {
        return $query->where('status', 'published')
                     ->where('moderation_status', 'approved');
    }
}
