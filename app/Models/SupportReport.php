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

class SupportReport extends Model
{
    use HasFactory, HasTenantScope;

    protected $fillable = [
        'tenant_id',
        'user_id',
        'assigned_user_id',
        'reference',
        'source',
        'summary',
        'description',
        'impact',
        'status',
        'module',
        'route',
        'page_url',
        'sentry_event_id',
        'sentry_issue_url',
        'diagnostics',
        'user_agent',
        'ip_hash',
        'triage_notes',
        'triaged_at',
        'resolved_at',
        'closed_at',
        'request_type',
        'jira_issue_key',
        'jira_synced_at',
        'jira_last_error',
    ];

    protected $casts = [
        'diagnostics' => 'array',
        'triaged_at' => 'datetime',
        'resolved_at' => 'datetime',
        'closed_at' => 'datetime',
        'jira_synced_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_user_id');
    }
}
