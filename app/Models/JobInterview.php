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

class JobInterview extends Model
{
    use HasFactory, HasTenantScope;

    protected $table = 'job_interviews';

    protected $fillable = [
        'tenant_id',
        'vacancy_id',
        'application_id',
        'proposed_by',
        'creation_idempotency_key_hash',
        'creation_request_hash',
        'interview_type',
        'scheduled_at',
        'duration_mins',
        'location_notes',
        'status',
        'candidate_notes',
        'interviewer_notes',
        'reminder_sent_at',
        'reminder_24h_sent_at',
        'reminder_1h_sent_at',
    ];

    protected $casts = [
        'tenant_id'       => 'integer',
        'vacancy_id'      => 'integer',
        'application_id'  => 'integer',
        'proposed_by'     => 'integer',
        'duration_mins'   => 'integer',
        'scheduled_at'    => 'datetime',
        'reminder_sent_at' => 'datetime',
        'reminder_24h_sent_at' => 'datetime',
        'reminder_1h_sent_at' => 'datetime',
    ];

    protected $hidden = ['creation_idempotency_key_hash', 'creation_request_hash'];

    public function vacancy(): BelongsTo
    {
        return $this->belongsTo(JobVacancy::class, 'vacancy_id');
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(JobApplication::class, 'application_id');
    }

    public function proposedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'proposed_by');
    }
}
