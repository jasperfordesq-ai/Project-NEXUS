<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Models\TenantSafeguardingOption;
use App\Models\Notification;
use App\Models\UserSafeguardingPreference;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * CRUD for tenant safeguarding options and member preferences.
 *
 * All access to member preferences is audit-logged. This service also handles
 * country preset application and integrates with SafeguardingTriggerService
 * to activate broker protections when preferences are saved.
 */
class SafeguardingPreferenceService
{
    /** @var list<string> */
    private const PROTECTIVE_TRIGGER_KEYS = [
        'requires_vetted_interaction',
        'requires_broker_approval',
        'restricts_messaging',
        'restricts_matching',
    ];

    // =========================================================================
    // Tenant Safeguarding Options (Admin CRUD)
    // =========================================================================

    /**
     * Get all active safeguarding options for a tenant, ordered by sort_order.
     */
    public static function getOptionsForTenant(?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        return TenantSafeguardingOption::where('tenant_id', $tenantId)
            ->active()
            ->get()
            ->map(fn (TenantSafeguardingOption $opt) => $opt->toLocalizedArray())
            ->all();
    }

    /**
     * Get ALL options for a tenant (including inactive), for admin management.
     */
    public static function getAllOptionsForTenant(?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        return TenantSafeguardingOption::where('tenant_id', $tenantId)
            ->orderBy('sort_order')
            ->get()
            ->map(fn (TenantSafeguardingOption $opt) => $opt->toLocalizedArray())
            ->all();
    }

    /**
     * Create a new safeguarding option for a tenant.
     */
    public static function createOption(int $tenantId, array $data): TenantSafeguardingOption
    {
        $data['label'] = strip_tags(trim($data['label']));
        if (isset($data['description'])) {
            $data['description'] = strip_tags(trim($data['description']));
        }

        $option = TenantSafeguardingOption::create([
            'tenant_id' => $tenantId,
            'option_key' => $data['option_key'],
            'option_type' => $data['option_type'] ?? 'checkbox',
            'label' => $data['label'],
            'description' => $data['description'] ?? null,
            'help_url' => self::validateUrl($data['help_url'] ?? null),
            'sort_order' => $data['sort_order'] ?? 0,
            'is_active' => $data['is_active'] ?? true,
            'is_required' => $data['is_required'] ?? false,
            'select_options' => $data['select_options'] ?? null,
            'triggers' => $data['triggers'] ?? [],
            'preset_source' => $data['preset_source'] ?? null,
        ]);

        self::logActivity(null, 'safeguarding_option_created', 'safeguarding_option', $option->id, [
            'option_key' => $option->option_key,
            'label' => $option->label,
        ]);

        return $option;
    }

    /**
     * Update an existing safeguarding option.
     */
    public static function updateOption(int $optionId, array $data): bool
    {
        $tenantId = TenantContext::getId();
        $result = DB::transaction(function () use ($optionId, $data, $tenantId): ?array {
            $option = TenantSafeguardingOption::withoutGlobalScopes()
                ->where('id', $optionId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if (!$option) {
                return null;
            }

            $fillable = ['label', 'description', 'help_url', 'sort_order', 'is_active', 'is_required', 'option_type', 'select_options', 'triggers'];
            $updates = array_intersect_key($data, array_flip($fillable));
            if (isset($updates['label'])) {
                $label = strip_tags(trim($updates['label']));
                $managedKey = $option->managedTranslationKeyFor('label');
                $updates['label'] = $managedKey !== null
                    && $label === TenantSafeguardingOption::localizePresetText($managedKey)
                    ? $managedKey
                    : $label;
            }
            if (isset($updates['description'])) {
                $description = strip_tags(trim($updates['description']));
                $managedKey = $option->managedTranslationKeyFor('description');
                $updates['description'] = $managedKey !== null
                    && $description === TenantSafeguardingOption::localizePresetText($managedKey)
                    ? $managedKey
                    : $description;
            }
            if (array_key_exists('help_url', $updates)) {
                $updates['help_url'] = self::validateUrl($updates['help_url']);
            }

            $activeSelectionUserIds = self::activeSelectionUserIds(
                $tenantId,
                $optionId,
                $option->option_type,
                true,
            );
            if ($activeSelectionUserIds !== [] && self::mutationWeakensProtection($option, $updates)) {
                throw new SafeguardingPolicyException(
                    'SAFEGUARDING_POLICY_UNAVAILABLE',
                    __('api.safeguarding_policy_unavailable'),
                );
            }

            $option->update($updates);

            return [
                'option' => $option,
                'affected_user_ids' => array_key_exists('is_active', $updates) || array_key_exists('triggers', $updates)
                    ? $activeSelectionUserIds
                    : [],
                'changes' => array_keys($updates),
            ];
        });
        if ($result === null) {
            return false;
        }

        /** @var TenantSafeguardingOption $option */
        $option = $result['option'];
        foreach ($result['affected_user_ids'] as $userId) {
            // Full re-evaluation: invalidates cache, re-merges triggers and
            // updates enforcement state. This is not a fresh member selection,
            // so it must not replay the onboarding safeguarding alert.
            SafeguardingTriggerService::activateTriggersForUser((int) $userId, $tenantId);
        }

        self::logActivity(null, 'safeguarding_option_updated', 'safeguarding_option', $optionId, [
            'option_key' => $option->option_key,
            'changes' => $result['changes'],
        ]);

        return true;
    }

    /**
     * Soft-delete (deactivate) a safeguarding option. Keeps data for audit trail.
     */
    public static function deleteOption(int $optionId): bool
    {
        $tenantId = TenantContext::getId();
        $result = DB::transaction(function () use ($optionId, $tenantId): ?array {
            $option = TenantSafeguardingOption::withoutGlobalScopes()
                ->where('id', $optionId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if (!$option) {
                return null;
            }

            $affectedUserIds = self::activeSelectionUserIds(
                $tenantId,
                $optionId,
                $option->option_type,
                true,
            );
            if ($affectedUserIds !== [] && self::hasProtectiveTriggers($option->triggers ?? [])) {
                throw new SafeguardingPolicyException(
                    'SAFEGUARDING_POLICY_UNAVAILABLE',
                    __('api.safeguarding_policy_unavailable'),
                );
            }

            $option->update(['is_active' => false]);

            // Legacy auto-revocation runs only for non-protective options; the
            // guard above prevents administrators revoking live protections.
            UserSafeguardingPreference::where('option_id', $optionId)
                ->where('tenant_id', $tenantId)
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);

            return [
                'option' => $option,
                'affected_user_ids' => $affectedUserIds,
            ];
        });
        if ($result === null) {
            return false;
        }

        /** @var TenantSafeguardingOption $option */
        $option = $result['option'];
        $affectedUserIds = $result['affected_user_ids'];

        // Re-evaluate triggers for affected users — deactivating an option may
        // remove monitoring/broker-approval requirements if it was the only trigger.
        // Wrapped in try/catch so a single user re-eval failure doesn't kill the whole request.
        foreach ($affectedUserIds as $userId) {
            try {
                SafeguardingTriggerService::activateTriggersForUser((int) $userId, $tenantId);
            } catch (\Throwable $e) {
                Log::error('SafeguardingPreferenceService::deleteOption: trigger re-eval failed', [
                    'user_id'   => $userId,
                    'option_id' => $optionId,
                    'error'     => $e->getMessage(),
                ]);
            }
        }

        self::logActivity(null, 'safeguarding_option_deleted', 'safeguarding_option', $optionId, [
            'option_key'    => $option->option_key,
            'auto_revoked'  => count($affectedUserIds),
        ]);

        return true;
    }

    /** @return list<int> */
    private static function activeSelectionUserIds(
        int $tenantId,
        int $optionId,
        ?string $optionType,
        bool $lock,
    ): array {
        $query = UserSafeguardingPreference::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('option_id', $optionId)
            ->whereNull('revoked_at')
            ->orderBy('id');
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->get(['user_id', 'selected_value'])
            ->filter(static fn (UserSafeguardingPreference $preference): bool =>
                UserSafeguardingPreference::isEffectivelySelected(
                    $optionType,
                    $preference->selected_value,
                ))
            ->pluck('user_id')
            ->map(static fn ($id): int => (int) $id)
            ->unique()
            ->values()
            ->all();
    }

    /** @param array<string, mixed> $updates */
    private static function mutationWeakensProtection(
        TenantSafeguardingOption $option,
        array $updates,
    ): bool {
        $currentTriggers = is_array($option->triggers) ? $option->triggers : [];
        if (! self::hasProtectiveTriggers($currentTriggers)) {
            return false;
        }

        if (array_key_exists('is_active', $updates)
            && ! filter_var($updates['is_active'], FILTER_VALIDATE_BOOLEAN)) {
            return true;
        }
        if (! array_key_exists('triggers', $updates)) {
            return false;
        }

        $nextTriggers = is_array($updates['triggers']) ? $updates['triggers'] : [];
        foreach (self::PROTECTIVE_TRIGGER_KEYS as $key) {
            if (! empty($currentTriggers[$key]) && empty($nextTriggers[$key])) {
                return true;
            }
        }

        if (! empty($currentTriggers['requires_vetted_interaction'])) {
            $currentCode = $currentTriggers['vetting_type_required'] ?? null;
            $nextCode = $nextTriggers['vetting_type_required'] ?? null;
            if ($currentCode !== $nextCode) {
                return true;
            }
        }

        return false;
    }

    /** @param array<string, mixed> $triggers */
    private static function hasProtectiveTriggers(array $triggers): bool
    {
        foreach (self::PROTECTIVE_TRIGGER_KEYS as $key) {
            if (! empty($triggers[$key])) {
                return true;
            }
        }

        return false;
    }

    /**
     * Reorder options for a tenant.
     *
     * @param array $order Array of [id => sort_order]
     */
    public static function reorderOptions(int $tenantId, array $order): void
    {
        foreach ($order as $optionId => $sortOrder) {
            TenantSafeguardingOption::where('id', (int) $optionId)
                ->where('tenant_id', $tenantId)
                ->update(['sort_order' => (int) $sortOrder]);
        }
    }

    // =========================================================================
    // Country Preset Application
    // =========================================================================

    /**
     * Apply a country preset as an explicit replacement operation.
     *
     * Existing rows with the same stable option key are updated in place so
     * member preferences cannot display one jurisdiction while enforcing
     * another. Preset-owned rows absent from the new preset are deactivated.
     *
     * @return array List of option keys that were newly created.
     */
    public static function applyCountryPreset(int $tenantId, string $presetKey): array
    {
        return self::replaceCountryPreset($tenantId, $presetKey)['created'];
    }

    /**
     * @return array{created: list<string>, updated: list<string>, deactivated: list<string>, preserved: list<string>, review_required_count: int}
     */
    public static function replaceCountryPreset(
        int $tenantId,
        string $presetKey,
        bool $requireMemberReview = false,
    ): array
    {
        $presets = config('safeguarding_presets', []);
        $preset = $presets[$presetKey] ?? null;

        if (!$preset || empty($preset['options'])) {
            return ['created' => [], 'updated' => [], 'deactivated' => [], 'preserved' => [], 'review_required_count' => 0];
        }

        $created = [];
        $updated = [];
        $deactivated = [];
        $preserved = [];
        $affectedUserIds = DB::table('user_safeguarding_preferences')
            ->where('tenant_id', $tenantId)
            ->whereNull('revoked_at')
            ->distinct()
            ->pluck('user_id')
            ->map(static fn ($userId): int => (int) $userId)
            ->all();
        $reviewSelections = $requireMemberReview
            ? DB::table('user_safeguarding_preferences as p')
                ->join('tenant_safeguarding_options as o', 'o.id', '=', 'p.option_id')
                ->where('p.tenant_id', $tenantId)
                ->whereNull('p.revoked_at')
                ->whereNotNull('o.preset_source')
                ->get(['p.id', 'p.user_id', 'p.selected_value', 'o.option_type'])
                ->filter(static fn (object $preference): bool =>
                    UserSafeguardingPreference::isEffectivelySelected(
                        $preference->option_type ?? null,
                        $preference->selected_value ?? null,
                    ))
                ->values()
            : collect();
        $reviewUserIds = $reviewSelections
            ->pluck('user_id')
            ->map(static fn ($userId): int => (int) $userId)
            ->unique()
            ->values()
            ->all();
        $reviewPreferenceIds = $reviewSelections
            ->pluck('id')
            ->map(static fn ($id): int => (int) $id)
            ->values()
            ->all();

        DB::transaction(function () use (
            $tenantId,
            $presetKey,
            $preset,
            &$created,
            &$updated,
            &$deactivated,
            &$preserved,
        ): void {
            $newKeys = array_values(array_map(
                static fn (array $option): string => (string) $option['option_key'],
                $preset['options'],
            ));

            $stale = TenantSafeguardingOption::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereNotNull('preset_source')
                ->whereNotIn('option_key', $newKeys)
                ->where('is_active', true)
                ->lockForUpdate()
                ->get();

            foreach ($stale as $option) {
                $activeSelectionUserIds = self::activeSelectionUserIds(
                    $tenantId,
                    (int) $option->id,
                    $option->option_type,
                    true,
                );
                if ($activeSelectionUserIds !== [] && self::hasProtectiveTriggers($option->triggers ?? [])) {
                    $preserved[] = (string) $option->option_key;
                    continue;
                }

                $option->update(['is_active' => false]);
                UserSafeguardingPreference::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->where('option_id', $option->id)
                    ->whereNull('revoked_at')
                    ->update(['revoked_at' => now()]);
                $deactivated[] = (string) $option->option_key;
            }

            $sortOrder = 0;
            foreach ($preset['options'] as $optionData) {
                $sortOrder += 10;
                $optionKey = (string) $optionData['option_key'];
                $existing = TenantSafeguardingOption::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->where('option_key', $optionKey)
                    ->lockForUpdate()
                    ->first();

                $values = [
                    'option_type' => $optionData['option_type'] ?? 'checkbox',
                    'label' => $optionData['label'],
                    'description' => $optionData['description'] ?? null,
                    'help_url' => $optionData['help_url'] ?? null,
                    'sort_order' => $sortOrder,
                    'is_active' => true,
                    'is_required' => false,
                    'select_options' => $optionData['select_options'] ?? null,
                    'triggers' => $optionData['triggers'] ?? [],
                    'preset_source' => $presetKey,
                ];

                if ($existing === null) {
                    TenantSafeguardingOption::withoutGlobalScopes()->create(array_merge($values, [
                        'tenant_id' => $tenantId,
                        'option_key' => $optionKey,
                    ]));
                    $created[] = $optionKey;
                } else {
                    $existing->update($values);
                    $updated[] = $optionKey;
                }
            }
        });

        foreach ($affectedUserIds as $userId) {
            SafeguardingTriggerService::activateTriggersForUser((int) $userId, $tenantId);
        }

        if ($reviewUserIds !== [] && Schema::hasColumn('user_safeguarding_preferences', 'policy_review_required_at')) {
            DB::table('user_safeguarding_preferences')
                ->where('tenant_id', $tenantId)
                ->whereIn('id', $reviewPreferenceIds)
                ->whereNull('revoked_at')
                ->update([
                    'policy_review_required_at' => now(),
                    'policy_review_reason_code' => 'jurisdiction_changed',
                ]);
            self::notifyJurisdictionReviewRequired($tenantId, $reviewUserIds);
        }

        self::logActivity(null, 'safeguarding_preset_applied', 'tenant', $tenantId, [
            'preset' => $presetKey,
            'options_created' => $created,
            'options_updated' => $updated,
            'options_deactivated' => $deactivated,
            'options_preserved' => $preserved,
            'review_required_count' => count($reviewUserIds),
        ]);

        return [
            'created' => $created,
            'updated' => $updated,
            'deactivated' => $deactivated,
            'preserved' => $preserved,
            'review_required_count' => count($reviewUserIds),
        ];
    }

    /**
     * Move preset options into a fail-closed custom/unconfigured policy state.
     *
     * Unselected preset options can be retired immediately. An option with a
     * live member selection must remain active, however: deactivating it (or
     * revoking the preference on the member's behalf) would remove its trigger
     * and silently make that member contactable. Preserved selections remain
     * visible/revocable to the member and are marked for policy review while
     * the unavailable tenant policy keeps protected interactions closed.
     *
     * @return array{deactivated: list<string>, preserved: list<string>, review_required_count: int}
     */
    public static function preservePresetProtectionsForUnavailablePolicy(
        int $tenantId,
        ?int $actorUserId = null,
    ): array {
        $transition = DB::transaction(function () use ($tenantId): array {
            $options = TenantSafeguardingOption::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereNotNull('preset_source')
                ->where('is_active', true)
                ->lockForUpdate()
                ->get(['id', 'option_key', 'option_type']);
            if ($options->isEmpty()) {
                return [
                    'deactivated' => [],
                    'preserved' => [],
                    'review_user_ids' => [],
                ];
            }

            $optionIds = $options->pluck('id')->map(static fn ($id): int => (int) $id)->all();
            $optionTypes = $options->mapWithKeys(
                static fn (TenantSafeguardingOption $option): array => [
                    (int) $option->id => $option->option_type,
                ],
            );
            $activePreferences = UserSafeguardingPreference::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereIn('option_id', $optionIds)
                ->whereNull('revoked_at')
                ->lockForUpdate()
                ->get(['id', 'user_id', 'option_id', 'selected_value']);
            $selectedPreferences = $activePreferences
                ->filter(static fn (UserSafeguardingPreference $preference): bool =>
                    UserSafeguardingPreference::isEffectivelySelected(
                        $optionTypes->get((int) $preference->option_id),
                        $preference->selected_value,
                    ))
                ->values();
            $selectedOptionIds = $selectedPreferences
                ->pluck('option_id')
                ->map(static fn ($id): int => (int) $id)
                ->unique()
                ->values()
                ->all();

            $preservedOptions = $options->filter(
                static fn (TenantSafeguardingOption $option): bool => in_array((int) $option->id, $selectedOptionIds, true),
            );
            $deactivatedOptions = $options->reject(
                static fn (TenantSafeguardingOption $option): bool => in_array((int) $option->id, $selectedOptionIds, true),
            );
            $deactivatedIds = $deactivatedOptions
                ->pluck('id')
                ->map(static fn ($id): int => (int) $id)
                ->all();

            if ($deactivatedIds !== []) {
                TenantSafeguardingOption::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereIn('id', $deactivatedIds)
                    ->update(['is_active' => false]);
            }

            $reviewUserIds = $selectedPreferences
                ->pluck('user_id')
                ->map(static fn ($id): int => (int) $id)
                ->unique()
                ->values()
                ->all();
            if ($reviewUserIds !== []
                && Schema::hasColumn('user_safeguarding_preferences', 'policy_review_required_at')) {
                $selectedPreferenceIds = $selectedPreferences
                    ->pluck('id')
                    ->map(static fn ($id): int => (int) $id)
                    ->all();
                UserSafeguardingPreference::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereIn('id', $selectedPreferenceIds)
                    ->whereNull('revoked_at')
                    ->update([
                        'policy_review_required_at' => now(),
                        'policy_review_reason_code' => 'jurisdiction_changed',
                    ]);
            }

            return [
                'deactivated' => $deactivatedOptions
                    ->pluck('option_key')
                    ->map(static fn ($key): string => (string) $key)
                    ->values()
                    ->all(),
                'preserved' => $preservedOptions
                    ->pluck('option_key')
                    ->map(static fn ($key): string => (string) $key)
                    ->values()
                    ->all(),
                'review_user_ids' => $reviewUserIds,
            ];
        });

        $reviewUserIds = $transition['review_user_ids'];
        if ($reviewUserIds !== []) {
            self::notifyJurisdictionReviewRequired($tenantId, $reviewUserIds);
        }

        self::logActivity($actorUserId, 'safeguarding_preset_transition_fail_closed', 'tenant', $tenantId, [
            'options_deactivated' => $transition['deactivated'],
            'options_preserved' => $transition['preserved'],
            'preferences_revoked' => 0,
            'review_required_count' => count($reviewUserIds),
        ]);

        return [
            'deactivated' => $transition['deactivated'],
            'preserved' => $transition['preserved'],
            'review_required_count' => count($reviewUserIds),
        ];
    }

    /**
     * Get available country presets (for admin UI dropdown).
     */
    public static function getAvailablePresets(): array
    {
        $presets = config('safeguarding_presets', []);
        $result = [];

        foreach ($presets as $key => $preset) {
            $result[] = [
                'key' => $key,
                'name' => TenantSafeguardingOption::localizePresetText($preset['name'] ?? $key),
                'vetting_authority' => TenantSafeguardingOption::localizePresetText($preset['vetting_authority'] ?? null) ?? '',
                'help_text' => TenantSafeguardingOption::localizePresetText($preset['help_text'] ?? null) ?? '',
                'option_count' => count($preset['options'] ?? []),
            ];
        }

        return $result;
    }

    // =========================================================================
    // User Safeguarding Preferences (Member CRUD)
    // =========================================================================

    /**
     * Get a user's safeguarding preferences. ALWAYS audit-logged.
     *
     * @param int $accessorId Who is reading this data
     * @param string $accessorRole admin, broker, or member
     * @param string $context Why the data is being accessed (e.g., 'onboarding_review', 'broker_dashboard')
     */
    public static function getUserPreferences(
        int $tenantId,
        int $userId,
        int $accessorId,
        string $accessorRole,
        string $context = 'api_request'
    ): array {
        // Audit log every read
        self::logActivity($accessorId, 'safeguarding_preferences_viewed', 'user', $userId, [
            'accessor_role' => $accessorRole,
            'context' => $context,
        ]);

        return UserSafeguardingPreference::where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->active()
            ->with('option')
            ->get()
            ->filter(static fn (UserSafeguardingPreference $preference): bool =>
                $preference->option instanceof TenantSafeguardingOption
                && UserSafeguardingPreference::isEffectivelySelected(
                    $preference->option->option_type,
                    $preference->selected_value,
                ))
            ->values()
            ->map(fn ($pref) => [
                'id' => $pref->id,
                'option_id' => $pref->option_id,
                'option_key' => $pref->option?->option_key,
                'option_label' => $pref->option?->localizedField('label'),
                'selected_value' => $pref->selected_value,
                'notes' => $pref->notes,
                'consent_given_at' => $pref->consent_given_at?->toISOString(),
            ])
            ->all();
    }

    /**
     * Save a user's safeguarding preferences from onboarding.
     * Records GDPR consent per option. Triggers broker protections.
     *
     * @param array $preferences Array of [{option_id, value, notes?}]
     * @param string|null $ipAddress User's IP for consent record
     */
    public static function saveUserPreferences(
        int $userId,
        array $preferences,
        ?string $ipAddress = null
    ): void {
        $tenantId = TenantContext::getId();
        $now = now();
        $preferences = self::validatePreferencePayload($tenantId, $preferences);

        // Server-side mutual exclusivity: if none_apply is submitted alongside
        // real option selections, real options win (they activate protections;
        // none_apply cancels them). Strips none_apply silently so a direct API
        // call cannot simultaneously decline and self-identify as needing support.
        $submittedIds = array_values(array_unique(array_map(
            static fn (array $preference): int => (int) ($preference['option_id'] ?? 0),
            array_filter(
                $preferences,
                static fn (array $preference): bool => UserSafeguardingPreference::isEffectivelySelected(
                    $preference['option_type'] ?? null,
                    $preference['value'] ?? null,
                ),
            ),
        )));
        $submittedIds = array_filter($submittedIds);
        if (!empty($submittedIds)) {
            $noneApplyIds = DB::table('tenant_safeguarding_options')
                ->where('tenant_id', $tenantId)
                ->where('option_key', 'none_apply')
                ->whereIn('id', array_values($submittedIds))
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->toArray();

            if (!empty($noneApplyIds) && count($submittedIds) > count($noneApplyIds)) {
                $preferences = array_values(array_filter(
                    $preferences,
                    fn ($p) => !in_array((int) ($p['option_id'] ?? 0), $noneApplyIds, true)
                ));
            }
        }

        DB::beginTransaction();
        try {
            // Preference activation/reactivation shares the same guaranteed
            // tenant policy mutex and lock order as the definitive message
            // check. A new active row therefore linearizes wholly before or
            // after a message write; it cannot phantom past the final decision.
            app(SafeguardingJurisdictionService::class)->lockPolicyForUpdate($tenantId);

            $optionIds = array_values(array_unique(array_filter(array_map(
                static fn (array $preference): int => (int) ($preference['option_id'] ?? 0),
                $preferences,
            ), static fn (int $optionId): bool => $optionId > 0)));

            $existingPreferences = UserSafeguardingPreference::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->whereIn('option_id', $optionIds)
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('option_id');

            $lockedOptions = TenantSafeguardingOption::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereIn('id', $optionIds)
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            foreach ($preferences as $pref) {
                $optionId = (int) ($pref['option_id'] ?? 0);
                $notes = $pref['notes'] ?? null;

                if ($optionId <= 0) {
                    continue;
                }

                // Revalidate from the locked tenant-scoped option state. An
                // option retired after the preflight validation must fail the
                // save rather than partially activating stale preferences.
                $option = $lockedOptions->get($optionId);
                if (! $option instanceof TenantSafeguardingOption || ! $option->is_active) {
                    throw new \InvalidArgumentException(__('api.safeguarding_preference_option_invalid'));
                }

                $value = UserSafeguardingPreference::normalizeSelectedValue(
                    $option->option_type,
                    $pref['value'] ?? null,
                );

                // For select-type options, validate submitted value against allowlist
                if ($option->option_type === 'select') {
                    $allowedValues = self::allowedSelectValues($option);
                    if (!empty($allowedValues) && !in_array($value, $allowedValues, true)) {
                        throw new \InvalidArgumentException(__('api.safeguarding_select_value_invalid'));
                    }
                }

                $values = [
                    'selected_value' => $value,
                    'notes' => $notes,
                    'consent_given_at' => $now,
                    'consent_ip' => $ipAddress,
                    'revoked_at' => null, // Re-consent clears any previous revocation
                    'policy_review_required_at' => null,
                    'policy_review_reason_code' => null,
                ];
                $existing = $existingPreferences->get($optionId);
                if ($existing instanceof UserSafeguardingPreference) {
                    $existing->update($values);
                } else {
                    $created = UserSafeguardingPreference::withoutGlobalScopes()->create(array_merge(
                        [
                        'tenant_id' => $tenantId,
                        'user_id' => $userId,
                        'option_id' => $optionId,
                        ],
                        $values,
                    ));
                    $existingPreferences->put($optionId, $created);
                }
            }

            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        // Audit log
        self::logActivity($userId, 'safeguarding_preferences_updated', 'user', $userId, [
            'options_count' => count($preferences),
        ]);

        // Activate broker protections based on triggers — wrapped in try/catch
        // because consent has already been committed. A trigger-activation failure
        // must not 500 the user-facing request; we log loudly so it can be retried
        // by a sweep job or admin tooling.
        try {
            SafeguardingTriggerService::activateTriggersForUser(
                $userId,
                $tenantId,
                notifyStaffOfMemberSelection: true,
            );
        } catch (\Throwable $e) {
            Log::error('SafeguardingPreferenceService: trigger activation failed after consent commit', [
                'user_id'   => $userId,
                'tenant_id' => $tenantId,
                'error'     => $e->getMessage(),
            ]);
        }
    }

    private static function validatePreferencePayload(int $tenantId, array $preferences): array
    {
        $activeOptions = TenantSafeguardingOption::where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->get()
            ->keyBy('id');

        $validated = [];
        $submittedValues = [];

        foreach ($preferences as $pref) {
            $optionId = (int) ($pref['option_id'] ?? 0);
            if ($optionId <= 0 || !$activeOptions->has($optionId)) {
                throw new \InvalidArgumentException(__('api.safeguarding_preference_option_invalid'));
            }

            /** @var TenantSafeguardingOption $option */
            $option = $activeOptions->get($optionId);
            $value = UserSafeguardingPreference::normalizeSelectedValue(
                $option->option_type,
                array_key_exists('value', $pref) ? $pref['value'] : '1',
            );

            if ($option->option_type === 'select') {
                $allowedValues = self::allowedSelectValues($option);
                if (!empty($allowedValues) && !in_array($value, $allowedValues, true)) {
                    throw new \InvalidArgumentException(__('api.safeguarding_select_value_invalid'));
                }
            }

            $validated[] = [
                'option_id' => $optionId,
                'option_type' => $option->option_type,
                'value' => $value,
                'notes' => $pref['notes'] ?? null,
            ];
            $submittedValues[$optionId] = $value;
        }

        foreach ($activeOptions as $option) {
            if (!$option->is_required || $option->option_type === 'info') {
                continue;
            }

            $value = $submittedValues[(int) $option->id] ?? null;
            $isMissing = $value === null || ! UserSafeguardingPreference::isEffectivelySelected(
                $option->option_type,
                $value,
            );

            if ($isMissing) {
                throw new \InvalidArgumentException(__('api.safeguarding_required_option_missing', [
                    'label' => $option->localizedField('label'),
                ]));
            }
        }

        return $validated;
    }

    private static function allowedSelectValues(TenantSafeguardingOption $option): array
    {
        $selectOptions = $option->select_options ?? [];
        if (is_string($selectOptions)) {
            $decoded = json_decode($selectOptions, true);
            $selectOptions = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($selectOptions)) {
            return [];
        }

        return array_values(array_filter(
            array_map(
                fn ($selectOption) => is_array($selectOption) && array_key_exists('value', $selectOption)
                    ? (string) $selectOption['value']
                    : null,
                $selectOptions
            ),
            fn ($value) => $value !== null && $value !== ''
        ));
    }

    /**
     * Revoke a specific preference (member withdraws consent).
     */
    public static function revokePreference(int $userId, int $optionId): bool
    {
        $tenantId = TenantContext::getId();

        $pref = UserSafeguardingPreference::where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('option_id', $optionId)
            ->whereNull('revoked_at')
            ->first();

        if (!$pref) {
            return false;
        }

        $optionLabel = $pref->option?->getRawOriginal('label') ?? "option #{$optionId}";
        $optionKey = $pref->option?->getRawOriginal('option_key');
        $presetSource = $pref->option?->getRawOriginal('preset_source');

        $pref->update(['revoked_at' => now()]);

        self::logActivity($userId, 'safeguarding_consent_revoked', 'user', $userId, [
            'option_id' => $optionId,
        ]);

        // Re-evaluate triggers (may deactivate protections)
        SafeguardingTriggerService::activateTriggersForUser($userId, $tenantId);

        // Bell admins/brokers — a member has withdrawn consent, protections
        // may have changed. Render per-staff so each admin sees the bell in
        // their own preferred_language (including the fallback_member_name
        // when the revoker has no usable display name).
        try {
            $revoker = \App\Models\User::find($userId);
            $hasName = $revoker
                && UserDisplayName::resolve($revoker) !== '';
            $legacyName = $revoker ? ($revoker->name ?? null) : null;

            $staffUsers = DB::select(
                "SELECT id, preferred_language FROM users WHERE tenant_id = ? AND role IN ('admin', 'tenant_admin', 'broker', 'super_admin') AND status = 'active'",
                [$tenantId]
            );

            foreach ($staffUsers as $staff) {
                LocaleContext::withLocale($staff, function () use ($staff, $tenantId, $userId, $optionLabel, $optionKey, $presetSource, $hasName, $revoker, $legacyName) {
                    $localizedOptionLabel = TenantSafeguardingOption::localizeOptionText(
                        $presetSource,
                        $optionKey,
                        'label',
                        $optionLabel,
                    );
                    if ($hasName) {
                        $revokerName = UserDisplayName::resolve($revoker);
                    } elseif (!empty($legacyName)) {
                        $revokerName = $legacyName;
                    } else {
                        // Revoker row missing or no display name — use the
                        // translated fallback, rendered in this staff member's
                        // preferred_language.
                        $revokerName = __('emails.common.fallback_member_name');
                    }

                    $bellMessage = __('emails_misc.safeguarding.consent_revoked_admin_bell', [
                        'name'   => $revokerName,
                        'option' => $localizedOptionLabel,
                    ]);

                    \App\Models\Notification::create([
                        'tenant_id' => $tenantId,
                        'user_id'   => $staff->id,
                        'type'      => 'safeguarding_flag',
                        'message'   => $bellMessage,
                        'link'      => "/broker/safeguarding?user={$userId}",
                        'is_read'   => false,
                    ]);
                });
            }
        } catch (\Throwable $notifErr) {
            Log::warning('SafeguardingPreferenceService::revokePreference: admin bell failed', [
                'user_id' => $userId,
                'error'   => $notifErr->getMessage(),
            ]);
        }

        return true;
    }

    // =========================================================================
    // Audit Logging
    // =========================================================================

    /** @param list<int> $userIds */
    private static function notifyJurisdictionReviewRequired(int $tenantId, array $userIds): void
    {
        try {
            $members = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->whereIn('id', $userIds)
                ->where('status', 'active')
                ->get(['id', 'preferred_language']);
            foreach ($members as $member) {
                LocaleContext::withLocale($member, function () use ($member, $tenantId): void {
                    $message = __('safeguarding.review.jurisdiction_changed_member');
                    Notification::createNotification(
                        (int) $member->id,
                        $message,
                        '/settings',
                        'safeguarding_policy_review',
                        true,
                        $tenantId,
                    );
                });
            }

            $staff = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->whereIn('role', ['admin', 'tenant_admin', 'broker', 'super_admin'])
                ->get(['id', 'preferred_language']);
            foreach ($staff as $recipient) {
                LocaleContext::withLocale($recipient, function () use ($recipient, $tenantId): void {
                    Notification::createNotification(
                        (int) $recipient->id,
                        __('safeguarding.review.jurisdiction_changed_staff'),
                        '/broker/safeguarding',
                        'safeguarding_policy_review',
                        true,
                        $tenantId,
                    );
                });
            }
        } catch (\Throwable $e) {
            Log::error('SafeguardingPreferenceService: jurisdiction review notification failed', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Validate a URL is well-formed HTTPS — reject javascript:, http:, and malformed URLs.
     * help_url is rendered as a clickable link to members, so non-HTTPS or
     * malformed URLs are rejected entirely rather than coerced.
     */
    private static function validateUrl(?string $url): ?string
    {
        if ($url === null || trim($url) === '') {
            return null;
        }
        $url = trim($url);
        if (!preg_match('#^https://#i', $url)) {
            return null;
        }
        if (filter_var($url, FILTER_VALIDATE_URL) === false) {
            return null;
        }
        $host = parse_url($url, PHP_URL_HOST);
        if (!$host || !preg_match('/\./', $host)) {
            return null; // require a real domain (no localhost, no bare hostnames)
        }
        return $url;
    }

    /**
     * Log safeguarding-related activity to the activity_log table.
     */
    private static function logActivity(
        ?int $userId,
        string $action,
        string $entityType,
        ?int $entityId,
        array $details = []
    ): void {
        try {
            DB::table('activity_log')->insert([
                'tenant_id' => TenantContext::getId(),
                'user_id' => $userId,
                'action' => $action,
                'action_type' => 'safeguarding',
                'entity_type' => $entityType,
                'entity_id' => $entityId,
                'details' => json_encode($details),
                'ip_address' => request()?->ip(),
                'user_agent' => request()?->userAgent(),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::error('SafeguardingPreferenceService: failed to log activity', [
                'action' => $action,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
