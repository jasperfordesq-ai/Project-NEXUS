<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Models\Concerns\HasTenantScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Append-only history of a volunteer qualification. The application never
 * updates or deletes a row; `actor_user_id` is null for the nightly job.
 */
class VolQualificationEvent extends Model
{
    use HasTenantScope;

    /** @var list<string> */
    public const EVENTS = ['recorded', 'updated', 'confirmed', 'withdrawn', 'expired', 'reminder_sent', 'expired_notice_sent'];

    protected $table = 'vol_qualification_events';

    public $timestamps = false;

    protected $fillable = [
        'tenant_id',
        'qualification_id',
        'actor_user_id',
        'event',
        'organization_id',
        'details',
        'created_at',
    ];

    protected $casts = [
        'details' => 'array',
        'created_at' => 'datetime',
    ];

    public function qualification(): BelongsTo
    {
        return $this->belongsTo(VolQualification::class, 'qualification_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }
}
