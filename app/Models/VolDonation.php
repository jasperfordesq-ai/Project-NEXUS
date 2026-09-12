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

class VolDonation extends Model
{
    use HasFactory, HasTenantScope;

    protected $table = 'vol_donations';

    public $timestamps = false;

    protected $fillable = [
        'user_id',
        'creation_idempotency_key_hash',
        'creation_request_hash',
        'opportunity_id',
        'community_project_id',
        'giving_day_id',
        'fund_code',
        'amount',
        'amount_refunded',
        'currency',
        'payment_method',
        'payment_reference',
        'payment_route',
        'donor_name',
        'donor_email',
        'message',
        'is_anonymous',
        'status',
        'gift_aid_claim_status',
        'gift_aid_declaration_name',
        'gift_aid_address_line1',
        'gift_aid_address_line2',
        'gift_aid_town',
        'gift_aid_postcode',
        'gift_aid_country',
        'gift_aid_consented_at',
        'gift_aid_claimed_at',
        'created_at',
        'stripe_payment_intent_id',
        'stripe_account_id',
        'receipt_email_sent_at',
        'receipt_email_failed_at',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'amount_refunded' => 'decimal:2',
        'is_anonymous' => 'boolean',
        'created_at' => 'datetime',
        'gift_aid_consented_at' => 'datetime',
        'gift_aid_claimed_at' => 'datetime',
        'receipt_email_sent_at' => 'datetime',
        'receipt_email_failed_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function opportunity(): BelongsTo
    {
        return $this->belongsTo(VolOpportunity::class, 'opportunity_id');
    }

    public function givingDay(): BelongsTo
    {
        return $this->belongsTo(VolGivingDay::class, 'giving_day_id');
    }
}
