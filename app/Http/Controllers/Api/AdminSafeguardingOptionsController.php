<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\TenantSafeguardingOption;
use App\Services\SafeguardingJurisdictionService;
use App\Services\SafeguardingPreferenceService;
use Illuminate\Http\JsonResponse;

/**
 * Admin CRUD for tenant safeguarding options.
 *
 * These are the checkboxes/options shown to members during onboarding
 * and in their settings. Admins configure them per tenant, optionally
 * starting from a country preset.
 *
 * GET    /v2/admin/safeguarding/options          — List all options (incl. inactive)
 * POST   /v2/admin/safeguarding/options          — Create option
 * PUT    /v2/admin/safeguarding/options/{id}     — Update option
 * DELETE /v2/admin/safeguarding/options/{id}     — Deactivate option
 * PUT    /v2/admin/safeguarding/options/reorder  — Reorder options
 */
class AdminSafeguardingOptionsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly SafeguardingJurisdictionService $jurisdictions,
    ) {}

    /** GET /v2/admin/safeguarding/options */
    public function index(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        return $this->respondWithData(
            SafeguardingPreferenceService::getAllOptionsForTenant($tenantId)
        );
    }

    /** POST /v2/admin/safeguarding/options */
    public function store(): JsonResponse
    {
        $actorUserId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        $optionKey = trim($this->input('option_key', ''));
        $label = trim($this->input('label', ''));

        if (empty($optionKey)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.option_key_required'), 'option_key', 422);
        }

        if (empty($label)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.label_is_required'), 'label', 422);
        }

        // Sanitize option_key: lowercase, alphanumeric + underscores only
        $optionKey = preg_replace('/[^a-z0-9_]/', '_', strtolower($optionKey));

        $data = [
            'option_key' => $optionKey,
            'option_type' => $this->input('option_type', 'checkbox'),
            'label' => $label,
            'description' => $this->input('description'),
            'help_url' => $this->input('help_url'),
            'sort_order' => (int) $this->input('sort_order', 0),
            'is_active' => filter_var($this->input('is_active', true), FILTER_VALIDATE_BOOLEAN),
            'is_required' => filter_var($this->input('is_required', false), FILTER_VALIDATE_BOOLEAN),
            'select_options' => $this->input('select_options'),
            'triggers' => $this->input('triggers', []),
        ];

        // Validate option_type
        $allowedTypes = ['checkbox', 'info', 'select'];
        if (!in_array($data['option_type'], $allowedTypes, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_invalid_option_type'), 'option_type', 422);
        }

        // Validate triggers — whitelist keys and types to prevent arbitrary injection
        $allowedTriggerKeys = [
            'requires_vetted_interaction' => 'boolean',
            'requires_broker_approval'    => 'boolean',
            'restricts_messaging'         => 'boolean',
            'restricts_matching'          => 'boolean',
            'notify_admin_on_selection'   => 'boolean',
            'vetting_type_required'       => 'string_or_null',
        ];
        if (!empty($data['triggers'])) {
            if (!is_array($data['triggers'])) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_triggers_json_required'), 'triggers', 422);
            }
            foreach ($data['triggers'] as $key => $val) {
                if (!array_key_exists($key, $allowedTriggerKeys)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_trigger_key_invalid', ['key' => $key]), 'triggers', 422);
                }
                $expectedType = $allowedTriggerKeys[$key];
                if ($expectedType === 'boolean' && !is_bool($val)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_trigger_type_invalid', ['key' => $key]), 'triggers', 422);
                }
                if ($expectedType === 'string_or_null' && !is_null($val) && !is_string($val)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_trigger_type_invalid', ['key' => $key]), 'triggers', 422);
                }
            }
            // Strip any keys that somehow slipped past (belt and suspenders)
            $data['triggers'] = array_intersect_key($data['triggers'], $allowedTriggerKeys);

            $validatedTriggers = $this->validateTriggers($data['triggers']);
            if ($validatedTriggers instanceof JsonResponse) {
                return $validatedTriggers;
            }
            $data['triggers'] = $validatedTriggers;
        }

        // Validate select_options structure when option_type is 'select'
        if ($data['option_type'] === 'select') {
            $selectOptions = $data['select_options'];
            if (!is_array($selectOptions) || empty($selectOptions)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_select_options_required'), 'select_options', 422);
            }
            foreach ($selectOptions as $idx => $opt) {
                if (!is_array($opt) || !isset($opt['value']) || !isset($opt['label'])) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_select_option_invalid', ['idx' => $idx]), 'select_options', 422);
                }
            }
        }

        $existingCount = TenantSafeguardingOption::where('tenant_id', $tenantId)->count();
        if ($existingCount >= 50) {
            return $this->respondWithError('LIMIT_EXCEEDED', __('api.safeguarding_max_50_options'), null, 422);
        }

        try {
            $option = SafeguardingPreferenceService::createOption($tenantId, $data, $actorUserId);
            return $this->respondWithData($option->toArray(), null, 201);
        } catch (\Illuminate\Database\QueryException $e) {
            if (str_contains($e->getMessage(), 'Duplicate entry')) {
                return $this->respondWithError('DUPLICATE', __('api.safeguarding_duplicate_option_key', ['key' => $optionKey]), 'option_key', 409);
            }
            throw $e;
        }
    }

    /** PUT /v2/admin/safeguarding/options/{id} */
    public function update(int $id): JsonResponse
    {
        $actorUserId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        $option = TenantSafeguardingOption::where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();

        if (!$option) {
            return $this->respondWithError('NOT_FOUND', __('api.safeguarding_option_not_found'), null, 404);
        }

        $data = $this->getAllInput();
        unset($data['id'], $data['tenant_id'], $data['option_key']); // Immutable fields

        if (empty($data)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_updateable_fields'), null, 422);
        }

        if (array_key_exists('label', $data) && trim((string) $data['label']) === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.label_is_required'), 'label', 422);
        }

        if (array_key_exists('option_type', $data) && !in_array($data['option_type'], ['checkbox', 'info', 'select'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_invalid_option_type'), 'option_type', 422);
        }

        if (array_key_exists('triggers', $data)) {
            if (!is_array($data['triggers'])) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_triggers_json_required'), 'triggers', 422);
            }

            $validatedTriggers = $this->validateTriggers($data['triggers']);
            if ($validatedTriggers instanceof JsonResponse) {
                return $validatedTriggers;
            }
            $data['triggers'] = $validatedTriggers;
        }

        if (array_key_exists('select_options', $data) && $data['select_options'] !== null) {
            $selectOptionsError = $this->validateSelectOptions($data['select_options']);
            if ($selectOptionsError instanceof JsonResponse) {
                return $selectOptionsError;
            }
        }

        $finalOptionType = $data['option_type'] ?? $option->option_type;
        $finalSelectOptions = array_key_exists('select_options', $data)
            ? $data['select_options']
            : $option->select_options;

        if ($finalOptionType === 'select') {
            $selectOptionsError = $this->validateSelectOptions($finalSelectOptions);
            if ($selectOptionsError instanceof JsonResponse) {
                return $selectOptionsError;
            }
        }

        foreach (['is_active', 'is_required'] as $booleanField) {
            if (array_key_exists($booleanField, $data)) {
                $data[$booleanField] = filter_var($data[$booleanField], FILTER_VALIDATE_BOOLEAN);
            }
        }
        if (array_key_exists('sort_order', $data)) {
            $data['sort_order'] = (int) $data['sort_order'];
        }

        try {
            $success = SafeguardingPreferenceService::updateOption($id, $data, $actorUserId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (!$success) {
            return $this->respondWithError('NOT_FOUND', __('api.safeguarding_option_not_found'), null, 404);
        }

        return $this->respondWithData(['message' => __('api_controllers_1.admin_safeguarding_options.option_updated')]);
    }

    /** DELETE /v2/admin/safeguarding/options/{id} */
    public function destroy(int $id): JsonResponse
    {
        $actorUserId = $this->requireBrokerOrAdmin();

        try {
            $success = SafeguardingPreferenceService::deleteOption($id, $actorUserId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (!$success) {
            return $this->respondWithError('NOT_FOUND', __('api.safeguarding_option_not_found'), null, 404);
        }

        return $this->respondWithData(['message' => __('api_controllers_1.admin_safeguarding_options.option_deactivated')]);
    }

    /** PUT /v2/admin/safeguarding/options/reorder */
    public function reorder(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        $order = $this->input('order', []);
        if (empty($order) || !is_array($order)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_order_required'), 'order', 422);
        }

        // Validate all option IDs belong to current tenant
        $submittedIds = array_map('intval', array_keys($order));
        $validCount = \App\Models\TenantSafeguardingOption::where('tenant_id', $tenantId)
            ->whereIn('id', $submittedIds)
            ->count();

        if ($validCount !== count($submittedIds)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_invalid_option_ids'), 'order', 422);
        }

        SafeguardingPreferenceService::reorderOptions($tenantId, $order);

        return $this->respondWithData(['message' => __('api_controllers_1.admin_safeguarding_options.options_reordered')]);
    }

    private function validateTriggers(array $triggers): array|JsonResponse
    {
        $allowedTriggerKeys = [
            'requires_vetted_interaction' => 'boolean',
            'requires_broker_approval'    => 'boolean',
            'restricts_messaging'         => 'boolean',
            'restricts_matching'          => 'boolean',
            'notify_admin_on_selection'   => 'boolean',
            'vetting_type_required'       => 'string_or_null',
        ];

        foreach ($triggers as $key => $value) {
            if (!array_key_exists($key, $allowedTriggerKeys)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_trigger_key_invalid', ['key' => $key]), 'triggers', 422);
            }

            $expectedType = $allowedTriggerKeys[$key];
            if ($expectedType === 'boolean' && !is_bool($value)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_trigger_type_invalid', ['key' => $key]), 'triggers', 422);
            }
            if ($expectedType === 'string_or_null' && $value !== null && !is_string($value)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_trigger_type_invalid', ['key' => $key]), 'triggers', 422);
            }
        }

        $attestationCode = $triggers['vetting_type_required'] ?? null;
        if (is_string($attestationCode) && $attestationCode !== ''
            && ! SafeguardingJurisdictionService::isSupportedAttestationCode($attestationCode)) {
            return $this->respondWithError(
                'INVALID_VETTING_REQUIREMENT',
                __('api.safeguarding_vetting_requirement_invalid'),
                'triggers.vetting_type_required',
                422,
            );
        }

        if (! empty($triggers['requires_vetted_interaction'])) {
            if (! is_string($attestationCode) || $attestationCode === '') {
                return $this->respondWithError(
                    'VETTING_REQUIREMENT_REQUIRED',
                    __('api.safeguarding_vetting_requirement_required'),
                    'triggers.vetting_type_required',
                    422,
                );
            }

            $policy = $this->jurisdictions->getPolicy(TenantContext::getId());
            if (! $policy['configured']
                || ! $policy['contact_policy_available']
                || $policy['attestation_code'] !== $attestationCode) {
                return $this->respondWithError(
                    'VETTING_REQUIREMENT_POLICY_MISMATCH',
                    __('api.safeguarding_vetting_requirement_policy_mismatch'),
                    'triggers.vetting_type_required',
                    422,
                );
            }
        }

        return array_intersect_key($triggers, $allowedTriggerKeys);
    }

    private function validateSelectOptions(mixed $selectOptions): ?JsonResponse
    {
        if (!is_array($selectOptions) || empty($selectOptions)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_select_options_required'), 'select_options', 422);
        }

        foreach ($selectOptions as $idx => $opt) {
            if (!is_array($opt) || !isset($opt['value']) || !isset($opt['label'])) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.safeguarding_select_option_invalid', ['idx' => $idx]), 'select_options', 422);
            }
        }

        return null;
    }
}
