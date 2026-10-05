<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Models\Concerns\HasTenantScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A volunteer's recorded qualification (training, licence, registration).
 *
 * A register entry, not a document: nothing is uploaded. See
 * `VolunteerQualificationService` for the status rules and the
 * build spec in `.local-docs-archive/volunteering-credentials/`.
 */
class VolQualification extends Model
{
    use HasTenantScope;

    public const STATUS_RECORDED = 'recorded';
    public const STATUS_CONFIRMED = 'confirmed';
    public const STATUS_EXPIRED = 'expired';
    public const STATUS_WITHDRAWN = 'withdrawn';

    /** @var list<string> */
    public const STATUSES = [
        self::STATUS_RECORDED,
        self::STATUS_CONFIRMED,
        self::STATUS_EXPIRED,
        self::STATUS_WITHDRAWN,
    ];

    /** @var list<string> */
    public const CONFIRMATION_METHODS = ['saw_original', 'online_register', 'issuer_confirmed'];

    /** @var list<string> */
    public const WITHDRAWAL_REASONS = ['entered_in_error', 'no_longer_held', 'replaced', 'volunteer_request'];

    protected $table = 'vol_qualifications';

    protected $fillable = [
        'tenant_id',
        'user_id',
        'qualification_type',
        'title',
        'issuer',
        'reference_number',
        'obtained_at',
        'expires_at',
        'status',
        'confirmed_by',
        'confirmed_at',
        'confirmation_method',
        'confirmed_for_organization_id',
        'withdrawn_by',
        'withdrawn_at',
        'withdrawal_reason',
        'expiry_reminder_sent_at',
        'expired_notice_sent_at',
        'notes',
    ];

    protected $casts = [
        'obtained_at' => 'date',
        'expires_at' => 'date',
        'confirmed_at' => 'datetime',
        'withdrawn_at' => 'datetime',
        'expiry_reminder_sent_at' => 'datetime',
        'expired_notice_sent_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function confirmer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'confirmed_by');
    }

    public function confirmedForOrganization(): BelongsTo
    {
        return $this->belongsTo(VolOrganization::class, 'confirmed_for_organization_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(VolQualificationEvent::class, 'qualification_id');
    }
}
