<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Requests\Volunteering;

use Illuminate\Foundation\Http\FormRequest;

class UpdateOpportunityRequest extends FormRequest
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
            'title' => ['sometimes', 'string', 'max:255'],
            'description' => ['sometimes', 'string'],
            'location' => ['sometimes', 'nullable', 'string', 'max:255'],
            'is_remote' => ['sometimes', 'boolean'],
            'latitude' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'],
            'skills_needed' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'start_date' => ['sometimes', 'nullable', 'date'],
            'end_date' => ['sometimes', 'nullable', 'date', 'after_or_equal:start_date'],
            'category_id' => ['sometimes', 'nullable', 'integer', 'exists:categories,id'],
            // Strict enum — MariaDB strict=false silently corrupts invalid enum writes to ''.
            // Closing stops new applications and takes it off the public list;
            // cancelling is DELETE. Anything else is refused.
            'status' => ['sometimes', 'in:open,closed'],
            'federated_visibility' => ['sometimes', 'nullable', 'in:none,listed'],
        ];
    }
}
