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
 * A screenshot attached to a support report. `path` is relative to the
 * private `local` disk and is never exposed to a client.
 */
class SupportReportAttachment extends Model
{
    use HasTenantScope;

    protected $fillable = [
        'tenant_id',
        'support_report_id',
        'path',
        'mime',
        'size_bytes',
        'width',
        'height',
        'original_name',
        'jira_attached_at',
    ];

    protected $hidden = ['path'];

    protected $casts = [
        'size_bytes' => 'integer',
        'width' => 'integer',
        'height' => 'integer',
        'jira_attached_at' => 'datetime',
    ];

    public function report(): BelongsTo
    {
        return $this->belongsTo(SupportReport::class, 'support_report_id');
    }
}
