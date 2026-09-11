<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Requests\Volunteering;

use App\Core\TenantContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\DB;

/**
 * Validates partial updates to a volunteer organisation.
 *
 * Mirrors CreateOrganisationRequest (and the service-level rules in
 * VolunteerService::createOrganization) with `sometimes` semantics so only
 * the provided fields are validated. The `website` rule is restricted to
 * http/https URLs because the value is rendered as an <a href> on the PUBLIC
 * organisation page — accepting other schemes (javascript:, data:, ...) is a
 * link-injection hole for unauthenticated visitors.
 */
class UpdateOrganisationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => [
                'sometimes',
                'required',
                'string',
                'min:3',
                'max:200',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    $duplicate = DB::selectOne(
                        "SELECT id FROM vol_organizations
                         WHERE tenant_id = ? AND LOWER(name) = LOWER(?) AND status != 'declined' AND id != ?",
                        [TenantContext::getId(), (string) $value, (int) $this->route('id')]
                    );
                    if ($duplicate) {
                        $fail(__('api.volunteer_org_name_exists'));
                    }
                },
            ],
            'description' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'contact_email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'website' => ['sometimes', 'nullable', 'url:http,https', 'max:500'],
        ];
    }
}
