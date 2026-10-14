<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Requests\Events;

use App\Support\Events\EventBroadcastFoundationSupport;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

/** Shared fail-closed JSON boundary for organizer communications. */
abstract class EventBroadcastFormRequest extends FormRequest
{
    /**
     * Refusals an organiser causes and can fix: the message that explains
     * each. Codes, fields and statuses are unchanged; the error gains a
     * `reason` so the website can show the message (E-102).
     *
     * @var array<string, string>
     */
    public const EXPLAINED_ERRORS = [
        'event_broadcast_schedule_in_past' => 'event_errors.broadcast.schedule_in_past',
        'event_broadcast_post_event_too_early' => 'event_errors.broadcast.post_event_too_early',
        'event_broadcast_audience_empty' => 'event_errors.broadcast.audience_empty',
        'event_broadcast_channel_empty' => 'event_errors.broadcast.channel_empty',
        'event_broadcast_body_invalid' => 'event_errors.broadcast.body_invalid',
        // E-106: refusals the organiser meets when the message moved on in
        // the background, or when they lack the event-team permission.
        'event_broadcast_version_conflict' => 'event_errors.broadcast.version_conflict',
        'event_broadcast_transition_invalid' => 'event_errors.broadcast.transition_invalid',
        'event_broadcast_cancel_after_send_forbidden' => 'event_errors.broadcast.cancel_after_send_forbidden',
        'event_broadcast_idempotency_conflict' => 'event_errors.broadcast.idempotency_conflict',
        'event_broadcast_authorization_denied' => 'event_errors.broadcast.authorization_denied',
    ];

    public function authorize(): bool
    {
        // EventBroadcastService authorizes against tenant-scoped persisted facts.
        return true;
    }

    protected function failedValidation(Validator $validator): never
    {
        $field = array_key_first($validator->errors()->messages());
        $error = [
            'code' => 'EVENT_BROADCAST_VALIDATION_FAILED',
            'message' => __('api.validation_failed'),
        ];
        if (is_string($field) && $field !== '') {
            $error['field'] = $field;
        }
        // A missing audience, channel or message is something the organiser
        // can fix: explain it as the service does (E-102). Malformed values
        // the website never sends keep the generic message.
        $reason = $this->explainedReason($validator, $field);
        if ($reason !== null) {
            $error['message'] = __(
                self::EXPLAINED_ERRORS[$reason],
                ['max' => EventBroadcastFoundationSupport::MAX_BODY_LENGTH],
            );
            $error['reason'] = $reason;
        }

        throw new HttpResponseException(response()->json(['errors' => [$error]], 422));
    }

    private function explainedReason(Validator $validator, mixed $field): ?string
    {
        $rules = is_string($field) ? array_keys($validator->failed()[$field] ?? []) : [];
        $missing = $rules !== [] && array_diff($rules, ['Required', 'Min']) === [];

        return match (true) {
            $field === 'segments' && $missing => 'event_broadcast_audience_empty',
            $field === 'channels' && $missing => 'event_broadcast_channel_empty',
            $field === 'body' && array_diff($rules, ['Required', 'Max']) === [] && $rules !== [] => 'event_broadcast_body_invalid',
            default => null,
        };
    }
}
