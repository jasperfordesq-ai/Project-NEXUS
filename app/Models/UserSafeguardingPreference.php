<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Models\Concerns\HasTenantScope;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Crypt;

/**
 * Member safeguarding preference selection.
 *
 * Access-controlled: NEVER exposed in public profile API.
 * Only visible to the member themselves, tenant admins, and assigned brokers.
 * All reads are audit-logged.
 */
class UserSafeguardingPreference extends Model
{
    use HasFactory, HasTenantScope;

    protected $table = 'user_safeguarding_preferences';

    public $timestamps = false;

    const CREATED_AT = 'created_at';
    const UPDATED_AT = 'updated_at';

    protected $fillable = [
        'tenant_id',
        'user_id',
        'option_id',
        'selected_value',
        'notes',
        'consent_given_at',
        'consent_ip',
        'revoked_at',
        'policy_review_required_at',
        'policy_review_reason_code',
    ];

    protected $casts = [
        'user_id' => 'integer',
        'option_id' => 'integer',
        'consent_given_at' => 'datetime',
        'revoked_at' => 'datetime',
        'policy_review_required_at' => 'datetime',
    ];

    /**
     * The member's own note is encrypted at rest (26 Oct 2026). Notes saved
     * before that, in plain text, still read back: see decryptNotes().
     */
    protected function notes(): Attribute
    {
        return Attribute::make(
            get: static fn (?string $value): ?string => self::decryptNotes($value),
            set: static fn (?string $value): ?string => ($value === null || $value === '') ? $value : Crypt::encryptString($value),
        );
    }

    /**
     * Read a stored note, encrypted or (if saved before encryption) plain.
     * For raw-SQL readers such as the GDPR export.
     */
    public static function decryptNotes(?string $stored): ?string
    {
        if ($stored === null || $stored === '') {
            return $stored;
        }

        try {
            return Crypt::decryptString($stored);
        } catch (DecryptException) {
            return $stored;
        }
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function option(): BelongsTo
    {
        return $this->belongsTo(TenantSafeguardingOption::class, 'option_id');
    }

    /**
     * Canonicalise a submitted value without changing preference lifecycle.
     *
     * A non-revoked row records the member's latest response, including an
     * explicit checkbox "no". Consumers must use isEffectivelySelected()
     * rather than treating every non-revoked row as an affirmative selection.
     */
    public static function normalizeSelectedValue(?string $optionType, mixed $value): string
    {
        $optionType = strtolower(trim($optionType ?? ''));

        return match ($optionType) {
            'checkbox' => self::isTruthyCheckboxValue($value) ? '1' : '0',
            'select' => trim(self::stringValue($value)),
            default => '0',
        };
    }

    /**
     * Whether a stored response affirmatively selects its typed option.
     */
    public static function isEffectivelySelected(?string $optionType, mixed $value): bool
    {
        $optionType = strtolower(trim($optionType ?? ''));

        return match ($optionType) {
            'checkbox' => self::isTruthyCheckboxValue($value),
            'select' => trim(self::stringValue($value)) !== '',
            default => false,
        };
    }

    private static function isTruthyCheckboxValue(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        return in_array(strtolower(trim(self::stringValue($value))), ['1', 'true', 'yes', 'on'], true);
    }

    private static function stringValue(mixed $value): string
    {
        if (is_string($value) || is_int($value) || is_float($value)) {
            return (string) $value;
        }
        if (is_bool($value)) {
            return $value ? '1' : '';
        }
        if ($value instanceof \Stringable) {
            return (string) $value;
        }

        return '';
    }

    /**
     * Scope to only active (non-revoked) preferences.
     */
    public function scopeActive($query)
    {
        return $query->whereNull('revoked_at');
    }

    /**
     * Whether this preference is currently active (not revoked).
     */
    public function isActive(): bool
    {
        return $this->revoked_at === null;
    }
}
