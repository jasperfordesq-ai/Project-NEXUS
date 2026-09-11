<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Requests\Volunteering;

use Illuminate\Foundation\Http\FormRequest;

class CreateOrganisationRequest extends FormRequest
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
            'name' => ['required', 'string', 'max:255'],
            'description' => ['required', 'string', 'min:20', 'max:5000'],
            'contact_email' => ['required', 'email', 'max:255'],
            // http/https only — the website renders as an <a href> on the PUBLIC
            // org page, so other schemes (javascript:, data:) are a link-injection
            // hole. Mirrors UpdateOrganisationRequest and the service-level check.
            'website' => ['nullable', 'url:http,https', 'max:500'],
            'idempotency_key' => ['nullable', 'string', 'min:8', 'max:191'],
        ];
    }
}
