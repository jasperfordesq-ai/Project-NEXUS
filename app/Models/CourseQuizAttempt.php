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

class CourseQuizAttempt extends Model
{
    use HasFactory;
    use HasTenantScope;

    protected $table = 'course_quiz_attempts';

    protected $fillable = [
        'quiz_id',
        'user_id',
        'enrollment_id',
        'answers',
        'score_percent',
        'passed',
        'grading_status',
        'graded_by',
        'feedback',
        'submitted_at',
        'idempotency_key_hash',
        'request_hash',
    ];

    protected $hidden = ['tenant_id', 'idempotency_key_hash', 'request_hash'];

    protected $casts = [
        'answers' => 'array',
        'score_percent' => 'decimal:2',
        'passed' => 'boolean',
        'graded_by' => 'integer',
        'submitted_at' => 'datetime',
    ];

    public function quiz(): BelongsTo
    {
        return $this->belongsTo(CourseQuiz::class, 'quiz_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
