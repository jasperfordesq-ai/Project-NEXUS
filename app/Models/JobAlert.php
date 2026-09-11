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

class JobAlert extends Model
{
    use HasFactory, HasTenantScope;

    protected $table = 'job_alerts';

    public $timestamps = false;

    protected $fillable = [
        'tenant_id',
        'user_id',
        'creation_idempotency_key_hash',
        'creation_request_hash',
        'keywords',
        'categories',
        'type',
        'commitment',
        'location',
        'is_remote_only',
        'is_active',
        'last_notified_at',
        'created_at',
    ];

    protected $hidden = [
        'creation_idempotency_key_hash',
        'creation_request_hash',
    ];

    protected $casts = [
        'user_id' => 'integer',
        'is_remote_only' => 'boolean',
        'is_active' => 'boolean',
        'last_notified_at' => 'datetime',
        'created_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
