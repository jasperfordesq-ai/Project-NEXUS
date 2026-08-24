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
use Illuminate\Database\Eloquent\Relations\HasOne;

class CourseLesson extends Model
{
    use HasFactory;
    use HasTenantScope;

    protected $table = 'course_lessons';

    protected $fillable = [
        'course_id',
        'section_id',
        'title',
        'content_type',
        'body',
        'transcript',
        'video_url',
        'attachment_url',
        'embed_url',
        'position',
        'min_watch_percent',
        'drip_type',
        'drip_offset_days',
        'drip_date',
        'is_preview',
    ];

    protected $hidden = ['tenant_id'];

    protected $casts = [
        'position' => 'integer',
        'min_watch_percent' => 'integer',
        'drip_offset_days' => 'integer',
        'drip_date' => 'datetime',
        'is_preview' => 'boolean',
    ];

    public function course(): BelongsTo
    {
        return $this->belongsTo(Course::class);
    }

    public function section(): BelongsTo
    {
        return $this->belongsTo(CourseSection::class, 'section_id');
    }

    public function quiz(): HasOne
    {
        return $this->hasOne(CourseQuiz::class, 'lesson_id');
    }
}
