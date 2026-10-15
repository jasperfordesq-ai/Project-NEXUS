<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Requests\Events;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

/** Shared bounded JSON contract for effective-dated recurrence revisions. */
abstract class EventRecurrenceRevisionFormRequest extends FormRequest
{
    public function authorize(): bool
    {
        // Persisted, tenant-scoped authorization is owned by the domain
        // service and EventPolicy after the concrete occurrence is resolved.
        return true;
    }

    /** @return array<string,mixed> */
    protected function patchRules(): array
    {
        return [
            'patch' => [
                'required',
                'array:title,description,location,latitude,longitude,max_attendees,is_online,online_link,video_url,allow_remote_attendance,category_id,all_day,accessibility_step_free,accessibility_toilet,accessibility_hearing_loop,accessibility_quiet_space,accessibility_seating,accessibility_parking,accessibility_parking_details,accessibility_transit_details,accessibility_assistance_contact,accessibility_notes,timezone,local_start_time,local_end_time,recurrence_rrule,recurrence_exdates,recurrence_rdates,group_id,series_id,poll_ids,image_url,cover_image,federated_visibility,is_public_listing',
                'min:1',
                'max:32',
            ],
            'patch.title' => ['sometimes', 'string', 'min:3', 'max:255'],
            'patch.description' => ['sometimes', 'string', 'max:10000'],
            'patch.location' => ['sometimes', 'nullable', 'string', 'max:255'],
            'patch.latitude' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'],
            'patch.longitude' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'],
            'patch.max_attendees' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'patch.is_online' => ['sometimes', 'boolean'],
            'patch.online_link' => ['sometimes', 'nullable', 'url:http,https', 'max:512'],
            'patch.video_url' => ['sometimes', 'nullable', 'url:http,https', 'max:512'],
            'patch.allow_remote_attendance' => ['sometimes', 'boolean'],
            'patch.is_public_listing' => ['sometimes', 'boolean'],
            'patch.category_id' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'patch.all_day' => ['sometimes', 'boolean'],
            'patch.accessibility_step_free' => ['sometimes', 'nullable', 'boolean'],
            'patch.accessibility_toilet' => ['sometimes', 'nullable', 'boolean'],
            'patch.accessibility_hearing_loop' => ['sometimes', 'nullable', 'boolean'],
            'patch.accessibility_quiet_space' => ['sometimes', 'nullable', 'boolean'],
            'patch.accessibility_seating' => ['sometimes', 'nullable', 'boolean'],
            'patch.accessibility_parking' => ['sometimes', 'nullable', 'boolean'],
            'patch.accessibility_parking_details' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'patch.accessibility_transit_details' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'patch.accessibility_assistance_contact' => ['sometimes', 'nullable', 'string', 'max:500'],
            'patch.accessibility_notes' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'patch.timezone' => ['sometimes', 'string', 'timezone:all', 'max:64'],
            'patch.local_start_time' => [
                'sometimes',
                'string',
                'regex:/^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$/',
            ],
            'patch.local_end_time' => [
                'sometimes',
                'nullable',
                'string',
                'regex:/^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$/',
            ],
            // Accepted into preview only so the domain can return an explicit
            // reconciliation-required conflict instead of silently changing
            // ordinal membership.
            'patch.recurrence_rrule' => ['sometimes', 'string', 'min:1', 'max:2048'],
            'patch.recurrence_exdates' => ['sometimes', 'array', 'max:500'],
            'patch.recurrence_exdates.*' => ['string', 'min:1', 'max:64'],
            'patch.recurrence_rdates' => ['sometimes', 'array', 'max:500'],
            'patch.recurrence_rdates.*' => ['string', 'min:1', 'max:64'],
            'patch.group_id' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'patch.series_id' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'patch.poll_ids' => ['sometimes', 'array', 'max:100'],
            'patch.poll_ids.*' => ['integer', 'min:1'],
            'patch.image_url' => ['sometimes', 'nullable', 'string', 'max:512'],
            'patch.cover_image' => ['sometimes', 'nullable', 'string', 'max:255'],
            'patch.federated_visibility' => ['sometimes', 'string', 'in:none,listed,joinable'],
        ];
    }

    /** @return array<string,mixed> */
    public function revisionPatch(): array
    {
        $patch = $this->validated('patch');

        return is_array($patch) ? $patch : [];
    }

    protected function failedValidation(Validator $validator): never
    {
        $field = array_key_first($validator->errors()->messages());
        $error = [
            'code' => 'EVENT_RECURRENCE_REVISION_VALIDATION_FAILED',
            'message' => __('api.validation_failed'),
        ];
        if (is_string($field) && $field !== '') {
            $error['field'] = $field;
        }

        $response = response()->json([
            'errors' => [$error],
        ], 422);
        $response->headers->set('Cache-Control', 'private, no-store');
        $response->headers->set('Pragma', 'no-cache');
        $response->setVary(['Authorization', 'Cookie', 'X-Tenant-ID'], false);

        throw new HttpResponseException($response);
    }
}
