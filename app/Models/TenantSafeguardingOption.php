<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Models\Concerns\HasTenantScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Lang;

/**
 * Admin-configured safeguarding option shown during onboarding.
 *
 * Each tenant defines their own options (via country presets or custom config).
 * These are NEVER exposed in public profile APIs.
 */
class TenantSafeguardingOption extends Model
{
    use HasFactory, HasTenantScope;

    public const PRESET_TRANSLATION_PREFIX = 'safeguarding.presets.';

    protected $table = 'tenant_safeguarding_options';

    public $timestamps = false;

    const CREATED_AT = 'created_at';
    const UPDATED_AT = 'updated_at';

    protected $fillable = [
        'tenant_id',
        'option_key',
        'option_type',
        'label',
        'description',
        'help_url',
        'sort_order',
        'is_active',
        'is_required',
        'accepts_new_selections',
        'select_options',
        'triggers',
        'preset_source',
    ];

    protected $casts = [
        'sort_order' => 'integer',
        'is_active' => 'boolean',
        'is_required' => 'boolean',
        'accepts_new_selections' => 'boolean',
        'select_options' => 'array',
        'triggers' => 'array',
    ];

    public function preferences(): HasMany
    {
        return $this->hasMany(UserSafeguardingPreference::class, 'option_id');
    }

    /**
     * Scope to only active options, ordered by sort_order.
     */
    public function scopeActive($query)
    {
        return $query->where('is_active', true)->orderBy('sort_order');
    }

    /**
     * Whether a member who has not already chosen this option may choose it.
     * A closed option keeps protecting, and stays visible to, its holders.
     */
    public function acceptsNewSelections(): bool
    {
        return $this->accepts_new_selections !== false;
    }

    /**
     * Get the merged trigger defaults (false for any missing key).
     */
    public function getTrigger(string $key): bool
    {
        return (bool) ($this->triggers[$key] ?? false);
    }

    /**
     * Get the vetting type required by this option's triggers (if any).
     */
    public function getRequiredVettingType(): ?string
    {
        return $this->triggers['vetting_type_required'] ?? null;
    }

    public static function isPresetTranslationKey(?string $value): bool
    {
        return is_string($value) && str_starts_with($value, self::PRESET_TRANSLATION_PREFIX);
    }

    /**
     * Resolve built-in preset copy in the active request/recipient locale.
     * Broker-authored text is stored as plain text and deliberately returned
     * unchanged, so a custom label is never treated as translatable platform
     * copy.
     */
    public static function localizePresetText(?string $value): ?string
    {
        if (! self::isPresetTranslationKey($value)) {
            return $value;
        }

        $translated = __($value);

        return is_string($translated) ? $translated : $value;
    }

    /**
     * Find the canonical translation key for a field in a built-in preset.
     *
     * @param 'label'|'description' $field
     */
    public static function presetTranslationKey(
        ?string $presetSource,
        ?string $optionKey,
        string $field,
    ): ?string {
        if ($presetSource === null || $optionKey === null || ! in_array($field, ['label', 'description'], true)) {
            return null;
        }

        $presets = config('safeguarding_presets', []);
        if (! is_array($presets)) {
            return null;
        }

        $sourceOptions = $presets[$presetSource]['options'] ?? [];
        if (is_array($sourceOptions)) {
            foreach ($sourceOptions as $option) {
                if (! is_array($option) || ($option['option_key'] ?? null) !== $optionKey) {
                    continue;
                }

                $candidate = $option[$field] ?? null;

                if (self::isPresetTranslationKey($candidate)) {
                    return $candidate;
                }
            }
        }

        // Early safeguarding migrations used a migration identifier as the
        // preset source. If every current jurisdiction agrees on the same key
        // for this option field, that identity is still unambiguous (notably
        // the shared none_apply copy), so those untouched rows can localize too.
        $candidates = [];
        foreach ($presets as $preset) {
            if (! is_array($preset) || ! is_array($preset['options'] ?? null)) {
                continue;
            }

            foreach ($preset['options'] as $option) {
                if (! is_array($option) || ($option['option_key'] ?? null) !== $optionKey) {
                    continue;
                }

                $candidate = $option[$field] ?? null;
                if (self::isPresetTranslationKey($candidate)) {
                    $candidates[$candidate] = true;
                }
            }
        }

        if (count($candidates) !== 1) {
            return null;
        }

        $candidate = array_key_first($candidates);

        return is_string($candidate) ? $candidate : null;
    }

    /**
     * Return the canonical key only while a row still contains managed preset
     * copy. Exact legacy English values are recognized so existing tenants
     * localize without a data migration; edited broker text remains literal.
     *
     * @param 'label'|'description' $field
     */
    public static function managedPresetTranslationKey(
        ?string $presetSource,
        ?string $optionKey,
        string $field,
        ?string $value,
    ): ?string {
        $translationKey = self::presetTranslationKey($presetSource, $optionKey, $field);
        // A row can outlive its option's place in the preset (25 Oct 2026: the
        // Ireland preset dropped "only vetted members", which its holders keep).
        // A stored platform key that still exists is still platform copy;
        // without this the member would read the raw key.
        if ($translationKey === null
            && $presetSource !== null
            && self::isPresetTranslationKey($value)
            && Lang::has((string) $value, 'en', false)) {
            return $value;
        }
        if ($translationKey === null || $value === null) {
            return null;
        }

        if (self::isPresetTranslationKey($value)) {
            return $value === $translationKey ? $translationKey : null;
        }

        $legacyEnglish = Lang::get($translationKey, [], 'en', false);

        return is_string($legacyEnglish) && $value === $legacyEnglish
            ? $translationKey
            : null;
    }

    /**
     * Resolve an option field using its preset identity, while preserving
     * broker-authored text verbatim.
     *
     * @param 'label'|'description' $field
     */
    public static function localizeOptionText(
        ?string $presetSource,
        ?string $optionKey,
        string $field,
        ?string $value,
    ): ?string {
        $translationKey = self::managedPresetTranslationKey(
            $presetSource,
            $optionKey,
            $field,
            $value,
        );

        return $translationKey !== null
            ? self::localizePresetText($translationKey)
            : $value;
    }

    /** @param 'label'|'description' $field */
    public function managedTranslationKeyFor(string $field): ?string
    {
        return self::managedPresetTranslationKey(
            $this->getRawOriginal('preset_source'),
            $this->getRawOriginal('option_key'),
            $field,
            $this->getRawOriginal($field),
        );
    }

    /** @param 'label'|'description' $field */
    public function localizedField(string $field): ?string
    {
        return self::localizeOptionText(
            $this->getRawOriginal('preset_source'),
            $this->getRawOriginal('option_key'),
            $field,
            $this->getRawOriginal($field),
        );
    }

    /** @return array<string, mixed> */
    public function toLocalizedArray(): array
    {
        $data = $this->toArray();
        $data['label'] = $this->localizedField('label');
        $data['description'] = $this->localizedField('description');

        return $data;
    }
}
